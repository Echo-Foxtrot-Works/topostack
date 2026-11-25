import sys, json, zipfile, urllib.request
from pathlib import Path
sys.path.insert(0, 'scripts/data-build')
import fiona
from shapely.geometry import box, shape
import nbs_inventory as nbs

idx = Path(sys.argv[1])
SITES = {
 'tampa': (-82.85, 27.50, -82.35, 28.05),
 'charleston': (-80.05, 32.65, -79.75, 32.90),
 'outer-banks': (-75.80, 35.10, -75.40, 35.45),
 'galveston': (-95.00, 29.20, -94.65, 29.45),
 'miami': (-80.30, 25.65, -80.05, 25.90),
 'sf-bay': (-122.55, 37.70, -122.20, 37.95),
 'puget': (-122.60, 47.50, -122.25, 47.75),
 'san-diego': (-117.30, 32.60, -117.05, 32.80),
 'honolulu': (-158.00, 21.25, -157.75, 21.40),
 'anchorage': (-150.20, 61.10, -149.80, 61.30),
 'san-juan-pr': (-66.20, 18.40, -65.95, 18.50),
 'chesapeake': (-76.55, 38.90, -76.30, 39.10),
 'boston': (-71.10, 42.25, -70.85, 42.40),
}
meta, scheme = nbs.fetch_scheme(idx, 'bluetopo')
tiles = nbs.read_scheme(scheme)
print('bluetopo scheme', meta['key'], 'delivered tiles', len(tiles))
from collections import Counter
print('resolutions', Counter(t['resolution'] for t in tiles))
out = {}
cud = {}
for name, zipname, base in (('ninth', 'tileindex_NCEI_ninth_Topobathy_2014.zip', 'NCEI_ninth_Topobathy_2014_8483'), ('third', 'tileindex_NCEI_third_Topobathy_2014.zip', 'NCEI_third_Topobathy_2014_8580')):
    p = idx / zipname
    if not p.exists():
        url = f'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/{base}/{zipname}'
        try:
            urllib.request.urlretrieve(url, p)
        except Exception as e:
            url = f'https://coast.noaa.gov/htdata/raster2/elevation/{base}/{zipname}'
            urllib.request.urlretrieve(url, p)
    d = idx / name
    if not d.exists():
        zipfile.ZipFile(p).extractall(d)
    shp = next(d.rglob('*.shp'))
    with fiona.open(shp) as src:
        print(name, 'crs', src.crs, 'features', len(src), 'fields', list(src.schema['properties']))
        cud[name] = [(shape(f['geometry']), dict(f['properties'])) for f in src]
for site, b in SITES.items():
    g = box(*b)
    bt = [t for t in tiles if box(*t['bounds']).intersects(g)]
    row = {'bluetopo': [(t['tile'], t['resolution'], t['delivered'][:10] if t['delivered'] else None, t['url']) for t in bt]}
    for name, feats in cud.items():
        row[name] = [p for geom, p in feats if geom.intersects(g)]
    out[site] = row
    print(site, 'bluetopo', len(bt), Counter(t['resolution'] for t in bt), '| ninth', len(row['ninth']), '| third', len(row['third']))
json.dump({'sites': SITES, 'coverage': out}, open(idx / 'coverage.json', 'w'), indent=1, default=str)
