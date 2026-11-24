# Terrain source selection

Terrain generation selects registered bare-earth elevation sources by **location,
quality priority, native resolution, and acquisition year**, in that order. A
stable source ID resolves remaining ties. JSON catalog order has no effect.
Unknown acquisition years rank after known years; a mosaic publication date is
not treated as a survey date.

The current policy is `terrain-priority-v1`:

| Priority | Product | Coverage |
| --- | --- | --- |
| 300 | Approved lidar DTM, including NRCan HRDEM mosaics | Valid pixels within provisioned regions |
| 200 | Approved national DTM, including NRCan MRDEM-30 | Valid pixels within provisioned regions |
| 100 | Ocean bathymetry grid (`kind: "bathymetry-grid"`) | Pixels the base terrain already has at or below sea level |
| Fallback | Existing Mapzen composite | Existing worldwide terrain service |

Priority is a reviewed quality decision, not a claim that finer nominal pixels
always mean better accuracy. DSMs (including trees/buildings) must not be added as
DTMs. Native source resolution is distinct from delivered tile spacing and the
final project grid; current terrain tiles top out at zoom 15 and project grids
at 768 samples per axis.

Elevation tile zoom is selected from the crop bounds, independently of the
reference-map zoom: start at zoom 15 and step down until the crop fits the
24-tile budget. Decode and repair the stitched source raster, then resample it
to the bounded project grid. This avoids coarse-level source artifacts when
finer tiles are available, including the Lake Granby shoreline spikes in Mapzen's
zoom-10 tiles. Large crops can still require coarse tiles; this does not guarantee
that every upstream anomaly is removed. Vector and lake archive zoom selection
remains tied to the map zoom and each archive's limits.

## Coverage and failure behavior

Bounding boxes and the archive's minZoom are candidate filters. A request finer
than an archive's maxZoom reads the ancestor tiles at that zoom once each and
upsamples them bilinearly; a corner the archive leaves transparent takes the
base value, so a coarse grid feathers into the base terrain over one source cell.
Ocean grids (`bathymetry-grid`) only replace pixels that both they and the base
terrain put below sea level, and are never fetched for tiles whose base terrain
is all above it: they deepen the sea but never move the coastline or lift land.
Only valid decoded pixels claim coverage. Higher-ranked valid pixels are never overwritten; missing tiles
and transparent pixels fall through. A malformed or unavailable archive is
rejected atomically, leaving the next source and base terrain available. The base
service is still required to load successfully before overlays are applied.

The Studio **Terrain sources** details show each contributing source, weighted
share of output samples, native resolution when known, and vertical datum.
Unavailable candidates are reported. The same selection policy, contributions,
and attempted sources travel with geometry and export metadata. These fractions
measure interpolation contribution, not a survey accuracy or land-area estimate.

Registered sources declare one of three height systems, all orthometric metres
near mean sea level: `CGVD2013` (Canada), `JP-TP` (Japan's Tokyo Peil heights;
GSI's April 2025 JGD2024 revision moved them by at most +57/−67 cm, so both
generations share the label) and `MSL` (GEBCO ocean depths). Their mutual
offsets are under a metre, far below a laser-cut layer, so they mix without
transformation. Mapzen's composite datum is source-dependent; no vertical datum
correction is claimed. Mixed-source boundaries can still need review. A provider
whose heights are not near mean sea level (ellipsoidal heights, or a datum offset
of metres) needs a normalization step and fixtures before the validator accepts
a new label.

Valid samples depend on the kind: land models accept −500 to 9,000 m, and
`bathymetry-grid` sources −11,000 to +10 m (`terrainValueRange` in
`packages/data-contracts/src/source-catalog.ts`; `tile_writer.encode` takes the
same range when building).

## Sources awaiting approval

Some publishers require permission before their data is copied and served; Japan's
GSI elevation tiles need a Survey Act (測量法) approval. Such a source is registered
with `"availability": "development"` and `"approval": { "required": true }`:

- Development servers and the dev site load it; production and Atomm builds drop
  it (`apps/generator/src/lib/domain/data-environment.ts`), and so do their
  attribution pages.
- The production Worker answers its archive path with 404 and leaves it out of the
  manifest, coverage answers and MCP resources (`servedTerrainArchives` and
  `servedBathymetryArchives` in `workers/map-api/src/routes/archive.ts`).
- `provision-lake-data.mjs` refuses `--prod` for it.
- The catalog validator rejects `"availability": "all"` while the approval has no
  `reference`. Promotion is one change: add the approval number as
  `approval.reference`, set availability to `all`, and provision with `--prod`.

## Discover and prepare an area

`scripts/data-build/discover-terrain.py` queries the official NRCan STAC catalog for the 1 m
and 2 m HRDEM **DTM mosaics** and the MRDEM-30 DTM. Mosaic discovery avoids relying
on incomplete individual-project search footprints. A catalog hit is only a
candidate; actual raster NoData decides coverage during the build and at runtime.

```sh
python scripts/data-build/discover-terrain.py \
  --bounds=-82.57,46.56,-82.51,46.61 \
  --out-dir=/tmp/terrain-review

python scripts/data-build/discover-terrain.py \
  --bounds=-82.57,46.56,-82.51,46.61 \
  --out-dir=/tmp/terrain-build --build --register
```

Use the Python environment described in [HRDEM terrain](hrdem-terrain.md).
Discovery writes `candidates.json`. Build mode fetches bounded COG ranges, verifies
ETag/size before and after the read, rejects invalid elevations, and writes
immutable archives plus `builds.json` receipts. `--register` adds successfully
built sources and pins to the local catalog; it does **not** upload or deploy.
`--limit=1` builds only the highest-ranked candidate and may leave gaps on the base
source. Omit it to prepare all candidate fallbacks. Output directories must be new.

Archive IDs include a hash of bounds, URL and ETag, so different regions and source
updates cannot accidentally reuse a cached identity. Provision each archive with
the existing SHA-verified staging/promotion workflow in `hrdem-terrain.md`.
Commit registry/pins with the release after validation; publish assets before the
application catalog that refers to them.

## Scope and next providers

Runtime ranking is generic; acquisition currently supports Canada. This is not
an automatic worldwide lidar importer. Unprovisioned areas continue to use the
base composite, visibly. The next acquisition adapter should be USGS 3DEP, using
bare-earth product footprints and native resolution metadata. Other national or
regional DTMs can follow the same contract after license, datum, and quality
review. Do not add every global DSM ahead of an authoritative ground model solely
because its advertised pixel size is smaller.

Source acquisition is deliberately manual. Generating a project never creates
build jobs, discovers new providers, or changes the approved catalog. Operators
prepare, inspect, and publish versioned archives, then register their coverage.
Runtime automation is limited to selecting and combining those approved sources.

See [curated terrain coverage](terrain-coverage.md) for the initial country plan
and the distinction between operational coverage and candidate datasets.
