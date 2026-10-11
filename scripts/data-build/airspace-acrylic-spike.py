#!/usr/bin/env python3
"""Feasibility measurements for airspace built in acrylic (docs/plans/airspace-acrylic.md).

Reproduces docs/reports/airspace-acrylic-spike-2026-10-09.md from the pinned FAA
class airspace shapefile and special use airspace snapshot (the same files and
checks as build-faa-aviation.py) and Mapzen Terrarium terrain at zoom 10.

  levels  For each crop and exaggeration: the distinct floors and ceilings, what
          survives merging levels closer than one acrylic sheet plus 2 mm, model
          heights, pieces and acrylic per form, and floors given above ground.
  gaps    The widest open air in each 5 mm column of defined airspace, for plates
          and tiers (which place acrylic only at levels).
  seams   Round-trip one crop's Class B and C sectors through tippecanoe as
          polygons and measure the gaps and overlaps left between neighbours.
  scene   Write terrain sheets and the three forms in model millimetres as JSON,
          for a 3D mock.

The stack follows planTerrainStack (whole sheets, refitted exaggeration, datum
at the land minimum) without the sea-level ladder snap or lake depth sheets, so
studio sheet counts can differ by one or two.

Usage:
  python scripts/data-build/airspace-acrylic-spike.py levels --exaggeration 2,5,10,20 --output levels.json
  python scripts/data-build/airspace-acrylic-spike.py gaps --crop denver --exaggeration 10
  python scripts/data-build/airspace-acrylic-spike.py seams --crop denver
  python scripts/data-build/airspace-acrylic-spike.py scene --crop denver --exaggeration 10 --output scene-denver.json
Needs tippecanoe and tippecanoe-decode on PATH for `seams`.
"""
import argparse
import gzip
import importlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

import fiona
import numpy as np
from PIL import Image
import rasterio.features
from rasterio.transform import Affine
import shapely
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform, unary_union
from shapely.prepared import prep

sys.path.insert(0, str(Path(__file__).resolve().parent))
aviation = importlib.import_module('build-faa-aviation')
from pinned import download  # noqa: E402

FEET = 0.3048
WIDTH_MM = 300.0
SHEET_MM = 3.0
ACRYLIC_MM = 3.0
# Levels closer than this cannot take a rod between them.
LEVEL_GAP_MM = ACRYLIC_MM + 2.0
MIN_PIECE_MM2 = 50.0
# The studio's default minimum feature: a piece is closed by half of it, so no slot or notch narrower than this is cut.
MIN_FEATURE_MM = 0.8
TERRAIN_ZOOM = 10
# The bounds plan_model returned for 300 x 300 mm models of each place.
CROPS = {
    'denver': (-105.37294845459445, 39.31828879855866, -103.96705154540555, 40.3974684030061),
    'seattle': (-122.9749482525953, 46.998416774403054, -121.64505174740471, 47.89773886210056),
    'lasvegas': (-116.0801179873825, 35.56795059154867, -114.5198820126175, 36.826987337449914),
    'fallon': (-119.53105349069202, 38.67683971316338, -117.66894650930797, 40.11573999289952),
    'avonpark': (-81.80763233242742, 27.199418781222487, -80.79236766757258, 28.098732446998927),
}
# Chart colours as acrylic tints: blue for Class B and D, prohibited, restricted and warning areas; magenta otherwise.
BLUE = {'B', 'D', 'R', 'P', 'W'}


