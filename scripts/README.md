# scripts

Operational tooling, grouped by purpose. `lib/` holds shared helpers (among them `pinned-download.mjs` for sha256-pinned source files, `hash.mjs`, `main-module.mjs` for scripts that are also libraries, and `app-url.mjs`), `test/` the Node tests (`npm run test:scripts`), and `data/` the source catalogs that the app, the Worker, and these scripts all read.

Scripts that drive the studio in a browser read its address from `TOPOSTACK_APP_URL`, defaulting to the dev server `npm run dev` starts (`http://localhost:5273`, or `TOPOSTACK_WEB_PORT`). The older per-script variables (`SURVEY_TEST_APP_URL`, `CHART_STRESS_URL`, `TOPOSTACK_CAPTURE_URL` and others) still work. Deployment checks keep `PUBLIC_APP_URL` and `WORKER_URL`, which CI sets.

Every script below says how it is run. "manual" means no npm script or workflow invokes it; the linked runbook does.

## Build steps (`build/`)

Run by `npm run build` in the generator or by CI after a build.

| Script | Purpose | Run by |
| --- | --- | --- |
| `check-node.mjs` | Fail fast when the local Node.js release cannot run the script tests (needs native type stripping) | `npm run test:scripts` |
| `build-font-glyphs.mjs` | Convert the curated typefaces in `assets/fonts/` into the studio's glyph files and picker samples ([fonts.md](../docs/fonts.md)); `font-glyphs.test.mjs` fails when the committed output is stale | manual |
| `build-locator-data.mjs` | Build `apps/generator/src/lib/site/locator-data.json`, the Natural Earth map data behind the locator on each lake page, clipped to the area around the directory's lakes ([seo-operations.md](../docs/seo-operations.md)) | manual, when the lake directory reaches a new area |
| `check-web-budget.mjs` | Measure the built site against the JavaScript, CSS, and HTML budgets | `npm run budget:web` |
| `check-worker-bundle.mjs` | Hold the map-api Worker script to its gzip budget and fail when geometry code (clipper, contour tracing, generation, export) reaches it; reads the dry-run build in `workers/map-api/dist/` | `npm run budget:worker` (CI `build-and-budget`) |
| `configure-redirects.mjs` | Apply the Cloudflare redirect rules (www and legacy paths) to the zone | manual: [seo-operations.md](../docs/seo-operations.md), [development.md](../docs/development.md) |
| `finalize-static-headers.mjs` | Rewrite `_headers` for the selected site environment after a build | generator `build`; generator `build:e2e` |
| `generate-icons.mjs` | Regenerate favicons and app icons from `static/favicon.svg` | `npm run assets:icons` |
| `lock-lake-slugs.mjs` | Append a URL slug for every lake that newly qualifies for its own `/lake/<slug>` page to `apps/generator/src/lib/site/lake-slugs.json`; existing slugs never change ([seo-operations.md](../docs/seo-operations.md)) | manual, after a lake directory change; `lake-places.test.ts` fails until it has run |
| `prune-atomm-dist.mjs` | Drop the public site's images and example files from an Atomm build; no-op for other environments | generator `build` |
| `write-markdown-pages.mjs` | Write a Markdown twin (`index.md`, `guides/<slug>.md`, …) beside every prerendered site page, from its `<main>`, for the Worker's `Accept: text/markdown` negotiation; no-op for the Atomm build | generator `build`; generator `build:e2e` |
| `write-build-version.mjs` | Record git metadata for the About page in the built site | generator `build`; generator `build:e2e` |
| `write-third-party-licenses.mjs` | Write the licence notices for redistributed compiled code (the sheet-nesting engine) to `dist/licenses/third-party.txt` | generator `build`; generator `build:e2e` |
| `packages/nest-wasm/scripts/build.mjs` | Compile the sparrow nesting engine to WebAssembly into the committed `packages/nest-wasm/pkg/` (needs Rust, wasm-bindgen-cli and wasm-opt; see the [package README](../packages/nest-wasm/README.md)). With `--check`, it verifies `pkg/` was built from the current sources without needing Rust | `npm run build:nest-wasm` (manual); `--check` from the package `test` script; `nest-wasm.yml` workflow |

