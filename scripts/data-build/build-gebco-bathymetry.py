#!/usr/bin/env python3
"""Build the global GEBCO ocean-depth archive (docs/ocean-bathymetry.md).

Reads the GEBCO_2026 ice-surface GeoTIFF zip and its type identifier (TID)
grid zip, both pinned by SHA-256 in scripts/data/gebco-sources.json, and writes
a z0-9 PMTiles archive of depths below sea level: land (TID 0) and every
sample at or above 0 m are transparent, depths are rounded to whole metres,
and tiles without ocean are omitted. The studio overlays it only where its own
base terrain is already at or below sea level (docs/terrain-selection.md).

  uv run --no-project --python 3.13 --with-requirements scripts/data-build/requirements.txt \\
    python scripts/data-build/build-gebco-bathymetry.py \\
      --grid .topostack/gebco/gebco_2026_geotiff.zip --tid .topostack/gebco/gebco_2026_tid_geotiff.zip \\
      --out-dir .topostack/gebco/build-1 [--register]

z9 is the finest level: a z9 pixel (about 250 m at 35°N) is already finer than
the 15 arc-second grid (about 460 m), so the studio upsamples z9 for closer
views. Every z9 tile lies inside one of GEBCO's eight 90° tiles, because z2
tile edges fall on their meridians and on the equator.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import io
import json
import math
from pathlib import Path
import platform
import zipfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from rasterio.windows import from_bounds as window_from_bounds

import tile_writer
from terrain_release import register, validate_candidate, validate_receipt

ROOT = Path(__file__).parent.parent
WORLD = tile_writer.WORLD
TILE = 256
MAX_ZOOM = 9
BLOCK_ZOOM = 5
VALUE_RANGE = (-11000, 10)


def load_registration(path=ROOT / 'data/gebco-sources.json'):
    """The source entry and pin a build registers; both are reviewed in git before any build."""
    registration = json.loads(Path(path).read_text())
    return registration['source'], registration['pin']


def tile_bounds(z, x, y):
    span = 2 * WORLD / 2**z
    return x * span - WORLD, WORLD - (y + 1) * span, (x + 1) * span - WORLD, WORLD - y * span


def mercator_lat(y):
    return math.degrees(math.atan(math.sinh(y / WORLD * math.pi)))


def geo_bounds(z, x, y):
    left, bottom, right, top = tile_bounds(z, x, y)
    return left / WORLD * 180, mercator_lat(bottom), right / WORLD * 180, mercator_lat(top)


def parse_extent(name):
    """(north, south, west, east) from a GEBCO tile name."""
    stem = Path(name).stem
    values = {}
    for token in stem.split('_'):
        if token[:1] in 'nswe' and len(token) > 1:
            try:
                values[token[0]] = float(token[1:])
            except ValueError:
                pass
    return values['n'], values['s'], values['w'], values['e']


def covering_member(names, west, south, east, north):
    for name in names:
        n, s, w, e = parse_extent(name)
        if w <= west + 1e-9 and east <= e + 1e-9 and s <= south + 1e-9 and north <= n + 1e-9:
            return name
    raise ValueError(f'No GEBCO tile covers {west:.3f},{south:.3f},{east:.3f},{north:.3f}')


def read_block(grid_path, tid_path, z, x, y, max_zoom):
    """Ocean depths for one block at max_zoom resolution: NaN on land and at or above sea level."""
    size = TILE * 2 ** (max_zoom - z)
    west, south, east, north = geo_bounds(z, x, y)
    transform = from_bounds(*tile_bounds(z, x, y), size, size)
    out = {}
    for label, path, resampling in (('depth', grid_path, Resampling.bilinear), ('tid', tid_path, Resampling.nearest)):
        with rasterio.open(path) as src:
            # Read a little beyond the block so bilinear sampling at its edge has neighbours.
            margin = 2 * abs(src.transform.a)
            window = window_from_bounds(max(west - margin, src.bounds.left), max(south - margin, src.bounds.bottom),
                                        min(east + margin, src.bounds.right), min(north + margin, src.bounds.top), transform=src.transform)
            window = window.round_offsets().round_lengths()
            values = src.read(1, window=window).astype(np.float32)
            dst = np.full((size, size), np.nan, dtype=np.float32)
            reproject(values, dst, src_transform=src.window_transform(window), src_crs=src.crs, src_nodata=src.nodata,
                      dst_transform=transform, dst_crs='EPSG:3857', dst_nodata=np.nan, resampling=resampling, num_threads=1)
            out[label] = dst
    depth = out['depth']
    ocean = np.isfinite(depth) & (depth < 0) & np.isfinite(out['tid']) & (out['tid'] != 0)
    return np.where(ocean, np.maximum(np.round(depth), VALUE_RANGE[0]), np.nan).astype(np.float32)


def downsample(values):
    """2×2 mean of valid samples; a parent pixel is NaN only when all four children are."""
    h, w = values.shape
    quads = values.reshape(h // 2, 2, w // 2, 2)
    valid = np.isfinite(quads)
    count = valid.sum(axis=(1, 3))
    total = np.where(valid, quads, 0).sum(axis=(1, 3))
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(count > 0, np.round(total / np.maximum(count, 1)), np.nan).astype(np.float32)


def png(values):
    buffer = io.BytesIO()
    Image.fromarray(tile_writer.encode(values, True, VALUE_RANGE)).save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def pyramid(values, z, x, y, stop_zoom):
    """Encoded tiles for a grid whose top-left tile is (z, x, y), from its own zoom down to stop_zoom."""
    tiles = []
    level, zoom = values, z + int(math.log2(values.shape[0] // TILE))
    while True:
        count = level.shape[0] // TILE
        scale = 2 ** (zoom - z)
        for row in range(count):
            for column in range(count):
                tile = level[row * TILE:(row + 1) * TILE, column * TILE:(column + 1) * TILE]
                if np.isfinite(tile).any():
                    tiles.append((zoom, x * scale + column, y * scale + row, png(tile)))
        if zoom == stop_zoom or count == 1:
            return tiles, level
        level, zoom = downsample(level), zoom - 1


def build_block(task):
    grid_path, tid_path, z, x, y, max_zoom = task
    values = read_block(grid_path, tid_path, z, x, y, max_zoom)
    valid = int(np.isfinite(values).sum())
    if not valid:
        return z, x, y, [], None, 0, values.size
    tiles, top = pyramid(values, z, x, y, z)
    return z, x, y, tiles, top, valid, values.size


def extract(zip_path, directory):
    """Unpack the GeoTIFF members once; deflated zip members cannot be read at random."""
    directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        names = [name for name in archive.namelist() if name.endswith('.tif')]
        for name in names:
            target = directory / Path(name).name
            if not target.exists() or target.stat().st_size != archive.getinfo(name).file_size:
                archive.extract(name, directory)
                if Path(directory / name) != target:
                    (directory / name).replace(target)
    return sorted(directory / Path(name).name for name in names)


def blocks(bounds, z):
    west, south, east, north = bounds
    n = 2**z
    to_x = lambda lon: min(n - 1, max(0, int((lon + 180) / 360 * n)))
    to_y = lambda lat: min(n - 1, max(0, int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)))
    return [(x, y) for y in range(to_y(north), to_y(south) + 1) for x in range(to_x(west), to_x(east - 1e-9) + 1)]


def build(source, pin, grid_zip, tid_zip, out_dir, *, workers=8, bounds=None, max_zoom=MAX_ZOOM):
    validate_candidate(source, pin)
    if tile_writer.digest(grid_zip) != pin['snapshotSha256'] or tile_writer.digest(tid_zip) != pin['samplesSha256']:
        raise ValueError('GEBCO zips do not match their pins')
    grids = extract(grid_zip, out_dir / 'grid')
    tids = extract(tid_zip, out_dir / 'tid')
    output = out_dir / f"{source['id']}.pmtiles"
    writer = tile_writer.TileWriter(output, {**source, 'maxZoom': max_zoom})
    writer.db.executemany('INSERT INTO metadata VALUES (?,?)', [
        ('topostack_vertical_datum', source['verticalDatum']),
        ('topostack_source_item', pin['item']),
        ('topostack_source_etag', pin['etag']),
    ])
    region = bounds or source['bounds']
    tasks = []
    for x, y in blocks(region, BLOCK_ZOOM):
        west, south, east, north = geo_bounds(BLOCK_ZOOM, x, y)
        grid = covering_member([p.name for p in grids], west, max(south, -90), east, min(north, 90))
        tid = covering_member([p.name for p in tids], west, max(south, -90), east, min(north, 90))
        tasks.append((str(out_dir / 'grid' / grid), str(out_dir / 'tid' / tid), BLOCK_ZOOM, x, y, max_zoom))
    tops = {}
    valid_samples = total_samples = 0
    pool = ProcessPoolExecutor(workers) if workers > 1 else None
    results = pool.map(build_block, tasks, chunksize=1) if pool else map(build_block, tasks)
    try:
        for done, (z, x, y, tiles, top, valid, total) in enumerate(results, 1):
            writer.db.executemany('INSERT INTO tiles VALUES(?,?,?,?)', [(tz, tx, 2**tz - 1 - ty, data) for tz, tx, ty, data in tiles])
            if top is not None:
                tops[(x, y)] = top
            valid_samples += valid
            total_samples += total
            if done % 32 == 0 or done == len(tasks):
                writer.db.commit()
                print(f'{done}/{len(tasks)} blocks', flush=True)
    finally:
        if pool:
            pool.shutdown()
    # The coarse levels come from one mosaic of the block tops.
    n = 2**BLOCK_ZOOM
    mosaic = np.full((n * TILE, n * TILE), np.nan, dtype=np.float32)
    for (x, y), top in tops.items():
        mosaic[y * TILE:(y + 1) * TILE, x * TILE:(x + 1) * TILE] = top
    level = downsample(mosaic)
    for zoom in range(BLOCK_ZOOM - 1, -1, -1):
        count = 2**zoom
        for row in range(count):
            for column in range(count):
                tile = level[row * TILE:(row + 1) * TILE, column * TILE:(column + 1) * TILE]
                if np.isfinite(tile).any():
                    writer.db.execute('INSERT INTO tiles VALUES(?,?,?,?)', (zoom, column, count - 1 - row, png(tile)))
        if zoom:
            level = downsample(level)
    writer.db.commit()
    writer.grids.append({'name': pin['item'], 'bounds': source['bounds'],
                         'tilesWritten': writer.db.execute('SELECT count(*) FROM tiles').fetchone()[0]})

    def complete_receipt(receipt):
        receipt.update(schemaVersion=1, encoding=source['encoding'], verticalDatum=source['verticalDatum'], verticalUnits='metre',
                       coverage={'validSamples': valid_samples, 'totalSamples': total_samples, 'zoom': max_zoom},
                       normalization={'horizontalCrs': 'EPSG:3857', 'resampling': 'bilinear depth, nearest TID; 2x2 mean of valid samples below z9',
                                      'mask': 'TID 0 (land) and depth >= 0 m are transparent', 'rounding': '1 m',
                                      'verticalTransform': 'none; GEBCO metres relative to mean sea level'},
                       tools={'python': platform.python_version(), 'rasterio': rasterio.__version__,
                              'gdal': rasterio.__gdal_version__, 'numpy': np.__version__})
        if bounds is None:
            validate_receipt(source, pin, receipt)

    writer.finish([pin], complete_receipt)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--grid', type=Path, required=True, help='GEBCO ice-surface GeoTIFF zip')
    parser.add_argument('--tid', type=Path, required=True, help='GEBCO TID GeoTIFF zip')
    parser.add_argument('--out-dir', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--bounds', help='west,south,east,north: a trial build of part of the world; never registered')
    parser.add_argument('--register', action='store_true', help='Register the finished archive locally; does not upload')
    args = parser.parse_args()
    bounds = [float(value) for value in args.bounds.split(',')] if args.bounds else None
    if args.register and bounds:
        parser.error('--register needs the whole-world build')
    source, pin = load_registration()
    output = build(source, pin, args.grid, args.tid, args.out_dir, workers=args.workers, bounds=bounds)
    if args.register:
        receipt = json.loads(output.with_suffix('.sources.json').read_text())
        register([{'source': source, 'pin': pin, 'receipt': receipt}], ROOT / 'data/terrain-sources.json', ROOT / 'data/hrdem-sources.json')
    print(json.dumps({'archive': str(output), 'registered': args.register}), flush=True)


if __name__ == '__main__':
    main()
