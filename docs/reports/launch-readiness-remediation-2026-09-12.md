# Launch-readiness remediation

This implements the fourteen actionable findings in [the original review](launch-readiness-review-2026-09-12.md), plus the associated source-policy, performance, dependency, monitoring, and release-maintenance improvements. The original review is a historical snapshot; this document describes the remediation. Existing working-tree changes were preserved. No deployment or data provisioning was performed.

## Findings and fixes

| Review finding | Implementation | Regression coverage |
| --- | --- | --- |
| 1. Vulnerable MapLibre | MapLibre 6.9.0; migrated to its named module exports. Patched root Wrangler and the test pool's Miniflare chain, including sharp 0.35.4. | Full dependency audit; actual MapLibre browser interaction. |
| 2. Stale browser fixture assertion | Preview layer expectation matches the current thirteen-layer fixture. | Complete generation and ZIP-download scenarios. |
| 3. Unbounded tile allocation | Compute candidate count before allocating tile objects; downshift before iteration. | Near-world bounds at zoom 15 finish within the tile budget. |
| 4. Incorrect map crop | Fit authoritative geographic bounds to the responsive guide. Own resize handling, prevent accidental camera rotation, and transform circular guides consistently with physical output. | Real MapLibre marker alignment across opening, resizing, and reopening, with export readiness preserved. |
| 5. PMTiles failed-header cache | Each source operation owns its archive and header/directory cache. A later generation starts fresh. | Actual PMTiles fail-once/succeed-next header requests. |
| 6. Archive cancellation/deadlines | All range reads, including headers, directories, and bodies, receive operation cancellation and a 20-second request deadline. | Abort during header, directory, tile, and response-body requests; timeout without user cancellation. |
| 7. Missing transportation labels | Retain names during initial decoding even when labels are hidden. | Provider name retention plus a real-source component transition from hidden to visible labels without a reload. |
| 8. Discontinuous boundaries | Clip full boundary/grid paths against each exposed layer, as for roads and waterways. | Sparse paths preserve their full 298 mm length across the stack. |
| 9. Circular crop extrema | Compute relief from retained material plus interpolated crop-edge values. Omit empty circular caps below the minimum feature size with a warning; interior gaps still block fabrication. | Both output modes with excluded peaks, plus retained interpolation at an edge. |
| 10. Lake depths change on resize | Pass geographic grid height separately from physical dimensions. | Nonuniform output resizing preserves every modeled elevation sample. |
| 11. Concave containment | Reject edge intersections independently of the clearance margin. | Narrow concavity between footprint corners and midpoints, at zero margin. |
| 12. WebGL startup failure | Catch renderer construction failure and select the cut preview. | Browser starts with WebGL disabled, displays 2D output, and emits no uncaught exception. |
| 13. Stale geocoder cache | Check R2 upload age and cap browser freshness to the remaining lifetime. | Fresh 23-hour object receives one hour; 25-hour object is refreshed. |
| 14. Small-output annotations | Measure complete annotation groups including label footprints and stroke clearance; omit groups that do not fit, with warnings. | Valid 10×10 mm output contains neither overflowing compass nor scale markings. |

## Additional improvements

- Core `sourceRequirements()` and `exportBlockReason()` are shared by providers, UI actions, and both package builders. Crop calculations, archive lifecycle handling, and source-complexity limits have focused modules.
- Geometry fingerprints use `v5-`, invalidating results produced before the fabrication corrections.
- Source processing is limited to 200,000 points and 4,000 polygon rings before projection/union. Decode batches yield for cancellation. Off-crop linework no longer consumes the marking budget, and the 7,200-fragment cleanup allowance is shared across the selection before applying the 1,800-marking export limit. Real-data validation exposed both counting issues; regressions cover off-crop roads, dense tiles with empty neighbors, and excessive raw detail.
- Initial preview geometry runs in a Web Worker. The Atomm SDK loads asynchronously; a late script load can still register after the discovery polling window.
- The asset budget includes a separate default-preview startup budget covering the 3D engine and geometry worker.
- Readiness requires both archives, matching default water-depth export requirements. Gateway completion logs include HTTP status, cache outcome, and duration.
- The live browser canary downloads and inspects its fabrication ZIP, detects uncaught browser errors, and uploads failure diagnostics.
- Release packaging records ZIP hash, revision/dirty state, API origin, dataset version, and archive identities. Provisioning emits dataset digest receipts. The [acceptance and rollback runbook](../release-acceptance.md) covers coordinated restoration and retaining the source archives.
- CI audits development/build dependencies as well as production dependencies. `.nvmrc`, CI, and package engines reflect supported Node releases; Worker types were regenerated with upgraded Wrangler.

## Validation

Validation used a clean `npm ci` on Node 22.22.2 / npm 10.9.7, matching the checked-in CI runtime. All configured coverage thresholds were retained.

