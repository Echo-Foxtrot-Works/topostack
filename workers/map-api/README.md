# TopoStack map API

The Worker is deliberately a streaming data gateway, not a GIS compute service. Terrain-to-contour processing stays in the portable browser engine. It also answers agent requests (validating a project, estimating its sheets from a coarse terrain sample, minting a studio link), for which it imports only `@topostack/core/project`; an ESLint rule and `npm run budget:worker` keep the contour engine out of its bundle.

## Provision Cloudflare resources

```bash
npx wrangler r2 bucket create topostack-map-cache-development
npx wrangler r2 bucket create topostack-vector-data-development
npx wrangler r2 bucket create topostack-map-cache
npx wrangler r2 bucket create topostack-vector-data
```

TopoStack pins the Protomaps `20260905` basemap build (`4.15.2`) and extracts a global zoom 0–12 archive so local roads and trails are available. The upstream archive's published BLAKE3 digest is `f5d3c4040d21a2a135883dc534158f3dd19b7253f8a80e0964c98b779ed8042f`. Build and verify the archive with PMTiles CLI `1.31.2` or newer:

The current zoom-12 extraction is 17,562,176,068 bytes and its release SHA-256 is `a7bd0139b4fd06e0f20602569083281d2b4e6bab7198d54400e70d666961f8e7`.

```bash
pmtiles extract https://build.protomaps.com/20260905.pmtiles ./current.pmtiles --maxzoom=12
pmtiles verify ./current.pmtiles
```

The result is above Wrangler's 315 MB object-upload limit and R2's 5 GiB single-part limit. The provisioning script computes the extracted archive's SHA-256, verifies the archive, mints 24-hour credentials scoped to a unique immutable archive key and its small release pointer, performs multipart uploads, and streams the entire uploaded archive back through SHA-256 verification. It uses the existing account-owned Cloudflare API token without storing S3 credentials.

The script refuses to upload unless the computed SHA-256 matches a pinned digest supplied via `--expected-sha256=<hex>` or the `EXPECTED_ARCHIVE_SHA256` environment variable. When extracting a new snapshot for the first time, use `--skip-digest-check` for a development-only upload, record the printed SHA-256 in the release record, and use that pin for every subsequent run. `--skip-digest-check` cannot be combined with `--prod`; production always requires a valid 64-character SHA-256 pin. By default only the development bucket is written, and production staging is included only when `--prod` is passed explicitly. Add `--promote` to conditionally activate the verified release after deploying the release-aware gateway:

```bash
# Development only (default):
PMTILES_BIN=/path/to/pmtiles EXPECTED_ARCHIVE_SHA256=<pinned-hex> \
  node --env-file=.env scripts/provision/provision-vector-data.mjs ./current.pmtiles --provision

# Development and production:
PMTILES_BIN=/path/to/pmtiles EXPECTED_ARCHIVE_SHA256=<pinned-hex> \
  node --env-file=.env scripts/provision/provision-vector-data.mjs ./current.pmtiles --provision --prod
```

The API token must allow R2 object writes and temporary-credential creation. Do not commit the token, temporary credentials, or generated archive. Keep the pinned source, maximum zoom, extracted-archive SHA-256, `DATASET_VERSION`, manifest response, and attribution synchronized when updating the data. The Protomaps archive is an ODbL Produced Work based on OpenStreetMap data.

Because public archive URLs can select a new release on dataset updates, the Worker serves bounded byte-range requests (16 MiB maximum) with a short one-hour `cache-control` and etag revalidation (`If-None-Match` returns `304`) instead of exposing a multi-gigabyte full-object download. Terrain tiles remain in R2 under dataset-versioned keys (`terrain/<DATASET_VERSION>/terrarium/...`); bump `DATASET_VERSION` when terrain data changes. Public tile URLs use a one-hour TTL with revalidation, and the generator revalidates before using them. Tiles are validated before caching; invalid legacy cache entries are repaired from upstream. Conditional R2 range reads prevent archive replacement from mixing metadata and bytes.

## Develop and validate

```bash
npm run types
npm run dev
npm run typecheck
npm run build
```

