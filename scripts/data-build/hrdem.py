"""Read a registered region of an NRCan bare-earth COG and package it as a terrain archive.

Only the registered region is read through HTTP ranges; never the entire
multi-GB project. build-hrdem-terrain.py is the command line; discover-terrain.py
and benchmark-terrain.py reuse these steps. See docs/hrdem-terrain.md.
"""
import hashlib
import math
import platform
import urllib.request

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.warp import Resampling, transform_bounds

import tile_writer
from terrain_release import validate_candidate, validate_receipt, same_bounds


class NoCoverageError(ValueError):
    pass


def check_remote(pin):
    request = urllib.request.Request(pin['url'], method='HEAD')
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.headers.get('ETag') != pin['etag'] or int(response.headers.get('Content-Length', 0)) != pin['bytes']:
            raise ValueError('HRDEM asset changed; review its source identity before updating pins.')


def snapshot(source, pin, target):
    check_remote(pin)
    left, bottom, right, top = transform_bounds('EPSG:4326', 'EPSG:3857', *source['bounds'])
    # Keep enough source resolution for the finest supported output tile; an
    # additional nominal 1m raster would only be resampled down to these pixels.
    resolution = 2 * tile_writer.WORLD / (256 * 2**source['maxZoom'])
    width, height = math.ceil((right-left)/resolution), math.ceil((top-bottom)/resolution)
    if width * height > 100_000_000:
        raise ValueError('Region exceeds the 100-million-sample build limit; register smaller regions.')
    transform = from_bounds(left, bottom, right, top, width, height)
    # Never permit directory scans or sidecar downloads for a remote COG.
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
                      GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='2', GDAL_HTTP_RETRY_DELAY='1'):
        with rasterio.open(pin['url']) as src:
            if src.count != 1 or not src.crs:
                raise ValueError('Expected a georeferenced single-band DTM')
            with WarpedVRT(src, crs='EPSG:3857', transform=transform, width=width, height=height,
                           dtype='float32', nodata=np.nan, resampling=Resampling.bilinear) as vrt:
                values = vrt.read(1, masked=True).filled(np.nan)
    check_remote(pin)
    valid = np.isfinite(values)
    if not valid.any():
        raise NoCoverageError('No valid terrain coverage in the selected region')
    if np.any(valid & ((values < -500) | (values > 9000))):
        raise ValueError('Missing or invalid terrain elevations in the selected region')
    tile_writer.write_grid(target, values, transform, 'EPSG:3857')
    return hashlib.sha256(values.astype('<f4').tobytes()).hexdigest()


def build(source, pin, snapshot_path, output):
    validate_candidate(source, pin)
    with rasterio.open(snapshot_path) as raster:
        bounds = list(transform_bounds(raster.crs, 'EPSG:4326', *raster.bounds))
        if not same_bounds(bounds, source['bounds']):
            raise ValueError('Snapshot extent does not match registration')
        values = raster.read(1)
        valid = np.isfinite(values)
        if not valid.any() or np.any(valid & ((values < -500) | (values > 9000))):
            raise ValueError('Invalid terrain snapshot elevations')
        coverage = {'validSamples': int(valid.sum()), 'totalSamples': int(values.size),
                    'minElevationM': float(values[valid].min()), 'maxElevationM': float(values[valid].max())}
        if tile_writer.digest(snapshot_path) != pin.get('snapshotSha256') or hashlib.sha256(values.astype('<f4').tobytes()).hexdigest() != pin.get('samplesSha256'):
            raise ValueError('Snapshot hashes do not match build pin')
    writer = tile_writer.TileWriter(output, source)
    writer.db.executemany('INSERT INTO metadata VALUES (?,?)', [
        ('topostack_vertical_datum', source['verticalDatum']),
        ('topostack_source_item', pin['item']),
        ('topostack_source_etag', pin['etag']),
    ])
    writer.add(snapshot_path, pin['item'])
    def complete_receipt(receipt):
        receipt.update(schemaVersion=1, encoding=source['encoding'], verticalDatum=source['verticalDatum'],
                       verticalUnits='metre', coverage=coverage,
                       normalization={'horizontalCrs': 'EPSG:3857', 'resampling': 'bilinear',
                                      'verticalTransform': 'none; pinned provider CGVD2013 metres'},
                       tools={'python': platform.python_version(), 'rasterio': rasterio.__version__,
                              'gdal': rasterio.__gdal_version__, 'numpy': np.__version__})
        validate_receipt(source, pin, receipt)

    # The receipt is enriched and validated before its single atomic write, so a
    # validation failure never leaves a schema-less receipt beside the archive.
    writer.finish([pin], complete_receipt)
