# Acrylic water inserts

A layered model can replace each lake's water with a fitted piece of acrylic. The lake's vector shoreline is cut out of the wood sheet that carries its waterline, and an acrylic insert of the same shape fills the opening, flush with the waterline, resting on the sheet below. Only that one sheet becomes acrylic: the deeper bed steps stay wood and show through it.

The setting is `ProjectConfigV1.waterInserts` (thickness, kerf, fit clearance, excluded lakes). Acrylic stock sheets for nesting are `waterInsertSheetNesting`, an export-only setting like `sheetNesting`. Both are absent in every project that never used them, so older fingerprints are unchanged; the fingerprint covers `waterInserts` (with the exclusion list sorted) and ignores the sheet layout.

## Geometry

`cutWaterInserts` in `packages/core/src/pipeline/water-inserts.ts` runs right after `waterOutputs`, before the work-area split, material nests and alignment guides, so all of them treat each opening as an ordinary terrain hole.

- **Which lakes.** Every `WaterSurfaceIR` of kind `lake` that is not excluded. Surfaces exist only with Water depth on, which is why the switch needs it. A lake is keyed by `waterInsertLakeKey`: its HydroLAKES id, else its source's lasting `lakeKey`, else its surface id, so one opt-out covers every piece of a lake the crop splits. A map-only (OpenStreetMap) lake is numbered by its place in the tile, which moves when the map does; it carves only once a traced chart names it, and the chart's `outline:<chart id>` becomes its `lakeKey`, the same key the chart reference uses.
- **The surface sheet** is `surface.layerIndex` (L), the sheet whose top face holds the waterline. A lake on the bottom sheet stays wood with a warning: nothing would hold the insert.
- **The footprint** is the vector lake, plus the part of L's own basin hole within one grid cell of it (the carved floor is contoured from cell samples, so that hole overshoots the vector shoreline; without this, a crescent of open water would sit beside the acrylic). Only holes the lake itself reaches into count, so a neighbouring pit or a placed graphic's cutout stays wood. It is kept inside L's outline and clear of L+1, so the acrylic covers only the visible face and nothing rests on it. A vector island stays wood, and so does an island hill the DEM has but the vector lake lacks.
- **Cost.** Each lake works only with the sheet near it: its own basin holes, and L's outline and L+1 cut to a window round it (`windowPolygons`, a linear rectangle clip). Only the cut itself and the ledge union touch whole sheets, once per sheet, so a map full of lakes costs little more than one lake. Generation reports the step as the `water-inserts` stage.
- **Narrow arms and slivers.** The footprint is opened by `WATER_INSERT_MIN_WIDTH_MM` (3 mm, or twice the minimum feature). Thinner arms, and pieces under 50 mm², stay wood with their depth steps.
- **The ledge.** L-1 gains a `WATER_INSERT_LEDGE_MM` (2 mm) rim just inside every opening, so an insert always has something to rest and be glued on, even over a steep basin. Through the acrylic it reads as a shallow shelf.
- **Pieces.** Each connected part of a footprint is one insert, `W1`, `W2`... numbered by sheet, then by area. They are recorded on `GeometryIRV1.waterInserts`, with the resolved acrylic in `waterInsertMaterial`. Each inserted lake's surface gains `openPolygons`, the water left open beside its acrylic (an arm that stayed wood), which the previews float instead of the whole lake.
- **Warnings.** `WATER_INSERT_SKIPPED` (bottom sheet, too small, water covering its whole sheet, or a shoreline the clipper refused), `WATER_INSERT_PROUD` (acrylic thicker than the wood), `WATER_INSERT_OVERSIZE` (a piece larger than the machine work area, either way round; acrylic is never seam-split, since a seam would show in the water).

## Map detail on the acrylic

