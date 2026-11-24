"""GSI lake surveys (湖沼データ): pinning and the survey-bathymetry builder branch.

Each GSI lake ZIP carries a 10 m depth grid (水深グリッド, `*_ras.tif`) in a
JGD2011 plane rectangular zone: positive depths in metres below the surveyed
water level, -9999 where there is no water. Member names are Shift_JIS.

  pin    Read GSI's lake data list, download every ZIP once (politely, into the
         cache) and write scripts/data/gsi-lake-sources.json: the unregistered
         candidate source and one SHA-256 pin per lake.
  build  `build-survey-bathymetry.py --dataset gsi-lakes-japan-v1` calls gsi().

The data is a basic survey result: copying it needs the same Survey Act
approval as the GSI terrain (docs/gsi-terrain.md), so the source stays
unregistered and development-only until the approval number is recorded.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import ssl
import time
import urllib.parse
import urllib.request
import zipfile

import numpy as np
import rasterio
from rasterio.warp import transform_bounds

from pinned import file_sha256

ROOT = Path(__file__).parent.parent
LIST_URL = 'https://www.gsi.go.jp/kankyochiri/lakedatalist.html'
ZIP_LINK = re.compile(r'https://www1\.gsi\.go\.jp/geowww/lake/download/([^/"]+)/([^/"]+?)-(\d{4})\.zip')
SOURCE = {
    'id': 'gsi-lakes-japan-v1',
    'name': 'GSI lake surveys (湖沼データ)',
    'url': 'https://www.gsi.go.jp/kankyochiri/lakedata.html',
    'license': ('国土地理院 湖沼データを加工して作成 — Geospatial Information Authority of Japan lake survey depth grids '
                '(10 m), resampled to Web Mercator by TopoStack; depths below the surveyed water level. Survey Act approval pending.'),
    'encoding': 'depth-terrarium-v1',
    'maxZoom': 14,
    'availability': 'development',
    'approval': {'required': True},
}
CANDIDATE = ROOT / 'data/gsi-lake-sources.json'


def gsi_context():
    """GSI's servers still need TLS legacy renegotiation, which OpenSSL 3
    refuses by default; only GSI requests allow it. Certificates are still
    verified."""
    context = ssl.create_default_context()
    context.options |= getattr(ssl, 'OP_LEGACY_SERVER_CONNECT', 0x4)
    return context


def fetch(url, path, attempts=3):
    """Download one GSI ZIP through a .part file."""
    context = gsi_context()
    partial = path.with_name(path.name + '.part')
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'TopoStack data build'})
            with urllib.request.urlopen(request, timeout=600, context=context) as response, partial.open('wb') as out:
                shutil.copyfileobj(response, out)
            partial.replace(path)
            return path
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(10 * (attempt + 1))


def grid_members(archive):
    """Depth grid members; a ZIP covering paired lakes (Izunuma and Uchinuma) holds one per lake."""
    names = sorted(info.filename for info in archive.infolist() if info.filename.endswith('_ras.tif'))
    if not names:
        raise ValueError('No GSI depth grid')
    return names


def open_zip(path):
    return zipfile.ZipFile(path, metadata_encoding='cp932')


def read_depths(path):
    """Each grid's depths in metres with NaN off the water, with its transform and CRS: [(name, values, transform, crs)]."""
    grids = []
    with open_zip(path) as archive:
        for member in grid_members(archive):
            with rasterio.MemoryFile(archive.read(member)) as memory, memory.open() as src:
                if src.count != 1 or abs(src.res[0] - 10) > 1e-6 or not src.crs:
                    raise ValueError('Unexpected GSI depth grid')
                values = src.read(1).astype(np.float32)
                nodata = src.nodata if src.nodata is not None else -9999
                values = np.where((values == nodata) | ~np.isfinite(values) | (values < 0) | (values > 1500), np.nan, values)
                grids.append((Path(member).name.removesuffix('_ras.tif'), values, src.transform, src.crs))
    return grids


