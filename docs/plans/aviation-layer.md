# Aviation layer

Engrave what a VFR sectional shows (airspace, airports and runways, navaids, special use airspace, obstacles) the way roads engrave today. Data and refresh are in [faa-aviation.md](../faa-aviation.md).

## Decisions

- **Vector features, not the chart image.** Lines stay in scale, styleable and laser-friendly; the raster sectional would need a new raster-engrave path.
- **Our own archive.** An offline build from one pinned FAA cycle, provisioned to R2 and served by range like the OSM and lake archives. Live FAA services are rate-limited (the ArcGIS host answered 429 during the spike) and would break the pinned-dataset rule.
- **One new marking kind.** Roads are a hard-coded kind and class checked by name across the pipeline; aviation follows the same shape (`kind: "aviation"` with an `aviationClass`) rather than adding a generic overlay abstraction first.
- **Separate status and budget.** `aviationStatus` is independent of `vectorStatus`. A crop outside FAA coverage is `not-covered`, a warning rather than an export block, and airspace cannot use up the road budget.
- **OSM aeroways stay excluded** from roads; the FAA layer replaces them with authoritative data.

## Phases

1. **Data, contract, provisioning, route** (done). `@topostack/data-contracts/aviation-tiles`, `build-faa-aviation.py` with its contract check, `provision-aviation-data.mjs`, `/v1/aviation.pmtiles`, the manifest entry, and `aviation` in area coverage.
2. **Lines end to end.** Class B/C/D airspace, special use airspace and runways:
   - an optional `aviation` project setting (absent means off, so old projects keep their fingerprints), kept out of terrain invalidation;
   - a lazily imported browser adapter that stitches lines across tiles;
   - stack routing like transportation, onto the highest exposed material;
   - SVG groups per class (`airspace-b`, `airspace-c`, `airspace-d`, `sua`, `runways`), each with its own dash, so power can be set per group;
   - studio toggles, preview styles, counts, export README and `ATTRIBUTION.txt` with the cycle date and a not-for-navigation notice.
3. **Points.** Millimetre-sized symbols for airports, navaids and obstacles, placed like markers, with identifier labels through the existing label placement. Airspace floor/ceiling labels later, behind the same labels switch.
4. **Agents and polish.** An `aviation` request key for the agent API, MCP and WebMCP; coverage text; the attribution page; a guide.

## Verification

Each phase runs typecheck, lint and the affected tests. Phase 2 adds adapter tests (stitching across tile seams, not-covered, budget, cancellation), core tests for routing and SVG categories, the generator client tests, and the bundle budget (the adapter must stay off the default preview's critical path). A dev check covers a Class B city, a Class D field and a crop outside the US.
