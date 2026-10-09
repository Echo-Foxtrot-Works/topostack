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
along a tile seam, each special use ring running with its area on the left so
the studio can hatch it on the inside, as the sectional does. Class B, C and D
edges that neighbouring areas share are written once, and each area's ceiling
and floor get candidate label points in `airspace_labels`. Every Class B, C
and D sector and every special use record is also written whole, as a polygon
with its floor and ceiling (`airspace_volumes`, `sua_volumes`), for models that
build airspace in three dimensions. Runways are
centerlines with their width; the studio draws the outline when it is wide
enough to read at the model's scale. NAD83 coordinates are used as WGS84 (under 2 m apart in the
conterminous US, far below engraving resolution).

Usage:
  python scripts/data-build/build-faa-aviation.py --output .topostack/faa/faa-aviation.pmtiles
Needs tippecanoe and pmtiles on PATH.
"""
import argparse
import csv
import gzip
import io
import json
import math
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import zipfile

import fiona
import shapely
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import linemerge, polylabel, unary_union
from pinned import download, file_sha256

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'scripts/data/faa-aviation-sources.json'

AIRSPACE_CLASSES = {'B', 'C', 'D'}
# Neighbouring areas of one class (Class B shelves, a Class C core and its shelf) are surveyed
# separately, so a shared edge comes twice, its two copies up to a few metres apart. Within this
# distance (about 3 m) of an edge already written, an edge is the same edge and is written once.
SHARED_EDGE_DEGREES = 3e-5
# Where each area's floor and ceiling can be printed: its roomiest point, then points spread over it
# so a crop showing only part of a large shelf still has one, the closest no nearer than this.
LABEL_MIN_SPACING_M = 2_000
LABEL_CANDIDATES = 24
LABEL_DETAIL_MINZOOM = 9
# Class D pieces of one name and ceiling this close (about 1 km) are one area. Names repeat
# across airports ("DENVER CLASS D" is both Rocky Mountain Metro and Centennial), so nearness decides.
CLASS_D_PIECE_DEGREES = 0.01
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
# The contract's ceiling for a volume altitude (FL600, the top of charted special use airspace).
MAX_VOLUME_FT = 60_000
# Neighbouring sectors are surveyed separately and their shared edges miss each other. In the
# 2026-10-01 cycle the slivers between Class B sectors are up to 106 m across at their widest
# (Detroit, 52 km long; special use 23 m, Class C 12 m). A union of them, which every acrylic piece
# is, would keep each as a slot the laser cuts. Gaps between sectors narrower than this are closed;
# real gaps between airspaces are kilometres wide.
SEAL_M = 150
# AIRSPACE_VOLUME_MAX_ZOOM in the contract: volumes stay out of the deepest tiles, which
# every engraved-aviation load reads; check-aviation-features.mjs holds the two equal.
VOLUME_MAXZOOM = 10


def fetch(pin, cache):
    """Return a verified local copy of a pinned file, downloading it if absent."""
    path = cache / pin['file']
    if not path.exists():
        if 'url' not in pin:
            raise FileNotFoundError(f'{path} is a service snapshot; capture it with snapshot-survey-service.py --url {pin["service"]}')
        # FAA hosts reject the default urllib agent; download() sends its own.
        download(pin['url'], path)
    actual = file_sha256(path)
    if actual != pin['sha256']:
        raise ValueError(f'{path.name} SHA-256 {actual} does not match the pinned {pin["sha256"]}')
    return path


def feature(geometry, properties, minzoom, maxzoom=None):
    zooms = {'minzoom': minzoom} if maxzoom is None else {'minzoom': minzoom, 'maxzoom': maxzoom}
    return {'type': 'Feature', 'geometry': geometry, 'properties': properties, 'tippecanoe': zooms}


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


def volume_altitude(value, unit, code):
    """(feet, reference) for a volume's floor or ceiling, or None when it cannot be read.

    References follow the contract: `msl`; `sfc` (the ground, feet 0); `agl`,
    which the FAA codes as SFC with a height; `fl`, a flight level kept in feet;
    and `unlimited`, which has no feet.
    """
    code = (code or '').strip().upper()
    unit = (unit or '').strip().upper()
    if code == 'UNLTD':
        return None, 'unlimited'
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = None
    if code == 'SFC':
        if not number:
            return 0, 'sfc'
        return (int(number), 'agl') if number > 0 and unit == 'FT' else None
    if number is None or number < 0:
        return None
    if code == 'STD' or unit == 'FL':
        return int(number * 100), 'fl'
    if code == 'MSL' and unit == 'FT':
        return int(number), 'msl'
    return None


def volume_values(properties):
    """A sector's floor and ceiling as contract properties, or None for a record without usable limits.

    The SUA service writes a zero-height placeholder as an SFC ceiling; it has no volume.
    """
    floor = volume_altitude(properties.get('LOWER_VAL'), properties.get('LOWER_UOM'), properties.get('LOWER_CODE'))
    ceiling = volume_altitude(properties.get('UPPER_VAL'), properties.get('UPPER_UOM'), properties.get('UPPER_CODE'))
    if not floor or not ceiling or floor[1] == 'unlimited' or ceiling[1] == 'sfc':
        return None
    (floor_ft, floor_ref), (ceiling_ft, ceiling_ref) = floor, ceiling
    if floor_ft > MAX_VOLUME_FT or (ceiling_ft is not None and ceiling_ft > MAX_VOLUME_FT):
        return None
    if ceiling_ft is not None and (floor_ref in (ceiling_ref, 'sfc')) and ceiling_ft <= floor_ft:
        return None
    values = {'floor_ft': floor_ft, 'floor_ref': floor_ref, 'ceiling_ref': ceiling_ref}
    if ceiling_ft is not None:
        values['ceiling_ft'] = ceiling_ft
    if properties.get('UPPER_DESC') == 'TNI':
        values['ceiling_below'] = True
    return values


def polygonal(geometry):
    """Only the areas of a geometry; intersections and repairs can add stray lines and points."""
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return geometry
    return unary_union([part for part in getattr(geometry, 'geoms', []) if part.geom_type in ('Polygon', 'MultiPolygon')])


def valid(geometry):
    """The geometry's area, repaired when scaling or rounding left it self-touching.

    make_valid keeps every part of the area; buffer(0) can drop most of a polygon
    whose ring touches itself.
    """
    return polygonal(geometry if geometry.is_valid else shapely.make_valid(geometry))


def seal_sectors(geometries, families=None):
    """The sectors with every gap narrower than SEAL_M between neighbours filled.

    With `families` (one key per sector, such as the class), each family is
    sealed on its own first: a Class D can lie across the sliver between two
    Class B shelves and hide it from a seal of everything, yet above the D's
    ceiling the B shelves meet alone. Then all sectors are sealed together.

    Sectors within SEAL_M of each other form clusters. Each cluster is closed
    (grown and shrunk by half the width, in metres). Each piece of what that
    adds between two or more sectors goes to every sector it touches, but only
    as far as half the width from that sector: a gap is never wider than the
    width, so each of its points is covered from one side or the other, and no
    sector grows a tail along a neighbour's edge. A narrow inlet of one
    sector's own outline is left as charted. A model unions a different set of
    sectors at each altitude, so a sliver given to only one of them would open
    again wherever that one is absent; overlapping by a sliver is harmless to a
    union. A sector with no neighbour is returned as it was.
    """
    geometries = list(geometries)
    if families is not None:
        families = list(families)
        for family in dict.fromkeys(families):
            members = [index for index, key in enumerate(families) if key == family]
            for index, sealed in zip(members, seal_sectors([geometries[index] for index in members])):
                geometries[index] = sealed
    if len(geometries) < 2:
        return geometries
    reach = SEAL_M / 110_540 / math.cos(math.radians(70))  # degrees that span SEAL_M up to 70° latitude
    tree = shapely.STRtree(geometries)
    parent = list(range(len(geometries)))
    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index
    left, right = tree.query(geometries, predicate='dwithin', distance=reach)
    for a, b in zip(left, right):
        if a != b:
            parent[root(a)] = root(b)
    clusters = {}
    for index in range(len(geometries)):
        clusters.setdefault(root(index), []).append(index)
    sealed = list(geometries)
    half = SEAL_M / 2
    for members in clusters.values():
        if len(members) < 2:
            continue
        lat = sum(geometries[index].centroid.y for index in members) / len(members)
        scale = (111_320 * math.cos(math.radians(lat)), 110_540)
        metric = [valid(shapely.transform(geometries[index], lambda xy: xy * scale)) for index in members]
        union = unary_union(metric)
        fill = union.buffer(half, join_style='mitre').buffer(-half, join_style='mitre').difference(union)
        grown = [geometry.buffer(half + 1) for geometry in metric]
        added = {index: [] for index in range(len(members))}
        for piece in getattr(fill, 'geoms', [fill]):
            if piece.is_empty or piece.area == 0:
                continue
            near = [(index, polygonal(grown[index].intersection(piece))) for index in range(len(members))]
            near = [(index, part) for index, part in near if part.area >= 1]  # square metres
            if len(near) >= 2:
                for index, part in near:
                    added[index].append(part)
        for position, index in enumerate(members):
            if added[position]:
                merged = valid(shapely.transform(unary_union([metric[position], *added[position]]), lambda xy: xy / scale))
                # Sealing only adds; a repair that lost area keeps the sector as charted.
                if merged.area >= geometries[index].area:
                    sealed[index] = merged
    return sealed


def volume_geometry(polygon):
    """A sector's area as 2D GeoJSON, exteriors counterclockwise, or None when nothing is left."""
    parts = [orient(part, sign=1.0) for part in getattr(polygon, 'geoms', [polygon]) if not part.is_empty and part.area > 0]
    if not parts:
        return None
    geometry = mapping(parts[0] if len(parts) == 1 else shapely.MultiPolygon(parts))
    return json.loads(json.dumps(geometry), parse_float=lambda text: round(float(text), 6))


