# Public lands data

United States and Canadian national parks and monuments, national forests, wilderness, BLM land, wildlife refuges, state parks, preserves, tribal land and military installations from the USGS Protected Areas Database of the United States (PAD-US), so a model can carry a paint stencil or a boundary for each. The data covers the US and its territories and is public domain. The phased plan is [plans/public-lands.md](plans/public-lands.md); the rules below were measured in the [spike](reports/public-lands-spike-2026-10-13.md).

Boundaries are as published, not survey-grade, and some are older than the land they describe. Every surface that shows this data names the PAD-US version.

## Source

The PAD-US national geodatabase is pinned by URL and SHA-256 in [`scripts/data/public-lands-sources.json`](../scripts/data/public-lands-sources.json). The `dataset` there (`public-lands-<PAD-US date>-v<n>`) is the archive identity the Worker advertises and the provisioning script checks. PAD-US 4.1 was published on 2025-03-31; releases have come about once a year.

ScienceBase's "manager" download links return a web app, not the file. The direct link has the form `https://www.sciencebase.gov/catalog/file/get/<item id>?name=<file name>`.

## Canada

From the second archive release (`public-lands-2025-03-31-v2`), Canadian units come from the Canadian Protected and Conserved Areas Database (CPCAD), Environment and Climate Change Canada. The release dated 2025-12-31 was published on 2026-03-25 as `ProtectedConservedArea_2025.zip` (126 MiB), under the Open Government Licence – Canada.

The registration carries it under `canada`, with the pinned zip in `files.cpcad` and a `canada` coverage box tagged `source: "cpcad"`. The dataset page is open.canada.ca/data/en/dataset/6c343726-1e92-451a-876a-76e17d398a1c. Its "FGDB/GDB" resource is a JavaScript page; the file API it calls is `https://data-donnees.az.ec.gc.ca/api/file?path=<path>`, and `api/path_contents?path=<folder>` lists a folder.

Only land areas (`BIOME` `T`) are kept: marine areas lie on the sea, which a model cuts flat. `CPCAD_TYPES` in the builder maps designation types (`TYPE_E`) to classes:

| Class | CPCAD types |
| --- | --- |
| `national-park` | National Park, National Historic Site |
| `wilderness` | Wilderness Area, Wilderness Park, Wildland Provincial Park, Wilderness Reserve |
| `wildlife-refuge` | National Wildlife Area, Migratory Bird Sanctuary, Wildlife Sanctuary, Wildlife Management Area, Game Preserve |
| `state-park` | Provincial and territorial parks, BC Class A parks, conservancies, Quebec's national parks (provincial), provincial recreation areas, natural environment parks, park reserves |
| `preserve` | Ecological, conservation and biodiversity reserves; protected and natural areas; private, NGO and Indigenous-owned conservation land |

Proposed and reserved areas, pastures and habitat designations are left out. Canada has no counterpart to national forests, BLM land or military land. CPCAD's Indigenous protected areas are conservation land, not reserves, so they are preserves; First Nations reserves are not in CPCAD.

Canadian units are keyed `ca:<class>:<name>:CA-<LOC>`, because names repeat across provinces. Each carries `source: "cpcad"`, and the studio credits CPCAD only when a model used Canadian units. CPCAD is reprojected into PAD-US's CONUS Albers, an equal-area projection, so every unit is measured the same way. Archive metadata adds `cpcad_date`.

## Classes

Each class is one paint stencil. The builder reads three PAD-US feature classes. In Proclamation, every outline is coded `PROC` whatever it bounds, so manager and unit name decide the class.

