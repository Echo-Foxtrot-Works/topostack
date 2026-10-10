# FAA aviation data

Airspace, airports, runways, navaids, special use airspace and obstacles from the FAA, so a model can carry the detail of a VFR sectional. The data is US-only and public domain. The phased plan is [plans/aviation-layer.md](plans/aviation-layer.md).

**Not for navigation.** Each FAA cycle supersedes the last, and an engraving is never updated. Every surface that shows this data states the cycle it came from.

## Sources

Every input is pinned by URL and SHA-256 in [`scripts/data/faa-aviation-sources.json`](../scripts/data/faa-aviation-sources.json). The `dataset` there (`faa-aviation-<NASR cycle>-v<n>`) is the archive identity the Worker advertises and the provisioning script checks.

| Layer | Source | Cycle | Kept |
| --- | --- | --- | --- |
| `airspace` | NASR `class_airspace_shape_files.zip` | 28 days | Class B, C and D boundaries. An edge two areas of one class share (Class B shelves, a Class C core and its shelf) comes twice in the source, the copies up to a few metres apart; it is written once, so the laser burns it once. Class E is left out: its thousands of transition areas would bury a model in lines. |
| `airspace_labels` | the same shapefile | 28 days | Places to print each Class B, C and D area's ceiling and floor: its roomiest point (by `polylabel`), points around it and points spread over large areas, each with its distance to the area's edge. Every B and C sector is its own area; a Class D split into records shares one where pieces of one name and ceiling touch (names repeat across airports: "DENVER CLASS D" is both Rocky Mountain Metro and Centennial). |
| `sua` | AIS Open Data `Special_Use_Airspace` service, snapshotted | as published | Prohibited, restricted, warning, alert, MOA and danger areas effective below 18,000 ft (the service's `LEVEL_CODE` U records, upper altitudes only, are left out as the sectional leaves them out). The service splits an area into records wherever its floor or ceiling changes, such as an exclusion around an airport, often cutting the main record around them; the records of one name are dissolved into one outline, as charted. |
| `runways` | NASR `APT_RWY.csv` + `APT_RWY_END.csv` | 28 days | The centerline between both surveyed ends, with width and length. The studio draws the true-width outline when it is at least three strokes wide at the model's scale. Water lanes, rooftop pads and helipads are skipped. |
| `airports` | NASR `APT_BASE.csv` + `APT_RWY.csv` + `APT_RWY_END.csv` | 28 days | Operational US airports, heliports and seaplane bases, with public/private/military use, tower status, fuel, rotating beacon, civil-military joint use, the longest hard-surfaced runway, and the runway layout of fields with a hard runway of 1,500 ft or more |
| `navaids` | NASR `NAV_BASE.csv` | 28 days | VOR, VORTAC, VOR/DME, TACAN, NDB, NDB/DME and DME. VOTs, fan markers and shut-down aids are skipped. |
| `obstacles` | Digital Obstacle File `DOF.DAT` | 56 days | US obstacles 200 ft AGL and taller (as charted), with high-intensity white strobes (lighting codes H and S), wind turbines (type `WINDMILL`) and the quantity a record stands for (column 82). Heights over 3,000 ft are data-entry errors and are dropped. |
| `airspace_volumes` | the class airspace shapefile | 28 days | Every Class B, C and D sector whole, as a polygon with its floor and ceiling, for models that build airspace in acrylic ([plan](plans/airspace-acrylic.md)). Each sector has a `sector` number unique in the layer. |
| `sua_volumes` | the special use snapshot | as published | Every special use record whole, **not** dissolved: a sector or exclusion pocket (`exclusion`) keeps its own floor and ceiling. Zero-height placeholders (an `SFC` ceiling of 0) and records whose ceiling is not above their floor are left out. |

The FAA publishes special use airspace only as a live service, so the builder reads a snapshot captured with `snapshot-survey-service.py`, which checks every page for missing or duplicate records.

NAD83 coordinates are used as WGS84. They are under 2 m apart in the conterminous US, far below engraving resolution.

## Archive

`build-faa-aviation.py` writes one vector PMTiles archive, zoom 5–12. Its layers and properties are the contract in [`@topostack/data-contracts/aviation-tiles`](../packages/data-contracts/src/aviation-tiles.ts). Before tiling, `check-aviation-features.mjs` runs every feature through the browser's own parsers, so the archive cannot carry a value the studio would drop.

- Boundaries are LineStrings, never polygons. Tile clipping then only splits lines, which the browser rejoins, and never draws an edge along a tile seam. Every special use ring (holes included) runs with its area on its left, so the studio knows the inside of a boundary even where the crop cuts it open. Class B, C and D are never hatched, so their shared edges can be written once without a side.
- Each feature has a minimum zoom. Class B/C airspace, special use airspace and prominent airports appear from zoom 5–6. Class D, runways and obstacles of 1,000 ft or more appear from 7, other airports from 8 and lower obstacles from 9. Each airspace label's roomiest place appears with its area; the others from 9.
- Volumes carry each floor and ceiling with its reference, as the FAA codes it: `msl`; `sfc` (the ground); `agl`, which the sources write as `SFC` with a height (461 special use floors, 17 ceilings; no Class B, C or D sector); `fl`, a flight level kept in feet; and `unlimited`. Volumes are written at zooms 5–10 only (`AIRSPACE_VOLUME_MAX_ZOOM`), so the zoom 11 and 12 tiles engraved aviation reads stay as they were, with `--detect-shared-borders` and `--no-tiny-polygon-reduction` so neighbouring sectors keep their shared edges and a small Class D is never merged away. Neighbouring sectors are surveyed separately and their shared edges miss by up to 106 m, so the builder seals gaps under 150 m between sectors (`seal_sectors`; [why](reports/airspace-acrylic-spike-2026-10-09.md#slots-between-sectors)); otherwise every acrylic piece, a union of sectors, would carry slots. The browser unions a sector's tile pieces by its number (`domain/airspace-volumes.ts`).
- Points are never thinned (`--drop-rate=1`); the studio budgets features instead. It keeps up to 1,500 airports and navaids (more makes the load partial, which blocks export) the 2,000 tallest obstacles and the 600 roomiest airspace label places. A crop can hold ten thousand obstacles, so beyond that the shortest are left out without blocking export, as the sectional charts only selected obstacles where they crowd.
- Metadata carries `topostack_dataset`, `faa_nasr_cycle`, `faa_obstacle_date` and `faa_sua_date`. tippecanoe's `name` and `generator_options` record temporary paths, so the builder replaces them and a rebuild from the same pins is byte-identical.

The 2026-10-01 cycle (`faa-aviation-2026-10-01-v1`, with the Digital Obstacle File of 2026-09-27 and the special use airspace service as captured on 2026-10-05) builds to 35 MB (SHA-256 `677e8c2ce04630d666709a456fc586b4f4341c7e39a9bed2918ce564b2684f34`, byte-identical across rebuilds) with 1,643 airspace edges, 13,278 airspace label places, 1,179 special use rings, 8,500 runways, 18,832 airports, 1,523 navaids and 184,123 obstacles. Against the 2026-09-03 cycle (`-v3`) only runways (+28) and airports (+21) changed in the data; the obstacle file and the special use snapshot were byte-identical.

That v1 archive predates the volume layers. Rebuilt from the same source pins, the registered archive `faa-aviation-2026-10-01-v2` has 1,287 airspace volumes and 1,439 special use volumes, retaining all seven legacy layer feature counts. It is 38,297,461 bytes with SHA-256 `de3c118977ab56157675ab15a97a7803a23971d4a7ff20113124c480a6c8f793`, verified locally and in development R2 with a matching full remote checksum. Development activated the existing staged v2 object on 2026-10-10, after its deployed registration advertised v2. The public archive now exposes both volume layers, and a live Denver browser check rendered nine tier pieces on six levels. Production keeps v1 until v2 is provisioned with `--prod` for the release carrying the airspace work. [Activation receipt and browser verification](reports/data/airspace-development-activation-20261010.json). See [the acceptance report](reports/airspace-review-2026-10-09.md) and [validation procedure](airspace-validation.md).

The Worker serves it by range at `/v1/aviation.pmtiles` from the logical key `aviation/current.pmtiles`. It is optional: `/ready` does not wait for it, and the studio requests it only when a project turns aviation detail on.

Coverage is a list of boxes in the source registration: the conterminous US split along the border, Alaska, Hawaii, Puerto Rico and the Virgin Islands, Guam and the Northern Marianas, American Samoa, Midway and Wake. The boxes must meet without gaps; `aviation-tiles.test.ts` checks places where they join. A crop that touches none of them reports aviation as not covered. Near the border a box can include foreign ground, where the archive simply has no features.

## Symbols

Everything is drawn after the VFR sectional legend in the FAA [Aeronautical Chart Users' Guide](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/aero_guide/) (VFR Sectional and Terminal Area Charts: Airports, Radio Aids to Navigation, Airspace, Obstruction), in one colour. `annotate/aviation-symbols.ts` holds the shapes; `aviation-provider.ts` picks one from the archive properties.

| Feature | Charted as |
| --- | --- |
| Public airport, no hard runway of 1,500 ft | Open circle |
| Hard-surfaced runway 1,500 to 8,069 ft | Filled disc with the runways knocked out (hatched fill) |
| Hard-surfaced runway over 8,069 ft | The runway layout, in outline once each strip can be three strokes wide, as centerlines at smaller symbol sizes. Close parallel runways are pushed apart until they read as two (outlines by a stroke and a half of clear space, centerlines by two and a half strokes); where that would shrink the layout below four fifths of its size, they are drawn as one runway. The disc's knockouts are spread the same way. |
| Private field without such a runway | Circle with R |
| Military field / civil-military field | Double circle; the runway layout once a hard runway reaches 1,500 ft (the legend's military rows have no filled disc) |
| Heliport, seaplane base | Circle with H, anchor |
| Fuel available | Ticks at the four compass points (never on military fields) |
| Rotating beacon | Star above the symbol |
| VOR, VORTAC, VOR-DME, TACAN, DME | Hexagon; hexagon with solid tabs on the bottom and upper sides; hexagon in a rectangle it touches; the VORTAC silhouette alone; square |
| NDB, NDB/DME | Ringed dot inside concentric dotted rings; with a square around the dot |
| Obstacle under / at least 1,000 ft AGL | Λ over a dot; a mast flaring into two legs over a dot, standing on the position |
| Several obstacles in one record | Group symbol (two Λ, or Λ and mast) |
| Wind turbine | Mast, hub and three blades, alone or as a group |
| High-intensity lights | Rays and lightning strokes above the top |
| Class B, C, D | Heavy solid, solid, dashed |
| Class B and C altitudes | Ceiling over floor in hundreds of feet MSL with a bar between (`SFC` for the surface; `T` for a Class C ceiling up to the Class B above), inside the area |
| Class D ceiling | Hundreds of feet MSL in a dashed box, a minus for "up to but not including" |
| Special use airspace | Solid line hatched on the inside edge |

Where symbols would print over one another, the studio leaves out the optional ones, as the sectional charts only selected private fields, heliports and obstacles: every public and military field and every navaid is drawn, then private fields, heliports and obstacles (tallest first) wherever they overlap nothing already drawn. Identifiers keep clear of every drawn symbol. With identifiers on, each Class B, C and D area in view prints its altitudes once, at its roomiest place in the crop where the label fits inside the area and clear of symbols and other labels; a sector too narrow at the model's scale prints none, as the chart leaves them off. Symbols under ten aviation line widths across fill in when engraved, so generation warns (`AVIATION_SYMBOLS_FILLED`); the defaults give thirteen.

Where the chart uses colour alone, the engraving cannot follow. Towered airports (blue) look like the others and only take the first label places; prohibited, restricted and warning areas (blue) are hatched like alert areas and MOAs (magenta). Hatched fills are spaced a little under one stroke apart so they engrave solid, and NDB dots are kept at least 2.6 strokes apart so they stay dots.

## Refreshing for a new cycle

1. Find the new NASR cycle on the [subscription page](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) and the current file on the [DOF page](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dof/).
2. Snapshot special use airspace:
   ```bash
   python scripts/data-build/snapshot-survey-service.py --url https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0 --output .topostack/faa/sua.geojson.gz --batch-size 100
   ```
3. Download the class airspace, APT and NAV CSV zips and the DOF zip into `.topostack/faa/`. Update `scripts/data/faa-aviation-sources.json`: every URL, file name and SHA-256, the three dates, and `dataset` (`faa-aviation-<nasrCycle>-v1`; a rebuild of the same cycle with a changed builder takes the next `v<n>`).
4. Build (Python 3.13 with `scripts/data-build/requirements.txt`, plus `tippecanoe` and `pmtiles` on `PATH`):
   ```bash
   python scripts/data-build/build-faa-aviation.py --output .topostack/faa/faa-aviation.pmtiles
   ```
   The feature counts are printed and written to `faa-aviation.sources.json` beside the archive. Compare them with the previous cycle; a large drop means an upstream format change.
5. Verify locally, then stage in development. Staging is an outward write, so it needs a person's go-ahead:
   ```bash
   node scripts/provision/provision-aviation-data.mjs .topostack/faa/faa-aviation.pmtiles --verify-only --skip-digest-check
   node scripts/provision/provision-aviation-data.mjs .topostack/faa/faa-aviation.pmtiles --provision --expected-sha256=<sha>
   ```
6. Check a Class B city, a Class D field and a crop outside the US in the development studio, then `--promote`, and repeat with `--prod`. The Worker advertises the dataset in `scripts/data/faa-aviation-sources.json`, so deploy the registration change together with promotion. The deployment smoke test and the hourly production monitor (`verify-worker-deployment.mjs`) fail while the served archive's `topostack_dataset` differs from the dataset the Worker advertises.

For an isolated candidate build, pass `--sources <candidate.json>` to the builder. Local provisioning verification accepts `--sources=<candidate.json>` with `--verify-only`; publication always uses the committed registration.
