# Depth charts: first release implementation plan

> **Status:** shipped in 0.5.0 ([#89](https://github.com/Echo-Foxtrot-Works/topostack/pull/89)). Kept as the design record; the maintained reference is [depth-chart-tracing.md](../depth-chart-tracing.md).

The September 23 accuracy trial rejected unattended raster-to-depth generation. The first release will support flat, georeferenced charts of a single lake without islands, with complete, non-crossing closed depth contours. Photos with perspective, incomplete charts, and island/saddle topology are outside this initial profile.

1. Separate contour preparation from depth generation. Preserve vector PDF paths when available; raster extraction proposes geometry only. Do not silently infer the production contour values.
2. Add a source-overlay editor: select paths, assign and confirm values, exclude stray paths, join open paths, redraw/add paths, close paths, undo/redo. Explicitly identify the source shoreline. All included paths must be reviewed.
3. Calibrate flat charts using at least four distributed image/geographic control points and an affine fit. Check residuals and selected-lake overlap. Show the map outline over the source to make registration inspectable.
4. Block depth generation on unresolved values, incomplete geometry, crossings, unsupported depth ordering, or poor alignment. Build the grid from exactly the reviewed paths and source shoreline. Editing any input invalidates generated output and layer review.
5. Require a separate layer/appearance review before saving. Persist a versioned review receipt with the chart. Retain legacy files for export/recovery, but do not apply unreviewed user charts to new terrain generations.
6. Test editing, gate failures, stale asynchronous results, persistence/import behavior, and actual browser interaction. Exercise the reviewed builder with real source chart geometry and independent QA soundings. Capture screenshots of the revised workflow.

The receipt records workflow completion, not surveyed accuracy or cutting certification. `publishable` continues to mean license eligibility only. Production launch requires the automated checks, real-data results, and guide evidence below; a representative physical cut/assembly remains an external release check and must not be claimed as completed by software tests.

## Release evidence

Steps 1–6 are implemented. See the [release report](../reports/chart-first-release-2026-09-23.md), [reproduction harness](../../scripts/verify/chart-release/README.md), and [guide captures](../images/chart-release/README.md). A representative physical cut/assembly and acceptance of shoreline fallback appearance remain launch checks. No production deployment is part of this local implementation task.
