import json, sys, urllib.request
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject
sys.path.insert(0, 'scripts/data-build')
import nbs_inventory as nbs

idx, out, sites = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:]
doc = json.load(open(idx / 'coverage.json'))
GEBCO = '.topostack/gebco/gebco_2026_geotiff.zip'
TID = '.topostack/gebco/gebco_2026_tid_geotiff.zip'
CELL = 1 / 3600

def gebco_name(zip_path, west, north):
    import zipfile
    for n in zipfile.ZipFile(zip_path).namelist():
        if not n.endswith('.tif'): continue
        with rasterio.open(f'/vsizip/{zip_path}/{n}') as s:
            b = s.bounds
            if b.left <= west < b.right and b.bottom < north <= b.top:
                return f'/vsizip/{zip_path}/{n}'

def warp(url, band, dst, transform, how, nodata=np.nan):
    with rasterio.open(url) as s:
        tmp = np.full(dst.shape, nodata, dtype=dst.dtype)
        reproject(rasterio.band(s, band), tmp, dst_transform=transform, dst_crs='EPSG:4326',
                  resampling=how, src_nodata=s.nodata, dst_nodata=nodata)
        return tmp

def stats(v):
    if v.size == 0: return None
    q = np.percentile(v, [1, 5, 25, 50, 75, 95, 99])
    return {'min': round(float(v.min()), 2), **{f'p{p}': round(float(x), 2) for p, x in zip([1, 5, 25, 50, 75, 95, 99], q)}}

def bands(depth, step, water_n):
    """Depth sheets a ladder at this step would cut: bands holding at least 0.5% of the water."""
    k = np.floor(-depth / step).astype(int)
    counts = np.bincount(k[k >= 0])
    return int((counts >= 0.005 * water_n).sum())

