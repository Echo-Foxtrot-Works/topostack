# Walden Pond announcement example

A manually reviewed, simplified version of the public-domain USGS Walden Pond chart. The frozen fixture describes corrections and limitations. It is an example of the review workflow, not a benchmark of automatic tracing or survey accuracy.

Source: [USGS WRIR 01-4137 cover](https://pubs.usgs.gov/wri/wri014137/pdf/cover.pdf). The source PDF hash is pinned in `source.json`. Chart credit: U.S. Geological Survey. Map outline: HydroLAKES 1050970; terrain screenshots retain their map attribution.

## Reproduce

Run from the repository root with Node 26, installed workspace dependencies, Playwright Chromium, and Poppler. Use a local development server with real map access. The default URL is `http://localhost:5274/studio`; override with `TOPOSTACK_APP_URL`.

```sh
node scripts/verify/walden-example/prepare.mjs
node scripts/verify/walden-example/verify.mjs
node scripts/verify/walden-example/capture.mjs
node scripts/verify/walden-example/generate.mjs
```

The capture imports a project seed and explicitly prepared contour draft into isolated browser storage. It checks the alignment and layer approval gates, saves the chart, and exports `.topostack/walden-example/walden-project.json`. The terrain script imports that export into fresh storage and generates real terrain. After successful generation it also refreshes the shareable `docs/images/walden-example/walden-project.json`. Neither script changes the user's existing browser project.

## Validation and limits

- 18 active depth contours, 2,416 stored contour vertices, 30 m deepest modeled depth.
- 164 × 96 grid at 5 m spacing; 8,341 water cells.
- Geometry validation passes. Generated values use the reviewed assignments without additional automatic inference. Unlabelled source intervals were counted manually during fixture preparation.
- Approximate source-to-map shoreline overlap: 89.4%. Control coordinates come from fitting the source shoreline to the cached map outline, not independent surveyed positions. Zero control-fit residual does not establish geographic accuracy.
- Several small shoal loops remain omitted, documented in `source.json`. The deepest contour holds its value; no unprinted bottom elevation is invented.
- Fresh-session terrain generation reached Ready to export with 14 layers and 14 cut panels and no browser exceptions. Incomplete chart coverage and chart-derived depth warnings remain visible.
- Screenshots show software previews, not a physical fabrication or independently verified bathymetric model.

Hamilton Reservoir was also considered. Its source contours passed geometry checks, but alignment to the available map outline failed the existing 80% overlap gate. That gate was not bypassed or weakened.
