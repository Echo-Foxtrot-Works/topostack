# Country-by-country map data depth, November 22, 2026

**TopoStack has usable starting data for decorative land maps across all seven regions in this sweep.** Production served complete elevation crops at 442 of 443 sites. All 282 settlement and station crops (247 primary sites and 35 regional sites) contained at least one mapped road, trail, rail line or building footprint. Six production Studio projects generated downloadable cut geometry for their selected places. Terrain quality, trails, buildings and coastal depth vary enough that the country name alone cannot promise a detailed model. Lakes are outside this assessment.

## Where the gaps matter

- **Settlement maps and backcountry maps have different limits.** 182 of the 247 primary settlement or station crops contained building polygons and 124 contained trails. At the 158 second sites chosen for their terrain, 27 had a mapped trail and 56 had no counted vector feature. A bare summit can still make a good relief. The global Protomaps archive ends at zoom 12. A coverage rectangle or a closer map zoom cannot supply missing features. [Vector archive and regional overlays](non-lake-vector-coverage.md)
- **A served elevation tile can contain bad heights.** In Port Moresby the raw crop included a pixel below −22 km. In Yamoussoukro it included a pixel below −9 km. The studio repaired the deepest values at all 17 sites with raw minima below −450 m before resampling. Local changes also remove independently confirmed residual pits in Kyiv and Yamoussoukro. Yamoussoukro retains a separate low outlier for review. The country table uses the middle 90% of raw elevations for its relief column, and the receipt retains the extrema and source filenames. [Terrain reconstruction checks](non-lake-elevation-spikes.md)
- **Mount Etna exposed a real gap.** Two zoom-14 Mapzen tiles contained only the missing-elevation value. Production repeatedly returned HTTP 502 while Rome and the vector data at Etna loaded. Using the same crop, the patched Studio stepped back from zoom 15 to four valid EU-DEM tiles at zoom 13 and exported 15 layers and 16 cut paths. The export records both zooms. [Mount Etna tile and export evidence](data/non-lake-country-etna-2026-11-22.json)
- **Fine terrain is most valuable where the difference is measurable.** At the Matterhorn the production sample was 193.6 m below the Swiss reference. At Pikes Peak it was 1.6 m above the USGS reference. Switzerland has a directly comparable national DTM. Japan’s existing GSI trial also improved summit and contour detail, with publication subject to approval. The acquisition inventory identifies 30 candidate land products or areas and their coverage and licensing checks. [Elevation comparisons and candidate products](../terrain-coverage.md)
- **Some regional data already existed but the studio could miss it.** In the Bahamas and Mexico, an empty US public-land search suppressed mapped OSM reserves. Seven US Minor Outlying Islands had PAD-US refuge polygons outside the registration. Local changes recover those reserves and refuges, expose the archived HFS airport symbol at French Frigate Shoals, and mark the three Ontario elevation pilots as development-only. The REST and MCP coverage descriptions now distinguish regional search extents from features confirmed in a crop. [Public lands](../public-lands.md) · [Terrain release status](../terrain-coverage.md)
- **Coasts need a separate assessment from inland relief.** At 159 of 205 confirmed ocean points, every production Mapzen pixel sampled in the surrounding window read exactly zero. The development GEBCO archive had a negative centre depth at 157 of those 159 points. A production rollout of the existing archive is the largest measured opportunity. Four points still need a coastline-aware treatment because the base elevation is above zero over mapped sea. [Country-by-country coastal checks](non-lake-coastal-coverage.md)

## What the country rows mean

