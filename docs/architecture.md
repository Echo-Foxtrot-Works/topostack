# Architecture

TopoStack has one authoritative geometry flow:

```text
ProjectConfigV1 (including authoritative geographic crop bounds) + SourceBundleV1
  → @topostack/core.generateGeometry()
  → GeometryIRV1 (mm, centered origin, Y down)
  → 2D preview / three.js preview / SVG fabrication package
```

The core package has no Svelte, Atomm, Cloudflare, DOM, or storage imports. Contracts that the browser, the Worker, and the provisioning scripts must share (source catalogs, archive releases, the terrain PNG codec, usage events) live in `@topostack/data-contracts`, which depends on neither the core nor any runtime. Turning a lake depth chart into bathymetry (georeferencing and gridding) lives in `@topostack/chart-trace`, equally runtime-free, so the batch build and a studio worker share it. Workspace packages are imported by name only; ESLint rejects paths into another package's `src/`. The SvelteKit generator is prerendered as a static site, mosaics every elevation/vector tile intersecting the visible crop, and adapts the core to browser Web Workers, IndexedDB, MapLibre, three.js, and the Atomm lifecycle. The Cloudflare Worker streams and caches source data. It also answers agent requests (validating a project, estimating its sheets from a coarse terrain sample, minting a studio link) through `@topostack/core/project`; it never imports generation or export and never traces contours. See [the agent API plan](plans/agent-api.md).

The UI follows the same Svelte 5 runes, immutable domain-state, and static-adapter patterns as Label Studio. Atomm integration stays behind a small bridge that registers the platform lifecycle once and reads current project state through a getter, avoiding stale component closures.

Layer count is derived, never configured. `planTerrainStack` turns the mapped ground width, the physical cut width, the terrain relief, and the requested vertical exaggeration into a stack height, then divides that by the material thickness. The count is rounded to whole sheets with a two-sheet minimum and no fixed upper limit; the reported exaggeration is refitted to the whole-sheet count, so adding material thickness makes a model coarser rather than shorter and widening the cut makes it taller.

Every generated result records a deterministic project fingerprint and source quality. When acrylic water inserts are on, each lake's opening is cut from its waterline sheet, with a ledge on the sheet below, before the work-area split and nesting; map detail over the water is routed onto the acrylic, while hidden marks keep to the wood ([water-inserts.md](water-inserts.md)). Before markings are clipped and labels are placed, the geometry flow plans same-coordinate material nests and adds their glue-safe cavities to donor layers. Vector-tile buffers are removed and unambiguous degree-two road pieces are stitched before transportation paths are styled as complete routes. Roads use a continuous centerline by default; the optional outlined major-road style offsets the complete route by the configured spacing and adds matching compact joins at forks. Styled routes are then clipped to the highest exposed material across the stack so bends and contour transitions stay continuous. Fabrication export groups each nest family onto one panel and emits shared donor/child cut lines once. Given a sheet plan, it instead places each family's parts onto stock sheets with a per-part transform ([nesting.md](nesting.md)). Export is rejected when settings changed after generation, the source is synthetic, or any layer is empty.

## Agent surfaces

Assistants reach the same flow without a new geometry path ([reference](mcp.md), [design](plans/agent-api.md)). One contract, `ProjectRequestV1` in `@topostack/core/project`, expands onto `DEFAULT_PROJECT` and passes `parseProject`, and its JSON Schema describes every surface:

- **REST** (`/v1/projects/*`) and **MCP** (`/mcp`) on the Worker validate requests, estimate the stack from a coarse terrain sample, and mint studio links (`/studio?generate=1#p=1.…`) that generate on open.
- **The MCP App** (`ui://topostack/terrain-preview.html`, built from `apps/generator/src/mcp-app/`) runs the real loaders and `generateGeometry` in the chat host's iframe.
- **WebMCP** tools in the studio edit the live design through its own update, generate and undo paths.

Files are still produced only in a browser; server-side generation is a later phase in the plan. [mcp.md](mcp.md) covers the code, transport, limits and local testing.

## Where things live

