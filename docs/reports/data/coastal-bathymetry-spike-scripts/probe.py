import json, sys, urllib.request
import rasterio
cov = json.load(open(sys.argv[1]))['coverage']['tampa']
def head(u):
    r = urllib.request.urlopen(urllib.request.Request(u, method='HEAD'), timeout=60)
    return int(r.headers['Content-Length'])
bt = cov['bluetopo']
print('bluetopo bytes', sum(head(t[3]) for t in bt), 'delivered', sorted({t[2] for t in bt}))
for kind in ('ninth', 'third'):
    for p in cov[kind]:
        print(kind, p['location'], head(p['URL']), p['URL'])
for u in (bt[0][3], cov['ninth'][0]['URL'], cov['third'][0]['URL']):
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR'):
        with rasterio.open(u) as s:
            print(u.split('/')[-1], s.crs.to_string()[:40], s.width, s.height, s.count, s.dtypes, s.nodata, s.res, 'ovr', s.overviews(1), 'block', s.block_shapes[0], s.compression, s.bounds)
            print('  tags', {k: v[:80] for k, v in s.tags().items()})