def load_sectors(bounds, cache, classes=('B', 'C'), special_use=True):
    """Sectors that reach the crop, sealed against their neighbours as the archive is, cut to it, with the builder's floor and ceiling properties."""
    pins = json.loads(aviation.SOURCES.read_text())['files']
    crop = box(*bounds)
    out = []
    with fiona.open(f"zip://{aviation.fetch(pins['classAirspace'], cache)}!{pins['classAirspace']['member']}") as source:
        for item in source.filter(bbox=bounds):
            properties = dict(item.properties)
            values = aviation.volume_values(properties)
            if properties.get('CLASS') in aviation.AIRSPACE_CLASSES and values and item.geometry:
                out.append({'kind': properties['CLASS'], 'name': properties['NAME'], **values,
                            'geometry': shapely.force_2d(shape(item.geometry.__geo_interface__)).buffer(0)})
    # Sealed with every class, as the builder seals them, before keeping the classes asked for.
    for sector, sealed in zip(out, aviation.seal_sectors([sector['geometry'] for sector in out], [sector['kind'] for sector in out])):
        sector['geometry'] = sealed
    out = [sector for sector in out if sector['kind'] in classes]
    special = []
    if special_use:
        with gzip.open(aviation.fetch(pins['sua'], cache)) as stream:
            for item in json.load(stream)['features']:
                properties = item.get('properties') or {}
                values = aviation.volume_values(properties)
                if properties.get('TYPE_CODE') in aviation.SUA_KINDS and properties.get('LEVEL_CODE') != aviation.UPPER_ONLY_SUA and values and item.get('geometry'):
                    special.append({'kind': properties['TYPE_CODE'], 'name': properties['NAME'], **values,
                                    'geometry': shapely.force_2d(shape(item['geometry'])).buffer(0)})
    for sector, sealed in zip(special, aviation.seal_sectors([sector['geometry'] for sector in special], [sector['name'] for sector in special])):
        sector['geometry'] = sealed
    out += special
    for sector in out:
        sector['geometry'] = sector['geometry'].intersection(crop)
    return [sector for sector in out if not sector['geometry'].is_empty]


