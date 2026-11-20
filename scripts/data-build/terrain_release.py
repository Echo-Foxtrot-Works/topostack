"""Offline terrain registry: immutable manifests and one atomic catalog snapshot.

Legacy pin/receipt files are migration inputs only; registration never edits them.
The runtime still consumes the catalog's unchanged sources array.
"""
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit


# Mirrors packages/data-contracts/src/source-catalog.ts.
VERTICAL_DATUMS = ('CGVD2013', 'JP-TP', 'MSL')
SOURCE_KINDS = ('lidar-dtm', 'national-dtm', 'bathymetry-grid')
TOKENS = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$')
HASH = re.compile(r'^[a-f0-9]{64}$')


def positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def same_bounds(actual, expected):
    return (isinstance(actual, list) and len(actual) == 4 and
            all(type(a) in (int, float) and math.isfinite(a) and abs(a-b) <= 1e-6
                for a, b in zip(actual, expected)))


def validate_candidate(source, pin):
    if not TOKENS.fullmatch(source.get('id', '')):
        raise ValueError('Invalid versioned terrain identity')
    for field in ('name', 'license', 'url'):
        if not isinstance(source.get(field), str) or not source[field].strip():
            raise ValueError('Missing terrain ' + field)
    for url in (source['url'], pin.get('url', ''), pin.get('item', '')):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Terrain inputs require HTTPS URLs without credentials')
    bounds = source.get('bounds')
    if not same_bounds(bounds, bounds or []) or not (-180 <= bounds[0] < bounds[2] <= 180 and -85.0511 <= bounds[1] < bounds[3] <= 85.0511):
        raise ValueError('Invalid terrain bounds')
    if (source.get('encoding') != 'elevation-terrarium-v1' or source.get('verticalDatum') not in VERTICAL_DATUMS
            or pin.get('verticalDatum') != source['verticalDatum'] or source.get('kind') not in SOURCE_KINDS):
        raise ValueError('Unsupported terrain encoding, semantics or datum')
    availability = source.get('availability', 'all')
    approval = source.get('approval')
    if availability not in ('all', 'development'):
        raise ValueError('Invalid terrain availability')
    if approval is not None and (not isinstance(approval, dict) or approval.get('required') is not True
                                 or ('reference' in approval and (not isinstance(approval['reference'], str) or not approval['reference'].strip()))):
        raise ValueError('Invalid terrain approval')
    if approval is not None and availability == 'all' and 'reference' not in approval:
        raise ValueError('Terrain needs an approval reference before it is available to all')
    if (type(source.get('minZoom')) is not int or type(source.get('maxZoom')) is not int
            or not 0 <= source['minZoom'] <= source['maxZoom'] <= 15):
        raise ValueError('Invalid terrain zoom range')
    if (type(source.get('priority')) is not int or not 1 <= source['priority'] <= 1000
            or not positive(source.get('nativeResolutionM')) or source['nativeResolutionM'] > 1000
            or pin.get('sourceResolutionM') != source['nativeResolutionM']):
        raise ValueError('Invalid terrain priority/resolution')
    if 'acquisitionYear' in source and (type(source['acquisitionYear']) is not int or not 1900 <= source['acquisitionYear'] <= 2100):
        raise ValueError('Invalid acquisition year')
    if not isinstance(pin.get('etag'), str) or not re.fullmatch(r'"[^"\r\n]+"', pin['etag']) or type(pin.get('bytes')) is not int or pin['bytes'] <= 0:
        raise ValueError('Missing immutable upstream object pin')


