# Depth charts traced into bathymetry

Many lakes have no digital survey but do have a published depth chart: a scanned or PDF contour map with depth labels. Tracing a chart turns it into the same depth grid a survey provides, so `carveWaterDepth` carves it with no new geometry code.

## First production profile

Browser uploads now require contour correction and confirmation, explicit geographic calibration, and a separate generated-layer review. Preparation cannot generate depths. Native PDF paths are available by selected line style; raster tracing proposes geometry only. The first profile requires closed, noncrossing contours in a single lake without islands or underwater rises. Legacy unreviewed user charts remain exportable but cannot be applied to new generations. See the [release workflow and measured evidence](reports/chart-first-release-2026-09-23.md).

The engine and curated batch capabilities below include diagnostic inference and automatic placement; those are not automatic approval for the browser production workflow.

## Status

| Stage | State |
| --- | --- |
| Record contract (`@topostack/data-contracts/chart-bathymetry`) and core carving with `bathymetryOrigin: "chart"` | Done |
| `@topostack/chart-trace`: georeferencing and gridding | Done |
| `@topostack/chart-trace`: vector PDF extraction (paths and text layer) and level inference | Done |
| `@topostack/chart-trace`: colour segmentation, line tracing, finding printed labels on scans | Done |
| `@topostack/chart-trace`: level inference that survives leaky scans (a facing graph beside raster regions) | Done |
| Batch tracing of curated charts into records (`trace-depth-charts.mjs`) | Done |
| Records published as a survey archive (`community-charts-v1` in the survey build) | Builds; not registered in the catalog yet |
| Loading saved charts in the studio, IndexedDB storage, project import and export | Done |
| Tracing an uploaded chart in the browser (the engine and its worker) | Done |
| Custom data view in the studio, where charts are traced and kept, and its sidebar sections | Done |
| Markers, trails and file import moved into the custom data view | Done |
| PDF charts in the studio (a page drawn as a picture) | Done |
| Charts for lakes HydroLAKES does not list, found by outline | Done |
| Stepping through placements when a lake fits its chart more than one way | Done |
| Placing depths from the keyboard | Done |
| Reading printed depths by machine (OCR) | Dropped: depths are typed; see "Depths are typed, never read" |
| Reviewed catalog submissions through the map-api Worker | Planned |

The [real-chart stress review (2026-09-23)](reports/real-depth-chart-stress-2026-09-23.md) now covers three public-domain USGS charts and eight browser input variants. It found substantial raster/shoreline limitations; successful workflow completion is not an accuracy claim.

## The record

`UserChartBathymetryV1` is JSON-safe, so one record serves IndexedDB, project files, submission bodies, and the files the batch build commits.

**Contours are the source of truth.** The traced contours and spot soundings are stored in lon/lat. The grid is derived from them deterministically, so a reviewer can regenerate it and a better interpolator can replace it later.

**The grid** is stored as base64 little-endian uint16 decimetres, row-major from the north-west corner. `0xffff` marks cells the chart does not cover. This covers depths up to the contract's 1500 m limit and keeps a 1024×1024 grid under 3 MB of text. Use `encodeChartDepths` and `decodeChartDepths`; do not hand-roll the packing.

**Labels** records whether the chart printed depths or elevations. Reservoir charts often label contours in feet above a datum. Those contours are converted to depths below the recorded `surfaceElevationM` before they are stored (`chartLabelDepthM`), so every consumer reads depths.

**Georeferencing** is stored as a 3×3 homography from chart pixels to lon/lat. It also keeps the control points or the snap IoU, and the ground residual, so a reviewer can judge the fit.

**The licence attestation** decides where a record may go. `personal-use` charts stay on the maker's device; only `own-work`, `public-domain`, and `open-license` records may be published (`isPublishableChart`). Publishing shares contours and grids, never the scanned image, unless the attestation allows it.

## What real charts look like

Three public charts were chosen as reference inputs, one for each style the tracer must handle. They are **not committed**. Their publishers' terms do not clearly allow redistribution, and Minnesota's sheet carries a state copyright. Tests that use them should fetch each chart by URL and check it against a SHA-256 pin. These restricted source images remain external; separately documented public-domain USGS derived fixtures are committed for regression checks.