def pin_lake(url, lake, year, cache):
    path = cache / 'gsi' / f'{lake}-{year}.zip'
    if not path.exists():
        fetch(url, path)
        time.sleep(1)  # one ZIP at a time, a second apart
    grids = []
    for name, values, transform, crs in read_depths(path):
        rows, columns = values.shape
        bounds = transform_bounds(crs, 'EPSG:4326', *rasterio.transform.array_bounds(rows, columns, transform))
        grids.append({'name': name, 'bbox': [round(v, 7) for v in bounds], 'crs': crs.to_string(), 'maxDepthM': round(float(np.nanmax(values)), 2)})
    bbox = [min(g['bbox'][0] for g in grids), min(g['bbox'][1] for g in grids), max(g['bbox'][2] for g in grids), max(g['bbox'][3] for g in grids)]
    return {'id': f'gsi_{lake}', 'url': url, 'sha256': file_sha256(path), 'bbox': bbox, 'dataset': SOURCE['id'],
            'file': f'gsi/{lake}-{year}.zip', 'surveyYear': int(year), 'crs': grids[0]['crs'],
            'maxDepthM': max(g['maxDepthM'] for g in grids), 'grids': grids,
            'verticalReference': 'Depth below the surveyed water level, metres'}


def pin(cache, html=None, out=CANDIDATE):
    if html is None:
        with urllib.request.urlopen(urllib.request.Request(LIST_URL, headers={'User-Agent': 'TopoStack data build'}), timeout=120, context=gsi_context()) as response:
            html = response.read().decode('utf-8', 'replace')
    # One name carries a non-ASCII middle dot (onogawako・akimotoko-2019.zip).
    lakes = sorted({(urllib.parse.quote(match.group(0), safe=':/'), match.group(1), match.group(3)) for match in ZIP_LINK.finditer(html)},
                   key=lambda item: item[1])
    pins = []
    for index, (url, lake, year) in enumerate(lakes, 1):
        pins.append(pin_lake(url, lake, year, cache))
        print(f'{index}/{len(lakes)} {lake} {year}', flush=True)
    bounds = [min(p['bbox'][0] for p in pins) - 0.01, min(p['bbox'][1] for p in pins) - 0.01,
              max(p['bbox'][2] for p in pins) + 0.01, max(p['bbox'][3] for p in pins) + 0.01]
    candidate = {'source': {**SOURCE, 'bounds': [round(v, 4) for v in bounds]}, 'pins': pins}
    out.write_text(json.dumps(candidate, indent=1, ensure_ascii=False) + '\n')
    return candidate


def gsi(source, pins, cache, writer, download, write_grid):
    """Add each lake's depth grid to the archive in pin order (alphabetical by lake)."""
    for index, item in enumerate(pins, 1):
        if not (cache / item['file']).exists():
            fetch(item['url'], cache / item['file'])
        path = download(item, cache)  # verifies the pinned SHA-256
        grids = read_depths(path)
        for name, values, transform, crs in grids:
            label = item['id'] if len(grids) == 1 else f"{item['id']}/{name}"
            prepared = cache / 'gsi-prepared' / f"{label.replace('/', '-')}.tif"
            if not prepared.exists():
                write_grid(prepared, values, transform, crs)
            writer.add(prepared, label)
        print(f'GSI lakes: {index}/{len(pins)} {item["id"]}', flush=True)


def candidate(path=CANDIDATE):
    """The unregistered source and pins, so the archive is buildable before registration; None before `pin` has run."""
    if not path.exists():
        return None, []
    data = json.loads(path.read_text())
    return data['source'], data['pins']


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['pin'])
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    found = pin(args.cache)
    print(json.dumps({'lakes': len(found['pins']), 'bounds': found['source']['bounds']}), flush=True)


if __name__ == '__main__':
    main()