## Development and media capture (`dev/`)

Local helpers; nothing in CI depends on them.

| Script | Purpose | Run by |
| --- | --- | --- |
| `capture-feature-update.mjs` | Screenshot a feature for a release note or docs image | manual |
| `capture-preview-fixture.mjs` | Regenerate the bundled Crater Lake preview source (`sample-preview.generated.ts`) | manual |
| `capture-readme-assets.mjs` | Screenshot the studio and workflows for the README images | manual |
| `make-readme-media.mjs` | Turn the Atomm cover loop into the README's animated preview, `docs/images/topostack-stack.webp` (needs `ffmpeg` and `img2webp`, or `FFMPEG_PATH` / `IMG2WEBP_PATH`); see `docs/images/README.md` | manual |
| `atomm-native-capture.mjs` | Capture-only renderer access used by the listing script; preserves real meshes/materials and renders each motion frame at its output resolution; never ships in the app | helper |
| `capture-atomm-listing.mjs` | Capture current Atomm listing cards and videos (`TOPOSTACK_APP_URL=http://127.0.0.1:5284 node scripts/dev/capture-atomm-listing.mjs`; requires Playwright Chromium and `ffmpeg`, or `FFMPEG_PATH`); see `docs/images/README.md` | manual |
| `capture-atomm-tips.mjs` | Capture the Atomm Tips walkthrough pictures from the studio running as the embed (`node scripts/dev/capture-atomm-tips.mjs` against `npm run dev`; needs `cwebp`); see `docs/images/README.md` | manual |
| `capture-examples.mjs` | Generate each example project in the studio and save its render, sharing card and project file (`node scripts/dev/capture-examples.mjs [slug ...]` against `npm run dev`; needs `cwebp`) | manual |
| `capture-social-cards.mjs` | Draw the 1200×630 sharing cards for guides, hubs and lake regions into `apps/generator/static/images/cards/` from pictures already in the repository and the lake directory (`node scripts/dev/capture-social-cards.mjs [name ...]`; Playwright Chromium only, no dev server); see [seo-operations.md](../docs/seo-operations.md). Card layout: `lib/social-card.mjs` | manual |
| `render-lake-previews.mjs` | Render the top-down depth map for lake pages (`--sample`, `--slugs a,b` or `--all`) from the map API's terrain and survey data into `.topostack/lake-previews/` with a review page; resumable, uploads nothing (needs `cwebp`); see [seo-operations.md](../docs/seo-operations.md) | manual |
| `dev.mjs` | Start the generator and the map-api Worker together, picking free ports | `npm run dev` |

## Data builders (Python) (`data-build/`)

Raster and vector processing that needs rasterio, fiona, scipy, and shapely. One pinned environment: `pip install -r scripts/data-build/requirements.txt`. Tests: `npm run test:python`.

