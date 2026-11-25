# Studio settings panels

The studio's settings sit in seven panels picked from a rail on the left of the sidebar. Only one panel shows at a time. This note records how they are organized, so a new control lands in the right place.

## One subject, one home

Panels group controls by what they change on the model, not by kind of setting. A feature's switch and its line style sit together, and everything about water lives in one panel, whether it draws an outline, carves depth or adds acrylic.

| Rail | Panel | Holds | Component |
| --- | --- | --- | --- |
| Place | Place and size | Location, suggested places, units, crop shape, width and height | `PlacePanel.svelte` (location in `LocationPicker.svelte`) |
| Terrain | Terrain layers / Contour design | Vertical exaggeration, material, contour density and index, smoothing, contour widths (flat) | `TerrainPanel.svelte` |
| Features | Map features | Line weight presets, then roads, trails, railways, transportation labels, boundaries, grid, engraved border, each with its widths and patterns under its switch; public land boundaries per kind with names and (flat engravings) inside hatching; for layered models, a paint template switch and swatch per kind of public land | `FeaturesPanel.svelte` |
| Water | Water | Outlines and fill pattern, water depth and per-lake depth, acrylic inserts, paint templates | `WaterPanel.svelte` |
| Aviation | Aviation (US) | FAA layers, aviation line style, airspace in acrylic | `AviationPanel.svelte` |
| Labels | Labels and marks | Font, text size, label line width, elevation labels, north arrow, scale bar, title | `LabelsPanel.svelte` |
| Fabricate | Fabrication | Laser kerf, minimum feature, work area, assembly guides | `MakePanel.svelte` |

Material-saving nests, glue margin and the seam options (puzzle tabs, assembly labels, seam offset) are the first step of the export dialog, **Panels** (`NestsAndSeams.svelte`), ahead of the sheet layout they feed. The dialog (`ExportDialog.svelte`) is a step-by-step flow: **Panels**, **Sheets** (nesting), **Download**, **Share**; a flat engraving has only the last two. Every step is reachable from the step list, and each open starts at the first. They still change the preview.

A new control goes in the panel for the subject it changes. A width for a new kind of line goes under that feature's switch with `LineWidthField.svelte`. If a control fits no panel, that is a sign the panels need rethinking, not a reason for an "Other" panel.

## Mechanics

- The rail is the theme's `Tabs` with `variant="rail"` (`@loidolt/theme-svelte` 0.10), set up in `SettingsRail.svelte`: each tab carries an icon snippet, a short label and the panel summary as its description. The theme keeps every panel mounted and hidden while unselected, so controls keep their state and component tests can reach them without opening a panel.
- `PanelFrame.svelte` renders each panel's title, summary and body inside its tab panel, marked `data-panel`.
- `PanelState` (`panel-state.svelte.ts`) holds the active panel and remembers it in localStorage (`topostack-studio-panels-v1`).
- Where the workspace stacks (the breakpoint in `styles/responsive.css`), `SettingsRail` switches the rail to horizontal, a row of tabs above the panel, so arrow keys follow the layout.
- On a portrait phone at least 600px tall (`phoneLayout` in `rail-orientation.svelte.ts`, the same query in `styles/responsive.css`), the studio fills the screen and the panels become a bottom sheet. The tabs sit at the foot with **Generate terrain** above them. Tapping a tab opens its panel at half height, and the handle steps it to nearly full. The open tab, the close button or Escape (from inside the panel) closes it, and starting a placement does too. `PanelState.sheet` holds `closed`, `half` or `full`, isn't remembered, and `SettingsRail` mirrors it on the rail as `data-sheet`. The active tab gets `aria-expanded`. The sheet isn't modal, and the preview above it keeps at least 180px of model. Shorter screens and phones on their side keep the scrolling stacked layout. E2E tests open a panel with `showPanel` (`e2e/studio-panels.ts`).
- **Find a setting** (`SettingsSearch.svelte`) is the rail's `panelHeader`, pinned while the panels scroll. It reads labelled controls from the mounted panels each time it searches, so it lists only what the project currently shows. A control behind a switch that is off is found through its switch.
- One-line summaries under each title come from `panelSummary` in `preview-summary.ts`.
- The custom data view's sidebar (`CustomDataNav.svelte`) is the same kind of rail, one tab per kind of data. Both rails take their orientation from `railOrientation` (`rail-orientation.svelte.ts`).

## Setup guide

A first visit gets the setup guide (`StartGuide.svelte`) in place of the rail: four steps, **Type**, **Place**, **Look** and **Material**, each built from the same controls as the panel it introduces (`SizeFields`, `LinePresets` and `MachineFields` are shared with the Place, Features and Fabricate panels). The generation dock stays below it.

- "First visit" means startup found nothing to restore and no link that names a design (`guideStepAtStartup` in `start-guide.ts`). A maker with a saved project never sees it unasked; **Setup guide** in the studio menu opens it for anyone.
- Progress is one localStorage value, `topostack-studio-guide-v1`: the open step, or `done` once finished or skipped. A reload resumes the step.
- Each step opens the view that shows its effect: the map for **Place**, the model for the rest. Leaving **Place** forward starts Generate when the area has no real terrain yet, so **Look** is chosen on the place itself.
- The guide is standalone only, loaded on demand, and its own copy is English like the rest of that shell. The Atomm embed never offers it.
- Tests start past the guide: `playwright.config.ts` seeds the `done` value for every spec and `App.client.test.ts` sets it before mounting. `e2e/start-guide.spec.ts` clears it.

Changing the place (search, a suggested place, coordinates) also opens the map view in the standalone studio, since the model still shows the previous terrain until the next Generate.

## Platform embed

The Atomm embed has no rail. `PanelFrame` renders the same panels as collapsible blocks styled by the platform's section rules, and the location stays in the lead rail as **Project setup**. The embed exports through the platform rather than the export dialog, so `NestsAndSeams` renders inside its Fabrication block instead.