def charted_airspace(records):
    """The Class B, C and D records the sectional draws, with their class, name and properties."""
    for properties, geometry in records:
        cls = properties.get('CLASS')
        name = (properties.get('NAME') or '').strip()
        if cls in AIRSPACE_CLASSES and name and geometry is not None:
            yield cls, name, properties, shapely.force_2d(shape(geometry)).buffer(0)


def airspace_minzoom(cls):
    return 5 if cls in ('B', 'C') else 7


def airspace_features(records):
    """Class B, C and D boundaries, each edge once.

    Unlike special use airspace these are never hatched, so an edge two areas
    share needs no side and is written for the first area only; drawn for both,
    the laser would burn it twice.
    """
    out = []
    written = {cls: [] for cls in AIRSPACE_CLASSES}
    for cls, name, properties, polygon in charted_airspace(records):
        values = {'class': cls, 'name': name}
        if (properties.get('IDENT') or '').strip():
            values['ident'] = properties['IDENT'].strip()
        for ring in rings_as_lines(polygon):
            line = LineString(ring['coordinates'])
            box = line.buffer(SHARED_EDGE_DEGREES).bounds
            nearby = [edge for edge in written[cls] if edge.bounds[0] <= box[2] and edge.bounds[2] >= box[0] and edge.bounds[1] <= box[3] and edge.bounds[3] >= box[1]]
            rest = line.difference(unary_union(nearby).buffer(SHARED_EDGE_DEGREES, cap_style='flat')) if nearby else line
            if rest.is_empty:
                continue
            merged = linemerge(rest) if rest.geom_type == 'MultiLineString' else rest
            for piece in getattr(merged, 'geoms', [merged]):
                coordinates = [[round(x, 6), round(y, 6)] for x, y in piece.coords]
                if piece.length < SHARED_EDGE_DEGREES or len(coordinates) < 2:
                    continue
                written[cls].append(piece)
                out.append(feature({'type': 'LineString', 'coordinates': coordinates}, values, airspace_minzoom(cls)))
    return out


