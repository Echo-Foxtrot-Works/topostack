# Public and protected lands

Status: 2026-10-13. All phases are built as a stack of pull requests: the spike, the archive and Worker route, paint stencils, engraved boundaries, the agent surfaces, leaving units out with the OSM fallback, and Canada (CPCAD, archive `-v2`). The `-v1` archive is provisioned in development only; see the [runbook](../public-lands.md).

Paint templates gain land kinds: national parks, national forests, wilderness, BLM land, state parks, wildlife refuges, preserves, tribal and military land. Each kind gets its own paper stencil per panel, cut the same way water stencils are today. Each kind can also be engraved as a boundary line, so flat engravings get the feature too.

## Where it plugs in

The water system is a set of stencils, not a brush. `ProjectConfigV1.paintTemplates` lists region kinds. `paintRegions()` (`packages/core/src/pipeline/paint-regions.ts`) intersects each kind's region with the area of every cut piece that stays exposed after assembly, adds `PAINT_BLEED_MM`, and returns `PaintRegionIR` windows plus the `paper` stencil. Export writes one `-paint-<kind>.svg` per panel. The `REGION_SOURCES` registry was built for this: its comment names "public land, a park boundary" as the next kinds.

Land is simpler than water. Water belongs only to the layers at or below its surface. A land area belongs to every layer, and the exposed-area clip that `paintRegions` already applies decides what shows. A land kind's source is therefore the same polygon set for every layer.

## Decisions

- **Our own archive, built from PAD-US.** USGS PAD-US 4.1 (March 2025, public domain, DOI 10.5066/P96WBCHS) covers federal, state, local, tribal, military and NGO land in one schema. It goes through an offline build into `lands/current.pmtiles` and is served by range like the aviation and lake archives. Live ArcGIS services are rate-limited and would break the pinned-dataset rule.
- **Classify at build time, not in the browser.** The build maps PAD-US fields (`FeatClass`, `Des_Tp`, `Mang_Type`, `Mang_Name`) onto a short fixed list of classes. The tiles carry only the class and display fields, so the browser never has to read the 30-plus PAD-US codes.
- **One record per unit, never the raw Combined layer.** PAD-US repeats one park as Fee, Designation and Proclamation polygons. The build picks one feature class per class (table below) and dissolves by unit, so nothing paints twice.
- **The stencil kinds are the classes.** Each class is one paint color, so `PAINT_REGION_KINDS` grows from `["water"]` to water plus the land classes. The field stays a flat string list. Absent means `[]`, so old projects keep their fingerprints, and `paintTemplates` is already terrain-independent.
- **A fixed priority decides overlaps.** Within one panel, each window is reduced by the windows of every higher-priority kind the project paints, so no spot gets two coats. The order, highest first:
  - water, so lakes inside a park stay blue;
  - national park, national monument;
  - wildlife refuge, preserve, state park, military, tribal;
  - wilderness;
  - national forest, BLM.

  Named units outrank wilderness, which covers 63–75% of the parks in CO and CA; the other way round, a park paints as slivers along its roads.
- **Full named outlines, where the agency owns a quarter.** National forests and wildlife refuges are painted to their proclaimed or approved boundary, inholdings included, because that is the outline people know from maps. Every forest qualifies. Some refuge boundaries are drawn around whole regions: 82 are at least 95% land the Fish and Wildlife Service does not own. A refuge's outline is therefore kept where the service owns at least 25% of it, or none of it (an overlay refuge on another agency's land); otherwise the refuge is the land it owns inside.
- **Oklahoma's tribal statistical areas are reservations.** They are painted as tribal land under the tribe's name; most match reservations confirmed since *McGirt v. Oklahoma*. Alaska Native village and the other Census statistical areas are left out.
- **Every class stays separate.** Monuments are not merged into parks, and BLM is not merged into other federal land. Each class is its own stencil.
- **The United States first, then Canada, then OSM.** PAD-US covers the US and its territories, CPCAD Canada (`-v2`), and OpenStreetMap's protected areas stand in elsewhere. A crop where none has the classes asked for gets `landsStatus: "not-covered"`, a warning rather than an export block.
- **No WDPA.** Protected Planet forbids commercial use and redistribution of derived data without written permission, and an SVG export is a download.

