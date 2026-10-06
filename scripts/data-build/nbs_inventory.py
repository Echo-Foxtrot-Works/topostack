"""Inventory NOAA National Bathymetric Source tiles over lakes.

NBS publishes one current version of each tile and replaces the tile scheme in
place, so every run records the scheme digest and each tile's published
SHA-256. Cells are classified from each tile's raster attribute table: survey
sources are measurements, "NBS Generalization" is a modelled fill, sources
named after a chart were digitized from an ENC, and any source whose licence is
not open (for example non-commercial or internal-use) is restricted.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request
from xml.etree import ElementTree

import fiona
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
from rasterio.warp import transform_geom
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

from terrain_release import atomic_write
from pinned import file_sha256

BUCKET = 'https://noaa-ocs-nationalbathymetry-pds.s3.amazonaws.com'
PRODUCTS = {
    'modeling': 'Test-and-Evaluation/Modeling/_Modeling_Tile_Scheme/',
    'bluetopo': 'BlueTopo/_BlueTopo_Tile_Scheme/',
}
GENERALIZATION = 'NBS Generalization'
CHART_SOURCE = re.compile(r'\bChart \d+')
# Licence spellings seen in NBS attribute tables that allow reuse with attribution at most.
OPEN_LICENSES = {'cc0-1.0', 'cc0.1.0', 'cc-by-4.0', 'cc-by', 'ccby'}
KINDS = ('survey', 'chart', 'restricted', 'generalization')
RAT_FIELDS = ('value', 'count', 'source_survey_id', 'source_institution',
              'survey_date_start', 'survey_date_end', 'license_name')
MEASURE_SIZE = 512


digest = file_sha256


def list_keys(prefix):
    """Return (key, size) for every object under prefix, following continuation tokens."""
    keys, token = [], None
    while True:
        url = f'{BUCKET}/?list-type=2&prefix={urllib.parse.quote(prefix)}'
        if token:
            url += f'&continuation-token={urllib.parse.quote(token)}'
        root = ElementTree.fromstring(urllib.request.urlopen(url, timeout=60).read())
        ns = {'s3': root.tag.split('}')[0].strip('{')}
        keys += [(item.findtext('s3:Key', namespaces=ns), int(item.findtext('s3:Size', namespaces=ns)))
                 for item in root.findall('s3:Contents', ns)]
        token = root.findtext('s3:NextContinuationToken', namespaces=ns)
        if not token:
            return keys


def fetch_scheme(cache, product):
    schemes = sorted(key for key, _ in list_keys(PRODUCTS[product]) if key.endswith('.gpkg'))
    if not schemes:
        raise RuntimeError(f'No {product} tile scheme published')
    key = schemes[-1]
    path = Path(cache) / Path(key).name
    if not path.exists():
        subprocess.run(['curl', '-fsSL', '--retry', '3', '--max-time', '600', '-o', path, f'{BUCKET}/{key}'], check=True)
    return {'product': product, 'key': key, 'sha256': digest(path)}, path


def read_scheme(path):
    """Delivered tiles with their published links, digests and lon/lat bounds."""
    tiles = []
    with fiona.open(path) as source:
        for feature in source:
            props = feature['properties']
            if not props.get('GeoTIFF_Link'):
                continue
            tiles.append({
                'tile': props['tile'],
                'url': props['GeoTIFF_Link'],
                'sha256': props['GeoTIFF_SHA256_Checksum'],
                'ratUrl': props['RAT_Link'],
                'ratSha256': props['RAT_SHA256_Checksum'],
                'resolution': props['Resolution'],
                'utmZone': props['UTM'],
                'delivered': props['Delivered_Date'],
                'bounds': [round(value, 6) for value in shape(feature['geometry']).bounds],
            })
    return tiles


def parse_rat(xml):
    """Rows of a GDAL .aux.xml raster attribute table, keyed by field name."""
    root = ElementTree.fromstring(xml)
    table = root.find('.//GDALRasterAttributeTable')
    if table is None:
        raise ValueError('No raster attribute table')
    names = [field.findtext('Name') for field in table.findall('FieldDefn')]
    missing = set(RAT_FIELDS) - set(names)
    if missing:
        raise ValueError(f'Raster attribute table lacks {sorted(missing)}')
    rows = []
    for row in table.findall('Row'):
        values = dict(zip(names, (cell.text or '' for cell in row.findall('F'))))
        rows.append({
            'value': int(values['value']),
            'count': int(values['count']),
            'source': values['source_survey_id'],
            'institution': values['source_institution'],
            'start': values['survey_date_start'],
            'end': values['survey_date_end'],
            'license': values['license_name'],
            'kind': source_kind(values['source_survey_id'], values['license_name']),
        })
    return rows


def normalize_license(name):
    """Lower-case, hyphenated licence name; a blank licence is 'unspecified' and never open."""
    return re.sub(r'\s+', '-', name.strip().lower()) or 'unspecified'


def source_kind(source, license_name):
    if source.startswith(GENERALIZATION):
        return 'generalization'
    if normalize_license(license_name) not in OPEN_LICENSES:
        return 'restricted'
    if CHART_SOURCE.search(source):
        return 'chart'
    return 'survey'


def summarize_rat(rows):
    """Cell counts by kind, survey years, institutions and licences for one tile."""
    cells = dict.fromkeys(KINDS, 0)
    for row in rows:
        cells[row['kind']] += row['count']
    surveys = [row for row in rows if row['kind'] == 'survey']
    years = sorted(int(row['start'][:4]) for row in surveys if row['start'][:4].isdigit())
    return {
        'cells': cells,
        'surveyYears': [years[0], years[-1]] if years else None,
        'institutions': sorted({row['institution'] for row in surveys if row['institution']}),
        'licenses': sorted({normalize_license(row['license']) for row in rows}),
    }


def fetch_rat(tile):
    for attempt in range(3):
        try:
            data = urllib.request.urlopen(tile['ratUrl'], timeout=60).read()
            break
        except OSError:
            if attempt == 2:
                raise
    if hashlib.sha256(data).hexdigest() != tile['ratSha256']:
        raise ValueError(f"{tile['tile']}: attribute table digest differs from the scheme")
    return parse_rat(data.decode())


def scan_tiles(tiles, workers=32):
    """Attach attribute-table summaries; tiles that fail are listed, not dropped silently."""
    def one(tile):
        try:
            rows = fetch_rat(tile)
            return {**tile, **summarize_rat(rows), 'valueKinds': {row['value']: row['kind'] for row in rows}}
        except (OSError, ValueError) as error:
            return {**tile, 'error': str(error)}
    with ThreadPoolExecutor(workers) as pool:
        return list(pool.map(one, tiles))


def read_lakes(path, id_field, name_field, area_field=None, min_area_km2=0.0):
    lakes = []
    with fiona.open(path) as source:
        if source.crs and source.crs.to_epsg() not in (None, 4326):
            raise ValueError('Lake polygons must be in EPSG:4326')
        for feature in source:
            props = feature['properties']
            if area_field and (props.get(area_field) or 0) < min_area_km2:
                continue
            lakes.append({'id': props[id_field], 'name': props.get(name_field) or '', 'geometry': shape(feature['geometry'])})
    return lakes


def match_lakes(tiles, lakes):
    """Candidate tiles per lake: delivered tiles whose bounds meet the lake polygon."""
    usable = [tile for tile in tiles if 'error' not in tile]
    boxes = [box(*tile['bounds']) for tile in usable]
    tree = STRtree(boxes)
    matches = []
    for lake in lakes:
        hits = [usable[i] for i in tree.query(lake['geometry'], predicate='intersects')]
        if hits:
            matches.append({**lake, 'tiles': hits})
    return matches


def measure_lake(lake, env_options=None):
    """Share of the lake's area covered by each kind of source.

    Reads each tile's contributor band at no more than MEASURE_SIZE pixels a side,
    so the fractions are estimates suitable for triage, not for building. They
    describe only the part of the lake inside delivered tiles (see footprint).
    """
    try:
        return measure_tiles(lake, env_options)
    except (OSError, rasterio.errors.RasterioError) as error:
        return {'error': str(error)}


def measure_tiles(lake, env_options):
    counted = dict.fromkeys(KINDS + ('empty',), 0)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', **(env_options or {})):
        for tile in lake['tiles']:
            # Clip before reprojecting: a whole Great Lake projected into a distant UTM zone distorts.
            part = lake['geometry'].intersection(box(*tile['bounds']))
            if part.is_empty:
                continue
            with rasterio.open(f"/vsicurl/{tile['url']}") as dataset:
                scale = max(1, math.ceil(max(dataset.width, dataset.height) / MEASURE_SIZE))
                shape_out = (math.ceil(dataset.height / scale), math.ceil(dataset.width / scale))
                elevation = dataset.read(1, out_shape=shape_out, resampling=Resampling.nearest, masked=True)
                contributor = dataset.read(3, out_shape=shape_out, resampling=Resampling.nearest)
                transform = from_bounds(*dataset.bounds, shape_out[1], shape_out[0])
                geometry = transform_geom('EPSG:4326', dataset.crs, mapping(part))
                inside = ~geometry_mask([geometry], shape_out, transform)
            for kind, count in classify_cells(inside, elevation, contributor, tile['valueKinds']).items():
                counted[kind] += count
    total = sum(counted.values())
    return {kind: round(count / total, 3) for kind, count in counted.items()} if total else None


def classify_cells(inside, elevation, contributor, value_kinds):
    """Count lake cells by the kind of source that supplied them; unknown contributors count as fill."""
    valid = inside & ~np.ma.getmaskarray(elevation)
    counts = {'empty': int((inside & ~valid).sum())}
    known = np.zeros(valid.shape, dtype=bool)
    for kind in ('survey', 'chart', 'restricted'):
        values = [value for value, name in value_kinds.items() if name == kind]
        cells = valid & np.isin(contributor, values)
        counts[kind] = int(cells.sum())
        known |= cells
    counts['generalization'] = int((valid & ~known).sum())
    return counts


def footprint(lake):
    """Share of the lake polygon inside delivered tile bounds (planar degrees; adequate for a ratio)."""
    area = lake['geometry'].area
    covered = lake['geometry'].intersection(unary_union([box(*tile['bounds']) for tile in lake['tiles']])).area
    return round(covered / area, 3) if area else None


def lake_record(lake, coverage):
    tiles = lake['tiles']
    years = [year for tile in tiles if tile.get('surveyYears') for year in tile['surveyYears']]
    return {
        'id': lake['id'],
        'name': lake['name'],
        'bounds': [round(value, 5) for value in lake['geometry'].bounds],
        'footprint': footprint(lake),
        'coverage': coverage,
        'surveyYears': [min(years), max(years)] if years else None,
        'resolutions': sorted({tile['resolution'] for tile in tiles}),
        'institutions': sorted({name for tile in tiles for name in tile.get('institutions', [])}),
        'tiles': [{key: tile[key] for key in ('tile', 'url', 'sha256', 'resolution', 'delivered')} for tile in tiles],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path, help='inventory JSON to write')
    parser.add_argument('--product', choices=sorted(PRODUCTS), default='modeling')
    parser.add_argument('--lakes', type=Path, help='lake polygons in EPSG:4326, e.g. HydroLAKES_polys_v10.shp')
    parser.add_argument('--id-field', default='Hylak_id')
    parser.add_argument('--name-field', default='Lake_name')
    parser.add_argument('--area-field', default='Lake_area', help='km²; empty to keep every polygon')
    parser.add_argument('--min-area-km2', type=float, default=0.5)
    parser.add_argument('--measure', action='store_true', help='read tiles to estimate surveyed share per lake')
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit(f'Refusing to overwrite {args.out}')
    args.cache.mkdir(parents=True, exist_ok=True)

    scheme, scheme_path = fetch_scheme(args.cache, args.product)
    tiles = scan_tiles(read_scheme(scheme_path))
    failed = [tile['tile'] for tile in tiles if 'error' in tile]
    inventory = {'scheme': scheme, 'tileCount': len(tiles), 'failedTiles': failed}
    if args.lakes:
        lakes = read_lakes(args.lakes, args.id_field, args.name_field, args.area_field or None, args.min_area_km2)
        matched = match_lakes(tiles, lakes)
        with ThreadPoolExecutor(8) as pool:
            coverage = list(pool.map(measure_lake, matched)) if args.measure else [None] * len(matched)
        inventory['lakes'] = [lake_record(lake, value) for lake, value in zip(matched, coverage)]
    inventory['tiles'] = [{key: value for key, value in tile.items() if key not in ('ratUrl', 'ratSha256', 'valueKinds')}
                          for tile in tiles]
    atomic_write(args.out, (json.dumps(inventory, indent=1) + '\n').encode())
    print(f"{len(tiles)} tiles, {len(failed)} unreadable, {len(inventory.get('lakes', []))} lakes -> {args.out}")


if __name__ == '__main__':
    main()
