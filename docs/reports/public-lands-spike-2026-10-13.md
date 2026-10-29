# Public and protected lands: feasibility spike — 2026-10-13

Phase 0 of the [public lands plan](../plans/public-lands.md). The national PAD-US 4.1 geodatabase was mapped onto the ten land classes, dissolved per unit and tiled, then painted over two crops. There is no product code yet. The spike confirms the approach and finds five things the plan had wrong.

## Decision

The feature is feasible with one archive built from PAD-US alone. The national archive is 127 MiB at zoom 4–12. Classifying, dissolving and tiling take about six minutes on a laptop. Proceed to phase 1 with these changes to the plan:

1. **Classify Proclamation features by manager and unit name, not by designation code.** In the Proclamation layer almost every outline is coded `PROC`, so `Des_Tp` cannot tell a park from a forest. The manager (`NPS`, `USFS`, `FWS`, `DOD`, `TRIB`) and the unit name can. The corrected rules are [below](#class-rules).
2. **Named units outrank wilderness.** Wilderness covers 63–75% of the national parks in CO and CA. With wilderness on top, Rocky Mountain National Park paints only as ribbons along its roads. The order becomes: park and monument, then refuge, preserve, state park, military and tribal, then wilderness, with forest and BLM lowest.
3. **Paint a refuge's full outline only where FWS owns a meaningful share of it.** 82 refuge outlines are at least 95% land FWS does not own, 96 million acres in all. Examples: Northern Tallgrass Prairie (42M acres, 0.9% owned), Driftless Area (10M), Michigan Islands (34M, mostly Lake Michigan). These are acquisition boundaries drawn around whole regions. Rule: full outline when FWS owns at least 25%; otherwise only the FWS-owned parcels (adopted). National forests do not need this: every forest is at least 24% Forest Service-owned, most over 75%.
4. **Tribal land comes from PAD-US, but its statistical areas need a decision.** PAD-US's tribal outlines are the Census 2022 AIANNH file. Its 819 units include 29 Oklahoma Tribal Statistical Areas (33M acres) and 221 Alaska Native Village Statistical Areas (14M acres) next to 569 legal areas. Excluding the statistical areas, as the plan said, also drops the Five Tribes' reservations: Census still files them as statistical areas, although *McGirt v. Oklahoma* (2020) and later rulings confirmed they exist. See [decisions after the spike](#decisions-after-the-spike).
5. **The OSM fallback is generic only.** Our Protomaps archive does carry `nature_reserve`, `national_park`, `protected_area` and `forest` landuse polygons through z12. They have no names, no ids, and no manager. Rocky Mountain National Park, its wilderness and the Moab BLM land are all `nature_reserve`. Outside the US the fallback can offer one "protected area" stencil and nothing finer.

Two build rules come out of the measurements as well:

- **Read every layer whole and filter in Python.** GDAL's OpenFileGDB driver silently drops rows for some attribute filters on this geodatabase: `Des_Tp = 'NWR'` on the Fee layer returns none of its 1,247 rows. A `where` clause that loses rows would quietly empty a class, so the builder must also check row counts against a full scan.
- **Data clean-up:** drop preserve records named "Proposed …" (one in AZ claims 667,000 acres). Treat "Unknown" names as unnamed. Expect the Appalachian Trail corridor and the National Mall memorials in `national-park`. 10,097 of the 34,888 units are under 10 acres, which is still 4 mm across on a 6 km crop, so they stay.

## Reproduce

```sh
uv run scripts/data-build/public-lands-spike.py classify --gdb <gdb> --out .topostack/padus/spike
uv run scripts/data-build/public-lands-spike.py overlaps --states <gdb dir>/tl_2022_us_state.shp --out .topostack/padus/spike
uv run scripts/data-build/public-lands-spike.py ownership --gdb <gdb> --out .topostack/padus/spike
uv run scripts/data-build/public-lands-spike.py tiles --out .topostack/padus/spike
uv run scripts/data-build/public-lands-spike.py render --out .topostack/padus/spike
```

`uv` reads the script's pinned dependencies (geopandas, pyogrio, pyarrow, shapely and matplotlib) from its header, so the data-build requirements are unchanged. `tiles` needs tippecanoe, tippecanoe-decode and pmtiles.

| Input | Version |
| --- | --- |
| PAD-US 4.1 national geodatabase | `PADUS4_1Geodatabase.zip`, 1,523,434,496 bytes, SHA-256 `62ed1133…c9b823ab`, published 2025-03-31 ([ScienceBase](https://www.sciencebase.gov/catalog/item/652d4fc5d34e44db0e2ee45e)) |
| State outlines | `tl_2022_us_state.shp`, shipped inside the same zip |
| Protomaps archive | `osm.pmtiles` as served by topostack.app, build 20260905, basemap 4.15.2 |

The ScienceBase "manager" download links return a web app, not the file. The working direct link is `https://www.sciencebase.gov/catalog/file/get/652d4fc5d34e44db0e2ee45e?name=PADUS4_1Geodatabase.zip`.

## Class rules

| Class | Rule | Units | Acres |
| --- | --- | --- | --- |
| `national-park` | Proclamation, `Mang_Name=NPS`, name not "National Monument" | 346 | 83M |
| `national-monument` | Proclamation NPS named "National Monument", plus Designation `NM` managed by BLM or USFS | 139 | 19M |
| `national-forest` | Proclamation, `Mang_Name=USFS` (forests and grasslands) | 174 | 230M |
| `wilderness` | Designation `WA`, any manager | 856 | 114M |
| `blm` | Fee, `Mang_Name=BLM`, one unit per state | 30 | 242M |
| `wildlife-refuge` | Proclamation, `Mang_Name=FWS`, named "National Wildlife Refuge" | 535 | 265M |
| `state-park` | Fee, `Des_Tp` in `SP`, `SREC` | 7,586 | 13M |
| `preserve` | Fee, `Des_Tp` in `PCON`, `LCA` | 23,658 | 12M |
| `tribal` | Proclamation, `Mang_Name=TRIB` (Census AIANNH 2022) | 819 | 121M |
| `military` | Proclamation, `Mang_Name=DOD` (DoD MIRTA FY22) | 745 | 23M |

Units are dissolved by class and name, and by state as well for state parks and preserves. In the Proclamation layer, NPS outlines come from the NPS boundary file as of PAD-US 4.0, USFS from the 2024 proclamation file, and FWS from the approved boundaries. The plan's `SW` code is State Wilderness, not state wildlife areas, which are `SCA` managed by `SFW`. Those were left out of every class.

## Overlaps

Share of one class's area (inside the state) also covered by another, where at least 0.5%:

| State | Class | Within | Share |
| --- | --- | --- | --- |
| CO | wilderness | national-forest | 85% |
| CO | national-park | wilderness | 63% |
| CO | national-monument | blm | 41% |
| CO | state-park | national-forest | 35% |
| UT | national-monument | blm | 85% |
| UT | wilderness | blm | 48% |
| UT | tribal | national-forest / blm | 19% / 18% |
| UT | wildlife-refuge | tribal | 44% |
| CA | national-park | wilderness | 75% |
| CA | national-monument | blm / national-forest | 57% / 32% |
| CA | wilderness | blm | 28% |

Nesting is the rule, not the exception, so the priority order decides what a stencil looks like whenever two classes are on. State parks inside national forests are inholdings within the proclaimed outline, and the state park correctly wins.

## Crops

300 mm cut. Rocky Mountain National Park at 156 m per mm; Moab, Arches and Canyonlands at 161 m per mm. The 1 mm minimum feature is an opening by 0.5 mm. `render` uses the adopted order (park on top); the wilderness-on-top rows came from the same code with the plan's original order.

| Crop | Class | Share of crop | Parts | After 1 mm | Area lost |
| --- | --- | --- | --- | --- | --- |
| Rocky Mountain, wilderness on top | national-park | 3.0% | 178 | 42 | 16% |
| Rocky Mountain, wilderness on top | wilderness | 64.5% | 7 | 8 | 0.1% |
| Rocky Mountain, park on top | national-park | 53.3% | 2 | 3 | 0% |
| Rocky Mountain, park on top | wilderness | 14.2% | 137 | 6 | 0.2% |
| Rocky Mountain | national-forest | 22.6% | 21 | 12 | 0.1% |
| Moab | blm | 57.6% | 18 | 13 | 0% |
| Moab | national-park | 17.2% | 2 | 2 | 0% |

The Moab "checkerboard" is BLM land around state trust sections, 1.6 km squares. At this scale they are 10 mm across and come through intact. They would drop out only beyond about 1,600 m per mm, which on a 300 mm cut means a crop about 480 km wide. Wilderness on top cuts Rocky Mountain National Park into 178 slivers, mostly road corridors, and 16% of it disappears at the minimum feature. Parks on top leave both classes clean.

## Archive

One `lands` layer of dissolved units with `class`, `unit`, `name`, `manager` and `acres`. Built with the aviation builder's polygon flags: `--no-tile-size-limit`, `--no-tiny-polygon-reduction`, `--detect-shared-borders`, `--drop-rate=1`.

| Zoom | Tiles | Size | Largest tile |
| --- | --- | --- | --- |
| 4 | 25 | 2.2 MiB | 458 KiB |
| 6 | 135 | 4.1 MiB | 347 KiB |
| 8 | 1,197 | 8.0 MiB | 110 KiB |
| 10 | 14,050 | 18.1 MiB | 44 KiB |
| 12 | 159,068 | 55.7 MiB | 40 KiB |

The PMTiles file is 127 MiB, well under the plan's 500 MB target; an earlier scratch build of the same input came out at 133 MiB. Timings on a laptop: classify and dissolve 4 minutes, tile 1.5 minutes, overlaps 1.5 minutes, ownership 5.5 minutes. tippecanoe's peak memory was 2.2 GB.

Tile geometry against the source, as symmetric difference over one tile:

- Under 0.5% for every class with more than about 25 km² in the tile, at z10 and z12, over Rocky Mountain, Moab and Chincoteague.
- Small pieces reach 1–1.5% at z10: 1 km² of BLM, and Chincoteague's ragged marsh refuge.
- One 0.04 km² preserve reaches 17% at z10. Every class measured at z12 is under 0.2%; the z12 tiles sampled hold no preserve.

The low-zoom tiles are large because Alaska and the Pacific refuges are large. Crops at z4–z6 are continental, and the browser reads one zoom above the reference map, so those tiles are rarely fetched.

## Decisions after the spike

Recorded 2026-10-13:

1. **Refuges:** adopt the 25% rule. A refuge keeps its approved boundary where the Fish and Wildlife Service owns at least a quarter of it; otherwise it is the land the service owns.
2. **Tribal statistical areas:** Oklahoma's are included as reservations, named for the tribe. The Alaska Native village and other statistical areas are left out.
3. **NPS freshness:** PAD-US outlines for now. The NPS override stays a later option.
