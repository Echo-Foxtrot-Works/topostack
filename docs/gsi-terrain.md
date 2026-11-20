# GSI terrain for Japan

Japan's 5 m and 10 m bare-earth elevation comes from the Geospatial Information
Authority of Japan (GSI, 国土地理院) elevation tiles. Measured against Mapzen at
Fuji, Hakone and Kamikochi, the 5 m tiles carry 3.6–4.5 times the terrain detail.
They also remove Mapzen's −4,286 m holes at Hakone
(see the Japan fidelity spike report in `docs/reports/`).

## Licence: development only until GSI approves

| Use | What it needs | Where in GSI's Q&A |
| --- | --- | --- |
| Loading GSI's tiles live from GSI's servers | Attribution only | Q1-12 |
| Copying the tiles into our own archives | Reproduction under the Survey Act (測量法 Art. 29), which needs GSI's approval | Q1-16, Q1-17 |

GSI grants the reproduction approval free of charge for 基盤地図情報 (Q&A section 5).

Our archives are also built for many derived products. GSI may therefore treat
them as a 汎用地図データベース under Art. 30 (Q2-6). The application asks GSI
which article applies.

Until the approval number exists, every source built here is registered as:

```json
"availability": "development", "approval": { "required": true }
```

[Sources awaiting approval](terrain-selection.md#sources-awaiting-approval)
describes the gate this sets.

dev.topostack.app is publicly reachable, so serving an archive there is already
distribution. Build and check GSI archives locally, and provision them to no
bucket until the approval is recorded.

Promotion is a single change:
1. Add the approval number as `approval.reference`.
2. Add 「承認番号 …」 to `license`.
3. Set availability to `all`.
4. Provision with `--prod`.

The attribution follows GSI's example for processed data: 「地理院タイル（標高タイル）を加工して作成」.
Derived output must never look as if GSI made it.

## Archives

| Source | Zooms | Priority | Content |
| --- | --- | --- | --- |
| `gsi-dem5-<shard>-v1` | 10–15 | 250 | dem5a, then dem5b, then dem5c per pixel (5 m) |
| `gsi-dem10-japan-v1` | 8–13 | 200 | dem_png (DEM10B, 10 m). It fills 5 m gaps through parent-tile sampling. |

There are eight shards: `hokkaido`, `tohoku`, `kanto` (with the Izu islands), `chubu`,
`kinki`, `chugoku-shikoku`, `kyushu` and `southern-islands` (Nansei and Ogasawara).
- Each z15 tile belongs to exactly one shard, chosen by the centre of its z8 ancestor (`gsi.shard_of`), so no bytes are duplicated.
- The shards are not prefecture-exact. Kitakyūshū, for example, falls in `chugoku-shikoku`.
- Heights are T.P. (`JP-TP`). The April 2025 JGD2024 revision moved them by at most +57/−67 cm, which is immaterial at this scale.

Lakes and the sea are no data in every GSI product, so the base terrain shows
through them. Lake surfaces then come from Mapzen, which sits within a few metres
of GSI at Lake Ashi.

## Build

```bash
REQ="uv run --no-project --python 3.13 --with-requirements scripts/data-build/requirements.txt python"
# Fetch: resumable; rerun the same command to continue after an interruption.
$REQ scripts/data-build/build-gsi-terrain.py fetch --cache .topostack/gsi/cache.sqlite --shard kanto --rate 8
# Build each shard, then the national 10 m archive, from the same cache.
$REQ scripts/data-build/build-gsi-terrain.py shard --cache .topostack/gsi/cache.sqlite --shard kanto --out-dir .topostack/gsi/kanto-1
$REQ scripts/data-build/build-gsi-terrain.py national --cache .topostack/gsi/cache.sqlite --out-dir .topostack/gsi/national-1
```

### Fetching
- **Walk:** `fetch` walks the 10 m `dem_png` tiles from z8 through z11 to z13, and descends only where there is land. It then merges each z15 tile.
- **Gap fills:** it requests dem5b or dem5c only where dem5a leaves a gap that the 10 m model fills. Sea and lake gaps cost no extra request.
  - A Fuji trial (138.68–138.78°E, 35.32–35.40°N) took 125 requests for 110 z15 tiles.
- **Rate:** requests are capped at 10 a second (default 8), with retries and backoff.
- **Duration:** all of Japan is roughly 500,000 requests, about 17 hours at 8 a second. Run it shard by shard. `--bounds` fetches only a trial area.
- **Cache:** the cache stores merged heights (float32) and every request's product, tile, ETag and size, but no raw PNGs. Expect about 25 GB for all of Japan.

### Output
- **Archive:** each archive's pin is the SHA-256 of its own request manifest (`etag: "sha256:…"`, `snapshotSha256`), plus the SHA-256 of its z15 or z13 samples (`samplesSha256`).
- **Precision:** heights are rounded to 0.1 m, which shrinks tiles by about 40%.
- **Size:** the Fuji trial shard averaged 60 KB a tile, so all of Japan's 5 m shards come to roughly 35–40 GB.
- **Files:** `build-gsi-terrain.py shard|national` writes the archive, its receipt (`.sources.json`) and the `source.json` entry to register.
- **Registration:** registering it in `scripts/data/terrain-sources.json` makes the dev deploy expect the archive in the dev bucket. Register it in the same PR that provisions it, after approval.
