import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import numpy as np
from PIL import Image

import gsi

spec = importlib.util.spec_from_file_location('build_gsi', Path(__file__).with_name('build-gsi-terrain.py'))
build_gsi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_gsi)


def gsi_png(heights):
    """Encode metres the way GSI does; NaN becomes the no-data value 2^23."""
    values = np.asarray(heights, dtype=np.float64) * np.ones((256, 256))
    x = np.where(np.isnan(values), 2**23, np.round(np.nan_to_num(values) * 100).astype(np.int64) % 2**24)
    rgb = np.stack([(x >> 16) & 255, (x >> 8) & 255, x & 255], axis=-1).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, format='PNG')
    return buffer.getvalue()


class DecodeTest(unittest.TestCase):
    def test_heights_no_data_and_negative_values(self):
        values = np.full((256, 256), 3776.24)
        values[0, :3] = [np.nan, -3.5, 0]
        decoded = gsi.decode(gsi_png(values))
        self.assertTrue(np.isnan(decoded[0, 0]))
        self.assertAlmostEqual(float(decoded[0, 1]), -3.5, places=4)
        self.assertEqual(float(decoded[0, 2]), 0)
        self.assertAlmostEqual(float(decoded[5, 5]), 3776.24, places=2)
        self.assertTrue(np.isnan(gsi.decode(None)).all())

    def test_quantizes_to_decimetres(self):
        self.assertTrue(np.allclose(gsi.quantize(np.array([1.04, 1.06, -2.25])), [1.0, 1.1, -2.2]))


class MergeTest(unittest.TestCase):
    def test_takes_laser_survey_first_and_stops_when_gaps_are_sea(self):
        five_a = np.full((256, 256), 10.0)
        five_a[:, :64] = np.nan
        tiles = {'dem5a_png': gsi_png(five_a), 'dem5b_png': gsi_png(np.full((256, 256), 20.0)), 'dem5c_png': gsi_png(30.0)}
        calls = []

        def fetch(product, z, x, y):
            calls.append(product)
            return tiles[product], f'"{product}"'

        # The 10 m model has land under the gap: 5b fills it and 5c is never asked for.
        merged, used = gsi.merge_five_metre(fetch, 15, 1, 2, np.full((256, 256), 5.0))
        self.assertEqual(calls, ['dem5a_png', 'dem5b_png'])
        self.assertTrue(np.all(merged[:, :64] == 20) and np.all(merged[:, 64:] == 10))
        self.assertEqual([product for product, _, _ in used], ['dem5a_png', 'dem5b_png'])
        # The gap is sea in the 10 m model too: one request is enough.
        calls.clear()
        sea = np.full((256, 256), 5.0)
        sea[:, :64] = np.nan
        merged, _ = gsi.merge_five_metre(fetch, 15, 1, 2, sea)
        self.assertEqual(calls, ['dem5a_png'])
        self.assertTrue(np.isnan(merged[:, :64]).all())

    def test_upsamples_the_national_grid_under_a_finer_tile(self):
        national = np.arange(256 * 256, dtype=np.float32).reshape(256, 256)
        under = gsi.upsample_national(national, 13, 4 * 10 + 1, 4 * 20 + 2, 15)
        self.assertEqual(under.shape, (256, 256))
        self.assertEqual(under[0, 0], national[128, 64])
        self.assertEqual(under[255, 255], national[191, 127])


class ShardTest(unittest.TestCase):
    def test_places_land_in_one_shard_each(self):
        places = {'hokkaido': (43.06, 141.35), 'tohoku': (38.27, 140.87), 'kanto': (35.68, 139.77), 'chubu': (35.18, 136.91),
                  'kinki': (34.69, 135.50), 'chugoku-shikoku': (34.39, 132.46), 'kyushu': (33.59, 130.40),
                  'southern-islands': (26.21, 127.68)}
        for shard, (lat, lon) in places.items():
            xs, ys = gsi.tile_range((lon, lat, lon, lat), 15)
            x, y = xs[0], ys[0]
            with self.subTest(shard=shard):
                self.assertEqual(gsi.shard_of(15, x, y), shard)
        # Hachijō-jima rides with Tōkyō; the Ogasawara islands with the southern islands.
        hachijo = gsi.tile_range((139.79, 33.11, 139.79, 33.11), 15)
        chichijima = gsi.tile_range((142.19, 27.09, 142.19, 27.09), 15)
        self.assertEqual(gsi.shard_of(15, hachijo[0][0], hachijo[1][0]), 'kanto')
        self.assertEqual(gsi.shard_of(15, chichijima[0][0], chichijima[1][0]), 'southern-islands')
        with self.assertRaises(ValueError):
            gsi.shard_of(7, 0, 0)


