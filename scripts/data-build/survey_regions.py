"""Regional contour and reservoir adapters for build-survey-bathymetry.py.

All depths are positive metres. Interpolation stops at the measured contour hull
and explicit water mask, including islands; no shoreline depths are invented.
"""
from collections import defaultdict, deque
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
import math
from datetime import datetime, timezone

import fiona
import numpy as np
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import QhullError
from shapely import build_area
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

from terrain_release import atomic_write


def line_parts(geometry):
    if geometry.geom_type == 'LineString':
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from line_parts(part)


def contour_grid(points, water, resolution=20):
    """Return only surveyed interpolation support inside a lake's water polygon."""
    data = np.asarray(points, dtype=np.float64)
    if data.ndim != 2 or data.shape[1] != 3 or len(data) < 3:
        raise ValueError('Insufficient contour samples')
    if not np.isfinite(data).all() or np.any((data[:, 2] < 0) | (data[:, 2] > 1500)):
        raise ValueError('Invalid contour depths')
    xy, inverse = np.unique(data[:, :2], axis=0, return_inverse=True)
    # Contradictory values at identical locations must not depend on input order.
    lower = np.full(len(xy), np.inf)
    upper = np.full(len(xy), -np.inf)
    np.minimum.at(lower, inverse, data[:, 2])
    np.maximum.at(upper, inverse, data[:, 2])
    valid = upper - lower < 0.01
    xy, depths = xy[valid], lower[valid]
    if len(xy) < 3 or not np.any(depths > 0):
        raise ValueError('Insufficient unambiguous underwater contours')
    try:
        interpolate = LinearNDInterpolator(xy, depths, fill_value=np.nan)
    except QhullError as error:
        raise ValueError('Degenerate contour geometry') from error
    left, bottom, right, top = water.bounds
    # Bound memory and never create a regional-sized raster for a corrupt record.
    width, height = math.ceil((right-left)/resolution), math.ceil((top-bottom)/resolution)
    if width <= 0 or height <= 0 or width*height > 30_000_000:
        raise ValueError('Water mask has unsupported grid dimensions')
    transform = from_origin(left, top, resolution, resolution)
    x = left + (np.arange(width)+0.5)*resolution
    values = np.full((height, width), np.nan, dtype=np.float32)
    mask = geometry_mask([mapping(water)], out_shape=values.shape, transform=transform, invert=True)
    # Avoid expensive simplex searches on land, especially outside the sample
    # hull of long, irregular lakes. The same water-cell coordinates are used.
    for row in range(height):
        columns = mask[row]
        if columns.any():
            values[row, columns] = interpolate(x[columns], np.full(int(columns.sum()), top-(row+0.5)*resolution))
    if not np.isfinite(values).any() or np.nanmax(values) <= 0:
        raise ValueError('No gridded underwater coverage')
    return values, transform


def spatial_contours(path, cache, crs, depth_field, lake_field=None, depth_scale=1):
    """Create a spatially indexed working copy without holding a country in RAM."""
    with path.open('rb') as stream:
        source_digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    identity = hashlib.sha256((source_digest + str(crs) + depth_field + str(lake_field) + str(depth_scale) + 'v2').encode()).hexdigest()[:12]
    target = cache / f'contours-{identity}.gpkg'
    if target.exists():
        return target
    partial = target.with_suffix('.part.gpkg')
    if partial.exists():
        partial.unlink()
    with fiona.open('/vsigzip/' + str(path.resolve())) as src, fiona.open(
        partial, 'w', driver='GPKG', crs=crs, layer='contours',
        schema={'geometry': 'MultiLineString', 'properties': {'depth': 'float', 'lake': 'str', 'year': 'int'}}
    ) as dst:
        batch = []
        for feature in src:
            p = feature['properties']
            value = p[depth_field]
            if value is None or not feature['geometry']:
                continue
            depth = float(value) * depth_scale
            if not math.isfinite(depth) or not 0 <= depth <= 1500:
                continue
            geometry = transform_geom(src.crs, crs, dict(feature['geometry']))
            if geometry['type'] == 'LineString':
                geometry = {'type': 'MultiLineString', 'coordinates': [geometry['coordinates']]}
            if geometry['type'] != 'MultiLineString':
                continue
            date = p.get('SURVEY_DATE')
            year = datetime.fromtimestamp(date / 1000, timezone.utc).year if isinstance(date, (int, float)) else 0
            batch.append({'geometry': geometry, 'properties': {'depth': depth, 'lake': str(p[lake_field]) if lake_field else '', 'year': year}})
            if len(batch) >= 1000:
                dst.writerecords(batch)
                batch = []
        dst.writerecords(batch)
    partial.replace(target)
    return target


