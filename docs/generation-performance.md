# Geometry generation performance

`generateGeometry(config, source, { onStage })` optionally reports elapsed milliseconds for preparation, water carving, ladder planning, contours, acrylic water inserts, splitting, nesting, fabrication indexes, feature routing, alignment, assembly labels, elevation labels, and final annotations. Timings are diagnostic only and never enter the geometry IR or fingerprint. They exclude source downloads and preview rendering. Asynchronous stage timings include helper setup and worker messages.

`createGeometryGenerator()` returns the same synchronous interface with one worker-local terrain cache. The browser coordinator uses the equivalent asynchronous session; its main-thread fallback uses this synchronous factory. The cache holds only the most recent source/config combination. Source bundles are immutable snapshots: replace the source object when changing elevation, bathymetry, vectors, or metadata, as already required by the worker's source-identity protocol.

The cache saves smoothed shores, validated elevation, carved water, the elevation ladder, and raw contour layers. Annotation, line-style, and fabrication-only edits reuse these stages. Terrain inputs (including size, thickness, exaggeration, smoothing, crop, depth settings, and replacement source identity) invalidate them. The key includes all config fields except an explicit downstream allowlist, so newly added fields invalidate by default. Source warnings are evaluated afresh. Cached contour layers are cloned before nesting, cutting, or annotation mutates them; callers cannot corrupt a later result by modifying an earlier result.

## Boundary and placement work

Prepared rings lazily build balanced bounding-box hierarchies over consecutive edges. Clipping and point queries skip distant edge groups, while retaining their original intersection and ray-crossing predicates. Index lifetime follows the prepared descriptor, rather than a global cache of mutable input arrays. Prepared input must remain unchanged; rebuild after edits.

Nesting shares prepared polygons across candidate placements and explicitly invalidates them whenever cavities are added or rolled back. A connected ring inside material cannot leave it without crossing a boundary: one anchor containment test plus exact intersection/clearance checks replaces ray-casting every vertex and midpoint. Contained holes remain forbidden except for the existing chained-cavity revalidation rule. Kerf, glue margin, contour resolution, smoothing, and feature-size tolerances are unchanged.

Label searches reuse material indexes across candidates. Their search order, fit limits, obstacle rules, and geometry predicates remain intact.

For tall stacks with many features (`enabled feature count × layers >= 1000`), covering material is unioned top-down once per layer. Roads then query the visible boundary instead of every buried contour. Sparse maps and engravings keep the cheaper original covering sets. If the boolean library fails on near-coincident edges, generation falls back to the complete original covering rings; this optional optimization must never prevent generation.

## Parallel layer annotations

`createParallelGeometryGenerator()` keeps the same terrain cache and yields pure `GeometryBatch` jobs through an injected asynchronous executor. Core has no browser or worker dependency. Large relief stacks (32 layers or more) parallelize alignment guides and elevation-label candidate searches. The coordinator still performs final stack-wide label selection, preserving its original ordering and collision rules. Small maps and shared-face engravings use the serial path. Contouring, material nesting, and feature routing remain serial.

The browser coordinator starts helpers lazily and retains them across edits. It uses at most four helpers, leaving one logical CPU available when reported hardware concurrency permits. Each helper receives two layers at a time; results are restored to their original indices regardless of completion order. Each stage sends config once per helper, and workers load the selected label font in their own realm. They receive only the layer geometry needed for their jobs, rather than a separate elevation grid and full generation session.

Cancelling a generation aborts and terminates active helpers. The coordinator serializes replacement requests, acknowledges cancellation, and retains valid terrain data. Client progress messages give a responsive coordinator time to acknowledge cancellation before the existing one-second forced-restart rule applies. A helper construction, loading, protocol, or 30-second response failure disables the pool and retries the whole pure stage on the coordinator, yielding between chunks for cancellation. No partial worker output is committed. The next coordinator lifetime may try helpers again.

## Reproducible stress benchmark

```sh
npm run build -w @topostack/core
node scripts/verify/benchmark-generation.mjs --teton --roads 0 --runs 3 > terrain.json
node scripts/verify/benchmark-generation.mjs --teton --roads 0 --runs 3 --workers 4 > parallel.json
node scripts/verify/benchmark-generation.mjs --teton --roads 300 --runs 3 --workers 4 > roads.json
```

The benchmark uses Grand Teton bounds west −110.94, east −110.65, south 43.63, north 43.84; 3000 × 3000 mm artwork; 3 mm material; default 2× vertical exaggeration; and a 768 × 768 grid. Public Mapzen Terrarium zoom-12 tiles are bilinearly sampled and cached in the operating-system temporary directory. Tile downloads are excluded from reported timings. Terrain is real, while the optional 300 full-width, 80-vertex roads are synthetic stress paths. This is deliberately not an OSM-road or lake-depth accuracy fixture, and the source retains its non-exportable synthetic classification.

Without `--teton`, terrain is also synthetic and no network is used. `--grid`, `--roads`, and `--runs` control workload; `--no-annotations` and `--no-nesting` isolate stages. `--engine /absolute/path/to/core/index.js` compares an independently built engine using exactly the same inputs. Each run creates a fresh generator, measures its cold generation, then measures an elevation-label toggle with the source unchanged. Older engines without the factory simply regenerate for both calls.

Add `--workers 1`, `2`, `3`, or `4` to run the production pool scheduler against real Node worker threads. The default `--workers 0` measures the synchronous implementation. Helpers persist across runs, while the terrain session resets for each cold case. Worker startup and structured-clone costs are included in parallel timings. Reports include helper fallback errors, source and output SHA-256 hashes, timings, Node version, layer count, and marking count. Only `generatedAt` is omitted from output hashing. Compare hashes before claiming a speedup preserves output; compare inputs and flags before comparing times. Wall times are local diagnostic measurements, not browser latency guarantees. Browser coordinator startup, source loading and transfer, GPU meshing, rendering, and export add separate costs.

The [serial optimization report](reports/generation-benchmark-20260924.md) and [parallel worker report](reports/generation-parallel-benchmark-20260924.md) record measured timings, output comparisons, and validation limits.

After building core and generator, `node scripts/verify/parallel-browser.mjs` checks the production worker bundles in Chromium, Firefox, and WebKit. It verifies custom fonts, cancellation, cache reuse, and blocked-helper recovery. Parallel and serial fallback output must match exactly within each browser; comparisons with Node permit only 1e-8 numeric differences for engine-specific floating-point math. The harness serves production CSP on loopback HTTP, omitting only the HTTPS-upgrade directive; it does not modify production headers.

## Rust/WASM follow-up

The initial dense-road profile was dominated by boundary scans, not contour extraction. Reducing repeated work is the first optimization. `@topostack/nest-wasm` wraps the sparrow/jagua-rs strip packer used for [sheet nesting](nesting.md). That solver is not a terrain or polygon-visibility kernel, and this change does not modify it. No Rust dependency or WASM asset is added here. The stage benchmark establishes a comparison point for a later native kernel and catches cases where conversion, initialization, or unchanged annotation work consumes its savings. Keep any future kernel behind the same geometry contract and compare outputs, holes, glue clearances, and browser startup costs before enabling it.
