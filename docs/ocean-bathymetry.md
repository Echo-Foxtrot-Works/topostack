# Ocean bathymetry (GEBCO)

Sea floors come from the [GEBCO_2026 Grid](https://www.gebco.net/data-products/gridded-bathymetry-data/gebco2026-grid), a global terrain model with 15 arc-second spacing (about 460 m). It replaces Mapzen's ETOPO-class ocean, which has about 1.8 km spacing. The Japan spike measurements are in [reports/japan-fidelity-spike-2026-11.md](reports/japan-fidelity-spike-2026-11.md).

## How the studio uses it

- **Registration:** `gebco-2026-ocean-v1` is a terrain source of kind `bathymetry-grid`, with priority 100, zooms 0–9 and the `MSL` datum. See [terrain-selection.md](terrain-selection.md).
- **Where it applies:** it replaces only pixels that both GEBCO and the base terrain put at or below sea level. It never moves the coastline or lifts land, and tiles whose base terrain is all above sea level are never fetched.
- **Closer views:** requests finer than z9 are upsampled bilinearly from z9. Where GEBCO has no data, the base value stands in at the corners, so the coast feathers into the base over one GEBCO cell.
- **Depth in the model:** ocean depth reaches the model through the DEM, as before. `keepDemBasin` in `packages/core/src/water/water.ts` scales depths below sea level by the water depth exaggeration, so nothing in core changed.

## The coastline

A layered model's coast is its sea-level cut. Before slicing, `fitTerrainToCoastline` (`packages/core/src/water/water.ts`) makes the DEM agree with the OpenStreetMap ocean outline:

- Mapped sea the DEM has above sea level drops to −0.5 m.
- Land at or below sea level rises to +0.5 m where it reaches the sea through other such cells. This catches reclaimed land a dated DEM still shows as sea, while a polder behind a dike the DEM resolves keeps its depth.

The sea-level contour then runs between the two margins, on the vector shore. At Hiroshima Bay this moved the coast for 19% of the mapped sea and 1.8% of the land. Flat engravings draw the shore from the outline already and keep the DEM unchanged.

## The archive

- **Contents:**
  - **Zooms:** z0–9 PNG tiles in Terrarium encoding.
  - **Values:** elevations from −11,000 to +10 m, rounded to whole metres.
  - **Masking:** land (TID 0) and every sample at or above 0 m are transparent, and tiles without ocean are omitted.
  - **Size:** 220,138 addressed tiles cover the world's ocean at z0–9 in the published archive.
- **Building:**
  - **Resampling:** depth is reprojected to Web Mercator per z5 block, bilinear for depth and nearest for TID. The z6–8 levels are 2×2 means of valid samples, and z0–4 come from one global z5 mosaic.
  - **Tile boundaries:** every z9 tile lies inside one of GEBCO's eight 90° GeoTIFF tiles.
- **Pinning:** `scripts/data/gebco-sources.json` holds the source entry and its pin:
  - the ice-surface GeoTIFF zip by ETag, size and SHA-256 (`snapshotSha256`);
  - the TID zip by SHA-256 (`samplesSha256`).

## Build and provision

```bash
REQ="uv run --no-project --python 3.13 --with-requirements scripts/data-build/requirements.txt python"
# 4.24 GB and 96 MB from CEDA. macOS curl cannot complete CEDA's TLS handshake; use Python, and expect retries.
$REQ scripts/data-build/build-gebco-bathymetry.py \
  --grid .topostack/gebco/gebco_2026_geotiff.zip --tid .topostack/gebco/gebco_2026_tid_geotiff.zip \
  --out-dir .topostack/gebco/build-1 --register
node scripts/provision/provision-lake-data.mjs .topostack/gebco/build-1/gebco-2026-ocean-v1.pmtiles \
  --source=gebco-2026-ocean-v1 --provision --promote --expected-sha256=<receipt sha256> [--prod]
```

- `--bounds west,south,east,north` builds part of the world for a trial. A trial build is never registered.
- Full remote verification reads the whole multi-GB object back, which takes a while.

## Attribution

GEBCO Compilation Group (2026) GEBCO 2026 Grid. Public domain; free to use with attribution. Not for navigation.

The studio credits it whenever it contributes depths. Agent coverage answers list it under `terrain.ocean` and credit it for any area that may reach the sea.