def prepare_regional_grid(job):
    key, title, water, latest, norway, contours, prepared, crs = job
    if prepared.exists():
        return key, title, prepared, None
    points = []
    with fiona.open(contours, layer='contours') as lines:
        for f in lines.filter(bbox=water.bounds):
            if norway and f['properties']['lake'] != key:
                continue
            if not norway and latest and f['properties']['year'] and f['properties']['year'] != latest:
                continue
            clipped = shape(f['geometry']).intersection(water)
            for part in line_parts(clipped):
                points.extend((v[0], v[1], f['properties']['depth']) for v in part.coords)
    try:
        values, transform = contour_grid(points, water)
    except ValueError as error:
        return key, title, prepared, str(error)
    import rasterio
    prepared.parent.mkdir(parents=True, exist_ok=True)
    partial = prepared.with_suffix('.part.tif')
    with rasterio.open(partial, 'w', driver='GTiff', height=values.shape[0], width=values.shape[1], count=1,
                       dtype='float32', crs=crs, transform=transform, nodata=np.nan, compress='deflate', tiled=True) as dst:
        dst.write(values, 1)
    partial.replace(prepared)
    return key, title, prepared, None


def prepare_regional_tiles(job):
    from importlib import import_module
    grid_job, source = job
    key, title, prepared, error = prepare_regional_grid(grid_job)
    if error:
        return key, title, None, None, error
    with prepared.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    identity = hashlib.sha256((checksum + json.dumps(source, sort_keys=True)).encode()).hexdigest()[:16]
    target = prepared.parent / f'{prepared.stem}-{identity}.pmtiles'
    receipt = target.with_suffix('.tiles.json')
    database = target.with_suffix('.mbtiles')
    if receipt.exists() and database.exists():
        grid = json.loads(receipt.read_text())
    else:
        if database.exists():
            database.unlink()  # Only an incomplete per-grid task cache.
        tile_writer = import_module('build-survey-bathymetry').TileWriter(target, source)
        tile_writer.add(prepared, key)
        grid = tile_writer.grids[0]
        tile_writer.db.close()
        # The receipt marks the per-grid cache complete, so write it atomically.
        atomic_write(receipt, json.dumps(grid).encode())
    if grid['tilesWritten'] == 0:
        return key, title, None, None, 'No coverage at served tile resolution'
    grid.update(title=title, aliases=[], note='Survey contours interpolated within available coverage; not a live water level.')
    return key, title, database, grid, None


def regional(pins, cache, writer, download, write_grid, region):
    paths = {p['role']: download(p, cache) for p in pins}
    norway = region == 'norway'
    crs = 'EPSG:25833' if norway else 'EPSG:3161'
    depth_field = 'dybde_m' if norway else 'DEPTH'
    key_field = 'vatnlnr' if norway else 'WBY_LID'
    name_field = 'innsjonavn' if norway else 'PROJECT_NAME'
    contours = spatial_contours(paths['contours'], cache, crs, depth_field, key_field if norway else None, 1 if norway else -1)
    # Cache meaning includes input pins; changed surveys cannot reuse stale grids.
    version = hashlib.sha256(json.dumps(pins, sort_keys=True).encode()).hexdigest()[:12]
    regions = defaultdict(list)
    with fiona.open('/vsigzip/' + str(paths['areas'].resolve())) as src:
        for feature in src:
            p = dict(feature['properties'])
            key = p[key_field]
            if not key or not feature['geometry']:
                continue
            if not norway and p.get('BATHYMETRY_LINE_IND') != 'Yes':
                continue
            geometry = shape(transform_geom(src.crs, crs, dict(feature['geometry'])))
            if not geometry.is_valid:
                geometry = geometry.buffer(0)
            if not geometry.is_empty:
                regions[str(key)].append((p, geometry))
    jobs = []
    for key, records in sorted(regions.items()):
        latest = 0
        if not norway:
            latest = max((p.get('SURVEY_YEAR') or 0) for p, _ in records)
            records = [(p, g) for p, g in records if (p.get('SURVEY_YEAR') or 0) == latest]
        water = unary_union([g for _, g in records])
        title = next((p[name_field].strip() for p, _ in records if p.get(name_field)), f'{region.title()} lake {key}')
        safe_key = hashlib.sha256(key.encode()).hexdigest()[:16]
        prepared = cache / f'{region}-{version}' / f'{safe_key}.tif'
        jobs.append(((key, title, water, latest, norway, contours, prepared, crs), writer.source))
    skipped = []
    # Keep at most eight jobs in flight. Ordered consumption preserves provider
    # priority and deterministic tile overlap even when preparation runs in parallel.
    with ProcessPoolExecutor(max_workers=4) as pool:
        pending = deque()
        remaining = iter(jobs)
        for job in remaining:
            pending.append(pool.submit(prepare_regional_tiles, job))
            if len(pending) == 8:
                break
        completed = 0
        while pending:
            result = pending.popleft().result()
            next_job = next(remaining, None)
            if next_job is not None:
                pending.append(pool.submit(prepare_regional_tiles, next_job))
            key, title, database, grid, error = result
            if error:
                skipped.append({'id': key, 'name': title, 'reason': error})
            else:
                writer.merge_tiles(database, grid)
            completed += 1
            if completed % 25 == 0:
                print(f'{region}: {completed}/{len(jobs)} lakes', flush=True)
    (cache / f'{region}-skipped.json').write_text(json.dumps(skipped, indent=2) + '\n')
    print(f'{region}: {len(writer.grids)} grids; {len(skipped)} skipped', flush=True)