def airspace_volume_features(records):
    """Every Class B, C and D sector whole, with its floor and ceiling, numbered in source order and sealed against its neighbours."""
    sectors = [(cls, name, values, polygon) for cls, name, properties, polygon in charted_airspace(records)
               if (values := volume_values(properties))]
    out = []
    for (cls, name, values, _), polygon in zip(sectors, seal_sectors([polygon for *_, polygon in sectors], [cls for cls, *_ in sectors])):
        geometry = volume_geometry(polygon)
        if geometry:
            out.append(feature(geometry, {'class': cls, 'name': name, 'sector': len(out), **values}, airspace_minzoom(cls), VOLUME_MAXZOOM))
    return out


def label_candidates(polygon):
    """Points inside an area where its altitudes can be printed, the roomiest first, as (lon, lat, clearance in metres)."""
    lat0 = polygon.representative_point().y
    scale = (111_320 * math.cos(math.radians(lat0)), 110_540)
    metric = shapely.transform(polygon, lambda coordinates: coordinates * scale)
    boundary = metric.boundary
    pole = polylabel(metric, tolerance=25)
    best = boundary.distance(pole)
    if best <= 0:
        return []
    spacing = max(best, LABEL_MIN_SPACING_M)
    west, south, east, north = metric.bounds
    grid = [Point(west + spacing * (i + 0.5), south + spacing * (j + 0.5))
            for i in range(int((east - west) / spacing) + 1) for j in range(int((north - south) / spacing) + 1)]
    spare = [(point, boundary.distance(point)) for point in grid if metric.contains(point)]
    spare = [(point, clearance) for point, clearance in spare if clearance >= best * 0.4]
    chosen = [(pole, best)]
    # Places around the pole: a round Class D's pole is its airport, whose symbol and identifier take it.
    for step in range(8):
        turn = step * math.pi / 4
        point = Point(pole.x + best * 0.5 * math.cos(turn), pole.y + best * 0.5 * math.sin(turn))
        clearance = boundary.distance(point)
        if metric.contains(point) and clearance >= best * 0.4:
            chosen.append((point, clearance))
    # Farthest-point order: each next candidate is the one farthest from those already chosen.
    while spare and len(chosen) < LABEL_CANDIDATES:
        distance = lambda item: min(item[0].distance(point) for point, _ in chosen)
        far = max(spare, key=distance)
        if distance(far) < spacing * 0.9:
            break
        chosen.append(far)
        spare.remove(far)
    return [(round(point.x / scale[0], 6), round(point.y / scale[1], 6), int(clearance)) for point, clearance in chosen]


