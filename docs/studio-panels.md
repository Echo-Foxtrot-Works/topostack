# Studio settings panels

The studio's settings sit in seven panels picked from a rail on the left of the sidebar. Only one panel shows at a time. This note records how they are organized, so a new control lands in the right place.

## One subject, one home

Panels group controls by what they change on the model, not by kind of setting. A feature's switch and its line style sit together, and everything about water lives in one panel, whether it draws an outline, carves depth or adds acrylic.

| Rail | Panel | Holds | Component |
| --- | --- | --- | --- |
| Place | Place and size | Location, suggested places, units, crop shape, width and height | `PlacePanel.svelte` (location in `LocationPicker.svelte`) |
| Terrain | Terrain layers / Contour design | Vertical exaggeration, material, contour density and index, smoothing, contour widths (flat) | `TerrainPanel.svelte` |
| Features | Map features | Line weight presets, then roads, trails, transportation labels, boundaries, grid, engraved border, each with its widths and patterns under its switch | `FeaturesPanel.svelte` |
| Water | Water | Outlines and fill pattern, water depth and per-lake depth, acrylic inserts, paint templates | `WaterPanel.svelte` |
| Aviation | Aviation (US) | FAA layers, aviation line style, airspace in acrylic | `AviationPanel.svelte` |
| Labels | Labels and marks | Font, text size, label line width, elevation labels, north arrow, scale bar, title | `LabelsPanel.svelte` |
| Fabricate | Fabrication | Laser kerf, minimum feature, work area, assembly guides | `MakePanel.svelte` |

Material-saving nests, glue margin and the seam options (puzzle tabs, assembly labels, seam offset) are in the export dialog as **Panels and seams** (`NestsAndSeams.svelte`), beside the sheet layout they feed. They still change the preview.

A new control goes in the panel for the subject it changes. A width for a new kind of line goes under that feature's switch with `LineWidthField.svelte`. If a control fits no panel, that is a sign the panels need rethinking, not a reason for an "Other" panel.

## Mechanics

- The rail is the theme's `Tabs` with `variant="rail"` (`@loidolt/theme-svelte` 0.10), set up in `SettingsRail.svelte`: each tab carries an icon snippet, a short label and the panel summary as its description. The theme keeps every panel mounted and hidden while unselected, so controls keep their state and component tests can reach them without opening a panel.
- `PanelFrame.svelte` renders each panel's title, summary and body inside its tab panel, marked `data-panel`.
- `PanelState` (`panel-state.svelte.ts`) holds the active panel and remembers it in localStorage (`topostack-studio-panels-v1`).
- Where the workspace stacks (the breakpoint in `styles/responsive.css`), `SettingsRail` switches the rail to horizontal, a row of tabs above the panel, so arrow keys follow the layout.
- **Find a setting** (`SettingsSearch.svelte`) is the rail's `panelHeader`, pinned while the panels scroll. It reads labelled controls from the mounted panels each time it searches, so it lists only what the project currently shows. A control behind a switch that is off is found through its switch.
- One-line summaries under each title come from `panelSummary` in `preview-summary.ts`.

## Platform embed

The Atomm embed has no rail. `PanelFrame` renders the same panels as collapsible blocks styled by the platform's section rules, and the location stays in the lead rail as **Project setup**. The embed exports through the platform rather than the export dialog, so `NestsAndSeams` renders inside its Fabrication block instead.
