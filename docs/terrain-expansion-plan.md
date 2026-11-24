# Terrain system review and source expansion plan

Reviewed 2026-09-16 against the current working tree, including existing uncommitted terrain work. This is a design and operations plan; it does not activate new sources. Scope: land terrain only. Lake bathymetry remains separate.

## Recommendation

Keep operator-controlled acquisition and publication, numeric elevation PMTiles, explicit quality ranking, and the worldwide Mapzen fallback. First make the Canadian path reproducible at release scale; then add USGS 3DEP as the first independent provider. Avoid copying the present regional zoom-15 build strategy across whole countries.

## Current system

| Stage | Implementation | What works today |
| --- | --- | --- |
| Discovery | `scripts/data-build/discover-terrain.py` | Manual NRCan STAC search for HRDEM 1 m / 2 m DTM mosaics and MRDEM-30 DTM; upstream URL, ETag and byte-size pins |
| Preparation | `scripts/data-build/build-hrdem-terrain.py`, `scripts/data-build/tile_writer.py` | Bounded remote COG reads; Web Mercator reprojection; numeric RGBA PNGs with transparent NoData; PMTiles verification and SHA-256 receipts |
| Catalog | `scripts/data/terrain-sources.json`, `packages/data-contracts/src/source-catalog.ts` | Three Ontario HRDEM registrations; priority, native resolution, acquisition year and stable-ID ranking; CGVD2013-only validation |
| Publication | `scripts/provision/provision-lake-data.mjs`, `scripts/lib/archive-provisioning.mjs` | Immutable staged objects, full remote hash verification, conditional per-archive promotion, previous-release receipts; development default |
| Serving | `workers/map-api/src/routes/archive.ts`, `workers/map-api/src/archive-head.ts` | Registered archive routes, bounded range reads and release resolution |
| Selection | `apps/generator/src/lib/domain/terrain-sources.ts`, `apps/generator/src/lib/domain/data-provider.ts` | Valid samples win by rank; gaps fall through; malformed archives are discarded atomically; contribution metadata reaches exports |

The catalog is compiled into both browser and gateway. A manifest entry describes a registration, not proof of deployment. Existing documentation records the three Ontario archives as published in development; this review did not re-download and verify their live archive bytes. Both live gateways advertised archive-release support during the review.

## Findings to address

1. **Registration is not a transaction.** `discover-terrain.py:register` stages two files, then replaces them sequentially. Interruption between replacements can leave an inconsistent pair despite its docstring. It also permits replacing an existing pin when source metadata is unchanged. Replace this with an immutable release manifest containing source metadata and pins, plus one atomic reference update; reject changes to existing identities. Test interruption, conflicting pins, and reruns.
2. **Extent verification is incomplete.** Publication checks dataset ID, encoding, zoom and datum, but does not compare archive bounds against registered bounds or a checked valid-data footprint. The browser also accepts valid pixels based on archive metadata without checking header extent. Add header/receipt/registration consistency checks and measured coverage. Bounds remain a candidate filter, not proof that every pixel is valid.
3. **The builder is regional.** It materializes the complete cropped raster, caps it at 100 million samples, and tiles serially through the source's maximum zoom (currently 15). There is no durable chunk scheduler or resume protocol. Snapshot, MBTiles and PMTiles coexist on disk. Sequential chunks alone do not solve national packaging, seam consistency, or catalog size.
4. **Storage zoom and usage zoom are coupled.** *Resolved:* tiles past an archive's maxZoom are now upsampled bilinearly from its ancestors (`upsampledFromAncestors` in `apps/generator/src/lib/domain/terrain-sources.ts`), so a 30 m baseline packaged at zoom 12 or 13 keeps contributing on closer views. Previously the selector skipped such a source.
5. **Vertical semantics are Canada-specific.** Catalog types admit only CGVD2013. Horizontal reprojection does not convert heights. Provider adapters must validate units, datum and terrain semantics before normalization; replacing the literal with an unrestricted string is insufficient.
6. **Preferred terrain still depends on Mapzen.** `loadElevation` fetches the entire base tile set before applying overlays. A base failure prevents use of otherwise available preferred coverage. Preserve this behavior initially, document it, and schedule preferred-first loading with base requests only for remaining gaps before claiming independent national availability.
7. **A regional catalog will not scale unchanged.** The browser imports every source, sorts candidates and processes archives sequentially. Selection filters against the request extent, then can request tiles outside an individual shard. Group physical shards under logical releases and add a spatial shard index, per-tile intersection filtering, bounded archive fan-out and request benchmarks.

