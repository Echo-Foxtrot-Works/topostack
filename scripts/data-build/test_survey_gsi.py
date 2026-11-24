import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
import rasterio
from rasterio.transform import from_origin

import survey_gsi


class ShiftJisInfo(zipfile.ZipInfo):
    """Writes its name in Shift_JIS without the UTF-8 flag, as GSI's archives do."""
    def _encodeFilenameFlags(self):
        return self.filename.encode('cp932'), self.flag_bits & ~0x800  # no UTF-8 name flag


def lake_zip(path, depths):
    """A GSI-style ZIP: Shift_JIS member names and a 10 m depth grid in plane rectangular zone IX."""
    memory = io.BytesIO()
    with rasterio.open(memory, 'w', driver='GTiff', height=depths.shape[0], width=depths.shape[1], count=1, dtype='float32',
                       crs='EPSG:6677', transform=from_origin(-77340, -84070, 10, 10), nodata=-9999) as dst:
        dst.write(depths.astype(np.float32), 1)
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr(ShiftJisInfo('ashinoko-2021/湖沼データ_TIFF_ashinoko/水深グリッド/ashinoko-dem-2021_ras.tif'), memory.getvalue())
        archive.writestr('ashinoko-2021/readme.txt', 'x')
    return path


class SurveyGsiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        depths = np.full((20, 30), 12.5)
        depths[:, :5] = -9999
        depths[0, 10] = -3  # never negative depths
        self.zip = lake_zip(self.root / 'ashinoko-2021.zip', depths)

    def tearDown(self):
        self.temp.cleanup()

    def test_reads_depths_from_the_shift_jis_member(self):
        [(name, values, transform, crs)] = survey_gsi.read_depths(self.zip)
        self.assertEqual(name, 'ashinoko-dem-2021')
        self.assertEqual(crs.to_epsg(), 6677)
        self.assertEqual(transform.a, 10)
        self.assertTrue(np.isnan(values[:, :5]).all())
        self.assertTrue(np.isnan(values[0, 10]))
        self.assertTrue(np.all(values[1:, 5:] == 12.5))

    def test_finds_every_lake_on_the_list_page(self):
        html = ('<a href="https://www1.gsi.go.jp/geowww/lake/download/ashinoko/ashinoko-2021.zip">'
                '<a href="https://www1.gsi.go.jp/geowww/lake/download/ashinoko/ashinoko-2021_A3.pdf">'
                '<a href="https://www1.gsi.go.jp/geowww/lake/download/onogawako-akimotoko/onogawako・akimotoko-2019.zip">')
        found = sorted((m.group(1), m.group(3)) for m in survey_gsi.ZIP_LINK.finditer(html))
        self.assertEqual(found, [('ashinoko', '2021'), ('onogawako-akimotoko', '2019')])
        seen = []
        with patch.object(survey_gsi, 'pin_lake', side_effect=lambda url, lake, year, cache: seen.append(url) or {'bbox': [0, 0, 1, 1]}):
            survey_gsi.pin(self.root, html=html, out=self.root / 'candidate.json')
        # Request URLs must be ASCII: the middle dot is percent-encoded.
        self.assertIn('https://www1.gsi.go.jp/geowww/lake/download/onogawako-akimotoko/onogawako%E3%83%BBakimotoko-2019.zip', seen)

    def test_pins_each_lake_with_its_extent_and_writes_an_unregistered_candidate(self):
        cache = self.root / 'cache'
        (cache / 'gsi').mkdir(parents=True)
        self.zip.replace(cache / 'gsi' / 'ashinoko-2021.zip')
        html = '<a href="https://www1.gsi.go.jp/geowww/lake/download/ashinoko/ashinoko-2021.zip">'
        out = self.root / 'gsi-lake-sources.json'
        with patch.object(survey_gsi, 'fetch') as fetch:
            found = survey_gsi.pin(cache, html=html, out=out)
        fetch.assert_not_called()  # already cached
        pin = found['pins'][0]
        self.assertEqual((pin['id'], pin['surveyYear'], pin['maxDepthM'], pin['crs']), ('gsi_ashinoko', 2021, 12.5, 'EPSG:6677'))
        west, south, east, north = pin['bbox']
        self.assertTrue(138.9 < west < east < 139.1 and 35.1 < south < north < 35.3)  # Lake Ashi
        source = found['source']
        self.assertEqual((source['availability'], source['approval'], source['encoding']), ('development', {'required': True}, 'depth-terrarium-v1'))
        self.assertLess(source['bounds'][0], west)

    def test_reads_every_grid_of_a_paired_lake_zip(self):
        path = self.root / 'pair.zip'
        memory = io.BytesIO()
        with rasterio.open(memory, 'w', driver='GTiff', height=4, width=4, count=1, dtype='float32', crs='EPSG:6678',
                           transform=from_origin(0, 0, 10, 10), nodata=-9999) as dst:
            dst.write(np.full((4, 4), 2.0, dtype=np.float32), 1)
        with zipfile.ZipFile(path, 'w') as archive:
            for lake in ('izunuma', 'uchinuma'):
                archive.writestr(ShiftJisInfo(f'pair/{lake}-2017/湖沼データ_TIFF/水深グリッド/{lake}-dem-2017_ras.tif'), memory.getvalue())
        self.assertEqual([name for name, *_ in survey_gsi.read_depths(path)], ['izunuma-dem-2017', 'uchinuma-dem-2017'])

    def test_has_no_candidate_before_pinning(self):
        self.assertEqual(survey_gsi.candidate(self.root / 'missing.json'), (None, []))

    def test_builds_each_pinned_grid_into_the_archive(self):
        cache = self.root / 'cache'
        (cache / 'gsi').mkdir(parents=True)
        self.zip.replace(cache / 'gsi' / 'ashinoko-2021.zip')
        added, written = [], []
        writer = type('W', (), {'add': lambda _, path, name: added.append((path.name, name))})()
        pins = [{'id': 'gsi_ashinoko', 'file': 'gsi/ashinoko-2021.zip', 'url': 'https://example.test/a.zip'}]
        survey_gsi.gsi(survey_gsi.SOURCE, pins, cache, writer, lambda item, c: c / item['file'],
                       lambda path, values, transform, crs: written.append((path.name, int(np.isfinite(values).sum()))) or path)
        self.assertEqual(added, [('gsi_ashinoko.tif', 'gsi_ashinoko')])
        self.assertEqual(written, [('gsi_ashinoko.tif', 20 * 25 - 1)])


if __name__ == '__main__':
    unittest.main()