def validate_receipt(source, pin, receipt):
    validate_candidate(source, pin)
    if (receipt.get('dataset') != source['id'] or not HASH.fullmatch(receipt.get('sha256', ''))
            or type(receipt.get('bytes')) is not int or receipt['bytes'] <= 0
            or type(receipt.get('tiles')) is not int or receipt['tiles'] <= 0):
        raise ValueError('Invalid terrain build receipt')
    inputs = receipt.get('sources', [])
    if len(inputs) != 1 or any(inputs[0].get(k) != v for k, v in pin.items()):
        raise ValueError('Receipt does not match upstream pin')
    for field in ('snapshotSha256', 'samplesSha256'):
        if not HASH.fullmatch(inputs[0].get(field, '')):
            raise ValueError('Receipt lacks snapshot/sample hash')
    grids = receipt.get('grids', [])
    if len(grids) != 1 or not same_bounds(grids[0].get('bounds'), source['bounds']):
        raise ValueError('Receipt extent does not match registration')
    if receipt.get('schemaVersion') == 1:
        if receipt.get('encoding') != source['encoding'] or receipt.get('verticalDatum') != source['verticalDatum'] or receipt.get('verticalUnits') != 'metre':
            raise ValueError('Receipt normalization mismatch')
        coverage = receipt.get('coverage', {})
        valid, total = coverage.get('validSamples'), coverage.get('totalSamples')
        if type(valid) is not int or type(total) is not int or not 0 < valid <= total:
            raise ValueError('Invalid measured terrain coverage')
    elif 'schemaVersion' in receipt:
        raise ValueError('Unsupported terrain receipt schema')


def canonical(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def load_registry(catalog_path, pins_path, receipts_path=None):
    catalog = json.loads(catalog_path.read_text())
    if catalog.get('registryVersion') == 1:
        payload = {k: v for k, v in catalog.items() if k != 'releaseManifest'}
        content = canonical(payload)
        name = 'terrain-releases/' + hashlib.sha256(content).hexdigest() + '.json'
        if catalog.get('releaseManifest') != name or (catalog_path.parent / name).read_bytes() != content:
            raise ValueError('Terrain registry manifest mismatch')
        records = catalog['records']
    elif 'registryVersion' in catalog:
        raise ValueError('Unsupported terrain registry version')
    else:
        pins = json.loads(pins_path.read_text())
        receipts_path = receipts_path or pins_path.with_name('hrdem-builds.json')
        receipts = {r['dataset']: r for r in json.loads(receipts_path.read_text())['builds']}
        records = {s['id']: {'pin': pins[s['id']], 'receipt': receipts[s['id']]} for s in catalog['sources']}
    ids = [s['id'] for s in catalog['sources']]
    if len(ids) != len(set(ids)) or set(ids) != set(records):
        raise ValueError('Duplicate or missing terrain registry identity')
    for source in catalog['sources']:
        entry = records[source['id']]
        validate_receipt(source, entry['pin'], entry['receipt'])
    return catalog['sources'], records


def atomic_write(path, content):
    """Only the rename changes the active snapshot; fsync data and directory."""
    fd, partial = tempfile.mkstemp(prefix=path.name + '.', suffix='.part', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(partial, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(partial).unlink(missing_ok=True)


def register(built, catalog_path, pins_path):
    # A persistent flock file avoids races between operators. An interrupted
    # process releases its OS lock; an orphaned manifest is harmless.
    with catalog_path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        sources, records = load_registry(catalog_path, pins_path)
        existing = {s['id']: s for s in sources}
        for entry in built:
            source, pin, receipt = entry['source'], entry['pin'], entry['receipt']
            validate_receipt(source, pin, receipt)
            source_id = source['id']
            if source_id in existing:
                old = records[source_id]
                # Old receipts may contain snapshot hashes absent from old pins.
                merged_old_pin = {**old['pin'], **old['receipt']['sources'][0]}
                merged_new_pin = {**pin, **receipt['sources'][0]}
                if existing[source_id] != source or merged_old_pin != merged_new_pin or old['receipt'] != receipt:
                    raise ValueError('Refusing to change an existing source identity, pin or receipt')
            else:
                if receipt.get('schemaVersion') != 1:
                    raise ValueError('New terrain registrations require measured coverage receipts')
                existing[source_id] = source
                records[source_id] = {'pin': pin, 'receipt': receipt}
        payload = {'registryVersion': 1, 'sources': list(existing.values()), 'records': records}
        content = canonical(payload)
        relative = 'terrain-releases/' + hashlib.sha256(content).hexdigest() + '.json'
        manifest = catalog_path.parent / relative
        manifest.parent.mkdir(exist_ok=True)
        if manifest.exists():
            if manifest.read_bytes() != content:
                raise ValueError('Immutable terrain manifest was modified')
        else:
            atomic_write(manifest, content)
        atomic_write(catalog_path, canonical({**payload, 'releaseManifest': relative}))