## Target acquisition and release contract

Separate three artifacts:

- **Provider inventory:** assessed products, official references, access adapters and licensing evidence. Entries do not grant runtime eligibility.
- **Build release:** immutable provider/product/release identity; DTM semantics; native resolution; acquisition dates or explicitly unknown; licence and attribution; pinned input objects; horizontal CRS; source and output vertical units/datums; transformation pipeline and grid-file hashes; tool versions; chunk geometry and resampling policy; valid-data coverage; archive hashes and QA evidence.
- **Active catalog:** only verified, published releases and their spatial shard indexes, with explicit priority and environment. Runtime reads these artifacts and never invokes discovery, downloads original rasters, or queues builds.

Recommended initial vertical policy: retain the provider's documented native orthometric datum with explicit metre conversion, allowed datum identifiers and a versioned mixing policy. Preserve CGVD2013 for Canada. Cross-datum boundaries must be recorded and tested; no claim of harmonized heights. Where seamless cross-datum output is required, approve a concrete target reference, transformation grids and numeric fixtures before activation. Do not convert foreign terrain to a Canadian datum merely to pass today's validator.

## Delivery sequence

### 1. Harden the regional release contract

Add a provider-neutral candidate/receipt schema, extent validation, immutable pin validation and transactional registration. Keep compatibility with existing NRCan IDs and archive encoding. Record release status separately from the catalog's optional-source flag.

Acceptance: existing archives still load; changed inputs cannot reuse identities; simulated interruption leaves the last complete registry usable; malformed extents and missing receipts cannot publish.

### 2. Benchmark Canada and choose packaging