| Script | Purpose | Run by |
| --- | --- | --- |
| `benchmark-terrain.py` | Time the terrain packaging pipeline for a set of regions | manual |
| `build-faa-aviation.py` | Build the FAA aviation archive (airspace, special use airspace, runways, airports, navaids, obstacles) from the files pinned in `scripts/data/faa-aviation-sources.json`; needs `tippecanoe` and `pmtiles` | manual: [faa-aviation.md](../docs/faa-aviation.md) |
| `build-hrdem-terrain.py` | Package NRCan HRDEM rasters into terrain archives and register them in the catalog | manual: [hrdem-terrain.md](../docs/hrdem-terrain.md), [terrain-expansion-plan.md](../docs/terrain-expansion-plan.md) |
| `build-lake-directory.py` | Build the lake directory the site and studio search read | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md) |
| `build-lake-outlines.py` | Build provider lake outlines for the outline archive | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md) |
| `build-noaa-bathymetry.py` | Build Great Lakes depth tiles from NOAA/NCEI rasters | manual: [noaa-bathymetry.md](../docs/noaa-bathymetry.md) |
| `build-survey-bathymetry.py` | Build surveyed lake-floor archives from registered survey sources | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md) |
| `chart_records.py` | Turn the published depth chart records in `scripts/data/depth-charts/` into the `community-charts-v1` archive's grids and source pins (library for build-survey-bathymetry.py) | manual: [depth-chart-tracing.md](../docs/depth-chart-tracing.md) |
| `make-chart-trace-fixture.py` | Regenerate `packages/chart-trace/src/fixtures/tin-parity.json` from `survey_regions.contour_grid`, the parity target for the TypeScript TIN grid | manual, after changing `contour_grid`: [depth-chart-tracing.md](../docs/depth-chart-tracing.md) |
| `pinned.py` | `download()` (atomic, through a `.part` file) and `file_sha256()` for the builders' pinned sources (library for build-faa-aviation.py, build-noaa-bathymetry.py, tile_writer.py, nbs_inventory.py) | manual |
| `discover-terrain.py` | Discover and register candidate terrain sources for a region | manual: [terrain-coverage.md](../docs/terrain-coverage.md), [terrain-selection.md](../docs/terrain-selection.md), [terrain-expansion-plan.md](../docs/terrain-expansion-plan.md) |
| `nbs_inventory.py` | Inventory NOAA National Bathymetric Source tiles: record the scheme digest and each tile's published SHA-256, classify cells as survey, chart-derived or generalized fill from the attribute tables, and optionally match lake polygons and estimate each lake's surveyed share (`--lakes`, `--measure`) | manual: [noaa-lake-integration-plan.md](../docs/noaa-lake-integration-plan.md) |
| `select-enc-lakes.py` | Choose the chart-only lakes to build from the chart coverage data, refuse fixed-pool datums, assign regional datasets, and pin every ENC cell by edition and SHA-256 in `scripts/data/noaa-enc-sources.json` | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md#noaa-nautical-chart-lakes) |
| `select-nbs-lakes.py` | Choose the NBS lakes to ship from a canonical `nbs_inventory.py` run: keep lakes at least half surveyed, name them from the USGS National Hydrography Dataset, place them by county and state from Census TIGERweb, assign regional datasets, and pin the scheme, HydroLAKES and every tile and attribute table in `scripts/data/noaa-nbs-sources.json` | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md#noaa-national-bathymetric-source-lakes) |
| `survey_enc.py` | Grid a lake's depths from NOAA electronic chart (ENC) cells: contours and soundings from the most detailed cells first, shoreline at 0 m, lakes mostly charted as drying refused (library for build-survey-bathymetry.py) | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md#noaa-nautical-chart-lakes) |
| `survey_nbs.py` | Build the `noaa-nbs-*` archives from those pins: survey cells only, clipped to HydroLAKES, lakes perched above chart datum refused (library for build-survey-bathymetry.py) | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md#noaa-national-bathymetric-source-lakes) |
| `snapshot-survey-service.py` | Snapshot an ArcGIS layer as checksum-pinnable GeoJSON, for the survey builder and the FAA special use airspace | manual: [faa-aviation.md](../docs/faa-aviation.md) |
| `survey_regions.py` | Regional contour and reservoir adapters used by build-survey-bathymetry.py (library) | manual |
| `terrain_release.py` | Offline terrain registry helpers: immutable manifests and atomic catalog snapshots (library) | manual |
| `tile_writer.py` | Shared raster tile helpers for the survey bathymetry and HRDEM terrain builders (library) | manual: [terrain-expansion-plan.md](../docs/terrain-expansion-plan.md) |

One Node builder lives here too, because its output feeds the survey build:

