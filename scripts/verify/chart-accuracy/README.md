# Independent chart tracing accuracy probe

Run from repository root. This is an opt-in, network-backed diagnostic, not a CI pass/fail certificate. See [the measured report](../../../docs/reports/chart-tracing-accuracy-2026-09-23.md).

Requirements: installed npm workspace dependencies, Node 26 (native TypeScript), `curl`, Poppler `pdftoppm`, and Python with `numpy`, `pyproj`, `Pillow`, and `matplotlib`. The checked run used `.terrain-venv/bin/python`. Substitute your Python executable below. Downloads include approximately 311 MB of QA ZIPs; unpacking needs additional disk space. All downloaded inputs and generated trace records stay in ignored `.topostack/chart-accuracy/`.

```sh
.terrain-venv/bin/python -m unittest discover -s scripts/verify/chart-accuracy -p 'test_*.py' -v
.terrain-venv/bin/python scripts/verify/chart-accuracy/prepare.py
.terrain-venv/bin/python scripts/verify/chart-accuracy/extract.py
.terrain-venv/bin/python scripts/verify/chart-accuracy/variants.py
node scripts/verify/chart-accuracy/trace.mjs
.terrain-venv/bin/python scripts/verify/chart-accuracy/evaluate.py
.terrain-venv/bin/python scripts/verify/chart-accuracy/figures.py
```

`evaluate.py` and `figures.py` use the four frozen pre-review browser grids in `fixtures/*-record.json` for historical comparison; they do not require the old browser workflow to remain enabled. Only the fields needed for scoring and display are retained. The current browser probe verifies mandatory-review blocking and writes separate `review-required/` receipts; `CHART_STRESS_LEGACY=1` is only for testing an older checkout. The 20 engine variants remain diagnostic, unreviewed proposals and are never automatically approved for production use.

The engine variants are offline after download and require no running server. Figures are written into `docs/images/real-depth-charts/`; inspect them before promoting them into guides. Result JSON is written to the ignored cache; dated documentation snapshots are not automatically overwritten.

`sources.json` pins PDF/QA ZIP hashes, crop bounds, source-derived contour marks, units, and reference provenance. The hashes are checked by `prepare.py`. Marks were selected from printed labels and matching contour vertices, away from text. Some printed labels map to the same vertex; duplicate placements are retained to reproduce the original trial. Perturbations transform the marks with the chart, so this is a favorable test of the tracing engine, not a test of human clicking precision. The two new sources were inspected visually before adding them.

`fixtures/` freezes live lake outlines used in the trials (HydroLAKES/map lookup, including an OpenStreetMap-derived Willow outline), avoiding drift in map services. They are inputs, not surveyed shore truth. Attribution follows the application's source attribution; source USGS chart and sounding links are in the manifest. A sounding's coordinate was used to locate Hamilton and Willow in the map service; no sounding elevation was used to construct any trace.

`extract.py` retains only publisher-designated `QA == 1` soundings from the raw QA DBF and transforms horizontal coordinates using the supplied PRJ. `evaluate.py` compares bed elevations, with equal total weight per occupied 20 m UTM cell; it preserves missing predictions in the coverage denominator. The normalized layer diagnostic uses 11 depth cuts to approximate the application's illustrative 12-sheet preview. It does not calculate final toolpath overlap, minimum bridges, kerf, or physical cutability.

The evaluation intentionally fails loudly on missing source records. It emits measurements rather than assigning an arbitrary acceptance threshold. To reproduce the dated result, use the same tracing implementation as the dated snapshot; future fixes should change the numbers. Unit tests cover bilinear sampling, boundary handling, missing neighbors, missing coverage, and repeated sounding density.

To capture the actual representative preview components, start the Vite app as described by the browser probe, then run `node scripts/verify/chart-accuracy/capture.mjs`. `TOPOSTACK_APP_URL` defaults to `http://127.0.0.1:5278`. This mounts production preview components in an explicitly labeled diagnostic comparison, loads their normal styles, and records layer counts and renderer availability. It is not an end-to-end import test or physical fabrication approval.
