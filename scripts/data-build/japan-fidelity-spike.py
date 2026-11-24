#!/usr/bin/env python3
# /// script
# requires-python = ">=3.13"
# dependencies = ["numpy==2.5.4", "Pillow==13.0.0", "rasterio==1.5.2"]
# ///
"""Feasibility measurements for Japan terrain and global ocean depth.

Reproduces docs/reports/japan-fidelity-spike-2026-11.md.

  terrain  Fetch z15 tile windows from GSI (dem5a/5b/5c, dem1a coverage) and
           Mapzen Terrarium at three mountain sites, then compare them.
  ocean    Read GEBCO_2026 windows by HTTP range from the CEDA zip, compare
           with Mapzen at z9 and z11, and measure ocean-only z9 tile sizes.
  extent   Count the z0-9 tiles that hold any GEBCO ocean pixel worldwide,
           from the GEBCO_2026 TID grid (downloaded whole, 96 MB).

Usage (uv reads the dependencies above):
  uv run --python 3.13 scripts/data-build/japan-fidelity-spike.py terrain --cache .topostack/japan/spike
  uv run --python 3.13 scripts/data-build/japan-fidelity-spike.py ocean --cache .topostack/japan/spike
  uv run --python 3.13 scripts/data-build/japan-fidelity-spike.py extent --cache .topostack/japan/spike

GSI requests are throttled to five a second and cached; reruns read the cache.
"""
import argparse
import io
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.request
import zipfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from rasterio.windows import from_bounds as window_from_bounds

GSI = 'https://cyberjapandata.gsi.go.jp/xyz/{product}/{z}/{x}/{y}.png'
MAPZEN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
GEBCO_ZIP = 'https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026/ice_surface_elevation/geotiff/gebco_2026_geotiff.zip?download=1'
GEBCO_TID_ZIP = 'https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026/type_identifier_grid/geotiff/gebco_2026_tid_geotiff.zip?download=1'
AGENT = 'TopoStack data spike'
WORLD = 20037508.342789244
SITES = {
    'fuji': (35.3606, 138.7274),
    'hakone': (35.2330, 139.0220),
    'kamikochi': (36.2890, 137.6480),
}
OCEAN_BOXES = {
    'suruga-bay': (138.30, 34.55, 138.95, 35.15),
    'japan-trench': (142.40, 37.40, 144.80, 39.60),
    'sagami-bay': (139.05, 34.85, 139.75, 35.35),
}
JAPAN_BOX = (122.0, 20.0, 154.0, 46.0)
_last_gsi = [0.0]
# CEDA's TLS handshakes sometimes take close to a minute.
TIMEOUT = 240


def open_url(request, attempts=4):
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(request, timeout=TIMEOUT)
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))


def fetch(url, cache, throttle=0.0):
    path = cache / url.split('//', 1)[1].replace('?', '_')
    if path.exists():
        return path.read_bytes() or None
    if throttle:
        wait = _last_gsi[0] + throttle - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_gsi[0] = time.monotonic()
    try:
        with open_url(urllib.request.Request(url, headers={'User-Agent': AGENT})) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        data = b''
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data or None


def decode_gsi(data):
    """GSI elevation PNG: x = R*2^16 + G*2^8 + B; 2^23 is no data; above it is negative."""
    if data is None:
        return np.full((256, 256), np.nan)
    rgb = np.array(Image.open(io.BytesIO(data)).convert('RGB')).astype(np.int64)
    x = rgb[..., 0] * 65536 + rgb[..., 1] * 256 + rgb[..., 2]
    h = np.where(x < 2**23, x, x - 2**24) * 0.01
    return np.where(x == 2**23, np.nan, h)


def decode_terrarium(data):
    rgba = np.array(Image.open(io.BytesIO(data)).convert('RGBA')).astype(np.float64)
    return rgba[..., 0] * 256 + rgba[..., 1] + rgba[..., 2] / 256 - 32768


def encode_terrarium(values, step):
    valid = np.isfinite(values)
    rounded = np.round(np.where(valid, values, 0) / step) * step
    code = np.rint((rounded + 32768) * 256).astype(np.uint32)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3] = code >> 16, (code >> 8) & 255, code & 255, valid * 255
    buffer = io.BytesIO()
    Image.fromarray(rgba).save(buffer, format='PNG', optimize=True)
    return len(buffer.getvalue())