def airspace_label_features(records):
    """Where each Class B, C and D area's ceiling and floor can be printed, as the sectional prints them inside the area.

    Every Class B and C sector is its own area, labelled for its own floor. A
    Class D split into records (an extension, a cut-out) prints its ceiling
    once, so pieces with one name and ceiling that touch share an area number.
    """
    out = []
    count = 0
    pieces = []  # (name, ceiling, below, geometry, area) of every Class D piece so far
    for cls, name, properties, polygon in charted_airspace(records):
        floor = altitude_ft(properties.get('LOWER_VAL'), properties.get('LOWER_UOM'), properties.get('LOWER_CODE'))
        ceiling = altitude_ft(properties.get('UPPER_VAL'), properties.get('UPPER_UOM'), properties.get('UPPER_CODE'))
        # Class D prints its ceiling alone; B and C print ceiling over floor.
        if ceiling is None or (cls != 'D' and floor is None):
            continue
        values = {'class': cls, 'ceiling_ft': ceiling}
        if cls != 'D':
            values['floor_ft'] = floor
        if properties.get('UPPER_DESC') == 'TNI':
            values['ceiling_below'] = True
        for part in getattr(polygon, 'geoms', [polygon]):
            key = (name, ceiling, values.get('ceiling_below', False))
            joined = next((piece[4] for piece in pieces if cls == 'D' and piece[:3] == key and piece[3].distance(part) <= CLASS_D_PIECE_DEGREES), None)
            area = joined if joined is not None else count
            if joined is None:
                count += 1
            if cls == 'D':
                pieces.append((*key, part, area))
            for index, (lon, lat, clearance) in enumerate(label_candidates(part)):
                out.append(feature({'type': 'Point', 'coordinates': [lon, lat]}, {**values, 'area': area, 'clearance_m': clearance},
                                   airspace_minzoom(cls) if index == 0 else max(airspace_minzoom(cls), LABEL_DETAIL_MINZOOM)))
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


def sua_volume_features(collection):
    """Every special use record whole, with its own floor and ceiling.

    Unlike the charted boundary, the records of one area are not dissolved: a
    sector or an exclusion pocket is a different volume from the area around it.
    """
    records = []
    for item in collection['features']:
        properties = item.get('properties') or {}
        kind = SUA_KINDS.get(properties.get('TYPE_CODE'))
        name = (properties.get('NAME') or '').strip()
        if not kind or not name or not item.get('geometry') or properties.get('LEVEL_CODE') == UPPER_ONLY_SUA:
            continue
        values = volume_values(properties)
        polygon = shapely.force_2d(shape(item['geometry'])).buffer(0)
        if not values or polygon.is_empty:
            continue
        if str(properties.get('EXCLUSION')) == '1':
            values['exclusion'] = True
        records.append((kind, name, values, polygon))
    out = []
    for (kind, name, values, _), polygon in zip(records, seal_sectors([polygon for *_, polygon in records], [name for _, name, *_ in records])):
        geometry = volume_geometry(polygon)
        if geometry:
            out.append(feature(geometry, {'kind': kind, 'name': name, 'sector': len(out), **values}, 5, VOLUME_MAXZOOM))
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
    airspace = read_airspace(fetch(files['classAirspace'], cache), files['classAirspace']['member'])
    return {
        'airspace': airspace_features(airspace),
        'airspace_labels': airspace_label_features(airspace),
        'sua': sua_features(sua),
        'runways': runway_features(airports, runways, ends),
        'airports': airport_features(airports, runways, ends),
        'navaids': navaid_features(read_csv(fetch(files['navaids'], cache), 'NAV_BASE.csv')),
        'obstacles': obstacle_features(read_obstacle_lines(fetch(files['obstacles'], cache))),
        'airspace_volumes': airspace_volume_features(airspace),
        'sua_volumes': sua_volume_features(sua),
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
    # Volumes are polygons: a small Class D must not be merged into a neighbour
    # at low zoom, and sectors that share an edge keep sharing it when simplified.
    subprocess.run(['tippecanoe', '--force', f'--output={mbtiles}', '--minimum-zoom=5', f'--maximum-zoom={pins["maxZoom"]}',
                    '--drop-rate=1', '--no-feature-limit', '--no-tile-size-limit', '--no-tiny-polygon-reduction',
                    '--detect-shared-borders', '--quiet', *inputs], check=True)
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
    receipt = {'dataset': pins['dataset'], 'sha256': file_sha256(output), 'bytes': output.stat().st_size,
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
