"""GSI elevation tiles: decoding, polite fetching, product merging and shards.

Shared by build-gsi-terrain.py and its tests; no import-time side effects.
The tiles and their encoding are documented at
https://maps.gsi.go.jp/development/demtile.html: each 256 px PNG pixel holds
x = R*2^16 + G*2^8 + B; x = 2^23 is no data, x > 2^23 encodes negative heights
as (x - 2^24) * 0.01 m, otherwise the height is x * 0.01 m (T.P. heights).

Copying these tiles into an archive is reproduction under the Survey Act
(測量法 Art. 29): every source built from them is registered with
availability "development" and approval.required until GSI's approval number
is recorded (docs/gsi-terrain.md).
"""
from contextlib import closing
import hashlib
import io
import json
import math
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

TILE = 256
URL = 'https://cyberjapandata.gsi.go.jp/xyz/{product}/{z}/{x}/{y}.png'
AGENT = 'TopoStack data build'
# 5 m products in the order a pixel takes them: laser survey, then photogrammetry.
FIVE_METRE = ('dem5a_png', 'dem5b_png', 'dem5c_png')
NATIONAL = 'dem_png'
NATIONAL_ZOOM = 13
FINE_ZOOM = 15
# Japan with its outlying islands, in tile-aligned degrees.
JAPAN = (122.5, 20.0, 154.5, 46.0)
SHARDS = ('hokkaido', 'tohoku', 'kanto', 'chubu', 'kinki', 'chugoku-shikoku', 'kyushu', 'southern-islands')


def decode(data):
    """Heights in metres with NaN for no data; None (a 404) is an empty tile."""
    if data is None:
        return np.full((TILE, TILE), np.nan, dtype=np.float32)
    rgb = np.array(Image.open(io.BytesIO(data)).convert('RGB')).astype(np.int64)
    x = rgb[..., 0] * 65536 + rgb[..., 1] * 256 + rgb[..., 2]
    heights = np.where(x < 2**23, x, x - 2**24) * 0.01
    return np.where(x == 2**23, np.nan, heights).astype(np.float32)


def tile_center(z, x, y):
    n = 2**z
    lon = (x + 0.5) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / n))))
    return lon, lat


def shard_of(z, x, y):
    """The shard owning a tile, decided by its z8 ancestor's centre so every z15 tile has exactly one."""
    if z < 8:
        raise ValueError('Shards are defined from z8')
    lon, lat = tile_center(8, x >> (z - 8), y >> (z - 8))
    if lat >= 41.3:
        return 'hokkaido'
    if lat >= 37.6:
        return 'tohoku'
    if lat < 30:
        return 'southern-islands'
    if lon >= 138.6:
        return 'kanto'
    if lon >= 136.4:
        return 'chubu'
    if lon >= 134.0:
        return 'kinki'
    if lat >= 33.95 or lon >= 132.1:
        return 'chugoku-shikoku'
    return 'kyushu'


def tile_range(bounds, z):
    west, south, east, north = bounds
    n = 2**z
    to_x = lambda lon: min(n - 1, int((lon + 180) / 360 * n))
    to_y = lambda lat: min(n - 1, int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))
    return range(to_x(west), to_x(east) + 1), range(to_y(north), to_y(south) + 1)


def children(z, x, y, zoom):
    scale = 2 ** (zoom - z)
    return [(zoom, x * scale + dx, y * scale + dy) for dy in range(scale) for dx in range(scale)]


class Fetcher:
    """Throttled GSI requests: at most `rate` a second, retried on network errors, 404 as no tile."""

    def __init__(self, rate=8.0, opener=urllib.request.urlopen, sleep=time.sleep, clock=time.monotonic):
        self.interval, self.opener, self.sleep, self.clock = 1 / rate, opener, sleep, clock
        self.last = -math.inf
        self.requests = 0

    def get(self, product, z, x, y, attempts=5):
        for attempt in range(attempts):
            wait = self.last + self.interval - self.clock()
            if wait > 0:
                self.sleep(wait)
            self.last = self.clock()
            self.requests += 1
            try:
                request = urllib.request.Request(URL.format(product=product, z=z, x=x, y=y), headers={'User-Agent': AGENT})
                with self.opener(request, timeout=60) as response:
                    return response.read(), response.headers.get('ETag', '')
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    return None, ''
                if error.code < 500 and error.code != 429:
                    raise
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            if attempt == attempts - 1:
                raise RuntimeError(f'GSI request failed: {product}/{z}/{x}/{y}')
            self.sleep(min(60, 5 * 2**attempt))