| Class | PAD-US selection |
| --- | --- |
| `national-park` | Proclamation, `Mang_Name=NPS`, name without "National Monument" (parks, preserves, recreation areas, seashores, historic sites, the Appalachian Trail corridor) |
| `national-monument` | Proclamation NPS units named "National Monument"; Designation `NM` managed by BLM or USFS. FWS monuments are the Pacific marine monuments and are left out. |
| `national-forest` | Proclamation, `Mang_Name=USFS`: forests and grasslands, inholdings included |
| `wilderness` | Designation `WA`, any manager. Wilderness study areas are left out. |
| `blm` | Fee, `Mang_Name=BLM`, one unit per state |
| `wildlife-refuge` | Proclamation, `Mang_Name=FWS`, named "National Wildlife Refuge" |
| `state-park` | Fee, `Des_Tp` `SP` or `SREC` |
| `preserve` | Fee, `Des_Tp` `PCON` or `LCA`, except records named "Proposed …" |
| `tribal` | Proclamation, `Mang_Name=TRIB`: the Census AIANNH outlines PAD-US carries |
| `military` | Proclamation, `Mang_Name=DOD` (DoD MIRTA) |

The features of one unit are dissolved into one polygon. A unit is its class and name, plus the state for state parks and preserves, whose names repeat across states. Two naming rules:

- Agencies name one wilderness both "X Wilderness" and "X Wilderness Area". Both become "X Wilderness" and one unit; this merges 27 wildernesses that came as two units.
- Placeholders such as "Unknown" and "Unknown Park" are treated as no name.

Two rules change outlines:

- **Refuges.** Some approved refuge boundaries are drawn around whole regions the Fish and Wildlife Service may one day buy into. Examples: Northern Tallgrass Prairie covers 42 million acres and the service owns under 1% of it; Michigan Islands is mostly Lake Michigan. A refuge keeps its whole approved boundary where the service owns at least `refugeOwnedShare` (25%) of it. It also keeps it where the service owns none of it: an overlay refuge on another agency's land, such as Hagerman on a Corps of Engineers reservoir or Big Oaks on a former Army proving ground. Otherwise the refuge is the land the service owns inside it.
- **Tribal statistical areas.** Oklahoma Tribal Statistical Areas are kept as reservations. Most of them match reservations the courts have confirmed since *McGirt v. Oklahoma* (2020), although the Census still files them as statistical. Their names drop "Oklahoma Tribal Statistical Area", so "Cherokee Oklahoma Tribal Statistical Area" becomes "Cherokee". Alaska Native Village, Tribal Designated and State Designated Tribal Statistical Areas are not reservations and are left out.

GDAL's OpenFileGDB driver drops rows for some attribute filters on this geodatabase: `Des_Tp = 'NWR'` on Fee returns none of its 1,247 rows. The builder therefore reads every layer whole and filters in Python.

## Archive

`build-public-lands.py` writes one vector PMTiles archive, zoom 4–12, with one `lands` layer. Its properties are the contract in [`@topostack/data-contracts/land-tiles`](../packages/data-contracts/src/land-tiles.ts):

- `class`
- `unit`: unique, and joins the unit's tile pieces
- `name`, absent for BLM and unnamed units
- `manager`: the PAD-US agency code
- `acres`, measured in the source's equal-area projection

Before tiling, `check-lands-features.mjs` runs every unit through the browser's own parser and requires every class to have units.

- Units are polygons. tippecanoe cuts them at tile seams, and the browser unions a unit's pieces by `unit`. Units of different classes overlap (wilderness inside forests, monuments on BLM land); the studio decides which paints where.
- Polygons are kept at every zoom and never merged (`--drop-rate=1`, `--no-tiny-polygon-reduction`, `--detect-shared-borders`), so a small preserve is never folded into its neighbour.
- Coordinates are rounded to 6 decimals before tiling. Metadata carries `topostack_dataset`, `padus_version` and `padus_date`. tippecanoe's `name` and `generator_options` are replaced, so a rebuild from the same pin is byte-identical.

PAD-US 4.1 (`public-lands-2025-03-31-v1`) builds to 129,702,522 bytes, SHA-256 `52035d63c8d4fcb69b659bf2bded9780479396e6f5e3c785af70a0aed72b2bd3`. It holds 34,634 units:

