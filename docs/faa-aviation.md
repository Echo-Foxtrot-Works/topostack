# FAA aviation data

Airspace, airports, runways, navaids, special use airspace and obstacles from the FAA, so a model can carry the detail of a VFR sectional. The data is US-only and public domain. The phased plan is [plans/aviation-layer.md](plans/aviation-layer.md).

**Not for navigation.** Each FAA cycle supersedes the last, and an engraving is never updated. Every surface that shows this data states the cycle it came from.

## Sources

Every input is pinned by URL and SHA-256 in [`scripts/data/faa-aviation-sources.json`](../scripts/data/faa-aviation-sources.json). The `dataset` there (`faa-aviation-<NASR cycle>-v<n>`) is the archive identity the Worker advertises and the provisioning script checks.

| Layer | Source | Cycle | Kept |
| --- | --- | --- | --- |
| `airspace` | NASR `class_airspace_shape_files.zip` | 28 days | Class B, C and D rings, with floor and ceiling in feet where the FAA gives them. Class E is left out: its thousands of transition areas would bury a model in lines. |
| `sua` | AIS Open Data `Special_Use_Airspace` service, snapshotted | as published | Prohibited, restricted, warning, alert, MOA and danger areas |
| `runways` | NASR `APT_RWY.csv` + `APT_RWY_END.csv` | 28 days | The centerline between both surveyed ends, with width and length. The studio draws the true-width outline when it is at least three strokes wide at the model's scale. Water lanes, rooftop pads and helipads are skipped. |
| `airports` | NASR `APT_BASE.csv` + `APT_RWY.csv` + `APT_RWY_END.csv` | 28 days | Operational US airports, heliports and seaplane bases, with public/private/military use, tower status, fuel, rotating beacon, civil-military joint use, the longest hard-surfaced runway, and the runway layout of fields with a hard runway of 1,500 ft or more |
| `navaids` | NASR `NAV_BASE.csv` | 28 days | VOR, VORTAC, VOR/DME, TACAN, NDB, NDB/DME and DME. VOTs, fan markers and shut-down aids are skipped. |
| `obstacles` | Digital Obstacle File `DOF.DAT` | 56 days | US obstacles 200 ft AGL and taller (as charted), with high-intensity white strobes (lighting codes H and S), wind turbines (type `WINDMILL`) and the quantity a record stands for (column 82). Heights over 3,000 ft are data-entry errors and are dropped. |

The FAA publishes special use airspace only as a live service, so the builder reads a snapshot captured with `snapshot-survey-service.py`, which checks every page for missing or duplicate records.

NAD83 coordinates are used as WGS84. They are under 2 m apart in the conterminous US, far below engraving resolution.

## Archive

`build-faa-aviation.py` writes one vector PMTiles archive, zoom 5–12. Its layers and properties are the contract in [`@topostack/data-contracts/aviation-tiles`](../packages/data-contracts/src/aviation-tiles.ts). Before tiling, `check-aviation-features.mjs` runs every feature through the browser's own parsers, so the archive cannot carry a value the studio would drop.

- Boundaries are LineStrings, never polygons. Tile clipping then only splits lines, which the browser rejoins, and never draws an edge along a tile seam. Every ring (holes included) runs with its area on its left, so the studio knows the inside of a boundary even where the crop cuts it open.
- Each feature has a minimum zoom. Class B/C airspace, special use airspace and prominent airports appear from zoom 5–6. Class D, runways and obstacles of 1,000 ft or more appear from 7, other airports from 8 and lower obstacles from 9.
- Points are never thinned (`--drop-rate=1`); the studio budgets features instead.
- Metadata carries `topostack_dataset`, `faa_nasr_cycle`, `faa_obstacle_date` and `faa_sua_date`. tippecanoe's `name` and `generator_options` record temporary paths, so the builder replaces them and a rebuild from the same pins is byte-identical.

The 2026-09-03 cycle (`faa-aviation-2026-09-03-v2`, with the legend properties and oriented rings) builds to 35 MB (SHA-256 `7b0fc290666f319358be909ad120aee5f4df8b2f1aea7454cb1ff88e406cab82`, byte-identical across rebuilds) with 1,289 airspace rings, 1,544 special use rings, 8,472 runways, 18,811 airports, 1,523 navaids and 184,123 obstacles.

The Worker serves it by range at `/v1/aviation.pmtiles` from the logical key `aviation/current.pmtiles`. It is optional: `/ready` does not wait for it, and the studio requests it only when a project turns aviation detail on.

Coverage is a list of boxes in the source registration: the conterminous US split along the border, Alaska, Hawaii, Puerto Rico and the Virgin Islands, Guam and the Northern Marianas, and American Samoa. A crop that touches none of them reports aviation as not covered. Near the border a box can include foreign ground, where the archive simply has no features.

## Symbols

Everything is drawn after the VFR sectional legend in the FAA [Aeronautical Chart Users' Guide](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/aero_guide/) (VFR Sectional and Terminal Area Charts: Airports, Radio Aids to Navigation, Airspace, Obstruction), in one colour. `annotate/aviation-symbols.ts` holds the shapes; `aviation-provider.ts` picks one from the archive properties.

| Feature | Charted as |
| --- | --- |
| Public airport, no hard runway of 1,500 ft | Open circle |
| Hard-surfaced runway 1,500 to 8,069 ft | Filled disc with the runways knocked out (hatched fill) |
| Hard-surfaced runway over 8,069 ft | The runway layout, in outline once each strip can be three strokes wide, as centerlines at smaller symbol sizes |
| Private field without such a runway | Circle with R |
| Military field / civil-military field | Double circle |
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
| Special use airspace | Solid line hatched on the inside edge |

Where the chart uses colour alone, the engraving cannot follow. Towered airports (blue) look like the others and only take the first label places; prohibited, restricted and warning areas (blue) are hatched like alert areas and MOAs (magenta). Hatched fills are spaced a little under one stroke apart so they engrave solid, and NDB dots are kept at least 2.6 strokes apart so they stay dots.

## Refreshing for a new cycle

1. Find the new NASR cycle on the [subscription page](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) and the current file on the [DOF page](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dof/).
2. Snapshot special use airspace:
   ```bash
   python scripts/data-build/snapshot-survey-service.py --url https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0 --output .topostack/faa/sua.geojson.gz --batch-size 100
   ```
3. Download the class airspace, APT and NAV CSV zips and the DOF zip into `.topostack/faa/`. Update `scripts/data/faa-aviation-sources.json`: every URL, file name and SHA-256, the three dates, and `dataset` (`faa-aviation-<nasrCycle>-v1`).
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
6. Check a Class B city, a Class D field and a crop outside the US in the development studio, then `--promote`, and repeat with `--prod`. The Worker advertises the dataset in `scripts/data/faa-aviation-sources.json`, so deploy the registration change together with promotion.
