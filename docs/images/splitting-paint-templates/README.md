# Work area splitting & water paint templates

Direct screenshots of the local TopoStack studio, using freshly generated Crater Lake terrain. Each PNG is 3200 × 2200 pixels (1600 × 1100 viewport at 2× resolution).

Suggested post order and captions:

1. **01-split-relief.png** — Build bigger than your laser bed. This 406.4 × 270.933 mm Crater Lake relief uses a 220 × 160 mm work area.
2. **02-split-cut-layer.png** — Layers split into panels with interlocking puzzle seams and assembly labels. Seams shift between alternating layers.
3. **03-water-paint-template.png** — Preview the matching paper stencil: mask the land and paint the water that will remain visible after assembly.
4. **04-lower-layer-paint-template.png** — Each layer gets its own water windows, including the deeper steps of the lake basin.

The second and third images show the same layer with the paint template switched off and on. The fourth shows layer 12. Fabrication controls, work area dimensions, and source attribution remain visible. The app's coverage notices are retained: survey data is used where available, with existing terrain or modeled depths filling gaps. Terrain and water depths are exaggerated for display.

`media-provenance.json` records the settings, selected comparison layer, capture time, and successful survey responses. Screenshots are unretouched app renders.

To regenerate, start a normal development frontend with the public data API:

```sh
VITE_MAP_API_URL=https://topostack.app npm run dev -w @topostack/generator -- --port 5274
```

Then, from the repository root:

```sh
node scripts/dev/capture-feature-update.mjs
```

Optional environment variables: `TOPOSTACK_APP_URL` sets the frontend origin; `TOPOSTACK_CAPTURE_LAYER` chooses the one-based layer for the off/on comparison. The browser uses an isolated session and does not modify your saved project. The capture script relays genuine public API responses without localhost Origin/Referer headers, matching the existing README asset workflow.
