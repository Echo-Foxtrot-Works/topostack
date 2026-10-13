#!/usr/bin/env python3
# /// script
# requires-python = ">=3.13"
# dependencies = ["geopandas==1.2.0", "pyogrio==0.13.0", "pyarrow==26.0.0", "shapely==2.2.0", "matplotlib==3.11.2"]
# ///
"""Feasibility measurements for public and protected lands (docs/plans/public-lands.md).

Reproduces docs/reports/public-lands-spike-2026-10-13.md from the PAD-US 4.1
national geodatabase.

  classify   Map PAD-US features onto the land classes, dissolve each unit, and
             write units.parquet, class-stats.csv and lands.geojsonl.
  overlaps   Area each class shares with every other class inside CO, UT and CA.
  ownership  Share of each national forest and wildlife refuge outline that
             its agency owns in fee.
  tiles      Build a z4-z12 archive from lands.geojsonl and report tile sizes.
  render     Paint two crops by class under a priority order, before and after
             a 1 mm minimum feature at a 300 mm cut.

Usage (uv reads the dependencies above):
  uv run scripts/data-build/public-lands-spike.py classify --gdb PADUS4_1Geodatabase.gdb --out .topostack/padus/spike
  uv run scripts/data-build/public-lands-spike.py overlaps --states gdb/tl_2022_us_state.shp --out .topostack/padus/spike
  uv run scripts/data-build/public-lands-spike.py ownership --gdb PADUS4_1Geodatabase.gdb --out .topostack/padus/spike
  uv run scripts/data-build/public-lands-spike.py tiles --out .topostack/padus/spike
  uv run scripts/data-build/public-lands-spike.py render --out .topostack/padus/spike

The geodatabase comes from PADUS4_1Geodatabase.zip (1,523,434,496 bytes,
SHA-256 62ed113335e359509ad68a731146c74aa873c5a92da4f3fda572e54bc9b823ab),
https://www.sciencebase.gov/catalog/file/get/652d4fc5d34e44db0e2ee45e?name=PADUS4_1Geodatabase.zip
The zip also carries tl_2022_us_state.shp. `tiles` needs tippecanoe,
tippecanoe-decode and pmtiles on PATH.

GDAL's OpenFileGDB driver drops rows for some attribute filters on this
geodatabase (`Des_Tp = 'NWR'` on the Fee layer returns none), so every layer is
read whole and filtered here.
"""
import argparse
import itertools
import json
import math
from pathlib import Path
import re
import sqlite3
import subprocess

import geopandas as gpd
import pandas as pd
import pyogrio
import shapely

ACRE_M2 = 4046.8564224
COLUMNS = ['Des_Tp', 'Mang_Name', 'Unit_Nm', 'State_Nm', 'Pub_Access', 'GIS_Acres']
# Lowest first: a class paints over every class before it. Named units (parks,
# monuments) outrank wilderness, which covers most of many parks.
PRIORITY = ['blm', 'national-forest', 'wilderness', 'tribal', 'military', 'state-park', 'preserve', 'wildlife-refuge', 'national-monument', 'national-park']
COLOR = {'blm': '#e8c27a', 'national-forest': '#7fb069', 'tribal': '#c98b6b', 'military': '#9a9a9a', 'state-park': '#5aa9a1', 'preserve': '#a4c3b2',
         'wildlife-refuge': '#6c9bd2', 'national-park': '#2e7d32', 'national-monument': '#b5651d', 'wilderness': '#1b5e20'}
CROPS = {'romo': (-105.95, 40.12, -105.45, 40.55), 'moab': (-109.80, 38.45, -109.30, 38.80)}


def read_layer(gdb, layer, columns=COLUMNS):
    return pyogrio.read_dataframe(gdb, layer=f'PADUS4_1{layer}', columns=columns)


def proclamation_class(row):
    name = str(row.Unit_Nm)
    if row.Mang_Name == 'NPS':
        return 'national-monument' if 'National Monument' in name else 'national-park'
    if row.Mang_Name == 'FWS':
        return 'wildlife-refuge' if re.search('National Wildlife Refuge', name) else None
    return {'USFS': 'national-forest', 'DOD': 'military', 'TRIB': 'tribal'}.get(row.Mang_Name)


def fee_class(row):
    if row.Mang_Name == 'BLM':
        return 'blm'
    return {'SP': 'state-park', 'SREC': 'state-park', 'PCON': 'preserve', 'LCA': 'preserve'}.get(row.Des_Tp)


