from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

import numpy as np
import rasterio
from rasterio.transform import from_bounds

import hrdem


class HrdemTerrainTests(unittest.TestCase):
    def test_reprojection_preserves_ground_heights_and_nodata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bounds = [-78.97, 46.44, -78.90, 46.49]
            values = np.full((100, 100), 312.5, dtype=np.float32)
            values[30:70, 30:70] = np.nan
            source = root / 'source.tif'
            hrdem.tile_writer.write_grid(source, values, from_bounds(*bounds, 100, 100), 'EPSG:4326')
            with patch.object(hrdem, 'check_remote') as check:
                digest = hrdem.snapshot({'bounds': bounds, 'maxZoom': 15}, {'url': str(source)}, root / 'snapshot.tif')
                self.assertEqual(check.call_count, 2)
            self.assertEqual(len(digest), 64)
            with rasterio.open(root / 'snapshot.tif') as result:
                raster = result.read(1)
                self.assertEqual(result.crs.to_epsg(), 3857)
                self.assertTrue(np.isnan(raster).any())
                np.testing.assert_allclose(raster[np.isfinite(raster)], 312.5, atol=0.001)
                rgba = hrdem.tile_writer.encode(raster, elevation=True)
                self.assertTrue((rgba[..., 3][np.isnan(raster)] == 0).all())

    def test_rejects_changed_upstream_before_reading(self):
        response = MagicMock()
        response.__enter__.return_value.headers = {'ETag': '"different"', 'Content-Length': '123'}
        with patch.object(hrdem.urllib.request, 'urlopen', return_value=response):
            with self.assertRaisesRegex(ValueError, 'asset changed'):
                hrdem.check_remote({'url': 'https://example.test/source.tif', 'etag': '"pinned"', 'bytes': 123})

    def test_bounds_large_builds_before_opening_remote_raster(self):
        with patch.object(hrdem, 'check_remote'), patch.object(hrdem.rasterio, 'open') as read:
            with self.assertRaisesRegex(ValueError, 'build limit'):
                hrdem.snapshot({'bounds': [-140, 40, -50, 70], 'maxZoom': 15}, {}, Path('/tmp/not-written.tif'))
            read.assert_not_called()


class BuildReceiptTests(unittest.TestCase):
    def test_wrong_snapshot_extent_is_rejected_before_archive_creation(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = Path(__file__).parent.parent / 'data'
            source = json.loads((data / 'terrain-sources.json').read_text())['sources'][0]
            pin = json.loads((data / 'hrdem-sources.json').read_text())[source['id']]
            snapshot = root / 'wrong.tif'
            hrdem.tile_writer.write_grid(snapshot, np.ones((8,8), dtype=np.float32), from_bounds(0,1,2,3,8,8), 'EPSG:4326')
            with self.assertRaisesRegex(ValueError, 'extent'):
                hrdem.build(source, pin, snapshot, root / 'bad.pmtiles')
            self.assertFalse((root / 'bad.mbtiles').exists())

    def test_receipt_is_written_once_only_after_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = {'id': 'x', 'name': 'x', 'maxZoom': 0, 'bounds': [0, 0, 1, 1], 'encoding': 'elevation-terrarium-v1', 'url': 'u', 'license': 'l'}
            snapshot = root / 'grid.tif'
            hrdem.tile_writer.write_grid(snapshot, np.ones((8, 8), dtype=np.float32), from_bounds(0, 0, 1, 1, 8, 8), 'EPSG:4326')
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['grid.tif'])

            def invalid(receipt):
                raise ValueError('schema')

            def fake_convert(args, check):
                Path(args[-1]).write_bytes(b'pmtiles')
            output = root / 'out.pmtiles'
            writer = hrdem.tile_writer.TileWriter(output, source)
            writer.add(snapshot, 'grid')
            with patch.object(hrdem.tile_writer.subprocess, 'run', side_effect=fake_convert):
                with self.assertRaisesRegex(ValueError, 'schema'):
                    writer.finish([], invalid)
            self.assertFalse(output.with_suffix('.sources.json').exists())
            self.assertFalse(any(p.name.endswith('.part') for p in root.iterdir()))

            output = root / 'good.pmtiles'
            writer = hrdem.tile_writer.TileWriter(output, source)
            writer.add(snapshot, 'grid')
            with patch.object(hrdem.tile_writer.subprocess, 'run', side_effect=fake_convert):
                writer.finish([], lambda receipt: receipt.update(schemaVersion=1))
            import json
            self.assertEqual(json.loads(output.with_suffix('.sources.json').read_text())['schemaVersion'], 1)


if __name__ == '__main__':
    unittest.main()
