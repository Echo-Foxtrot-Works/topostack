#!/usr/bin/env python3
"""Bounded MRDEM packaging experiment; never registers, uploads or promotes data."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import platform
import resource
import sqlite3
import subprocess
import sys
import time
import urllib.request

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling

import hrdem
import tile_writer

REGIONS = {
    'ontario': [-79.0, 46.44, -78.94, 46.50],
    'rockies': [-115.60, 51.16, -115.54, 51.22],
    'coast': [-123.20, 49.25, -123.14, 49.31],
    'north': [-68.55, 63.72, -68.49, 63.78],
}
ITEM = 'https://datacube.services.geo.ca/stac/api/collections/mrdem-30/items/mrdem'


def worker(config_path):
    config = json.loads(config_path.read_text())
    source, pin = config['source'], config['pin']
    root = config_path.parent
    snapshot, output = root / 'snapshot.tif', root / 'archive.pmtiles'
    started = time.monotonic()
    samples = hrdem.snapshot(source, pin, snapshot)
    read_seconds = time.monotonic() - started
    pin = {**pin, 'snapshotSha256': tile_writer.digest(snapshot), 'samplesSha256': samples}
    build_start = time.monotonic()
    hrdem.build(source, pin, snapshot, output)
    build_seconds = time.monotonic() - build_start
    receipt = json.loads(output.with_suffix('.sources.json').read_text())
    with sqlite3.connect(root / 'archive.mbtiles') as db:
        png_bytes = db.execute('SELECT sum(length(tile_data)) FROM tiles').fetchone()[0]
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result = {'source': source, 'receipt': receipt, 'readSeconds': read_seconds,
              'buildAndVerifySeconds': build_seconds, 'totalSeconds': time.monotonic()-started,
              'processPeakRssBytes': int(rss if sys.platform == 'darwin' else rss*1024),
              'retainedScratchBytes': sum(p.stat().st_size for p in root.iterdir() if p.is_file()),
              'pngBytes': png_bytes, 'pngBytesPerTile': png_bytes/receipt['tiles'],
              'tilesPerBuildSecond': receipt['tiles']/build_seconds,
              'sourceBytesRead': None, 'retryCount': None}
    (root / 'metrics.json').write_text(json.dumps(result, indent=2)+'\n')


def decoded_mosaic(root, zoom):
    with sqlite3.connect(root / 'archive.mbtiles') as db:
        rows = db.execute('SELECT tile_column,tile_row,tile_data FROM tiles WHERE zoom_level=?', (zoom,)).fetchall()
    tiles = [(x, 2**zoom-1-y, data) for x,y,data in rows]
    left, right = min(t[0] for t in tiles), max(t[0] for t in tiles)+1
    top, bottom = min(t[1] for t in tiles), max(t[1] for t in tiles)+1
    values = np.full(((bottom-top)*256, (right-left)*256), np.nan, dtype=np.float32)
    for x,y,data in tiles:
        rgba = np.array(Image.open(io.BytesIO(data)))
        decoded = rgba[:,:,0].astype(np.float32)*256 + rgba[:,:,1] + rgba[:,:,2]/256 - 32768
        decoded[rgba[:,:,3] == 0] = np.nan
        values[(y-top)*256:(y-top+1)*256,(x-left)*256:(x-left+1)*256] = decoded
    span = 2*tile_writer.WORLD/2**zoom
    transform = from_bounds(left*span-tile_writer.WORLD, tile_writer.WORLD-bottom*span,
                            right*span-tile_writer.WORLD, tile_writer.WORLD-top*span,
                            values.shape[1], values.shape[0])
    return values, transform


def comparison(root, reference):
    # Compare actual encoded archive tiles, numerically decoded, on the same
    # z15 snapshot grid. This is not the app's as-yet-unimplemented overzoom path.
    with rasterio.open(reference / 'snapshot.tif') as ref:
        expected = ref.read(1)
        zoom = json.loads((root / 'config.json').read_text())['source']['maxZoom']
        values, transform = decoded_mosaic(root, zoom)
        actual = np.full(expected.shape, np.nan, dtype=np.float32)
        reproject(values, actual, src_transform=transform, src_crs='EPSG:3857', src_nodata=np.nan,
                  dst_transform=ref.transform, dst_crs=ref.crs, dst_nodata=np.nan, resampling=Resampling.bilinear)
    valid_ref, valid_out = np.isfinite(expected), np.isfinite(actual)
    common = valid_ref & valid_out
    error = np.abs(actual[common]-expected[common])
    interior = common.copy()
    interior[:32, :] = interior[-32:, :] = False
    interior[:, :32] = interior[:, -32:] = False
    interior_error = np.abs(actual[interior]-expected[interior])
    return {'interiorComparedSamples': int(interior.sum()),
            'interiorP95AbsoluteErrorM': float(np.quantile(interior_error, .95)) if interior_error.size else None,
            'interiorMaxAbsoluteErrorM': float(interior_error.max()) if interior_error.size else None,
            'comparedSamples': int(common.sum()), 'missingReferenceSamples': int((valid_ref & ~valid_out).sum()),
            'filledNoDataSamples': int((~valid_ref & valid_out).sum()),
            'meanAbsoluteErrorM': float(error.mean()), 'p95AbsoluteErrorM': float(np.quantile(error, .95)),
            'maxAbsoluteErrorM': float(error.max()),
            'contourBandDisagreement': {str(interval): float(np.mean(np.floor(actual[common]/interval) != np.floor(expected[common]/interval))) for interval in (5,10,20)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir', type=Path)
    parser.add_argument('--worker', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        worker(args.worker)
        return
    if not args.out_dir:
        parser.error('--out-dir required')
    args.out_dir.mkdir(parents=True, exist_ok=False)
    with urllib.request.urlopen(ITEM, timeout=30) as response:
        item = json.load(response)
    url = item['assets']['dtm']['href']
    if url != 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif':
        raise ValueError('Unexpected MRDEM DTM asset; review before reading')
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30) as response:
        pin = {'item': ITEM, 'url': url, 'etag': response.headers['ETag'], 'bytes': int(response.headers['Content-Length']),
               'sourceResolutionM': 30, 'verticalDatum': 'CGVD2013', 'published': item['properties'].get('datetime')}
    (args.out_dir / 'stac-item.json').write_text(json.dumps(item, indent=2)+'\n')
    results = []
    for name, bounds in REGIONS.items():
        for zoom in (12,13,15):
            root = args.out_dir / f'{name}-z{zoom}'
            root.mkdir()
            identity = hashlib.sha256(json.dumps([bounds, pin, zoom], sort_keys=True).encode()).hexdigest()[:12]
            source = {'id': f'nrcan-mrdem-benchmark-{identity}-v1', 'name': f'MRDEM benchmark {name} z{zoom}',
                      'url': ITEM, 'license': 'Open Government Licence – Canada; NRCan MRDEM DTM, CGVD2013 metres.',
                      'bounds': bounds, 'encoding': 'elevation-terrarium-v1', 'minZoom': 10, 'maxZoom': zoom,
                      'verticalDatum': 'CGVD2013', 'kind': 'national-dtm', 'nativeResolutionM': 30, 'priority': 200}
            config = root / 'config.json'
            config.write_text(json.dumps({'source': source, 'pin': pin}, indent=2)+'\n')
            print(f'Benchmark {name} zoom {zoom}', flush=True)
            subprocess.run([sys.executable, __file__, '--worker', str(config)], check=True)
        for zoom in (12,13,15):
            root = args.out_dir / f'{name}-z{zoom}'
            metrics = json.loads((root / 'metrics.json').read_text())
            metrics.update(region=name, comparisonToZ15Snapshot=comparison(root, args.out_dir / f'{name}-z15'))
            results.append(metrics)
        (args.out_dir / 'benchmark.json').write_text(json.dumps({'schemaVersion': 1, 'host': platform.platform(),
            'sourcePin': pin, 'results': results, 'limitations': [
                'Small bounded chunks, not a national throughput or compression forecast.',
                'RSS is the Python worker peak, excluding pmtiles subprocesses.',
                'Scratch is retained files, not sampled peak disk use.',
                'GDAL transfer bytes and retry counts are not instrumented.',
                'Contour band disagreement is a numeric proxy, not geometric contour validation.',
                'Reference is z15 resampled MRDEM, not independent surveyed truth.']}, indent=2)+'\n')


if __name__ == '__main__':
    main()
