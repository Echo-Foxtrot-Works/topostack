# 3D airspace implementation review

Reviewed 9 October 2026 against commit `7e7fd7a` on `dev`.

The airspace pipeline has a sound separation between source loading, geometry, supports, export and studio rendering. This review corrected altitude, source-quality, support and assembly-map defects, added explicit fabrication limits, and reduced repeated geometry work. The code passes the affected test suites and browser workflows. The remaining feature improvements are implemented, a volume-enabled FAA v2 archive is prepared, and real FAA/terrain acceptance passes. The verified v2 archive was activated in development R2 on 2026-10-10 and renders in the deployed studio. Production activation and physical assembly validation remain release steps.

## Corrected findings

| Area | Previous behavior | Result |
| --- | --- | --- |
| Source completeness | A truncated volume list could produce exportable geometry with no source-quality warning. | Optional `airspaceStatus` survives generation, partial data warns, and the shared export policy blocks incomplete airspace. |
| Archive compatibility | An archive containing only aviation linework looked like a successfully loaded empty airspace area. | The loader verifies that archive metadata publishes every requested volume layer. Missing layers become unavailable data; a valid empty crop remains exportable. |
| Geometry fallback | Failed sector union silently fell back to separately clipped tile pieces. | Fallback results are marked partial, preventing unreliable seams or dropped fragments from exporting silently. |
| Class selection and refresh | Disabled controlled classes counted toward the 400-sector limit; changing classes on a partial source did not reload it. | Disabled classes are filtered before decoding and ranking. Enabling a class or changing class selection on a partial source reloads the volumes and clears stale cycle information. |
| Source workload | Polygon rings were not counted against the shared geometry budget, and the union loop did not yield for cancellation. | Ring and point budgets apply before projection; sector processing yields every 16 sectors and checks cancellation before returning. |
| Ground-relative ceilings | A ceiling given above ground could snap upward to a higher sector's level. | Ground-relative ceilings enter the level set directly; merging can lower a ceiling but cannot raise it to another sector's ceiling. |
| Sector ownership | Every disconnected piece of a solid slice inherited every sector at that height. | Each volume piece and Class D lid records only sectors that actually intersect it. |
| Physical intersections | Two tinted pieces at one height, or a Class D lid overlapping a solid slab, could occupy the same physical space and still export. | Bounding-box checks precede polygon intersection checks. Overlaps are partitioned without moving altitudes: Class D lids take priority, then blue material before magenta. Shared pieces retain every represented sector ID. A residual-intersection guard blocks export if clipping leaves a conflict; face contact remains valid. |
| Solid-sheet workload | Small crops, high caps and thin acrylic could trigger thousands of clipping and support operations. | Construction stops before clipping when the slab interval would require more than 256 candidate sheets. The warning and export policy offer plates, tiers, thicker stock or a lower cap. |
| Socket and hole margins | Clearance enlarged cut holes without enlarging the support solver's required material margin. | Socket and through-hole checks include fit clearance, including square-hole corners. |
| Through-rod spacing | Fine-grid and overhang candidates could use rod-diameter spacing even when the shared through-rod spacing was larger. | Candidate selection uses the same spacing as existing-rod collision checks. |
| Support reach | Sparse polygon outlines were sampled only at existing vertices; reaching the 16-rod limit could leave excessive unsupported reach without a warning. | Long edges are interpolated for reach sampling. Both floating plates and glued overhangs warn when placement cannot meet the reach criterion. |
| Assembly maps | Lower-level maps omitted through rods that continued to a higher piece; rod-length IDs could not identify the columns in the height table. | Every carried level shows the rod position. Through-rod labels include the column and cut-list IDs, such as `C1 / R1`. |

The regression tests sit beside the loader, refresh cache, geometry builder, support solver, export and scene helpers. Projects without airspace retain their settings fingerprint and existing export behavior.

## Performance and architecture

The solid builder caches outlines and their sector membership by active sectors and terrain-clearance band. It also caches sector bounds before expensive intersection operations. A synthetic comparison used two overlapping Class B sectors with 720 vertices each and approximately 74 acrylic sheets. Across seven measured runs after warming both implementations, median generation time fell from **259.4 ms to 112.7 ms**, a **2.3× speedup**. Every generated level matched exactly. The comparison used the original slab builder with the current support solver on both sides, isolating the slab changes. These measurements are synthetic and do not establish real FAA/terrain timings. [Measurement samples](data/airspace-review-performance-20261009.json).

The 3D preview caches acrylic body meshes across cloned worker results, annotation changes and tint changes. Rebuilds replace scene materials while preserving unchanged extrusion geometry; removed bodies are disposed through the existing scene cleanup. A regression checks geometry reuse, material replacement and disposal.

The main geometry entry, optional airspace entry and Worker project entry remain separate. The core has no browser or platform dependencies. The shared export policy serves both UI actions and package generation. New source-quality fields and warning codes are additive; no project format migration is required.

## Verification

| Check | Result |
| --- | --- |
| Core tests, including fabrication regressions | 684 passed in 71 files |
| Generator Node tests | 781 passed in 88 files |
| Generator component tests | 192 passed in 20 files |
| Data-contract tests | 179 passed in 9 files |
| Map API and agent tests | 213 passed in 16 files |
| FAA builder normalization tests | 27 passed using Python 3.13 and the pinned Shapely/Fiona dependencies in an isolated temporary environment |
| Airspace browser generation and package export | Passed in Chromium, Firefox and WebKit |
| Browser-agent through-rod workflow | Passed in Chromium; skipped by design in Firefox and WebKit |
| Workspace type checks | Passed; Svelte reported zero errors and warnings |
| Lint and diff whitespace checks | Passed |
| Core, generator production and Worker dry-run builds | Passed |
| Production web bundle budgets | Passed; initial studio JavaScript 153,165 gzip bytes, startup JavaScript 510,687 gzip bytes |

