#!/usr/bin/env python3
"""Build Japan's GSI terrain archives from the GSI elevation tiles (docs/gsi-terrain.md).

  fetch     Walk the 10 m national tiles (dem_png) from z8 to z13 to find land,
            then merge each z15 tile from dem5a, dem5b and dem5c. Throttled,
            resumable and recorded in one SQLite cache: rerun to continue.
  shard     Build one 5 m shard archive (z10-15) from the cache.
  national  Build the 10 m national archive (z8-13) from the cache.

  uv run --no-project --python 3.13 --with-requirements scripts/data-build/requirements.txt \\
    python scripts/data-build/build-gsi-terrain.py fetch --cache .topostack/gsi/cache.sqlite [--shard kanto] [--rate 8]
  ... build-gsi-terrain.py shard --cache .topostack/gsi/cache.sqlite --shard kanto --out-dir .topostack/gsi/kanto-1
  ... build-gsi-terrain.py national --cache .topostack/gsi/cache.sqlite --out-dir .topostack/gsi/national-1

Every archive is a development-only source awaiting GSI's Survey Act approval:
build and inspect it locally; do not provision it until the approval number
is recorded (docs/gsi-terrain.md).
"""
import argparse
import io
import json
import math
from pathlib import Path
import platform

import numpy as np
from PIL import Image
import rasterio

import gsi
import tile_writer
from terrain_release import validate_candidate, validate_receipt

WORLD = tile_writer.WORLD
SHARD_NAMES = {'hokkaido': 'Hokkaidō', 'tohoku': 'Tōhoku', 'kanto': 'Kantō and the Izu islands', 'chubu': 'Chūbu',
               'kinki': 'Kinki', 'chugoku-shikoku': 'Chūgoku and Shikoku', 'kyushu': 'Kyūshū', 'southern-islands': 'the Nansei and Ogasawara islands'}
LICENSE = ('地理院タイル（標高タイル）を加工して作成 — Geospatial Information Authority of Japan (GSI) elevation tiles, '
           'merged, resampled and rounded to 0.1 m by TopoStack; T.P. heights. Survey Act approval pending.')


def within(bounds):
    """A tile filter for a trial area; None keeps everything."""
    if bounds is None:
        return lambda z, x, y: True
    def keep(z, x, y):
        xs, ys = gsi.tile_range(bounds, z)
        return xs.start <= x < xs.stop and ys.start <= y < ys.stop
    return keep


def walk(cache, fetcher, shard=None, log=print, bounds=None):
    """National tiles from z8 down to z13 where land exists, then the z15 tiles under them."""
    xs, ys = gsi.tile_range(gsi.JAPAN, 8)
    keep = within(bounds)
    frontier = [(8, x, y) for y in ys for x in xs if (shard is None or gsi.shard_of(8, x, y) == shard) and keep(8, x, y)]
    for zoom in (8, 11, gsi.NATIONAL_ZOOM):
        found = []
        for z, x, y in frontier:
            if not cache.done(z, x, y, 'national'):
                data, etag = fetcher.get(gsi.NATIONAL, z, x, y)
                values = gsi.decode(data) if data is not None else None
                cache.record(z, x, y, 'national', values, [(gsi.NATIONAL, etag, len(data))] if data is not None else [])
            if cache.heights(z, x, y) is not None:
                found.append((z, x, y))
        cache.commit()
        log(f'z{zoom}: {len(found)} of {len(frontier)} tiles hold land ({fetcher.requests} requests so far)')
        if zoom == gsi.NATIONAL_ZOOM:
            break
        step = {8: 11, 11: gsi.NATIONAL_ZOOM}[zoom]
        frontier = [child for tile in found for child in gsi.children(*tile, step) if keep(*child)]
    fine = 0
    for index, (z, x, y) in enumerate(found, 1):
        national = cache.heights(z, x, y)
        for cz, cx, cy in gsi.children(z, x, y, gsi.FINE_ZOOM):
            if cache.done(cz, cx, cy, 'fine') or not keep(cz, cx, cy):
                continue
            under = gsi.upsample_national(national, z, cx, cy, cz)
            if not np.isfinite(under).any():
                cache.record(cz, cx, cy, 'fine', None, [])
                continue
            merged, used = gsi.merge_five_metre(fetcher.get, cz, cx, cy, under)
            cache.record(cz, cx, cy, 'fine', merged, used)
            fine += 1
        if index % 50 == 0 or index == len(found):
            cache.commit()
            log(f'z15 under {index}/{len(found)} z13 tiles ({fetcher.requests} requests so far)')
    return fine


