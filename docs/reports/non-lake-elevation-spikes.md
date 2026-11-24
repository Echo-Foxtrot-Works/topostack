# Mapzen elevation outliers in the country sweep

On November 22, 2026 (Mountain time), 17 sampled crops contained a raw Mapzen pixel below −450 m. Replaying the production tiles through the studio’s existing cleanup and resampling removed all values below −100 m from those 17 output grids. Two sites retained isolated false depressions. The working-tree change corrects the independently checked cells at both sites while preserving the finished ranges at the other 15. [Elevation cleanup](../../apps/generator/src/lib/domain/elevation-cleanup.ts) · [Studio terrain loader](../../apps/generator/src/lib/domain/elevation-loader.ts)

## Method

The input was the November 23 UTC country sweep, run against `https://topostack.app` with dataset `mapzen-terrarium+protomaps-20260905-z12-v1`. For every site whose raw minimum was below −450 m, reuse its original geographic rectangle. The table gives its center and half-width in metres. The country audit computes the precise Web Mercator bounds and records the tile coordinates. [Pinned sites](data/non-lake-country-sites.json) · [Country audit](../../scripts/verify/audit-country-data.mjs)

For each rectangle, run the same `fittingTileWindow(bounds, 15)` and `loadElevation(window, bounds)` used by the studio. Read the public Worker PNG tiles, apply the preferred sources listed in that production manifest, mosaic the native cells, repair spikes, then bilinearly resample the crop. Only Mapzen contributed to these output grids. Repeat using the same saved tile bytes with the previous repair rule, then with the revised rule. Where the country sweep used z14, also run the loader at z14. These are calls through the studio’s elevation path with Node and Vitest. This check ends at the elevation grid, before contour generation. [Tile selection](../../apps/generator/src/lib/domain/tile-math.ts) · [Source blending](../../apps/generator/src/lib/domain/terrain-sources.ts)

## Results

All studio windows fit at z15. Raw values use the sweep’s own zoom and native samples inside the crop. The next two columns give minima and maxima of the actual output grid in metres. Repair counts apply to native pixels in the **whole mosaic** fetched for the crop, including pixels outside its boundary.

| Site | Center latitude, longitude | Half-width m | Sweep zoom | Raw native range m | Prior studio range m | Revised studio range m | Native repairs, prior / revised |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CI · Yamoussoukro | 6.82055, -5.27674 | 500 | 15 | -9,696.0 … 223.9 | 116.5 … 223.9 | 125.7 … 223.9 | 65 / 67 |
| DO · Pico Duarte | 19.02288, -70.99808 | 900 | 14 | -7,370.7 … 3,099.1 | 2,382.1 … 3,099.2 | 2,382.1 … 3,099.2 | 512 / 512 |
| GS · Grytviken | -54.28111, -36.50920 | 500 | 14 | -1,967.7 … 199.7 | -3.3 … 200.4 | -3.3 … 200.4 | 205 / 205 |
| IL · Meron | 33.00002, 35.41009 | 900 | 14 | -7,631.4 … 1,199.0 | 738.4 … 1,199.0 | 738.4 … 1,199.0 | 512 / 512 |
| KP · Kosan | 38.85583, 127.41806 | 500 | 14 | -1,913.2 … 220.6 | 180.1 … 220.9 | 180.1 … 220.9 | 9 / 9 |
| LR · Monrovia | 6.30054, -10.79690 | 500 | 15 | -743.2 … 37.9 | -0.9 … 37.9 | -0.9 … 37.9 | 42 / 42 |
| MQ · Fort-de-France | 14.60365, -61.07418 | 200 | 15 | -1,216.4 … 71.0 | 1.9 … 71.4 | 1.9 … 71.4 | 36 / 36 |
| MS · Brades | 16.79183, -62.21058 | 200 | 15 | -2,160.9 … 69.5 | 10.8 … 69.7 | 10.8 … 69.7 | 148 / 148 |
| NU · Alofi | -19.05294, -169.91957 | 200 | 15 | -1,885.1 … 45.1 | 1.1 … 45.7 | 1.1 … 45.7 | 92 / 92 |
| PG · Port Moresby | -9.47723, 147.15089 | 500 | 15 | -22,777.6 … 123.4 | -3.8 … 124.4 | -3.8 … 124.4 | 456 / 456 |
| PM · Saint-Pierre | 46.77914, -56.17730 | 200 | 15 | -1,298.7 … 48.1 | 1.2 … 48.3 | 1.2 … 48.3 | 18 / 18 |
| PR · San Juan | 18.46633, -66.10572 | 500 | 15 | -595.4 … 28.4 | -4.5 … 28.3 | -4.5 … 28.3 | 39 / 39 |
| SB · Honiara | -9.43333, 159.95000 | 500 | 15 | -1,963.0 … 81.7 | -0.8 … 81.7 | -0.8 … 81.7 | 254 / 254 |
| SL · Freetown | 8.48714, -13.23560 | 500 | 15 | -1,031.6 … 112.9 | -0.6 … 112.8 | -0.6 … 112.8 | 61 / 61 |
| UA · Kyiv | 50.45466, 30.52380 | 500 | 14 | -1,346.2 … 194.0 | 23.2 … 194.0 | 91.0 … 194.0 | 11 / 14 |
| VC · Kingstown | 13.15527, -61.22742 | 200 | 15 | -1,736.2 … 13.9 | 0.3 … 13.8 | 0.3 … 13.8 | 446 / 446 |
| VU · Port-Vila | -17.73648, 168.31366 | 500 | 15 | -1,327.6 … 77.8 | -2.3 … 77.8 | -2.3 … 77.8 | 116 / 116 |