def merge_five_metre(fetch, z, x, y, national=None):
    """One z15 tile from dem5a, then dem5b and dem5c only where 5a has gaps the 10 m model fills.

    `national` is the 10 m height grid for the same pixels, or None. Sea and
    lakes are no data in every product, so a gap 10 m data leaves empty is
    never worth another request. Returns (heights, [(product, etag, bytes)]).
    """
    merged = np.full((TILE, TILE), np.nan, dtype=np.float32)
    used = []
    for product in FIVE_METRE:
        data, etag = fetch(product, z, x, y)
        if data is not None:
            values = decode(data)
            merged = np.where(np.isnan(merged), values, merged)
            used.append((product, etag, len(data)))
        gaps = np.isnan(merged) if national is None else np.isnan(merged) & np.isfinite(national)
        if not gaps.any():
            break
    return merged, used


def upsample_national(values, z, x, y, zoom):
    """The 10 m grid's pixels under one finer tile, by nearest sample (only used to find gaps)."""
    scale = 2 ** (zoom - z)
    size = TILE // scale
    row, column = (y % scale) * size, (x % scale) * size
    return np.repeat(np.repeat(values[row:row + size, column:column + size], scale, axis=0), scale, axis=1)


def downsample(values):
    """2×2 mean of valid samples; a parent pixel is NaN only when all four children are."""
    h, w = values.shape
    quads = values.reshape(h // 2, 2, w // 2, 2)
    valid = np.isfinite(quads)
    count = valid.sum(axis=(1, 3))
    total = np.where(valid, quads, 0).sum(axis=(1, 3))
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan).astype(np.float32)


def quantize(values, step=0.1):
    """GSI publishes centimetres; a decimetre keeps every contour and shrinks tiles by about 40%."""
    return np.round(values / step) * step


class Cache:
    """Resumable per-build store of merged tiles and the provenance of every request."""

    def __init__(self, path):
        self.path = Path(path)
        self.db = sqlite3.connect(self.path)
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS heights(z INTEGER, x INTEGER, y INTEGER, data BLOB, PRIMARY KEY(z, x, y));
            CREATE TABLE IF NOT EXISTS visited(z INTEGER, x INTEGER, y INTEGER, kind TEXT, PRIMARY KEY(z, x, y, kind));
            CREATE TABLE IF NOT EXISTS requests(product TEXT, z INTEGER, x INTEGER, y INTEGER, etag TEXT, bytes INTEGER,
                                                PRIMARY KEY(product, z, x, y));
        ''')

    def done(self, z, x, y, kind):
        return self.db.execute('SELECT 1 FROM visited WHERE z=? AND x=? AND y=? AND kind=?', (z, x, y, kind)).fetchone() is not None

    def record(self, z, x, y, kind, values, used):
        if values is not None and np.isfinite(values).any():
            self.db.execute('INSERT OR REPLACE INTO heights VALUES(?,?,?,?)', (z, x, y, values.astype('<f4').tobytes()))
        self.db.executemany('INSERT OR REPLACE INTO requests VALUES(?,?,?,?,?,?)', [(p, z, x, y, e, b) for p, e, b in used])
        self.db.execute('INSERT OR REPLACE INTO visited VALUES(?,?,?,?)', (z, x, y, kind))

    def heights(self, z, x, y):
        row = self.db.execute('SELECT data FROM heights WHERE z=? AND x=? AND y=?', (z, x, y)).fetchone()
        return None if row is None else np.frombuffer(row[0], dtype='<f4').reshape(TILE, TILE)

    def tiles(self, z):
        return [row for row in self.db.execute('SELECT x, y FROM heights WHERE z=? ORDER BY y, x', (z,))]

    def commit(self):
        self.db.commit()

    def manifest_digest(self, z, tiles):
        """SHA-256 of the product, tile, ETag and size of every request behind `tiles` at zoom z: the archive's upstream pin."""
        wanted = set(tiles)
        digest = hashlib.sha256()
        total_bytes = requests = 0
        for row in self.db.execute('SELECT product, z, x, y, etag, bytes FROM requests WHERE z=? ORDER BY product, x, y', (z,)):
            if (row[2], row[3]) in wanted:
                digest.update((json.dumps(row) + '\n').encode())
                total_bytes += row[5]
                requests += 1
        return digest.hexdigest(), total_bytes, requests

    def samples_digest(self, z, tiles):
        digest = hashlib.sha256()
        for x, y in sorted(tiles, key=lambda tile: (tile[1], tile[0])):
            digest.update(f'{z}/{x}/{y}\n'.encode())
            digest.update(self.heights(z, x, y).tobytes())
        return digest.hexdigest()

    def close(self):
        with closing(self.db):
            self.db.commit()
