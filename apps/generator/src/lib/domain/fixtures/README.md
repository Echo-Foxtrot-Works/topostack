# West Point elevation regression fixtures

Unmodified Mapzen Terrarium tiles retrieved 2026-09-15:

- `west-point-z12.png`: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1206/1529.png
- `west-point-z15.png`: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/9652/12238.png

These contain upstream shoreline artifacts near West Point, NY, including native
pixels as low as -7,735 m beside near-sea-level terrain. Keep the original bytes
so tests cover PNG decoding and repair before interpolation, at multiple zooms.

Source attribution: Mapzen terrain tiles, compiled from open elevation datasets.
See https://github.com/tilezen/joerd/blob/master/docs/attribution.md and
https://github.com/tilezen/joerd/blob/master/docs/data-sources.md.

## NOAA Lake Erie depth tile

`noaa-erie-z11.png` is a numeric depth tile from the pinned NOAA Great Lakes
build. Its source is [NOAA/NCEI Lake Erie and Lake St. Clair bathymetry](https://doi.org/10.7289/V5KS6PHK).
RGB encodes positive depth using Terrarium's formula; transparent pixels have no
coverage. `noaa-erie-z11.json` records a small interior sample for testing pixel
center alignment. Source hashes are in `scripts/data/noaa-great-lakes-sources.json`.

`usgs-crater-z14` and `swiss-zug-z14` are numeric PNG tiles from the pinned survey
archives built by `scripts/build-survey-bathymetry.py`. Their adjacent JSON files
record dataset IDs, tile coordinates, sample bounds, and nine independently
decoded pixel values. Crater values are depths in meters; Swiss values are LN02
bed elevations in meters. Sources: USGS DDS-72 (public domain) and swisstopo
swissBATHY3D (open government data, © swisstopo).

## NRCan HRDEM Alexander Lake terrain

`hrdem-alexander-z14.png` and `hrdem-alexander-edge-z14.png` are terrain tiles
from the Alexander Lake regional HRDEM archive. The second includes transparent
pixels outside the registered build area. Adjacent JSON files record tile
coordinates, SHA-256 and independently decoded elevations. Source: Ontario West
Nipissing 2020 lidar, 1 m bare-earth DTM, CGVD2013, licensed under the Open
Government Licence – Canada. `scripts/data/hrdem-sources.json` pins the upstream
COG identity; `scripts/data/hrdem-builds.json` records the regional snapshot and
archive hashes. See `docs/hrdem-terrain.md` for reproduction.

## Lake Granby shoreline source-resolution regression

Unmodified Mapzen Terrarium tiles retrieved 2026-09-17:

- `granby-z10.png`: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/211/387.png
- `granby-z15.png`: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/6753/12388.png

The coarse tile has an elevation of -218 m at pixel (8, 34) and 3,091 m at
(11, 35) on Lake Granby's northeastern shore, near the reported Shadow Mountain
map center (40.1764, -105.8559). Finer source tiles put those locations near
2,525 m and 2,531 m. The negative-only spike repair cannot fix the entire cluster.
The loader regression uses the same shoreline crop with camera zooms 10 and 15
to verify that source resolution comes from the crop and preserves the plausible
native elevations without relying on spike repair. The regional crop also tests
the 24-tile request budget and 768-sample output-grid limit.

Source attribution: Mapzen terrain tiles, compiled from open elevation datasets,
including USGS NED. See the attribution links above.

## Monterey Bay seafloor

`gebco-monterey-z9.png` is tile `9/82/199` from the locally provisioned
`gebco-2026-ocean-v1` archive. Pixel (132, 147) contains a −314 m sounding
near 36.836767° N, 121.979828° W. The archive uses whole-metre elevations
from the public-domain GEBCO Compilation Group (2026) grid. [GEBCO 2026 Grid](https://www.gebco.net/data-products/gridded-bathymetry-data/gebco2026-grid).
