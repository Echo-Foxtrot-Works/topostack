# NOAA Great Lakes bathymetry

TopoStack uses NOAA/NCEI bathymetric grids for Lakes Superior, Michigan, Huron,
Erie, Ontario, and St. Clair. HydroLAKES supplies the water polygons. Additional surveyed coverage is documented in [lake-bathymetry.md](lake-bathymetry.md).
Lakes without survey coverage retain the HydroLAKES/GLOBathy basin model.

Sources: [NOAA Great Lakes bathymetry](https://www.ncei.noaa.gov/products/great-lakes-bathymetry),
with individual dataset DOIs in `scripts/data/noaa-great-lakes.json`.
Superior is a draft dataset. These are historical survey compilations, not live
water levels or uniformly dense modern sonar surveys.

## Data and geometry

- The builder downloads the five native 3-arc-second NAD83 GeoTIFF grids. It
  verifies each compressed source against the SHA-256 pins in
  `scripts/data/noaa-great-lakes-sources.json` before processing it.
- Native values are **elevations relative to each lake's low-water datum**:
  negative underwater, positive on land. They are not sea-level elevations.
  Only valid nonpositive samples are retained; land and NoData remain transparent.
  Do not substitute Grid Extract files, which use a different vertical reference.
- Depths are reprojected to Web Mercator tiles at zooms 0–11 with bilinear
  resampling. RGB encodes **positive depth in meters** using
  `R * 256 + G + B / 256 - 32768`. Alpha 0 means no coverage; alpha 255 means
  a valid sample. The numerical precision does not imply survey accuracy.
- The archive metadata identifies `depth-terrarium-v1`. The browser validates it,
  fetches at most 24 tiles, and samples at native pixel centers. This uses the
  numeric PNG decoder, never a browser canvas or color conversion.
- Survey depths are aligned to the terrain grid and attached only to the six
  matching HydroLAKES IDs. Name matching is a fallback for sources without IDs.
- Geometry anchors relative depths to the terrain's flat lake waterline. When
  the existing DEM already varies across the basin, the published HydroLAKES
  surface elevation supplies the anchor. This is a display alignment, not a
  geodetic vertical-datum transformation or current-water-level correction.
- NOAA data takes precedence over an existing basin model. Islands and elevated
  banks remain intact. The existing water-depth multiplier applies exactly once.
- Missing samples use existing bathymetric terrain or the basin model. Without
  enough information to model a clipped lake, uncovered cells stay at the
  waterline. Partial coverage is marked `mixed` and produces a warning. A
  maximum-depth override changes modeled fallback cells only.
- Archive failures preserve the existing terrain/model and add a visible export
  warning. Areas with no NOAA coverage do not trigger the archive request.
  `/ready` continues to require the global lake and vector archives; NOAA is
  optional. Attribution and the NOAA dataset version follow generated exports.

## Build

Use Python 3.11+ and the PMTiles CLI (tested with the locally installed CLI).
The Python dependencies are build-time only; no new browser dependency is needed.

```sh
python3 -m venv /tmp/topostack-noaa-venv
/tmp/topostack-noaa-venv/bin/pip install -r scripts/data-build/requirements.txt
/tmp/topostack-noaa-venv/bin/python scripts/data-build/test_noaa_bathymetry.py
/tmp/topostack-noaa-venv/bin/python scripts/data-build/build-noaa-bathymetry.py \
  --cache /tmp/topostack-noaa-inputs \
  --out /tmp/topostack-noaa-great-lakes-v1.pmtiles
```

The builder refuses to overwrite existing output/intermediate files. Retain the
PMTiles file and adjacent `.sources.json`; the intermediate `.mbtiles` can be
removed after verification. Source downloads are cached and checked on reuse.
A source pin mismatch requires reviewing NOAA's replacement before updating the pin.

The initial archive contains 2,572 PNG tiles, approximately 128 MiB. Its SHA-256 is
`2ed7b833b8ea3129cf3dceab9e74feabd4bf7761e4d947bf889a930096c66744`.
Build-library changes can alter PNG compression and the final digest even with
identical source grids; verify rebuilt outputs before recording a new digest.

## Provision

The existing provisioning script accepts `--source=noaa`. It checks the archive
encoding, zooms, dataset identity, and SHA-256, then uploads to the existing
`VECTOR_DATA` bucket at `bathymetry/noaa-great-lakes-v1.pmtiles`. Credentials remain
in `.env`. Development is the default:

```sh
node --env-file=.env scripts/provision/provision-lake-data.mjs \
  /tmp/topostack-noaa-great-lakes-v1.pmtiles --source=noaa --provision \
  --expected-sha256=2ed7b833b8ea3129cf3dceab9e74feabd4bf7761e4d947bf889a930096c66744
```

`--prod` additionally updates the production bucket and requires a pinned digest.
It has the same explicit production opt-in as existing lake provisioning.
Archive provisioning and application deployment are separate operations. The
updated Worker exposes `/v1/bathymetry/noaa-great-lakes-v1.pmtiles` through the
existing bounded Range/CORS/etag implementation. The updated frontend must also
be deployed to use it. No new Cloudflare binding or secret is needed.

For later data releases, change the versioned object key, catalogue dataset ID,
provisioner identity, and pins together; do not silently replace the meaning of
an existing version. Retain the prior archive and provisioning receipt for rollback.

## Live integration test

After provisioning development data, start an isolated local app:

```sh
VITE_MAP_API_PORT=8893 TOPOSTACK_WEB_PORT=5293 npm run dev
```

Then, in another terminal:

```sh
node scripts/verify/verify-noaa-live.mjs
```

This Chromium check downloads real depth tiles for all six covered lakes,
imports a Lake Erie project, generates terrain with depth disabled, enables
NOAA depth afterward, and verifies a complete fabrication export. It then blocks
NOAA requests and checks that the fallback remains exportable with a warning.
ZIPs, a screenshot, and the JSON report go to `topostack-noaa-validation` in the OS temp directory;
`TOPOSTACK_APP_URL` and `NOAA_TEST_OUTPUT` override the local URL and output path.
Run this separately from builds and coverage: their generated files can trigger
Vite reloads and invalidate an in-progress browser test.
