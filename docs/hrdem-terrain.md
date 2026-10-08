# NRCan HRDEM terrain

TopoStack supports optional bare-earth terrain archives in addition to Mapzen.
The initial registration covers **[-78.97, 46.44, -78.90, 46.49]**, around the
Alexander Lake northeast of North Bay, Ontario. It is a regional pilot, not
Canada-wide coverage. A second registration, discovered from the HRDEM 1 m mosaic,
covers **[-82.57, 46.56, -82.51, 46.61]** around the western Alexander Lake
near -82.54, 46.587. These archives and an additional verified region west of the western lake are
active in the development bucket.
See [terrain selection](terrain-selection.md) for automatic ranking, provenance,
and operator-run discovery of additional regions.

At terrain zooms 10–15, valid HRDEM samples replace Mapzen pixels before the
native mosaic is resampled. Transparent pixels and absent tiles fall through to the next ranked source,
then Mapzen.
An unavailable, corrupt, or changed archive is discarded for the entire
operation and produces `TERRAIN_SOURCE_FALLBACK`; it never makes otherwise valid
base terrain synthetic or prevents an export. Cancellation still cancels the
operation. Used datasets, attribution and vertical datum travel with exports.
Outside the registered region or zoom range there is no extra archive request.

## Source and limits

- [NRCan HRDEM](https://open.canada.ca/data/en/dataset/957782bf-847c-4644-a757-e383c0057995)
- [Pinned West Nipissing STAC item](https://datacube.services.geo.ca/stac/api/collections/hrdem-lidar/items/ON-SPL_ON_West_Nipissing_UTM17_2020-1m)
- Source acquisition: 2020 Ontario lidar; nominal 1 m **DTM**, not the DSM
  containing trees and buildings. Open Government Licence – Canada.
- Heights are **CGVD2013**. No vertical-datum transformation to Mapzen's composite
  sources is performed. At coverage edges, differences between surveys/datums
  can create seams; keep the design inside coverage for the cleanest result.
- Terrain describes the ground and water surface, not underwater bathymetry.
  Existing lake surveys and depth modeling still run afterward.
- The original 1 m grid is resampled to standard 256 px Terrarium tiles through
  zoom 15 (roughly 3.3 m ground spacing here). The app's existing output-grid
  and tile budgets still apply; it does not claim 1 m exported geometry.

## Build and verify

Use the existing isolated environment from `scripts/data-build/requirements.txt`
and the PMTiles CLI. The builder reads a bounded crop of the remote COG using
HTTP ranges, checks its pinned ETag and byte count before and after reading,
and records SHA-256 hashes of the local snapshot and final archive. It refuses
to overwrite existing outputs. ETag identifies the upstream object; it is not
represented as a SHA-256 checksum of the full remote multi-GB file.

```sh
python scripts/data-build/build-hrdem-terrain.py --out-dir /tmp/topostack-hrdem
python -m unittest discover -s scripts/data-build -p 'test_hrdem_terrain.py'
pmtiles verify /tmp/topostack-hrdem/nrcan-hrdem-alexander-v1.pmtiles
```

Source registration lives in `scripts/data/terrain-sources.json`, upstream pins
in `scripts/data/hrdem-sources.json`, and verified build receipts in
`scripts/data/hrdem-builds.json`. The builder uses the same numeric PNG writer as
survey bathymetry but declares elevation encoding and vertical datum explicitly.
The snapshot and build steps live in `scripts/data-build/hrdem.py`, which
`build-hrdem-terrain.py`, `discover-terrain.py` and `benchmark-terrain.py` import.

## Provision and activate

The gateway serves `/v1/terrain-sources/nrcan-hrdem-alexander-v1.pmtiles` from
`VECTOR_DATA` through the existing bounded range and verified-release mechanism.
No new Cloudflare bindings, secrets, or required readiness dependency are needed.
The manifest describes optional registered sources, not guaranteed deployment.

After deploying the updated gateway, use the existing verified provisioning
script (now accepting terrain source IDs too):

```sh
node --env-file=.env scripts/provision/provision-lake-data.mjs \
  /tmp/topostack-hrdem/nrcan-hrdem-alexander-v1.pmtiles \
  --source=nrcan-hrdem-alexander-v1 --provision \
  --expected-sha256=<verified-archive-sha256> --promote
```

The default destination is development. `--prod` explicitly includes production.
The script verifies full remote bytes before promotion and preserves rollback
receipts. A changed archive gets a new versioned registration and build receipt;
never silently replace the meaning of an existing dataset ID. Match the source,
encoding, datum and registered extent before provisioning. Missing optional data
continues to use Mapzen with the fallback notice until provisioned.

## Add another region

Check actual HRDEM project footprints and valid raster pixels, not only the
STAC item's bounding box. Register a new versioned source with the intended
regional bounds, zoom range, license and datum; pin the selected DTM COG and run
`build-hrdem-terrain.py --source=<id> --out-dir=<new-directory>`. The builder caps
regional snapshots at 100 million samples. Overlaps use explicit quality priority, then native resolution, acquisition year
and stable ID; registration order has no effect. Verify coverage and
contours before provisioning. Keep archived source/build receipts to reproduce
and audit the output when upstream objects change.


## Atomic registry and local release checks

The canonical `scripts/data/terrain-sources.json` now contains the runtime
`sources` array together with each source's upstream pin and build receipt in
`records`. `releaseManifest` names a SHA-256-addressed immutable copy in
`scripts/data/terrain-releases/`. Registration uses an operator lock, writes the
immutable copy, then atomically replaces this one catalog snapshot. An interrupted
registration leaves either the complete previous snapshot or the complete new one.
An unused immutable copy is harmless. Commit the snapshot and referenced manifest
together. Keep earlier manifests for audit; restoring an earlier complete snapshot
also requires the corresponding application release to change runtime registration.

`hrdem-sources.json` and `hrdem-builds.json` remain legacy migration inputs for the
original three archives; new registrations do not update them. The builder reads
pins from the canonical registry. Existing source identities, upstream pins and
receipts cannot be changed by registration; changed inputs or processing require
a new versioned identity. New receipts include measured valid/total samples,
elevation range, metres/datum, normalization policy and tool versions. A valid
sample count is not a guarantee of complete coverage or a coverage polygon.

Publication requires the registered receipt to match the full archive hash and
size, source pins, encoding, datum and geographic extent. Original receipts remain
accepted for the original pinned archives. The browser checks archive bounds too;
PMTiles coordinate quantization is tolerated to 1e-6 degrees.

Verify a prepared archive locally, without credentials or upload:

```sh
node scripts/provision/provision-lake-data.mjs /path/to/archive.pmtiles \
  --source=<registered-source-id> --verify-only --expected-sha256=<receipt-sha256>
```

Use `--terrain-catalog=/path/to/terrain-sources.json` for a separately prepared
registry and its adjacent immutable manifests. `--verify-only` cannot be combined
with publication flags. The existing `--provision` / `--promote` workflow remains
explicit; local registry membership does not assert remote deployment.

See the [Canadian packaging benchmark](reports/terrain-benchmark-20260916.md) for measured
zoom comparisons and the work still required before a national build.
