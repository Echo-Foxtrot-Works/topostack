# Documentation index

## Design and conventions

- [Architecture and geometry conventions](architecture.md) — the one authoritative geometry flow, coordinate conventions, versioning, launch invariants.
- [Data, attribution, and fabrication safety](data-and-fabrication.md)
- [Flat engraving workflow and SVG contract](flat-engraving.md)
- [Atomm automatic nesting validation](reports/atomm-automatic-nesting-20260924.md) — shared export layouts without additional embedded controls.
- [Atomm performance integration verification](reports/atomm-performance-integration-20260924.md) — regression results after integrating terrain performance and sheet nesting for the next Atomm review.
- [The Atomm embed](atomm-embed.md) — what the platform build shows differently (automatic terrain, Export view, no depth charts) and why.
- [Placement mode](placement.md) — the top-down draft layer for positioning annotations and custom graphics, and how to add a placeable.
- [Sheet nesting](nesting.md): the sparrow engine, how its WebAssembly wrapper handles coordinates and spacing, credits and citations. The phased plan is [plans/sheet-nesting.md](plans/sheet-nesting.md).
- [Acrylic water inserts](water-inserts.md) — cutting each lake out of its waterline sheet, the fitted acrylic piece and its ledge, map detail on the acrylic, and its own files, nesting and guide steps.
- [Engraving fonts](fonts.md) — the font kinds, the glyph build, adding a typeface, and why glyph data is immutable.
- [Geometry generation performance](generation-performance.md) — stage timings, cache ownership, parallel layer workers, boundary indexes, and the Grand Teton stress benchmark.
- [Terrain source selection](terrain-selection.md)
- [Terrain-informed lake basins](terrain-informed-lake-basins.md)
- [Lake shoreline smoothing](lake-shoreline-smoothing.md)
- [Data layer and cache review](data-layer-review.md) — cache ownership, failure behavior, source registration.
- [Terrain system review and source expansion plan](terrain-expansion-plan.md)
- [MCP server, in-chat preview and WebMCP](mcp.md) — where the agent code lives, how the server behaves, rate limits, running it locally, and adding a tool. The public references are the site guides `/guides/mcp-server`, `/guides/agent-api` and `/guides/browser-agents`.
- [Agent API, MCP server, and in-studio agent tools](plans/agent-api.md) — the design: REST, remote MCP with an in-chat preview, WebMCP in the studio, and the server-side generation phase after them.
- [Roadmap](roadmap.md)

## Package and tool READMEs

- [Development and operations](development.md): local setup, validation, deployment and releases, the Atomm package, and data provisioning (moved out of the root README).
- [Contributing](../CONTRIBUTING.md) and the [code of conduct](../CODE_OF_CONDUCT.md).
- [Generator](../apps/generator/README.md): layers, import rules, studio panels, stylesheet layout.
- [Core](../packages/core/README.md) and [data contracts](../packages/data-contracts/README.md).
- [Nest engine](../packages/nest-wasm/README.md): the sparrow WebAssembly build, rebuilding it, and upgrading the solver.
- [Map API Worker](../workers/map-api/README.md): setup and operations.
- [Scripts](../scripts/README.md): every operational script and what runs it.
- [CLAUDE.md](../CLAUDE.md): one-page map of where a change goes and the enforced rules.

## Runbooks (operations)

- [Data operations and measured baseline](data-layer-operations.md) — provisioning, cache lifecycle, archive pruning.
- [Surveyed lake-floor data](lake-bathymetry.md) — survey coverage and provisioning.
- [NOAA Great Lakes bathymetry](noaa-bathymetry.md)
- [NOAA lake depth integration plan](noaa-lake-integration-plan.md) — phased local runbook for adding NBS grids and ENC contours for every NOAA-covered lake.
- [Depth charts traced into bathymetry](depth-chart-tracing.md) — chart record contract, how traced charts carve, and the staged rollout.
- [NRCan HRDEM terrain](hrdem-terrain.md)
- [FAA aviation data](faa-aviation.md) — airspace, airports, runways, navaids, special use airspace and obstacles: sources, archive, and the per-cycle refresh. The phased plan is [plans/aviation-layer.md](plans/aviation-layer.md).
- [Curated terrain coverage](terrain-coverage.md)
- [Release acceptance and rollback](release-acceptance.md)
- [Changelog and releases](changelog.md) — writing fragments, the automated release commit, tags, and the /changelog page.
- [Search and discovery operations](seo-operations.md)
- [Feedback workflow and triage](feedback.md)
- [Launch kit](launch/README.md): sequencing, per-channel rules and post drafts, creator outreach, honest media captions, UTM scheme and the weekly measurement routine.

Python data builders under `scripts/` use one pinned environment: `scripts/data-build/requirements.txt`.

## Reports (point-in-time, not maintained)

Dated snapshots kept for history. Do not update them; write a new one.

- [Launch-readiness review, 2026-09-12](reports/launch-readiness-review-2026-09-12.md)
- [Launch-readiness remediation, 2026-09-12](reports/launch-readiness-remediation-2026-09-12.md)
- [SEO discoverability audit, 2026-09-15](reports/seo-discoverability-audit-2026-09-15.md)
- [Canadian terrain packaging benchmark, 2026-09-16](reports/terrain-benchmark-20260916.md) ([data](reports/data/terrain-benchmark-20260916.json))

- [Depth chart readiness review, 2026-09-23](reports/depth-chart-readiness-2026-09-23.md)
- [Lakes NOAA nautical charts can supply depths for, 2026-09-24](reports/noaa-chart-lake-coverage-2026-09-24.md) ([data](reports/data/noaa-chart-lakes-20260924.json)) — every US lake with charted contours or soundings, tiered by detail, for plan phase 4.
- [NOAA lake depth coverage, 2026-09-24](reports/noaa-lake-coverage-2026-09-24.md) ([data](reports/data/noaa-lake-coverage-20260924.json), [NBS inventory](reports/data/nbs-inventory-hydrolakes-20260924.json)) — every lake NOAA grids or charts can supply depths for, and what is not yet integrated.

- [Grand Teton generation benchmark, 2026-09-24](reports/generation-benchmark-20260924.md) ([data](reports/data/generation-benchmark-20260924.json))
- [Parallel generation benchmark, 2026-09-24](reports/generation-parallel-benchmark-20260924.md) ([data](reports/data/generation-parallel-benchmark-20260924.json))

- [Atomm alignment investigation, 2026-09-29](reports/atomm-alignment-20260929/README.md) — reproduced 0.7.0 sidebar offsets and candidate correction.
- [Atomm 0.7.1 validation, 2026-09-29](reports/atomm-071-validation/README.md) — release checks and alignment measurements from the exact patch ZIP.
