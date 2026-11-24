"""NBS lake builder: survey-only masking, depth sign, datum gate and outline clipping."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
from shapely.geometry import box, mapping, shape

from nbs_inventory import parse_rat
import survey_nbs
from survey_nbs import above_datum_share, metres, prepare, survey_depths, survey_values, utm_crs
from tile_writer import write_grid
from test_nbs_inventory import ROWS, rat_xml

spec = importlib.util.spec_from_file_location('select_nbs_lakes', Path(__file__).with_name('select-nbs-lakes.py'))
select = importlib.util.module_from_spec(spec)
spec.loader.exec_module(select)

CRS = 'EPSG:32615'
ORIGIN = (500_000, 3_300_000)


def write_tile(path, elevation, contributor, resolution=4):
    """A three-band NBS-shaped tile: elevation, uncertainty, contributor."""
    height, width = elevation.shape
    with rasterio.open(path, 'w', driver='GTiff', height=height, width=width, count=3, dtype='float32', crs=CRS,
                       transform=from_origin(*ORIGIN, resolution, resolution), nodata=1_000_000) as dst:
        dst.write(np.where(np.isnan(elevation), 1_000_000, elevation).astype('float32'), 1)
        dst.write(np.ones_like(elevation, dtype='float32'), 2)
        dst.write(contributor.astype('float32'), 3)


def lake_polygon(left, top, right, bottom):
    """A lon/lat polygon for a box given in the tile's projected metres."""
    return shape(transform_geom(CRS, 'EPSG:4326', mapping(box(left, bottom, right, top))))


class DepthTests(unittest.TestCase):
    def test_only_open_surveys_are_kept(self):
        # ROWS holds fill (0), surveys (7, 9, 15), a chart (12) and restricted sources (14, 16).
        keep = survey_values(parse_rat(rat_xml(ROWS)))
        np.testing.assert_array_equal(keep, [7, 9, 15])
        elevation = np.ma.masked_array([[-5.0, -4.0, -3.0, -2.0, -1.0, -6.0]], mask=[[0, 0, 0, 0, 0, 1]])
        depths = survey_depths(elevation, np.array([[7, 0, 12, 14, 15, 9]]), keep)
        np.testing.assert_array_equal(np.isnan(depths), [[False, True, True, True, False, True]])
        np.testing.assert_allclose(depths[0, [0, 4]], [5.0, 1.0])

    def test_bed_above_datum_is_negative_until_judged(self):
        depths = survey_depths(np.array([[-2.0, 0.5, -2000.0]]), np.array([[7, 7, 7]]), np.array([7]))
        np.testing.assert_allclose(depths[0, :2], [2.0, -0.5])
        self.assertTrue(np.isnan(depths[0, 2]))
        self.assertAlmostEqual(above_datum_share(np.array([2.0, -0.5, np.nan, 1.0])), 1 / 3)
        self.assertEqual(above_datum_share(np.array([np.nan])), 0.0)

    def test_helpers(self):
        self.assertEqual(metres('4m'), 4)
        with self.assertRaises(ValueError):
            metres('4 ft')
        self.assertEqual(utm_crs(-90.1, 30.0), 'EPSG:32615')
        self.assertEqual(utm_crs(-64.8, 18.0), 'EPSG:32620')


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def run_prepare(self, elevation, contributor, polygon, keep=(7,)):
        tile = self.root / 'tile.tif'
        write_tile(tile, elevation, contributor)
        out = self.root / 'lake.tif'
        reason = prepare(polygon, [(4, (tile, np.array(keep)))], out, write_grid)
        return reason, out

    def test_depths_are_clipped_to_the_outline_and_fill_is_removed(self):
        elevation = np.full((100, 100), -10.0)
        contributor = np.full((100, 100), 7)
        contributor[:, 50:] = 0  # the east half is modelled fill
        # The lake covers the middle 200 m of a 400 m tile.
        polygon = lake_polygon(ORIGIN[0] + 100, ORIGIN[1] - 100, ORIGIN[0] + 300, ORIGIN[1] - 300)
        reason, out = self.run_prepare(elevation, contributor, polygon)
        self.assertIsNone(reason)
        with rasterio.open(out) as grid:
            values = grid.read(1)
            self.assertEqual(grid.res, (8.0, 8.0))
            left, _, right, _ = grid.bounds
        finite = values[np.isfinite(values)]
        np.testing.assert_allclose(finite, 10.0, atol=1e-4)
        # Outline plus its 30 m buffer, on an 8 m grid; nothing survives east of the survey edge.
        self.assertGreater(left, ORIGIN[0] + 100 - 30 - 16)
        self.assertLess(right, ORIGIN[0] + 300 + 30 + 16)
        columns = np.where(np.isfinite(values).any(axis=0))[0]
        self.assertLessEqual(left + (columns.max() + 1) * 8, ORIGIN[0] + 200 + 8)

    def test_a_perched_lake_is_refused(self):
        elevation = np.full((100, 100), 0.3)  # a salt pond bed above MLLW
        elevation[:10] = -1.0
        polygon = lake_polygon(ORIGIN[0] + 50, ORIGIN[1] - 50, ORIGIN[0] + 350, ORIGIN[1] - 350)
        reason, out = self.run_prepare(elevation, np.full((100, 100), 7), polygon)
        self.assertIn('above chart datum', reason)
        self.assertFalse(out.exists())

    def test_some_intertidal_bed_is_dropped_not_refused(self):
        elevation = np.full((100, 100), -3.0)
        elevation[:, :10] = 0.4
        polygon = lake_polygon(ORIGIN[0], ORIGIN[1], ORIGIN[0] + 400, ORIGIN[1] - 400)
        reason, out = self.run_prepare(elevation, np.full((100, 100), 7), polygon)
        self.assertIsNone(reason)
        with rasterio.open(out) as grid:
            values = grid.read(1)
        self.assertGreaterEqual(np.nanmin(values), 0)

    def test_a_lake_without_survey_cells_is_refused(self):
        polygon = lake_polygon(ORIGIN[0] + 100, ORIGIN[1] - 100, ORIGIN[0] + 300, ORIGIN[1] - 300)
        reason, out = self.run_prepare(np.full((100, 100), -5.0), np.zeros((100, 100)), polygon)
        self.assertEqual(reason, 'No survey cells inside the outline')
        self.assertFalse(out.exists())


