import sys, math, json
from pathlib import Path
from collections import Counter
sys.path.insert(0, 'scripts/data-build')
import fiona
from shapely.geometry import shape
import nbs_inventory as nbs
idx = Path(sys.argv[1])
scheme = sorted(idx.glob('BlueTopo_Tile_Scheme_*.gpkg'))[-1]
tiles = nbs.read_scheme(scheme)
REG = {'alaska': (-180, 50, -129, 72), 'hawaii': (-162, 18, -154, 23), 'pr-usvi': (-68, 17, -64, 19), 'great-lakes': (-93, 41, -76, 49.5),
       'washington': (-125.5, 46.2, -122, 49.1), 'oregon': (-125.5, 42, -123, 46.2), 'california': (-125.5, 32, -117, 42),
       'gulf': (-98, 24, -81.5, 31), 'atlantic-se': (-81.5, 24, -75, 36.5), 'atlantic-ne': (-77.5, 36.5, -66, 45.5), 'pacific-islands': (140, -15, 180, 22)}
def region(b):
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    for k, (w, s, e, n) in REG.items():
        if w <= cx <= e and s <= cy <= n: return k
    return 'other'
def ztiles(bounds, z):
    n = 2 ** z; out = set()
    for w, s, e, nn in bounds:
        x0, x1 = int((w + 180) / 360 * n), int((e + 180) / 360 * n)
        f = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
        for x in range(x0, x1 + 1):
            for y in range(f(nn), f(s) + 1): out.add((x, y))
    return len(out)
bb = [t['bounds'] for t in tiles]
print('bluetopo regions', Counter(region(b) for b in bb))
print('bluetopo z tiles', {z: ztiles(bb, z) for z in (11, 12, 13)})
d = sorted(t['delivered'][:10] for t in tiles if t['delivered'])
print('bluetopo delivered', d[0], d[len(d)//2], d[-1], 'last30d', sum(x >= '2026-10-25' for x in d), 'last90d', sum(x >= '2026-08-26' for x in d), 'of', len(d))
keys = nbs.list_keys('BlueTopo/')
tif = [s for k, s in keys if k.endswith('.tiff')]
print('bluetopo objects', len(tif), 'GB', round(sum(tif) / 1e9, 1))
for name in ('ninth', 'third'):
    with fiona.open(next((idx / name).rglob('*.shp'))) as src:
        fs = [(shape(f['geometry']).bounds, f['properties']['location']) for f in src]
    print(name, 'regions', Counter(region(b) for b, _ in fs), 'dirs', Counter(l.split('/')[0] for _, l in fs))
    print(name, 'years', Counter(l.split('_')[-1][:4] for _, l in fs))
    print(name, 'z tiles', {z: ztiles([b for b, _ in fs], z) for z in (11, 12, 13)})
