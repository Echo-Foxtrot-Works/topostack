#!/usr/bin/env python3
"""Discover NRCan bare-earth COGs by area; optionally build and register pinned archives.

Mosaics provide coverage independent of individual project catalog footprints.
Run without --build to review candidates. Building reads only the bounded area.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

import numpy as np
import rasterio

import hrdem
import tile_writer
from terrain_release import register

API = 'https://datacube.services.geo.ca/stac/api'
# Approved products only: a DSM must never silently masquerade as bare earth.
PRODUCTS = {'hrdem-mosaic-1m': (300, 1, 'lidar-dtm'),
            'hrdem-mosaic-2m': (300, 2, 'lidar-dtm'),
            'mrdem-30': (200, 30, 'national-dtm')}
ROOT = Path(__file__).parent.parent


def read_json(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def discover(bounds):
    if len(bounds) != 4 or not (-180 <= bounds[0] < bounds[2] <= 180 and -85 < bounds[1] < bounds[3] < 85):
        raise ValueError('Expected west,south,east,north without crossing the antimeridian')
    candidates = []
    for collection, (priority, resolution, kind) in PRODUCTS.items():
        url = API + '/search?' + urllib.parse.urlencode({'collections': collection, 'bbox': ','.join(map(str, bounds)), 'limit': 100})
        seen = set()
        while url:
            if url in seen or len(seen) >= 20:
                raise ValueError('Unexpected STAC pagination; narrow the requested region')
            if not url.startswith(API + '/'):
                raise ValueError('Unexpected STAC pagination host')
            seen.add(url)
            page = read_json(url)
            for item in page['features']:
                asset = item.get('assets', {}).get('dtm')
                if not asset:
                    continue
                cog = asset['href']
                if not cog.startswith('https://canelevation-dem.s3.ca-central-1.amazonaws.com/') or not cog.endswith('.tif'):
                    raise ValueError('Unexpected NRCan DTM asset URL')
                with urllib.request.urlopen(urllib.request.Request(cog, method='HEAD'), timeout=60) as response:
                    etag, size = response.headers.get('ETag'), int(response.headers.get('Content-Length', 0))
                if not etag or size <= 0:
                    raise ValueError('Asset cannot be pinned')
                identity = json.dumps([bounds, cog, etag], separators=(',', ':'))
                source_id = 'nrcan-' + collection + '-' + hashlib.sha256(identity.encode()).hexdigest()[:12] + '-v1'
                item_url = API + '/collections/' + collection + '/items/' + urllib.parse.quote(item['id'])
                source = dict(id=source_id, name='NRCan ' + collection.upper() + ' · ' + item['id'], url=item_url,
                              license='Contains information licensed under the Open Government Licence – Canada. Bare-earth DTM; CGVD2013 heights.',
                              bounds=bounds, encoding='elevation-terrarium-v1', minZoom=10, maxZoom=15,
                              verticalDatum='CGVD2013', priority=priority, nativeResolutionM=resolution, kind=kind)
                # Mosaic publication date is not an acquisition date. Leave it unknown.
                pin = dict(item=item_url, url=cog, etag=etag, bytes=size, verticalDatum='CGVD2013',
                           sourceResolutionM=resolution, published=item['properties'].get('datetime'))
                candidates.append({'source': source, 'pin': pin})
            next_link = next((link for link in page.get('links', []) if link['rel'] == 'next'), None)
            if next_link and next_link.get('method', 'GET') != 'GET':
                raise ValueError('Unsupported STAC pagination method')
            url = next_link['href'] if next_link else None
    return sorted(candidates, key=lambda candidate: (-candidate['source']['priority'], candidate['source']['nativeResolutionM'], candidate['source']['id']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bounds', required=True, help='west,south,east,north (use --bounds=-82,... for negative values)')
    parser.add_argument('--out-dir', type=Path, required=True)
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--register', action='store_true', help='Register successfully built archives locally; does not upload')
    parser.add_argument('--limit', type=int, default=20, help='Maximum ranked candidates to build')
    parser.add_argument("--stop-when-covered", action="store_true", help="Stop when built rasters jointly cover all region samples")
    args = parser.parse_args()
    if args.register and not args.build:
        parser.error('--register requires --build')
    if args.limit < 1:
        parser.error('--limit must be positive')
    bounds = [float(value) for value in args.bounds.split(',')]
    # Do not overwrite previous immutable build outputs.
    args.out_dir.mkdir(parents=True, exist_ok=False)
    candidates = discover(bounds)
    (args.out_dir / 'candidates.json').write_text(json.dumps(candidates, indent=2) + '\n')
    print(f'{len(candidates)} bounding-box candidates; raster validity determines actual coverage.', flush=True)
    built = []
    covered = None
    for candidate in candidates[:args.limit] if args.build else []:
        source, pin = candidate['source'], candidate['pin']
        target = args.out_dir / (source['id'] + '.tif')
        output = args.out_dir / (source['id'] + '.pmtiles')
        print('Reading ' + source['name'], flush=True)
        try:
            samples_hash = hrdem.snapshot(source, pin, target)
        except hrdem.NoCoverageError:
            print('No valid raster coverage; skipped.', flush=True)
            continue
        pin = {**pin, 'snapshotSha256': tile_writer.digest(target), 'samplesSha256': samples_hash}
        hrdem.build(source, pin, target, output)
        built.append({'source': source, 'pin': pin, 'sha256': tile_writer.digest(output),
                      'receipt': json.loads(output.with_suffix('.sources.json').read_text())})
        if args.stop_when_covered:
            with rasterio.open(target) as raster:
                valid = np.isfinite(raster.read(1))
            covered = valid if covered is None else covered | valid
            if covered.all():
                break
    (args.out_dir / 'builds.json').write_text(json.dumps(built, indent=2) + '\n')
    if args.register:
        register(built, ROOT / 'data/terrain-sources.json', ROOT / 'data/hrdem-sources.json')
    print(json.dumps({'built': len(built), 'registered': args.register, 'directory': str(args.out_dir)}), flush=True)


if __name__ == '__main__':
    main()
