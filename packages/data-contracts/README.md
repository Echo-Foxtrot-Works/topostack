# @topostack/data-contracts

Small, dependency-light modules that the browser app, the `map-api` Worker, and the Node provisioning scripts must all agree on. Nothing here depends on the geometry engine in `@topostack/core`, and nothing in core depends on this package.

| Subpath | Owns |
| --- | --- |
| `@topostack/data-contracts/source-catalog` | Terrain and survey catalog validation and ranking (`scripts/data/*.json` is validated against it in every consumer) |
| `@topostack/data-contracts/archive-release` | The `release.json` shape that names the current PMTiles archive |
| `@topostack/data-contracts/aviation-tiles` | Layer names, feature properties, and metadata of the FAA aviation PMTiles archive, parsed identically by the offline builder check and the browser |
| `@topostack/data-contracts/terrain-png` | Decoding of the numeric terrain PNG served by the Worker |
| `@topostack/data-contracts/usage` | Usage-event names and validation shared by the studio and the Worker |
| `@topostack/data-contracts/share-link` | The `#p=1.` share-link codec: bounded encoding and decoding of a design in a URL fragment. The studio opens these links, and the Worker mints them for agents; each caller validates the decoded value with `parseProject` |
| `@topostack/data-contracts/changelog` | Changelog fragments and `changelog/releases.json`: parsing, validation, version ordering and bumps, and the inline markup the page, feed and release notes render |

The package is source-only. Each subpath resolves straight to a `.ts` file, so Vite, Wrangler, Vitest, and Node's native type stripping all consume it without a build step. Keep every module free of `.js` import specifiers and of TypeScript-only syntax that Node cannot strip (enums, namespaces, parameter properties).
