#!/usr/bin/env python3
"""Build the public lands PMTiles archive from the pinned PAD-US geodatabase.

The input is pinned by URL and SHA-256 in scripts/data/public-lands-sources.json.
Each PAD-US feature that belongs to one of the land classes in
packages/data-contracts/src/land-tiles.ts is classified, the features of one
unit are dissolved into one polygon, and every unit is checked against that
contract in Node before tiling. The rules are measured in
docs/reports/public-lands-spike-2026-10-13.md:

- Proclamation outlines are coded `PROC` whatever they bound, so they are
  classified by manager and unit name: NPS units (monuments apart), national
  forests and grasslands, national wildlife refuges, DoD installations and
  tribal land.
- Wilderness and the BLM and Forest Service national monuments come from the
  Designation layer; BLM land, state parks and preserves from Fee.
- A refuge's approved boundary is kept whole where the Fish and Wildlife
  Service owns at least `refugeOwnedShare` of it, or owns none of it (an
  overlay refuge on another agency's land, such as a Corps of Engineers
  reservoir). Otherwise the boundary is an acquisition area drawn around a
  region, and the refuge is the land the service owns inside it.
- Canadian units come from CPCAD (Environment and Climate Change Canada),
  land areas only, mapped onto the same classes by designation type
  (`CPCAD_TYPES`). Canada has no counterpart to national forests, BLM or
  military land, and CPCAD's Indigenous protected areas are conservation
  land, not reserves, so they are preserves. Each Canadian unit carries
  `source: "cpcad"` so the studio credits the database it used.
- Tribal land is the Census AIANNH outlines PAD-US carries. Oklahoma Tribal
  Statistical Areas are kept as reservations under the tribe's name; the
  other statistical areas (Alaska Native villages, designated and
  state-designated areas) are not reservations and are left out.

GDAL's OpenFileGDB driver drops rows for some attribute filters on this
geodatabase, so every layer is read whole and filtered here. Areas are
measured in the source's equal-area projection (EPSG:5070) before the
outlines are converted to WGS84.

Usage:
  python scripts/data-build/build-public-lands.py --output .topostack/padus/public-lands.pmtiles
Needs tippecanoe and pmtiles on PATH.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import zipfile

import fiona
from fiona.transform import transform_geom
import numpy as np
import shapely
from shapely.geometry import mapping, shape
from pinned import download, file_sha256

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/data/public-lands-sources.json'
ACRE_M2 = 4046.8564224
# The archive's coordinates: about 0.1 m, far below tile resolution, so rebuilds write identical input.
COORDINATE_DECIMALS = 6
PROPERTIES = ('Des_Tp', 'Mang_Name', 'Unit_Nm', 'State_Nm')
# Census statistical areas that are not reservations. Oklahoma Tribal Statistical Areas are kept.
NON_RESERVATION_AREAS = ('Alaska Native Village Statistical Area', 'Tribal Designated Statistical Area', 'State Designated Tribal Statistical Area')
OKLAHOMA_STATISTICAL_AREA = ' Oklahoma Tribal Statistical Area'
UNNAMED = re.compile(r'^(unknown\b|none$|unnamed$|$)', re.I)
# CPCAD designation types (TYPE_E) by class. Anything else - proposed or reserved areas,
# pastures, habitat designations, planning areas - is not land a model would paint.
CPCAD_TYPES = {
    'National Park': 'national-park', 'National Historic Site': 'national-park',
    'Wilderness Area': 'wilderness', 'Wilderness Park': 'wilderness', 'Wildland Provincial Park': 'wilderness', 'Wilderness Reserve': 'wilderness',
    'National Wildlife Area': 'wildlife-refuge', 'Migratory Bird Sanctuary': 'wildlife-refuge', 'Wildlife Sanctuary': 'wildlife-refuge',
    'Wildlife Management Area': 'wildlife-refuge', 'Game Preserve': 'wildlife-refuge',
    'Provincial Park': 'state-park', 'A - Park': 'state-park', 'Territorial Park': 'state-park', "Quebec's national park": 'state-park',
    "Quebec's national park reserve": 'state-park', 'Conservancy': 'state-park', 'Provincial Recreation Area': 'state-park',
    'Natural Environment Park': 'state-park', 'Park Reserve': 'state-park',
    'Ecological Reserve': 'preserve', 'Conservation Reserve': 'preserve', 'Representative Area Ecological Reserve': 'preserve',
    'Biodiversity reserve': 'preserve', 'Protected Natural Area': 'preserve', 'Nature Legacy protected area': 'preserve',
    'Protected Area': 'preserve', 'Natural Area': 'preserve', 'Biological refuge': 'preserve', 'Conservation Area': 'preserve',
    'Conservation Park': 'preserve', 'Privately Protected Area': 'preserve', 'Private Conservation Lands': 'preserve',
    'Ownership by Environmental Non-Governmental Organization': 'preserve', 'Privately Owned Conservation Area': 'preserve',
    'NGO/Land Trust/Agency - Fee Simple Property': 'preserve', 'Indigenous and Territorial Protected Area': 'preserve',
    'Indigenous owned conservation area': 'preserve', 'Indigenous owned protected area': 'preserve',
}


def proclamation_class(props):
    """The class of a Proclamation outline, by manager and unit name, or None."""
    manager, name = props.get('Mang_Name'), props.get('Unit_Nm') or ''
    if manager == 'NPS':
        return 'national-monument' if 'National Monument' in name else 'national-park'
    if manager == 'FWS':
        return 'wildlife-refuge' if 'National Wildlife Refuge' in name else None
    if manager == 'TRIB':
        return None if any(kind in name for kind in NON_RESERVATION_AREAS) else 'tribal'
    return {'USFS': 'national-forest', 'DOD': 'military'}.get(manager)


def designation_class(props):
    if props.get('Des_Tp') == 'WA':
        return 'wilderness'
    # FWS monuments are the Pacific marine monuments; NPS monuments come from Proclamation.
    if props.get('Des_Tp') == 'NM' and props.get('Mang_Name') in ('BLM', 'USFS'):
        return 'national-monument'
    return None


def fee_class(props):
    if props.get('Mang_Name') == 'BLM':
        return 'blm'
    cls = {'SP': 'state-park', 'SREC': 'state-park', 'PCON': 'preserve', 'LCA': 'preserve'}.get(props.get('Des_Tp'))
    # A proposed purchase is not a preserve yet.
    if cls == 'preserve' and re.search(r'\bproposed\b', props.get('Unit_Nm') or '', re.I):
        return None
    return cls


def cpcad_class(props):
    """The class of a CPCAD area: land only (marine areas lie on the sea, which is cut flat), by designation type."""
    return CPCAD_TYPES.get(props.get('TYPE_E')) if props.get('BIOME') == 'T' else None


def unit_name(cls, name):
    """The source name, spaced once. Agencies name one wilderness "X Wilderness" or "X Wilderness Area"."""
    name = re.sub(r'\s+', ' ', name or '').strip()
    return re.sub(r' Wilderness Area$', ' Wilderness', name) if cls == 'wilderness' else name


def display_name(cls, name, source=None):
    """The name a label would print, or None for BLM land and placeholders such as "Unknown Park"."""
    name = unit_name(cls, name)
    if cls == 'blm' or UNNAMED.match(name):
        return None
    if source == 'cpcad':
        # Parks Canada's legal names end "of Canada"; some provinces write names in capitals.
        name = re.sub(r' of Canada$', '', name, flags=re.I)
        if name.isupper():
            name = re.sub(r'[A-Z]+', lambda word: word.group(0).capitalize(), name)
    if cls == 'tribal' and name.endswith(OKLAHOMA_STATISTICAL_AREA):
        return name[:-len(OKLAHOMA_STATISTICAL_AREA)]
    return name[:160]


def unit_key(cls, props):
    """One unit per class and name; state parks and preserves repeat names across states, and BLM has none."""
    if props.get('source') == 'cpcad':
        # Canadian names repeat across provinces ("DUC Fee Simple Lands"), so the province is part of every unit.
        return f"ca:{cls}:{unit_name(cls, props.get('Unit_Nm'))}:{props.get('State_Nm')}"
    if cls == 'blm':
        return f"blm:{props.get('State_Nm')}"
    name = unit_name(cls, props.get('Unit_Nm'))
    return f"{cls}:{name}:{props.get('State_Nm')}" if cls in ('state-park', 'preserve') else f'{cls}:{name}'


def owned_share(outline, owned):
    """Share of an outline's area inside the agency's own land."""
    return shapely.intersection(outline, owned).area / outline.area if outline.area else 0.0


def refuge_geometry(outline, owned, minimum_share):
    """The whole approved boundary where the agency owns enough of it, or none (an overlay refuge); otherwise the land it owns inside."""
    share = owned_share(outline, owned)
    return outline if share >= minimum_share or share == 0 else shapely.intersection(outline, owned)


def read_layer(gdb, layer, classify, owner=None):
    """(class, properties, geometry) for every feature `classify` keeps, reading the whole layer.

    With `owner`, the same pass also returns that manager's features, whatever their class.
    """
    kept, owned = [], []
    with fiona.open(gdb, layer=f'PADUS4_1{layer}') as source:
        for item in source:
            props = {key: item.properties.get(key) for key in PROPERTIES}
            cls = classify(props)
            mine = owner is not None and props.get('Mang_Name') == owner
            if not (cls or mine) or not item.geometry:
                continue
            geometry = shapely.make_valid(shape(item.geometry))
            if cls:
                kept.append((cls, props, geometry))
            if mine:
                owned.append(('owned', props, geometry))
        crs = source.crs
    print(f'{layer}: {len(kept)} features kept' + (f', {len(owned)} owned by {owner}' if owner else ''), flush=True)
    return kept, owned, crs


def dissolve(features):
    """One (class, properties, geometry) per unit key, in key order."""
    groups = defaultdict(list)
    for cls, props, geometry in features:
        groups[unit_key(cls, props)].append((cls, props, geometry))
    units = []
    for key in sorted(groups):
        members = groups[key]
        merged = shapely.union_all([geometry for _, _, geometry in members])
        polygons = shapely.get_parts(merged)
        polygons = [part for part in polygons if isinstance(part, shapely.Polygon) and part.area > 0]
        if polygons:
            units.append((key, members[0][0], members[0][1], shapely.MultiPolygon(polygons) if len(polygons) > 1 else polygons[0]))
    return units


def owned_land(features):
    """The union of fee land, indexed for intersection with outlines."""
    geometries = [geometry for _, _, geometry in features]
    return geometries, shapely.STRtree(geometries)


def apply_refuge_rule(units, owned, minimum_share):
    """Refuge units with each outline replaced as `refuge_geometry` decides; others unchanged."""
    geometries, tree = owned
    result, partial = [], 0
    for key, cls, props, geometry in units:
        if cls == 'wildlife-refuge':
            nearby = shapely.union_all([geometries[index] for index in tree.query(geometry, predicate='intersects')])
            kept = refuge_geometry(geometry, nearby, minimum_share)
            if kept is not geometry:
                partial += 1
            parts = [part for part in shapely.get_parts(kept) if isinstance(part, shapely.Polygon) and part.area > 0]
            geometry = shapely.MultiPolygon(parts) if len(parts) > 1 else parts[0]
        result.append((key, cls, props, geometry))
    print(f'wildlife-refuge: {partial} outlines replaced by owned land', flush=True)
    return result


def read_cpcad(gdb, layer, crs):
    """(class, properties, geometry) for every CPCAD land area of a class, in `crs`."""
    kept = []
    with fiona.open(gdb, layer=layer) as source:
        for item in source:
            props = dict(item.properties)
            cls = cpcad_class(props)
            if not cls or not item.geometry:
                continue
            geometry = shapely.make_valid(shape(transform_geom(source.crs, crs, item.geometry)))
            kept.append((cls, {'Unit_Nm': props.get('NAME_E'), 'State_Nm': f"CA-{props.get('LOC')}", 'source': 'cpcad'}, geometry))
    print(f'CPCAD: {len(kept)} features kept', flush=True)
    return kept


def unit_feature(key, cls, props, geometry, crs):
    """The GeoJSON feature the archive stores for one unit, in WGS84."""
    wgs84 = shape(transform_geom(crs, 'EPSG:4326', mapping(geometry)))
    wgs84 = shapely.transform(wgs84, lambda coordinates: np.round(coordinates, COORDINATE_DECIMALS))
    properties = {'class': cls, 'unit': key, 'name': display_name(cls, props.get('Unit_Nm'), props.get('source')), 'manager': props.get('Mang_Name'),
                  'acres': round(geometry.area / ACRE_M2), 'source': props.get('source')}
    return {'type': 'Feature', 'properties': {k: v for k, v in properties.items() if v is not None}, 'geometry': mapping(wgs84)}


def gdb_path(pin, cache):
    """The geodatabase directory of a pinned zip, unpacked from the verified zip on first use."""
    archive = cache / pin['file']
    if not archive.exists():
        download(pin['url'], archive, timeout=1800, retries=2)
    actual = file_sha256(archive)
    if actual != pin['sha256']:
        raise ValueError(f'{archive.name} SHA-256 {actual} does not match the pinned {pin["sha256"]}')
    gdb = cache / pin['member']
    if not gdb.exists():
        with zipfile.ZipFile(archive) as bundle:
            members = [name for name in bundle.namelist() if name.startswith(pin['member'] + '/')]
            if not members:
                raise ValueError(f'{archive.name} has no {pin["member"]}')
            bundle.extractall(cache, members)
    return gdb


def build_units(pins, gdb, cpcad=None):
    proclamation, _, crs = read_layer(gdb, 'Proclamation', proclamation_class)
    designation, _, _ = read_layer(gdb, 'Designation', designation_class)
    fee, fws, _ = read_layer(gdb, 'Fee', fee_class, owner='FWS')
    # PAD-US is in CONUS Albers, an equal-area projection; CPCAD is reprojected into it, so every unit is measured in one.
    canada = read_cpcad(cpcad, pins['files']['cpcad']['layer'], crs) if cpcad else []
    units = dissolve(proclamation + designation + fee + canada)
    units = apply_refuge_rule(units, owned_land(fws), pins['refugeOwnedShare'])
    return units, crs


def write_archive(units, crs, pins, output, work):
    counts = defaultdict(int)
    by_source = defaultdict(int)
    features = work / 'lands.geojsonl'
    with features.open('w') as handle:
        for key, cls, props, geometry in units:
            counts[cls] += 1
            by_source[props.get('source') or 'padus'] += 1
            handle.write(json.dumps(unit_feature(key, cls, props, geometry, crs), separators=(',', ':')) + '\n')
    # The contract check runs the browser's own parser over every unit and requires every class.
    subprocess.run(['node', str(ROOT / 'scripts/data-build/check-lands-features.mjs'), str(features)], check=True)
    mbtiles = work / 'lands.mbtiles'
    # Polygons are kept at every zoom and never merged: a small preserve must not vanish
    # into a neighbour, and units that share an edge keep sharing it when simplified.
    subprocess.run(['tippecanoe', '--force', f'--output={mbtiles}', f'--minimum-zoom={pins["minZoom"]}', f'--maximum-zoom={pins["maxZoom"]}',
                    '--layer=lands', '--drop-rate=1', '--no-feature-limit', '--no-tile-size-limit', '--no-tiny-polygon-reduction',
                    '--detect-shared-borders', '--quiet', str(features)], check=True)
    metadata = {'name': pins['dataset'], 'topostack_dataset': pins['dataset'], 'padus_version': pins['padusVersion'],
                'padus_date': pins['padusDate'], **({'cpcad_date': pins['canada']['date']} if 'canada' in pins else {}),
                'attribution': pins['name'] + (f"; {pins['canada']['name']}" if 'canada' in pins else ''),
                'description': pins['license'] + (f" {pins['canada']['license']}" if 'canada' in pins else '')}
    with sqlite3.connect(mbtiles) as db:
        # tippecanoe records temporary paths in name and generator_options; replace them so rebuilds are byte-identical.
        db.executemany('DELETE FROM metadata WHERE name = ?', [(key,) for key in [*metadata, 'generator_options']])
        db.executemany('INSERT INTO metadata VALUES (?, ?)', metadata.items())
    partial = output.with_suffix('.partial.pmtiles')
    subprocess.run(['pmtiles', 'convert', str(mbtiles), str(partial)], check=True)
    subprocess.run(['pmtiles', 'verify', str(partial)], check=True)
    partial.rename(output)
    receipt = {'dataset': pins['dataset'], 'sha256': file_sha256(output), 'bytes': output.stat().st_size,
               'units': dict(sorted(counts.items())), 'unitsBySource': dict(sorted(by_source.items())),
               'sources': {key: pin['sha256'] for key, pin in pins['files'].items()}}
    output.with_suffix('.sources.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f"Built {pins['dataset']}: {receipt['units']}; SHA256 {receipt['sha256']}", flush=True)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / '.topostack/padus')
    parser.add_argument('--sources', type=Path, default=SOURCES, help='Pinned source registration (use a new dataset version for candidate rebuilds)')
    args = parser.parse_args()
    pins = json.loads(args.sources.read_text())
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cpcad = gdb_path(pins['files']['cpcad'], args.cache) if 'cpcad' in pins['files'] else None
    units, crs = build_units(pins, gdb_path(pins['files']['padus'], args.cache), cpcad)
    with tempfile.TemporaryDirectory() as work:
        write_archive(units, crs, pins, args.output, Path(work))


if __name__ == '__main__':
    main()