result = {}
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='2'):
    for site in sites:
        w, s_, e, n = doc['sites'][site]
        width, height = round((e - w) / CELL), round((n - s_) / CELL)
        T = from_bounds(w, s_, e, n, width, height)
        cov = doc['coverage'][site]
        cache = out / f'{site}.npz'
        if cache.exists():
            z = np.load(cache); bt, kind, cud, third, geb, tid = (z[k] for k in ('bt', 'kind', 'cud', 'third', 'geb', 'tid'))
        else:
            bt = np.full((height, width), np.nan, np.float32); kind = np.zeros((height, width), np.uint8)
            for tile, res, date, url in cov['bluetopo']:
                t = warp(url, 1, bt, T, Resampling.average)
                c = warp(url, 3, bt, T, Resampling.nearest)
                rat = nbs.parse_rat(urllib.request.urlopen(url + '.aux.xml', timeout=60).read())
                lut = {r['value']: 1 + nbs.KINDS.index(r['kind']) for r in rat}
                m = np.isfinite(t) & ~np.isfinite(bt)
                bt[m] = t[m]
                ck = np.zeros(c.shape, np.uint8)
                for v in np.unique(c[np.isfinite(c)]): ck[c == v] = lut.get(int(v), 0)
                kind[m] = ck[m]
            def mosaic(rows):
                a = np.full((height, width), np.nan, np.float32)
                for p in rows:
                    t = warp(p['URL'], 1, a, T, Resampling.average)
                    m = np.isfinite(t) & ~np.isfinite(a); a[m] = t[m]
                return a
            cud, third = mosaic(cov['ninth']), mosaic(cov['third'])
            geb = warp(gebco_name(GEBCO, w, n), 1, bt, T, Resampling.bilinear)
            tid = warp(gebco_name(TID, w, n), 1, np.zeros((height, width), np.float32), T, Resampling.nearest, nodata=0)
            np.savez_compressed(cache, bt=bt, kind=kind, cud=cud, third=third, geb=geb, tid=tid)
        # Water: where the best seamless source available says below datum. GEBCO is what ships today.
        ref = cud if np.isfinite(cud).any() else bt
        water = np.isfinite(ref) & (ref < 0)
        if not np.isfinite(cud).any(): water = np.isfinite(bt) & (bt < 0)
        wn = int(water.sum())
        r = {'grid': [width, height], 'waterCells': wn, 'tiles': {k: len(v) for k, v in cov.items()}}
        for name, a in (('gebco', geb), ('bluetopo', bt), ('cudem19', cud), ('cudem13', third)):
            ok = water & np.isfinite(a)
            below = ok & (a < 0)
            r[name] = {'coversWater': round(float(ok.sum() / wn), 4) if wn else None,
                       'belowDatumShare': round(float(below.sum() / wn), 4) if wn else None,
                       'depth': stats(a[below]),
                       'sheets': {f'{st}m': bands(a[below], st, wn) for st in (1, 2, 3, 5, 10)} if below.any() else None}
        kw = kind[water]
        r['bluetopo']['kinds'] = {'none': round(float((kw == 0).mean()), 4), **{k: round(float((kw == i + 1).mean()), 4) for i, k in enumerate(nbs.KINDS)}}
        tw = tid[water].astype(int)
        r['gebco']['tid'] = {str(int(v)): round(float((tw == v).mean()), 4) for v in np.unique(tw)}
        def diff(a, b, mask):
            m = mask & np.isfinite(a) & np.isfinite(b)
            if not m.any(): return None
            d = a[m] - b[m]
            return {'cells': int(m.sum()), 'median': round(float(np.median(d)), 2), 'p5': round(float(np.percentile(d, 5)), 2), 'p95': round(float(np.percentile(d, 95)), 2), 'medianAbs': round(float(np.median(np.abs(d))), 2)}
        r['diff'] = {'bluetopo-cudem19': diff(bt, cud, water), 'bluetopoSurvey-cudem19': diff(bt, cud, water & (kind == 1)),
                     'bluetopoFill-cudem19': diff(bt, cud, water & (kind == 4)), 'gebco-cudem19': diff(geb, cud, water), 'gebco-bluetopo': diff(geb, bt, water & np.isfinite(bt))}
        # BlueTopo cells that sit on land per CUDEM (interpolation spilling ashore).
        land = np.isfinite(cud) & (cud > 1)
        r['bluetopo']['onCudemLand'] = round(float((np.isfinite(bt) & land).sum() / max(1, land.sum())), 4)
        r['bluetopo']['belowDatumOnCudemLand'] = round(float(((bt < 0) & land).sum() / max(1, land.sum())), 4)
        result[site] = r
        print(site, json.dumps(r))
        import matplotlib; matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from matplotlib.colors import ListedColormap
        dmax = 16 if site != 'puget' else 250
        fig, ax = plt.subplots(1, 4, figsize=(22, 22 * height / width / 4 + 0.6), dpi=110)
        for a_, (title, a) in zip(ax, (('GEBCO_2026 (ships today)', geb), ('BlueTopo', bt), ('CUDEM 1/9', cud))):
            d = np.where(np.isfinite(a) & (a < 0), -a, np.nan)
            a_.imshow(np.where(np.isfinite(a) & (a >= 0), 1.0, np.nan), cmap=ListedColormap(['#d9d2c0']), extent=(w, e, s_, n), interpolation='nearest')
            im = a_.imshow(np.floor(np.clip(d, 0, dmax) / (dmax / 8)) * (dmax / 8), cmap='Blues', vmin=0, vmax=dmax, extent=(w, e, s_, n), interpolation='nearest')
            a_.set_title(f'{title}: {dmax/8:g} m depth bands'); a_.set_xticks([]); a_.set_yticks([])
        ax[3].imshow(np.where(kind > 0, kind, np.nan), cmap=ListedColormap(['#1b7837', '#fdae61', '#d7191c', '#bbbbbb']), vmin=1, vmax=4, extent=(w, e, s_, n), interpolation='nearest')
        ax[3].set_title('BlueTopo cell origin: green survey, orange chart, red restricted, grey fill'); ax[3].set_xticks([]); ax[3].set_yticks([])
        fig.tight_layout(); fig.savefig(out / f'{site}.png'); plt.close(fig)
json.dump(result, open(out / f'compare-{"-".join(sites)}.json', 'w'), indent=1)