Use MRDEM-30 DTM for the national baseline and retain HRDEM overlays where already verified. The current official STAC item is `mrdem`, with publication timestamp 2026-06-22; that timestamp is not an acquisition date. A HEAD check on 2026-09-16 reported 83,854,027,098 bytes and ETag `"1bf055857edce86b1311967c8d88395e-9997"` for the DTM COG. Recheck before building. [Official STAC item](https://datacube.services.geo.ca/stac/api/collections/mrdem-30/items/mrdem).

Benchmark representative southern low-relief, mountain, coastal/NoData and northern chunks. Compare storage zooms 12 and 13 against 15, including sample error, generated contours and coverage edges. Web Mercator ground spacing varies with latitude; choose from measured quality, not a universal zoom-to-metres assumption.

For scale only, the rectangle [-141, 41, -52, 84] gives these approximate totals:

| Finest storage zoom | Tiles including lower zooms | Float32 full-envelope raster |
| --- | ---: | ---: |
| 12 | 1.90 million | 0.374 TB |
| 13 | 7.61 million | 1.497 TB |
| 15 | 121.83 million | 23.954 TB |

These are envelope calculations, including water and areas outside Canada, without NoData pruning, deduplication or compression. They are not archive-size forecasts. Calculate longitude span / 360 times 2^z, Mercator latitude span times 2^z, multiply by 256² samples and four bytes; the full tile pyramid is approximately 4/3 of finest-level tile count. The envelope is illustrative, not an approved national coverage mask.

Provisional benchmark host: 16 vCPU, 64 GiB RAM, 1 TB scratch disk, initially two bounded chunk workers. This is a starting configuration to measure, not a commitment or a guarantee of full-build capacity. The reviewed laptop had approximately 20 GiB free. Stream verified chunks to object storage and retain reproducibility receipts before reclaiming scratch outputs.

Measure peak scratch, peak RSS, source bytes read, tiles/second, PNG bytes/tile, archive overhead, verification time and retry rate. Derive the full-build compute hours and storage budget from the actual coverage mask and those measurements. Include source retention, staging, development/production copies and at least one rollback release.

R2 Standard currently lists $0.015/GB-month, $4.50/million Class A operations and $0.36/million Class B operations, with no egress charge. Thus 1 TB retained is approximately $15/month before allowances, rounding, requests and other services; this is a unit-cost example, not a Canada estimate. Build-host compute, source-provider transfer and host network charges need separate estimates. [Cloudflare pricing](https://developers.cloudflare.com/r2/pricing/).

Acceptance: measured quality comparison, reproducible estimates, chosen zoom/shard size, explicit compute/storage budget and a coverage manifest before the national run.

### 3. Build a resumable offline pipeline

Use globally aligned output grids, deterministic chunk identities and resampling halos trimmed to each chunk's ownership extent. Pin source objects and the toolchain for the release. Record per-chunk states: planned, built, verified, staged. Resume only when input and output hashes match. Bound concurrency, disk usage and retries; preserve failed-chunk evidence.

Separate logical product attribution from physical shards. Implement lower-zoom archive sampling, spatial selection and release-level activation before national publication. Keep legacy routes operational. Stage every required shard, verify full remote hashes, then atomically activate one release manifest; per-archive promotion alone must not expose a partially published country release.

Acceptance: restart mid-build without recomputing completed chunks; adjacent chunks match a reference unchunked build within the declared tolerance; no NoData edge smear; output remains within disk/memory budgets; incomplete releases cannot activate; rollback restores the previous manifest.

### 4. Add the first independent adapter: USGS 3DEP

Start with one representative 1/3 arc-second DTM region, then one overlapping 1 m project to exercise baseline/overlay ordering. Resolve official product footprints and metadata, pin assets, and translate into the common candidate contract. Do not infer acquisition year from publication date. Validate per-product units and vertical reference, including separate treatment of Alaska and territories.

Acceptance: pinned real source fixtures, datum/unit validation, seam/overlap tests, attribution in SVG exports, development staging with hash verification, and rollback rehearsal. A nationwide US release follows its own measured budget.

### 5. Add further providers using the same contract

| Order | Product | Provider-specific work |
| --- | --- | --- |
| Canada first | MRDEM-30 DTM baseline, selected HRDEM | Scale and packaging; existing CGVD2013 path |
| US next | 3DEP approximately 10 m baseline, 1 m enhancements | Product footprints and per-product vertical reference; S1M coverage is still being expanded |
| England | EA 1 m lidar composite DTM | Tiled downloads, survey-index provenance, Newlyn height reference and licence evidence |
| New Zealand | LINZ national/regional bare-earth elevation | Dataset-specific release and coverage metadata; validate NZVD2016 or the documented source datum |
| Switzerland / Liechtenstein | swissALTI3D 2 m initially | LV95/LN02 metadata, release tiles and attribution; evaluate 0.5 m only when useful |
| Australia later | Evaluate national baseline and regional lidar | Separate incomplete 5 m lidar coverage from national coverage; retain Mapzen in gaps |

Official product references: [NRCan MRDEM](https://natural-resources.canada.ca/science-data/science-research/geomatics/ending-canadian-digital-elevation-model-era-new-medium-resolution-digital-elevation-model), [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services), [EA DTM](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m), [LINZ elevation access](https://www.linz.govt.nz/products-services/data/types-linz-data/elevation-data/access-elevation-data), [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d), [GA 5 m lidar service](https://services.ga.gov.au/gis/rest/services/DEM_LiDAR_5m_2025/MapServer). Product availability is not release approval. Recheck licence, redistribution conditions, actual coverage and datum for each selected release.

## Review validation

Passed during this review:

- 9 Python discovery/build tests (`test*terrain.py`).
- 17 browser terrain selection/loading tests.
- 40 data-contracts source-catalog/numeric PNG tests.
- 9 data-operation tests covering staged publication, full-byte verification, conditional promotion and rollback receipts.

These checks establish the existing regional behavior, not national scalability or readiness of another provider. The findings above include paths not covered by those tests. The workspace was changing during review, so this document describes inspected behavior rather than a committed release certification.

First implementation deliverable: harden the release contract and produce the Canadian benchmark report. National acquisition and additional-provider publication follow the resulting packaging and budget decisions.


## Implementation update — 2026-09-16

The first increment is implemented: atomic registry snapshots with immutable
manifests, immutable pin/receipt enforcement, measured build receipts, publication
extent checks, browser extent checks and credential-free local archive verification.
The original three registrations were migrated without changing coverage or IDs.

The [initial Canadian benchmark](reports/terrain-benchmark-20260916.md) records twelve
verified archives and recommends zoom 13 for further evaluation. Crop-edge losses
and the runtime's missing parent-tile sampling prevent national activation. The
larger-host benchmark, national coverage manifest and final budget gate remain open.