def png(values):
    buffer = io.BytesIO()
    Image.fromarray(tile_writer.encode(gsi.quantize(values), True)).save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def bounds_of(tiles, z):
    """Lon/lat extent of a set of tiles, the registration bounds of their archive."""
    n = 2**z
    lon = lambda x: x / n * 360 - 180
    lat = lambda y: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    xs, ys = [x for x, _ in tiles], [y for _, y in tiles]
    return [round(lon(min(xs)), 7), round(lat(max(ys) + 1), 7), round(lon(max(xs) + 1), 7), round(lat(min(ys)), 7)]


def pyramid(cache, tiles, top_zoom, bottom_zoom, insert):
    """Write tiles from bottom_zoom (the cached level) up to top_zoom, one top-level group at a time."""
    groups = {}
    for x, y in tiles:
        shift = bottom_zoom - top_zoom
        groups.setdefault((x >> shift, y >> shift), []).append((x, y))
    valid = total = 0
    for (gx, gy), members in sorted(groups.items()):
        scale = 2 ** (bottom_zoom - top_zoom)
        mosaic = np.full((scale * gsi.TILE, scale * gsi.TILE), np.nan, dtype=np.float32)
        for x, y in members:
            row, column = (y - gy * scale) * gsi.TILE, (x - gx * scale) * gsi.TILE
            mosaic[row:row + gsi.TILE, column:column + gsi.TILE] = cache.heights(bottom_zoom, x, y)
        level, zoom = mosaic, bottom_zoom
        valid += int(np.isfinite(mosaic).sum())
        total += len(members) * gsi.TILE * gsi.TILE
        while zoom >= top_zoom:
            count = level.shape[0] // gsi.TILE
            for row in range(count):
                for column in range(count):
                    tile = level[row * gsi.TILE:(row + 1) * gsi.TILE, column * gsi.TILE:(column + 1) * gsi.TILE]
                    if np.isfinite(tile).any():
                        insert(zoom, gx * count + column, gy * count + row, png(tile))
            if zoom == top_zoom:
                break
            level, zoom = gsi.downsample(level), zoom - 1
    return valid, total


def build_archive(cache, source, tiles, top_zoom, bottom_zoom, out_dir):
    snapshot, total_bytes, requests = cache.manifest_digest(bottom_zoom, tiles)
    pin = {'url': gsi.URL, 'item': 'https://maps.gsi.go.jp/development/ichiran.html', 'etag': f'"sha256:{snapshot}"',
           'bytes': total_bytes, 'requests': requests, 'sourceResolutionM': source['nativeResolutionM'],
           'verticalDatum': source['verticalDatum'], 'snapshotSha256': snapshot, 'samplesSha256': cache.samples_digest(bottom_zoom, tiles)}
    validate_candidate(source, pin)
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / f"{source['id']}.pmtiles"
    writer = tile_writer.TileWriter(output, source)
    writer.db.executemany('INSERT INTO metadata VALUES (?,?)', [
        ('topostack_vertical_datum', source['verticalDatum']),
        ('topostack_source_item', pin['item']),
        ('topostack_source_etag', pin['etag']),
    ])
    valid, total = pyramid(cache, tiles, top_zoom, bottom_zoom,
                           lambda z, x, y, data: writer.db.execute('INSERT INTO tiles VALUES(?,?,?,?)', (z, x, 2**z - 1 - y, data)))
    writer.db.commit()
    writer.grids.append({'name': pin['item'], 'bounds': source['bounds'], 'tilesWritten': writer.db.execute('SELECT count(*) FROM tiles').fetchone()[0]})

    def complete_receipt(receipt):
        receipt.update(schemaVersion=1, encoding=source['encoding'], verticalDatum=source['verticalDatum'], verticalUnits='metre',
                       coverage={'validSamples': valid, 'totalSamples': total},
                       normalization={'horizontalCrs': 'EPSG:3857 (GSI tiles are Web Mercator already)',
                                      'merge': 'dem5a, then dem5b, then dem5c per pixel' if bottom_zoom == gsi.FINE_ZOOM else 'dem_png (DEM10B)',
                                      'resampling': '2x2 mean of valid samples below the native zoom', 'rounding': '0.1 m',
                                      'verticalTransform': 'none; GSI T.P. heights'},
                       tools={'python': platform.python_version(), 'rasterio': rasterio.__version__, 'numpy': np.__version__})
        validate_receipt(source, pin, receipt)

    writer.finish([pin], complete_receipt)
    return output


