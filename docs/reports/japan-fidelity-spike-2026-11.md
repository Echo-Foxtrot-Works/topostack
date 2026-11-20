# Japan data fidelity spike, 2026-11-20

Before this work, every Japanese crop used global data:
- **Land:** Mapzen Terrarium, SRTM-class, about 30 m.
- **Sea:** Mapzen's ETOPO-class ocean, about 1.8 km.
- **Lakes:** basins modelled from GLOBathy maximum depths.
- **Rail:** none.

This report measures what Japanese and global open data would add, and records the
licence constraints. Its measurements come from
`scripts/data-build/japan-fidelity-spike.py`, and the JSON outputs are reproducible
from its `terrain`, `ocean` and `extent` commands. The plan it supports is #300–#304
and the GEBCO PR.

## Terrain: GSI 5 m against Mapzen

Each site is a 6 × 6 window of z15 tiles, about 5.6 km square. GSI tiles merge
dem5a, then dem5b, then dem5c per pixel.

| Site | 5 m coverage | GSI − Mapzen RMSE | p95 \|Δ\| | Highest point, GSI / Mapzen | Detail (Laplacian σ), GSI / Mapzen |
| --- | --- | --- | --- | --- | --- |
| Fuji summit | 100% | 8.5 m | 16.9 m | 3,774.5 / 3,760.4 m (surveyed 3,776 m) | 1.00 / 0.28 (×3.6) |
| Hakone (Lake Ashi) | 92.5% (the lake is no data) | 24.2 m | 21.9 m | 1,437.6 / 1,428.7 m | 0.88 / 56.3 (Mapzen artefacts) |
| Kamikochi (Hotaka) | 99.9% | 20.6 m | 42.7 m | 3,189.0 / 3,183.9 m (Okuhotaka 3,190 m) | 2.46 / 0.55 (×4.5) |

Findings:

- **Detail:** GSI's 5 m model carries 3.6–4.5 times Mapzen's local terrain detail, and its summits match surveyed heights. At a 10 m contour interval it crosses 8% more contour edges at Fuji and 27% more at Kamikochi.
- **Mapzen artefacts:** Mapzen has 649 junk pixels near −4,286 m at Hakone, beside Lake Ashi. GSI removes them.
- **No data over water:** GSI leaves lakes and the sea as no data, so the base terrain shows through. At Lake Ashi, Mapzen's 720 m fill sits within 4 m of the lake's surface.
- **Laser data (dem5a):** dem5a covered every sample at all three sites; dem5b and dem5c were never needed there. dem1a reaches 90–100% coverage but adds little at the z15 cap, so it is not used.
- **Tile size:** rounding to 0.1 m shrinks GSI tiles by 32–38%, from 96–114 KB to 61–78 KB, which is below Mapzen's own tile size. Measured on the real Fuji trial archive (#303), the full 5 m set comes to about 35–40 GB.
- **Height datum:** GSI's April 2025 revision (JGD2024, ジオイド2024) changed heights by at most +57 / −67 cm. That is below the resolution of a 5 m model and of any cut layer, so one `JP-TP` datum label covers both generations.

## Ocean: GEBCO_2026 against Mapzen

GEBCO_2026 (15″, about 460 m) was released in April 2026. It is served from CEDA as a
4.24 GB GeoTIFF zip and a 96 MB type identifier (TID) zip.

Each box below was resampled to Web Mercator tiles at z9 (about 250 m a pixel) and at
z11, the zoom a 30–60 km model loads. Sea pixels are those where both sources are
below 0 m.

| Box | Zoom | Deepest, GEBCO / Mapzen | Detail (Laplacian σ), GEBCO / Mapzen | Sign disagreement | RMSE over shared sea |
| --- | --- | --- | --- | --- | --- |
| Japan Trench (142.4–144.8°E, 37.4–39.6°N) | z9 | −7,808 / −7,832 m | 15.2 / 3.0 (×5.1) | 32% | 47 m |
| Japan Trench | z11 | −7,808 / **−2,989 m** | 0.71 / 0.13 (×5.3) | **79%** | 31 m |
| Suruga Bay | z9 | −2,655 / −3,101 m | 30.5 / 8.5 (×3.6) | 31% | 56 m |
| Suruga Bay | z11 | −2,655 / −1,555 m | 3.3 / 2.3 | 38% | 66 m |
| Sagami Bay | z9 | −1,717 / −2,843 m | 28.5 / 9.4 (×3.0) | 52% | 50 m |
| Sagami Bay | z11 | −1,718 / −1,629 m | 3.2 / 10.7 | 43% | 51 m |