The roster includes 249 ISO 3166-1 countries and territories plus Kosovo under the GeoNames code `XK`. Each has one named settlement, station or landmark. Another 193 have a second site, including 158 named mountains, passes or plateaus and 35 regional settlements. The 57 single-site entries retain that limitation in the table. Countries are grouped by the continent in the GeoNames register. Antarctica is represented within Web Mercator. [Pinned sites and coordinates](data/non-lake-country-sites.json) · [ISO country codes](https://www.iso.org/iso-3166-country-codes.html)

For this audit a **basic decorative map** needs finite elevation in the complete sample crop and, at a settlement, at least one road, trail, rail line or building. A flat landscape can qualify. In 219 of 250 countries and territories, the sampled sites meet those criteria and trigger none of the checks below. Their rows are labelled `basic`. A flag can describe the local geography, such as a flat atoll. This is a local presence and plausibility test. Fine trail mapping, survey-grade heights, fabrication success at untested sites and nationwide completeness each require different evidence.

- **Relief** is the 95th minus the 5th percentile of finite source pixels in the square crop, rounded to metres. `low relief` means a spread below 5 m at either site. Actual contour count also depends on cut size, material and exaggeration. `raw outlier` flags an extreme more than 300 m and more than three central spreads beyond the interval. It prompts review and can also be triggered by genuine steep terrain. `partial` means the zoom tested could not supply every tile. Relief for a partial crop describes the available pixels only. `landmark` identifies a landmark with no transportation or building requirement.
- **Road / trail / building** gives source fragment counts for the adjacent site. Roads include local and major roads. Geometry must intersect the crop. A real feature can cross tile boundaries, and a generalized footprint can combine multiple buildings. Rail, waterways, regional boundaries, ocean polygons and mapped protected areas have separate counts in the receipt. A zero is an observation at that site and zoom. Small coastal and border crops can cross water or a jurisdiction line. [Measurement script](../../scripts/verify/audit-country-data.mjs)
- **Sources** lists the unique Mapzen input families reported for the sampled land tiles at either site. Multiple families may contribute to a tile even when only one contributes to its land pixels. Native spacing depends on the input. The tile zoom and number of decoded pixels measure delivery resolution. [Mapzen source footprints and zooms](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md)

**Offshore (m)** gives the signed elevation at one sea sample near that code’s coast, from production Mapzen at z12 and then from the development GEBCO archive at z9. Negative values are depths below sea level, positive values are heights above it, `0` means sea level and `gap` a transparent cell. A country can have other coasts with different results. [Coastal sampling method](non-lake-coastal-coverage.md)

Most first sites are populated places from the GeoNames cities and country extracts. Small islands and countries near an international boundary use a named local site where appropriate. Second sites favour a named Natural Earth terrain point inside the mapped country and separated from the first site. In its absence, a regional settlement is used where available. Land crop half-widths range from 90 to 900 m. Roster coordinates, source IDs, crop bounds, dates, zooms, HTTP failures, archive ETag and tile hashes are saved alongside the results. GeoNames data is used under CC BY 4.0. Natural Earth 5.1.2 data is public domain. [GeoNames source files and licence](https://download.geonames.org/export/dump/readme.txt) · [Natural Earth release](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2) · [Land measurement receipt](data/non-lake-country-observations-2026-11-22.json)

## Production fabrication checks

All six checks used a 200 × 200 mm stacked project, 3 mm material, roads and trails enabled, and water and depth disabled. Each downloaded ZIP contained a master SVG with cut geometry and an export manifest matching the input coordinates and bounds. Bikenibeu illustrated the low-relief case on an atoll. The production studio reported elevation repairs there and in Wellington. [Export evidence](data/non-lake-country-observations-2026-11-22.json)

| Production location | Ground width | Exaggeration | Layers | Cut paths in master SVG |
| --- | ---: | ---: | ---: | ---: |
| Bogotá, Colombia | 3.70 km | 2× | 9 | 51 |
| Nairobi, Kenya | 3.70 km | 2× | 5 | 88 |
| Mount Fuji, Japan | 4.30 km | 1× | 27 | 31 |
| Bikenibeu Village, Kiribati | 0.44 km | 2× | 6 | 11 |
| Wellington, New Zealand | 2.90 km | 2× | 15 | 36 |
| Finsteraarhorn, Switzerland | 4.40 km | 1× | 25 | 46 |

## Country results

[Africa](#africa) · [Asia](#asia) · [Europe](#europe) · [North America and the Caribbean](#north-america-and-the-caribbean) · [South America](#south-america) · [Oceania](#oceania) · [Antarctica](#antarctica)

### Africa

| Country or territory | First site (relief) | Road / trail / building | Second site (relief) | Road / trail / building | Terrain sources | Offshore (m) | Sample finding |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| Algeria (DZ) | Algiers (39 m) | 100 / 1 / 3 | Mount Tahat (528 m) | 0 / 0 / 0 | EU-DEM, SRTM | 0 / -84 | basic |
| Angola (AO) | Luanda (23 m) | 91 / 0 / 4 | Mount Moco (338 m) | 0 / 0 / 0 | SRTM | 0 / -84 | basic |
| Benin (BJ) | Porto-Novo (8 m) | 96 / 2 / 0 | Atakora Mountains (28 m) | 2 / 0 / 0 | SRTM | 0 / -20 | basic |
| Botswana (BW) | Gaborone (11 m) | 50 / 3 / 4 | Monalanong Hill (281 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Burkina Faso (BF) | Ouagadougou (10 m) | 57 / 1 / 1 | Mount Tenakourou (139 m) | 1 / 0 / 0 | SRTM | inland | basic |
| Burundi (BI) | Gitega (52 m) | 65 / 0 / 0 | Mount Heha (287 m) | 2 / 0 / 0 | SRTM | inland | basic |
| Cabo Verde (CV) | Praia (57 m) | 86 / 0 / 15 | Pico do Fogo (741 m) | 0 / 0 / 0 | SRTM | 0 / -1048 | basic |
| Cameroon (CM) | Yaoundé (36 m) | 113 / 0 / 13 | Mount Oku (303 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -22 | raw outlier |
| Central African Republic (CF) | Bangui (5 m) | 23 / 0 / 0 | Bongo Massif (59 m) | 0 / 0 / 0 | GMTED, SRTM | inland | basic |
| Chad (TD) | N'Djamena (13 m) | 52 / 0 / 2 | Emi Koussi (396 m) | 0 / 0 / 0 | GMTED, SRTM | inland | basic |
| Comoros (KM) | Moroni (73 m) | 68 / 0 / 0 | Kartala (235 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -1867 | basic |
| Democratic Republic of the Congo (CD) | Kinshasa (11 m) | 39 / 0 / 2 | Kabobo Massif (220 m) | 0 / 0 / 0 | SRTM | 0 / -8 | basic |
| Djibouti (DJ) | Djibouti (10 m) | 190 / 0 / 1 | Mousa Ali (479 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -20 | basic |
| Egypt (EG) | Cairo (17 m) | 237 / 1 / 3 | Jabal Is (452 m) | 0 / 0 / 0 | EU-DEM, SRTM | 0 / -38 | basic |
| Equatorial Guinea (GQ) | Ciudad de la Paz (27 m) | 11 / 0 / 0 | Pico Basilé (408 m) | 3 / 0 / 0 | SRTM | 0 / -16 | basic |
| Eritrea (ER) | Asmara (21 m) | 134 / 0 / 0 | Ramlo (350 m) | 0 / 0 / 0 | SRTM | 0 / -24 | basic |
| Eswatini (SZ) | Mbabane (54 m) | 110 / 3 / 0 | — | — | SRTM | inland | basic |
| Ethiopia (ET) | Addis Ababa (50 m) | 93 / 0 / 3 | Ras Dashen (348 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Gabon (GA) | Libreville (18 m) | 56 / 0 / 2 | Mont Bengoué (412 m) | 0 / 0 / 0 | SRTM | 0 / -1 | basic |
| Gambia (GM) | Banjul (8 m) | 52 / 0 / 0 | Farafenni (11 m) | 63 / 1 / 0 | ETOPO1, SRTM | -6 / -3 | basic |
| Ghana (GH) | Accra (18 m) | 37 / 0 / 6 | Mount Afadja (34 m) | 2 / 0 / 0 | SRTM | 0 / -17 | basic |
| Guinea (GN) | Conakry (7 m) | 57 / 0 / 3 | Wendou Borou (49 m) | 3 / 4 / 0 | GMTED, SRTM | 0 / -3 | basic |
| Guinea-Bissau (GW) | Bissau (19 m) | 46 / 6 / 0 | Xitole (21 m) | 2 / 1 / 0 | GMTED, SRTM | -15 / -2 | basic |
| Ivory Coast (CI) | Yamoussoukro (19 m) | 55 / 0 / 1 | Gonaté (31 m) | 40 / 0 / 0 | GMTED, SRTM | 0 / -23 | raw outlier |
| Kenya (KE) | Nairobi (26 m) | 59 / 3 / 4 | Mount Kenya (493 m) | 0 / 0 / 0 | SRTM | 0 / -7 | basic |
| Lesotho (LS) | Maseru (57 m) | 47 / 0 / 9 | Qacha’s Nek (57 m) | 21 / 24 / 0 | SRTM | inland | basic |
| Liberia (LR) | Monrovia (33 m) | 17 / 0 / 2 | Mount Wuteve (108 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -30 | raw outlier |
| Libya (LY) | Tripoli (10 m) | 189 / 0 / 13 | Bikku Bitti (328 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -43 | basic |
| Madagascar (MG) | Antananarivo (103 m) | 63 / 0 / 0 | Pic Boby (401 m) | 0 / 0 / 0 | SRTM | 0 / -60 | basic |
| Malawi (MW) | Lilongwe (37 m) | 14 / 0 / 1 | Sapitwa (414 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Mali (ML) | Bamako (12 m) | 95 / 1 / 0 | Mount Hombori (722 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Mauritania (MR) | Nouakchott (6 m) | 161 / 0 / 18 | Kdeyyat ej Joul (22 m) | 0 / 0 / 0 | SRTM | 0 / -13 | basic |
| Mauritius (MU) | Port Louis (17 m) | 82 / 0 / 6 | Piton de la Petite Rivière Noire (39 m) | 5 / 3 / 0 | GMTED, SRTM | 0 / -1225 | raw outlier |
| Mayotte (YT) | Mamoudzou (27 m) | 21 / 0 / 0 | — | — | GMTED, SRTM | 0 / -8 | basic |
| Morocco (MA) | Rabat (23 m) | 91 / 4 / 15 | Jbel Toubkal (471 m) | 0 / 0 / 0 | SRTM | 0 / -47 | basic |
| Mozambique (MZ) | Maputo (19 m) | 74 / 0 / 3 | Mount Namuli (338 m) | 1 / 0 / 0 | GMTED, SRTM | 0 / -9 | basic |
| Namibia (NA) | Windhoek (33 m) | 65 / 0 / 7 | Brandberg (337 m) | 0 / 0 / 0 | SRTM | 0 / -24 | basic |
| Niger (NE) | Niamey (21 m) | 89 / 0 / 1 | Monts Bagzane (24 m) | 0 / 0 / 0 | GMTED, SRTM | inland | basic |
| Nigeria (NG) | Abuja (28 m) | 70 / 4 / 9 | Mount Dimlang (366 m) | 0 / 0 / 0 | SRTM | 0 / -10 | basic |
| Republic of the Congo (CG) | Brazzaville (11 m) | 87 / 0 / 0 | Monts de la Lékéti (138 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -19 | basic |
| Reunion (RE) | Saint-Denis (34 m) | 54 / 2 / 5 | Piton des Neiges (989 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -1367 | basic |
| Rwanda (RW) | Kigali (96 m) | 55 / 2 / 4 | Gitesi (131 m) | 3 / 0 / 0 | SRTM | inland | basic |
| Saint Helena (SH) | Jamestown (119 m) | 9 / 0 / 0 | — | — | SRTM | 0 / -1249 | basic |
| Sao Tome and Principe (ST) | São Tomé (6 m) | 23 / 0 / 1 | Pico de São Tomé (634 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -78 | basic |
| Senegal (SN) | Dakar (7 m) | 87 / 1 / 3 | Poukham Un (8 m) | 10 / 1 / 0 | SRTM | -15 / -20 | basic |
| Seychelles (SC) | Victoria (9 m) | 6 / 0 / 3 | — | — | SRTM | 0 / -30 | basic |
| Sierra Leone (SL) | Freetown (80 m) | 55 / 0 / 0 | Mount Bintumani (625 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -4 | raw outlier |
| Somalia (SO) | Mogadishu (19 m) | 95 / 0 / 1 | Saaxo (12 m) | 0 / 1 / 0 | GMTED, SRTM | 0 / -96 | basic |
| South Africa (ZA) | Pretoria (37 m) | 29 / 2 / 31 | Compassberg (412 m) | 0 / 0 / 0 | SRTM | 0 / -65 | basic |
| South Sudan (SS) | Juba (21 m) | 63 / 0 / 2 | Kinyeti (414 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Sudan (SD) | Khartoum (9 m) | 99 / 0 / 0 | Marrah Mountains (578 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -5 | basic |
| Tanzania (TZ) | Dodoma (10 m) | 67 / 1 / 2 | Mount Kilimanjaro (455 m) | 0 / 0 / 0 | SRTM | 0 / -4 | basic |
| Togo (TG) | Lomé (10 m) | 71 / 0 / 1 | Mount Agou (482 m) | 1 / 0 / 0 | GMTED, SRTM | 0 / -19 | basic |
| Tunisia (TN) | Tunis (47 m) | 83 / 89 / 3 | Jebel ech Chambi (347 m) | 1 / 1 / 0 | EU-DEM, SRTM | 0 / -8 | basic |
| Uganda (UG) | Kampala (60 m) | 72 / 0 / 8 | Kasozi (43 m) | 8 / 0 / 0 | SRTM | inland | basic |
| Western Sahara (EH) | Laayoune (9 m) | 217 / 0 / 7 | Boujdour (22 m) | 176 / 1 / 12 | EU-DEM, SRTM | 0 / -32 | basic |
| Zambia (ZM) | Lusaka (11 m) | 42 / 0 / 1 | Mount Sunzu (49 m) | 0 / 4 / 0 | SRTM | inland | basic |
| Zimbabwe (ZW) | Harare (21 m) | 39 / 3 / 7 | Mount Nyangani (162 m) | 0 / 0 / 0 | SRTM | inland | basic |

### Asia

| Country or territory | First site (relief) | Road / trail / building | Second site (relief) | Road / trail / building | Terrain sources | Offshore (m) | Sample finding |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| Afghanistan (AF) | Kabul (7 m) | 49 / 0 / 13 | Shāh Fōlādī (535 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Armenia (AM) | Yerevan (22 m) | 79 / 7 / 30 | Mount Aragats (788 m) | 0 / 0 / 0 | EU-DEM | inland | basic |
| Azerbaijan (AZ) | Baku (30 m) | 35 / 0 / 15 | Fuzuli (30 m) | 4 / 0 / 0 | GMTED, SRTM | inland | basic |
| Bahrain (BH) | Manama (8 m) | 60 / 0 / 1 | Mountain of Smoke (53 m) | 19 / 2 / 0 | SRTM | 0 / -6 | basic |
| Bangladesh (BD) | Dhaka (17 m) | 106 / 0 / 4 | Manikchari (20 m) | 3 / 0 / 0 | GMTED, SRTM | 0 / -9 | basic |
| Bhutan (BT) | Thimphu (82 m) | 76 / 0 / 4 | Phuntsholing (197 m) | 9 / 0 / 0 | SRTM | inland | basic |
| British Indian Ocean Territory (IO) | East Point Settlement (18 m) | 1 / 0 / 0 | — | — | GMTED, SRTM | 0 / -452 | raw outlier, landmark |
| Brunei (BN) | Bandar Seri Begawan (14 m) | 62 / 3 / 7 | Kuala Belait (4 m) | 81 / 1 / 1 | GMTED, SRTM | 0 / -1 | raw outlier, low relief |
| Cambodia (KH) | Phnom Penh (12 m) | 67 / 1 / 10 | Phnom Aural (453 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -6 | basic |
| China (CN) | Beijing (10 m) | 30 / 0 / 18 | Ulugh Muztagh (281 m) | 0 / 0 / 0 | SRTM | 0 / -27 | basic |
| Cocos Islands (CC) | Bantam Village (4 m) | 9 / 0 / 0 | — | — | GMTED, SRTM | 0 / -916 | low relief |
| Georgia (GE) | Tbilisi (57 m) | 75 / 0 / 6 | Khashuri (22 m) | 107 / 0 / 0 | EU-DEM, SRTM | 0 / -516 | basic |
| Hong Kong (HK) | Hong Kong (45 m) | 36 / 3 / 3 | Tai Mo Shan (475 m) | 2 / 2 / 0 | GMTED, SRTM | 0 / -4 | basic |
| India (IN) | New Delhi (15 m) | 69 / 0 / 18 | Nanda Devi (1,167 m) | 0 / 0 / 0 | SRTM | 0 / -4 | basic |
| Indonesia (ID) | Jakarta (8 m) | 48 / 0 / 4 | Puncak Jaya (418 m) | 0 / 0 / 0 | SRTM | 0 / -13 | basic |
| Iran (IR) | Tehran (21 m) | 110 / 2 / 11 | Damavand (564 m) | 0 / 0 / 0 | SRTM | 0 / -5 | basic |
| Iraq (IQ) | Baghdad (9 m) | 26 / 0 / 1 | Al-'Alam (4 m) | 35 / 2 / 0 | GMTED, SRTM | 0 / -1 | low relief |
| Israel (IL) | Tel Aviv (13 m) | 86 / 3 / 6 | Meron (377 m) | 2 / 7 / 0 | EU-DEM, SRTM | 0 / -41 | raw outlier |
| Japan (JP) | Tokyo (41 m) | 122 / 27 / 21 | Mount Fuji (600 m) | 0 / 3 / 0 | SRTM | 0 / -16 | basic |
| Jordan (JO) | Amman (85 m) | 88 / 0 / 1 | Jabal Ram (306 m) | 0 / 0 / 0 | SRTM | 0 / -815 | basic |
| Kazakhstan (KZ) | Astana (7 m) | 33 / 0 / 13 | Pik Talgar (467 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Kuwait (KW) | Kuwait City (16 m) | 58 / 0 / 14 | — | — | SRTM | 0 / -2 | basic |
| Kyrgyzstan (KG) | Bishkek (18 m) | 46 / 0 / 16 | Pik Karakol (731 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Laos (LA) | Vientiane (14 m) | 61 / 7 / 1 | Phou Bia (381 m) | 0 / 0 / 0 | GMTED, SRTM | inland | basic |
| Lebanon (LB) | Beirut (63 m) | 152 / 75 / 9 | Qurnat as Sawda' (265 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -229 | basic |
| Macao (MO) | Macau (18 m) | 34 / 7 / 1 | — | — | GMTED, SRTM | 0 / -3 | basic |
| Malaysia (MY) | Kuala Lumpur (43 m) | 41 / 2 / 7 | Mount Kinabalu (965 m) | 0 / 0 / 0 | SRTM | 0 / -8 | basic |
| Maldives (MV) | Male (3 m) | 13 / 0 / 0 | — | — | GMTED, SRTM | 0 / -9 | low relief |
| Mongolia (MN) | Ulan Bator (7 m) | 21 / 0 / 18 | Otgontenger (738 m) | 0 / 0 / 0 | GMTED, SRTM | inland | basic |
| Myanmar (MM) | Nay Pyi Taw (12 m) | 12 / 1 / 1 | Mount Victoria (352 m) | 0 / 0 / 0 | SRTM | 0 / -2 | basic |
| Nepal (NP) | Kathmandu (17 m) | 69 / 4 / 4 | Dhaulagiri (1,059 m) | 0 / 0 / 0 | SRTM | inland | basic |
| North Korea (KP) | Pyongyang (46 m) | 39 / 4 / 10 | Kosan (18 m) | 54 / 0 / 1 | GMTED, SRTM | 0 / -12 | raw outlier |
| Oman (OM) | Muscat (32 m) | 70 / 0 / 9 | Jebel Shams (897 m) | 0 / 5 / 0 | SRTM | 0 / -36 | basic |
| Pakistan (PK) | Islamabad (19 m) | 82 / 2 / 0 | Batura Sar (992 m) | 0 / 0 / 0 | SRTM | +3 / gap | basic |
| Palestinian Territory (PS) | Ramallah (43 m) | 77 / 0 / 5 | Banī Suhaylā (35 m) | 60 / 1 / 0 | EU-DEM, SRTM | 0 / -30 | basic |
| Philippines (PH) | Manila (16 m) | 103 / 4 / 9 | Mount Pulag (253 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -19 | basic |
| Qatar (QA) | Doha (13 m) | 119 / 36 / 17 | — | — | GMTED, SRTM | 0 / -2 | basic |
| Saudi Arabia (SA) | Riyadh (14 m) | 104 / 0 / 27 | Jabal Sawda (802 m) | 6 / 1 / 0 | SRTM | 0 / -3 | basic |
| Singapore (SG) | Singapore (21 m) | 18 / 11 / 7 | Bukit Timah (41 m) | 46 / 1 / 2 | GMTED, SRTM | 0 / -25 | basic |
| South Korea (KR) | Seoul (36 m) | 119 / 9 / 11 | Jirisan (426 m) | 0 / 0 / 0 | SRTM | 0 / -10 | basic |
| Sri Lanka (LK) | Colombo (17 m) | 92 / 1 / 9 | Pidurutalagala (265 m) | 5 / 0 / 0 | GMTED, SRTM | 0 / -21 | basic |
| Syria (SY) | Damascus (18 m) | 146 / 0 / 20 | Jarābulus (28 m) | 86 / 3 / 0 | EU-DEM, SRTM | 0 / -20 | basic |
| Taiwan (TW) | Taipei (15 m) | 79 / 0 / 2 | Yushan Main Peak (593 m) | 0 / 0 / 0 | SRTM | 0 / -35 | basic |
| Tajikistan (TJ) | Dushanbe (11 m) | 27 / 0 / 2 | Ismoil Somoni Peak (1,541 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Thailand (TH) | Bangkok (9 m) | 129 / 9 / 7 | Khao Luang (510 m) | 0 / 0 / 0 | GMTED, SRTM | -6 / -16 | basic |
| Turkey (TR) | Ankara (28 m) | 67 / 13 / 13 | Kaçkar Dağı (418 m) | 0 / 0 / 0 | EU-DEM | 0 / -48 | basic |
| Turkmenistan (TM) | Ashgabat (8 m) | 53 / 0 / 4 | Mount Arlan (263 m) | 0 / 0 / 0 | SRTM | inland | basic |
| United Arab Emirates (AE) | Abu Dhabi (15 m) | 79 / 0 / 10 | Ar Ruways (17 m) | 4 / 3 / 0 | SRTM | 0 / -1 | basic |
| Uzbekistan (UZ) | Tashkent (15 m) | 23 / 0 / 8 | Sho‘rchi (5 m) | 17 / 0 / 1 | SRTM | inland | basic |
| Vietnam (VN) | Hanoi (9 m) | 53 / 0 / 6 | Fansipan (699 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / gap | basic |
| Yemen (YE) | Sanaa (9 m) | 92 / 0 / 1 | Jabal an Nabi Shu'ayb (296 m) | 1 / 0 / 0 | SRTM | 0 / -4 | basic |

### Europe

| Country or territory | First site (relief) | Road / trail / building | Second site (relief) | Road / trail / building | Terrain sources | Offshore (m) | Sample finding |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| Aland Islands (AX) | Mariehamn (21 m) | 11 / 0 / 8 | — | — | ArcticDEM, EU-DEM | -69 / -52 | basic |
| Albania (AL) | Tirana (12 m) | 62 / 27 / 15 | Gjirokastër (148 m) | 65 / 7 / 0 | EU-DEM | 0 / -8 | basic |
| Andorra (AD) | Andorra la Vella (97 m) | 25 / 5 / 4 | — | — | EU-DEM | inland | basic |
| Austria (AT) | Vienna (11 m) | 79 / 67 / 55 | Grossglockner (800 m) | 0 / 0 / 0 | Austria DTM | inland | basic |
| Belarus (BY) | Minsk (26 m) | 42 / 3 / 49 | Dzyarzhynskaya Hara (33 m) | 5 / 4 / 1 | GMTED, SRTM | inland | basic |
| Belgium (BE) | Brussels (11 m) | 19 / 115 / 40 | Signal de Botrange (39 m) | 7 / 9 / 1 | EU-DEM | -9 / -8 | basic |
| Bosnia and Herzegovina (BA) | Sarajevo (30 m) | 53 / 0 / 16 | Troglav (506 m) | 0 / 11 / 0 | EU-DEM | +0.04 / gap | basic |
| Bulgaria (BG) | Sofia (18 m) | 69 / 21 / 23 | Musala (357 m) | 0 / 0 / 0 | EU-DEM | 0 / -14 | basic |
| Croatia (HR) | Zagreb (37 m) | 46 / 32 / 22 | Bjelovar (18 m) | 45 / 5 / 18 | EU-DEM | 0 / -64 | basic |
| Cyprus (CY) | Larnaca (8 m) | 118 / 0 / 0 | Mount Olympus (395 m) | 0 / 10 / 0 | EU-DEM | 0 / -84 | basic |
| Czechia (CZ) | Prague (21 m) | 83 / 39 / 48 | Vsetín (49 m) | 78 / 3 / 19 | EU-DEM | inland | basic |
| Denmark (DK) | Copenhagen (11 m) | 93 / 17 / 74 | Møllehøj (37 m) | 15 / 3 / 5 | EU-DEM, GMTED, SRTM | -6 / -4 | basic |
| Estonia (EE) | Tallinn (22 m) | 93 / 25 / 77 | Suur Munamägi (41 m) | 9 / 17 / 3 | EU-DEM, SRTM | -26 / -25 | basic |
| Faroe Islands (FO) | Tórshavn (68 m) | 32 / 1 / 3 | — | — | ArcticDEM, ETOPO1, GMTED | -18 / -32 | basic |
| Finland (FI) | Helsinki (37 m) | 89 / 86 / 94 | Koli (191 m) | 5 / 7 / 1 | ArcticDEM, EU-DEM | +22 / -13 | basic |
| France (FR) | Paris (24 m) | 84 / 32 / 28 | Monte Cinto (749 m) | 0 / 0 / 0 | EU-DEM | 0 / -7 | basic |
| Germany (DE) | Berlin (10 m) | 95 / 35 / 52 | Feldberg (296 m) | 0 / 19 / 0 | EU-DEM | -14 / -13 | basic |
| Gibraltar (GI) | Gibraltar (24 m) | 8 / 9 / 3 | — | — | EU-DEM | 0 / -284 | basic |
| Greece (GR) | Athens (34 m) | 118 / 43 / 10 | Mount Olympus (621 m) | 0 / 0 / 0 | EU-DEM | 0 / -66 | basic |
| Guernsey (GG) | Saint Peter Port (50 m) | 29 / 3 / 4 | — | — | GMTED, SRTM | 0 / -17 | basic |
| Hungary (HU) | Budapest (65 m) | 85 / 21 / 24 | Kékes (388 m) | 2 / 13 / 0 | EU-DEM | inland | basic |
| Iceland (IS) | Reykjavík (16 m) | 74 / 0 / 35 | Hvannadalshnúkur (209 m) | 0 / 0 / 0 | ArcticDEM, ETOPO1, EU-DEM, GMTED | -43 / -38 | basic |
| Ireland (IE) | Dublin (8 m) | 85 / 3 / 27 | Carrauntoohil (505 m) | 0 / 0 / 0 | EU-DEM | -10 / -7 | basic |
| Isle of Man (IM) | Douglas (23 m) | 41 / 4 / 9 | Snaefell (268 m) | 5 / 1 / 0 | ETOPO1, EU-DEM, GMTED, SRTM | -21 / -30 | basic |
| Italy (IT) | Rome (14 m) | 105 / 7 / 29 | Mount Etna (298 m) | 0 / 4 / 0 | EU-DEM, SRTM | 0 / -18 | partial |
| Jersey (JE) | Saint Helier (5 m) | 34 / 0 / 9 | — | — | EU-DEM | 0 / -13 | basic |
| Kosovo (XK) | Pristina (43 m) | 126 / 2 / 1 | Dragash (256 m) | 5 / 0 / 0 | EU-DEM | inland | basic |
| Latvia (LV) | Riga (14 m) | 54 / 47 / 33 | Rēzekne (20 m) | 41 / 4 / 21 | ETOPO1, EU-DEM, GMTED, SRTM | -20 / -19 | basic |
| Liechtenstein (LI) | Vaduz (66 m) | 18 / 6 / 3 | — | — | Austria DTM, EU-DEM | inland | basic |
| Lithuania (LT) | Vilnius (24 m) | 48 / 4 / 57 | Utena (9 m) | 49 / 0 / 13 | EU-DEM | -14 / -18 | basic |
| Luxembourg (LU) | Luxembourg (62 m) | 84 / 40 / 31 | — | — | EU-DEM | inland | basic |
| Malta (MT) | Valletta (41 m) | 21 / 8 / 3 | — | — | EU-DEM | 0 / -118 | basic |
| Moldova (MD) | Chisinau (38 m) | 57 / 2 / 22 | Bălănești Hill (130 m) | 0 / 42 / 0 | EU-DEM | inland | basic |
| Monaco (MC) | Monaco (44 m) | 21 / 0 / 0 | — | — | EU-DEM | 0 / -299 | basic |
| Montenegro (ME) | Podgorica (22 m) | 69 / 11 / 11 | Durmitor (601 m) | 0 / 0 / 0 | EU-DEM | 0 / -50 | basic |
| North Macedonia (MK) | Skopje (15 m) | 50 / 40 / 23 | Radovis (36 m) | 107 / 4 / 1 | EU-DEM | inland | basic |
| Norway (NO) | Oslo (16 m) | 69 / 39 / 116 | Galdhøpiggen (344 m) | 0 / 0 / 0 | Kartverket | +0.02 / -1 | basic |
| Poland (PL) | Warsaw (11 m) | 47 / 9 / 58 | Sandomierz (58 m) | 62 / 6 / 1 | EU-DEM | -17 / -15 | basic |
| Portugal (PT) | Lisbon (53 m) | 111 / 7 / 12 | Mount Pico (629 m) | 0 / 0 / 0 | EU-DEM | 0 / -50 | basic |
| Romania (RO) | Bucharest (15 m) | 99 / 17 / 22 | Moldoveanu Peak (661 m) | 0 / 0 / 0 | EU-DEM | 0 / -27 | basic |
| Russia (RU) | Moscow (31 m) | 50 / 15 / 36 | Mount Elbrus (556 m) | 0 / 0 / 0 | EU-DEM, GMTED, SRTM | -3 / -2 | basic |
| San Marino (SM) | San Marino (117 m) | 12 / 18 / 1 | — | — | EU-DEM | inland | basic |
| Serbia (RS) | Belgrade (37 m) | 48 / 2 / 19 | Knjazevac (47 m) | 88 / 6 / 3 | EU-DEM | inland | basic |
| Slovakia (SK) | Bratislava (50 m) | 94 / 36 / 32 | Gerlachovský štít (751 m) | 0 / 0 / 0 | Austria DTM, EU-DEM | inland | basic |
| Slovenia (SI) | Ljubljana (64 m) | 63 / 88 / 32 | Triglav (1,125 m) | 0 / 0 / 0 | EU-DEM | 0 / -22 | basic |
| Spain (ES) | Madrid (22 m) | 78 / 59 / 23 | Teide (442 m) | 0 / 0 / 0 | EU-DEM | 0 / -22 | basic |
| Svalbard and Jan Mayen (SJ) | Longyearbyen (38 m) | 42 / 2 / 130 | Newtontoppen (391 m) | 0 / 0 / 0 | ArcticDEM, ETOPO1, GMTED | -129 / -202 | basic |
| Sweden (SE) | Stockholm (22 m) | 103 / 77 / 64 | Kebnekaise (682 m) | 0 / 0 / 0 | ETOPO1, EU-DEM, GMTED, Kartverket, SRTM | -1 / -26 | basic |
| Switzerland (CH) | Bern (62 m) | 63 / 10 / 21 | Finsteraarhorn (989 m) | 0 / 0 / 0 | EU-DEM | inland | basic |
| The Netherlands (NL) | Amsterdam (7 m) | 104 / 58 / 45 | Nijverdal (4 m) | 85 / 4 / 15 | ETOPO1, EU-DEM, GMTED, SRTM | -15 / -17 | low relief |
| Ukraine (UA) | Kyiv (88 m) | 49 / 10 / 30 | Hoverla (503 m) | 0 / 0 / 0 | EU-DEM, GMTED, SRTM | 0 / -20 | raw outlier |
| United Kingdom (GB) | London (24 m) | 142 / 53 / 62 | Ben Nevis (512 m) | 0 / 0 / 0 | EU-DEM, UK lidar | -13 / -11 | basic |
| Vatican (VA) | Vatican City (15 m) | 0 / 0 / 3 | — | — | EU-DEM | inland | basic |

### North America and the Caribbean

| Country or territory | First site (relief) | Road / trail / building | Second site (relief) | Road / trail / building | Terrain sources | Offshore (m) | Sample finding |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| Anguilla (AI) | The Valley (17 m) | 10 / 0 / 0 | — | — | SRTM | 0 / -25 | basic |
| Antigua and Barbuda (AG) | Saint John’s (15 m) | 20 / 0 / 0 | Mount Obama (249 m) | 1 / 2 / 0 | GMTED, SRTM | 0 / -14 | basic |
| Aruba (AW) | Oranjestad (10 m) | 14 / 0 / 0 | — | — | GMTED, SRTM | 0 / -186 | basic |
| Bahamas (BS) | Nassau (5 m) | 81 / 0 / 0 | Freeport (7 m) | 47 / 3 / 6 | SRTM | 0 / -642 | low relief |
| Barbados (BB) | Bridgetown (8 m) | 28 / 0 / 0 | Mount Hillaby (190 m) | 19 / 2 / 0 | SRTM | -276 / -248 | basic |
| Belize (BZ) | Belmopan (16 m) | 53 / 2 / 0 | Doyle's Delight (188 m) | 0 / 0 / 0 | SRTM | -2 / -3 | basic |
| Bermuda (BM) | Hamilton (16 m) | 14 / 1 / 3 | — | — | GMTED, SRTM | 0 / -12 | basic |
| Bonaire, Saint Eustatius and Saba  (BQ) | Kralendijk (6 m) | 24 / 0 / 0 | — | — | SRTM | 0 / -297 | basic |
| British Virgin Islands (VG) | Road Town (21 m) | 15 / 0 / 0 | — | — | GMTED, SRTM | 0 / -29 | basic |
| Canada (CA) | Ottawa (8 m) | 46 / 0 / 7 | Mount Logan (485 m) | 0 / 0 / 0 | ArcticDEM, CDEM | 0 / -49 | basic |
| Cayman Islands (KY) | George Town (7 m) | 14 / 0 / 0 | — | — | SRTM | -1829 / -1180 | basic |
| Costa Rica (CR) | San José (29 m) | 51 / 2 / 9 | Cerro Chirripó (226 m) | 0 / 0 / 0 | SRTM | 0 / -35 | basic |
| Cuba (CU) | Havana (32 m) | 77 / 0 / 9 | Pico Turquino (522 m) | 0 / 0 / 0 | SRTM | 0 / -1309 | basic |
| Curacao (CW) | Willemstad (12 m) | 7 / 0 / 0 | — | — | SRTM | 0 / -640 | basic |
| Dominica (DM) | Roseau (22 m) | 32 / 0 / 0 | Morne Diablotins (508 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -1201 | basic |
| Dominican Republic (DO) | Santo Domingo (25 m) | 78 / 3 / 1 | Pico Duarte (503 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -22 | raw outlier |
| El Salvador (SV) | San Salvador (40 m) | 106 / 0 / 2 | La Unión (21 m) | 30 / 0 / 0 | ETOPO1, SRTM | 0 / -25 | basic |
| Greenland (GL) | Nuuk (56 m) | 33 / 0 / 17 | Gunnbjørn Fjeld (596 m) | 0 / 0 / 0 | ArcticDEM, ETOPO1 | +6 / gap | basic |
| Grenada (GD) | Saint George's (54 m) | 19 / 0 / 0 | Mount Saint Catherine (336 m) | 0 / 0 / 0 | SRTM | -0.01 / -575 | basic |
| Guadeloupe (GP) | Beauvallon (31 m) | 0 / 7 / 0 | — | — | SRTM | 0 / -733 | basic |
| Guatemala (GT) | Guatemala City (19 m) | 38 / 3 / 5 | Volcán Tajumulco y Tacana (622 m) | 1 / 0 / 0 | SRTM | 0 / -23 | basic |
| Haiti (HT) | Port-au-Prince (26 m) | 57 / 0 / 3 | Pic la Selle (371 m) | 0 / 0 / 0 | SRTM | 0 / -10 | basic |
| Honduras (HN) | Tegucigalpa (48 m) | 90 / 0 / 7 | Cerro Las Minas (146 m) | 0 / 0 / 0 | SRTM | -1 / -4 | basic |
| Jamaica (JM) | Kingston (22 m) | 48 / 0 / 5 | Blue Mountain Peak (468 m) | 0 / 0 / 0 | SRTM | 0 / -8 | basic |
| Martinique (MQ) | Fort-de-France (39 m) | 35 / 0 / 1 | Mount Pelée (545 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -380 | raw outlier |
| Mexico (MX) | Mexico City (9 m) | 50 / 14 / 10 | Pico de Orizaba (909 m) | 0 / 0 / 0 | SRTM | 0 / -9 | basic |
| Montserrat (MS) | Brades (43 m) | 7 / 2 / 0 | — | — | GMTED, SRTM | 0 / -663 | raw outlier |
| Nicaragua (NI) | Managua (23 m) | 73 / 0 / 0 | Jalapa (41 m) | 88 / 0 / 0 | SRTM | 0 / -18 | basic |
| Panama (PA) | Panama City (16 m) | 61 / 0 / 3 | Barú Volcano (666 m) | 1 / 0 / 0 | SRTM | -6 / -9 | basic |
| Puerto Rico (PR) | San Juan (21 m) | 22 / 0 / 11 | El Yunque (296 m) | 0 / 0 / 0 | GMTED, NED ⅓″, SRTM | 0 / -456 | raw outlier |
| Saint Barthelemy (BL) | Gustavia (18 m) | 38 / 13 / 0 | — | — | GMTED, SRTM | 0 / -45 | basic |
| Saint Kitts and Nevis (KN) | Basseterre (10 m) | 19 / 0 / 0 | Mount Misery (391 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -445 | basic |
| Saint Lucia (LC) | Castries (58 m) | 10 / 0 / 0 | Mount Gimie (437 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -1021 | basic |
| Saint Martin (MF) | Marigot (14 m) | 22 / 1 / 0 | — | — | GMTED, SRTM | 0 / -19 | basic |
| Saint Pierre and Miquelon (PM) | Saint-Pierre (41 m) | 31 / 0 / 1 | — | — | GMTED, SRTM | 0 / -78 | raw outlier |
| Saint Vincent and the Grenadines (VC) | Kingstown (10 m) | 21 / 0 / 1 | — | — | GMTED, SRTM | 0 / -877 | raw outlier |
| Sint Maarten (SX) | Philipsburg (6 m) | 26 / 1 / 0 | — | — | GMTED, SRTM | 0 / -24 | basic |
| Trinidad and Tobago (TT) | Port of Spain (14 m) | 49 / 0 / 3 | El Cerro del Aripo (464 m) | 0 / 0 / 0 | SRTM | 0 / -9 | basic |
| Turks and Caicos Islands (TC) | Cockburn Town (7 m) | 17 / 1 / 0 | — | — | GMTED, SRTM | 0 / -1511 | basic |
| U.S. Virgin Islands (VI) | Charlotte Amalie (38 m) | 32 / 2 / 0 | — | — | GMTED, NED ⅓″, SRTM | 0 / -26 | basic |
| United States (US) | Washington (15 m) | 37 / 0 / 29 | Denali (561 m) | 0 / 0 / 0 | GMTED, NED, NED ⅓″, SRTM | 0 / -20 | basic |

### South America

| Country or territory | First site (relief) | Road / trail / building | Second site (relief) | Road / trail / building | Terrain sources | Offshore (m) | Sample finding |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| Argentina (AR) | Buenos Aires (25 m) | 33 / 2 / 8 | Aconcagua (898 m) | 0 / 0 / 0 | SRTM | 0 / -15 | basic |
| Bolivia (BO) | Sucre (48 m) | 136 / 10 / 2 | Nevado Sajama (1,027 m) | 0 / 0 / 0 | SRTM | inland | basic |
| Brazil (BR) | Brasília (23 m) | 80 / 0 / 2 | Pico da Bandeira (484 m) | 0 / 0 / 0 | SRTM | -24 / -26 | basic |
| Chile (CL) | Santiago (13 m) | 31 / 5 / 8 | Aucanquilcha (760 m) | 0 / 1 / 0 | SRTM | 0 / -235 | basic |
| Colombia (CO) | Bogotá (20 m) | 75 / 1 / 2 | Nevado del Ruiz (571 m) | 0 / 0 / 0 | SRTM | 0 / -4 | basic |
| Ecuador (EC) | Quito (121 m) | 69 / 11 / 1 | Chimborazo volcano (540 m) | 0 / 0 / 0 | SRTM | 0 / -10 | basic |
| Falkland Islands (FK) | Stanley (54 m) | 28 / 2 / 1 | Mount Usborne (350 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -45 | basic |
| French Guiana (GF) | Cayenne (15 m) | 45 / 2 / 1 | Bellevue de l'Inini (203 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -4 | basic |
| Guyana (GY) | Georgetown (4 m) | 45 / 0 / 0 | New Amsterdam (6 m) | 42 / 0 / 0 | GMTED, SRTM | 0 / -2 | low relief |
| Paraguay (PY) | Asunción (34 m) | 46 / 0 / 1 | Cerro Tres Kandú (363 m) | 0 / 0 / 0 | GMTED, SRTM | inland | basic |
| Peru (PE) | Lima (18 m) | 84 / 12 / 18 | Huascarán (931 m) | 0 / 0 / 0 | SRTM | 0 / -15 | basic |
| Suriname (SR) | Paramaribo (21 m) | 11 / 1 / 0 | Julianatop (423 m) | 0 / 0 / 0 | SRTM | 0 / gap | basic |
| Uruguay (UY) | Montevideo (40 m) | 49 / 3 / 6 | Cerro Catedral (118 m) | 0 / 0 / 0 | SRTM | 0 / -28 | basic |
| Venezuela (VE) | Caracas (62 m) | 95 / 0 / 4 | Cerro La Raya (143 m) | 0 / 0 / 0 | SRTM | 0 / -101 | basic |

### Oceania

| Country or territory | First site (relief) | Road / trail / building | Second site (relief) | Road / trail / building | Terrain sources | Offshore (m) | Sample finding |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| American Samoa (AS) | Pago Pago (148 m) | 2 / 0 / 0 | — | — | NED ⅓″ | -41 / -802 | basic |
| Australia (AU) | Canberra (19 m) | 65 / 8 / 28 | Mount Kosciuszko (210 m) | 0 / 1 / 0 | GMTED, SRTM | 0 / -49 | basic |
| Christmas Island (CX) | Poon Saan (55 m) | 5 / 1 / 0 | — | — | GMTED, SRTM | 0 / -406 | basic |
| Cook Islands (CK) | Avarua (10 m) | 18 / 0 / 0 | — | — | ETOPO1, SRTM | -228 / -2092 | basic |
| Fiji (FJ) | Samambula North (40 m) | 28 / 2 / 0 | Mount Tomanivi (322 m) | 0 / 0 / 0 | SRTM | 0 / -5 | basic |
| French Polynesia (PF) | Papeete (7 m) | 92 / 5 / 9 | Mont Orohena (461 m) | 0 / 0 / 0 | ETOPO1, SRTM | -1227 / -1419 | basic |
| Guam (GU) | Hagåtña (21 m) | 11 / 2 / 0 | Mount Lamlam (180 m) | 0 / 0 / 0 | ETOPO1, GMTED, NED, NED ⅓″, SRTM | -574 / -902 | basic |
| Kiribati (KI) | Bikenibeu Village (3 m) | 3 / 0 / 0 | — | — | GMTED, SRTM | +7 / -1 | low relief |
| Marshall Islands (MH) | Laura (8 m) | 1 / 1 / 0 | — | — | GMTED, SRTM | 0 / -1906 | basic |
| Micronesia (FM) | Palikir (21 m) | 5 / 0 / 0 | Mount Nanlaud (350 m) | 0 / 0 / 0 | NED ⅓″ | 0 / -8 | basic |
| Nauru (NR) | Yaren (23 m) | 2 / 0 / 0 | — | — | GMTED, SRTM | 0 / -1935 | basic |
| New Caledonia (NC) | Nouméa (44 m) | 75 / 1 / 2 | Mount Humboldt (569 m) | 0 / 0 / 0 | SRTM | 0 / -23 | basic |
| New Zealand (NZ) | Wellington (82 m) | 69 / 16 / 22 | Aoraki / Mount Cook (867 m) | 0 / 0 / 0 | GMTED, LINZ, SRTM | 0 / -49 | basic |
| Niue (NU) | Alofi (38 m) | 5 / 1 / 0 | — | — | ETOPO1, SRTM | -716 / -1288 | raw outlier |
| Norfolk Island (NF) | Kingston (79 m) | 1 / 0 / 0 | — | — | GMTED, SRTM | 0 / -38 | basic |
| Northern Mariana Islands (MP) | Saipan (18 m) | 5 / 0 / 0 | — | — | NED ⅓″ | -35 / -288 | basic |
| Palau (PW) | Ngerulmud (39 m) | 1 / 0 / 1 | — | — | NED ⅓″ | 0 / -1500 | basic |
| Papua New Guinea (PG) | Port Moresby (96 m) | 39 / 0 / 1 | Mount Wilhelm (358 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -7 | raw outlier |
| Pitcairn (PN) | Adamstown (86 m) | 10 / 3 / 0 | — | — | GMTED, SRTM | 0 / -1320 | basic |
| Samoa (WS) | Apia (7 m) | 43 / 0 / 8 | Silisili (138 m) | 0 / 0 / 0 | ETOPO1, SRTM | -38 / -69 | basic |
| Solomon Islands (SB) | Honiara (66 m) | 29 / 1 / 2 | Mount Popomanaseu (444 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -393 | raw outlier |
| Timor Leste (TL) | Dili (6 m) | 44 / 0 / 0 | Tatamailau (442 m) | 1 / 1 / 0 | GMTED, SRTM | 0 / -764 | basic |
| Tokelau (TK) | Atafu Village (7 m) | 3 / 0 / 0 | — | — | ETOPO1, SRTM | -1513 / -723 | basic |
| Tonga (TO) | Hōfoa (9 m) | 9 / 0 / 0 | — | — | SRTM | -26 / -33 | basic |
| Tuvalu (TV) | Vaiaku Village (6 m) | 4 / 0 / 0 | — | — | GMTED, SRTM | 0 / -33 | basic |
| United States Minor Outlying Islands (UM) | Midway (12 m) | 7 / 0 / 2 | — | — | ETOPO1, SRTM | -0.26 / -4 | basic |
| Vanuatu (VU) | Port-Vila (64 m) | 27 / 1 / 1 | Mount Tabwemasana (651 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -219 | raw outlier |
| Wallis and Futuna (WF) | Mata-Utu (18 m) | 7 / 0 / 0 | — | — | ETOPO1, SRTM | +14 / -5 | basic |

### Antarctica

| Country or territory | First site (relief) | Road / trail / building | Second site (relief) | Road / trail / building | Terrain sources | Offshore (m) | Sample finding |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| Antarctica (AQ) | McMurdo Station (7 m) | 41 / 5 / 68 | — | — | GMTED | 0 / -331 | basic |
| Bouvet Island (BV) | Olav Peak (131 m) | 0 / 0 / 0 | — | — | SRTM | 0 / -78 | landmark |
| French Southern Territories (TF) | Port-aux-Français (33 m) | 16 / 22 / 0 | Mont Ross (326 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -87 | basic |
| Heard Island and McDonald Islands (HM) | Mawson Peak (235 m) | 0 / 0 / 0 | — | — | SRTM | -181 / -107 | landmark |
| South Georgia and the South Sandwich Islands (GS) | Grytviken (124 m) | 0 / 5 / 0 | Mount Paget (1,153 m) | 0 / 0 / 0 | GMTED, SRTM | 0 / -251 | raw outlier |

### Repeating a check

From the repository root with the locked npm dependencies installed, run `node scripts/verify/audit-country-data.mjs --codes CH,IT --output /tmp/topostack-ch-it.json`. Omit `--codes` for the full roster. The report compares the decoded source pixels and geometry that intersect a pinned location, so product or deployment changes can be checked against the recorded tile hashes. [Script options](../../scripts/README.md#verification-and-monitoring-verify)