class FetcherTest(unittest.TestCase):
    def test_throttles_retries_and_treats_404_as_no_tile(self):
        now = [0.0]
        sleeps = []
        responses = iter([urllib.error.URLError('reset'), b'png', urllib.error.HTTPError('u', 404, 'missing', {}, None)])

        class Response:
            def __init__(self, data):
                self.data, self.headers = data, {'ETag': '"e"'}

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return self.data

        def opener(request, timeout):
            item = next(responses)
            if isinstance(item, Exception):
                raise item
            return Response(item)

        def sleep(seconds):
            sleeps.append(seconds)
            now[0] += seconds

        fetcher = gsi.Fetcher(rate=4, opener=opener, sleep=sleep, clock=lambda: now[0])
        self.assertEqual(fetcher.get('dem5a_png', 15, 1, 2), (b'png', '"e"'))
        self.assertEqual(fetcher.get('dem5a_png', 15, 1, 3), (None, ''))
        self.assertEqual(fetcher.requests, 3)
        self.assertIn(5, sleeps)  # backoff after the network error
        self.assertTrue(all(s > 0 for s in sleeps))


class WalkAndBuildTest(unittest.TestCase):
    """A fake GSI with land in one z13 tile of the Kantō shard (its z8 ancestor is centred at 139.9°E)."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.land13 = (13, 227 * 32 + 5, 101 * 32 + 7)
        self.requests = []

    def tearDown(self):
        self.temp.cleanup()

    def fake_get(self, product, z, x, y):
        self.requests.append((product, z, x, y))
        _, lx, ly = self.land13
        if product == gsi.NATIONAL:
            shift = 13 - z
            return (gsi_png(1000.0), f'"n{z}"') if (x, y) == (lx >> shift, ly >> shift) else (None, '')
        if product == 'dem5a_png' and (x >> 2, y >> 2) == (lx, ly):
            return gsi_png(1234.5 + (x % 4)), f'"5a-{x}-{y}"'
        return None, ''

    def test_walks_land_only_resumes_and_builds_a_development_archive(self):
        cache = gsi.Cache(self.root / 'cache.sqlite')
        fetcher = type('F', (), {'requests': 0, 'get': lambda _, *args: self.fake_get(*args)})()
        build_gsi.walk(cache, fetcher, 'kanto', log=lambda *_: None)
        fine = [r for r in self.requests if r[1] == 15]
        self.assertEqual(len(fine), 16)  # the 16 z15 tiles under the one z13 tile with land
        self.assertEqual(len(cache.tiles(15)), 16)
        before = len(self.requests)
        build_gsi.walk(cache, fetcher, 'kanto', log=lambda *_: None)
        self.assertEqual(len(self.requests), before)  # a rerun asks GSI for nothing

        def fake_convert(args, check):
            if args[1] == 'convert':
                Path(args[3]).write_bytes(Path(args[2]).read_bytes())

        tiles = cache.tiles(15)
        source = build_gsi.source_for('shard', tiles, 15, 'kanto')
        self.assertEqual((source['availability'], source['approval'], source['verticalDatum']), ('development', {'required': True}, 'JP-TP'))
        with patch.object(build_gsi.tile_writer.subprocess, 'run', side_effect=fake_convert):
            output = build_gsi.build_archive(cache, source, tiles, 10, 15, self.root / 'out')
        database = sqlite3.connect(output)
        zooms = sorted({row[0] for row in database.execute('SELECT zoom_level FROM tiles')})
        self.assertEqual(zooms, [10, 11, 12, 13, 14, 15])
        receipt = json.loads(output.with_suffix('.sources.json').read_text())
        self.assertEqual(receipt['sources'][0]['requests'], 16)
        self.assertEqual(receipt['coverage']['validSamples'], 16 * 256 * 256)
        cache.close()


if __name__ == '__main__':
    unittest.main()
