#!/usr/bin/env python3
"""Capture an ArcGIS layer as deterministic, checksum-pinnable GeoJSON.

Enumerates object IDs first and checks every page for missing/duplicate records;
never accepts a server's silently truncated first page as a complete survey.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from collections import deque
import gzip
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request


def request(url, parameters):
    encoded = urllib.parse.urlencode(parameters)
    # IIS-backed servers reject long GET query strings, often as HTTP 404.
    address = urllib.request.Request(url, data=encoded.encode()) if len(encoded) > 1500 else url + '?' + encoded
    for attempt in range(3):
        try:
            with urllib.request.urlopen(address, timeout=120) as response:
                data = json.load(response)
            if 'error' in data:
                raise ValueError(str(data['error']))
            return data
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def snapshot(url, output, where='1=1', batch_size=200):
    metadata = request(url, {'f': 'json'})
    revision = (metadata.get('editingInfo') or {}).get('lastEditDate')
    listing = request(url + '/query', {'f': 'json', 'where': where, 'returnIdsOnly': 'true'})
    ids = sorted(listing['objectIds'])
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('Empty or duplicate source object IDs')
    field = listing['objectIdFieldName']
    batches = [ids[i:i + batch_size] for i in range(0, len(ids), batch_size)]
    pages = output.parent / (output.name + '.pages')
    pages.mkdir(parents=True, exist_ok=True)

    def page(index):
        path = pages / f'{index:06d}.json'
        wanted = batches[index]
        parameters = {'f': 'geojson', 'objectIds': ','.join(map(str, wanted)),
                      'outFields': '*', 'outSR': '4326', 'returnGeometry': 'true'}
        # Cache identity includes the endpoint and selection, not only page number.
        identity = hashlib.sha256(json.dumps([url, revision, parameters], sort_keys=True).encode()).hexdigest()
        try:
            cached = json.loads(path.read_text()) if revision and path.exists() else None
        except (OSError, ValueError):
            cached = None
        def fetch(wanted_ids):
            query = {**parameters, 'objectIds': ','.join(map(str, wanted_ids))}
            try:
                result = request(url + '/query', query)
                found = [f.get('properties', {}).get(field, f.get('id')) for f in result.get('features', [])]
                if result.get('exceededTransferLimit') or len(found) != len(wanted_ids) or set(found) != set(wanted_ids):
                    raise ValueError('Incomplete ArcGIS response')
                return result
            except (OSError, ValueError):
                if len(wanted_ids) == 1:
                    raise
                middle = len(wanted_ids) // 2
                first = fetch(wanted_ids[:middle])
                second = fetch(wanted_ids[middle:])
                return {'type': 'FeatureCollection', 'features': first['features'] + second['features']}
        reusable = cached and cached.get('identity') == identity
        data = cached['data'] if reusable else fetch(wanted)
        features = data.get('features', [])
        actual = [f.get('properties', {}).get(field, f.get('id')) for f in features]
        if data.get('exceededTransferLimit') or len(actual) != len(wanted) or set(actual) != set(wanted):
            raise ValueError(f'Incomplete survey page {index}: expected {len(wanted)}, received {len(actual)}')
        features.sort(key=lambda f: f.get('properties', {}).get(field, f.get('id')))
        if revision and not reusable:
            temporary = path.with_suffix('.part')
            temporary.write_text(json.dumps({'identity': identity, 'data': data}, separators=(',', ':')))
            temporary.replace(path)
        return features

    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + '.part')
    with partial.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as stream:
        stream.write(b'{"type":"FeatureCollection","features":[')
        first = True
        with ThreadPoolExecutor(max_workers=4) as pool:
            # Bound out-of-order responses when a large geometry page is slow.
            remaining = iter(range(len(batches)))
            pending = deque((i, pool.submit(page, i)) for i in range(min(8, len(batches))))
            for _ in range(len(pending)):
                next(remaining)
            while pending:
                index, future = pending.popleft()
                features = future.result()
                next_index = next(remaining, None)
                if next_index is not None:
                    pending.append((next_index, pool.submit(page, next_index)))
                for feature in features:
                    if not first:
                        stream.write(b',')
                    stream.write(json.dumps(feature, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())
                    first = False
                if index % 25 == 0:
                    print(f'{output.name}: {index + 1}/{len(batches)} pages', flush=True)
        stream.write(b']}\n')
    # Detect additions/deletions during capture rather than publish an inconsistent snapshot.
    after = request(url + '/query', {'f': 'json', 'where': where, 'returnIdsOnly': 'true'})
    if sorted(after['objectIds']) != ids:
        raise ValueError('Survey object IDs changed during capture; repeat in a fresh cache')
    if revision and (request(url, {'f': 'json'}).get('editingInfo') or {}).get('lastEditDate') != revision:
        raise ValueError('Survey revision changed during capture; repeat the snapshot')
    partial.replace(output)
    with output.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    receipt = {'url': url, 'where': where, 'features': len(ids), 'metadata': metadata,
               'sha256': checksum}
    output.with_suffix('.receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Captured {len(ids)} features; SHA256 {receipt["sha256"]}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--where', default='1=1')
    parser.add_argument('--batch-size', type=int, default=200)
    args = parser.parse_args()
    if args.batch_size < 1 or args.batch_size > 1000:
        parser.error('batch-size must be between 1 and 1000')
    snapshot(args.url, args.output, args.where, args.batch_size)