def classify(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    proc = read_layer(args.gdb, 'Proclamation')
    proc['cls'] = proc.apply(proclamation_class, axis=1)
    desg = read_layer(args.gdb, 'Designation')
    desg['cls'] = None
    desg.loc[desg.Des_Tp == 'WA', 'cls'] = 'wilderness'
    desg.loc[(desg.Des_Tp == 'NM') & desg.Mang_Name.isin(['BLM', 'USFS']), 'cls'] = 'national-monument'
    fee = read_layer(args.gdb, 'Fee')
    fee['cls'] = fee.apply(fee_class, axis=1)
    features = gpd.GeoDataFrame(pd.concat([proc, desg, fee], ignore_index=True), crs=proc.crs)
    features = features[features.cls.notna()].copy()
    features['geometry'] = shapely.make_valid(features.geometry.values)
    # One unit per class and name; BLM has no unit names, so it is one unit per state.
    features['unit'] = features.cls + ':' + features.Unit_Nm.fillna('').str.strip()
    features.loc[features.cls == 'blm', 'unit'] = 'blm:' + features.State_Nm
    features.loc[features.cls.isin(['preserve', 'state-park']), 'unit'] += ':' + features.State_Nm
    first = lambda values: values.dropna().iloc[0] if values.notna().any() else None  # noqa: E731
    units = features.dissolve(by='unit', aggfunc={'cls': 'first', 'Unit_Nm': first, 'Mang_Name': first, 'State_Nm': first}).reset_index()
    units['parts'] = shapely.get_num_geometries(units.geometry.values)
    units['vertices'] = shapely.get_num_coordinates(units.geometry.values)
    units['acres'] = units.geometry.area / ACRE_M2
    units.to_parquet(out / 'units.parquet')
    stats = units.groupby('cls').agg(units=('unit', 'size'), parts=('parts', 'sum'), vertices=('vertices', 'sum'), acres=('acres', 'sum'))
    stats.to_csv(out / 'class-stats.csv')
    print(f'{len(features)} features, {len(units)} units\n{stats.round(0).to_string()}')
    with open(out / 'lands.geojsonl', 'w') as handle:
        for row in units.to_crs(4326).itertuples():
            properties = {'class': row.cls, 'unit': row.unit, 'name': None if row.cls == 'blm' else row.Unit_Nm, 'manager': row.Mang_Name, 'acres': round(row.acres)}
            handle.write(json.dumps({'type': 'Feature', 'properties': properties, 'geometry': shapely.geometry.mapping(row.geometry)}) + '\n')


def overlaps(args):
    out = Path(args.out)
    units = gpd.read_parquet(out / 'units.parquet')
    states = gpd.read_file(args.states).to_crs(units.crs).set_index('STUSPS')
    rows = []
    for code in ('CO', 'UT', 'CA'):
        state = states.loc[code, 'geometry']
        classes = {cls: shapely.intersection(shapely.union_all(group.geometry.values), state) for cls, group in units[units.intersects(state)].groupby('cls')}
        for a, b in itertools.permutations(classes, 2):
            shared = shapely.intersection(classes[a], classes[b]).area
            if shared / classes[a].area > 0.005:
                rows.append({'state': code, 'class': a, 'within': b, 'acres': round(shared / ACRE_M2), 'share': round(shared / classes[a].area, 3)})
    table = pd.DataFrame(rows)
    table.to_csv(out / 'overlaps.csv', index=False)
    print(table.to_string(index=False))


def ownership(args):
    out = Path(args.out)
    units = gpd.read_parquet(out / 'units.parquet')
    fee = read_layer(args.gdb, 'Fee', ['Mang_Name'])
    for cls, manager in (('national-forest', 'USFS'), ('wildlife-refuge', 'FWS')):
        outlines = units[units.cls == cls].reset_index(drop=True)
        owned = fee[fee.Mang_Name == manager].copy()
        owned['geometry'] = shapely.make_valid(owned.geometry.values)
        pairs = gpd.sjoin(owned[['geometry']], outlines[['geometry']], predicate='intersects')
        area = {index: shapely.intersection(shapely.union_all(group.geometry.values), outlines.geometry[index]).area / ACRE_M2 for index, group in pairs.groupby('index_right')}
        outlines['owned'] = outlines.index.map(area).fillna(0)
        outlines['share'] = outlines.owned / outlines.acres
        outlines.drop(columns='geometry').to_csv(out / f'{cls}-ownership.csv', index=False)
        print(f'== {cls}: {len(outlines)} outlines, {outlines.acres.sum():.3g} acres, {outlines.owned.sum():.3g} owned by {manager}')
        for low, high in ((0, 0.05), (0.05, 0.25), (0.25, 0.75), (0.75, math.inf)):
            band = outlines[(outlines.share >= low) & (outlines.share < high)]
            print(f'   owned {low:.0%}-{high:.0%}: {len(band)} units, {band.acres.sum():.3g} outline acres')
        print(outlines[outlines.acres > 2e5].sort_values('share').head(8)[['Unit_Nm', 'acres', 'share']].round(3).to_string(index=False))


def tiles(args):
    out = Path(args.out)
    mbtiles, pmtiles = out / 'lands.mbtiles', out / 'lands.pmtiles'
    subprocess.run(['tippecanoe', '--force', f'--output={mbtiles}', '--minimum-zoom=4', '--maximum-zoom=12', '--layer=lands', '--drop-rate=1',
                    '--no-feature-limit', '--no-tile-size-limit', '--no-tiny-polygon-reduction', '--detect-shared-borders', '--read-parallel', '--quiet',
                    str(out / 'lands.geojsonl')], check=True)
    subprocess.run(['pmtiles', 'convert', str(mbtiles), str(pmtiles)], check=True, capture_output=True)
    print(f'{pmtiles.name}: {pmtiles.stat().st_size / 2**20:.0f} MiB')
    with sqlite3.connect(mbtiles) as db:
        for zoom, count, total, largest in db.execute('SELECT zoom_level, COUNT(*), SUM(LENGTH(tile_data)), MAX(LENGTH(tile_data)) FROM tiles GROUP BY zoom_level'):
            print(f'   z{zoom}: {count} tiles, {total / 2**20:.1f} MiB, largest {largest / 1024:.0f} KiB')


def render(args):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    out = Path(args.out)
    units = gpd.read_parquet(out / 'units.parquet')
    for name, bounds in CROPS.items():
        crop = gpd.GeoSeries([shapely.box(*bounds)], crs=4326).to_crs(units.crs).iloc[0]
        inside = units[units.intersects(crop)]
        classes = {cls: shapely.intersection(shapely.union_all(group.geometry.values), crop) for cls, group in inside.groupby('cls')}
        metres_per_mm = (crop.bounds[2] - crop.bounds[0]) / args.width_mm
        figure, axes = plt.subplots(1, 2, figsize=(16, 8))
        taken = shapely.Polygon()
        for cls in reversed(PRIORITY):
            if cls not in classes:
                continue
            own = shapely.difference(classes[cls], taken)
            taken = shapely.union(taken, classes[cls])
            opened = shapely.buffer(shapely.buffer(own, -0.5 * metres_per_mm, join_style='mitre'), 0.5 * metres_per_mm, join_style='mitre')
            for axis, shape in zip(axes, (own, opened)):
                gpd.GeoSeries([shape]).plot(ax=axis, color=COLOR[cls])
            lost = 1 - opened.area / own.area if own.area else 0
            print(f'{name} {cls}: {own.area / crop.area:.1%} of crop, {shapely.get_num_geometries(own)} parts, {shapely.get_num_geometries(opened)} after opening, {lost:.1%} area lost')
        for axis, title in zip(axes, ('priority applied', f'1 mm minimum feature at {args.width_mm} mm ({metres_per_mm:.0f} m/mm)')):
            gpd.GeoSeries([crop]).boundary.plot(ax=axis, color='black', linewidth=0.8)
            axis.set_title(f'{name}: {title}')
            axis.set_axis_off()
        axes[0].legend(handles=[Patch(color=COLOR[cls], label=cls) for cls in reversed(PRIORITY) if cls in classes], loc='lower left', fontsize=8)
        figure.tight_layout()
        figure.savefig(out / f'render-{name}.png', dpi=90)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    for name, needs in (('classify', ['gdb']), ('overlaps', ['states']), ('ownership', ['gdb']), ('tiles', []), ('render', [])):
        command = commands.add_parser(name)
        command.add_argument('--out', required=True)
        for option in needs:
            command.add_argument(f'--{option}', required=True)
        if name == 'render':
            command.add_argument('--width-mm', type=float, default=300)
    args = parser.parse_args()
    {'classify': classify, 'overlaps': overlaps, 'ownership': ownership, 'tiles': tiles, 'render': render}[args.command](args)


if __name__ == '__main__':
    main()