## Classes and sources

The [spike](../reports/public-lands-spike-2026-10-13.md#class-rules) settled the rules. Outlines in the Proclamation layer are coded `PROC`, so they are classified by manager and unit name.

| Class (kind id) | PAD-US selection | Notes |
| --- | --- | --- |
| `national-park` | Proclamation, `Mang_Name=NPS`, name not "National Monument" | 346 units. Includes historic sites, recreation areas, seashores, the Appalachian Trail corridor. The NPS Land Resources Division file can override later. |
| `national-monument` | Proclamation NPS named "National Monument", plus Designation `NM` managed by BLM or USFS | 139 units. FWS `NM` records are the Pacific marine monuments and are left out. |
| `national-forest` | Proclamation, `Mang_Name=USFS` | 174 units, forests and grasslands. Full outline, inholdings included; every forest is at least 24% Forest Service-owned. |
| `wilderness` | Designation `WA`, any manager | 856 units. Study areas (`WSA`) are not wilderness and are left out. |
| `blm` | Fee, `Mang_Name=BLM` | No unit names; one unit per state. |
| `wildlife-refuge` | Proclamation, `Mang_Name=FWS`, named "National Wildlife Refuge" | Full outline where FWS owns at least 25% of it or none of it (overlay refuges), otherwise only the land it owns. |
| `state-park` | Fee, `Des_Tp` in `SP`, `SREC` | 7,586 units. |
| `preserve` | Fee, `Des_Tp` in `PCON`, `LCA` | 23,658 units. Easements excluded. Drop "Proposed …" records. |
| `tribal` | Proclamation, `Mang_Name=TRIB` (Census AIANNH 2022 inside PAD-US) | Legal areas and Oklahoma Tribal Statistical Areas (named for the tribe); other statistical areas left out. |
| `military` | Proclamation, `Mang_Name=DOD` | 745 installations (DoD MIRTA FY22). |

Each feature carries `class`, a stable `unit` id (class plus `Unit_Nm`, plus state for state parks and preserves, and state alone for BLM), `name`, `manager` and `acres` for label ranking. The build reads every layer whole and filters in Python, because GDAL's OpenFileGDB driver drops rows for some attribute filters on this geodatabase.

Optional later: county and state boundaries from TIGER cartographic files (`cb_2025_*`) as engraved lines, since the OSM boundary today is state or province only.

## Outside the US

- **Canada:** CPCAD (December 2025, Open Government Licence – Canada) maps onto the same classes in a second build input. Phase 5.
- **Everywhere else:** the Protomaps archive we already serve has `nature_reserve`, `national_park`, `protected_area` and `forest` landuse polygons through z12, without names, ids or managers. It can back one generic "protected area" stencil outside PAD-US coverage, at no data or licence cost (OSM attribution is already present), and nothing finer.

## Phases

0. **Spike (done).** See the [report](../reports/public-lands-spike-2026-10-13.md):
   - It corrected the class rules, the priority order and the refuge rule.
   - The national archive is 127 MiB at z4–z12.
   - Rocky Mountain National Park and the Moab BLM land come through a 1 mm minimum feature cleanly.
1. **Data, contract, provisioning, route (built).**
   - `@topostack/data-contracts/land-tiles`: classes, properties, archive metadata, coverage.
   - `scripts/data-build/build-public-lands.py`, with sources pinned in `scripts/data/public-lands-sources.json` and a contract check before tiling.
   - `provision-lands-data.mjs` on `archive-provisioning.mjs`.
   - Worker route `/v1/lands.pmtiles` (optional, not on `/ready`), a manifest entry, and the deployment smoke test's dataset check. Area coverage for agents moves to phase 4, with the rest of the agent surface.
   - Polygons are stored as polygons, not boundary lines. The browser merges a unit's tile pieces by `unit` and dissolves them, as the HydroLAKES loader does. Tile buffers are removed when the pieces are merged.
2. **Paint stencils end to end (built, stacked on phase 1).**
   - Core:
     - Add the land kinds to `PAINT_REGION_KINDS` and give each a `REGION_SOURCES` entry.
     - Add `SourceBundleV1.landAreas` with `landsStatus` and `landsAttribution`.
     - Add a `PAINT_PRIORITY` order that `paintRegions` uses to subtract higher-priority windows.
     - `sourceRequirements()` gains `lands`, true when any land kind is in `paintTemplates` or has a boundary line on.
   - Browser:
     - A lazily imported `domain/lands-provider.ts`, loaded by `data-provider.ts` the way aviation is.
     - `source-refresh.ts` reloads lands when a land kind is turned on.
   - Studio:
     - A "Public lands" section in `FeaturesPanel` with one switch per class and its suggested paint color.
     - The 2D preview tints windows per kind.
     - The 3D preview tints exposed land faces.
     - `ExportDialog` and the panel summary list each kind.
   - Export:
     - Per-panel `-paint-<kind>.svg`, plus manifest entries for kinds and file counts.
     - The README and assembly guide list a paint order: water last, more specific classes after broad ones.
     - PAD-US, NPS and Census credits appear only while lands are used.
3. **Boundary lines and flat engraving (built, stacked on phase 2).**
   - A `MarkingFeature` kind `land` with a `landClass`, routed over exposed layers the way boundaries are, with a dash per class (`landStroke`). Edges the crop added are left out.
   - In flat engraving, an optional interior hatch uses the tick drawing of the special use airspace hatch (`leftTicks`).
   - Unit names, up to 12, go at each unit's roomiest point, largest first, where they fit inside the unit and clear of other names.
   - Project field: `lands: { boundaries: LandClass[], hatched: boolean, labels: boolean }`, absent meaning off. Land is loaded for the classes engraved as well as those painted.
   - Known limit: two classes that share a border (a wilderness edge on a forest edge) each engrave their own line.
4. **Agents (built, stacked on phase 3).** `ProjectRequestV1` gains `paintTemplates` (a list, replaced whole) and `publicLands` (`boundaries`, `names`, `hatched`, or `false`), additive so `requestVersion` stays 1. Coverage reports `publicLands` (the PAD-US version) and plan notes say when an area has none or when flat output drops paint templates. Plans credit PAD-US only when a design paints or engraves land. The MCP guide, the agent API, MCP server and browser agent guides, and the WebMCP update tool's description name the new fields.
5. **Canada, OSM fallback, per-unit selection.** All three parts are built: per-unit selection and the OSM fallback (stacked on phase 4), then Canada as the `-v2` archive (stacked on those).
   - CPCAD as a second build input (built): the archive contract gains `cpcad_date`, a per-unit `source` and Canada coverage; `landsSources` lists the databases a model used, and each is credited. See [public-lands.md](../public-lands.md#canada).
   - The OSM `landuse` fallback outside PAD-US (built): `national_park`, `nature_reserve`/`protected_area` (as preserve) and `military`, unnamed, joined by feature id; `landsSource` says which source a model used, with a warning and a README line.
   - Leaving units out (built): `landExclusions` lists unit ids, applied to paint and boundaries without reloading; the Features panel lists the 40 largest units in the area. Click-to-pick on the map and an agent field are later.

## Known limits (expected)

- PAD-US is about 18 months old. NPS overrides keep parks current; other classes refresh with each annual PAD-US release.
- Local and private conservation land is incomplete in PAD-US.
- BLM land at small scales is thousands of tiny squares. Below the minimum feature size they drop out of the stencil, and a crop that is mostly checkerboard gives a fiddly stencil. The panel should say so.
- Proclamation outlines include private inholdings, so the paint is "inside the forest boundary", not "public land".

## Verification

- Contract and builder tests: class mapping per `Des_Tp`/`Mang_Name`, unit dissolve, archive identity, coverage.
- Adapter tests: merging units across tile seams, buffers, not-covered, mismatched archive, point and ring budgets.
- Core tests in `paint-regions.test.ts`:
  - A land region on every exposed layer.
  - Priority subtraction for wilderness inside a forest, and for a lake inside a park.
  - Old projects keep their fingerprints.
- Export tests: a stencil file per kind and the manifest entries.
- Fabrication regressions: one stacked crop with two land kinds and water painted.
- E2E: turn on a land kind, generate, check the exported ZIP.
