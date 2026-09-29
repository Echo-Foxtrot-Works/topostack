# Aviation layer

Engrave what a VFR sectional shows (airspace, airports and runways, navaids, special use airspace, obstacles) the way roads engrave today. Data and refresh are in [faa-aviation.md](../faa-aviation.md).

## Decisions

- **Vector features, not the chart image.** Lines stay in scale, styleable and laser-friendly; the raster sectional would need a new raster-engrave path.
- **Our own archive.** An offline build from one pinned FAA cycle, provisioned to R2 and served by range like the OSM and lake archives. Live FAA services are rate-limited (the ArcGIS host answered 429 during the spike) and would break the pinned-dataset rule.
- **One new marking kind.** Roads are a hard-coded kind and class checked by name across the pipeline; aviation follows the same shape (`kind: "aviation"` with an `aviationClass`) rather than adding a generic overlay abstraction first.
- **Separate status and budget.** `aviationStatus` is independent of `vectorStatus`. A crop outside FAA coverage is `not-covered`, a warning rather than an export block, and airspace cannot use up the road budget.
- **OSM aeroways stay excluded** from roads; the FAA layer replaces them with authoritative data.

## Phases

All four phases are built; the archive is not yet provisioned (see the refresh runbook in [faa-aviation.md](../faa-aviation.md)).

1. **Data, contract, provisioning, route.** `@topostack/data-contracts/aviation-tiles`, `build-faa-aviation.py` with its contract check, `provision-aviation-data.mjs`, `/v1/aviation.pmtiles`, the manifest entry, and `aviation` in area coverage.
2. **Lines end to end.** An optional `aviation` project setting (absent means off, so old projects keep their fingerprints) that never invalidates terrain. The browser adapter (`domain/aviation-provider.ts`) is imported lazily and stitches lines across tile seams. Features ride in `SourceBundleV1.aviationMarkings`, apart from roads, so neither reload replaces the other. Stack routing follows every exposed layer like boundaries. Each class has its own SVG group and dash (`aviationStroke` in core, shared with every preview). Exports carry the cycle and a not-for-navigation notice, and the FAA credit (`aviationAttribution`) is added only while the project draws aviation.
3. **Points.** Millimetre-sized symbols (`annotate/aviation-symbols.ts`) for airports, navaids and obstacles. Identifiers for public, military and towered airports and navaids are placed beside their symbols without overlapping; private fields get a symbol only. Runways are centerlines with a width, outlined when at least three strokes wide at the model's scale.
4. **Agents.** An `aviation` object in project requests (REST, MCP and WebMCP read it through `@topostack/core/project`), coverage and plan notes, FAA credit in agent attribution, the attribution page and the MCP guide.

## Known limits

- Class B shelves share edges, so where two shelves meet the boundary is engraved twice. Merging coincident edges across rings is the next improvement.
- Coverage is a set of boxes; near the border a box includes foreign ground where the archive has no features.
- Airspace floor and ceiling labels are not drawn yet.

## Verification

- Contract, builder and Worker tests cover property parsing, archive identity, coverage boxes, the route and the manifest.
- Adapter tests cover joining lines across tile seams, runways across a seam, points repeated in tile buffers, not-covered areas, the point budget and a mismatched archive.
- Core tests cover styling, runway outlines, symbols, flat and stacked routing, SVG groups, export blocking, README and manifest fields, and fingerprints of older projects.
- The e2e spec (`e2e/aviation.spec.ts`) turns aviation on, generates and checks the exported package.
- A real-data render of Denver from the built archive showed the Class B shelves, Class D rings, runways and navaids in place. Once the archive is provisioned, check a Class B city, a Class D field and a crop outside the US in the development studio.