"Sign disagreement" is the share of pixels where exactly one source is below sea level.

Findings:

- **Flat sea at closer zooms:** at z11 most of Mapzen's open sea is flat at 0 m. In the trench box, 79% of pixels disagree on whether they are below sea level at all, and Mapzen's deepest sample is under 3,000 m. That is why the coverage note used to say the open sea is flat. GEBCO's rule of replacing only pixels the base terrain puts at or below 0 m covers these flat seas (#302).
- **Detail at z9:** at z9 the two sources agree on the deepest point within 25 m, but GEBCO carries 3–5 times Mapzen's detail. Mapzen's 2,843–3,101 m maxima in the two bays are single-pixel artefacts that GEBCO does not have.
- **Sagami Bay at z11:** Mapzen's higher local detail there comes from its terraced coastal artefacts, not real relief. GEBCO crosses about 6 times as many 100 m contour edges there (166 against 28).
- **Shallows:** over 0–50 m shallows the two agree to about 13 m RMSE at z9. Because GEBCO feathers into the base terrain over one cell, no step forms at the coast.
- **Tile size:** rounding to whole metres shrinks ocean tiles from 116 KB to 39 KB. The Japan box's 1,898 z9 ocean tiles average 39 KB; open ocean compresses better, so the global archive should be at most about 11 GB.

Extent of the global ocean archive, measured from the TID grid:

| Zoom | Tiles with ocean |
| --- | --- |
| 9 | 215,497 |
| 8 | 54,978 |
| 7 | 14,128 |
| 0–6 | 4,971 |
| Total, z0–9 | 289,574 |

