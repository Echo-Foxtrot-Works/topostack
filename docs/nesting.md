# Sheet nesting

Sheet nesting arranges a project's cut parts on as few stock sheets as possible. Parts are moved and, if the settings allow it, rotated. This differs from the *material nests* that generation already plans (see [architecture.md](architecture.md)). A material nest cuts a smaller layer from the waste of a lower layer at the same position, and nothing moves. Sheet nesting runs after that step and treats each nest family as a single rigid part.

The feature has four parts:
- the packing engine (`packages/nest-wasm`);
- the multi-sheet planner (`packages/core/src/export/sheet-nest/`);
- the nested fabrication package;
- the studio step in the export dialog.

[The plan](plans/sheet-nesting.md) lists later work.

## In the studio

The export dialog has a **Sheet layout** section for layered projects. The maker picks **Nested sheets** and sets the sheet size, spacing, edge margin, rotation and search time. These are stored in `project.sheetNesting` without regenerating anything. **Nest parts** then starts a search.

- **Loading:** `SheetNesting` (`studio/sheet-nesting.svelte.ts`) holds the search state. The planner and part extraction live in core's export chunk, so it loads them on demand from `studio/sheet-nest-runner.ts`. The worker (`workers/nest.worker.ts`) and the `.wasm` are fetched only when a search starts. `check-web-budget.mjs` fails the build if either reaches the startup path, and budgets the engine at 340 KB gzip.
- **Progress:** the worker streams each improved plan. The dialog draws every sheet as a thumbnail, and a sheet still packed by the fallback is marked pending. **Stop and keep best** terminates the worker and keeps the last plan; every draft is a complete, valid layout. **Cancel** discards the search.
- **Remembering layouts** (`storage/nest-cache.ts`): a finished layout is saved in IndexedDB under its job key, together with the maker's choice between sheets and panels. The cache keeps the 20 most recent layouts. After a reload, once a project with sheet settings regenerates the same design, the layout is restored without searching again. Only projects that set sheet settings load the planner to look it up, and the export still verifies the plan before using it.
- **When the export uses it:** only when **Nested sheets** is chosen and the plan still matches the geometry and sheet settings. After any change, the dialog asks the maker to nest again, and until then the export uses the original panels.
- **Fallback:** if WebAssembly cannot start, for example in a browser or host frame that forbids compiling it, the worker falls back to the bounding-box packer and the dialog says so. Without workers at all, the same packer runs on the main thread.
- **Security policy:** the site's policy allows `'wasm-unsafe-eval'` in `script-src`. That permits compiling WebAssembly and still forbids JavaScript `eval`.
- **Licences:** every build writes the engine's licence notices to `dist/licenses/third-party.txt`, and `verify-atomm-dist.mjs` checks that they are there.

`e2e/nesting.spec.ts` runs the whole flow in all three browsers and asserts that sparrow, not the fallback, produced the plan.

A plan records the engine that searched. Each sheet's `method` says whether sparrow packed it or the bounding-box layout was kept because sparrow found nothing tighter. Nearly rectangular parts, such as whole layers or seam pieces, often already pack optimally as boxes.

## Planner

1. **Settings** (`resolve.ts`): `ProjectConfigV1.sheetNesting` holds the sheet size, margin, spacing, rotation mode, time budget and seed. A sheet axis left at 0 takes the machine work area on that axis. The fingerprint ignores this field, so changing it never forces a regenerate.
2. **Parts** (`parts.ts`): each root polygon of a nest family is one rigid part, together with every polygon cut out of it. Seam pieces are already one polygon each. The outline sent to the packer is the kerf envelope of the root's outer ring, thinned to at most 400 vertices. The thinning only ever grows the outline: Douglas-Peucker first, then an outward offset by the same tolerance.
   - **Grouping tiny islands** (`clusterSmallParts`): tiny islands under 400 mm², such as peaks and seam slivers, each cost the packer as much as a whole layer. Islands of the same layer within 10 mm of each other become one rigid part, outlined by their convex hull, up to 12 islands per group. A group only forms while its hull stays within three times the islands' own area. Grouping cuts the item count, and the islands stay together on the sheet. The group's label lists its pieces, and each island still gets its own engraved id.
3. **Sheets** (`plan-sheets.ts`): the planner first emits a bounding-box skyline layout (`rectangles.ts`), so a valid plan exists immediately. It then fills one sheet at a time. For each sheet it:
   - picks the largest remaining parts up to a target share of the sheet's area (85%, then lower);
   - asks sparrow to fit them into a strip as tall as the usable sheet, stopping as soon as the strip is no wider than the sheet;
   - commits the sheet, after one top-up attempt with a few more parts.
   Any time left merges the last sheet into the one before it and shortens the last sheet to leave the largest offcut. The result never uses more sheets than the bounding-box layout.
4. **Checking** (`verify.ts`): every layout the engine returns is checked independently before it is used. Each part must be placed once, inside the margin, and at least the spacing from every other part (Clipper offsets, 0.02 mm tolerance). A layout that fails is treated as not fitting.
5. **Identity** (`job-key.ts`): a plan records a hash of the part outlines and layout settings. Regenerating an unchanged design gives the same key, so a saved plan stays usable. A changed design or sheet setting makes it stale.