`npm run dev` serves the Worker on port 8787; set `VITE_MAP_API_PORT` to use a different one. The root `npm run dev` additionally skips to the next free port when 8787 is taken. Read-only API routes allow every browser origin, including relocated local dev servers.

Before deployment, `/ready` intentionally returns `503` unless both vector and lake archives and the geocoder secret are available. `/health` only reports that the Worker itself is running.

Local terrain-cache R2 storage is simulated automatically. The local development Worker reads the provisioned PMTiles archive through a remote binding to `topostack-vector-data-development`; this requires Wrangler authentication but avoids duplicating a multi-gigabyte archive on every workstation. Development and production deployments use separate environment declarations:

```bash
npx wrangler deploy --env development
npx wrangler deploy --env production
```

The top-level (no `--env`) configuration binds the `-development` buckets so a bare `wrangler deploy` can never write into production storage; those development buckets must exist (see the provisioning commands above). Deployments should always pass an explicit `--env`. The `--env=""` dry-run used by `npm run build` continues to work against the top-level configuration.

Read-only API routes (`GET`, `HEAD`, and their `OPTIONS` preflights) are public and return `Access-Control-Allow-Origin: *` without credential support. This includes terrain, archive ranges, the manifest, and place search. Existing request limits, upstream budgets, bounded archive ranges, and caching remain in force; CORS is not an authentication or spending control. The `/v1/events` write endpoint retains same-origin validation and its origin allowlist, controlled by two vars: `ALLOWED_ORIGINS` (exact-match list) and `ALLOWED_ORIGIN_SUFFIXES` (comma-separated HTTPS host suffixes, default `.atomm.com`). Set `ALLOWED_ORIGIN_SUFFIXES` to an empty string to revoke suffix-based origins without a code change. Place search uses Geoapify through the Worker so the browser never receives the provider key. Each uncached search makes two provider requests, the default search and one for named features (`type=amenity`, which covers mountains, canyons and lakes), and orders the merged results by Geoapify's `rank.importance`; the default search alone ranks a town called Mount Rainier above the mountain. Cached answers cost nothing, so this doubles provider use only on misses:

```bash
npx wrangler secret put GEOCODER_API_KEY --env development
npx wrangler secret put GEOCODER_API_KEY --env production
```

