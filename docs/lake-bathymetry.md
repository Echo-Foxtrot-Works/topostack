# Surveyed lake-floor data

TopoStack supplements its HydroLAKES/GLOBathy basin models with public lake
surveys. This is a curated collection of usable datasets, not a claim of complete
worldwide survey coverage. Lake outlines come from pinned provider water masks, HydroLAKES, and an OSM fallback.
When two sources outline the same lake (each covers at least 80% of the other),
the lake keeps the identity and depth metadata it already had but is carved and
drawn along the more detailed shore, measured as vertices per length of shoreline.
Replacing a provider mask needs 1.5 times its detail, because survey depths are
masked to it. In a sample of 70 lakes (2026-10-09), HydroLAKES was the coarsest
outline wherever another existed: OSM had more detail in 63 of 63 lakes (median
2.7 times) and provider masks in 36 of 36. Provider masks and OSM were within about
5 m of each other; OSM cleared the 1.5 times margin in 5 of 39. Peters Pond in
Sandwich, Massachusetts, shows the difference: HydroLAKES draws it with edges up
to about 690 m. OSM water that also holds a river or a neighbouring lake is a
different shape and replaces nothing.

## Sources

| Source | Coverage | Values and processing |
| --- | --- | --- |
| [NOAA NCEI](https://www.ncei.noaa.gov/products/great-lakes-bathymetry) | Superior, Michigan, Huron, Erie, Ontario, St. Clair | Existing native 3-arc-second grids; depths below each lake's low-water datum. Superior remains a draft. |
| [USGS DDS-72](https://pubs.usgs.gov/dds/dds-72/site/data.htm) | Crater Lake | 2000 multibeam survey, 2 m native grid. Depth = 1882.6 m minus published bed elevation. |
| [USGS DDS-55](https://pubs.usgs.gov/dds/dds-55/pacmaps/lt_data.htm) | Lake Tahoe | 1998 multibeam survey, 10 m grid. Depth = 1899 m minus bed elevation, following the survey report. |
| [USGS MF-2393](https://pubs.usgs.gov/mf/2002/2393/) | Mono Lake | 10 m grid based on 1986–87 survey. Depth = (6390 ft minus bed elevation in feet) × 0.3048. |
| [Minnesota DNR](https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_dnr/water_lake_bathymetry/metadata/metadata.html) | 2,000 processed lake basins | Linear interpolation of the published survey contours onto a 20 m grid, clipped to DNR water outlines and islands. Source negative feet become positive meters. Ten basins with insufficient depth contours are omitted. |
| [swisstopo swissBATHY3D](https://www.swisstopo.admin.ch/en/height-model-swissbathy3d) | All 22 lake grids in the retrieved catalog | Native 1–3 m LN02 bed elevations averaged to 10 m for serving. Extent varies by lake. |
| [Finnish Environment Institute (Syke)](https://ckan.ymparisto.fi/dataset/jarvien-ja-jokien-syvyysaineisto) | 1,821 processed lakes with usable depth contours and depth-area masks | Linear interpolation of survey depth contours in meters onto a 20 m grid; no extrapolation outside the measured contour hull or depth-area mask. |

| [Ontario](https://data.ontario.ca/dataset/bathymetry-lines) | 3,396 processed waterbodies; 54 records skipped | Negative metre contours converted to positive depths; latest indexed survey, 20 m grid, lake mask and measured contour hull. |
| [Norway NVE](https://data.norge.no/nb/datasets/fa42a236-7881-4a15-a4f9-a69b3970f440/dybdekart) | 521 processed lakes; 7 records skipped | Digital depth contours joined to survey polygons, interpolated onto a masked 20 m grid. |
| [Texas Water Development Board](https://www.twdb.texas.gov/surfacewater/surveys/completed/index.asp) | Alan Henry, Lake Austin, Lady Bird Lake | Verified contour elevations and report reference levels; masked 10 m grid. Other reservoirs remain to be validated. |
| [Bureau of Reclamation](https://www.usbr.gov/tsc/techreferences/reservoir.html) | Estes, Flatiron, Pinewood | Verified historical reference levels and conservative closed-contour masks; 10 m grid. Other reservoirs remain to be validated. |
| [NOAA National Bathymetric Source](https://nauticalcharts.noaa.gov/learn/nbs.html) (`noaa-nbs-*-v1`, nine regional archives) | 237 US lakes, lagoons and coastal ponds, including Lake Pontchartrain, Lake Washington, Lake Pend Oreille, Lake Roosevelt, Lake Winnebago and the St. Johns River lakes | Measured, openly licensed survey cells only, averaged to 8 m and clipped to HydroLAKES. Depth below the surveys' chart datum, anchored to the waterline. See [below](#noaa-national-bathymetric-source-lakes). |
| [NOAA nautical charts](https://www.charts.noaa.gov/ENCs/ENCs.shtml) (`noaa-enc-*-v1`, eight regional archives) | 135 lakes with no survey grid, including Lake Okeechobee, Lake Champlain, Oneida, Seneca, Cayuga and Onondaga lakes, and Michigan's Inland Route and harbour lakes | Electronic chart contours and soundings, most detailed chart first, interpolated onto a 20 m grid inside HydroLAKES with the shoreline at 0 m. Depth below the chart datum. See [below](#noaa-nautical-chart-lakes). |
| Published depth charts (`community-charts-v1`) — built, not yet registered | Lake Viking, Missouri | Traced from published contour maps whose licence allows redistribution, one committed record per chart. Its archive builds from those records; registering it here is a provisioning pass described in [depth-chart-tracing.md](depth-chart-tracing.md). |

Swiss coverage includes Ägeri, Baldegg, Biel, Constance, Brienz, Hallwil, Joux,
Geneva, Neuchâtel, Maggiore (Swiss portion), Lungern, Morat, Rotsee, Sarnen,
Sempach, Sils, Silvaplana, Thun, Lucerne, Walensee, Zürich (main lake), and Zug.
Some shorelines and survey holes remain uncovered.

[scripts/data/lake-survey-builds.json](../scripts/data/lake-survey-builds.json)
records initial archive sizes/digests, processed-grid counts, and skipped lake IDs.
Finnish depth areas without lake identifiers are excluded; shoreline-only or
degenerate contour records retain the existing fallback.

Swiss data store absolute **bed elevations**, not water depths. For each lake,
the loader subtracts these values from its HydroLAKES surface elevation. That
alignment is approximate: HydroLAKES and LN02 are not transformed to a common
vertical datum. It preserves surveyed bed shape, but the absolute depth can
include reference-level error. A missing surface reference produces a fallback
warning rather than a guessed depth.

All surveys are historical. The USGS reference levels and HydroLAKES outlines
are not live water levels. Contour-derived rasters are **survey-derived interpolations**, not new sonar
measurements. Resolution and numeric encoding
precision do not imply equivalent survey accuracy.

## Loading and fallback

- `scripts/data/lake-bathymetry.json` is the shared source registry used by the
  browser, gateway allowlist, and provisioning script.
- The browser requests only providers whose bounds intersect the crop, with at
  most 24 tiles per provider. It samples numeric PNG values without canvas color
  conversion. Each provider is loaded once even when several lakes are present.
- Samples are masked against each project's lake polygon, including islands.
  Neighboring lakes cannot acquire a source merely because they share a tile.
- Providers are ordered by priority. Later providers fill missing pixels without
  replacing earlier valid samples. NOAA's lake-ID checks remain in place.
- Missing pixels use the existing terrain or basin model. A failed provider does
  not discard data from another provider. Partial availability produces a warning.
- Attribution and dataset versions are recorded only when that provider supplies
  samples to a lake. Retries replace old survey provenance to avoid stale claims.
- Turning depth on after generation loads the surveys. Changing the depth scale
  reuses a successful load. Depth remains relative to the terrain's vertical scale.

The PNG encodings are `depth-terrarium-v1` and `elevation-terrarium-v1`:
`R * 256 + G + B / 256 - 32768`, in meters; alpha 0 is missing data. Only the
registered dataset/encoding/maximum zoom combination is accepted. Small lakes
may have no tiles at low zooms; their PMTiles minimum zoom need not be zero.

## Reproducible builds

Use Python 3.13 (compatible wheels are available for all GIS dependencies), curl,
and the PMTiles CLI. The runtime web application has no new dependencies.

```sh
python3.13 -m venv /tmp/topostack-surveys-venv
/tmp/topostack-surveys-venv/bin/pip install -r scripts/data-build/requirements.txt
/tmp/topostack-surveys-venv/bin/python scripts/data-build/test_survey_bathymetry.py
/tmp/topostack-surveys-venv/bin/python scripts/data-build/build-survey-bathymetry.py \
  --cache /tmp/topostack-lake-surveys \
  --out-dir /tmp/topostack-survey-archives
```

Use `--dataset usgs-crater-lake-v1` (or another registry ID) to build one archive.
The existing NOAA builder is documented in [noaa-bathymetry.md](noaa-bathymetry.md).

Downloads are checked against SHA-256 pins in
`scripts/data/lake-survey-sources.json`. Above-water values and invalid samples
are excluded before numeric encoding. Source ZIP paths are checked before
extraction; the oddly named Crater Lake `.tgz` is actually a ZIP containing a TAR.
Tahoe's legacy floating-point E00 grid is decoded and its dimensions checked.
Each E00 grid row starts on a new line: DDS-55 pads its 1,992-cell rows to 1,995
values. Archives built before 2026-09-21 read the values as one stream, which
sheared the lake floor into east–west bands; rebuild and reprovision Tahoe from
the receipt in `lake-survey-builds.json`.

The builder refuses existing PMTiles/MBTiles output paths. Each output has a
`.sources.json` receipt containing input pins, output digest, grid extents, and
tile count. Regional skipped records are saved in the cache directory. Prepared
grids in the cache speed reruns; delete those prepared grids when changing the
processing algorithm, and use a new dataset version for changed source meaning.

## Provisioning and deployment

Archives use versioned keys in the existing `VECTOR_DATA` bucket. No new Worker
binding or secret is required. Provision each completed archive with its receipt's
SHA-256, for example:

```sh
node --env-file=.env scripts/provision/provision-lake-data.mjs \
  /tmp/topostack-survey-archives/usgs-crater-lake-v1.pmtiles \
  --source=usgs-crater-lake-v1 --provision --expected-sha256=<receipt-sha256>
```

Development is the default. `--prod` additionally provisions production and
requires a digest. Provisioning data and deploying the app are separate steps.
The gateway exposes only registered `/v1/bathymetry/<dataset>.pmtiles` paths,
using its existing bounded Range/CORS/cache handling. Surveys are optional for
`/ready`, and existing archives remain available for rollback.

## Validation

```sh
VITE_MAP_API_PORT=8893 TOPOSTACK_WEB_PORT=5293 npm run dev
# In another terminal, after development archives have been provisioned:
node scripts/verify/verify-surveys-live.mjs
# To check only Finland after adding its archive:
node scripts/verify/verify-surveys-live.mjs --dataset=syke-finland-lakes-v1 --coverage-only
```

The browser check uses real HydroLAKES polygons and real depth archives, checks
new source coverage, and generates a Crater Lake fabrication ZIP after enabling
depth. It then interrupts survey requests and verifies warning-bearing fallback
exports. Reports and ZIPs are written to `topostack-survey-validation` in the OS temp directory (`SURVEY_TEST_OUTPUT` overrides).
Run it separately from builds/coverage to avoid Vite reloads during the test.
`SURVEY_TEST_BROWSER=firefox` or `webkit` selects another installed Playwright
browser; Chromium is the default.

The committed fixtures contain small real Crater Lake and Swiss PNG tiles with
expected numeric samples. Unit tests also check per-lake masking, different
surface references, missing references, source failures, and provenance retries.

## Other catalogs investigated

There is no single complete public lake-survey feed. Additional candidates need
source-specific validation before being added to the registry:

- NOAA's other lake depths (NBS Modeling/BlueTopo grids, CUDEM, and nautical
  chart ENCs) are listed lake by lake in the
  [NOAA lake depth coverage report](reports/noaa-lake-coverage-2026-09-24.md).
  NCEI's Great Lakes product itself has no lakes beyond the six already used.
- Yellowstone SIM 2973's downloadable GIS package lists geological polygons,
  faults, vents, and flow arrows; its bathymetry presentation is not a verified
  numeric bed grid in that package.
- Lake Mead OFR 03-320 combines surveyed areas, pre-impoundment contour models,
  and surrounding terrain. Its vertical units/reference and survey footprint
  must be established before using its composite raster as lake depths.
- DAHITI offers lake bathymetry downloads behind registration.
- GLOBathy and 3D-LAKES provide much broader **estimated** bathymetry. They must
  retain modeled provenance and should not be labeled as measured surveys.

Adding a source requires verified redistribution terms, numeric depth/elevation
values and units, a known horizontal reference, appropriate lake masks, source
pins, and regression samples. Raster-looking shaded-relief images are not depth
rasters. Coverage remains limited to valid samples and available lake outlines.

## Fit lake depth to available layers

In the **Water** panel, under **Water depth**, enable **Fit lake depth to available layers**, or choose **Fit depth** in the clipping warning. The setting defaults to off, including for older saved projects.

When a lake exceeds the stack floor, fitting compresses all its depths by the same factor around its waterline. Each lake fits independently; shallower lakes keep their requested depth scale. Land, islands, and ocean depths keep their existing behavior. The material thickness and layer budget still limit the detail the model can resolve. If no depth fits below a lake's waterline, the clipping warning remains.

The depth exaggeration control remains the requested multiplier. Each fitted lake displays its effective multiplier relative to terrain and percentage of requested depth. The exported project JSON records the setting, per-lake compression, effective multiplier, and bed elevation before fitting; the fabrication README also lists applied scales. Turning fitting off restores the requested depths from the original source data. Fitting stays enabled after a refresh because it is saved with the project; the preview shows **Use manual depth** while it is enabled. The **Fit depth** warning takes priority over other preview warnings so its action remains visible.

## Searchable public directory

`/guides/lake-depth-data` lists the integrated lakes and basins, with search by source names, aliases, county/region and survey IDs. Each record links to a padded survey extent in the studio. Opening a lake retains fabrication preferences, selects layered output with water depth on, and requires fresh generation before export. The link is consumed once so subsequent reloads restore the edited project.

The directory includes every contributing regional grid in the verified archive receipts, plus the three USGS lakes and six NOAA lakes (including St. Clair). Counts refer to lake/basin records: a lake can have several named basins, and a survey can cover only a portion of a lake. Regional entries have separately published provider water masks; lakes absent from HydroLAKES can use these masks or OSM shorelines. Regional contours are labeled separately from surveyed grids. No GLOBathy-only basins are included.

Regenerate the static catalog after rebuilding or adding survey archives:

```sh
/tmp/topostack-surveys-venv/bin/python scripts/data-build/build-lake-directory.py \
  --cache /tmp/topostack-lake-surveys \
  --archives /tmp/topostack-survey-archives
```

The generator checks the regional download checksums and matches receipts to `scripts/data/lake-survey-builds.json`. It reads Minnesota DNR outline names/counties and Syke depth-area names, preserves regional survey identifiers, and includes curated Swiss names/aliases. Update the committed build receipts and name mappings when sources change. The resulting `apps/generator/static/data/lake-depth-directory.json` is fetched on the directory page or when the studio’s location search opens; it is excluded from the studio’s startup JavaScript.

## Additional regional sources (September 2026)

The registry also includes Ontario, Norway's NVE digital bathymetry, selected
Texas Water Development Board reservoirs, and selected Bureau of Reclamation
reservoirs. These additions use the existing priority, masking, attribution,
range-request and fallback paths. Counts come from build receipts; inclusion of
an agency does not mean every survey in its catalog has been imported.

- **Ontario:** the complete Bathymetry Line and Bathymetry Index service snapshots
  are pinned. Negative `DEPTH` values become positive metres; positive values
  are excluded. Only index polygons marked as having contour data are used.
  Records are grouped by waterbody ID; the latest indexed survey year is used,
  and known nonmatching contour years are excluded. Missing years remain
  unspecified. Interpolation is clipped to the lake mask and measured contour
  hull. The [Ontario user guide](https://www.publicdocs.mnr.gov.on.ca/mirb/Bathymetry-UserGuide-EN.docx)
  defines the depth units. Very large grids, missing contours, and degenerate
  records are listed in the skipped-record receipt. Existing NOAA coverage keeps
  priority in the Great Lakes.
- **Norway:** the NVE `DybdeKurve` and `Innsjo_ved_dybdemaling` digital layers are
  joined by `vatnlnr`; `dybde_m` already holds positive metres. The current
  [NVE data policy](https://www.nve.no/kart/kartdata/) and
  [national dataset catalog](https://data.norge.no/nb/datasets/fa42a236-7881-4a15-a4f9-a69b3970f440/dybdekart)
  publish digital data under NLOD. The older scanned-map page's non-commercial
  restriction is not used as authorization for those scans; no scans are imported.
- **Texas:** Alan Henry (2017), Lake Austin (2008–09), and Lady Bird Lake (2008–09).
  Published contours and explicit lake polygons are used. Depths reference the
  reports' conservation pools in NGVD29 feet: 2220, 492.8 and 429 respectively.
  TWDB's [site policy](https://www.twdb.texas.gov/policies/site/index.asp) permits
  copying and distribution. Other TWDB surveys still need individual input and
  datum validation; they are not represented as integrated coverage.
- **Reclamation:** Lake Estes (2001), Flatiron (2012), and Pinewood (2012).
  Estes depths reference 7475 ft project datum, inside the closed 7470 ft contour.
  Flatiron's NAVD88 contours use conservation pool `5472.8 + 5.54` ft and the
  closed 5478 ft contour. Pinewood uses `6580 + 5.5` ft NAVD88 and the closed
  6582 ft contour. These conservative masks omit unsampled margins; they retain
  the largest closed reservoir polygon and its islands. The reports describe
  composite surfaces incorporating survey, shoreline, and other topographic
  inputs. They are labeled **survey contours**, not uniformly measured sonar
  grids. Additional Reclamation reservoirs need the same per-survey validation.

Reservoir contour coordinates are transformed to metres before interpolation.
A 1 m geometry simplification tolerance removes redundant vertices before the
10 m grid is built. Regional grids use 20 m cells. Neither cell size implies
survey accuracy. Conflicting depths at identical positions are excluded;
interpolation never extends past the remaining sample hull. Source pins include
report URLs, exact reference levels, source units and footprint sanity checks.

### British Columbia: reference maps available; numeric import deferred

The [open PDF collection](https://open.canada.ca/data/en/dataset/1427d389-cd21-4fe2-8ed9-282d9bdcb7e2)
uses the Open Government Licence – British Columbia. It is linked from the
public guide, but requires georeferencing and contour digitization before it can
supply numerical depths. A separate
[numeric contour-polygon dataset](https://catalogue.data.gov.bc.ca/dataset/493fb840-1909-489e-91c8-1c9ce9ccee9c)
is currently licensed **Access Only**. The province's
[license guidance](https://bcgov.github.io/data-publication/pages/dps_licences.html)
requires written permission for reproduction or distribution. It is deliberately
absent from the runtime registry until redistribution permission or a compatible
open release is available.

### Capturing and validating service snapshots

`snapshot-survey-service.py` enumerates IDs, captures every feature with checked
pagination, retries oversized responses in smaller batches, and rejects missing
or duplicate records. It rechecks the ID set before finalizing a deterministic
gzipped GeoJSON snapshot and receipt. Failed downloads remain partial and are
not accepted by the builder. An ArcGIS pin instructs the normal builder to run
this capture when its cached snapshot is missing, then verify the pinned digest.
A changed upstream dataset requires a reviewed new pin; it is never silently
accepted. Retain snapshots for exact offline rebuilds because public services
may change their contents in place.

```sh
/tmp/topostack-surveys-venv/bin/python scripts/data-build/test_survey_regions.py
/tmp/topostack-surveys-venv/bin/python scripts/data-build/build-survey-bathymetry.py \
  --cache /tmp/topostack-expanded-surveys --out-dir /tmp/topostack-survey-archives \
  --dataset ontario-lakes-v1
```

To validate new archive bytes in the browser **before provisioning**, start the
local app and run the existing integration check with `--local-archives`. This
intercepts archive range requests using the local files; lake polygons still
come from the configured development data service. It does not validate a remote
upload or release pointer.

```sh
TOPOSTACK_APP_URL=http://localhost:5273 node scripts/verify/verify-surveys-live.mjs \
  --coverage-only --local-archives=/tmp/topostack-survey-archives \
  --dataset=ontario-lakes-v1,nve-norway-lakes-v1,twdb-texas-reservoirs-v1,usbr-reservoirs-v1
```

## NOAA National Bathymetric Source lakes

NOAA's National Bathymetric Source (NBS) Modeling tiles are 4–16 m grids built
from hydrographic surveys, in the public bucket
`noaa-ocs-nationalbathymetry-pds`. The
[coverage report](reports/noaa-lake-coverage-2026-09-24.md) and
[integration plan](noaa-lake-integration-plan.md) explain how the lakes were found.

- **Which lakes.** `nbs_inventory.py` measured every HydroLAKES polygon against
  the delivered tiles. `select-nbs-lakes.py` keeps lakes at least half surveyed
  (footprint × survey share), except the six Great Lakes already served by
  `noaa-great-lakes-v1`. That gives 498 candidates in nine regional datasets:
  Florida, Gulf Coast, Atlantic Coast, Great Lakes basin, California, Northwest
  Coast, Inland Northwest, Alaska, and Puerto Rico with the U.S. Virgin Islands.
- **Names.** Each lake takes the name of the USGS National Hydrography Dataset
  waterbody (or, failing that, area) that overlaps it most. Other named waters
  mostly inside it become aliases (Winnebago lists Butte des Morts and Poygan).
  A HydroLAKES fragment covering under a fifth of a named water is titled "Part
  of …". Open-ocean names are ignored. Lakes with no name are listed as
  "Unnamed lake, <county>". County and state come from Census TIGERweb.
- **Which cells.** Each tile's raster attribute table classifies its
  contributors. Only measured surveys licensed CC0 1.0 or CC BY 4.0 are kept;
  "NBS Generalization" fill, chart-digitized cells and sources that are
  non-commercial, internal-use, pending or blank-licensed are masked.
- **Depths.** NBS elevations are relative to the contributing surveys' chart
  datum: MLLW on tidal water, the low-water datum on the Great Lakes, and on
  inland lakes such as Pend Oreille whatever reference the survey sheets used
  (not stated in the tiles). Depth is the
  negated elevation, averaged to an 8 m UTM grid and clipped to the lake's
  HydroLAKES outline grown by 30 m. The browser anchors it to the terrain
  waterline, as it does for the NCEI grids. This is a display alignment, not a
  datum transformation; on tidal water the depths are those at low water.
- **Perched lakes are refused.** When more than a quarter of a lake's surveyed
  bed lies above chart datum, its waterline is not the datum (a salt pond, an
  inland lake above Lake Superior, a floodplain lake on the Columbia) and the
  negated elevations would understate every depth. 261 of the 498 candidates
  are refused this way; the rest ship. Smaller above-datum patches (intertidal
  margins) are dropped and fall back to the basin model. The refused lakes and
  reasons are in `lake-survey-builds.json` under `skipped.noaa-nbs`.
- **Pins.** NOAA keeps no history: it replaces tiles and the scheme in place,
  sometimes more than once a day, and the scheme can name a tile file the bucket
  no longer holds. `scripts/data/noaa-nbs-sources.json` pins the scheme, the
  HydroLAKES archive and every tile and attribute table by SHA-256. When the
  scheme names a file that is gone, the selection pins the file now in the
  bucket by its own digest and records the scheme's link as `schemeUrl`. Keep
  the build cache (`nbs/`) or copy it to R2 under `sources/nbs/`: once NOAA
  replaces a tile, a rebuild from these pins is only possible from that copy.

Rebuild from a fresh inventory:

```sh
/tmp/topostack-surveys-venv/bin/python scripts/data-build/nbs_inventory.py \
  --cache /tmp/topostack-nbs --out /tmp/topostack-nbs/nbs-inventory.json \
  --lakes /path/to/HydroLAKES_polys_v10.shp --min-area-km2 0 --measure
cd scripts/data-build && /tmp/topostack-surveys-venv/bin/python select-nbs-lakes.py \
  --inventory /tmp/topostack-nbs/nbs-inventory.json --cache /tmp/topostack-nbs \
  --hydrolakes-zip /path/to/HydroLAKES_polys_v10_shp.zip --hydrolakes /path/to/HydroLAKES_polys_v10.shp
cd ../.. && /tmp/topostack-surveys-venv/bin/python scripts/data-build/build-survey-bathymetry.py \
  --cache /tmp/topostack-lake-surveys --out-dir /tmp/topostack-survey-archives --dataset noaa-nbs-florida-v1
```

Repeat the build for each `noaa-nbs-*` dataset. Then set each registry box to its
receipt's grid extent padded by 0.01°, so projects elsewhere never request the
archive, and record the receipts in `lake-survey-builds.json`. Regenerate the
directory with `build-lake-directory.py --keep-unchanged`, which keeps the
committed records of datasets whose receipts are not in `--archives`. The NBS
lakes use HydroLAKES outlines, so the outline shards do not change; only the
coverage audit (`build-lake-outlines.py`, or an `external-fallback` entry per new
record when the regional caches are absent) and the release pin's checksums do
(`provision-lake-outlines.mjs --prepare`).

## NOAA nautical chart lakes

Lakes with no survey grid can still be charted. NOAA's electronic navigational
charts (ENCs, S-57) carry depth contours (`DEPCNT`), soundings (`SOUNDG`) and
depth areas (`DEPARE`) in metres below each chart's sounding datum. The
[chart coverage report](reports/noaa-chart-lake-coverage-2026-09-24.md) lists
every US lake the charts cover and how well.

- **Which lakes.** `select-enc-lakes.py` takes the report's tier A and B lakes
  that no other source covers (160). Lake Mead is refused because its soundings
  refer to a fixed 1,160 ft pool, not the water surface. Two Mexican lakes have
  no dataset. The other 157 are pinned in `scripts/data/noaa-enc-sources.json`
  with each cell's URL, edition, update and SHA-256, the catalog digest, the
  HydroLAKES archive and the cells' datum notes.
- **Which depths.** `survey_enc.py` reads each lake's cells with GDAL's S-57
  driver (updates applied). The most detailed cell wins, and a coarser cell adds
  contours and soundings only where no finer cell charts depth. The shoreline is
  sampled at 0 m every 100 m, and `survey_regions.contour_grid` interpolates
  linearly onto a 20 m UTM grid inside the HydroLAKES outline.
- **Datums.** Great Lakes charts use Low Water Datum, the New York canal lakes
  Normal Pool Level, the Columbia River its Columbia River Datum, and tidal water
  MLLW. All sit at or just below the water surface, so depth below datum is
  anchored to the waterline as for the NBS lakes. A lake whose charted areas are
  more than a quarter drying (bed above datum) is refused.
- **Result.** 135 lakes ship in eight archives: Alaska, Atlantic Coast,
  California, Columbia River, Florida, Great Lakes basin, Gulf Coast, and New
  York with Vermont. 22 are refused (19 mostly drying, 3 with no contours or
  soundings inside), listed under `skipped.noaa-enc` in `lake-survey-builds.json`.
- **Limits.** Chart depths are generalized for navigation: soundings are
  shoal-biased and contours sparse away from channels. Okeechobee's chart comes
  from 1920–29 surveys. These floors are smoother and shallower than survey grids,
  and the directory notes say so.

Charts are reissued weekly, so the pinned cells are kept in the build cache
(`enc/`); the builder refuses a cell whose digest or edition differs. Each
archive's metadata includes its registry box, so set the boxes from the
receipts' grid extents (padded 0.01°) before the final build.

```sh
cd scripts/data-build && /tmp/topostack-surveys-venv/bin/python select-enc-lakes.py \
  --catalog /path/to/ENCProdCat.xml --cells /tmp/topostack-lake-surveys/enc \
  --hydrolakes-zip /tmp/topostack-lake-surveys/HydroLAKES_polys_v10_shp.zip
cd ../.. && /tmp/topostack-surveys-venv/bin/python scripts/data-build/build-survey-bathymetry.py \
  --cache /tmp/topostack-lake-surveys --out-dir /tmp/topostack-survey-archives --dataset noaa-enc-florida-v1
```

## Searching all integrated lakes

The studio’s **Choose anywhere** search includes every lake and basin in the
survey directory, alongside the regular place search. All matches remain
accessible through pagination; names, aliases, regions, sources, and survey IDs
are searchable. Surveyed lakes remain searchable if the external geocoder fails.
Selecting a surveyed lake frames its complete survey bounds for the current cut
size and enables layered water depth. The directory covers integrated numeric
archives, not unimported surveys or reference-only PDF maps.

`lake-directory.test.ts` checks searchability for every catalog record. Run
`node scripts/verify/verify-lake-search.mjs` against the local preview at port 5298, or set
`TOPOSTACK_APP_URL=https://dev.topostack.app` to verify development.
The browser check covers all source groups, pagination, independent provider
failures, retries, mobile layout, framed selection, and saved project state.


## Shoreline coverage and fallback

Lake geometry is independent of depth estimates. `build-lake-data.mjs` retains
HydroLAKES polygons even when GLOBathy has no maximum-depth entry. That archive
change takes effect when the lake archive is rebuilt and provisioned.

R2 stores spatially sharded provider water masks built from the same
checksum-pinned Minnesota, Finland, Ontario, Norway, TWDB, and Reclamation inputs
as the survey rasters. The map API streams them from the environment’s VECTOR_DATA
bucket at `/v1/lake-outlines/<content-digest>.json`.
All 7,744 regional directory entries have a provider mask. The remaining 403
NOAA, USGS, and Swiss entries have no shoreline in their pinned inputs;
they use HydroLAKES or OSM. The audit does not claim verified external coverage.

Regenerate after updating the directory or pinned sources:

```sh
/tmp/topostack-surveys-venv/bin/python scripts/data-build/build-lake-outlines.py \
  --cache /tmp/topostack-lake-surveys --cache /tmp/topostack-expanded-surveys
/tmp/topostack-surveys-venv/bin/python scripts/data-build/test_lake_outlines.py
node --test scripts/test/lake-outlines.test.mjs
# With a local Vite server: verify all six regional sources with HydroLAKES blocked.
TOPOSTACK_APP_URL=http://localhost:5297 node scripts/verify/verify-lake-outlines.mjs \
  --local-archives=/tmp/topostack-survey-archives
```

Generated geometry lives in `.topostack/lake-outlines/` (ignored by Git), never
in frontend static assets. Commit `scripts/data/lake-outlines-release.json`
and `scripts/data/lake-outline-coverage.json` with changes to the directory or
source pins. The release records the index's SHA-256, object counts and bytes,
and checksums of the source catalog, directory and coverage audit.

```sh
# After regenerating: validate every geometry and prepare a reviewable release pin.
node scripts/provision/provision-lake-outlines.mjs --prepare
node scripts/provision/provision-lake-outlines.mjs --verify-only
# Publish to each environment before deploying code that references the new pin.
node --env-file=.env scripts/provision/provision-lake-outlines.mjs --provision
node --env-file=.env scripts/provision/provision-lake-outlines.mjs --provision --prod
# Fresh checkout: recover the pinned data from development R2 and fully validate it.
node --env-file=.env scripts/provision/fetch-lake-outlines.mjs --download
# Deployment preflight: verify index bytes and every shard's size/checksum metadata.
node --env-file=.env scripts/provision/fetch-lake-outlines.mjs
```

Publishing uses short-lived credentials scoped to `lake-outlines/`, conditional
creation (never overwrite), and full SHA-256/size readback for every object.
Shards are uploaded and verified before the index. Existing objects are also
verified, so retries are safe. Local receipts live in `.topostack/`.
The browser pins the content-addressed index; its geographic extents select
only intersecting shards, with bounded concurrency and request counts.
The API streams objects, checks integrity metadata and size, and supports
immutable browser/edge caching, ETags, HEAD and CORS. `/ready` requires the
pinned index. Former `/data/lake-outlines/` URLs redirect to the API so existing
browser sessions survive the migration. CI checks all objects before deploying, without uploading data.

Keep previous objects: old app versions and rollback still reference them.
There is no mutable “latest” pointer and no automatic pruning of this prefix.
Rollback restores the previous release pin and deploys the corresponding app;
it does not rewrite or delete R2 data. Local development uses the existing
remote development VECTOR_DATA binding. Production and development are
provisioned separately. The source-generation scripts, source pins, coverage
audit and verification tooling remain in Git.

Provider masks preserve islands, including separate Minnesota island records,
and use a five-metre topology-preserving simplification. Some masks describe
survey coverage rather than the entire lake. When a provider mask covers less
than 80% of a matching HydroLAKES or OSM polygon, the complete shoreline is kept.
Matching requires more than 50% overlap of the smaller polygon, rather than a
name match. Duplicate lower-priority shores are suppressed. Whole-lake depth
estimates are not copied to multiple independent survey basins.

OSM inland polygons can now receive surveyed depths without a HydroLAKES ID or a
GLOBathy estimate. Raster validity and island masks still limit actual survey
coverage. An outline alone never supplies a maximum depth or proves that DEM
relief is surveyed bathymetry. Swiss elevation grids still require a reference
surface elevation; missing metadata does not produce an invented water level.
Outlines load for flat engraving and depth-disabled water displays too, without
requesting depth rasters. Visible outlines and water fills follow the same
resolved polygons as lake basins. Refreshes retain the inland geometry needed to retry survey loading.