def source_for(kind, tiles, zoom, shard=None):
    common = {'url': 'https://maps.gsi.go.jp/development/ichiran.html', 'license': LICENSE, 'bounds': bounds_of(tiles, zoom),
              'encoding': 'elevation-terrarium-v1', 'verticalDatum': 'JP-TP', 'kind': 'national-dtm',
              'availability': 'development', 'approval': {'required': True}}
    if kind == 'shard':
        return {**common, 'id': f'gsi-dem5-{shard}-v1', 'name': f'GSI DEM 5 m ({SHARD_NAMES[shard]})', 'minZoom': 10, 'maxZoom': 15,
                'priority': 250, 'nativeResolutionM': 5}
    return {**common, 'id': 'gsi-dem10-japan-v1', 'name': 'GSI DEM 10 m (Japan)', 'minZoom': 8, 'maxZoom': 13,
            'priority': 200, 'nativeResolutionM': 10}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['fetch', 'shard', 'national'])
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--shard', choices=gsi.SHARDS)
    parser.add_argument('--rate', type=float, default=8.0, help='GSI requests per second (at most 10)')
    parser.add_argument('--out-dir', type=Path)
    parser.add_argument('--bounds', help='west,south,east,north: fetch only a trial area')
    args = parser.parse_args()
    if args.rate > 10:
        parser.error('Keep GSI requests at 10 a second or fewer')
    args.cache.parent.mkdir(parents=True, exist_ok=True)
    cache = gsi.Cache(args.cache)
    try:
        if args.command == 'fetch':
            walk(cache, gsi.Fetcher(args.rate), args.shard, bounds=[float(v) for v in args.bounds.split(',')] if args.bounds else None)
            return
        if not args.out_dir:
            parser.error('--out-dir is required to build')
        if args.command == 'shard':
            if not args.shard:
                parser.error('shard needs --shard')
            tiles = [(x, y) for x, y in cache.tiles(gsi.FINE_ZOOM) if gsi.shard_of(gsi.FINE_ZOOM, x, y) == args.shard]
            source = source_for('shard', tiles, gsi.FINE_ZOOM, args.shard)
            output = build_archive(cache, source, tiles, 10, gsi.FINE_ZOOM, args.out_dir)
        else:
            tiles = cache.tiles(gsi.NATIONAL_ZOOM)
            source = source_for('national', tiles, gsi.NATIONAL_ZOOM)
            output = build_archive(cache, source, tiles, 8, gsi.NATIONAL_ZOOM, args.out_dir)
        (args.out_dir / 'source.json').write_text(json.dumps(source, indent=2, ensure_ascii=False) + '\n')
        print(json.dumps({'archive': str(output), 'source': source['id']}), flush=True)
    finally:
        cache.close()


if __name__ == '__main__':
    main()