def tile_xy(lat, lon, z):
    n = 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return int(x), int(y)


def mosaic(tiles, size, decoder):
    rows = []
    for row in tiles:
        rows.append(np.hstack([decoder(t) if not isinstance(t, np.ndarray) else t for t in row]))
    return np.vstack(rows)


def laplacian_std(grid):
    lap = grid[1:-1, 2:] + grid[1:-1, :-2] + grid[2:, 1:-1] + grid[:-2, 1:-1] - 4 * grid[1:-1, 1:-1]
    return float(np.nanstd(lap))


def contour_crossings(grid, interval):
    """Pixel edges that cross a contour level; a proxy for engraved line length."""
    band = np.floor(grid / interval)
    horizontal = np.abs(np.diff(band, axis=1))
    vertical = np.abs(np.diff(band, axis=0))
    return float(np.nansum(horizontal) + np.nansum(vertical))


def stats(diff):
    d = diff[np.isfinite(diff)]
    return {'bias_m': round(float(d.mean()), 2), 'rmse_m': round(float(np.sqrt((d**2).mean())), 2),
            'p95_abs_m': round(float(np.percentile(np.abs(d), 95)), 2), 'max_abs_m': round(float(np.abs(d).max()), 1)}


def terrain(args):
    cache, z, half = Path(args.cache), 15, args.half
    report = {}
    for site, (lat, lon) in SITES.items():
        cx, cy = tile_xy(lat, lon, z)
        xs, ys = range(cx - half, cx + half), range(cy - half, cy + half)
        products = {}
        for product in ('dem1a_png', 'dem5a_png', 'dem5b_png', 'dem5c_png'):
            products[product] = [[decode_gsi(fetch(GSI.format(product=product, z=z, x=x, y=y), cache, 0.2)) for x in xs] for y in ys]
        mapzen = [[fetch(MAPZEN.format(z=z, x=x, y=y), cache) for x in xs] for y in ys]
        grids = {p: mosaic(t, 256, None) for p, t in products.items()}
        merged = np.full_like(grids['dem5a_png'], np.nan)
        for product in ('dem5a_png', 'dem5b_png', 'dem5c_png'):
            merged = np.where(np.isnan(merged), grids[product], merged)
        mz = mosaic(mapzen, 256, decode_terrarium)
        coverage = {p: round(float(np.isfinite(g).mean()), 4) for p, g in grids.items()}
        coverage['merged_5m'] = round(float(np.isfinite(merged).mean()), 4)
        both = np.isfinite(merged)
        mz_masked = np.where(both, mz, np.nan)
        sizes_full, sizes_dm = [], []
        for ty in range(len(ys)):
            for tx in range(len(xs)):
                tile = merged[ty*256:(ty+1)*256, tx*256:(tx+1)*256]
                if np.isfinite(tile).any():
                    sizes_full.append(encode_terrarium(tile, 1 / 256))
                    sizes_dm.append(encode_terrarium(tile, 0.1))
        mapzen_bytes = [len(t) for row in mapzen for t in row if t]
        report[site] = {
            'center': [lat, lon], 'tiles': len(xs) * len(ys), 'coverage': coverage,
            'gsi_minus_mapzen': stats(merged - mz),
            'relief_m': {'gsi': round(float(np.nanmax(merged) - np.nanmin(merged)), 1), 'mapzen': round(float(np.nanmax(mz_masked) - np.nanmin(mz_masked)), 1)},
            'summit_m': {'gsi': round(float(np.nanmax(merged)), 1), 'mapzen': round(float(np.nanmax(mz_masked)), 1)},
            'laplacian_std': {'gsi': round(laplacian_std(merged), 3), 'mapzen': round(laplacian_std(mz_masked), 3)},
            'contour_crossings_10m': {'gsi': contour_crossings(merged, 10), 'mapzen': contour_crossings(mz_masked, 10)},
            'tile_bytes_mean': {'gsi_full_precision': int(np.mean(sizes_full)), 'gsi_0_1m': int(np.mean(sizes_dm)), 'mapzen': int(np.mean(mapzen_bytes))},
        }
        print(site, json.dumps(report[site], ensure_ascii=False))
    write(args, 'terrain.json', report)