class PreparedCacheTests(unittest.TestCase):
    def test_changed_contributor_table_matches_a_clean_build(self):
        lake = {'hylakId': 1, 'tiles': ['T'], 'title': 'Lake', 'aliases': [], 'region': 'Test', 'surveyedShare': 1}
        tile = {'url': 'tile', 'sha256': '1' * 64, 'ratUrl': 'rat', 'ratSha256': 'a' * 64, 'resolution': '4m'}
        pins = {'lakes': [lake], 'tiles': {'T': tile}, 'hydrolakes': {'sha256': '2' * 64}, 'scheme': {}}

        class Writer:
            def __init__(self):
                self.grids = []

            def add(self, path, key):
                self.grids.append({'tilesWritten': 1})

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raster = root / 'tile.tif'
            write_tile(raster, np.full((100, 100), -5.0), np.full((100, 100), 7))
            polygon = lake_polygon(ORIGIN[0] + 100, ORIGIN[1] - 100, ORIGIN[0] + 300, ORIGIN[1] - 300)
            def build(cache, eligible):
                cache.mkdir(exist_ok=True)
                writer = Writer()
                with patch.object(survey_nbs, 'load_pins', return_value=(pins, [lake])), \
                     patch.object(survey_nbs, 'hydrolakes', return_value={1: polygon}), \
                     patch.object(survey_nbs, 'fetch', return_value={'T': (raster, np.array(eligible))}):
                    survey_nbs.nbs({'id': 'test-v1'}, cache, writer, None, write_grid)
                return writer.grids
            warm = root / 'warm'
            self.assertEqual(len(build(warm, [7])), 1)
            tile['ratSha256'] = 'b' * 64
            self.assertEqual(build(warm, []), [])
            self.assertEqual(build(root / 'cold', []), [])


class SelectionTests(unittest.TestCase):
    def test_datasets_follow_state_and_watershed(self):
        self.assertEqual(select.assign_dataset('FL', -81.6), 'noaa-nbs-florida-v1')
        self.assertEqual(select.assign_dataset('LA', -90.1), 'noaa-nbs-gulf-coast-v1')
        self.assertEqual(select.assign_dataset('NY', -77.5), 'noaa-nbs-great-lakes-basin-v1')
        self.assertEqual(select.assign_dataset('NY', -72.6), 'noaa-nbs-atlantic-coast-v1')
        self.assertEqual(select.assign_dataset('WA', -122.3), 'noaa-nbs-northwest-coast-v1')
        self.assertEqual(select.assign_dataset('CA', -121.7), 'noaa-nbs-california-v1')
        self.assertEqual(select.assign_dataset('WA', -118.5), 'noaa-nbs-inland-northwest-v1')
        self.assertEqual(select.assign_dataset('ON', -82.5), 'noaa-nbs-great-lakes-basin-v1')
        self.assertIsNone(select.assign_dataset('HI', -157.8))

    def test_names_come_from_the_most_overlapping_waterbody(self):
        lake = box(0, 0, 10, 10)
        main, aliases = select.pick_names(lake, [
            ('Lake Winnebago', box(0, 0, 8, 10)),
            ('Lake Butte des Morts', box(8, 0, 10, 2)),   # inside the merged polygon: an alias
            ('Fox River', box(9, 0, 30, 1)),              # mostly outside: not an alias
            ('', box(0, 0, 10, 10)),
        ])
        self.assertEqual(main, 'Lake Winnebago')
        self.assertEqual(aliases, ['Lake Butte des Morts'])

    def test_a_fragment_of_a_large_water_is_named_as_part(self):
        self.assertEqual(select.pick_names(box(0, 0, 10, 10), [('Chesapeake Bay', box(-100, -100, 100, 100))]),
                         ('Part of Chesapeake Bay', []))

    def test_a_barely_touching_name_is_not_used(self):
        self.assertEqual(select.pick_names(box(0, 0, 10, 10), [('Gulf of Mexico', box(9.9, 0, 500, 500))]), (None, []))

    def test_unnamed_lakes_are_titled_by_place(self):
        record = {'name': None, 'county': 'Monroe County', 'stateName': 'Florida', 'state': 'FL'}
        self.assertEqual(select.title(record), 'Unnamed lake, Monroe County')
        self.assertEqual(select.region_label(record), 'Monroe County · Florida, USA')
        self.assertEqual(select.region_label({**record, 'county': None, 'state': 'ON', 'stateName': 'Ontario'}), 'Ontario, Canada')


if __name__ == '__main__':
    unittest.main()
