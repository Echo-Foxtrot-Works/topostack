import importlib
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest

import numpy as np
from PIL import Image

benchmark = importlib.import_module('benchmark-terrain')


class BenchmarkTests(unittest.TestCase):
    def test_decodes_numeric_heights_and_nodata_with_tms_row_orientation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with sqlite3.connect(root / 'archive.mbtiles') as db:
                db.execute('CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)')
                for y, height in [(0, -20.25), (1, 301.5)]:
                    values = np.full((256,256), height, dtype=np.float32)
                    values[0,0] = np.nan
                    buffer = io.BytesIO()
                    Image.fromarray(benchmark.tile_writer.encode(values, elevation=True)).save(buffer, format='PNG')
                    db.execute('INSERT INTO tiles VALUES(?,?,?,?)', (1, 0, 1-y, buffer.getvalue()))
            values, transform = benchmark.decoded_mosaic(root, 1)
            self.assertEqual(values.shape, (512,256))
            self.assertTrue(np.isnan(values[0,0]))
            self.assertEqual(values[1,1], -20.25)
            self.assertEqual(values[257,1], 301.5)
            self.assertAlmostEqual(transform.c, -benchmark.tile_writer.WORLD)
            self.assertAlmostEqual(transform.f, benchmark.tile_writer.WORLD)