Layouts stop on time, so the same job can come out differently on a faster machine. The saved plan, not a rerun, is what an export reproduces.

## Output

`buildFabricationPackage(ir, config, { sheetPlan })` writes one set of files per stock sheet instead of one per nest family. The export is refused if the plan's job key no longer matches, or if the plan fails verification. Without `sheetPlan`, the package is byte-identical to the one exported before sheet nesting existed.

- **Sheet files:** `<name>-sheet-NN.svg`, its `-engrave.svg` companion, and `-paint-<kind>.svg` stencils. Each is in sheet coordinates with a viewBox of `0 0 W H`. The master SVG lays the sheets out side by side.
- **Placing parts** (`sheet-svg.ts`): each part is drawn by the same panel writer as before, from its own polygons in model coordinates. It is wrapped in `<g id="part-N-<OP>" data-part="<label>" transform="matrix(...)">`, with rotation terms written to nine decimals. Kerf offsets do not depend on rotation, so path data is reused unchanged. Ids inside each part get a `--pN` suffix so repeated layer groups stay unique. Engraving is prefiltered by bounding box before it is clipped to each part.
- **Part ids** (`part-labels.ts`): seam pieces already carry their `L03-B2` id from generation. Every other piece gets `L03`, or `L03-2` for an island, engraved as a green ASSEMBLY mark where the layer above hides it. This uses the same placement as generation (`pipeline/piece-labels.ts`). Pieces with no covered room are listed in the README.
- **Assembly guide:**
  - **Sheet maps:** "Cut the sheets" draws every sheet. Each piece's own terrain polygon, holes included, is moved and turned exactly as the sheet SVG places it, so the islands of a group and a piece cut from inside another show as they are cut.
  - **Labels:** each piece is named at a point inside it. Alternate layers are tinted differently, so a piece cut from inside another stands out, and small pieces get smaller labels.
  - **Layer steps:** each step lists which of its pieces are on which sheet, and the guide explains the engraved ids of unsplit layers.
  - **Test:** a test parses each map and its sheet SVG and checks that every piece's label lies inside that piece's cut outline.
- **Manifest:** `result.fabrication.sheetNesting` records the engine, versions, settings, counts, utilization and time. Each `panels[]` entry adds `sheet`, `usedWidthMm`, and `parts[]` with each part's placement. These fields are only added, so `schemaVersion` stays 1.
- **README:** describes the sheets, rotation and spacing, and credits sparrow and jagua-rs with source links.

## Engine

The packing engine is [sparrow](https://github.com/JeroenGar/sparrow) by Jeroen Gardeyn (KU Leuven). It is built on [jagua-rs](https://github.com/JeroenGar/jagua-rs), his collision-detection engine. `packages/nest-wasm` compiles both, unmodified, to WebAssembly, and a web worker runs the result, so nothing is sent to a server.

sparrow solves 2D irregular *strip* packing: fit every part into a strip of fixed height and make the strip as short as possible. It first builds a layout, then alternates two phases:
- **Exploration:** shrink the strip and remove the resulting overlaps with a guided local search.
- **Compression:** make finer shrinks later on.

The wrapper fixes a few details:
- **Coordinates:** each placement maps a part's own outline coordinates onto the strip, rotation first and then translation. jagua-rs centres shapes internally, and the export undoes that.
- **Spacing:** jagua-rs keeps items apart by growing each item by half the spacing and shrinking the container by the same amount. That would leave a full `spacing` gap at the sheet edge. The wrapper enlarges the strip to cancel it, so parts may touch the sheet edge but stay `spacing` apart from each other.
- **Fit tolerance:** the collision engine counts touching as overlapping. The wrapper therefore allows outlines to cross the strip edge by a fit tolerance (0.01 mm by default), so a part exactly as tall as the sheet still fits. That is well under a laser kerf.
- **Stopping:** a job stops at its time limit, or earlier once a target width is met. The multi-sheet planner uses the target width to learn quickly whether a set of parts fits one sheet.
- **Threads:** the build is single-threaded. Running in parallel would need cross-origin isolation headers, which the site and the Atomm embed do not send.

Limits of jagua-rs 0.8.3: it ignores holes in parts, and it rejects parts made of several polygons. So a small part is never placed inside a hole of another part.

## Credits and citation

sparrow is MIT-licensed (© 2025 Jeroen Gardeyn, KU Leuven). jagua-rs is licensed under MPL-2.0 and is used unmodified. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) has the licence texts and source links.

If you publish work that relies on this feature, please cite:

- Jeroen Gardeyn, Greet Vanden Berghe, Tony Wauters. "An open-source heuristic to reboot 2D nesting research." arXiv:2509.13329, 2025. https://doi.org/10.48550/arXiv.2509.13329
- Jeroen Gardeyn, Greet Vanden Berghe, Tony Wauters. "Decoupling Geometry from Optimization in 2D Irregular Cutting and Packing Problems: an Open-Source Collision Detection Engine." INFORMS Journal on Computing. https://doi.org/10.1287/ijoc.2024.1025 (accepted manuscript: arXiv:2508.08341)
