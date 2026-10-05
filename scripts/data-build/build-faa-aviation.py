#!/usr/bin/env python3
"""Build the FAA aviation PMTiles archive from one pinned set of FAA files.

Inputs are pinned by URL and SHA-256 in scripts/data/faa-aviation-sources.json:
the NASR 28-day class airspace shapefile and airport/navaid CSVs, the Digital
Obstacle File, and a snapshot of the special use airspace service (captured
with snapshot-survey-service.py, since the FAA publishes SUA only as a live
service). Output layers and properties follow
packages/data-contracts/src/aviation-tiles.ts; every feature is checked
against that contract in Node before tiling.

Boundaries are written as LineStrings so tile clipping never invents an edge
along a tile seam, each ring running with its area on the left so the studio
can hatch special use airspace on the inside, as the sectional does. Runways are centerlines with their width; the studio draws
the outline when it is wide enough to read at the model's scale. NAD83 coordinates are used as WGS84 (under 2 m apart in the
conterminous US, far below engraving resolution).

Usage:
  python scripts/data-build/build-faa-aviation.py --output .topostack/faa/faa-aviation.pmtiles
Needs tippecanoe and pmtiles on PATH.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import urllib.request
import zipfile

import fiona
from shapely.geometry import Polygon, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/data/faa-aviation-sources.json'

AIRSPACE_CLASSES = {'B', 'C', 'D'}
SUA_KINDS = {'P': 'prohibited', 'R': 'restricted', 'W': 'warning', 'A': 'alert', 'MOA': 'moa', 'D': 'danger'}
# LEVEL_CODE U: upper-altitude only (floor at or above 18,000 ft MSL). The sectional shows
# airspace effective below 18,000 ft, and these usually repeat the boundary of a low part.
UPPER_ONLY_SUA = 'U'
# One area's records are dissolved with a closing buffer this wide (about 5 m), which seals the
# hairline gaps where separately surveyed parts meet; holes left smaller than SUA_MIN_HOLE are such gaps.
SUA_SEAL_DEGREES = 5e-5
SUA_MIN_HOLE = 1e-5
AIRPORT_KINDS = {'A': 'airport', 'H': 'heliport', 'C': 'seaplane-base'}
MILITARY_OWNERSHIP = {'MA', 'MN', 'MR', 'CG'}
NAVAID_KINDS = {'VOR': 'vor', 'VORTAC': 'vortac', 'VOR/DME': 'vor-dme', 'TACAN': 'tacan', 'NDB': 'ndb', 'NDB/DME': 'ndb-dme', 'DME': 'dme'}
# Surfaces a laser can meaningfully draw as a strip; water lanes and rooftop pads are not.
EXCLUDED_RUNWAY_SURFACES = {'WATER', 'ROOF-TOP'}
# The sectional's hard surfaces; a composite code such as ASPH-TURF is named for its main surface.
HARD_SURFACES = {'ASPH', 'CONC', 'PEM'}
# Airports with a hard runway this long are charted with their runway layout.
PATTERN_MIN_HARD_FT = 1500
MAX_PATTERN_RUNWAYS = 12
# DOF lighting codes for high-intensity white strobes, which the sectional charts with rays.
HIGH_INTENSITY_LIGHTING = {'H', 'S'}
MIN_OBSTACLE_AGL_FT = 200
# Taller than any US structure (the tallest mast is about 2,060 ft): a data-entry error.
MAX_OBSTACLE_AGL_FT = 3000


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def fetch(pin, cache):
    """Return a verified local copy of a pinned file, downloading it if absent."""
    path = cache / pin['file']
    if not path.exists():
        if 'url' not in pin:
            raise FileNotFoundError(f'{path} is a service snapshot; capture it with snapshot-survey-service.py --url {pin["service"]}')
        # FAA hosts reject the default urllib agent.
        request = urllib.request.Request(pin['url'], headers={'User-Agent': 'TopoStack data build'})
        partial = path.with_suffix(path.suffix + '.partial')
        with urllib.request.urlopen(request, timeout=300) as response, partial.open('wb') as out:
            shutil.copyfileobj(response, out)
        partial.rename(path)
    actual = digest(path)
    if actual != pin['sha256']:
        raise ValueError(f'{path.name} SHA-256 {actual} does not match the pinned {pin["sha256"]}')
    return path


def feature(geometry, properties, minzoom):
    return {'type': 'Feature', 'geometry': geometry, 'properties': properties, 'tippecanoe': {'minzoom': minzoom}}


def rings_as_lines(geometry):
    """Every ring of a (multi)polygon (GeoJSON or shapely) as a 2D LineString, oriented so the area lies to its left."""
    polygon = geometry if hasattr(geometry, 'geom_type') else shape(geometry)
    polygons = getattr(polygon, 'geoms', [polygon])
    lines = []
    for part in polygons:
        part = orient(part, sign=1.0)
        for ring in [part.exterior, *part.interiors]:
            coordinates = [[round(x, 6), round(y, 6)] for x, y, *_ in ring.coords]
            if len(coordinates) >= 4:
                lines.append({'type': 'LineString', 'coordinates': coordinates})
    return lines


def altitude_ft(value, unit, code):
    """Feet from an FAA altitude triple; SFC is 0, sentinels and flight levels are omitted."""
    if code == 'SFC':
        return 0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if unit != 'FT' or number < 0:
        return None
    return int(number)


def airspace_features(records):
    out = []
    for properties, geometry in records:
        cls = properties.get('CLASS')
        name = (properties.get('NAME') or '').strip()
        if cls not in AIRSPACE_CLASSES or not name or geometry is None:
            continue
        values = {'class': cls, 'name': name}
        if (properties.get('IDENT') or '').strip():
            values['ident'] = properties['IDENT'].strip()
        floor = altitude_ft(properties.get('LOWER_VAL'), properties.get('LOWER_UOM'), properties.get('LOWER_CODE'))
        ceiling = altitude_ft(properties.get('UPPER_VAL'), properties.get('UPPER_UOM'), properties.get('UPPER_CODE'))
        if floor is not None:
            values['floor_ft'] = floor
        if ceiling is not None:
            values['ceiling_ft'] = ceiling
        for line in rings_as_lines(geometry):
            out.append(feature(line, values, 5 if cls in ('B', 'C') else 7))
    return out


def dissolve(geometries):
    """One outline for the records of one area, without the seams between them."""
    sealed = unary_union([geometry.buffer(SUA_SEAL_DEGREES, join_style='mitre') for geometry in geometries]).buffer(-SUA_SEAL_DEGREES, join_style='mitre')
    parts = [Polygon(part.exterior, [hole for hole in part.interiors if Polygon(hole).area >= SUA_MIN_HOLE]) for part in getattr(sealed, 'geoms', [sealed]) if not part.is_empty]
    return unary_union(parts)


def sua_features(collection):
    """Special use airspace as charted: one boundary per named area.

    The service splits an area into records where its floor or ceiling changes,
    as an exclusion ("excludes 1,500 ft AGL and below" around an airport) or a
    sector, often cutting the main record around them. The sectional draws only
    the area's lateral limit, so the records of one name are dissolved; drawn
    apart, every seam would be engraved and hatched as a border of its own.
    """
    areas = {}
    for item in collection['features']:
        properties = item.get('properties') or {}
        kind = SUA_KINDS.get(properties.get('TYPE_CODE'))
        name = (properties.get('NAME') or '').strip()
        if not kind or not name or not item.get('geometry') or properties.get('LEVEL_CODE') == UPPER_ONLY_SUA:
            continue
        areas.setdefault((kind, name), []).append(shape(item['geometry']).buffer(0))
    out = []
    for (kind, name), geometries in areas.items():
        for line in rings_as_lines(dissolve(geometries)):
            out.append(feature(line, {'kind': kind, 'name': name}, 5))
    return out


def number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def runway_centerline(start, end):
    """The centerline between two surveyed (lon, lat) runway ends, or None when they coincide."""
    (lon1, lat1), (lon2, lat2) = start, end
    metres = math.hypot((lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2)), (lat2 - lat1) * 110_540)
    if metres < 1:
        return None
    return {'type': 'LineString', 'coordinates': [[round(lon1, 7), round(lat1, 7)], [round(lon2, 7), round(lat2, 7)]]}


def is_hard(surface):
    return surface.replace('/', '-').split('-')[0] in HARD_SURFACES


def is_land_runway(row):
    return not row.get('RWY_ID', '').startswith('H') and row.get('SURFACE_TYPE_CODE', '') not in EXCLUDED_RUNWAY_SURFACES


def runway_ends(end_rows):
    ends = {}
    for row in end_rows:
        lat, lon = number(row['LAT_DECIMAL']), number(row['LONG_DECIMAL'])
        if lat is not None and lon is not None:
            ends.setdefault((row['SITE_NO'], row['RWY_ID']), []).append((lon, lat))
    return ends


def runway_pattern(airport, runways, ends):
    """Land runway centerlines in whole meters east and north of the airport reference point, as `x1,y1,x2,y2;...`."""
    lon0, lat0 = number(airport['LONG_DECIMAL']), number(airport['LAT_DECIMAL'])
    east = 111_320 * math.cos(math.radians(lat0))
    segments = []
    for row in sorted(runways, key=lambda item: -(number(item['RWY_LEN']) or 0))[:MAX_PATTERN_RUNWAYS]:
        pair = ends.get((row['SITE_NO'], row['RWY_ID']), [])
        if len(pair) != 2:
            continue
        coordinates = [round(value) for lon, lat in pair for value in ((lon - lon0) * east, (lat - lat0) * 110_540)]
        if all(abs(value) <= 20_000 for value in coordinates) and coordinates[:2] != coordinates[2:]:
            segments.append(','.join(str(value) for value in coordinates))
    return ';'.join(segments) or None


def operational_airports(base_rows):
    return {row['SITE_NO']: row for row in base_rows
            if row['ARPT_STATUS'] == 'O' and row['COUNTRY_CODE'] == 'US' and row['SITE_TYPE_CODE'] in AIRPORT_KINDS}


def runway_features(airports, runway_rows, end_rows):
    ends = runway_ends(end_rows)
    out = []
    for row in runway_rows:
        airport = airports.get(row['SITE_NO'])
        key = (row['SITE_NO'], row['RWY_ID'])
        width, length = number(row['RWY_WIDTH']), number(row['RWY_LEN'])
        if (not airport or airport['SITE_TYPE_CODE'] != 'A' or not is_land_runway(row)
                or not width or not length or len(ends.get(key, [])) != 2):
            continue
        centerline = runway_centerline(*ends[key])
        if centerline:
            values = {'airport': airport['ARPT_ID'], 'runway': row['RWY_ID'], 'width_ft': int(width), 'length_ft': int(length)}
            out.append(feature(centerline, values, 7))
    return out


def airport_features(airports, runway_rows, end_rows=()):
    longest, hard, land = {}, {}, {}
    for row in runway_rows:
        length = number(row['RWY_LEN'])
        if length:
            longest[row['SITE_NO']] = max(longest.get(row['SITE_NO'], 0), int(length))
        if is_land_runway(row):
            land.setdefault(row['SITE_NO'], []).append(row)
            if length and is_hard(row.get('SURFACE_TYPE_CODE', '')):
                hard[row['SITE_NO']] = max(hard.get(row['SITE_NO'], 0), int(length))
    ends = runway_ends(end_rows)
    out = []
    for site, row in airports.items():
        lat, lon = number(row['LAT_DECIMAL']), number(row['LONG_DECIMAL'])
        name = row['ARPT_NAME'].strip()
        if lat is None or lon is None or not name or not row['ARPT_ID'].strip():
            continue
        use = 'military' if row['OWNERSHIP_TYPE_CODE'] in MILITARY_OWNERSHIP else 'public' if row['FACILITY_USE_CODE'] == 'PU' else 'private'
        towered = row['TWR_TYPE_CODE'].startswith('ATCT')
        values = {'ident': row['ARPT_ID'].strip(), 'name': name, 'kind': AIRPORT_KINDS[row['SITE_TYPE_CODE']], 'use': use, 'towered': towered}
        if site in longest:
            values['longest_runway_ft'] = longest[site]
        if site in hard:
            values['hard_runway_ft'] = hard[site]
        if row.get('FUEL_TYPES', '').strip():
            values['fuel'] = True
        if row.get('BCN_LGT_SKED', '').strip():
            values['beacon'] = True
        if row.get('JOINT_USE_FLAG') == 'Y':
            values['joint_use'] = True
        pattern = runway_pattern(row, land.get(site, []), ends) if row['SITE_TYPE_CODE'] == 'A' and hard.get(site, 0) >= PATTERN_MIN_HARD_FT else None
        if pattern:
            values['runway_pattern'] = pattern
        prominent = towered or (use != 'private' and longest.get(site, 0) >= 3000)
        out.append(feature({'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]}, values, 6 if prominent else 8))
    return out


def navaid_features(rows):
    out = []
    for row in rows:
        kind = NAVAID_KINDS.get(row['NAV_TYPE'])
        lat, lon = number(row['LAT_DECIMAL']), number(row['LONG_DECIMAL'])
        if not kind or row['NAV_STATUS'] == 'SHUTDOWN' or lat is None or lon is None or not row['NAV_ID'].strip() or not row['NAME'].strip():
            continue
        values = {'ident': row['NAV_ID'].strip(), 'name': row['NAME'].strip(), 'kind': kind}
        out.append(feature({'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]}, values, 6))
    return out


def dms(degrees, minutes, seconds, hemisphere):
    value = int(degrees) + int(minutes) / 60 + float(seconds) / 3600
    return -value if hemisphere in ('S', 'W') else value


def parse_obstacle(line):
    """One Digital Obstacle File record (fixed columns per the FAA DOF README), or None."""
    if len(line) < 97 or not line[0:2].isdigit():
        return None
    try:
        lat = dms(line[35:37], line[38:40], line[41:46], line[46])
        lon = dms(line[48:51], line[52:54], line[55:60], line[60])
        agl = int(line[83:88])
    except ValueError:
        return None
    quantity = int(line[81]) if line[81].isdigit() else 1
    return {'country': line[12:14], 'lat': lat, 'lon': lon, 'type': line[62:80].strip(), 'quantity': quantity, 'agl_ft': agl, 'lighting': line[95]}


def obstacle_features(lines):
    out = []
    for line in lines:
        record = parse_obstacle(line)
        if not record or record['country'] != 'US' or not MIN_OBSTACLE_AGL_FT <= record['agl_ft'] <= MAX_OBSTACLE_AGL_FT:
            continue
        values = {'agl_ft': record['agl_ft'], 'lit': record['lighting'] not in ('N', 'U', ' ')}
        if record['lighting'] in HIGH_INTENSITY_LIGHTING:
            values['high_intensity'] = True
        if record['type'] == 'WINDMILL':
            values['wind_turbine'] = True
        if record['quantity'] > 1:
            values['quantity'] = record['quantity']
        out.append(feature({'type': 'Point', 'coordinates': [round(record['lon'], 7), round(record['lat'], 7)]}, values, 7 if record['agl_ft'] >= 1000 else 9))
    return out


def read_csv(archive, name):
    with zipfile.ZipFile(archive) as bundle:
        member = next(item for item in bundle.namelist() if item.endswith('/' + name) or item == name)
        return list(csv.DictReader(io.TextIOWrapper(bundle.open(member), encoding='latin-1')))


def read_obstacle_lines(archive):
    # DOF.DAT is the complete file; the per-state and CHG.DAT change files repeat its records.
    with zipfile.ZipFile(archive) as bundle:
        yield from io.TextIOWrapper(bundle.open('DOF.DAT'), encoding='latin-1').read().splitlines()


def read_airspace(archive, member):
    with fiona.open(f'zip://{archive}!{member}') as source:
        return [(dict(item.properties), item.geometry and dict(item.geometry.__geo_interface__)) for item in source]


def build_layers(pins, cache):
    files = pins['files']
    airports_zip = fetch(files['airports'], cache)
    base = read_csv(airports_zip, 'APT_BASE.csv')
    runways = read_csv(airports_zip, 'APT_RWY.csv')
    ends = read_csv(airports_zip, 'APT_RWY_END.csv')
    airports = operational_airports(base)
    with gzip.open(fetch(files['sua'], cache)) as stream:
        sua = json.load(stream)
    return {
        'airspace': airspace_features(read_airspace(fetch(files['classAirspace'], cache), files['classAirspace']['member'])),
        'sua': sua_features(sua),
        'runways': runway_features(airports, runways, ends),
        'airports': airport_features(airports, runways, ends),
        'navaids': navaid_features(read_csv(fetch(files['navaids'], cache), 'NAV_BASE.csv')),
        'obstacles': obstacle_features(read_obstacle_lines(fetch(files['obstacles'], cache))),
    }


def write_archive(layers, pins, output, work):
    inputs = []
    for layer, features in layers.items():
        if not features:
            raise ValueError(f'No {layer} features produced')
        path = work / f'{layer}.geojson'
        path.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')))
        inputs.append(f'--named-layer={layer}:{path}')
    # The contract check runs the browser's own parsers over every feature.
    subprocess.run(['node', str(ROOT / 'scripts/data-build/check-aviation-features.mjs'), str(work)], check=True)
    mbtiles = work / 'aviation.mbtiles'
    # -r1 keeps every point at every zoom (tippecanoe otherwise thins points
    # below the base zoom); the browser budgets features instead of guessing.
    subprocess.run(['tippecanoe', '--force', f'--output={mbtiles}', '--minimum-zoom=5', f'--maximum-zoom={pins["maxZoom"]}',
                    '--drop-rate=1', '--no-feature-limit', '--no-tile-size-limit', '--quiet', *inputs], check=True)
    metadata = {'name': pins['dataset'], 'topostack_dataset': pins['dataset'], 'faa_nasr_cycle': pins['nasrCycle'],
                'faa_obstacle_date': pins['obstacleDate'], 'faa_sua_date': pins['suaDate'],
                'attribution': pins['name'], 'description': pins['license']}
    with sqlite3.connect(mbtiles) as db:
        # tippecanoe records temporary paths in name and generator_options; replace them so rebuilds are byte-identical.
        db.executemany('DELETE FROM metadata WHERE name = ?', [(key,) for key in [*metadata, 'generator_options']])
        db.executemany('INSERT INTO metadata VALUES (?, ?)', metadata.items())
    partial = output.with_suffix('.partial.pmtiles')
    subprocess.run(['pmtiles', 'convert', str(mbtiles), str(partial)], check=True)
    subprocess.run(['pmtiles', 'verify', str(partial)], check=True)
    partial.rename(output)
    receipt = {'dataset': pins['dataset'], 'sha256': digest(output), 'bytes': output.stat().st_size,
               'features': {layer: len(features) for layer, features in layers.items()},
               'sources': {key: pin['sha256'] for key, pin in pins['files'].items()}}
    output.with_suffix('.sources.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f"Built {pins['dataset']}: {receipt['features']}; SHA256 {receipt['sha256']}", flush=True)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / '.topostack/faa')
    args = parser.parse_args()
    pins = json.loads(SOURCES.read_text())
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    layers = build_layers(pins, args.cache)
    with tempfile.TemporaryDirectory() as work:
        write_archive(layers, pins, args.output, Path(work))


if __name__ == '__main__':
    main()