| Script | Purpose | Run by |
| --- | --- | --- |
| `check-aviation-features.mjs` | Run every feature the FAA aviation builder wrote through the browser's `@topostack/data-contracts/aviation-tiles` parsers before tiling | `build-faa-aviation.py` |
| `trace-depth-charts.mjs` | Trace the curated charts in `scripts/data/depth-charts.json` into depth chart records with `@topostack/chart-trace`. Sources are downloaded to `.topostack/depth-charts/` and checked against their sha256 pins. Publishable records go to `scripts/data/depth-charts/`; the rest stay local with `report.json`. Scanned PDFs need poppler's `pdftoppm`. Library: `lib/depth-charts.mjs`. | manual: `node scripts/data-build/trace-depth-charts.mjs [--only <id>]`, see [depth-chart-tracing.md](../docs/depth-chart-tracing.md) |

## Provisioning (`provision/`)

Upload archives and catalogs to R2 and manage their lifecycle. Need Cloudflare credentials.

| Script | Purpose | Run by |
| --- | --- | --- |
| `build-lake-data.mjs` | Build the global lake bathymetry archive (needs tippecanoe) | manual: [data-and-fabrication.md](../docs/data-and-fabrication.md), [development.md](../docs/development.md) |
| `fetch-lake-outlines.mjs` | Fetch the pinned lake-outline release into the build directory before deploy | CI/workflows |
| `manage-cache-lifecycle.mjs` | Audit and apply the R2 cache lifecycle rules, with rollback receipts | `npm run data:cache-audit` |
| `provision-aviation-data.mjs` | Verify the FAA aviation archive against its registration and upload it to R2 | manual: [faa-aviation.md](../docs/faa-aviation.md) |
| `provision-lake-data.mjs` | Upload registered lake bathymetry and additional terrain archives to R2 | manual: [hrdem-terrain.md](../docs/hrdem-terrain.md), [data-layer-review.md](../docs/data-layer-review.md), [lake-bathymetry.md](../docs/lake-bathymetry.md), [data-and-fabrication.md](../docs/data-and-fabrication.md), [terrain-expansion-plan.md](../docs/terrain-expansion-plan.md), [data-layer-operations.md](../docs/data-layer-operations.md), [noaa-bathymetry.md](../docs/noaa-bathymetry.md), [development.md](../docs/development.md) |
| `provision-lake-previews.mjs` | Publish rendered lake-page depth previews: `--prepare` writes the pin for review, `--provision` uploads to the development bucket and `--provision --prod` to production, both before the pin merges | manual: [seo-operations.md](../docs/seo-operations.md) |
| `provision-lake-outlines.mjs` | Upload a lake-outline release to R2 and promote it | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md) |
| `provision-vector-data.mjs` | Upload the pinned Protomaps OSM archive to R2 | `npm run data:provision` |
| `prune-archives.mjs` | Delete superseded archive objects that no release points at | `npm run data:prune-archives` |

## Verification and monitoring (`verify/`)

Check deployed services, SEO output, and data quality. CI and the production monitors run several; the rest are manual checks named in the runbooks.