| Check | Result |
| --- | --- |
| Dependency installation and tree | Clean install and `npm ls` pass without engine mismatches. |
| Full dependency audit | Zero vulnerabilities, including development/build dependencies. |
| Lint and type checks | Pass; zero Svelte errors or warnings. |
| Unit/component/Worker tests | 189 passing: 79 core, 57 frontend helper, 27 component, 26 Worker. |
| Core coverage | 97.47% lines, 83.24% branches. |
| Frontend helper coverage | 73.26% lines, 64.39% branches. |
| Component coverage | 54.84% aggregate lines, 43.57% branches; App itself 86.1% lines. Aggregate includes mocked source/storage modules. |
| Worker coverage | 96.68% lines, 82.97% branches. |
| Build and Worker types | Core, static frontend, Worker dry run, and generated-type check pass. |
| Browser regressions | All 14 Chromium/WebKit tests pass, including full export, actual MapLibre crop alignment, denied WebGL, compact layouts, and keyboard focus. |
| Web budgets | Pass: initial JS 160,580 bytes gzip; startup JS 354,786; total JS 640,365; largest chunk 275,216; CSS 24,868; HTML 2,220 bytes. |
| Atomm artifact | Production packaging, full static endpoint scan, ZIP integrity, and checksum/receipt agreement pass. |
| Live production canary | Updated generation, ZIP download, master-SVG inspection, and uncaught-error check pass against the existing deployed service. |

The new production client was also exercised in Chromium with real API requests forwarded to the existing public gateway. These checks validate the new client against live data; the revised Worker was tested locally and was not deployed. Every scenario below generated and downloaded both output modes, with a master SVG present, finite coordinates, and no uncaught browser exceptions.

| Real-data scenario | Location / zoom | Stack ZIP files | Engraving ZIP files |
| --- | --- | ---: | ---: |
| Mountain / lake | Bundled Crater Lake selection | 23 | 4 |
| Coast | Bandon, 43.12 / −124.4, zoom 12 | 17 | 4 |
| Low relief / city roads | Lawrence, 38.95 / −95.23, zoom 12 | 11 | 4 |
| Circular crop | Crater Lake, circular material | 31 | 4 |
| Date line | Fiji, −16.85 / 179.99, zoom 12 | 41 | 4 |
| Dense water | Finland, 62.18 / 28.5, zoom 14 | 17 | 4 |

A single cold-start diagnostic at a 390×844 viewport, 4× CPU slowdown, 150 ms network latency, and 200 KB/s download reached the preview canvas in 5.789 seconds. It recorded five long tasks, with the longest at 1.623 seconds. The SDK was unavailable in this probe. Initial geometry now runs off the main thread, but this measurement still leaves renderer/hydration performance work for slower devices; it is not a universal startup guarantee.

The candidate [Atomm ZIP](../../apps/generator/topostack-atomm.zip) contains 36 entries and is 692,855 bytes. Its SHA-256 is `2d7c3845568f8907ed25d595380d92582eca0a6314f538546e2485c0ac32362b`. The adjacent [release receipt](../../apps/generator/topostack-atomm.release.json) records the API origin, dataset version, both archive identities, and `workingTreeDirty: true`; this is a local candidate built from the preserved working tree. Build the published release from a clean reviewed commit. No deployment was performed.

## Remaining release acceptance

The local macOS Firefox graphics process still cannot launch. A follow-up Linux container run on Node 22.22.2 passed all seven Firefox tests using an Xvfb display, including actual map rendering. All 21 browser scenarios subsequently passed in GitHub CI on `4d731eb`. Run the full pipeline again for the chosen release commit.

The real Atomm host, Open in Studio interpretation, and physical xTool fabrication still require acceptance against the release ZIP. Account secrets, quotas, notification routing, the R2 `geocode/` cleanup lifecycle, and a coordinated rollback rehearsal are operator checks. Instructions and evidence requirements are in the runbook; this work did not change production account state or claim those checks were completed.

Production client telemetry beyond the browser canary remains an operational integration decision. The changes improve failure recovery, browser diagnostics, and gateway observability without silently introducing a third-party telemetry service.

## CI follow-up

[The first CI run](https://github.com/Echo-Foxtrot-Works/topostack/actions/runs/34716728384) passed audit, lint, type checks, build, size budgets, all 79 core tests, and all 57 frontend-helper tests. It exposed a component-test timeout under coverage and four Firefox failures that local Chromium/WebKit validation did not reveal.

- Preview failures now have a separate notice, preserving generation status. Failed 3D initialization is remembered during automatic view changes; explicit user selection can retry it.
- Map initialization catches unavailable WebGL2 and returns to the appropriate 2D view. Search/coordinate entry and export remain usable. The browser regression now exercises generation, a 3D retry, map failure in both output modes, and location-dialog access with WebGL disabled.
- Firefox CI runs against Xvfb with software WebGL enabled. The actual map-alignment tests remain enabled.
- Touch-target assertions allow 0.01 pixels of floating-point error; Firefox reported a 44-pixel target as 43.999996 pixels.
- Component tests receive an isolated clone of a precomputed preview, matching the page's Worker-result input. This avoids generating identical startup geometry for every test. The combined large-output resize and unit-conversion scenario is split into two focused cases, keeping both behaviors and all source-refetch assertions. Coverage thresholds and test time limits remain unchanged.

Local validation passed lint/type checks, all 14 Chromium/WebKit scenarios, all seven Firefox scenarios in Linux, and the component suite with coverage; the split resize scenario adds one component case.

[The follow-up CI run](https://github.com/Echo-Foxtrot-Works/topostack/actions/runs/34722570241) passed all 190 unit/component/Worker tests, all 21 browser scenarios, and all quality/build checks. Development deployment succeeded, then its smoke test exposed Wrangler's decorated custom-domain output (`hostname (custom domain)`). The verifier now normalizes that exact display form to an HTTPS origin before applying its existing strict URL validation. This preserves support for ordinary deployment URLs and the public monitor's explicit HTTPS configuration.
