import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds

spec = importlib.util.spec_from_file_location('gebco', Path(__file__).with_name('build-gebco-bathymetry.py'))
gebco = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gebco)

NAME = 'gebco_2026_n90.0_s0.0_w90.0_e180.0_geotiff.tif'
TID_NAME = 'gebco_2026_tid_n90.0_s0.0_w90.0_e180.0_geotiff.tif'


def geotiff(path, values, dtype):
    with rasterio.open(path, 'w', driver='GTiff', height=values.shape[0], width=values.shape[1], count=1, dtype=dtype,
                       crs='EPSG:4326', transform=from_bounds(90, 0, 180, 90, values.shape[1], values.shape[0])) as dst:
        dst.write(values.astype(dtype), 1)


def zipped(directory, name, values, dtype):
    tif = directory / name
    geotiff(tif, values, dtype)
    archive = directory / (name + '.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as out:
        out.write(tif, name)
    tif.unlink()
    return archive


def decode(data):
    rgba = np.array(Image.open(io.BytesIO(data))).astype(np.float64)
    return np.where(rgba[..., 3] > 0, rgba[..., 0] * 256 + rgba[..., 1] + rgba[..., 2] / 256 - 32768, np.nan)


class GebcoBathymetryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        # A quarter-degree world: land west of 140°E, sea east of it 1,234.4 m deep,
        # and one sea cell whose depth is positive (a drying bank) that must stay out.
        columns = np.arange(360)
        depth = np.where(columns[None, :] < 200, 250.0, -1234.4) * np.ones((360, 1))
        depth[100, 300] = 4
        tid = np.where(columns[None, :] < 200, 0, 11) * np.ones((360, 1))
        self.grid = zipped(self.root, NAME, depth, 'float32')
        self.tid = zipped(self.root, TID_NAME, tid, 'uint8')
        self.source, self.pin = gebco.load_registration()
        self.pin = {**self.pin, 'snapshotSha256': gebco.tile_writer.digest(self.grid), 'samplesSha256': gebco.tile_writer.digest(self.tid)}

    def tearDown(self):
        self.temp.cleanup()

    def test_registration_is_a_valid_ocean_grid(self):
        gebco.validate_candidate(self.source, self.pin)
        self.assertEqual((self.source['kind'], self.source['verticalDatum'], self.source['minZoom'], self.source['maxZoom']), ('bathymetry-grid', 'MSL', 0, 9))
        self.assertEqual(self.source['bounds'], [-180, -85.0511, 180, 85.0511])

    def test_masks_land_and_rounds_depths(self):
        grids = gebco.extract(self.grid, self.root / 'grid')
        tids = gebco.extract(self.tid, self.root / 'tid')
        # z5 block 28/12 spans 135-146.25°E around 31-40°N: both coast and sea.
        values = gebco.read_block(str(grids[0]), str(tids[0]), 5, 28, 12, 6)
        self.assertEqual(values.shape, (512, 512))
        west = values[:, :64]
        east = values[:, -64:]
        self.assertTrue(np.isnan(west).all())
        self.assertTrue(np.isfinite(east).all())
        self.assertTrue(np.all(east == -1234))

    def test_downsample_averages_valid_children_only(self):
        values = np.array([[np.nan, -10, -2, -2], [-20, np.nan, -2, -2], [np.nan, np.nan, -4, -4], [np.nan, np.nan, -4, -5]], dtype=np.float32)
        self.assertTrue(np.array_equal(gebco.downsample(values), np.array([[-15, -2], [np.nan, -4]], dtype=np.float32), equal_nan=True))

    def test_blocks_cover_a_region_without_crossing_the_antimeridian(self):
        self.assertEqual(len(gebco.blocks([-180, -85.0511, 180, 85.0511], 5)), 1024)
        self.assertEqual(gebco.covering_member([NAME], 135, 31, 146.25, 40.9), NAME)
        with self.assertRaises(ValueError):
            gebco.covering_member([NAME], 80, 10, 95, 20)

    def test_builds_a_partial_pyramid_with_a_receipt(self):
        def fake_convert(args, check):
            if args[1] == 'convert':
                Path(args[3]).write_bytes(Path(args[2]).read_bytes())

        out = self.root / 'build'
        with patch.object(gebco, 'load_registration', return_value=(self.source, self.pin)), \
                patch.object(gebco.tile_writer.subprocess, 'run', side_effect=fake_convert):
            output = gebco.build(self.source, self.pin, self.grid, self.tid, out, workers=1, bounds=[135, 31, 146, 40], max_zoom=6)
        database = sqlite3.connect(output)  # the fake convert copied the MBTiles database
        zooms = sorted({row[0] for row in database.execute('SELECT zoom_level FROM tiles')})
        self.assertEqual(zooms, [0, 1, 2, 3, 4, 5, 6])
        depths = np.concatenate([decode(data).ravel() for (data,) in database.execute('SELECT tile_data FROM tiles WHERE zoom_level=6')])
        finite = depths[np.isfinite(depths)]
        # Whole metres below sea level; only the coast blends toward the land.
        self.assertTrue(finite.size and np.all((finite < 0) & (finite >= -1234) & (finite == np.round(finite))))
        self.assertGreater(np.mean(finite == -1234), 0.9)
        metadata = dict(database.execute('SELECT name, value FROM metadata'))
        self.assertEqual((metadata['topostack_dataset'], metadata['topostack_vertical_datum']), (self.source['id'], 'MSL'))
        receipt = json.loads(output.with_suffix('.sources.json').read_text())
        self.assertEqual((receipt['verticalDatum'], receipt['coverage']['zoom']), ('MSL', 6))
        self.assertGreater(receipt['coverage']['validSamples'], 0)

    def test_refuses_zips_that_do_not_match_their_pins(self):
        with self.assertRaisesRegex(ValueError, 'pins'):
            gebco.build(self.source, {**self.pin, 'snapshotSha256': 'a' * 64}, self.grid, self.tid, self.root / 'bad')


if __name__ == '__main__':
    unittest.main()