| Script | Purpose | Run by |
| --- | --- | --- |
| `stress-depth-charts.mjs` | Fetch pinned USGS charts; probe uploads, tracing, persistence, and screenshots | manual: [real-chart stress report](../docs/reports/real-depth-chart-stress-2026-09-23.md) |
| `benchmark-generation.mjs` | Profile 3000 × 3000 mm Grand Teton geometry and cached edits, optionally with parallel helpers and synthetic roads | `npm run build -w @topostack/core` then `node scripts/verify/benchmark-generation.mjs --teton --workers 4` |
| `generation-pool.mjs`, `generation-task-worker.mjs` | Adapt the production browser task pool to Node threads for the generation benchmark | Imported by `benchmark-generation.mjs`; not standalone commands |
| `parallel-browser.mjs` | Check production parallel workers, custom fonts, cancellation, and fallback in Chromium/Firefox/WebKit | Build core and generator, then `node scripts/verify/parallel-browser.mjs` (optional browser names) |
| `benchmark-data-layer.mjs` | Measure data-layer latency for representative projects (build core first) | `npm run data:benchmark` |
| `verify-atomm-dist.mjs` | Check the Atomm build output for forbidden endpoints and required files | CI/workflows |
| `verify-lake-directory.mjs` | Browser check of the lake directory and studio place links | `npm run data:verify-lake-directory` |
| `verify-lake-outlines.mjs` | Compare provider outlines against real survey archives in a browser | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md) |
| `verify-lake-search.mjs` | Browser check that every surveyed lake is findable in studio search | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md) |
| `verify-noaa-live.mjs` | Integration check of NOAA depth data against a local app and Worker | manual: [noaa-bathymetry.md](../docs/noaa-bathymetry.md) |
| `seo-pages.mjs` | Library, not run directly: every indexable page and what the SEO verifiers expect of it | imported by `verify-seo.mjs` and `verify-seo-http.mjs` |
| `verify-seo-http.mjs` | Check a deployed site's SEO responses (headers, sitemap, robots, redirects) | CI/workflows |
| `growth-baseline.mjs` | Read-only production usage and Web Analytics baseline, with sampling and availability; see [growth measurement](../docs/launch/measurement.md) | manual: `node --env-file-if-exists=.env scripts/verify/growth-baseline.mjs <from-ISO> <to-ISO> <output.json>` |
| `verify-seo.mjs` | Check the built site's metadata, sitemap, and structured data | CI/workflows |
| `verify-surveys-live.mjs` | Integration check of survey archives against a local app and Worker | manual: [lake-bathymetry.md](../docs/lake-bathymetry.md) |
| `verify-upstream-health.mjs` | Hourly monitor of the Worker's upstream cache-miss probes | CI/workflows |
| `verify-worker-deployment.mjs` | Hourly monitor of the deployed Worker and its data paths | CI/workflows |

## Release and Atomm packaging (`release/`)

The changelog, version consistency, and the Atomm marketplace bundle. See [changelog.md](../docs/changelog.md).

| Script | Purpose | Run by |
| --- | --- | --- |
| `changelog.mjs` | Scaffold, check, and verify changelog fragments; fold them into a release with its version bump; print release notes | `npm run changelog:new`; `npm run changelog:check`; `npm run changelog:pending`; `npm run changelog:verify`; `npm run changelog:prepare`; `npm run changelog:render`; `npm run changelog:notes`; CI/workflows |
| `checksum-atomm.mjs` | Write and verify the SHA-256 of the packaged Atomm ZIP | `npm run release:atomm` |
| `package-atomm-listing.mjs` | Package the Atomm marketplace listing (copy and cover assets) | `npm run package:atomm-listing` |
| `package-atomm.mjs` | Build and package the Atomm static artifact as a versioned ZIP | `npm run package:atomm` |
| `publish-atomm-release.mjs` | Tag, draft, upload, and publish the Atomm GitHub release for a version, with the changelog since the previous one | CI/workflows (automatically after production CI) |
| `validate-submission-env.mjs` | Fail-closed gate for Atomm packaging: the embedded map API URL must be production | run by `package-atomm.mjs`; also manual |
| `versions.mjs` | Check or bump the one release version across workspaces, the lockfile, and the Atomm manifest | `npm run version:check`; `npm run version:main`; CI/workflows |
- [`verify/chart-accuracy/`](verify/chart-accuracy/README.md): opt-in, pinned USGS charts and independent QA soundings; 20 raster variants, spatial error scoring, appearance diagnostics, and reproducible figures.

Reviewed depth-chart release checks and real-source capture instructions: [chart-release/README.md](verify/chart-release/README.md).

Reviewed Walden Pond announcement assets and project: [walden-example/README.md](verify/walden-example/README.md). The runbook covers source preparation, offline validation, and fresh-browser capture.