Routing uses a second set of layer clips (`withInsertSurfaces`) in which sheet L carries the acrylic as material. Roads, boundaries, grids, labels, annotations and markers that cross the water therefore land on sheet L over the lake and are excluded from the bed underneath. Elevation labels are the exception: a bed step's label reads through the acrylic like the step itself, so they keep the wood sheets, and `labelCoverings` only adds each ledge, which the insert's edge and glue cover. `takeInsertMarkings` then moves that share onto each insert (`markingsWithin` in `pipeline/marking-clip.ts`, the same clipping a split panel uses). The shoreline score rings of inserted lakes are left out over the acrylic and within `WATER_INSERT_SHORE_BAND_MM` of it, since there they would run along the cut; along an arm that stayed wood they keep their score.

Everything that must stay hidden under the next sheet (alignment guides, `Lxx` labels, piece ids, sheet-nesting part ids, paint windows) keeps using the wood clips. The insert is never part of `layer.polygons` or the wood covering, so none of those can land where it would show through clear acrylic. `water-inserts.test.ts` checks this.

## Export

`acrylicGeometry` in `packages/core/src/export/water-inserts.ts` builds a stand-in `GeometryIRV1`: one layer `acrylic-NN` per wood sheet holding inserts, each polygon an insert shrunk by the fit clearance, with the acrylic kerf as `laserKerfMm` and the `W` ids as piece ids. The ordinary panel, SVG, master and sheet-nesting writers then cut acrylic exactly as they cut wood. The resulting fit:

| Edge | Cut path |
| --- | --- |
| Wood opening | nominal outline, compensated inward by half the wood kerf |
| Insert outline | nominal less the fit clearance, compensated outward by half the acrylic kerf |
| Hole for an island in an insert | nominal plus the fit clearance, compensated inward by half the acrylic kerf |

Files: `<name>-acrylic-NN.svg` (all inserts of wood layer NN on one tight canvas, or one panel per insert, `-acrylic-NN-w2.svg`, when together they outgrow the work area either way round; `acrylicPanelGroups` decides, and the oversize warning and the studio's file count read the same grouping), each with an `-engrave.svg` companion, and `<name>-acrylic-master.svg`. Nested acrylic is `<name>-acrylic-sheet-NN.svg`. The manifest adds `result.fabrication.waterInserts`; `FabricationPackageV1.master` stays the wood master, and a project without inserts exports byte-identical files.

Acrylic nests on its own stock: `resolveAcrylicNestSettings` reads `waterInsertSheetNesting` (falling back to the work area), `acrylicNestableParts` extracts one part per insert, and `PackageOptions.acrylicSheetPlan` carries the plan. Part ids start with `acrylic-`, so the job key never matches a wood plan. Acrylic gets no engraved part ids: clear plastic shows every mark, so the guide names the pieces instead.

The Atomm embed's Open in Studio sends only the wood master; the export notice tells the maker to download the project files for the acrylic.

## Assembly guide

When inserts were written, the guide adds an acrylic sub-table (and sheet maps when nested) to "Cut the sheets", acrylic and acrylic-safe glue to "You will need", the insert count to the cover, the inserts in translucent blue on the step pictures, a note on step L-1 that its bed shows through the acrylic, and a note on step L to set each insert on the ledge once the layer is glued (underside film off, dry-fit, a few dots of clear glue, never cyanoacrylate, top film last).

## Studio

The switch and the acrylic thickness, kerf and fit clearance live in Fabrication settings (`AdvancedSection.svelte`), with one switch per lake (`insertLakes` in `preview-summary.ts`) to keep a lake wood. The export dialog's sheet layout shows a second "Acrylic sheet layout" block (`SheetLayoutSection` with `material="acrylic"`, backed by its own `SheetNesting` instance) when the model has inserts, and Individual files offers **Acrylic inserts**. The 3D preview extrudes each insert in translucent blue on its sheet; the cut preview outlines it on sheet L.

The agent request contract does not expose inserts yet; a project that has them keeps them through `parseProject`.
