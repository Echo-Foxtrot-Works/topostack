# The Atomm embed

Inside Atomm the studio renders the platform's layout 3 (lead rail, canvas, 320px parameters rail) from [design.md](https://dev.atomm.com/design.md) and the [layout-3 skeleton](https://dev.atomm.com/templates/layout-3-generate.skeleton.html). The embed is detected by running in a frame (`window.parent !== window`); the vendored stylesheet and the embed's own adaptations live in `apps/generator/src/lib/atomm/atomm-workbench.css`.

## How it differs from the standalone studio

These follow from Atomm's September 2026 review of 0.1.2, which asked for fewer controls, spec styling and a flow users cannot get stuck in.

| Area | Standalone studio | Atomm embed | Why |
| --- | --- | --- | --- |
| Terrain | Generate button; a moved map area waits for regeneration | Loads real terrain on open, and reloads it when a place is chosen, the map selection moves, or a project is imported or reset. The lead rail shows a **Load terrain** / **Try again** button only after a failure or cancellation. | Reviewers found users did not know to regenerate after moving the selection. The platform treats a Generate button on a live-preview generator as a defect. |
| View tabs | Map, Cut layers, 3D stack, Custom data | 2D, 3D, **Export**; **Edit map area** in Project setup | The platform expects an Export view. It shows the master SVG that Open in Studio sends, with the download's file list and sizes, built with the same package options and cached guide fonts as the export hook. Blue strokes and blue filled artwork have separate process labels. |
| Custom data | Depth charts, markers, paths, file import and graphics in their own view | Markers, paths and file import in the lead rail; no depth charts or graphics | Tracing a depth chart is too involved for the platform's audience, and Atomm's own Studio already places artwork. A project that already uses a chart shows it and can stop using it. |
| Ranges | Slider plus numeric field | One grey numeric field (drag or type) | The review asked for one control per value. The layer card keeps sliders because they browse a view, and each shows its value as a number and a filled track. Invalid typed numbers remain visible with an inline explanation and do not change the model. |
| Tips | Guides on the website | A step-by-step walkthrough: one slide per step with a picture of it from the studio itself, dots, Back and Next | Matches the platform's Fabrication Tips dialog. The lake-depth help opens it on its own slide. The pictures are captured by `scripts/dev/capture-atomm-tips.mjs` (see `docs/images/README.md`). |

## Canvas overlays

The canvas carries only what the platform allows: view tabs top-centre, Tips top-end, the zoom cluster bottom-start. Map credits share the zoom cluster's row at the bottom-end as light text without a plate. A quick preview refresh shows a small chip in the same row with its real work stage: preparing source data (step 1 of 2), then building preview geometry (step 2 of 2). No spinner or looping animation is used. Loading terrain shows a progress card over the previous preview, with the stage and a Cancel button, so the tabs and Tips stay in reach; in Map view the chip is used instead so the map stays visible. Cancelling an area load keeps the previous terrain and the lead rail offers **Load terrain**. Collapsed, the lead rail becomes a pill that keeps its title. Canvas container queries reserve a second row for the view switch when the canvas is narrow or the collapsed title needs the first row. The Tips body (including its image) scrolls as one region, keeping Back/Next visible on short screens. The embed uses native font selects so platform keyboard and touch pickers remain available.

The 3D camera is fitted on first load and by the explicit Fit action; ordinary geometry edits retain its position and target. A persistent presentation rig adds a small idle sway and drag-release spring in the embed. Idle motion pauses without resetting its pose while a rail control or dialog has focus, giving editing priority. Reduced motion disables this rig motion and orbit damping, and hidden tabs stop rendering. Progress is shown with stage text and counts rather than a looping contour animation.

## Package contents

The Atomm package is the studio alone. With `VITE_SITE_ENV=atomm`, `apps/generator/sveltekit.config.ts` prerenders only `/`, `/studio` and `/attribution` (the credits page the studio links to), the lake and example routes list no entries, and articles render without the site header, guide navigation and footer. `scripts/build/prune-atomm-dist.mjs` then drops the site-only static files listed in `scripts/lib/atomm-site-only.mjs`. What the studio fetches at runtime stays: `data/lake-depth-directory.json` for place search, icons and licence texts. `verify-atomm-dist.mjs --require-sdk-entry` fails if any other page or site-only file is packaged, and CI builds and verifies the package on every run rather than only on `main`.

## Tests

`e2e/atomm.spec.ts` covers the layout, the automatic load (held at the geometry worker to watch or cancel it), the Export view, the walkthrough and the collapsed pill. `App.client.test.ts` covers the embed's terrain flow without a browser.

## Automatic export nesting

Layered designs use a shared, lazy export layout for Export Preview, Download and Open in Studio. Material width and height are editable in the Export view and saved in the project’s sheet nesting settings. Unset dimensions use the work area when set, otherwise 600 × 400 mm stock. The remaining automatic settings use 3 mm margins, 2 mm spacing, quarter-turn rotation and a five-second search (eight-second watchdog). Imported sheet dimensions are honored; advanced spacing, margin, rotation and search settings stay automatic. Changing material size updates only export layout and does not regenerate terrain; the exported manifest records the effective layout settings. Engravings bypass nesting. Changed geometry cancels obsolete work; exports reject designs changed during arrangement. Oversize pieces or unavailable nesting fall back to original panels with an explicit notice. Nothing is scaled to fit.

The stock size is a layout default, not a detected machine bed: Atomm selects the machine after the export hook. Inspect Export Preview before cutting. The standalone nesting planner remains unchanged.

Assembly ids use Atomm blue in embedded SVGs and accompanying guide text so they join the standard engraving group without a manual extra color assignment. Standalone packages retain their separate green assembly group. This follows the [SVG color specification](https://dev.atomm.com/docs/export/svg-color-spec).

Sheet arrangement and terrain generation share the `GenerationProgress` component and platform styling. During arrangement, Export displays actual draft sheet outlines, sheet counts, material utilization and layout updates from the worker. “Use current layout” stops with a complete draft; step 2 then builds the final export package. No estimated completion percentage or looping animation is used.