The five mountain, settlement or coastal crops below were also checked at the coarser sweep zoom. The first range here is the loader’s **resampled** crop with repair disabled. A raw native minimum can therefore be more extreme. The two repair rules produced identical ranges and counts at z14.

| Site | Zoom | Resampled without repair, m | Resampled with repair, m | Native repairs, prior / revised |
| --- | ---: | ---: | ---: | ---: |
| DO · Pico Duarte | 14 | -4,950.2 … 3,098.9 | 2,382.9 … 3,098.9 | 1,023 / 1,023 |
| GS · Grytviken | 14 | -1,583.6 … 200.1 | -3.3 … 200.1 | 21 / 21 |
| IL · Meron | 14 | -4,071.8 … 1,198.9 | 738.5 … 1,198.9 | 256 / 256 |
| KP · Kosan | 14 | -456.4 … 220.7 | 180.3 … 220.7 | 17 / 17 |
| UA · Kyiv | 14 | -451.9 … 194.0 | 91.2 … 194.0 | 13 / 13 |

## Two independent checks

The second check in the revised code only operates at z14 and finer. A native Mapzen depression must already have qualified for the original repair, with the surrounding median at least 30 m and a drop greater than 400 m. In its 8 × 8 pixel block and immediately adjacent blocks, the loader checks for one cell enclosed by eight base-terrain neighbors. The neighbors must all be at least 30 m above sea level, within 20 m of each other, and more than 100 m above the center. Their mean replaces the isolated cell. Preferred-source samples and their immediate neighbors are excluded. The regression cases exercise a coast, a slope, a continuous depression and preferred-source ownership. [Repair rules and tests](../../apps/generator/src/lib/domain/elevation-cleanup.test.ts)

| Native Mapzen sample center | Independent nearest GLO-30 surface elevation | What the tiles showed |
| --- | ---: | --- |
| Yamoussoukro, 6.81997345° N, 5.27251482° W | 197.75 m | A 24 m native cell was enclosed by cells at approximately 200–202 m. Its effect on the prior output minimum was 116.5 m. The revised pass repaired two additional native cells in the fetched mosaic. |
| Kyiv, 50.45680730° N, 30.53008318° E | 95.80 m | A −36 m native cell sat beside −549 and −568 m defects. The rest of the local surface was approximately 96–110 m. The revised output minimum was 91.0 m, compared with 23.2 m previously. |

The independent checks used GDAL nearest-pixel reads at the WGS84 coordinates above in the GLO-30 Public 2021 surface model, accessed November 22, 2026. Its nominal 30 m grid provides a coarser check of the surrounding surface. [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/) · [Yamoussoukro source COG](https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_N06_00_W006_00_DEM/Copernicus_DSM_COG_10_N06_00_W006_00_DEM.tif) · [Kyiv source COG](https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_N50_00_E030_00_DEM/Copernicus_DSM_COG_10_N50_00_E030_00_DEM.tif)

**Remaining limitation.** Yamoussoukro still contains a separate 63 m native cell at 6.81677756° N, 5.27521849° W. Its neighbors measure roughly 199–205 m and the independent GLO-30 cell measures 197.06 m. It lies outside the small neighborhood around confirmed severe defects and leaves the revised crop minimum at 125.7 m. The repair count or a successful tile read cannot certify the terrain throughout a crop.