def tile_xy(lon, lat, zoom):
    n = 2 ** zoom
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def terrain(bounds, cache):
    """Terrarium elevations over the crop in metres, sea flat at 0 and single-pixel pits clipped."""
    west, south, east, north = bounds
    x0, y0 = tile_xy(west, north, TERRAIN_ZOOM)
    x1, y1 = tile_xy(east, south, TERRAIN_ZOOM)
    columns, rows = int(x1) - int(x0) + 1, int(y1) - int(y0) + 1
    mosaic = np.zeros((rows * 256, columns * 256))
    for tx in range(int(x0), int(x1) + 1):
        for ty in range(int(y0), int(y1) + 1):
            path = cache / 'terrarium' / f'{TERRAIN_ZOOM}-{tx}-{ty}.png'
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                download(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{TERRAIN_ZOOM}/{tx}/{ty}.png', path, retries=2)
            rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
            mosaic[(ty - int(y0)) * 256:(ty - int(y0) + 1) * 256, (tx - int(x0)) * 256:(tx - int(x0) + 1) * 256] = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
    left, top = (x0 - int(x0)) * 256, (y0 - int(y0)) * 256
    grid = np.maximum(mosaic[int(top):int((y1 - int(y0)) * 256), int(left):int((x1 - int(x0)) * 256)], 0)
    return np.maximum(grid, np.percentile(grid, 0.01))


class Model:
    """The stack planTerrainStack would make, and the crop in model millimetres (centred, y down)."""

    def __init__(self, bounds, exaggeration, dem):
        west, south, east, north = bounds
        self.bounds, self.dem = bounds, dem
        self.lat0, self.lon0 = (south + north) / 2, (west + east) / 2
        self.scale = WIDTH_MM / ((east - west) * 111_320 * math.cos(math.radians(self.lat0)))
        self.base = float(dem.min())
        relief = float(dem.max()) - self.base
        self.sheets = max(2, round(relief * self.scale * exaggeration / SHEET_MM))
        self.metres_per_sheet = relief / self.sheets
        self.mm_per_metre = SHEET_MM / self.metres_per_sheet
        self.exaggeration = self.sheets * SHEET_MM / (relief * self.scale)
        self.height_mm = (north - south) * 110_540 * self.scale

    def z(self, metres):
        """Height of a piece's underside above the table; sheet 0's top is the land minimum."""
        return SHEET_MM + (metres - self.base) * self.mm_per_metre

    def to_mm(self, geometry):
        east = 111_320 * math.cos(math.radians(self.lat0)) * self.scale
        return transform(lambda x, y, z=None: ((np.asarray(x) - self.lon0) * east, -(np.asarray(y) - self.lat0) * 110_540 * self.scale), geometry)

    def ground_under(self, geometry):
        """DEM cells whose centre lies in the sector (sampled to at most about 40,000)."""
        west, south, east, north = self.bounds
        rows, columns = self.dem.shape
        minx, miny, maxx, maxy = geometry.bounds
        c0, c1 = max(0, int((minx - west) / (east - west) * columns)), min(columns, int((maxx - west) / (east - west) * columns) + 1)
        r0, r1 = max(0, int((north - maxy) / (north - south) * rows)), min(rows, int((north - miny) / (north - south) * rows) + 1)
        step = max(1, int(math.sqrt((c1 - c0) * (r1 - r0) / 40_000)))
        prepared = prep(geometry)
        values = [self.dem[r, c] for r in range(r0, r1, step) for c in range(c0, c1, step)
                  if prepared.contains(Point(west + (c + 0.5) / columns * (east - west), north - (r + 0.5) / rows * (north - south)))]
        return np.array(values or [self.dem.mean()])

    def stack_layers(self):
        """Each sheet's footprint in millimetres, from the DEM at the sheet thresholds."""
        rows, columns = self.dem.shape
        grid = Affine(WIDTH_MM / columns, 0, -WIDTH_MM / 2, 0, self.height_mm / rows, -self.height_mm / 2)
        layers = []
        for index in range(self.sheets):
            mask = (self.dem >= self.base + index * self.metres_per_sheet).astype(np.uint8)
            parts = [shape(geometry) for geometry, value in rasterio.features.shapes(mask, mask=mask.astype(bool), transform=grid) if value == 1]
            layers.append(unary_union(parts).simplify(0.4).buffer(0))
        return layers


def resolve(model, sector, cap_ft):
    """Floor and ceiling in metres; a floor or ceiling above ground sits on the highest ground under the sector."""
    ground = None
    def metres(feet, reference):
        nonlocal ground
        if reference == 'agl':
            ground = model.ground_under(sector['geometry']) if ground is None else ground
            return float(ground.max()) + feet * FEET
        return feet * FEET
    floor = None if sector['floor_ref'] == 'sfc' else metres(sector['floor_ft'], sector['floor_ref'])
    ceiling = cap_ft * FEET if sector['ceiling_ref'] == 'unlimited' else min(metres(sector['ceiling_ft'], sector['ceiling_ref']), cap_ft * FEET)
    if floor is not None and floor >= ceiling:
        return None
    spread = float(ground.max() - ground.min()) if ground is not None else None
    return {'floor': floor, 'ceiling': ceiling, 'agl_spread_m': spread, 'area': model.to_mm(sector['geometry']), 'sector': sector}


def merged_levels(model, resolved):
    """Distinct floors and ceilings, lowest first, with those closer than LEVEL_GAP_MM merged into the lower."""
    raw = sorted({round(item['floor'], 1) for item in resolved if item['floor'] is not None} | {round(item['ceiling'], 1) for item in resolved})
    groups = []
    for altitude in raw:
        if groups and model.z(altitude) - model.z(groups[-1][0]) < LEVEL_GAP_MM:
            groups[-1].append(altitude)
        else:
            groups.append([altitude])
    snap = {altitude: group[0] for group in groups for altitude in group}
    return raw, groups, snap


def level_sets(resolved, snap, level):
    floors = [item for item in resolved if item['floor'] is not None and snap[round(item['floor'], 1)] == level]
    ceilings = [item for item in resolved if snap[round(item['ceiling'], 1)] == level]
    through = [item for item in resolved if (item['floor'] is None or snap[round(item['floor'], 1)] < level) and snap[round(item['ceiling'], 1)] > level]
    return floors, ceilings, through


def piece(areas):
    """One piece: the union of its sectors, closed by half the minimum feature (tile seams, slivers the builder left)."""
    radius = MIN_FEATURE_MM / 2
    return unary_union(areas).buffer(radius, join_style='mitre').buffer(-radius, join_style='mitre')


def parts(geometry):
    return [part for part in getattr(geometry, 'geoms', [geometry]) if part.area >= MIN_PIECE_MM2]


def measure_levels(name, exaggerations, cache, cap_ft):
    bounds = CROPS[name]
    dem = terrain(bounds, cache)
    sectors = load_sectors(bounds, cache)
    runs = []
    for exaggeration in exaggerations:
        model = Model(bounds, exaggeration, dem)
        resolved = [item for item in (resolve(model, sector, cap_ft) for sector in sectors) if item]
        raw, groups, snap = merged_levels(model, resolved)
        pieces = {'plates': 0, 'tiers': 0}
        area = {'plates': 0.0, 'tiers': 0.0}
        for group in groups:
            floors, ceilings, through = level_sets(resolved, snap, group[0])
            for form, members in (('plates', floors + ceilings + through), ('tiers', floors + ceilings)):
                kept = parts(piece([item['area'] for item in members])) if members else []
                pieces[form] += len(kept)
                area[form] += sum(part.area for part in kept)
        top = max(model.z(item['ceiling']) for item in resolved)
        slices, volume_area, z = 0, 0.0, SHEET_MM
        while z < top:
            altitude = model.base + (z - SHEET_MM) / model.mm_per_metre
            present = [item['area'] for item in resolved if (item['floor'] is None or item['floor'] <= altitude) and item['ceiling'] > altitude]
            if present:
                slices += 1
                volume_area += piece(present).area
            z += ACRYLIC_MM
        gap = min((b - a for a, b in zip(raw, raw[1:])), default=None)
        runs.append({
            'requestedExaggeration': exaggeration, 'fittedExaggeration': round(model.exaggeration, 2), 'terrainSheets': model.sheets,
            'scale': round(1000 / model.scale), 'mmPer1000Ft': round(1000 * FEET * model.mm_per_metre, 2),
            'rawLevels': len(raw), 'levels': len(groups), 'closestLevelsFt': round(gap / FEET) if gap else None,
            'exaggerationForAllLevels': round(LEVEL_GAP_MM / (gap * model.scale), 1) if gap else None,
            'topMm': round(top, 1), 'terrainTopMm': model.sheets * SHEET_MM,
            'pieces': pieces, 'acrylicM2': {'plates': round(area['plates'] / 1e6, 3), 'tiers': round(area['tiers'] / 1e6, 3), 'volumes': round(volume_area / 1e6, 3)},
            'volumeSheets': slices,
            'levelTable': [{'altitudeFt': round(group[0] / FEET), 'zMm': round(model.z(group[0]), 1), 'mergedFt': [round(a / FEET) for a in group[1:]]} for group in groups],
            'aboveGround': [{'name': item['sector']['name'], 'groundSpreadM': round(item['agl_spread_m']), 'groundSpreadMm': round(item['agl_spread_m'] * model.mm_per_metre, 1)}
                            for item in resolved if item['agl_spread_m'] is not None],
        })
    return {'bounds': bounds, 'sectors': len(sectors), 'runs': runs}


def measure_gaps(name, exaggeration, cache, cap_ft, step_mm=5.0):
    """Median and largest open-air gap per column for plates and tiers, between the ground or floor and the ceiling."""
    bounds = CROPS[name]
    model = Model(bounds, exaggeration, terrain(bounds, cache))
    resolved = [item for item in (resolve(model, sector, cap_ft) for sector in load_sectors(bounds, cache)) if item]
    _, groups, snap = merged_levels(model, resolved)
    for item in resolved:
        item['prepared'] = prep(item['area'])
    rows, columns = model.dem.shape
    largest = {'plates': [], 'tiers': []}
    half = WIDTH_MM / 2 - step_mm
    for x in np.arange(-half, half + 1e-9, step_mm):
        for y in np.arange(-model.height_mm / 2 + step_mm, model.height_mm / 2 - step_mm + 1e-9, step_mm):
            here = [item for item in resolved if item['prepared'].contains(Point(x, y))]
            if not here:
                continue
            ground = model.z(model.dem[int((y / model.height_mm + 0.5) * (rows - 1)), int((x / WIDTH_MM + 0.5) * (columns - 1))])
            bottom = min(max(ground, model.z(item['floor']) if item['floor'] is not None else ground) for item in here)
            top = max(model.z(item['ceiling']) for item in here)
            for form in largest:
                marks = [bottom]
                for group in groups:
                    floors, ceilings, through = level_sets(here, snap, group[0])
                    if (floors + ceilings + through if form == 'plates' else floors + ceilings) and model.z(group[0]) >= ground:
                        marks.append(model.z(group[0]))
                marks.append(top)
                largest[form].append(max(b - a for a, b in zip(marks, marks[1:])))
    return {form: {'columns': len(values), 'medianMm': round(float(np.median(values)), 1), 'maxMm': round(float(np.max(values)), 1)} for form, values in largest.items()}


def measure_seams(name, cache, zooms=(7, 9, 11)):
    """Gaps and overlaps between neighbouring Class B and C sectors after a tile round trip, in model mm."""
    bounds = CROPS[name]
    sectors = load_sectors(bounds, cache, special_use=False)
    model = Model(bounds, 10, terrain(bounds, cache))
    crop = box(*bounds)
    original = unary_union([model.to_mm(sector['geometry']) for sector in sectors])
    results = []
    for zoom in zooms:
        for flags in ([], ['--detect-shared-borders']):
            with tempfile.TemporaryDirectory() as work:
                source = Path(work) / 'sectors.geojson'
                source.write_text(json.dumps({'type': 'FeatureCollection', 'features': [
                    {'type': 'Feature', 'properties': {'sector': index}, 'geometry': mapping(sector['geometry'])} for index, sector in enumerate(sectors)]}))
                tiles = Path(work) / 'sectors.mbtiles'
                subprocess.run(['tippecanoe', '--quiet', '--force', f'--output={tiles}', f'--minimum-zoom={zoom}', f'--maximum-zoom={zoom}', '--layer=v',
                                '--no-tiny-polygon-reduction', '--no-feature-limit', '--no-tile-size-limit', *flags, str(source)], check=True)
                decoded = json.loads(subprocess.run(['tippecanoe-decode', str(tiles)], check=True, capture_output=True, text=True).stdout)
            pieces = {}
            for tile in decoded['features']:
                # tippecanoe-decode writes buffered tile geometry in degrees; the tile's own square keeps buffers from overlapping.
                z, x, y = tile['properties']['zoom'], tile['properties']['x'], tile['properties']['y']
                n = 2 ** z
                tile_box = box(x / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))),
                               (x + 1) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))))
                for layer in tile['features']:
                    for item in layer['features']:
                        pieces.setdefault(item['properties']['sector'], []).append(shape(item['geometry']).buffer(0).intersection(tile_box))
            rebuilt = [model.to_mm(unary_union(group).intersection(crop)) for group in pieces.values()]
            gaps = original.difference(unary_union(rebuilt))
            gap_parts = [part for part in getattr(gaps, 'geoms', [gaps]) if not part.is_empty]
            overlap = sum(a.intersection(b).area for i, a in enumerate(rebuilt) for b in rebuilt[i + 1:] if a.intersects(b))
            results.append({'zoom': zoom, 'flags': ' '.join(flags) or 'none', 'gapMm2': round(gaps.area, 2), 'gapPieces': len(gap_parts),
                            'widestGapMm': round(max((2 * part.area / part.length for part in gap_parts if part.length), default=0), 3), 'overlapMm2': round(overlap, 2)})
    return results