- [Core package layout](#core-package-layout) below; [`packages/data-contracts/README.md`](../packages/data-contracts/README.md) for the shared contracts package.
- [`apps/generator/README.md`](../apps/generator/README.md) for the generator's layers, what each may import, the studio panels and their context, and the stylesheet layout.
- [`workers/map-api/README.md`](../workers/map-api/README.md) for the Worker's routes and operations.
- [`scripts/README.md`](../scripts/README.md) for every operational script and how it runs.
- [`CLAUDE.md`](../CLAUDE.md) for the one-page map of where a change goes and the rules the linter enforces.

## Core package layout

`packages/core/src` is grouped by concern; each folder only imports from the folders above it in this list, and `types.ts` at the root is shared by all of them.

| Folder | Holds |
| --- | --- |
| `primitives/` | Pure 2D geometry: polygon prep and clipping (`geometry2d`), ring offsetting, grid sampling, crop shapes, units, number formatting |
| `water/` | Lake and ocean depth: shore distance, survey and terrain-basin fitting, shoreline smoothing, water fill patterns |
| `annotate/` | Text and symbols: the font catalog and glyph registry (`font-data`), label metrics, drawing and placement, markers, the north arrow, the title |
| `pipeline/` | Geometry generation: `generate.ts` orchestrates contour tracing, stack planning, material nesting, transportation styling, coordinate grids, validation, and the work-area split; `synthetic-source.ts` builds the deterministic preview source |
| `export/` | Fabrication output: SVG primitives, panel layout, per-layer/master SVGs, the printable assembly booklet (`assembly-guide.ts`), the flat-engraving SVG, package builders, and the export block policy |
| `project/` | Reading and describing projects without generating them: `parseProject` for untrusted JSON, the crop bounds, the agent-facing `ProjectRequestV1` and its JSON Schema, and stack plans from a relief sample. Also published alone as `@topostack/core/project` for the Worker |
| `test-support/` | Fixtures shared by tests only; excluded from the build |

`index.ts` names every public entry point explicitly. Consumers import `@topostack/core` (or the `@topostack/core/project` subpath); nothing outside the package may reach into these folders.

## Generator layout

`apps/generator/src/lib` is split into `domain/`, `storage/`, `workers/`, `site/`, `studio/`, and `atomm/`; routes hold only pages. Modules are imported as `$lib/<layer>/<module>` and relative imports are for siblings only, so a file's dependencies name their layer. See the [generator README](../apps/generator/README.md) for what each layer may import.

## Engraving fonts

Text stays text in the geometry IR (`label` and `textStyle` on a marking) and becomes paths when a preview or export draws it, except for surface-following annotations in layered output, which are drawn and clipped during generation. The three built-in fonts are a bitmap table in `annotate/labels.ts`. The curated typefaces are glyph files that the host fetches and passes to `registerFont` in each JavaScript realm before it generates or renders; the studio does this in `PreviewPipeline.generate` for the page and in the geometry worker for itself. Drawing a typeface that is not registered throws `FontNotLoadedError` rather than substituting another font. The fingerprint covers the chosen font id, not its glyphs, so a released glyph file never changes; see [fonts.md](fonts.md).

## Coordinate conventions

- Geographic inputs are WGS84 longitude/latitude.
- Elevation/vector tiles use Web Mercator tile coordinates.
- Geometry IR and SVG use millimeters, centered at `(0, 0)`, with Y down.
- three.js extrudes XY outlines along +Z and mirrors Y once on the content group.

## Data coverage

The first release supports land terrain between ±85.0511° latitude. Mapzen Terrarium tiles provide elevation. The pinned Protomaps 20260905 archive provides OSM-derived roads, trails, and water through zoom 12 from `osm/current.pmtiles`; the browser requests one vector zoom beyond the reference-map zoom when the archive and tile budget permit, then clamps to the advertised range. Source resolution varies, and all output is decorative rather than survey-grade.

## Versioning

`ProjectConfigV1`, `SourceBundleV1`, `GeometryIRV1`, and the exported manifest are explicitly versioned. Any incompatible change must introduce a migration rather than silently reinterpret an IndexedDB or exported project. Replacing the stored `layerCount` with `verticalExaggeration` originally moved the fingerprint prefix to `v3-`; projects saved before that load at the default exaggeration and must be regenerated once before export. The current prefix is `v9-`. The earlier `v7-` invalidated geometry generated with the former total-layer or hidden depth-layer caps. The preceding `v6-` removed the total-layer ceiling. The preceding `v5-` invalidated geometry generated before the launch-readiness crop, clipping, and water-scaling fixes.

Usage events (`@topostack/data-contracts/usage`) are not stored, but the Worker validates them strictly, and a tab loaded before a deploy keeps sending the previous shape. New categories may be appended to an existing list; new fields are added only as an optional group that `isUsageEvent` accepts both with and without (as `campaign` and `medium` are); removing a value or field rejects events from open tabs.

## Hidden assembly marks

Alignment outlines, the `Lxx` id each sheet carries for the sheet above, piece ids and sheet-nesting part ids must vanish once the model is glued. All of them are placed through `pipeline/hidden-marks.ts`:

- A hidden label sits in the glue area: its own piece under one piece of the sheet directly above. Seams between pieces above are edges, and a sheet two or more up does not count, because it covers only across an air gap such as a nest cavity.
- Placement measures the engraved ink, not the text's advance box (`labelInkExtent`, `labelFootprint`): typeface figures and ascenders rise above the cap line and script letters overhang, and stroked text is widened by half the line. The ink keeps `HIDDEN_LABEL_CLEARANCE_MM` from the glue edge.
- An alignment outline's centre line is inset by half the line plus one kerf (at least 0.1 mm), so the whole stroke stays inside the sheet above.

`hiddenMarkIssues(ir)` checks finished geometry against the same rule by sampling the ink every 0.1 mm; tests use it on generated stacks, and it is the first thing to run on a report of a visible id. Visible text (elevation, transportation and aviation labels, annotations) uses the same ink footprint for its fit and collision tests.

## Launch-readiness invariants

`sourceRequirements()` is shared by the provider, UI refresh logic, and core export policy. `exportBlockReason()` is shared by browser actions and both package builders. Transportation names are retained even when their labels are hidden. PMTiles caches live for one source operation; its header, directory, and body requests share cancellation and a 20-second request deadline. Source geometry is bounded to 200,000 points and 4,000 polygon rings before projection/union, with cancellation opportunities between decode batches.

The first browser preview is computed in a Web Worker. Its bounded generation session reuses unchanged terrain stages, and large stacks distribute alignment and elevation-label searches across up to four helper workers; see [generation performance](generation-performance.md) for cache ownership, boundary indexes, and stress benchmarks. WebGL startup failure selects the cut preview, and the asynchronously loaded Atomm SDK can register after its initial polling window. The build budget enforces both the studio's entry preloads and its default-preview startup graph (the studio route, App, Three.js and the geometry worker, but no other route).

The map camera fits stored geographic bounds to the actual responsive guide; resize events cannot overwrite the selection. Circular guides use the same physical-to-geographic transform as the crop. `crop.ts` derives relief from retained material and interpolated edge samples. Empty circular caps below the minimum feature size are omitted with a warning; interior empty sheets still block fabrication. Lake depth uses geographic grid spacing, independent of physical stretching. Boundaries, grids, roads, and waterways are clipped across exposed layer faces. Fixed annotations are omitted with a warning when their complete footprint cannot fit the material.
