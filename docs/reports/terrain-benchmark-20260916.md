# Canadian terrain packaging benchmark — 2026-09-16

Initial bounded experiment for the [terrain expansion plan](../terrain-expansion-plan.md). Twelve real MRDEM-30 DTM archives were built and verified locally. No benchmark source was registered in the application or published.

## Decision

Carry zoom 13 forward as the baseline packaging candidate. Do not activate national coverage yet: the existing runtime does not sample parent tiles above an archive’s maximum zoom, and the experiment exposed crop-edge losses. Keep zoom 15 as the comparison reference while implementing aligned padded chunks and numeric parent-tile sampling.

Zoom 12 loses noticeably more detail in these samples. Zoom 13 is promising, but its largest interior difference in the Rockies is 3.18 m; a small average error does not establish suitability for every contour interval.

## Reproduce

```sh
.terrain-venv/bin/python scripts/data-build/benchmark-terrain.py --out-dir /tmp/topostack-mrdem-benchmark-new
```

The output directory must be new. The script records the official STAC response, upstream ETag and byte size, candidate parameters, snapshot/sample hashes, verified archive hashes, tool versions, timings and comparison metrics. Each build runs in a fresh process. The source pin is checked before and after every remote crop.

[Machine-readable results](data/terrain-benchmark-20260916.json) retain all measurements and build receipts. Local raster/archive artifacts for this run are in `/tmp/topostack-mrdem-benchmark-20260916`; they are temporary, not long-term source preservation. This run used macOS arm64, Python 3.14.2, GDAL 3.12.4.

## Results

Each region is a 0.06° × 0.06° rectangle; exact bounds are in the results. Error is measured by decoding the actual PNG archive tiles and numerically resampling onto the zoom-15 snapshot grid. The reference is resampled MRDEM, not independent surveyed truth. Archive size is decimal MB.

| Region | Zoom | Archive MB | Tiles | Read + build seconds | P95 error, m | Max interior error, m | 10 m contour-band disagreement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ontario | 12 | 0.127 | 10 | 2.32 | 0.924 | 4.391 | 2.98% |
| ontario | 13 | 0.432 | 16 | 2.09 | 0.299 | 2.125 | 0.82% |
| ontario | 15 | 4.920 | 90 | 5.88 | 0.037 | 0.424 | 0.07% |
| rockies | 12 | 0.157 | 14 | 1.76 | 1.283 | 8.444 | 3.94% |
| rockies | 13 | 0.517 | 20 | 2.09 | 0.288 | 3.184 | 0.76% |
| rockies | 15 | 5.655 | 103 | 6.34 | 0.024 | 0.486 | 0.05% |
| coast | 12 | 0.088 | 11 | 1.92 | 0.217 | 4.142 | 0.74% |
| coast | 13 | 0.277 | 17 | 2.22 | 0.046 | 1.616 | 0.54% |
| coast | 15 | 2.350 | 86 | 5.56 | 0.004 | 0.342 | 0.63% |
| north | 12 | 0.148 | 10 | 1.93 | 0.195 | 0.971 | 0.61% |
| north | 13 | 0.491 | 18 | 2.28 | 0.057 | 0.418 | 0.15% |
| north | 15 | 4.293 | 117 | 6.72 | 0.004 | 0.100 | 0.02% |

Zoom-13 archives were 8.8–11.8% of their zoom-15 counterparts. Python worker peak RSS was approximately 101–202 MB across the experiment. Interior errors exclude a 32-pixel margin on the zoom-15 reference grid. The contour statistic counts disagreement in elevation bands, not contour displacement or fabrication quality; geometric contour and visual review remain required.

## Edge behavior and measurement limits

- Lower-zoom decoded archives lost some reference-valid samples at crop boundaries: 1,399–4,060 at zoom 13 in the northern and Ontario samples. All zoom-15 comparisons retained the reference coverage. These are crop/encoding/resampling boundary effects, not proof of source gaps. Chunk halos and seam tests are required.
- All four source snapshots contained valid heights throughout their crop, including the coastal sample. This does **not** exercise a real provider NoData boundary. Synthetic NoData tests pass, but a pinned real boundary fixture is still needed.
- No extra samples filled reference NoData in this run; because the reference crops were fully valid, that is not evidence of NoData safety.
- Timings include remote crop reads plus local packaging and verification, not cloud-host provisioning or upload. The reported RSS excludes PMTiles subprocesses; retained file sizes are not sampled peak scratch. Source transfer bytes and GDAL retry counts are explicitly unmeasured.
- Small clipped archives have many partially filled tiles and fixed overhead. Their compression ratios and throughput cannot safely be multiplied by a national bounding-box tile count.

## National build budget and next gate

The previous envelope calculation falls from about 121.8 million pyramid tiles at zoom 15 to 7.6 million at zoom 13, before masking and compression. That is a packaging opportunity, not a measured national archive size. A final dollar or runtime budget would currently be speculative.

Before a national run:

1. Implement parent-tile sampling and deterministic padded chunks, then compare adjoining chunks with an unchunked reference at the same zoom.
2. Add a real NoData edge fixture and compare actual contour geometry at the intended fabrication scale.
3. Run larger representative chunks on the proposed build host, measuring full-tile compression, transfer bytes, retries, peak disk and whole-process-tree memory.
4. Produce an approved national footprint/chunk manifest; distinguish invalid cells from zero-elevation water. Estimate storage from those chunks, including development/production copies and rollback retention.
5. Set a compute-hour ceiling, scratch high-water mark and monthly storage budget from those measurements before starting bulk acquisition.

The completed work establishes a reproducible benchmark and a narrower packaging choice. National data acquisition, runtime overzoom, chunk scheduling and new provider adapters remain subsequent work.
