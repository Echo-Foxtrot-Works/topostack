# Airspace in acrylic: feasibility spike — 2026-10-09

Phase 0 of the [airspace in acrylic plan](../plans/airspace-acrylic.md). Real FAA airspace over real terrain for five crops, without product code. It settles the defaults the plan left open and finds three things the plan had wrong. An interactive mock of the three forms over Denver, Seattle and Las Vegas was published as a private artifact for review.

## Decision

The feature is feasible at regional scale, but only when the studio steers the model to a high vertical exaggeration. At the default 2× a whole Class B is 12–30 mm tall and most of its shelves merge into two or three levels. Around 10×, the current studio maximum, they separate and the model is 60–130 mm tall.

Proceed to phase 1 with these changes to the plan:

1. **Recommend an exaggeration when airspace is on.** Show the levels each exaggeration resolves. Keep the 10× maximum, and merge what still collides, labelled with its true altitudes.
2. **Default the ceiling cap to the highest Class B or C ceiling in the crop** (10,000 ft when there is none), not 18,000 ft. The capped lid still prints the true ceiling.
3. **Terrace floors given above ground.** Snap each terrace's floor up to an existing level so terraces add pieces but no levels.
4. **Read ceilings given above ground too,** and drop zero-height records.
5. **Close tile seams in the browser; shared-border detection is optional.**
6. **Seal the slivers between sectors** (found after phase 1, [below](#slots-between-sectors)): the builder closes gaps under 150 m between sectors, and core closes every piece by half the minimum feature.

## Reproduce

```sh
python scripts/data-build/airspace-acrylic-spike.py levels --exaggeration 2,5,10,20 --output levels.json
python scripts/data-build/airspace-acrylic-spike.py gaps --exaggeration 10 --output gaps.json
python scripts/data-build/airspace-acrylic-spike.py seams --crop denver --output seams.json
python scripts/data-build/airspace-acrylic-spike.py scene --crop denver --exaggeration 10 --output scene-denver.json
```

The script needs the data-build environment (Python 3.13 with `scripts/data-build/requirements.txt`), plus tippecanoe and tippecanoe-decode for `seams`. It reads the FAA files through the aviation builder's pins and its floor and ceiling reader. Terrarium tiles are cached in `.topostack/faa/terrarium/`. `scene` writes the terrain and the three forms in millimetres, which is what the 3D mock drew.

| Input | Version |
| --- | --- |
| Class airspace | NASR `class_airspace_shape_files.zip` 2026-10-01, SHA-256 `7057b1a9…` (matches the pin) |
| Special use airspace | Service snapshot taken with `snapshot-survey-service.py --batch-size 100`: 1,542 records, SHA-256 `d856b831…`, identical to the pinned snapshot |
| Terrain | Mapzen Terrarium, zoom 10, single-pixel pits clipped at the 0.01 percentile |

Crops are the bounds `plan_model` returned for 300 × 300 mm models. The stack follows `planTerrainStack`: whole sheets of 3 mm, refitted exaggeration, datum at the land minimum. The sea-level ladder snap and lake depth sheets are left out. Pieces are 3 mm acrylic; levels closer than 5 mm (acrylic plus 2 mm) merge to the lower one. [Machine-readable results](data/airspace-acrylic-spike-20261009.json) hold every run.

## Data

- **Class B, C and D have no floors above ground.** In the 2026-10-01 shapefile every B, C and D floor is `SFC` or `MSL` and every ceiling is `MSL` (B 369 sectors, C 340, D 578).
- **Special use airspace mixes four codes.** Floors are `MSL`, `SFC`, or flight levels (`STD`/`FL`, 38 records). `SFC` with a non-zero value means above ground: 461 records, mostly MOA floors such as 100, 500 or 1,500 ft. Ceilings are `MSL`, flight levels (573), `UNLTD` (154) or `SFC`. An `SFC` ceiling of 0 is a placeholder (15 records); one with a value is a ceiling above ground (17 records).
- **Tile seams are negligible.** Denver's Class B sectors went through tippecanoe as polygons and were rebuilt by unioning each sector's tile pieces. The gaps left between neighbours:

| Zoom | Flags | Gap area | Widest gap | Overlap area |
| ---: | --- | ---: | ---: | ---: |
| 7 | none | 36 mm² | 0.081 mm | 15 mm² |
| 7 | `--detect-shared-borders` | 23 mm² | 0.081 mm | 5.8 mm² |
| 9 | none | 7.8 mm² | 0.023 mm | 3.0 mm² |
| 9 | `--detect-shared-borders` | 6.7 mm² | 0.023 mm | 2.0 mm² |
| 11 | none | 2.1 mm² | 0.008 mm | 1.0 mm² |

All are spread over hundreds of slivers along shared edges, below kerf width. This test measured gaps against the union of the source sectors, so it could not see slivers the source already had; [Slots between sectors](#slots-between-sectors) covers those. Shared-border detection helps only at low zoom. Phase 1 writes the volume layers at zooms 5–10: zoom 10 edges are as good as zoom 9's, and the deeper tiles, which every engraved-aviation load reads, stay free of polygons.

## Results

Levels counts the distinct floors and ceilings in the crop, then what survives merging at each exaggeration. "Exaggeration for all" is the exaggeration at which the closest pair is 5 mm apart. Values marked "above ground" are set by floors given above ground: once flattened, those land only feet apart.

| Crop | Scale | Sectors | Raw levels | Levels 2× / 5× / 10× / 20× | Exaggeration for all | Top at 10× | Terrain at 10× |
| --- | --- | --- | ---: | --- | --- | ---: | ---: |
| Denver, 120 km | 1:400k | 14 B | 8 | 2 / 4 / 6 / 8 | 13× | 60 mm | 42 mm |
| Seattle, 100 km | 1:334k | 20 B, 11 SUA | 12 | 5 / 6 / 10 / 11 | 27× | 129 mm | 54 mm |
| Las Vegas, 140 km | 1:467k | 20 B, 7 SUA | 17 | 3 / 5 / 9 / 13 | above ground | 115 mm | 72 mm |
| Fallon, 160 km | 1:534k | 29 SUA | 26 | 3 / 6 / 9 / 13 | above ground | 84 mm | 36 mm |
| Avon Park, 100 km | 1:334k | 3 B, 20 SUA | 15 | 7 / 7 / 10 / 11 | above ground | 176 mm | 12 mm |

At 2×, Denver's Class B is 15 mm tall in total, 6 mm above the terrain. Class B shelves step by 500 ft in Denver and by 200 ft in Seattle, which needs 13× and 27× respectively to separate at 300 mm.

**Material and pieces at 10×** (B, C and special use, sectors sealed and each piece closed by half the 0.8 mm minimum feature; acrylic area before nesting). Before the slots were fixed these counts were up to half again higher, because slots split pieces apart:

| Crop | Plates | Tiers | Volumes |
| --- | --- | --- | --- |
| Denver | 6 pieces, 0.19 m² | 9 pieces, 0.10 m² | 20 sheets, 0.51 m² |
| Seattle | 22 pieces, 0.25 m² | 21 pieces, 0.10 m² | 43 sheets, 0.72 m² |
| Las Vegas | 21 pieces, 0.27 m² | 23 pieces, 0.08 m² | 38 sheets, 0.85 m² |
| Fallon | 19 pieces, 0.28 m² | 13 pieces, 0.10 m² | 27 sheets, 0.78 m² |
| Avon Park | 16 pieces, 0.30 m² | 15 pieces, 0.12 m² | 58 sheets, 1.90 m² |

A 300 × 300 mm sheet is 0.09 m², so volumes need roughly six to twenty such sheets of acrylic. Tiers need about one, plates two to three.

**Ceiling cap.** Capping at 10,000 ft, the highest Class B ceiling in those crops, brings Las Vegas from 115 to 63 mm and Avon Park from 176 to 99 mm. It also removes the near-empty levels at 17,000 and 18,000 ft.

**Floors above ground.** The plan placed such a floor at the highest ground under the area. Over Nevada that ground varies by up to 2,500 m under one MOA (Desert MOA), so the floor sits up to 53 mm too high over the valleys at 10×. Terracing so that no terrace spans more than 5 mm of ground takes 1–7 terraces per area in Fallon and 3–11 in Las Vegas. Florida needs one, since its ground varies by under 30 m.

**Terrain clearance** cuts real holes. The Denver 6,000 ft plate loses 24% of the crop to terrain, the 7,000 ft plate 7%. Seattle's lowest plates lose 10–15%. The clearance cut and crop edges leave small fragments: 0–3 pieces under 10 cm² per level in Seattle and Las Vegas.

**Supports, estimated.** Covering each piece with 150 mm discs, with at least two per piece, gives 23 columns (Denver) to 65 (Fallon) for plates, and 30 to 51 for tiers. The narrowest tier pieces have an inscribed radius of 0.8–2 mm, too thin for any rod, so a piece must be able to host a column or it is dropped.

## Slots between sectors

Found after phase 1, from the 3D mock: thin slots cut through pieces where sectors meet. The FAA surveys neighbouring sectors separately, so their shared edges miss each other, and a piece, being a union of sectors, keeps every miss as a slot the laser would cut. Measured as the widest point of each sliver between sectors of one airspace, across the whole 2026-10-01 cycle:

| Airspace | Slivers | 99th percentile | Widest |
| --- | ---: | ---: | --- |
| Class B | 3,165 | 5.5 m | 106 m (Detroit, 52 km long), 82 m (Denver), 72 m (Charlotte) |
| Special use | 474 | 2.9 m | 23 m |
| Class C | 2,305 | 0.7 m | 12 m |

On the Denver model at 10× the plain union left 1,046 slots across the plates, up to 174 mm long. The spike's own step of closing each sector before the union made it worse (4,894). A 0.05 mm close after the union still left seven, one 124 mm long.

Two rules remove them:

1. **The builder seals sectors** (`seal_sectors`): gaps narrower than 150 m between sectors are filled, first within each family (each class, each special use area) and then across all. Without the family pass, a Class D lying across the sliver between two Class B shelves hides it, and it reopens above the D's ceiling. Each sliver goes to every sector it touches, but only within 75 m of that sector, so whichever neighbours are present at a level cover it and no sector grows a tail along another's edge. A sector's own narrow inlet is left as charted. Across the cycle no outline moves more than 148 m (Class B, C, D) or 170 m (special use), and no sector loses area.
2. **Core closes every piece by half the minimum feature** after the union (0.4 mm by default). This also takes the tile seams, which the browser's union of tile pieces reintroduces at 130–550 hairlines per Class B model.

Through the real path (archive, browser loader, union, close), counting slots at every altitude:

| Crop | Scale | Unsealed archive: slots after the close | Sealed archive: slots after the close |
| --- | --- | --- | --- |
| Denver Class B, 120 km | 1:400k | 0 (202 before the close) | 0 (208 before) |
| Denver, 15 km at the widest sliver | 1:50k | 3, up to 51 mm long | 0 |
| Charlotte, 15 km at its sliver | 1:50k | 1, 65 mm long | 0 |
| Detroit, 15 km at its sliver | 1:50k | 0 | 0 |

At the scale of a whole Class B the close alone suffices, since 0.4 mm there is 160 m. On a small crop it covers only 20 m, and only the builder's seal keeps the wide slivers shut.

The holes left in pieces are real: rings inside tier shelves and gaps of a kilometre or more between airspaces (2.3 mm at Las Vegas, 3.6 mm at Fallon).

## Gaps between levels

Plates and tiers place acrylic only where a floor or ceiling changes, so tall airspace between two levels is open air. Sampled every 5 mm over each crop at 10×, the widest air gap in a column:

| Crop | Plates, median / max | Tiers, median / max |
| --- | --- | --- |
| Denver | 15 / 15 mm (10,000 → 12,000 ft) | 30 / 52 mm |
| Seattle | 18 / 36 mm | 45 / 68 mm |
| Las Vegas | 9 / 46 mm | 46 / 97 mm |

Tiers were worst because a sector starting at the surface (the Class B core over the airport) had no piece until its ceiling. The gaps stay, by decision: they are the look of those two forms, and volumes are the solid form. A surface-floored sector gets a stepped floor piece just above the terrain in tiers. `airspace-acrylic-spike.py gaps --exaggeration 10` reproduces the table.

## Defaults for phase 2

| Setting | Default | Source |
| --- | --- | --- |
| Minimum level gap | Acrylic thickness + 2 mm | Merges 0–2 Class B levels per crop at 10× |
| Ceiling cap | Highest Class B/C ceiling in the crop, else 10,000 ft | Cap results above |
| Exaggeration hint | The exaggeration that separates the Class B/C levels, up to 10× | Results table |
| Floors and ceilings above ground | Terraced; each terrace floor snapped up to an existing level, with at most 5 mm of ground per terrace | Terrace counts above |
| Minimum piece | 10 cm², and an inscribed radius of rod/2 + 2 mm; otherwise dropped with a warning | Fragment and narrow-piece counts |
| `maxSpanMm` | 150 mm for 3 mm acrylic (to confirm with the test cut) | Column estimate |
| Socket depth | max(2 sheets, 1.5 × rod size) | Not measured; see below |
| Volume layers in the archive | Polygons at zooms 5–10, sectors sealed under 150 m | Seam table, slots |
| Piece closing | Half the minimum feature (0.4 mm) after the union | Slots |
| Solid volumes warning | Over four 300 × 300 mm sheet equivalents | Material table |

## Not covered

- **Column placement was estimated, not solved.** Socket depth, the pass-through rule for the `through` joint, and stability on real pieces are still open in phase 2.
- **Labels.** It was not checked whether altitude labels fit on narrow shelves.
- **No physical cut.** Sag, the span limit and the look of frosted versus tinted acrylic need one test model before phase 3.
- **Studio fidelity.** The terrain here is a zoom-10 Terrarium grid with a simplified ladder, so studio sheet counts can differ by a sheet or two.