def scene(name, exaggeration, cache, cap_ft):
    """Terrain sheets, plates, tiers and volume slices for a 3D mock, all in model millimetres."""
    bounds = CROPS[name]
    model = Model(bounds, exaggeration, terrain(bounds, cache))
    stack = model.stack_layers()
    resolved = [item for item in (resolve(model, sector, cap_ft) for sector in load_sectors(bounds, cache, classes=('B', 'C', 'D'))) if item]
    tint = lambda item: 'blue' if item['sector']['kind'] in BLUE else 'magenta'
    geojson = lambda geometry: [mapping(part) for part in parts(geometry)]
    _, groups, snap = merged_levels(model, resolved)
    levels = []
    for group in groups:
        z = model.z(group[0])
        floors, ceilings, through = level_sets(resolved, snap, group[0])
        above = [layer for index, layer in enumerate(stack) if (index + 1) * SHEET_MM > z - 0.5]
        clearance = unary_union(above).buffer(1.0) if above else None
        cut = lambda geometry: geometry.difference(clearance) if clearance is not None else geometry
        union = lambda members: piece([item['area'] for item in members])
        levels.append({
            'altitudeFt': round(group[0] / FEET), 'zMm': round(z, 2), 'mergedFt': [round(a / FEET) for a in group],
            'plate': geojson(cut(union(floors + ceilings + through))), 'frost': geojson(cut(union(floors + ceilings))),
            'lines': [mapping(item['area'].boundary) for item in through],
            'tiers': [{'tint': colour, 'polygons': geojson(cut(union([item for item in floors + ceilings if tint(item) == colour])))}
                      for colour in ('blue', 'magenta') if any(tint(item) == colour for item in floors + ceilings)],
        })
    top = max(model.z(item['ceiling']) for item in resolved)
    slices, z = [], SHEET_MM
    while z < top:
        altitude = model.base + (z - SHEET_MM) / model.mm_per_metre
        below = [layer for index, layer in enumerate(stack) if (index + 1) * SHEET_MM > z]
        for colour in ('blue', 'magenta'):
            present = [item['area'] for item in resolved if tint(item) == colour and (item['floor'] is None or item['floor'] <= altitude) and item['ceiling'] > altitude]
            if present:
                area = piece(present)
                slices.append({'zMm': round(z, 2), 'tint': colour, 'polygons': geojson(area.difference(unary_union(below)) if below else area)})
        z += ACRYLIC_MM
    return {'crop': name, 'exaggeration': round(model.exaggeration, 2), 'sheetMm': SHEET_MM, 'acrylicMm': ACRYLIC_MM, 'widthMm': WIDTH_MM, 'heightMm': round(model.height_mm, 1),
            'terrain': [{'index': index, 'zMm': index * SHEET_MM, 'polygons': geojson(layer)} for index, layer in enumerate(stack)],
            'levels': levels, 'volumes': slices}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['levels', 'gaps', 'seams', 'scene'])
    parser.add_argument('--crop', choices=sorted(CROPS), action='append', help='repeatable; every crop when omitted (levels)')
    parser.add_argument('--exaggeration', default='2,5,10,20', help='comma-separated; scene uses the first')
    parser.add_argument('--ceiling-cap-ft', type=int, default=18_000)
    parser.add_argument('--cache', type=Path, default=aviation.ROOT / '.topostack/faa')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    crops = args.crop or sorted(CROPS)
    exaggerations = [float(value) for value in args.exaggeration.split(',')]
    if args.command == 'levels':
        result = {name: measure_levels(name, exaggerations, args.cache, args.ceiling_cap_ft) for name in crops}
    elif args.command == 'gaps':
        result = {name: measure_gaps(name, exaggerations[0], args.cache, args.ceiling_cap_ft) for name in crops}
    elif args.command == 'seams':
        result = {name: measure_seams(name, args.cache) for name in crops}
    else:
        result = scene(crops[0], exaggerations[0], args.cache, args.ceiling_cap_ft)
    text = json.dumps(result, indent=1)
    if args.output:
        args.output.write_text(text + '\n')
    else:
        print(text)


if __name__ == '__main__':
    main()
