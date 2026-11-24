# Coastal terrain coverage across 205 countries and territories

On November 23, 2026 UTC, production returned a terrain tile at every one of **205 coastal test points**. At **159 points**, every sampled production pixel was exactly sea level. The development GEBCO archive supplied a negative depth at **157 of those 159 points**. The remaining 45 jurisdictions in the 250-code roster are landlocked or face only inland waters. [All 250 codes, coordinates, source filenames, tile hashes and values](data/non-lake-coastal-coverage.json) · [Land sample roster](data/non-lake-country-sites.json)

| Region of jurisdiction | Coastal samples | Production window flat at 0 m | Production centre below 0 m | Production centre above 0 m | GEBCO centre below 0 m |
| --- | ---: | ---: | ---: | ---: | ---: |
| Africa | 42 | 39 | 3 | 0 | 42 |
| Asia | 39 | 37 | 1 | 1 | 37 |
| Europe | 38 | 18 | 17 | 3 | 37 |
| North America and Caribbean | 41 | 34 | 6 | 1 | 40 |
| South America | 12 | 11 | 1 | 0 | 11 |
| Oceania | 28 | 16 | 10 | 2 | 28 |
| Antarctic region | 5 | 4 | 1 | 0 | 5 |
| **Total** | **205** | **159** | **39** | **7** | **200** |

## Where the two products differ

| Jurisdiction | Production z12 (m) | GEBCO z9 (m) | Location in the sample |
| --- | ---: | ---: | --- |
| Cuba (CU) | 0.0 | -1,309 | Off Havana |
| Nauru (NR) | 0.0 | -1,935 | Off Nauru |
| Monaco (MC) | 0.0 | -299 | Off Monaco |
| Nigeria (NG) | 0.0 | -10 | Gulf of Guinea |
| Brazil (BR) | -24.0 | -26 | Off Rio de Janeiro |
| New Zealand (NZ) | 0.0 | -49 | Near Wellington |

The largest readily usable improvement is at the 157 flat production points with a GEBCO depth. Production advertised no GEBCO route at the time of the audit. Its bucket already held the versioned archive. A separate issue affects positive production terrain over mapped sea. At 4 sites (FI, KI, NO, WF), the local GEBCO pixel has a negative depth but the positive base pixel fails the current ocean overlay gate. These sites merit a coastline-mask test before treating the GEBCO build as sufficient. The GEBCO centre was transparent at BA, GL, PK, SR, VN. A transparent sample records a coverage gap at that pixel. [Terrain source selection](../terrain-selection.md) · [Release and archive checks](../terrain-coverage.md)

## Method and limits

- **Coast selection.** We used the country/territory roster and Natural Earth 1:10 million map units, coastline and ocean polygons. Inland and Caspian-only countries were excluded. Minor Outlying Islands were grouped under UM, and Svalbard and Jan Mayen under SJ. Starting near a settlement or a named coastal area, we searched around shore vertices shared by the coastline and the map unit. We kept points inside the ocean polygon whose nearest matched shoreline belonged to that unit. The recorded clearance is approximate distance to the densified cartographic coastline. Selected points span 0.71–7.00 km. Bays, straits and marine estuaries are included. Jurisdiction labels identify adjacent land and carry no maritime-boundary interpretation. [Map units](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-details/) · [Ocean](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-ocean/) · [Coastline](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-coastline/)
- **Second coastline check.** The production z12 Protomaps water layer had to contain the point inside a polygon of kind `ocean`, accounting for holes. For 4 initial points (BQ, GA, GL, IQ), the two maps disagreed. We selected another nearby ocean point using the outline alone. Elevation played no part in this choice. This avoids counting a small island as sea when the coarser coastline omits it. The evidence file pins the Protomaps archive ETag and the Natural Earth source hashes.
- **Production.** Request the recorded tile path under `https://topostack.app/v1/terrain/` with a `.png` suffix. Read the pixel containing the coordinate at z12, decode metres as `256 × R + G + B / 256 − 32768`, and record the valid minimum and maximum of its surrounding 9 × 9 pixels, clipped at the tile edge. The evidence includes the source header and PNG SHA-256. Uniform zero is a fabrication-scale gap in this sampled window. An available negative sample can still be interpolated or coarse.
- **Development.** Read the z9 pixel at the same coordinate in `gebco-2026-ocean-v1`. We hashed the entire 6,059,356,841-byte local archive against the dev release receipt and verified eight complete z9 PNG payloads by byte range on the public dev gateway. Those eight SHA-256 matches span AE, AQ, BA, BR, CA, JP, NZ, ZA. Remaining GEBCO samples come from that same hash-verified file. All heights are elevations in metres and GEBCO's valid samples are rounded to whole metres. A centre-pixel comparison precedes the studio's finer-zoom interpolation and coastline fitting. [Archive processing](../ocean-bathymetry.md) · [GEBCO grid](https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid)
- **Interpretation.** Each jurisdiction contributes one location. The counts describe these locations. Estimating a national coverage fraction or survey accuracy requires a different sampling design and independent measurements. The GEBCO grid mixes surveys and estimates. Its Type Identifier layer and regional hydrographic surveys are needed when selecting a higher-resolution coastal pilot. [GEBCO coverage and errata](https://www.gebco.net/data-products/gridded-bathymetry-data/data-set-errata)