| Class | Units |
| --- | --- |
| national-park | 346 |
| national-monument | 139 |
| national-forest | 174 |
| wilderness | 828 |
| blm | 30 |
| wildlife-refuge | 535 (90 reduced to owned land) |
| state-park | 7,585 |
| preserve | 23,654 |
| tribal | 598 |
| military | 745 |

Two builds from the same pin were byte-identical (checked before the two naming rules were added; they add no ordering or randomness). A build takes about 15 minutes on a laptop with 4.6 GB peak memory; the archive is not provisioned yet.

The second release, `public-lands-2025-03-31-v2`, adds CPCAD. It is 178,289,727 bytes, SHA-256 `7dcdc47c3d4683a0c0d4f26d1ab7ba08668b7211c1989287d47e797a4ebca810`, with 44,197 units: 34,634 from PAD-US and 9,563 from CPCAD (15,142 CPCAD features kept). By class: national-park 403, wilderness 973, wildlife-refuge 802, state-park 9,029, preserve 31,304, the rest as in `-v1`. It is not provisioned yet. It replaces a dataset a deployed Worker advertises, so stage it first and promote it with the registration change, as the FAA refresh does.

The Worker serves the archive by range at `/v1/lands.pmtiles` from the logical key `lands/current.pmtiles`. It is optional: `/ready` does not wait for it, and the studio will request it only when a project uses public lands. Once the manifest advertises a dataset, the deployment smoke test (`verify-worker-deployment.mjs`) requires the served archive's `topostack_dataset` to match it. A Worker that advertises a dataset must therefore not reach a bucket where that dataset is not provisioned.

Coverage is the list of boxes in the registration, the same boxes the FAA layer uses. Near the border a box includes foreign ground, where the archive has no features.

Outside those boxes the studio falls back to the protected areas in the OpenStreetMap basemap (`osm.pmtiles`, `landuse` layer). It maps the Protomaps kinds `national_park` to `national-park`, `nature_reserve` and `protected_area` to `preserve`, and `military` to `military`. These units have no names, so they are never labelled, and they are only as complete as OSM's mapping. Each feature's tile pieces are joined by its id. Other classes have no counterpart there and stay empty. OSM is credited on every model already. A crop where neither source has the classes asked for reports `not-covered`, a warning rather than an export block.

A project can leave single units out of its paint and boundaries (`landExclusions`, unit ids). The studio lists the 40 largest units in the area under Map features.

## Building and provisioning

1. For a new PAD-US release, download the national geodatabase zip into `.topostack/padus/`. Update `scripts/data/public-lands-sources.json`: URL, file name, bytes and SHA-256, `padusVersion`, `padusDate`, and `dataset` (`public-lands-<padusDate>-v1`; a rebuild of the same release with a changed builder takes the next `v<n>`). Check that the feature classes and codes in the [table above](#classes) still exist.
2. Build (Python 3.13 with `scripts/data-build/requirements.txt`, plus `tippecanoe` and `pmtiles` on `PATH`). The builder downloads and unpacks the pinned zip into `--cache` when it is missing:
   ```bash
   python scripts/data-build/build-public-lands.py --output .topostack/padus/public-lands.pmtiles
   ```
   Unit counts per class are printed and written to `public-lands.sources.json` beside the archive. Compare them with the previous build.
3. Verify locally, then stage. Staging is an outward write, so it needs a person's go-ahead:
   ```bash
   node scripts/provision/provision-lands-data.mjs .topostack/padus/public-lands.pmtiles --verify-only --skip-digest-check
   node scripts/provision/provision-lands-data.mjs .topostack/padus/public-lands.pmtiles --provision --promote --expected-sha256=<sha>
   ```
4. The first release has no earlier dataset, so the order is as follows:
   - Promote it in development before the Worker change that advertises it reaches `dev`.
   - Promote it in production (`--prod`) before the release that carries that Worker reaches `main`.

   A later release replaces a dataset the deployed Worker advertises. Stage it, then promote it together with the registration change, as the FAA refresh does.
