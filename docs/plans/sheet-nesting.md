# Sheet nesting with sparrow (WASM)

> **Status:** shipped in 0.6.0 ([#105](https://github.com/Echo-Foxtrot-Works/topostack/pull/105)). Kept as the design record; the maintained reference is [nesting.md](../nesting.md). "Today" below means before that release.

## Context
TopoStack has no sheet packing today. `packages/core/src/pipeline/nesting.ts` only does same-position cavity nesting: a smaller layer is cut from a lower layer's waste, with no moves. Export panels (`export/panel-layout.ts` `fabricationPanels`) are bounding boxes in model coordinates. `masterToSvg` lays them out in a plain grid, so stock around every layer is wasted. `docs/roadmap.md:27` lists translated/rotated sheet nesting as future work.

Goal: an explicit "Nest parts" step that packs every cut part onto as few fixed stock sheets as possible, with translation and rotation. It is built on sparrow (MIT, © 2025 Jeroen Gardeyn, KU Leuven), which depends on jagua-rs (MPL-2.0), and both are credited properly.

User decisions:
- sparrow and jagua-rs are compiled **unmodified to WASM** and run in a lazy-loaded worker.
- Parts go onto **many fixed sheets**. Sheet size defaults to the work area.
- Rotation is a user setting: none / 180° / 90° steps (default) / free.
- Nesting runs from an **explicit Nest parts step**, with a time budget, progress, live preview and stop/cancel. Unnested export stays the default.

Work lands as a series of PRs into `dev`, starting from branch `feat/sheet-nesting`.

PR 1 found three differences from the original assumptions:
- jagua exports rotation in degrees, not radians.
- The strip needs `2·spacing` added, not `spacing`, because the container is deflated by half the spacing on each side.
- It also needs a small fit tolerance, because touching counts as collision.

The wrapper handles all three, so the TypeScript driver sees plain sheet coordinates.

## Verified facts that shape the design
- **Holes and multipolygons:** jagua-rs 0.8.3 ignores holes in items and rejects multipolygons, so each part is sent to the engine as its outer outline only. Filling holes is later work.
- **Strip packing only:** sparrow solves one fixed-height strip and minimises its width. It has no multi-bin support, so a TypeScript multi-sheet driver has to probe the strip solver.
- **Spacing inflates edges too:** jagua inflates items by spacing/2, including against the container edge. The driver enlarges the usable strip by `spacing` and shifts the output to cancel this. Without that, seam-split pieces sized to the work area would never fit.
- **sparrow API:** `optimize(instance, rng, &mut SolutionListener, &mut Terminator, &ExplorationConfig, &CompressionConfig, Option<&SPSolution>)`. Instances are built with `Importer::new(...)` and `jagua_rs::probs::spp::io::import_instance`.
- **Time source:** `jagua_rs::Instant` is `web_time`, so it is safe on wasm.
- **Settings vs fingerprint:** `pipeline/fingerprint.ts:5` hashes the whole config except `explodedPreview` and `name`. The new `sheetNesting` field must be excluded there, or changing sheet settings would block export.
- **CSP:** `apps/generator/static/_headers` CSP lacks `'wasm-unsafe-eval'`, so wasm would be blocked in Chromium and Firefox.
- **Budget script:** `scripts/build/check-web-budget.mjs` measures only .js and .css.
- **Toolchain:** local rustc is 1.72; sparrow needs 1.90 (edition 2024). A `rust-toolchain.toml` pin handles this through rustup.
- **Where data-contracts can't be used:** `packages/data-contracts` must not be a core dependency. Nest types therefore live in core `types.ts`, and the wasm wire types live in the new package.

## Architecture
```
Main thread (lazy export chunk)          nest.worker.ts                    nest-wasm (Rust)
nestableParts(ir) ── parts+settings ──▶  planSheets(driver, TS)  ──probe──▶ strip_pack(job) → sparrow::optimize
                  ◀── progress/plan ───  verifySheetPlan per probe ◀──────  placements
buildFabricationPackage(..., sheetPlan) → nested sheet SVGs + manifest + guide
```

## Phases (one PR each, to `dev`)

### PR 1: `packages/nest-wasm` engine (no-changelog)
- **Crate files:** `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` (1.90.0 + wasm32), `.cargo/config.toml`, `src/{lib,job,listener,terminator}.rs`, `tests/strip_pack.rs`.
- **Pinned dependencies:**
  - sparrow by git rev, `default-features = false`, never `simd`, `tui` or `live_svg`.
  - `jagua-rs = "=0.8.3"` with the `spp` feature.
  - Exact wasm-bindgen.
  - `getrandom` with `wasm_js`, and `jiff` with `js`.
- **API:** `engine_info()` and `strip_pack(job_json, on_report) -> Result<String, JsError>`.
  - `DeadlineTerminator` enforces a hard plus per-phase deadline.
  - The listener sends throttled feasible reports.
  - `n_workers = 1`, and the logger is never initialised.
- **Build:** `scripts/build.mjs` runs cargo, then wasm-bindgen, then wasm-opt. Its output goes to a **committed `pkg/`** plus `BUILD-INFO.json`, so normal `npm run build` and CI jobs need no Rust. Root script `build:nest-wasm`, plus a row in `scripts/README.md`.
- **TS wrapper:** `src/index.ts` exports `loadNestEngine` and the types `StripJobV1`, `StripResultV1` and `StripProgressV1`. `src/index.test.ts` loads the committed wasm in Node.
- **CI:** `.github/workflows/nest-wasm.yml`, path-filtered. It runs fmt, clippy, `cargo test`, the rebuild with a `pkg/` diff check, `cargo about`, and `cargo deny licenses`.
- **Spikes to settle first:**
  - S1: rayon falls back to one thread on wasm.
  - S2: no `std::time` on solve paths.
  - S3: the exported transform applies to the original input coordinates. Test containment and no overlap.
  - S4: orientations go in as degrees and rotation comes out in radians.
- **Attribution:** `THIRD_PARTY_NOTICES.md` at the root, with the sparrow MIT text and jagua-rs MPL-2.0 marked unmodified with a source link. Also a cargo-about `packages/nest-wasm/THIRD_PARTY_LICENSES.md`.

### PR 2: core planning (no-changelog)
New `packages/core/src/export/sheet-nest/`. It sits outside the eager `core` chunk and is exported explicitly from `index.ts`.
- **Types** in `types.ts`:
  - `SheetNestSettingsV1`: sheet W/H (0 = work area), margin, spacing, rotation mode, time budget, seed.
  - `NestPartV1`, `NestPlacementV1` and `SheetNestPlanV1`.
  - Optional `ProjectConfigV1.sheetNesting`.
- **Config plumbing:**
  - `fingerprint.ts` excludes `sheetNesting`, so old hashes are unchanged.
  - `storage.ts` `parseProject` reads it.
  - Check share-link, project-diff and history-keys.
- **`resolve.ts`:** `resolveSheetNestSettings(config)` covers defaults, the work-area fallback, clamps, and a "set a sheet size" error.
- **`parts.ts`:** `nestableParts(ir, settings)` gives one rigid part per nest-family root polygon (per seam piece when split).
  - Reuse `nestFamilies` and `rootPolygonByPolygon`; export them from `panel-layout.ts`.
  - The outline is the kerf envelope from `offsetClosedRing` (`primitives/geometry2d.ts`), then a conservative simplify-and-outset down to ≤400 vertices.
  - Move `simplifyRing` from `assembly-guide.ts` into geometry2d as `simplifyClosedRing`.
- **`job-key.ts`:** a content hash of the outlines and settings, excluding the time budget. It uses the same FNV scheme as the fingerprint.
- **`engine.ts`:** a `StripEngine` interface.
- **`rectangles.ts`:** a skyline bounding-box engine. It gives the instant baseline, the fallback when wasm is blocked, and the test fake.
- **`plan-sheets.ts`:** `planSheets(parts, settings, engine, {budgetMs, onPlan})`, the multi-sheet driver.
  1. Pre-pass over sizes:
     - An oversize part produces an error naming it and suggesting a work-area split.
     - A part close to full-sheet size gets its own sheet.
  2. Emit the rectangle baseline immediately.
  3. Fill one sheet at a time:
     - If the remaining parts might fit on one sheet, probe all of them.
     - Otherwise binary-search a target density with first-fit-decreasing subsets. Each probe is `engine.pack(stripHeight = Hu)` and it is feasible when `width ≤ Wu`.
     - Then top up with smaller parts.
  4. After each committed sheet, emit a complete plan: committed sheets plus a provisional rectangle layout of the rest.
  5. Spend the last 20% of the budget merging and compacting the final sheet.
  - Probe seeds are derived from the settings seed.
- **`verify.ts`:** `verifySheetPlan` checks containment and pairwise spacing with a bbox prefilter plus a clipper intersection. A probe that fails verification counts as infeasible.

### PR 3: core output (no-changelog)
- **`apply.ts`:** `nestedSheetPanels(ir, parts, plan)` builds sheet panels at `0,0,W,H`, with per-part sub-panels that reuse `included`.
- **`svg.ts`:**
  - `nestedSheetBodies` wraps each part's existing `panelBodies` output in `<g transform="matrix(...)">`. Path data is unchanged because kerf offsets don't depend on rotation.
  - `uniqueIds` fixes duplicate ids.
  - `partitionMarkings` makes engraving and labels follow their part without O(parts×markings) cost.
  - The paint template gets the same wrapping.
- **Part identification:** mixed layers share a sheet.
  - `part-labels.ts` adds assembly-id engravings on covered faces, reusing `annotate/label-placement.ts` `placeLabel`.
  - Extract `coveredParts` from `pipeline/generate.ts` into `pipeline/piece-labels.ts`.
- **`packages.ts`:**
  - New option `sheetPlan?`. It is validated against a recomputed job key; a stale plan throws.
  - Files are named `-sheet-NN`.
  - Additive manifest fields (`fabrication.sheetNesting`, per-panel `sheet` and `parts[]`); `schemaVersion` stays 1.
  - The README gets a nesting paragraph with sparrow and jagua-rs credit and source links.
- **`assembly-guide.ts`:** a "Sheet maps" section, plus a sheet reference in each layer's "Cut from" line.
- **Invariant:** unnested package output stays byte-identical, and a test guards it.

### PR 4: studio feature (changelog fragment for makers)
- **Worker and client:**
  - `$lib/workers/nest.worker.ts` loads wasm through `@topostack/nest-wasm/wasm?url`, runs `planSheets` with the wasm engine, and posts ready/unavailable/progress/plan messages.
  - `$lib/workers/nest-client.ts` follows the `chart-trace-client.ts` pattern. Stop means terminate and keep the best plan; cancel means terminate and reject. It falls back to the rectangle engine.
- **State:** `$lib/studio/sheet-nesting.svelte.ts` holds `SheetNestingState` (status, progress, plan, staleness by job key). It is exposed through `studio-context.ts`.
- **UI:**
  - A "Sheet layout" section in `ExportDialog.svelte` (layered output only), with Original panels | Nested sheets.
  - Settings: sheet size, spacing, margin, rotation, time budget.
  - A Nest parts button with progress, Stop and Cancel.
  - `panels/NestPreview.svelte` shows sheet thumbnails, with provisional sheets hatched.
  - Settings save through `updateProject` without regenerating.
  - `export-notice.ts`, `export-policy.ts` and the Atomm export pass `sheetPlan`.
- **Platform:**
  - Add `'wasm-unsafe-eval'` to the CSP in `static/_headers`, and extend `scripts/test/static-headers.test.mjs` and `verify-atomm-dist.mjs`.
  - Budget script: measure `.wasm`, add an enforced lazy `nestEngineWasmGzip` at the measured size +10%, and assert that no nest worker or wasm file is on the startup path.
- **Attribution:**
  - Rows on the `routes/attribution` page.
  - Credits in the root README.
  - Notices copied into `dist/licenses/`.
- **Docs:**
  - `docs/nesting.md`: method, driver, limits, determinism caveat, citations (sparrow arXiv:2509.13329; jagua-rs INFORMS JoC doi:10.1287/ijoc.2024.1025, exact titles copied).
  - Rows in `docs/README.md`.
  - Updates to `architecture.md` and `data-and-fabrication.md`: qualify "never rotates or translates".
  - Update `roadmap.md`.
- **E2E:** `e2e/nesting.spec.ts` with a 3 s budget. It downloads the ZIP and checks the sheet SVG and manifest in all 3 browsers, which also proves the CSP and wasm MIME type.

### PR 5: robustness (done)
- IndexedDB cache `$lib/storage/nest-cache.ts`: a layout and the export choice are restored after a reload.
- Clustering of tiny islands (`clusterSmallParts`).

### Later
- Building the package inside the worker for big jobs. Export is still fast enough on the main thread.
- Filling holes: small parts packed into large holes of other parts. jagua-rs ignores holes in items.
- Warm starts from a saved plan when settings barely change.
- Threads (wasm-bindgen-rayon + COOP/COEP; needs a hosting and Atomm review).
- Checking that xTool Studio and LightBurn read the nested sheets' `matrix()` transforms, before release.

## Risks
- **Wasm size:** estimated at ~200–400 KB gzip. It is lazy and off the critical path, and the budget script asserts that.
- **Upstream churn:** sparrow is 0.x. Pin the rev and keep all glue in `job.rs` and `lib.rs`.
- **Determinism:** layouts are time-bounded, so they depend on the machine. The stored plan is the source of truth, and tests assert properties rather than coordinates.
- **`matrix()` transforms in laser software:** check import in xTool Studio and LightBurn before PR 4. The fallback is to bake the transforms into the paths.
- **Many parts from seam splits:** handled by per-probe time floors, outline vertex caps and clustering.

## Verification
- **PR 1:** `cargo test --release` (S3 containment/overlap test), `node packages/nest-wasm/scripts/build.mjs`, `npm run test -w @topostack/nest-wasm`.
- **PR 2 and 3:**
  - `npm run test -w @topostack/core`, including the new `sheet-nest/*.test.ts`, the `svg.test.ts` additions, and a `fabrication-regressions.test.ts` case: parse the nested SVG, apply the transforms, and assert everything is inside the sheet with gaps ≥ spacing.
  - The byte-identical unnested package test.
- **PR 4:**
  - `npm run typecheck`, `npm run lint`, `npm test`, and the generator client tests (`ExportDialog.client.test.ts`, `nest-client.test.ts`).
  - `npm run build && npm run budget:web`.
  - `npm run test:e2e`.
  - A manual walkthrough in the preview: generate, Nest parts, watch progress and preview, then export.
  - Open the exported sheet SVG in the browser to check it visually.