class HttpRange(io.RawIOBase):
    """Seekable read-only file over HTTP range requests, for zipfile and GDAL-free listing."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        with open_url(urllib.request.Request(url, method='HEAD', headers={'User-Agent': AGENT})) as r:
            self.size = int(r.headers['Content-Length'])

    def seekable(self):
        return True

    def readable(self):
        return True

    def seek(self, offset, whence=0):
        self.pos = {0: offset, 1: self.pos + offset, 2: self.size + offset}[whence]
        return self.pos

    def tell(self):
        return self.pos

    def readinto(self, buffer):
        if self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(buffer)) - 1
        request = urllib.request.Request(self.url, headers={'User-Agent': AGENT, 'Range': f'bytes={self.pos}-{end}'})
        with open_url(request) as r:
            data = r.read()
        buffer[:len(data)] = data
        self.pos += len(data)
        return len(data)


def gebco_member(name_hint):
    with zipfile.ZipFile(io.BufferedReader(HttpRange(GEBCO_ZIP), buffer_size=1 << 16)) as archive:
        names = [info.filename for info in archive.infolist()]
        infos = {info.filename: info for info in archive.infolist()}
    tif = [n for n in names if n.endswith('.tif') and name_hint in n]
    if not tif:
        raise SystemExit(f'No GEBCO member matching {name_hint}: {names}')
    return tif[0], infos[tif[0]].compress_type, names


def read_gebco(box, member, local=None):
    # A local copy is the extracted GeoTIFF: deflated zip members cannot be read at random.
    path = str(local) if local else f'/vsizip//vsicurl/{GEBCO_ZIP}/{member}'
    with rasterio.Env(GDAL_HTTP_USERAGENT=AGENT, GDAL_HTTP_TIMEOUT=str(TIMEOUT), GDAL_HTTP_CONNECTTIMEOUT=str(TIMEOUT), GDAL_HTTP_MAX_RETRY='5', GDAL_HTTP_RETRY_DELAY='5', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.zip,.tif', GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR'):
        with rasterio.open(path) as src:
            window = window_from_bounds(*box, transform=src.transform).round_offsets().round_lengths()
            values = src.read(1, window=window).astype(np.float32)
            return values, src.window_transform(window), src.crs


def to_tiles(values, transform, crs, z, box):
    x0, y0 = tile_xy(box[3], box[0], z)
    x1, y1 = tile_xy(box[1], box[2], z)
    out = {}
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            span = 2 * WORLD / 2**z
            dst = np.full((256, 256), np.nan, dtype=np.float32)
            reproject(values, dst, src_transform=transform, src_crs=crs, src_nodata=None,
                      dst_transform=from_bounds(x*span-WORLD, WORLD-(y+1)*span, (x+1)*span-WORLD, WORLD-y*span, 256, 256),
                      dst_crs='EPSG:3857', dst_nodata=np.nan, resampling=Resampling.bilinear)
            out[(x, y)] = dst
    return out


def ocean(args):
    cache = Path(args.cache)
    if args.grid_zip:
        with zipfile.ZipFile(args.grid_zip) as archive:
            names = archive.namelist()
            member = next(n for n in names if 'n90.0_s0.0_w90.0_e180.0' in n and n.endswith('.tif'))
            compression = archive.getinfo(member).compress_type
            local = cache / Path(member).name
            if not local.exists():
                archive.extract(member, cache)
    else:
        member, compression, names = gebco_member('n90.0_s0.0_w90.0_e180.0')
        local = None
    report = {'gebco_member': member, 'zip_compression': compression, 'zip_members': names, 'boxes': {}}
    for name, box in OCEAN_BOXES.items():
        values, transform, crs = read_gebco(box, member, local)
        entry = {}
        for z in (9, 11):
            gebco_tiles = to_tiles(values, transform, crs, z, box)
            keys = sorted(gebco_tiles)
            xs = sorted({k[0] for k in keys})
            ys = sorted({k[1] for k in keys})
            g = np.vstack([np.hstack([gebco_tiles[(x, y)] for x in xs]) for y in ys])
            m = np.vstack([np.hstack([decode_terrarium(fetch(MAPZEN.format(z=z, x=x, y=y), cache)) for x in xs]) for y in ys])
            sea = (g < 0) & (m < 0)
            near = sea & (m > -50)
            entry[f'z{z}'] = {
                'tiles': len(keys),
                'gebco_minus_mapzen_sea': stats(np.where(sea, g - m, np.nan)),
                'gebco_minus_mapzen_shallow_0_50m': stats(np.where(near, g - m, np.nan)) if near.any() else None,
                'deepest_m': {'gebco': round(float(np.nanmin(g)), 1), 'mapzen': round(float(np.nanmin(m)), 1)},
                'laplacian_std_sea': {'gebco': round(laplacian_std(np.where(sea, g, np.nan)), 3), 'mapzen': round(laplacian_std(np.where(sea, m, np.nan)), 3)},
                'contour_crossings_100m_sea': {'gebco': contour_crossings(np.where(sea, g, np.nan), 100), 'mapzen': contour_crossings(np.where(sea, m, np.nan), 100)},
                'coast_disagreement_fraction': round(float(((g < 0) != (m < 0)).mean()), 4),
            }
        report['boxes'][name] = entry
        print(name, json.dumps(entry))
    # Ocean-only z9 tile sizes across the Japan box, to extrapolate the global archive.
    values, transform, crs = read_gebco(JAPAN_BOX, member, local)
    sizes = {'1m': [], 'full': []}
    for tile in to_tiles(values, transform, crs, 9, JAPAN_BOX).values():
        masked = np.where(tile < 0, tile, np.nan)
        if np.isfinite(masked).any():
            sizes['1m'].append(encode_terrarium(masked, 1.0))
            sizes['full'].append(encode_terrarium(masked, 1 / 256))
    report['japan_box_z9'] = {'ocean_tiles': len(sizes['1m']), 'mean_bytes_1m': int(np.mean(sizes['1m'])), 'mean_bytes_full': int(np.mean(sizes['full']))}
    print(json.dumps(report['japan_box_z9']))
    write(args, 'ocean.json', report)


def extent(args):
    cache = Path(args.cache)
    zip_path = cache / 'gebco_2026_tid_geotiff.zip'
    if not zip_path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        with open_url(urllib.request.Request(GEBCO_TID_ZIP, headers={'User-Agent': AGENT})) as r:
            zip_path.write_bytes(r.read())
    z = 9
    n = 2**z
    occupied = np.zeros((n, n), dtype=bool)
    with zipfile.ZipFile(zip_path) as archive:
        members = [m for m in archive.namelist() if m.endswith('.tif')]
    for member in members:
        with rasterio.open(f'/vsizip/{zip_path}/{member}') as src:
            # 1/8 decimation (2 arc-min) is finer than a z9 tile everywhere.
            tid = src.read(1, out_shape=(src.height // 8, src.width // 8), resampling=Resampling.nearest)
            rows, cols = np.nonzero(tid != 0)
            lon = src.bounds.left + (cols + 0.5) * (src.bounds.right - src.bounds.left) / tid.shape[1]
            lat = src.bounds.top - (rows + 0.5) * (src.bounds.top - src.bounds.bottom) / tid.shape[0]
            keep = np.abs(lat) < 85.0511
            lon, lat = lon[keep], lat[keep]
            x = np.clip(((lon + 180) / 360 * n).astype(int), 0, n - 1)
            y = np.clip(((1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n).astype(int), 0, n - 1)
            occupied[y, x] = True
    counts = {}
    level = occupied
    for zoom in range(z, -1, -1):
        counts[zoom] = int(level.sum())
        if zoom:
            level = level.reshape(level.shape[0] // 2, 2, level.shape[1] // 2, 2).any(axis=(1, 3))
    report = {'tid_members': members, 'ocean_tiles_by_zoom': counts, 'total_z0_9': sum(counts.values())}
    print(json.dumps(report))
    write(args, 'extent.json', report)


def write(args, name, report):
    path = Path(args.cache) / name
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print('wrote', path)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['terrain', 'ocean', 'extent'])
    parser.add_argument('--cache', default='.topostack/japan/spike')
    parser.add_argument('--half', type=int, default=3, help='terrain window half-width in z15 tiles')
    parser.add_argument('--grid-zip', type=Path, help='a local GEBCO_2026 GeoTIFF zip instead of HTTP range reads')
    args = parser.parse_args()
    {'terrain': terrain, 'ocean': ocean, 'extent': extent}[args.command](args)


if __name__ == '__main__':
    main()