The benchmark also passed an exact geometry comparison. The browser checks use the deterministic E2E data fixture. Unrelated full-site browser tests and physical laser-cut assembly were outside this verification.

## Implemented extensions

The optional `AirspaceStackIR.sectors` catalog preserves source IDs, names, class, special-use kind, original floor and ceiling references, strict ceilings, exclusion flags and whether the model cap trimmed a ceiling. It is included in the export manifest, so consumers can add future annotations without reloading FAA data.

Sector names and original altitude references are engraved once per source sector on the highest piece with room. MSL, AGL, flight levels, surface and unlimited limits remain explicit; a separate model-cap line avoids presenting a trimmed ceiling as FAA data. Placement uses the shared glyph-ink footprint, stroke reach and exact polygon fit tests after support holes are cut. Labels stay clear of rod locators and one another, and clear windows in frost and chart edges keep them readable. Narrow lowest pieces can wrap or rotate the navigation notice and FAA-cycle engraving. Space-limited omissions warn and retain complete details in the manifest and guide.

Tier pieces carry class-styled sector edges and inward special-use hatching. Coincident same-class segments are engraved once. The cut view and 3D preview share the exporter’s piece-marking composition, including frost windows, text and rod locators. The studio’s Cut material selector switches between terrain and airspace, with an acrylic-level slider, altitude readout, tint, cuts and through holes. This selection is preview state and does not alter project fingerprints.

## Real-data acceptance

The new acceptance harness serves the local archive through HTTP range requests with its SHA as a strong ETag, runs the production volume loader through Vite, samples actual Terrarium terrain and calls the production geometry and exporter. It validates source completeness, unique piece IDs, sector ownership, terrain clearance, absence of physical acrylic intersections, label footprints, support references, deterministic reruns and exportability.

Three measured runs follow one warm-up at a 192 × 192 terrain grid. These are generation timings on this machine, excluding archive loading, terrain download and package writing. They are not a before/after performance comparison.

| Actual crop | Sectors loaded | Plates median | Tiers median | Solid volumes median |
| --- | --- | --- | --- | --- |
| Denver Class B | 18 | 100.0 ms | 88.3 ms | 170.1 ms |
| Las Vegas mixed special use | 30 | 969.7 ms | 1074.2 ms | 2390.6 ms |
| Seattle rugged terrain | 42 | 205.4 ms | 176.2 ms | 398.0 ms |

All nine cases passed. Expected warnings remain for merged altitudes, small fragments, omitted labels and acrylic stock usage. The mixed special-use tier case also drops unsupported pieces and warns about support reach; these geometric checks do not establish glue stability or mechanical safety. [Results, warnings and terrain input hashes](data/airspace-acceptance-20261009.json).

## Prepared data release and physical checks

The pinned 2026-10-01 inputs were recovered from local caches and verified against every committed SHA-256. They build the newly registered `faa-aviation-2026-10-01-v2` archive, 38,297,461 bytes, SHA-256 `de3c118977ab56157675ab15a97a7803a23971d4a7ff20113124c480a6c8f793`. It contains all nine required layers, including 1,287 controlled-airspace volumes and 1,439 special-use volumes. Every source feature passed the browser contract parser before tiling, and the completed archive passed local header, metadata, registration, layer and digest verification. [Build receipt](data/airspace-faa-volume-candidate-20261009.json).

The candidate is at `.topostack/faa/faa-aviation-2026-10-01-v2.pmtiles`. A direct R2 recheck at `2026-10-09T22:34:07.793Z` confirmed that this exact v2 archive was already staged in the development bucket at `2026-10-09T22:24:08.182Z`: its full remote SHA-256, byte count and all nine layers match the local build. Development needs no duplicate staging upload. At the time of that recheck, both development and production release pointers, public archive metadata and advertised registrations selected v1, whose seven layers exclude both volume layers. No object matching the v2 digest was found in the production bucket. This recheck made no archive uploads or promotions. [R2 and public API verification](data/airspace-r2-recheck-20261009.json).

On 2026-10-10, the deployed development manifest advertised v2 while its release pointer still selected v1. After a fresh full remote digest and byte-count verification, the existing v2 object was activated by a conditional pointer write, retaining the previous object for rollback. No archive was uploaded. The public development archive immediately exposed both volume layers. A fresh Chromium session imported a Denver project, generated real terrain, and visibly rendered nine tier pieces on six levels held by 34 rods. There were no page errors; an unrelated Cloudflare analytics request failed. Production was not changed. [Activation receipt and browser verification](data/airspace-development-activation-20261010.json).

The data registration change must be deployed with release-pointer promotion, as described in [FAA release instructions](../faa-aviation.md#refreshing-for-a-new-cycle).

Eighteen synthetic test-cut packages are generated at `.topostack/airspace-fabrication-fixtures/`: plates, tiers and widening solid stacks; segmented and through rods; backing sockets; 1, 3 and 10 mm acrylic. Each job includes its cut files, rod list, maps, assembly guide and an explicit synthetic-test marker. Physical cutting, fit measurement, glue curing and load observation still require a maker; the fixtures do not claim physical validation. [Repeatable validation and assembly procedure](../airspace-validation.md).
