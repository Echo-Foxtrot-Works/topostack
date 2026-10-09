# Airspace in acrylic

Show Class B, Class C and special use airspace (and, optionally, Class D) as translucent acrylic held at true height over the terrain stack, so a model shows the airspace in three dimensions as well as the ground under it. This builds on the FAA archive ([faa-aviation.md](../faa-aviation.md)) and on the second-material path that acrylic water inserts opened ([water-inserts.md](../water-inserts.md)).

**Not for navigation.** Every surface states the cycle, as the engraved aviation layer does.

## Decisions

- **The maker picks the form.** Three representations share one altitude model, one support system and one export path:
  - **Altitude plates.** One plate per altitude level, cut to the airspace's cross-section at that height. The shelves that start or end at that level are frosted; the sector edges that pass through the level are engraved as lines.
  - **Tier pieces.** Each level is cut to the shelves that start or end there, which gives the "upside-down wedding cake" of the chart users' guide.
  - **Solid volumes.** The airspace is sliced at the acrylic sheet interval, like the terrain, and every slab is stacked from floor to ceiling. This gives true solids but uses the most acrylic.
- **One vertical scale.** Airspace uses the terrain's own millimetres per metre and datum (`materialThicknessMm / metersPerLayer` above `ladderBase`), so a shelf floor at 8,000 ft sits where an 8,000 ft summit would. A separate airspace exaggeration would make terrain clearance meaningless. A whole Class B needs a 100–160 km crop (about 1:400,000 at 300 mm), where the default 2× leaves its shelves 1–2 mm apart. The studio therefore suggests the exaggeration that separates the levels (up to the 10× maximum) when airspace is turned on, and a ceiling cap keeps tall areas practical ([spike](../reports/airspace-acrylic-spike-2026-10-09.md)).
- **Plates and tiers keep the air between levels.** They put acrylic only at the altitudes where a floor or ceiling changes. At 10× the widest air gap in a column was 15–46 mm for plates and 30–97 mm for tiers ([spike](../reports/airspace-acrylic-spike-2026-10-09.md#gaps-between-levels)). That is the look of those forms; volumes are the solid choice, and the studio says so beside the form picker.
- **Acrylic covers only the airspace being modelled.** No piece extends past the sectors it represents: no full-footprint sheets and no margins. Everything outside defined airspace stays open, so the terrain reads from every side.
- **Styled after the FAA chart.** Tint, line style and altitude labels follow the VFR sectional legend in the Aeronautical Chart Users' Guide, the same reference the engraved aviation layer uses ([Chart styling](#chart-styling)).
- **Supports are cut-to-length rods in a material the maker chooses** (acrylic, brass, aluminium, dowel). The project sets the rod shape (round or square), its size and a fit clearance. The laser cuts indexing sockets into the terrain, and the assembly guide prints a rod cut list. **How a rod meets the acrylic is a setting** ([Rod joints](#rod-joints)): short segments glued between levels, or one continuous rod per column through holes in every piece.
- **First release: Class B, Class C and special use airspace, with optional Class D.** Class D is always a single flat lid at its ceiling over the airport, whatever the form, and is off by default.
- **Volumes come from new archive layers.** The existing `airspace` lines cannot be rebuilt into areas, because a shared edge is written once for only one area, and `sua` dissolves the altitude sectors and carries no altitudes. The engraved layer stays as it is.
- **Optional and additive.** The new `airspaceStack` setting is absent in every existing project, so fingerprints, exports and the agent contract are unchanged until a project turns it on. It is available only for layered models inside FAA coverage.

## Altitudes

Each sector is a prism: a 2D area with one floor and one ceiling. The sources code them as follows.

| Source code | Meaning | Resolved as |
| --- | --- | --- |
| `MSL` / `FT` | Feet above mean sea level | As is |
| `SFC`, value 0 | Surface | The ground (see below) |
| `SFC`, value > 0 | Feet above ground: 461 SUA floors (mostly MOAs, "500 AGL") and 17 SUA ceilings. Class B, C and D have none. | **Terraced.** The sector is split along terrain sheet bands so that no terrace spans more than 5 mm of ground; each terrace sits at its highest ground plus the value, snapped up to an existing level, so terracing adds pieces but no levels. Over flat ground this is one terrace. A single flat floor was up to 53 mm wrong over Nevada ranges. |
| `STD` / `FL` | Flight level | Value × 100 ft, treated as MSL. This is within a few hundred feet at engraving scale. |
| `UNLTD` | No ceiling | The ceiling cap |
| `SFC`, value 0, as a ceiling | Placeholder (15 SUA records) | Dropped |
| `UPPER_DESC` `TNI` | Up to but not including | Kept for the label only |

The **ceiling cap** (`ceilingCapFt`) trims every ceiling. It defaults to the highest Class B or C ceiling in the crop, or 10,000 ft when there is none; 18,000 ft made special use areas dominate (Las Vegas 115 mm against 63 mm capped). The capped lid prints its true ceiling ("FL180", "UNLTD"), so a trimmed area is never mistaken for a lower one.

### Levels

The distinct resolved floors and ceilings in the crop form the **levels**, ordered by height. A floor at the ground (`SFC`) is not a level, except in tiers (below). Levels whose model heights fall within `acrylic thickness + 2 mm` of each other merge to the lower one, with a warning, because no rod could fit between them. For each level ℓ:

- `F(ℓ)`: sectors whose floor is ℓ, the shelf undersides.
- `C(ℓ)`: sectors whose ceiling is ℓ, the lids.
- `S(ℓ)`: sectors that ℓ passes through.

The three forms read these the same way:

| Form | Piece outline at ℓ | Frosted | Engraved lines |
| --- | --- | --- | --- |
| Plates | `F ∪ C ∪ S`, the cross-section | `F ∪ C` | Sector edges of `S` inside the piece |
| Tiers | `F ∪ C` | none; the tint carries it | Shared sector edges within the piece |
| Volumes | The union of sectors present at each acrylic sheet | none | none; each sheet's edge is the boundary |

Each piece is the union of the sectors that make it and nothing more, so plates and tiers both stop at the airspace edge. Class D, when on, adds one lid piece per Class D area at its ceiling in every form.

**Surface floors in tiers.** A Class B or C core or a special use area that starts at the surface would otherwise have no piece until its ceiling, and read as empty air over the airport. In tiers it gets a floor piece just above the terrain under it. That floor is stepped like a floor given above ground, with 0 ft above ground: each step sits on the highest ground under it and snaps up to an existing level. Class D keeps its lid only. Plates need no such piece, since every plate already shows every sector it passes through.

A piece's underside sits at `z(ℓ)`, so a piece reads up to one acrylic thickness high. This is stated in the guide.

### Terrain clearance

Every piece is cut back wherever the terrain stack rises above its underside: by the union of the sheets whose top face is above `z(ℓ)`, grown by a clearance. Mountains therefore poke through a plate, which is the point of the model. The hole uses the sheets' own contour polygons, not the DEM, so it matches what was cut. A piece is kept only when it is at least 10 cm² and can host a column (inscribed radius of rod/2 + 2 mm); smaller fragments and slivers are dropped with a warning.

## Archive

Two new layers in [`aviation-tiles`](../../packages/data-contracts/src/aviation-tiles.ts), with geometry type `polygon` added to `AVIATION_LAYER_GEOMETRY`:

| Layer | Content |
| --- | --- |
| `airspace_volumes` | One polygon per Class B, C and D sector: `class`, `name`, `sector` (a stable id), `floor_ft`, `floor_ref` (`MSL` / `SFC` / `AGL` / `FL`), `ceiling_ft`, `ceiling_ref` (`MSL` / `FL` / `UNLTD`), `ceiling_below` |
| `sua_volumes` | One polygon per SUA service record, **not** dissolved. Exclusion pockets (`EXCLUSION=1`) are kept as sectors with their own floor, which is what 3D is for. The same altitude fields plus `kind` |

- `build-faa-aviation.py` reads the full `LOWER_*`/`UPPER_*` codes; today `altitude_ft` folds AGL into MSL and drops flight levels. `check-aviation-features.mjs` validates the new layers like the rest.
- Volume layers are written at zooms 5–10 (`AIRSPACE_VOLUME_MAX_ZOOM`), with `--detect-shared-borders` and `--no-tiny-polygon-reduction`. Stopping at 10 keeps polygons out of the zoom 11 and 12 tiles that engraved aviation reads; at 10 neighbouring sectors are left under 0.03 mm apart.
- **No slots between sectors.** The FAA surveys neighbouring sectors separately, and their shared edges miss by up to 106 m (Detroit Class B). A union, which every piece is, would keep each miss as a slot the laser cuts. Two rules close them ([report](../reports/airspace-acrylic-spike-2026-10-09.md#slots-between-sectors)):
  - The builder seals gaps narrower than 150 m between sectors (`seal_sectors`), within each family first (each class, each special use area) and then all together, and gives each sliver to every sector it touches. A sector's own narrow inlet is left as charted.
  - Core closes every piece by half the minimum feature after the union (0.4 mm by default), which also takes the tile seams and anything thinner than the laser can cut.
- The layers ship with the next cycle's archive (`faa-aviation-2026-10-29-v1`). Built from the 2026-10-01 pins they add 3 MB (35 → 38 MB) and a few KB per zoom 8–10 tile; the existing layers decode identically.
- `domain/airspace-volumes.ts` (`loadAirspaceVolumes`) decodes the new layers, unions each sector's tile pieces by `sector` and clips them to the crop, giving `AirspaceVolumeV1` records (polygons in crop millimetres, altitudes as charted) for `SourceBundleV1.airspaceVolumes`. Phase 2 calls it when `airspaceStack` is on. AGL resolution needs the terrain, so it happens in core.

## Geometry

New module `packages/core/src/pipeline/airspace-stack.ts`. It runs after the terrain layers, water inserts and nests exist and before hidden marks are placed, so a socket is just another terrain hole to everything placed after it.

1. **Resolve** sector altitudes to model heights (`altitudeZ`, one function, tested against the sheet ladder).
2. **Build pieces** for the chosen form. Pieces are cut back for terrain clearance, unioned by material (one tint per class family), and get altitude labels placed through `labelFootprint`.
3. **Place columns** (below).
4. **Cut sockets** into the terrain sheets and **engrave locators** on the pieces.

### Columns

A column is a vertical line of rod segments at one point. Each segment has a **seat** (a terrain socket, or the top face of a lower piece) and a **head** (the underside of a piece).

- Every form places columns per piece, since no piece reaches the model's edges. Each piece or floating slab stack is checked from above. A vertical line down from a candidate point meets either a lower piece, which becomes its seat (so tiers stack on tiers), or the terrain. Choose the fewest points such that the piece's centroid lies inside their support hull, with at least two for round rods (one square rod can index a small piece), and no unsupported span beyond `maxSpanMm` (default 150 mm for 3 mm acrylic). Score candidates by spread, short segments and flat ground. A piece that cannot be supported is dropped with `AIRSPACE_PIECE_UNSUPPORTED`; it is never exported floating.
- **Terrain sockets:** a hole the rod's size plus the fit clearance, cut through the top `n` sheets present at that point, where `n` comes from `socketDepthMm` and is at least one sheet. The sheet below stays whole and is the socket floor. The point must keep `rod/2 + margin` inside each sheet it passes through. It must avoid water-insert openings and ledges, nest cavities, and exposed contour edges.
- **Water and edges:** a column also keeps clear of water inserts, and of points where the terrain has a single sheet, since that leaves no socket floor.

### Rod joints

`rod.joint` chooses how a column meets the acrylic:

| Joint | Acrylic | Cut list | Assembly |
| --- | --- | --- | --- |
| `segments` (default) | An engraved locator, the rod's section, on the top face of each piece a segment touches. On clear or tinted acrylic it shows through, so the same mark places the segment glued underneath. | One length per gap; a terrain seat adds the socket depth | Build level by level, gluing each segment onto the locator below and the piece onto its top |
| `through` | A hole of the rod's size plus the fit clearance in every piece the column passes. The column runs from its socket to the highest piece it carries. | One length per column | Stand the rods in their sockets, slide the pieces down and glue each at the height the guide prints, measured from the terrain face at the socket |

With `through`, a column's line must stay clear of pieces it does not carry, or it would need a hole that holds nothing. The solver treats every piece above a column's seat and below its head as an obstacle unless the column carries that piece too. The guide prints a height table (column, rod, and each piece it carries with its height above the terrain face at the rod) instead of per-gap lengths.
- **Cut list:** lengths are rounded to 0.5 mm and equal lengths grouped (`R1 ×4 63.5 mm`).

### Chart styling

Everything follows the VFR sectional legend in the [Aeronautical Chart Users' Guide](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/aero_guide/). Shapes and labels come from the code the engraved layer already uses (`aviationStroke`, `aviation-labels.ts`). Acrylic can carry the chart's colour where an engraving cannot, so the tints restore what the engraved layer had to give up.

| Airspace | Chart | Acrylic tint | Engraved on the piece |
| --- | --- | --- | --- |
| Class B | Heavy solid blue | Blue | Heavy solid edge; ceiling over floor in hundreds of feet with a bar between, on each shelf |
| Class C | Solid magenta | Magenta | Solid edge; ceiling over floor, `T` where it reaches Class B |
| Class D (optional) | Dashed blue | Blue | Dashed edge; ceiling in a dashed box, minus for "up to but not including" |
| Prohibited, restricted, warning | Blue, hatched inside the edge | Blue | Hatched inner edge; name and altitudes |
| MOA, alert | Magenta, hatched inside the edge | Magenta | Hatched inner edge; name and altitudes |

- **Plates** are clear acrylic. The class colour is engraved as the chart draws it (line style and hatching) and the frost marks the shelves. The tint applies only to the tiers and volumes forms.
- Labels are placed as the chart places them: once per sector, at its roomiest point that fits, never over another label or a locator. They are placed through `labelFootprint`.
- The not-for-navigation notice and the cycle are engraved on the lowest piece.

### IR

Add `GeometryIRV1.airspaceStack?`: the form, the resolved material (acrylic thickness, kerf, tints), `levels[]` (altitude, ft and ref label, `zMm`, `pieces[]` with polygons, markings and material), `columns[]` (point, `segments[]` with seat, head and length) and the cycle. Sockets are ordinary holes in the terrain `layers`, so wood export needs no change. The IR addition is optional, so it needs no migration.

## Settings

```ts
ProjectConfigV1.airspaceStack?: {
  form: "plates" | "tiers" | "volumes";
  classes: { B: boolean; C: boolean; D: boolean; specialUse: boolean };  // D defaults to false
  ceilingCapFt?: number;        // default: highest Class B/C ceiling in the crop, else 10,000
  thicknessMm?: number;         // acrylic; falls back to materialThicknessMm
  kerfMm?: number;
  rod: {
    shape: "round" | "square";
    sizeMm: number;
    fitClearanceMm: number;
    socketDepthMm: number;
    joint: "segments" | "through";
  };
}
airspaceSheetNesting?: SheetNestingSettings;  // export-only, like waterInsertSheetNesting
```

`parseProject` adds it with the same conditional spread as `waterInserts`. Validation bounds the rod (2–12 mm), thickness (1–10 mm) and cap (1,000–60,000 ft). The fingerprint covers the setting and ignores the sheet layout. The rod's material name is guide text only and stays out of the fingerprint.

## Export

- `airspaceGeometry` builds a stand-in `GeometryIRV1` per material (clear, blue, magenta), following `acrylicGeometry`: one layer per level (plates, tiers) or per slab sheet (volumes). The existing panel, SVG, master and nesting writers then cut it. Files: `<name>-airspace-<material>-NN.svg`, `-engrave.svg` companions (frost fills, lines, altitude labels, locators), `-airspace-master.svg`, and nested `-airspace-sheet-NN.svg`.
- Terrain SVGs carry the sockets as holes. A project without `airspaceStack` exports byte-identical files, and a test proves it.
- Manifest: `result.fabrication.airspaceStack` (form, levels, the cut list, total height, cycle).
- **Assembly guide:** "You will need" lists the rod stock (total length per size) and the acrylic per tint. A **rod cut list** gives id, length, quantity and from → to (segments), or per-column lengths with a height table (through). A **level table** gives altitude, model height and what the level shows. A column map shows each level with numbered locators. The steps follow the joint: finish the terrain, seat the rods in the sockets, then build level by level (underside film off, dry-fit, a few dots of acrylic-safe glue). Pieces in the step pictures are drawn in their chart tint, with a legend matching the table above.

## Studio

- A new **Airspace in 3D** section in `panels/`, shown only for layered models with aviation coverage. It has the form picker (a small side-view diagram per form), class switches (Class D off by default), the ceiling cap, the acrylic and rod settings (shape, size, fit, socket depth, joint), and a summary: levels, total model height, acrylic area per tint, rod count and total length.
- **3D preview:** pieces as translucent extrusions at `zMm` in their chart tint (clear for plates; built on the water-insert material), frost as a lighter inner fill, engraved line styles on top, and rods as cylinders or boxes. Exploded view spreads levels using a new `baseZ` per level rather than the sheet index.
- **Cut preview:** a level picker that shows each piece with its locators, and terrain sheets with their sockets.
- **Warnings:** `AIRSPACE_TALL` (total height over 250 mm), `AIRSPACE_LEVELS_MERGED`, `AIRSPACE_TERRACED`, `AIRSPACE_PIECE_UNSUPPORTED`, and `AIRSPACE_ACRYLIC_HEAVY` (volumes over a sheet budget).

## Scale check

From the [spike](../reports/airspace-acrylic-spike-2026-10-09.md), 300 mm wide, 3 mm sheets:

| Crop | Scale | Levels at 2× / 10× | Exaggeration that separates all | Top at 10× |
| --- | --- | --- | --- | --- |
| Denver Class B, 120 km | 1:400k | 2 / 6 of 8 | 13× | 60 mm |
| Seattle Class B and SUA, 100 km | 1:334k | 5 / 10 of 12 | 27× | 129 mm (93 mm capped at 10,000 ft) |
| Las Vegas Class B and Nellis, 140 km | 1:467k | 3 / 9 of 17 | floors above ground | 115 mm (63 mm capped) |

## Phases

0. **Feasibility spike — done 2026-10-09** ([report](../reports/airspace-acrylic-spike-2026-10-09.md)). Five crops on real data; it set the defaults above and moved the plan to a suggested exaggeration, a crop-based ceiling cap, terraced floors above ground, and browser-side seam closing. Column placement, label fit and a physical test cut remain for phase 2.
1. **Data — built 2026-10-09.** Contract layers and parsers, builder, contract check, `AirspaceVolumeV1`, and the browser decode and union, with tests. The archive with volumes ships with the 2026-10-29 cycle refresh; until then the served archive has no volume layers and nothing reads them.
2. **Core, supports, export and studio**, as four stacked pull requests:
   - **2a. Geometry — built 2026-10-09.** `ProjectConfigV1.airspaceStack` (parse, validation, fingerprint, `DEFAULT_AIRSPACE_STACK`) and `pipeline/airspace-stack.ts`, run on the unsplit sheets right after water inserts. Altitudes resolve on the terrain's scale; levels merge when closer than the acrylic plus 2 mm; floors and ceilings given above ground are stepped over the cut sheets and snap up to existing levels; tiers give surface-floored sectors a floor above the ground; Class D is a lid only. Pieces for all three forms are unions closed by half the minimum feature, cut back 1 mm from terrain that rises through them, and dropped under 10 cm². Output is `GeometryIRV1.airspaceStack` (levels, pieces, frost and sector edges for plates, tints). Warnings: `AIRSPACE_NOT_LOADED`, `_LEVELS_MERGED`, `_TERRACED`, `_PIECES_DROPPED`, `_TALL`, `_ACRYLIC_HEAVY`. On real Denver, Seattle and Las Vegas data at 10× it reproduces the spike's levels; Las Vegas takes 4–6 s, most of it stepping MOA floors over rugged ground, which is the first thing to speed up.
   - **2b. Supports — built 2026-10-09.** `pipeline/airspace-supports.ts`, run inside the airspace stage before the split and nests, so a socket is an ordinary hole to everything after it. Pieces are held bottom up: candidate points on a grid inside each piece (rod radius plus 2 mm from its edge); straight down, a rod seats on the highest lower piece holding the point or in a socket cut through the top sheets (`socketDepthMm`, 1.5 mm of wall in every sheet, clear of water inserts and of every piece and sheet it passes). Columns are chosen farthest-point first until the piece's centroid is inside them and every part is within 75 mm of one (two rods under 30 cm², one square rod; at most 16). A piece glued flat on what is under it over a quarter of its area rests there instead (volumes); one no rod can hold is left out (`AIRSPACE_PIECE_UNSUPPORTED`). Outputs: columns of segments with seats and cut lengths (half-millimetre), a grouped cut list, locators on every piece a rod touches, socket holes in the sheets.
     - **Backing sheet.** Ground at the land minimum is only the bottom sheet, so most sockets on flat land go through it; the rod then stands on a plain backing sheet glued under the model (`backingSheet`), which 2c exports.
     - On real data at 10×: Denver plates 34 columns and 0.64 m of rod, Seattle plates 45, Las Vegas tiers 38. Stepping a sector over the ground was regrouped by the level each step snaps to, which cut Las Vegas from 8–24 s to 2–7 s; Denver and Seattle take 50–450 ms.
     - Known limits: a volume sheet that overhangs the one under it is glued along the overlap only, however far it reaches (phase 4); the airspace code adds 2.3 KB gzip to the studio's initial JavaScript (1.3% headroom left), so 2d should load the stage only for projects that use it.
   - **2c. Export — built 2026-10-09.** `export/airspace.ts` makes the pieces a stand-in geometry (`airspace-<tint>-NN`, one layer per level and tint) so the ordinary panel, SVG and master writers cut them: `<name>-airspace-<tint>-NN.svg` with `-engrave.svg` companions (each piece on its own panel when a level outgrows the work area), a master per tint, and `<name>-airspace-backing.svg` (per bottom-sheet piece on a split model). Pieces are cut at nominal size with the acrylic kerf; frost is filled engraving that stops 1 mm short of every rod outline so it stays readable; sector edges keep their chart styles. The manifest carries `result.fabrication.airspaceStack` (levels, pieces, panels, rods, cut list, columns, cycle), the README a paragraph, and the assembly guide a cover fact, "You will need" lines (acrylic per tint, rod stock, backing sheet, glue) and a "Build the airspace" section with steps, the rod cut list, a level table and a rod map per level. Export is blocked when a project asks for airspace that was never loaded. A model without airspace exports exactly as before.
     - For 2d: `native-export.ts`'s `PANEL_NAME` regex must keep `-airspace-` files out of the wood bundles, and the loader must pass an empty `airspaceVolumes` outside FAA coverage, so a covered-but-empty area exports instead of blocking.
   - **2d. Studio — built 2026-10-09.** `sourceRequirements(...).airspace`; `loadAirspace` in `data-provider.ts` (imported on demand; empty outside FAA coverage, absent on failure) with `airspaceStatus` and `airspaceCycle` on the source; refresh, resize and cache keys in `source-refresh.ts`. The stage is its own entry, `@topostack/core/airspace`, registered per realm by `ensureAirspaceStage` (page and geometry worker) and kept out of the startup chunk; a realm that never registers it warns instead of failing, and the in-chat preview strips the setting. The Airspace in 3D switch and settings sit in Fabrication settings (form, kinds, ceiling cap, acrylic, rods, a summary, and a one-click 10× exaggeration when levels merge). The 3D preview draws pieces in their tints, frost, sector edges and rods; the export dialog adds an Airspace bundle and count; the export-files guide and a changelog fragment describe it; `e2e/airspace.spec.ts` builds and exports one.
     - Not in 2d: a 2D cut view of the airspace levels (sockets show on the sheets already), the `through` joint (phase 3, below), and agent access (phase 5). Initial studio JavaScript fell from 157.9 to 153.2 KB gzip once the stage became lazy.
3. **The `through` joint — built 2026-10-09.** Tiers polish and Class D lids came with 2a. With `rod.joint: "through"`, `airspace-supports.ts` places candidates on one 8 mm grid shared by every piece (twice the rod size when that is larger), so a rod standing in the terrain for one piece can rise on to hold the next: it passes a lower piece only well inside it (rod radius plus 2 mm), clears every other piece by the passing clearance, and is extended rather than duplicated (an existing rod counts 1.5× in the farthest-point choice). Pieces it passes get a hole of the rod plus the fit clearance, frost included, and are listed on the segment as `throughPieceIds`. A piece the shared grid cannot hold (a small piece, rugged ground) tries the piece's own finer grid, then glued segments on the pieces below, keeping every rod a rod-spacing apart; nothing is left out that `segments` would hold. The guide adds a "Rod heights" table measured from the terrain face, slide-down steps and a note where segments stand on pieces; the README and studio describe the joint, and the studio's rod settings gain "Rods meet pieces".
   - On real data at 10× through rods cut the rod count by two thirds or more in plates (Denver 39 → 13, Seattle 54 → 18, Las Vegas 78 → 19) and by up to a quarter in tiers (34 → 25, 43 → 31, 39 → 36), for 3–67% more total rod length, and hold every piece segments hold (Las Vegas tiers leaves out the same three pieces either way).
4. **Solid volumes.** Columns under floating stacks (slicing and the acrylic budget warning came with 2a).
5. **Agents and polish.** `airspaceStack` in `ProjectRequestV1`, REST, MCP and WebMCP, plan notes (height, rod list), the MCP guide, the e2e spec, and docs.

## Verification

- **Core:** altitude resolution for every code pair; level merging; terrain clearance against fixture stacks. Column invariants on generated stacks: every piece supported, centroid inside its hull, every socket inside material with margin, never in a water insert or nest cavity, no segment or through-rod passing a piece it does not carry. No piece extends outside the union of its sectors. With `through`, every piece a column carries has its hole and nothing else does. `hiddenMarkIssues` stays clean with sockets present. `fabrication-regressions.test.ts` gains an airspace case.
- **Compatibility:** fingerprints of projects without the setting, and byte-identical exports without it.
- **Data:** builder tests for the code pairs and undissolved SUA sectors; adapter tests for unions across tile seams and sectors cut by the crop.
- **Real data:** the render harness from the aviation work over Denver and Las Vegas, plus one physical test cut of a plates model before phase 3.

## Resolved questions

- **Gaps between levels:** kept in plates and tiers; volumes are the solid form. In tiers, a sector that starts at the surface gets a stepped floor piece just above the terrain (2026-10-09).

- **Rod joints:** a setting, `segments` (default) or `through` (2026-10-09).
- **Piece extent:** pieces cover only the airspace being modelled (2026-10-09).
- **Tints and styling:** follow the FAA sectional legend (2026-10-09).
- **Class D:** optional, off by default, one flat lid at the ceiling over each Class D airport (2026-10-09).