Zoom 9 is the finest level worth storing. A z9 pixel is about 250 m at 35°N,
already finer than the grid, and the studio upsamples z9 for closer views (#302).

## Lakes

GSI's 湖沼データ list has 57 lakes with downloadable ZIPs, most surveyed from 2016 to
2025. Each ZIP holds a 10 m depth grid in its JGD2011 plane rectangular zone:
positive metres below the surveyed water level, with −9999 off the water. At
Ashinoko 2021 the grid's deepest cell is 40.6 m, against a charted maximum of
about 43 m. The lakes include:
- all of the Fuji Five Lakes, Ashinoko, Mashū and Tazawa;
- Inawashiro 2024, Kussharo 2024 and Akan 2025;
- Chūzenji, Suwa, Shinji, Nakaumi and Kasumigaura.

Towada, Shikotsu, Tōya and Biwa have only 1960s–70s paper charts. GSI began a
multibeam resurvey of Biwa's south basin in 2026, but its data is not released yet.

## Rail and labels

Rail on the pinned Protomaps basemap, from a central Tokyo z12 tile:
- **Kinds:** at the archive's z12 cap only `kind_detail: rail` remains, 48 features. Subways and trams thin out at lower zooms.
- **Names:** every rail feature carries `name:en`, for example 東海道本線 / "Tokaido Main Line". A `script` key (`Han`) marks names that are not in Latin script.
- **Labels:** the engraving fonts draw only Latin and Cyrillic, so labels fall back to the romanized name (#300).

## Licences

| Data | Terms | Decision |
| --- | --- | --- |
| GSI elevation tiles (地理院タイル 標高タイル) | Loading them live from GSI's servers needs attribution only (Q1-12). Copying them into our archives is reproduction under the Survey Act (測量法 Art. 29), which needs GSI's approval (Q1-16 and Q1-17); GSI grants it free for 基盤地図情報 (Q&A section 5). A processed general-purpose database may count as Art. 30 use instead (Q2-6). | Build locally only. Promote after approval. |
| GSI 湖沼データ | A basic survey result, so the same approval applies. | Same as the terrain. |
| GEBCO_2026 | Public domain with attribution, not for navigation. | Ship worldwide. |
| JODC J-EGG500 | All rights reserved. It is also no finer than GEBCO. | Not used. |
| JHA M7000 | Paid; its public-release rules are still being drafted (November 2025). | Not used. |
| 海しる (MSIL) | No reuse terms found. | Not used. |
| KSJ N02 railways | CC BY 4.0. Its geometry is generalized, coarser than OSM's. | Possible later. |
| ODPT / GTFS-JP | Terms vary per feed, and its route shapes are no better than OSM's. | Not used. |
| AW3D30 | A 30 m surface model (it includes buildings and trees). | Not used. |

**dev.topostack.app is public.** Provisioning GSI data to the dev bucket would already
be distribution, so GSI archives stay on the build machine until GSI approves.

## Draft application to GSI (測量成果の複製承認申請)

To be filed by the operator through GSI's online application
(https://www.gsi.go.jp/LAW/2930-index.html). Bracketed items are the applicant's details.

> **件名**：測量法第29条に基づく測量成果の複製承認申請（ウェブサービスでの加工データ配信）
>
> **申請者**：【氏名／事業者名、住所、連絡先】
>
> **利用する測量成果**
> 1. 地理院タイル（標高タイル）：DEM5A・DEM5B・DEM5C（dem5a_png／dem5b_png／dem5c_png）および DEM10B（dem_png）
> 2. 湖沼データ（水深グリッド）：国土地理院ウェブサイト「湖沼データ」で提供されている各湖沼の水深グリッド（約57湖沼）
>
> **複製の目的**
> レーザー加工機で製作する立体地形模型（積層模型）および地形彫刻の設計データを、利用者がウェブブラウザ上で作成するためのサービス「TopoStack」において、地形・湖底の標高データとして利用するため。
>
> **複製・加工の方法**
> - 上記標高タイルを取得し、DEM5A→5B→5Cの順に画素単位で統合、0.1 m単位に丸め、ズームレベル10〜15（DEM10Bは8〜13）のタイルに再編成した上で、当方のサーバ（Cloudflare R2）にPMTiles形式で格納します。
> - 湖沼データの水深グリッドは、Webメルカトル図法へ再投影し、水深（m）のタイルとして格納します。
> - 格納したデータは利用者のブラウザで読み込まれ、等高線（等深線）の切断線・彫刻線と積層形状の計算にのみ用いられます。地理院地図の背景地図等、他の測量成果との重ね合わせは行いません。
>
> **成果物と公開方法**
> - インターネット上のウェブサービス（https://topostack.app）を通じ、不特定多数の利用者が上記加工データから自身の模型設計データ（SVGファイル）を生成します。
> - 加工した標高タイルそのものをダウンロード提供することはありません（ブラウザからの範囲読み込みのみ）。
>
> **出典の明示**
> サービス内の出典ページおよび出力ファイルに「地理院タイル（標高タイル）を加工して作成」「国土地理院 湖沼データを加工して作成」と承認番号を記載し、国土地理院が作成したかのような表示は行いません。
>
> **期間**：承認日から【5年】（データ更新時は再申請します）
>
> **確認事項**
> 加工データを多数の派生成果の作成に用いるため、本件が第30条の使用承認（汎用地図データベース、Q&A Q2-6）に該当する場合は、その旨ご教示ください。

## Reproduce

```bash
uv run --python 3.13 scripts/data-build/japan-fidelity-spike.py terrain --cache .topostack/japan/spike
uv run --python 3.13 scripts/data-build/japan-fidelity-spike.py extent --cache .topostack/japan/spike
uv run --python 3.13 scripts/data-build/japan-fidelity-spike.py ocean --cache .topostack/japan/spike
```

GSI requests are throttled to five a second and cached. CEDA's TLS handshakes
sometimes take close to a minute, and macOS curl (LibreSSL) cannot complete them; the
script's Python HTTP client retries.