The `/v1/feedback` route emails studio feedback through Cloudflare Email Service and needs the `FEEDBACK_EMAIL_TO` secret plus an onboarded sender domain; see [docs/feedback.md](../../docs/feedback.md#email-delivery).

CI normally synchronizes these secrets from the matching GitHub environment during deployment, so the interactive commands are for recovery or local administration only. Copy `.dev.vars.example` to `.dev.vars` and replace its value for local development. Review Geoapify plan limits and attribution terms before launch.

## Agent API

The routes an AI assistant or a script uses to plan a model and hand it to the studio. They are documented at `/v1/openapi.json` and in the public guides `/guides/agent-api` and `/guides/mcp-server`. [docs/mcp.md](../../docs/mcp.md) is the contributor reference, and the design is in [docs/plans/agent-api.md](../../docs/plans/agent-api.md).

| Route | Purpose |
| --- | --- |
| `POST /v1/projects/resolve` | Validate a `ProjectRequestV1` and return the expanded project and its studio link; 422 lists each invalid field |
| `POST /v1/projects/plan` | Estimate sheets, stack height and scale from at most four low-zoom terrain tiles, read through the terrain route's caches and budgets |
| `POST /v1/projects/link` | A studio link for a request or a full project (`{ "project": ... }`); 413 past the 8,000-character link limit |
| `GET /v1/coverage` | Which high-resolution terrain and lake surveys cover `?bbox=` or `?lat=&lon=&widthKm=` |
| `GET /v1/openapi.json` | The OpenAPI 3.1 document |

### MCP server

`/mcp` is a remote MCP server (Streamable HTTP, stateless, JSON responses; `src/mcp/`). Chat clients such as Claude and ChatGPT add it as a custom connector at `https://topostack.app/mcp`; no sign-in is needed.

- **Tools** (all read-only): `search_places`, `check_coverage`, `plan_model`, `preview_model`, `create_studio_link`. They call the same functions as the REST routes, return structured content that matches each tool's `outputSchema`, and report fixable request problems as tool errors the model can read.
- **Resources:** `topostack://guide/making-a-model`, `topostack://data/sources`, `topostack://schema/project-request-v1`. **Prompts:** `design_topo_map`, `plan_for_my_laser`.
- **In-chat preview.** `preview_model` names the MCP App `ui://topostack/terrain-preview.html` in its `_meta.ui.resourceUri`. Reading that resource returns the generator build's `mcp-app/terrain-preview.html` (through the `ASSETS` binding) with this Worker's origin filled in, and a CSP that lets it connect only here. The page generates the model in the chat's iframe, so the Worker still generates nothing. Without a generator build the resource answers an error saying so.
- **Transport.** Each POST carries one message or a batch; notifications get `202`. There is no session or event stream, so `GET` and `DELETE` answer `405`. Supported protocol versions are listed in `src/mcp/protocol.ts`.
- **Discovery:** `/.well-known/mcp/server-card.json`, following the draft server-card proposal.
- **Tests** drive the Worker with the official SDK client (`@modelcontextprotocol/sdk`, a dev dependency only) using the Workers-compatible schema validator. To try it by hand, run `npm run dev` and point the MCP Inspector at `http://localhost:8787/mcp`; the dev script passes `--local-upstream` so links and the preview's CSP name the local Worker rather than the development route. [docs/mcp.md](../../docs/mcp.md#running-it-locally) lists what else a local run needs.

- **Links.** A studio link is `PUBLIC_ORIGIN/studio?generate=1#p=1.<design>`: the design rides in the fragment and the studio generates it on open, so files are always made in the browser. `PUBLIC_ORIGIN` is set per environment; `npm run dev` points it at the local generator.
- **Budgets.** Chat platforms call from their own servers, so one address stands for many people. The POST routes and `/mcp` are charged to `AGENT_LIMITER` (120 a minute per client) and `AGENT_GLOBAL_LIMITER` (1,200 a minute per colo) instead of the browser's `REQUEST_LIMITER`. A plan's tile fetches that miss the caches also pass the terrain upstream budget.
- **CORS.** The POST routes have no side effects and take no credentials, so they answer every origin like the read-only data.
- **Estimates.** Coarse tiles smooth peaks, and lake depth adds sheets only generation can count, so plans are labelled estimates and the studio's count is authoritative.
- **Attribution.** Every response carries an `attribution` object; anything shown or passed on from it must keep that credit.

## GitHub deployment mapping

| Git branch | GitHub environment | Wrangler environment | Worker | Public URL | Map cache | Vector data |
| --- | --- | --- | --- | --- | --- | --- |
| `dev` | `development` | `development` | `topostack-dev` | `https://dev.topostack.app` | `topostack-map-cache-development` | `topostack-vector-data-development` |
| `main` | `production` | `production` | `topostack` | `https://topostack.app` | `topostack-map-cache` | `topostack-vector-data` |

The development frontend and API are deployed at `https://dev.topostack.app`; production is at `https://topostack.app`. Wrangler uploads `apps/generator/dist` as static assets, while `/health` and `/v1/*` run the API Worker. Atomm and third-party browser clients can call the read-only API cross-origin.

The former hosts, `topostack.echofoxtrot.works` and `dev-topostack.echofoxtrot.works`, stay attached to the same Workers as second Custom Domains so Atomm packages published before the move keep reaching the API (CORS preflights cannot follow redirects). Everything else on those hosts is sent to the same path on the new origin with a 301 by a Single Redirect rule, which runs before the Worker and its static assets — a Worker-level redirect would take page responses out of the `_headers` policy. `www.topostack.app` has no Custom Domain at all and is redirected to the apex the same way, from a proxied placeholder record that exists only so the rule can run.

The rules live in code; preview them, then apply them with a token that has Zone Read and Single Redirect Edit on `echofoxtrot.works` and `topostack.app`, plus DNS Edit on `topostack.app` for the `www` record:

```sh
CLOUDFLARE_API_TOKEN=... node scripts/build/configure-redirects.mjs
CLOUDFLARE_API_TOKEN=... node scripts/build/configure-redirects.mjs --apply
```

The script replaces only its own `topostack_*` rules, leaves any other redirect rule in either zone untouched, and never edits an existing `www` record.

Configure `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `GEOCODER_API_KEY` as secrets in both GitHub environments. The Cloudflare token needs Workers Scripts edit and R2 edit at the account level plus Workers Routes edit for the `topostack.app` and `echofoxtrot.works` zones so both environments can manage their Custom Domains. Restrict the development environment to `dev` and production to `main`; production should also use required reviewers. Pull requests run validation without environment access or Cloudflare credentials.

## Freshness and launch operations

Geocoder cache reads enforce the age of the R2 object's upload timestamp. Results older than 24 hours are refreshed; browser `max-age` is limited to the remaining freshness of a cached result. Configure an R2 lifecycle rule scoped to `geocode/` to delete objects after two days for storage cleanup. Application freshness is enforced even if lifecycle cleanup is delayed. Do not apply this rule to terrain or vector archive prefixes.

Empty geocoder answers are never written to R2 and carry a five-minute browser `max-age`. Cache keys collapse case and repeated whitespace. Place-search cache misses pass a per-client `GEOCODE_LIMITER` budget (30/min) and then a dedicated `GEOCODE_GLOBAL_LIMITER` (`geocode-global`, 300/min, 10x per-client) that bounds burst load regardless of `Origin`; CORS is not access control. Cloudflare ratelimit bindings count per location, not account-wide, so the daily request cap on the Geoapify API key (set it in the Geoapify dashboard) is the actual spend control. `HEAD /v1/geocode` never calls the provider or spends geocode budgets: it answers a fresh cached result from R2 metadata, otherwise `200` with `x-topostack-cache: MISS` and `no-store`. The hourly upstream probe bypasses the public limiters. Per-client keys use `cf-connecting-ip`; IPv6 clients are keyed by their /64 prefix and IPv4-mapped addresses by the IPv4 address.

Request budgets: PMTiles range reads and terrain cache hits/304s are R2-backed and are not charged to the per-client `REQUEST_LIMITER`; terrain charges it (then the shared `TERRAIN_GLOBAL_LIMITER`, 2400/min per location) only before an upstream fetch. `HEAD` on a terrain tile is charged to a per-client `terrain-head` bucket and reads R2 metadata only; an uncached tile answers `200` with `x-topostack-cache: MISS`, `no-store` and no etag or length rather than fetching upstream, so a later `GET` may still fail with 502/504. Archive `HEAD` and `If-None-Match` requests re-resolve the release from R2 (bypassing the memo) and are charged to an `archive-meta` bucket; archive 404/503 answers are charged to the `not-found` bucket. Unknown paths share one `not-found` budget bucket. Health, readiness, manifest and geocode routes keep the per-client budget. Ranges above 16 MiB return 413 and malformed or multipart ranges return 400; 416 is reserved for well-formed unsatisfiable ranges (PMTiles clients treat 416 as an archive change).

Terrain tiles carry an MD5 `etag` on both misses and hits, and conditional hits use an R2 `etagDoesNotMatch` read without fetching the body. Cached tiles are current only with `terrainValidation: png-v1` and `provenance: v2` metadata; older entries are refetched lazily and overwritten (a validated legacy tile is served as `x-topostack-cache: STALE` if the origin is unreachable). Release-pointer resolution for PMTiles reads is memoized per isolate for 60 seconds (missing archives and invalid pointers for 15 seconds); a failed conditional range read evicts it and retries once, and an invalid pointer returns 503 with `retry-after` and an `archive_release_invalid` log.

A structurally valid Terrarium image filled entirely with the elevation NoData sentinel yields `404` and `x-topostack-terrain-status: no-data` when a validated tile is unavailable in cache. The Worker sends no elevation bytes for that response. Studio can retry the same crop at up to two coarser native zoom levels and records the selected zoom in the project manifest. Invalid images, partial sentinel tiles, upstream errors, and timeouts still use the gateway error path. The hourly health record includes the NoData reason if the terrain probe encounters it.

`/ready` requires both PMTiles archives, the pinned provider-outline index, and a configured geocoder, matching a default project's water-depth requirements. `/health` remains the process liveness check. Gateway completion logs include status, cache outcome, environment, and elapsed milliseconds without search text or provider credentials. Alert on elevated 5xx responses on `/v1/terrain/` and `/v1/geocode`, including cache-miss paths; a fixed canary served from R2 alone cannot establish upstream health.

Both provisioning scripts save `<archive>.provisioning.json` after remote verification, recording the immutable object, byte count, SHA-256, previous release, and promotion state per bucket. The receipt is saved before pointer activation and updated afterward; keep it even after a partially completed multi-bucket run. Retain the actual archives and receipts outside the repository so the mutable `current.pmtiles` keys can be restored. See [release acceptance and rollback](../../docs/release-acceptance.md). A production browser monitor failure uploads `test-results-live` diagnostics for seven days.

## NOAA bathymetry

The optional `/v1/bathymetry/noaa-great-lakes-v1.pmtiles` endpoint serves the
versioned NOAA raster archive from the existing `VECTOR_DATA` binding, with the
same bounded byte ranges, etags, and CORS as the global lake archive. Provision it
with `scripts/provision/provision-lake-data.mjs --source=noaa`; see
[build, provenance, and rollout instructions](../../docs/noaa-bathymetry.md).
Missing NOAA data produces a modeled-depth fallback warning in the generator
and does not change the existing required dependencies for `/ready`.

Additional lake-survey archives are allowlisted in `scripts/data/lake-bathymetry.json`
and served at `/v1/bathymetry/<dataset-id>.pmtiles` using the same bounded range
handler. See [survey coverage and provisioning](../../docs/lake-bathymetry.md).

## Data-layer contract

See the [data layer and cache review](../../docs/data-layer-review.md) for cache ownership, failure behavior, source registration, regression coverage, and remaining operational checks. Survey registrations are validated by the same typed contract in the browser, gateway, and provisioning script.

## Verified release rollout and monitoring

Deploy this gateway before using `--promote`; provisioning verifies the public manifest's `archiveReleases` capability. Without a release pointer the Worker reads the existing archive. With a pointer, it checks the target's byte count and ETag against its verified release identity, then performs conditional bounded range reads. Archive bytes are never copied over a live multi-GB object during promotion. Existing public archive URLs and the one-hour browser TTL are preserved.

The hourly cron at minute 7 validates terrain and geocoder origins without consulting their caches. The monitor at minute 17 checks `/v1/upstream-health`; snapshots become stale after two hours. After first deployment, the endpoint intentionally reports 503 until a probe completes. Live canaries and benchmark artifacts complement readiness rather than depending on a fixed R2 cache hit.

See [data operations](../../docs/data-layer-operations.md) for staging, promotion, lifecycle audit, rollback, and benchmark commands.

## Additional terrain sources

Optional NRCan HRDEM archives use `/v1/terrain-sources/<dataset-id>.pmtiles` and
`VECTOR_DATA`, with the same bounded ranges and verified release pointers as
survey archives. The generator prefers valid HRDEM pixels and retains Mapzen
for gaps or unavailable archives. See [HRDEM coverage, build and rollout](../../docs/hrdem-terrain.md).


Provider lake outlines use immutable JSON objects under `lake-outlines/` in
`VECTOR_DATA`, served at `/v1/lake-outlines/<digest>.json`. The frontend pins
`scripts/data/lake-outlines-release.json`; no outline geometry is bundled with
static assets. Publish and verify both environment buckets before deploying a
new release pin. CI checks the pinned index and all shard metadata before
Wrangler deploys. See [the outline data workflow](../../docs/lake-bathymetry.md#shoreline-coverage-and-fallback)
for publication, recovery and rollback commands. Do not apply archive pruning
or cache lifecycle deletion rules to the `lake-outlines/` prefix.
