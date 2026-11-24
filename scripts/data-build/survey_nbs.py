"""NOAA National Bathymetric Source lakes for build-survey-bathymetry.py.

Pins come from scripts/data/noaa-nbs-sources.json (select-nbs-lakes.py). Each
pinned tile and attribute table is downloaded into the cache and checked
against its SHA-256, because NOAA replaces tiles in place. Only cells whose
contributor is a measured survey with an open licence are kept: modelled
fill ("NBS Generalization"), chart-digitized cells and restricted sources are
masked. Depth is the negated elevation, which is relative to the surveys'
chart datum (MLLW on tidal water, low-water datum on the Great Lakes), and
the browser anchors it to the terrain waterline as it does for NCEI's grids.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import zipfile

import fiona
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds, transform_geom
from rasterio.windows import Window, from_bounds as window_from_bounds
from shapely.geometry import mapping, shape

from nbs_inventory import parse_rat

ROOT = Path(__file__).resolve().parent.parent
PINS = ROOT / 'data/noaa-nbs-sources.json'
ELEVATION_BAND, CONTRIBUTOR_BAND = 1, 3
# The served grid is no finer than 8 m: zoom 14 pixels are 6.5-8.6 m across the covered latitudes.
MIN_RESOLUTION_M = 8
# Grow the HydroLAKES outline a little so bilinear tiling keeps the shoreline cells; the
# browser masks samples to the project's own lake polygon, so nothing outside reaches a lake.
OUTLINE_BUFFER_M = 30
# A lake whose surveyed bed lies mostly above chart datum is perched (a salt pond, a
# reservoir above tide) or mostly intertidal: its waterline is not the datum, and
# negating elevations would understate every depth. Such lakes are skipped.
MAX_ABOVE_DATUM_SHARE = 0.25
GRID_NOTE = ('NOAA National Bathymetric Source survey cells only; modelled fill is removed and '
             'uncovered parts use the basin model. Depths are below the surveys’ chart datum '
             '(MLLW on tidal water, low-water datum on the Great Lakes), not a live water level.')


def load_pins(dataset):
    pins = json.loads(PINS.read_text())
    lakes = [lake for lake in pins['lakes'] if lake['dataset'] == dataset]
    if not lakes:
        raise ValueError(f'No NBS lakes pinned for {dataset}')
    return pins, lakes


def survey_values(rows):
    """Contributor values of measured, openly licensed surveys."""
    return np.array(sorted(row['value'] for row in rows if row['kind'] == 'survey'), dtype=np.int64)


def survey_depths(elevation, contributor, keep):
    """Signed depths below chart datum from NBS elevations, keeping only cells supplied by `keep` contributors.

    Negative values are bed above the datum; they are kept so the lake can be
    judged (see MAX_ABOVE_DATUM_SHARE) before they are removed.
    """
    values = np.asarray(np.ma.filled(np.ma.asarray(elevation, dtype=np.float64), np.nan))
    depth = np.where(np.isin(contributor, keep) & np.isfinite(values), -values, np.nan)
    return np.where(depth <= 1500, depth, np.nan).astype(np.float32)


def above_datum_share(values):
    """Share of surveyed cells whose bed lies above chart datum."""
    surveyed = np.isfinite(values)
    return float((values[surveyed] < 0).sum() / surveyed.sum()) if surveyed.any() else 0.0


def utm_crs(longitude, latitude):
    zone = min(60, max(1, math.floor((longitude + 180) / 6) + 1))
    return f"EPSG:{32600 + zone if latitude >= 0 else 32700 + zone}"


def target_grid(outline, resolution):
    """Origin-snapped transform and shape covering an outline in projected metres."""
    left, bottom, right, top = outline.bounds
    left, bottom = math.floor(left / resolution) * resolution, math.floor(bottom / resolution) * resolution
    right, top = math.ceil(right / resolution) * resolution, math.ceil(top / resolution) * resolution
    shape_out = (round((top - bottom) / resolution), round((right - left) / resolution))
    return from_origin(left, top, resolution, resolution), shape_out


def pixel_window(window, width, height):
    """Whole-pixel window covering `window`, clipped to the raster; None when they do not meet."""
    left, top = max(0, math.floor(window.col_off)), max(0, math.floor(window.row_off))
    right = min(width, math.ceil(window.col_off + window.width))
    bottom = min(height, math.ceil(window.row_off + window.height))
    return Window(left, top, right - left, bottom - top) if right > left and bottom > top else None


def mosaic(tiles, outline, crs, resolution):
    """Survey depths from the lake's tiles on one grid; finer tiles win where tiles overlap."""
    transform, shape_out = target_grid(outline, resolution)
    result = np.full(shape_out, np.nan, dtype=np.float32)
    bounds = outline.bounds
    for path, keep in tiles:
        with rasterio.open(path) as src:
            window = pixel_window(window_from_bounds(*transform_bounds(crs, src.crs, *bounds), src.transform),
                                  src.width, src.height)
            if window is None:
                continue
            elevation = src.read(ELEVATION_BAND, window=window, masked=True)
            contributor = src.read(CONTRIBUTOR_BAND, window=window)
            depths = survey_depths(elevation, contributor, keep)
            if not np.isfinite(depths).any():
                continue
            part = np.full(shape_out, np.nan, dtype=np.float32)
            reproject(depths, part, src_transform=src.window_transform(window), src_crs=src.crs, src_nodata=np.nan,
                      dst_transform=transform, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.average)
        result = np.where(np.isnan(result), part, result)
    inside = geometry_mask([mapping(outline)], out_shape=shape_out, transform=transform, invert=True)
    result[~inside] = np.nan
    return result, transform


