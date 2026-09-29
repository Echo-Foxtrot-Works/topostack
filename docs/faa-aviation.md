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
| `airports` | NASR `APT_BASE.csv` | 28 days | Operational US airports, heliports and seaplane bases, with public/private/military use and tower status |
| `navaids` | NASR `NAV_BASE.csv` | 28 days | VOR, VORTAC, VOR/DME, TACAN, NDB, NDB/DME and DME. VOTs, fan markers and shut-down aids are skipped. |
| `obstacles` | Digital Obstacle File `DOF.DAT` | 56 days | US obstacles 200 ft AGL and taller (as charted). Heights over 3,000 ft are data-entry errors and are dropped. |

The FAA publishes special use airspace only as a live service, so the builder reads a snapshot captured with `snapshot-survey-service.py`, which checks every page for missing or duplicate records.

NAD83 coordinates are used as WGS84. They are under 2 m apart in the conterminous US, far below engraving resolution.

## Archive

`build-faa-aviation.py` writes one vector PMTiles archive, zoom 5–12. Its layers and properties are the contract in [`@topostack/data-contracts/aviation-tiles`](../packages/data-contracts/src/aviation-tiles.ts). Before tiling, `check-aviation-features.mjs` runs every feature through the browser's own parsers, so the archive cannot carry a value the studio would drop.

- Boundaries are LineStrings, never polygons. Tile clipping then only splits lines, which the browser rejoins, and never draws an edge along a tile seam.
- Each feature has a minimum zoom. Class B/C airspace, special use airspace and prominent airports appear from zoom 5–6. Class D, runways and obstacles of 1,000 ft or more appear from 7, other airports from 8 and lower obstacles from 9.
- Points are never thinned (`--drop-rate=1`); the studio budgets features instead.
- Metadata carries `topostack_dataset`, `faa_nasr_cycle`, `faa_obstacle_date` and `faa_sua_date`. tippecanoe's `name` and `generator_options` record temporary paths, so the builder replaces them and a rebuild from the same pins is byte-identical.

The 2026-09-03 cycle builds to 34 MB (SHA-256 `6cfc0b8d89b67cc4de5cb69abae6e975da0ba3b118fd551f29460a8a4360c45c`, byte-identical across rebuilds) with 1,289 airspace rings, 1,544 special use rings, 8,472 runways, 18,811 airports, 1,523 navaids and 184,123 obstacles.

The Worker serves it by range at `/v1/aviation.pmtiles` from the logical key `aviation/current.pmtiles`. It is optional: `/ready` does not wait for it, and the studio requests it only when a project turns aviation detail on.

Coverage is a list of boxes in the source registration: the conterminous US split along the border, Alaska, Hawaii, Puerto Rico and the Virgin Islands, Guam and the Northern Marianas, and American Samoa. A crop that touches none of them reports aviation as not covered. Near the border a box can include foreign ground, where the archive simply has no features.

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