| Chart | Style | What it demands | Ground truth |
| --- | --- | --- | --- |
| Michigan DNR, [Lake Margrethe](https://www2.dnr.state.mi.us/Publications/pdfs/ForestsLandWater/_Archived/Inland_Lake_Maps/CRAWFORD/LAKE_MARGRETHE.PDF) (1938–39) | Clean hand-drawn ink, 1-bit CCITT scan inside a PDF | Rotated north arrow, so snapping must try every rotation, not only flips. Depths are in feet on a 5 ft interval with primed labels (`10'`). Section lines cross the lake, and soundings, symbols and a legend box share the sheet. | The state's digitized Inland Lake Contours layer |
| Minnesota DNR, [Ten Mile Lake](https://files.dnr.state.mn.us/lakefind/data/lakemaps/b0290010.tif) | Degraded scan served as a CCITT G4 TIFF, 10800×7200 | Browsers cannot decode G4 TIFF, so the studio needs a small lazy decoder. The sheet has heavy blotches, crowded labels, contours that merge on steep slopes, and neighbouring lakes. | `mn-dnr-lakes-v1` |
| TWDB, [Cedar Creek Reservoir](https://www.twdb.texas.gov/hydro_survey/cedarcreek/2017-10/CC17_ContourMap.pdf) (2017) | Vector GIS PDF with a text layer | Contours are elevations above mean sea level (pool at 322 ft). Its paths, labels and State Plane grid ticks can be read directly from the PDF, with no OCR or raster tracing. | None archived |

The TWDB case moves **vector PDF extraction** ahead of raster tracing. For modern GIS charts it gives exact lines and labels, and possibly georeferencing from the grid ticks.

## Reading vector charts

A GIS-exported PDF already holds the contours as paths and the labels as text, so no pixels are traced. What the export does not hold is which label belongs to which path.

- **What the export gives.** The TWDB sheet draws its about 1,700 contour paths in seven stroke styles. Index contours (275, 300) are heavier; the lighter levels cycle through six colours, so style never identifies a level. Only 32 labels sit on the lines, rotated along them. The page also has a legend, grid ticks and a scale bar that look like labels, so the maker marks a map area and picks the contour and shoreline styles from `strokeStyles`. The batch manifest records the same choices.
- **Chaining.** Paths are joined only where exactly two ends meet. Where three or more ends meet, lines of different levels are touching, and joining through that point once put 300 and 305 on one chain. Label gaps are bridged only when both ends point across the gap.
- **Labelling.** A label names the nearest line that runs along it, within about its own height.
- **Inferring the rest.** `levels` rasterizes all lines, floods the space between them into regions, and solves three constraints:
  - A region touching two neighbouring levels is the band between them.
  - The shore band reaches the first rung inward from the surface, which need not be on the interval: 322 ft down to 320.
  - A contour parts the band below its level from the band above it, so one known side gives the other.

  Real sheets leak: lines crowd closer than a raster cell, and gaps at the map edge join bands that should be separate. So each unlabelled line also votes along its length: rays sideways to the nearest known line on each side name the single rung between them.
- **Result on the TWDB sheet.** 32 labels on 10 chains lead to 48 more inferred, covering **86%** of the contour length. The inferred levels nest in order from 320 at the shore to 270 at the dam. The rest is mostly small closed loops and scraps that bound no band.

## Reading scanned charts

A scan becomes the same kind of page as a vector chart: traced lines stand in for paths, and read labels stand in for the text layer. From there it runs the vector route above.

- **Ink.** Ink is everything darker than Otsu's split of the page, or near colours the maker picks from a k-means palette. The scan is traced at most 4096 px across. Specks, dots and lone digits are dropped, a closing heals hairline breaks, and Zhang–Suen thinning leaves one-pixel lines that keep their topology.
- **Lines.** A skeleton pixel's role comes from how many separate branches leave it, not from its neighbour count, so the staircase corners thinning leaves stay inside lines. Short dead-end spurs are pruned, and each line keeps its stroke width.
- **What scans need beyond the vector route:**
  - **Crossings.** Section lines and roads cross contours in the same ink, so chaining continues straight through junctions.
  - **Straight lines.** Long, ruler-straight lines are dropped.
  - **Label gaps.** They are bridged more readily where a label sits in the gap.
  - **The shore.** It is inferred as depth 0 from the band beside it, with no depth allowed shallower than that. "Auto" shoreline detection by stroke width exists, but Lake Margrethe draws its shore no bolder than its contours; there, the heavy lines are the frame, roads and lettering.
- **Finding labels.** Loose labels are digit-sized ink clusters. At tracing resolution, a label that fills its contour's gap fuses into one blob, and the skeleton runs straight through it. What gives it away is the stroke swelling to two or three times the line's width for about a label's length. Each candidate is cropped from the full-resolution scan, turned upright along its line, and read both ways up by the OCR engine the caller passes in.
- **Levels on scans.** Raster regions alone fail on a scan. Every unbridged gap joins two bands, and on Lake Margrethe the regions merged into a few huge contradictory ones: three hand-given labels levelled about 4% of the length. `levels` therefore also builds a facing graph. Rays cast left and right from samples along each line record which line each side faces across open water, and then three rules run:
  - **Between.** A line whose two sides, sample by sample, face known levels one rung apart on either side takes the rung between.
  - **Orientation.** A known line learns which of its sides is higher from neighbours one rung away.
  - **Propagation.** An oriented line gives the next rung up to lines facing its higher side, and the next rung down to lines facing its lower side.

  Every rule needs a clear majority of samples, and orientation and propagation count only lines that see each other both ways. A frame or road collects rays that slip through gaps in the contours, but it does not see the far contour back. Whatever the shore faces on its land side is marked land and never takes a level. That covers frames, roads and the legend box, though not the land beyond them, since spreading further would leak back into the lake through the same gaps.
- **Result on Lake Margrethe.** Tracing works: each contour comes out as one long chain through crossings and label gaps. With three labels given by hand (10, 20 and 35 ft on one slope), inference levels the lake from the shore at 0 ft down to its 55 ft holes, in nested order. That is **55%** of all traced length. The total includes the frame, legend and lettering, which correctly stay unlevelled. A few road stubs by the shore still get levels, which is harmless because gridding uses only cells inside the georeferenced water outline.
- **OCR on Lake Margrethe.** Tesseract with a digit whitelist read loose labels, but read the italic labels set into the lines poorly, because pieces of the contour inside the crop confused it, and dash marks and symbols produced stray digits. This experiment is why OCR was dropped: on scans like this the dependable route is the maker clicking a few lines and typing their depth, and inference filling in the rest.

The adapter reads the page with pdf.js 6, which the caller passes in. 5.x carries a high-severity advisory, so it is not supported.

## Batch tracing

`scripts/data/depth-charts.json` lists curated charts. Each entry records everything a curator decided, so a trace can be repeated:
- the source URL and its sha256 pin
- the licence attestation
- the input kind: a vector PDF, a scanned PDF (rasterized with `pdftoppm` at a stated dpi), or a PNG
- the contour and shoreline styles, how labels read, the surface and interval, and the map area
- for scans with no readable labels, a few hand-placed labels as `trace.words`
- where the water is: the chart's water fill styles, the traced shoreline itself (`water.fromShoreline`, for charts that draw a waterline instead of filling the lake), or the traced contour at a shore level
- control points, in lon/lat or in a projected CRS with a proj4 definition (for charts printed with grid ticks)
- the grid resolution

`node scripts/data-build/trace-depth-charts.mjs` runs `lib/depth-charts.mjs` on each entry. It downloads once into `.topostack/depth-charts/` and checks the pin every run. For each chart it:
1. traces the chart and georeferences the contours and water,
2. converts labels to depths in metres,
3. simplifies the contours until they fit the record's point budget,
4. grids the depths,
5. validates the result with `parseUserChartBathymetry`.

Records whose attestation is publishable go to `scripts/data/depth-charts/<id>.json` for the survey archive build. All others stay in the gitignored work directory. `report.json` has a QA line per chart: georeferencing residual, contours and points, labelled and inferred counts, coverage, grid size, and deepest cell.

**Lake Viking (USGS SIM 3486, sheet 7)** is the first published record, and the pattern to copy for more. USGS-authored work is in the [U.S. public domain](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits); the sheet's only third-party material is the OpenStreetMap basemap in its location inset, outside the traced map area.
- **Georeferencing.** The figure's latitude and longitude graticule is drawn as tick marks, not lines. Fitting a line through the ticks of each parallel and meridian, then intersecting them, gives control points to under a point; the affine fit's residual is **0.07 m**. The labels sit on their own lines, which is what identifies them. Any USGS bathymetric sheet can be georeferenced this way.
- **Trace.** Index contours every 20 ft in black and intermediate contours every 5 ft in grey, 17 chains, **100%** of the contour length levelled from the sheet's own labels.
- **Water.** The sheet draws a waterline (the average survey water surface, 863.8 ft) rather than filling the lake, so `water.fromShoreline` takes the outline from the traced shoreline. Its beige fill marks the multibeam survey extent, which stops short of the shallow arms.
- **Grid.** 204×239 at 15 m, deepest 17.9 m (58.7 ft below the 863.8 ft surface, matching the sheet's deepest 805 ft contour). The old river channel reads deepest, running to the dam in the north-east.
- **Check against OpenStreetMap.** Every edge is within about 80 m of OpenStreetMap's lake outline; the largest differences are at the tips of the upstream arms.

**Cedar Creek (TWDB).**
- **Georeferencing.** Six intersections of the chart's NAD83 Texas North Central grid lines (EPSG:2276, US feet) give an affine fit with a 6 m ground residual.
- **Trace.** 58 contour chains, 87% of the contour length levelled.
- **Grid.** 890×1024 at 27 m, deepest 16.6 m (54.5 ft; the deepest contour is 270 ft under a 322 ft pool). North is up, the deepest water lies by the dam, and the large island in the north basin is left dry.
- **Check against OpenStreetMap.** The southern edge, the dam, matches OpenStreetMap's reservoir outline to 0.0001°. The other edges differ by up to 0.016° at creek tips, where the two sources end the water at different points.
- **Status.** The chart's redistribution terms are not confirmed, so the manifest marks it `personal-use` and its record stays local.

Lake Margrethe is not in the manifest yet. Its sheet has no grid ticks, so control points would have to come from the public land survey section corners it shows, or from snapping to a lake outline.

## Publishing the records as a survey archive

Published records reach the studio the same way a government survey does, so no browser code is involved. `chart_records.py` is the survey build's `community-charts-v1` provider:

```bash
python3 scripts/data-build/build-survey-bathymetry.py --cache <cache> --out-dir <out> --dataset community-charts-v1
```

It reads every record in `scripts/data/depth-charts/`, refuses any whose attestation may not be published, writes each record's grid as a north-up lon/lat GeoTIFF, and hands it to the shared `TileWriter`. Each chart's publisher, source URL, file digest, tracer version and licence become the archive's source pins, so the receipt beside the archive says where every tile came from.

**The record's grid is used as it stands.** The record says how it was made, and re-deriving it here would risk the Python and TypeScript interpolators disagreeing about the same chart. To change a grid, re-run the tracer and commit the new record.

**The source bounds are a gate.** `SOURCE['bounds']` in `chart_records.py` must cover every record, so admitting a chart in a new place is a deliberate edit.

**The archive is not registered yet.** `community-charts-v1` is deliberately absent from `scripts/data/lake-bathymetry.json`: that catalog is live for every visitor, and a source whose archive is not in R2 makes the studio report depth data it cannot load. Registering it is one provisioning pass, in this order:
1. Build the archive, then upload it with `scripts/provision/provision-lake-data.mjs`.
2. Copy `chart_records.SOURCE` into `scripts/data/lake-bathymetry.json`, and the receipt's digest, size, tile and grid counts into `scripts/data/lake-survey-builds.json`.
3. Rebuild the lake directory (`build-lake-directory.py`, which already knows this source) and add `community-charts-v1` to a region in `apps/generator/src/lib/site/lake-pages.ts`.
4. Rebuild and republish the lake outlines, whose release pins the directory's digest.

## Georeferencing and gridding

`@topostack/chart-trace` does both in a lake-centred metre frame, so residuals are ground distances and grids are square in metres and aligned to lon/lat.

**Georeferencing** has two routes:
- **Control points.** Three clicks give an affine fit; four or more give a homography, which also absorbs a phone photo's perspective.
- **Snapping.** A traced shoreline is matched to the known lake outline. Starting guesses come from area moments, trying each principal-axis orientation with and without a mirror (pixel rows run down), and a full turn of guesses for a near-round lake. Symmetric ICP then refines each guess to an affine map, and the best is kept by IoU. Below `SNAP_MIN_IOU` (0.9), the maker is asked for control points instead. Affine snapping can make a wrong but similar lake overlap quite well, so the studio shows the snapped chart over the map before accepting it.

**Gridding** has two methods:
- **`harmonic`** (the default). Contour cells are fixed at their depth, land is fixed at zero, and Laplace's equation is solved by coarse-to-fine red-black SOR. This follows the slope a chart implies and covers the whole lake, where a TIN leaves terraces between vertices of one contour and blanks outside their hull.
  - Laplace alone would leave a region enclosed by one ring perfectly flat, and pinning a single cell only makes a spike. So such a pool is filled with a smooth dome `d ± step·(2t − t²)` over its distance from the ring. It levels off half an interval past the ring, or at the deepest sounding inside it. Rings marked `inside: "shallower"` dome upward, as humps.
- **`tin`** ports `survey_regions.contour_grid` line for line and is held to it by a fixture the Python generates. It exists so charts and published contour surveys can be gridded identically.

## Tracing an upload in the browser

`domain/chart-build.ts` is the whole engine the custom data view drives: pixels and a lake outline in, a finished record out. It is a plain function in no component, so it runs in `workers/chart-trace.worker.ts` and is tested without a DOM. `workers/chart-trace-client.ts` drives that worker, one request at a time, matching every reply by id so a cancelled trace cannot land on a later one; where workers are unavailable — jsdom, or a host frame whose policy forbids them — the same functions run on the main thread, because a slow trace beats no tracing.

**Placing an upload needs no control points.** The maker picks the lake before uploading, so the chart's traced shore is snapped onto that lake's known outline. The shore is taken as the longest traced line that closes, falling back to the longest line of any kind: a chart's outer shore is its longest ink by a wide margin, which is steadier than a stroke-width rule. The report carries the overlap and flags a snap below `SNAP_MIN_IOU` as one to look at rather than refusing it.

**The lake's own outline is the water**, not the traced shore: the chart was just matched to it, and it is the cleaner boundary.

**Two labels, not one.** A single labelled ring cannot say which way is deeper — inward and outward both fit — so inference stops there and most lines stay unlevelled. With two, the direction is fixed and the rest follows from nesting. The engine needs two labels to establish direction; the studio guides makers through at least three confirmed points on different contours to provide a further reference.

**A clicked depth is a mark, not a word.** An OCR word is a box of glyph ink with a reading direction: its box is erased before tracing and it binds only to a line running along it. A click is neither. Sent as a word, a click on the steep side of a contour was rejected for reading across the line, and the box erased around a point on a diagonal cut the line where it was clicked. Every depth failed on a clean synthetic chart. Marks (`RasterTraceOptions.marks`) erase nothing, have no direction, and bind to the nearest traced line within a reach the canvas sets at 12 screen pixels, however large the chart.

**A lake is picked whole.** The lake search loads a window around the place, and a big lake runs past it. Picking a lake the window cut off loads it again over its own extent (`wholeLake`), because a chart snapped onto part of a shore is placed wrongly with nothing to show it. A lake in several parts is listed once, by its largest part. Lakes known only from a published survey have no HydroLAKES id to key a chart by; the picker names them as already surveyed rather than leaving them out without a word.

**Snapping prefers the chart read the right way round.** Pixel rows run down and northings up, so a correct placement has exactly one flip. A reflected fit wins only if it overlaps clearly better (`MIRROR_MARGIN`), which keeps mirror-printed charts working. A lake that is symmetric under a half turn still fits equally well either way up, and the outline alone cannot settle that. `snapCandidates` therefore returns every distinct placement, best first, and the build takes a `placement` index. When another placement fits about as well (`report.ambiguous`), the studio says so and offers "Try another placement", which traces again with the next one; the maker compares the lake bed with the chart.

**Assembly is shared with the batch.** `@topostack/chart-trace/record` turns any trace into a record: levels to depths, geometry to lon/lat, contours simplified until they fit the contract, then the grid. The batch build and the studio both end there, so a curated chart and an uploaded one mean the same thing.

**Depths are typed, never read.** Reading printed depths by machine was tried and dropped (September 2026). A recognizer reads labels set into contour lines poorly, and a wrong depth is worse than none: it carves a lake bed that looks right. It would also have needed `'wasm-unsafe-eval'` in the site's script policy and several megabytes of self-hosted engine and language data. So the engine takes depths only from people: `words` (labels placed by hand in the batch manifest, with the ink box they are printed in) and `marks` (depths clicked in the studio). `raster-labels` still finds printed labels, but only so `traceScannedChart` can erase them before tracing.

**Lakes HydroLAKES does not list.** Small lakes are often drawn only in OpenStreetMap, with no depth source, so they carve flat; a chart is their only depth. Their outlines carry no lasting id (`osm-lake-3` is a list position), so the chart names the lake instead: its project key is `outline:<chart id>` (`OUTLINE_CHART_KEY_PREFIX`, and `depthChartLakeKey` for either kind). When depths load, `chartsForAreas` gives such a chart the one lake its own outline overlaps best, at an IoU of at least `OUTLINE_MATCH_MIN_IOU`, after cutting the chart's outline to the map area the way the lake was cut. HydroLAKES keys match first. The lake picker loads the map's water beside the lake datasets and resolves them as generation does, so map-only lakes are listed ("Lake from the map"). Picking one the window cut off finds it again in a wider load by overlap. The key form is additive: projects without it are unchanged, and older releases reject projects that use it.

**PDF charts.** A PDF is drawn as a picture (`domain/chart-pdf.ts`, pdf.js loaded only when a PDF is chosen) and traced like any other. A file with several pages offers a page number. pdf.js 6 has no `eval`, and WebAssembly is turned off, so it runs under the site's policy. The cost is that JBIG2 and JPEG 2000 images, whose decoders want WebAssembly, draw blank; a blank page says so and asks for another page or a PNG. Reading a vector PDF's own paths and text, as the batch does, would be more exact for GIS exports, but it would give the studio a second tracing route to explain.

## The custom data view

Tracing a chart is its own job, not a step inside making a relief, so it has its own view: "Custom data" sits beside Map, Cut layers and 3D stack, and is loaded only when opened. It holds everything a maker brings to a project: depth charts, markers, trails and boundaries, and imported files.

**The sidebar becomes the view's own.** While it is open, the project's settings rail and panels are put away: none of them shapes a chart or a marker. In their place is a rail of the same kind (`CustomDataNav.svelte`, on the theme's `Tabs` rail) with one tab per kind of data — depth charts, markers, trails and boundaries, graphics, file import — each panel holding that kind's tools. Markers, trails and import moved here out of the project sidebar; the same components are what the platform embed still renders in its own rail.

**The selected tab chooses the workspace.** Every panel stays mounted, so switching tabs keeps a half-traced chart and any marker being edited. Depth charts put the chart being clicked there; the other three put the map, which is the same `MapStage` map view uses, so a marker is placed and dragged exactly as before without leaving the view. It is shown with `framing` off: a marker or a path needs no map area, so the selection box, its handles and the crosshair are put away and panning commits nothing. The guide element stays in the layout, because the bounds a pan would report are measured from it.

**A marker or a path can be named.** `name` is optional on `MapMarkerV1` and `CustomLineFeatureV1`, at most `MAX_CUSTOM_DATA_NAME_LENGTH`, and absent rather than empty when it is blanked. It is the maker's bookkeeping: nothing is engraved from it, so `projectFingerprint` strips it, which also means a project with no names hashes exactly as it did before names existed and no saved design is restated. Renaming goes through `renameCustomData`, which records an undo step and leaves the preview alone, rather than `applyCustomDataEdit`, which would refresh a picture that cannot change.

**A path is drawn by clicking, like a marker is placed.** `Draw on map` arms `lineDraft` in `customdata/custom-data-actions.svelte.ts` (the studio's custom-data edits, kept out of `App.svelte` so they can be tested alone), and each map click appends a point to it. The draft is held outside the project because a custom line needs two points to be valid and because a path of twenty clicks should be one undo step, not twenty; `addDrawnCustomLine` commits it as a single edit. Clicking the first point again (within `CLOSE_RADIUS_PX`) closes the shape: geometry draws the points it is given and closes nothing itself, so the first point is repeated at the end and the line is a boundary. Anything else is a trail. Enter finishes, Escape abandons. The draft is drawn on the map as its own GeoJSON source: a dashed line with a dot on every point, a larger one on the first, and a paler segment running from the last point to the pointer, so the line a click would add is visible before it is placed. That segment snaps to the first point, with the cursor, wherever clicking would close the shape.

**Both overlays wait on `styleReady`, not `isStyleLoaded()`.** MapLibre reports a style as not loaded while tiles are still arriving, so a guard on `isStyleLoaded()` silently dropped whichever update happened to land in that window: closing a boundary left the finished draft drawn over the map, where its orange line read as a stray trail. The flag is set from the map's own `load`, not `style.load`: overlays added between the two, while the first tiles were arriving, left WebKit on Linux without the repaint that shows them. It is reactive, so a sync skipped before the style was ready runs again the moment it is. The choice lives in `customdata/custom-data-nav.svelte.ts`, beside the draft and for the same reason: switching views unmounts both halves, and coming back somewhere else would lose the maker's place. Closing the tools leaves the active workspace available; Show tools reopens its controls.

**The chart's tools and the chart are apart.** `customdata/chart-tracing.svelte.ts` holds the work — reading the upload, placing depths, calling the worker, keeping the record — because neither half can own it: `ChartTools` is the sidebar section and `ChartCanvas` is the picture. Both read the same draft, so the split changes nothing about what survives a view switch.

**The sidebar carries a lazy chunk.** The tools reach the trace worker, the lake lookup and IndexedDB, so the menu is imported with the view rather than waited for on the studio's first paint; the map chunk loads only for the three sections that show it.

**Lake selection has its own map.** Before a chart is uploaded, the workspace loads selectable lake outlines for the initial visible map area and refreshes them after panning or zooming. Search or selection is not required to see and hover valid targets. Viewport requests are debounced, cancelled when superseded, and kept separate from search results and camera changes; very wide views ask the maker to zoom in. A place search immediately moves the map and identifies the chosen place; after loading, the map fits the nearby candidates as well. List selection and map clicks share full-outline loading and cancellation guards. A map click outside the current shortlist loads water around that point. Missing or unsupported outlines get an explicit message. The chart lake and camera are separate from the project terrain location, so browsing changes no terrain settings.

**It needs no terrain and no map area.** A lake is found by name through the same place search the studio already uses, and `domain/lake-lookup.ts` then reads the lakes around that place straight from the water data. Many are unnamed in HydroLAKES, so each is listed with how big it is and how far it lies from the place searched. A maker can therefore build charts long before framing anything.

**Contour preview precedes depth assignment.** A background worker extracts joined contour paths without requiring labels or an interval. Hovering highlights the nearest path within 12 screen pixels; clicking snaps the point to it and keeps the highlight visible while the value card is open. Touch taps and keyboard crosshairs use the same paths. Changing images or PDF pages cancels the previous detection; unmounting disposes its worker. If no lines are detected, the view explains that manual placement remains available. Later depth labels can also help the tracer bridge gaps around printed numbers, so the preview is an inspection aid rather than a guarantee of final coverage.

**Depths are assigned through a three-point guide.** Click a contour first, then enter its printed depth or elevation in the floating card beside that point. Confirm & next advances the guide; at least three confirmed points are required before tracing. More points can be added, numbered points can be edited, and Cancel or Escape dismisses an unconfirmed point. Keyboard users steer the chart crosshair with arrow keys and press Enter to open the same card; confirmation returns focus to the chart. The guide keeps progress, point values, Undo last point, and Trace chart beside the image on narrow screens. A completed trace scrolls into view and offers Review and save chart, which opens and focuses the save controls. Elevation charts require a finite surface elevation; below-datum elevations are supported.

**Verify the generated lake bed.** The chart workspace uses compact, full-height panes with one-pixel dividers and dense toolbars: the editor on the left, with the 3D lake bed above a north-up flat DEM on the right. Below 820 px of workspace width these panels stack in reading order. Both previews reserve room before tracing, and generation never automatically scrolls the page. The 3D surface uses the record’s grid with depths below a water-surface reference grid. The default 3D stack uses the main ThreePreview renderer, including its wood grain, cut-edge materials, environment lighting, shadows and exploded-layer control. It adapts chart contours to a representative 300 mm-class rectangular model with a solid backing and twelve 3 mm sheets, independently of the project's fabrication settings. The chart and project cameras are isolated. Switching to Shaded DEM retains both views' camera state. The representative surround is illustrative stock, not inferred terrain. Extraction is bounded to 192 samples per side. Auto exaggeration gives shallow basins visible relief and reports the actual display multiplier; 1× retains true scale. Missing samples remain gaps. Changing the preview scale does not alter saved depths. Custom Data hides the terrain generation dock; apply a saved chart and return to Map to regenerate terrain.

**Keeping is not carving.** "Keep this chart" only adds it to the library in this browser. A separate "Use for" attaches it to the project under its lake's key and marks the terrain stale, so the two jobs stay apart. A chart whose lake is outside the current map area says so rather than claiming to carve, and a chart the project names but this browser lacks is listed with a way to stop using it. The library lists from a small summary kept beside each chart, so listing does not decode every grid. When Generate starts, `currentChartReferences` brings each reference's content hash up to the chart as saved now, so the design's fingerprint never names content that was not carved.

**The work in progress outlives the view.** Switching to another view and back unmounts the chart canvas and its tools, so the half-traced chart lives in `customdata/chart-draft.svelte.ts` instead of in the component. It is deliberately not part of the project: nothing is saved until the maker keeps it.

**A lake with a chart stops taking a maximum-depth override**, because that control only shapes a modeled basin; the Water panel shows the chart is in use and points at this view.

## In the browser

A chart the maker traced stays on their device. Nothing is uploaded, and no chart is ever fetched from a server.

- **Where it lives.** One IndexedDB entry per chart, `topostack:chart:v1:<id>` (`storage/user-charts.ts`), holding the validated record and the SHA-256 of its JSON.
- **What the project stores.** `ProjectConfigV1.userDepthCharts` maps a HydroLAKES id to `{ id, contentHash }`, keyed exactly like `waterDepthOverrides`. The hash is in the fingerprint, so re-tracing a chart re-carves the stack; the field is absent in every project without a chart, so no existing fingerprint moves.
- **When it loads.** `loadSurveyedLakeDepths` runs the survey providers first, then `applyUserCharts` on top. A chart is chosen for one named lake, so it answers a provider that is missing or wrong there, and it wins. Where the chart has no sample, the provider's depths stay, so an uncharted arm keeps its survey.
- **How it resamples.** Terrain grid columns are evenly spaced in longitude and rows in Web Mercator, matching the survey raster sampler; a chart grid is even in longitude and latitude, so only the rows are converted. Samples are bilinear, the outer half-cell at each chart edge takes the edge cell's value, and the lake's pixel mask keeps depths off islands and neighbouring lakes.
- **A missing chart is not an error.** A project opened in another browser, or one whose chart was deleted, simply loads its survey depths. The lake then warns like any other predicted lake.
- **Project files carry their charts.** An exported project includes the charts it references (`{ schemaVersion, project, charts }`), which is what lets it open on another machine. On import only the referenced charts are saved, so a file cannot fill a browser with charts nothing uses, and an unreadable one is skipped rather than failing the import. A file with charts may be up to 24 MB; one without keeps the old 2 MB ceiling. Share links never carry charts: they have a 2 MB ceiling of their own, and the recipient gets survey depths.

## How it carves

A chart reaches geometry as `WaterAreaV1.bathymetry` with `bathymetryOrigin: "chart"`. From there:

- It carves exactly like a survey. It is anchored to the terrain waterline, and uncovered cells fall back to existing terrain or the modeled basin.
- The surface reports `depthSource: "user"` and `bathymetryOrigin: "chart"`, whether or not the chart has gaps.
- The map warns once with `LAKE_DEPTH_FROM_CHART` rather than `LAKE_DEPTH_PREDICTED`. Gaps and misaligned grids raise the usual per-lake `BATHYMETRY_FALLBACK`, naming the depth chart.
- Using a chart for a lake clears that lake's maximum-depth override, since a charted lake does not offer one. Chart gaps take the modeled depths unscaled.

The [independent accuracy evaluation](reports/chart-tracing-accuracy-2026-09-23.md) found substantial raster basin distortion across four real charts and 20 image variants. Successful tracing and `publishable` status do not certify appearance or fabrication accuracy.