def fetch(pins, cache, download):
    """Download and verify every pinned tile and attribute table used by the lakes."""
    names = sorted({name for lake in pins['lakes'] for name in lake['tiles']})
    def one(name):
        tile = pins['tiles'][name]
        path = download({'id': name, 'url': tile['url'], 'sha256': tile['sha256'], 'file': f'nbs/{name}.tiff'}, cache)
        rat = download({'id': f'{name} attributes', 'url': tile['ratUrl'], 'sha256': tile['ratSha256'],
                        'file': f'nbs/{name}.tiff.aux.xml.pinned'}, cache)
        return name, (path, survey_values(parse_rat(rat.read_text())))
    with ThreadPoolExecutor(8) as pool:
        return dict(pool.map(one, names))


def hydrolakes(pins, cache, download, ids):
    """Selected HydroLAKES polygons from the pinned archive, extracting only the shapefile."""
    archive = download(pins['hydrolakes'], cache)
    extraction = cache / 'nbs-hydrolakes' / pins['hydrolakes']['sha256']
    shapefile = extraction / pins['hydrolakes']['shapefile']
    if not shapefile.exists():
        stem = pins['hydrolakes']['shapefile'].removesuffix('.shp')
        with zipfile.ZipFile(archive) as bundle:
            for suffix in ('.shp', '.shx', '.dbf', '.prj', '.cpg'):
                if stem + suffix in bundle.namelist():
                    bundle.extract(stem + suffix, extraction)
    polygons = {}
    with fiona.open(shapefile) as source:
        for feature in source:
            if feature['properties']['Hylak_id'] in ids:
                polygons[feature['properties']['Hylak_id']] = shape(feature['geometry'])
    missing = ids - polygons.keys()
    if missing:
        raise ValueError(f'HydroLAKES lacks pinned lakes: {sorted(missing)[:5]}')
    return polygons


def metres(resolution):
    """Pinned tile resolution such as '4m' in metres."""
    if not resolution.endswith('m'):
        raise ValueError(f'Unexpected NBS resolution: {resolution}')
    return float(resolution[:-1])


def prepare(polygon, tiles, prepared, write_grid):
    """Write one lake's survey depths, or return why it cannot be served.

    tiles are (resolution in metres, (path, survey values)).
    """
    centre = polygon.representative_point()
    crs = utm_crs(centre.x, centre.y)
    outline = shape(transform_geom('EPSG:4326', crs, mapping(polygon))).buffer(OUTLINE_BUFFER_M)
    ordered = sorted(tiles, key=lambda item: item[0])
    resolution = max(MIN_RESOLUTION_M, ordered[0][0])
    values, transform = mosaic([value for _, value in ordered], outline, crs, resolution)
    if not np.isfinite(values).any():
        return 'No survey cells inside the outline'
    above = above_datum_share(values)
    if above > MAX_ABOVE_DATUM_SHARE:
        return f'{round(above * 100)}% of the surveyed bed lies above chart datum; the lake surface is not referenced'
    values[values < 0] = np.nan
    write_grid(prepared, values, transform, crs)
    return None


def nbs(source, cache, writer, download, write_grid):
    pins, lakes = load_pins(source['id'])
    tiles = fetch({**pins, 'lakes': lakes}, cache, download)
    polygons = hydrolakes(pins, cache, download, {lake['hylakId'] for lake in lakes})
    skipped, used = [], set()
    for i, lake in enumerate(lakes):
        key = str(lake['hylakId'])
        # Tile digests and the recipe name the inputs, so a changed pin never reuses a stale prepared grid.
        recipe = json.dumps(['nbs-survey-grid-v2', ELEVATION_BAND, CONTRIBUTOR_BAND, MIN_RESOLUTION_M,
                             OUTLINE_BUFFER_M, MAX_ABOVE_DATUM_SHARE, pins['hydrolakes'],
                             [(name, pins['tiles'][name]) for name in lake['tiles']]], sort_keys=True)
        prepared = cache / 'nbs-prepared' / f"{key}-{hashlib.sha256(recipe.encode()).hexdigest()[:12]}.tif"
        lake_tiles = [(metres(pins['tiles'][name]['resolution']), tiles[name]) for name in lake['tiles']]
        reason = None if prepared.exists() else prepare(polygons[lake['hylakId']], lake_tiles, prepared, write_grid)
        if reason:
            skipped.append({'id': key, 'name': lake['title'], 'reason': reason})
            continue
        writer.add(prepared, key)
        if writer.grids[-1]['tilesWritten'] <= 0:
            skipped.append({'id': key, 'name': lake['title'], 'reason': 'No coverage at served tile resolution'})
        note = f"About {round(lake['surveyedShare'] * 100)}% of the lake is surveyed. " + GRID_NOTE
        writer.grids[-1].update(title=lake['title'], aliases=lake['aliases'], region=lake['region'], note=note)
        used.update(lake['tiles'])
        if i % 25 == 0:
            print(f"NBS {source['id']}: {i + 1}/{len(lakes)} lakes", flush=True)
    (cache / f"{source['id']}-skipped.json").write_text(json.dumps(skipped, indent=2) + '\n')
    print(f"NBS {source['id']}: {len(writer.grids)} lakes processed, {len(skipped)} skipped", flush=True)
    return [pins['hydrolakes'], {'id': 'nbs-scheme', **pins['scheme']}] + [
        {'id': name, **{k: pins['tiles'][name][k] for k in ('url', 'sha256', 'ratUrl', 'ratSha256', 'resolution')}}
        for name in sorted(used)]