def reservoirs(pins, cache, writer, download, unzip, write_grid):
    for pin in pins:
        archive = download(pin, cache)
        root = cache / 'reservoirs' / pin['id'] / pin['sha256'][:12]
        if not root.exists():
            unzip(archive, root)
        path = root / pin['path']
        recipe = hashlib.sha256(('reservoir-v1:' + json.dumps(pin, sort_keys=True)).encode()).hexdigest()[:12]
        prepared = root / f'depths-{recipe}.tif'
        if not prepared.exists():
            with fiona.open(path, **({'layer': pin['layer']} if pin.get('layer') else {})) as src:
                horizontal = dict(src.crs.to_dict())
                horizontal.pop('vunits', None)
                if fiona.crs.CRS.from_dict(horizontal).to_epsg() != pin['epsg']:
                    raise ValueError(f"Unexpected projection: {pin['id']}")
                source_crs = src.crs
                # Work in metres even when the source uses US survey feet.
                crs = pin['targetCrs']
                records = []
                for feature in src:
                    if feature['geometry'] and feature['properties'][pin['field']] is not None:
                        elevation = float(feature['properties'][pin['field']])
                        geometry = shape(transform_geom(source_crs, crs, dict(feature['geometry'])))
                        records.append((elevation, geometry))
            if pin.get('maskPath'):
                with fiona.open(root / pin['maskPath']) as masks:
                    water = unary_union([shape(transform_geom(masks.crs, crs, dict(f['geometry']))) for f in masks if f['geometry']])
            else:
                # Closed shallow survey contours give a conservative footprint.
                # Do not infer a waterline from the highest available bed value.
                outlines = [g for z, g in records if abs(z-pin['maskElevation']) < 0.001]
                water = build_area(unary_union(outlines))
                if water.geom_type == 'MultiPolygon':
                    water = max(water.geoms, key=lambda g: g.area)
            if water.is_empty or not water.is_valid or water.area < pin.get('minimumMaskAreaM2', 0):
                raise ValueError(f"No valid reservoir water mask: {pin['id']}")
            points = []
            for elevation, geometry in records:
                depth = (pin['surface']-elevation)*pin['scale']
                if not 0 <= depth <= 1500:
                    continue
                # Published contour vertices can be centimetres apart. A 1 m
                # geometric tolerance is below the 10 m served grid resolution.
                for part in line_parts(geometry.intersection(water).simplify(pin['contourSimplificationM'], preserve_topology=True)):
                    points.extend((v[0], v[1], depth) for v in part.coords)
            values, transform = contour_grid(points, water, resolution=10)
            if float(np.nanmax(values)) < pin.get('minimumMaximumDepthM', 0):
                raise ValueError(f"Survey depth range is inconsistent: {pin['id']}")
            write_grid(prepared, values, transform, crs)
        writer.add(prepared, pin['id'])
        writer.grids[-1].update(title=pin['name'], aliases=pin.get('aliases', []),
                               note=pin['verticalReference'])
        print(f"Reservoir: {pin['name']}", flush=True)
