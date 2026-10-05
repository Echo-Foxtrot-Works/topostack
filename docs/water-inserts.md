# Acrylic water inserts

A layered model can replace each lake's water with a fitted piece of acrylic. The lake's vector shoreline is cut out of the wood sheet that carries its waterline, and an acrylic insert of the same shape fills the opening, flush with the waterline, resting on the sheet below. Only that one sheet becomes acrylic: the deeper bed steps stay wood and show through it.

The setting is `ProjectConfigV1.waterInserts` (thickness, kerf, fit clearance, excluded lakes). Acrylic stock sheets for nesting are `waterInsertSheetNesting`, an export-only setting like `sheetNesting`. Both are absent in every project that never used them, so older fingerprints are unchanged; the fingerprint covers `waterInserts` (with the exclusion list sorted) and ignores the sheet layout.

## Geometry

`cutWaterInserts` in `packages/core/src/pipeline/water-inserts.ts` runs right after `waterOutputs`, before the work-area split, material nests and alignment guides, so all of them treat each opening as an ordinary terrain hole.

- **Which lakes.** Every `WaterSurfaceIR` of kind `lake` that is not excluded. Surfaces exist only with Water depth on, which is why the switch needs it. A lake is keyed by `waterInsertLakeKey`: its HydroLAKES id, else its surface id, so one opt-out covers every piece of a lake the crop splits.
- **The surface sheet** is `surface.layerIndex` (L), the sheet whose top face holds the waterline. A lake on the bottom sheet stays wood with a warning: nothing would hold the insert.
- **The footprint** is the vector lake, plus the part of L's own basin hole within one grid cell of it (the carved floor is contoured from cell samples, so that hole overshoots the vector shoreline; without this, a crescent of open water would sit beside the acrylic). It is kept inside L's outline and clear of L+1, so the acrylic covers only the visible face and nothing rests on it. A vector island stays wood, and so does an island hill the DEM has but the vector lake lacks.
- **Narrow arms and slivers.** The footprint is opened by `WATER_INSERT_MIN_WIDTH_MM` (3 mm, or twice the minimum feature). Thinner arms, and pieces under 50 mm², stay wood with their depth steps.
- **The ledge.** L-1 gains a `WATER_INSERT_LEDGE_MM` (2 mm) rim just inside every opening, so an insert always has something to rest and be glued on, even over a steep basin. Through the acrylic it reads as a shallow shelf.
- **Pieces.** Each connected part of a footprint is one insert, `W1`, `W2`... numbered by sheet, then by area. They are recorded on `GeometryIRV1.waterInserts`, with the resolved acrylic in `waterInsertMaterial`.
- **Warnings.** `WATER_INSERT_SKIPPED` (bottom sheet, too small, or a shoreline the clipper refused), `WATER_INSERT_PROUD` (acrylic thicker than the wood), `WATER_INSERT_OVERSIZE` (a piece larger than the machine work area; acrylic is never seam-split, since a seam would show in the water).

## Map detail on the acrylic

Routing uses a second set of layer clips (`withInsertSurfaces`) in which sheet L carries the acrylic as material. Roads, boundaries, grids, labels, annotations and markers that cross the water therefore land on sheet L over the lake and are excluded from the bed underneath. `takeInsertMarkings` then moves that share onto each insert (`markingsWithin` in `pipeline/marking-clip.ts`, the same clipping a split panel uses). The shoreline score rings of inserted lakes are left out, since they would run along the cut.

Everything that must stay hidden under the next sheet (alignment guides, `Lxx` labels, piece ids, sheet-nesting part ids, paint windows) keeps using the wood clips. The insert is never part of `layer.polygons` or the wood covering, so none of those can land where it would show through clear acrylic. `water-inserts.test.ts` checks this.

## Export

`acrylicGeometry` in `packages/core/src/export/water-inserts.ts` builds a stand-in `GeometryIRV1`: one layer `acrylic-NN` per wood sheet holding inserts, each polygon an insert shrunk by the fit clearance, with the acrylic kerf as `laserKerfMm` and the `W` ids as piece ids. The ordinary panel, SVG, master and sheet-nesting writers then cut acrylic exactly as they cut wood. The resulting fit:

| Edge | Cut path |
| --- | --- |
| Wood opening | nominal outline, compensated inward by half the wood kerf |
| Insert outline | nominal less the fit clearance, compensated outward by half the acrylic kerf |
| Hole for an island in an insert | nominal plus the fit clearance, compensated inward by half the acrylic kerf |

Files: `<name>-acrylic-NN.svg` (all inserts of wood layer NN on one tight canvas, or one panel per insert, `-acrylic-NN-w2.svg`, when together they outgrow the work area), each with an `-engrave.svg` companion, and `<name>-acrylic-master.svg`. Nested acrylic is `<name>-acrylic-sheet-NN.svg`. The manifest adds `result.fabrication.waterInserts`; `FabricationPackageV1.master` stays the wood master, and a project without inserts exports byte-identical files.

Acrylic nests on its own stock: `resolveAcrylicNestSettings` reads `waterInsertSheetNesting` (falling back to the work area), `acrylicNestableParts` extracts one part per insert, and `PackageOptions.acrylicSheetPlan` carries the plan. Part ids start with `acrylic-`, so the job key never matches a wood plan. Acrylic gets no engraved part ids: clear plastic shows every mark, so the guide names the pieces instead.

The Atomm embed's Open in Studio sends only the wood master; the export notice tells the maker to download the project files for the acrylic.

## Assembly guide

When inserts were written, the guide adds an acrylic sub-table (and sheet maps when nested) to "Cut the sheets", acrylic and acrylic-safe glue to "You will need", the insert count to the cover, the inserts in translucent blue on the step pictures, a note on step L-1 that its bed shows through the acrylic, and a note on step L to set each insert on the ledge once the layer is glued (underside film off, dry-fit, a few dots of clear glue, never cyanoacrylate, top film last).

## Studio

The switch and the acrylic thickness, kerf and fit clearance live in Fabrication settings (`AdvancedSection.svelte`), with one switch per lake (`insertLakes` in `preview-summary.ts`) to keep a lake wood. The export dialog's sheet layout shows a second "Acrylic sheet layout" block (`SheetLayoutSection` with `material="acrylic"`, backed by its own `SheetNesting` instance) when the model has inserts, and Individual files offers **Acrylic inserts**. The 3D preview extrudes each insert in translucent blue on its sheet; the cut preview outlines it on sheet L.

The agent request contract does not expose inserts yet; a project that has them keeps them through `parseProject`.
