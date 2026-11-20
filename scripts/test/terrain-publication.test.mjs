import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTerrainPublication } from "../lib/terrain-publication.mjs";
const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const source = read("terrain-sources.json").sources[0];
const legacyReceipt = read("hrdem-builds.json").builds[0];
const pin = legacyReceipt.sources[0];
const fixture = () => ({ source, header: { bounds: source.bounds, tile_type: "png", minzoom: 0, maxzoom: 15 },
  metadata: { topostack_dataset: source.id, topostack_encoding: source.encoding, topostack_vertical_datum: source.verticalDatum,
    topostack_source_item: pin.item, topostack_source_etag: pin.etag },
  receipt: { ...structuredClone(legacyReceipt), schemaVersion: 1, encoding: source.encoding, verticalDatum: source.verticalDatum,
    verticalUnits: "metre", coverage: { validSamples: 100, totalSamples: 200 } },
  sha256: legacyReceipt.sha256, bytes: legacyReceipt.bytes, pin });

test("validates measured terrain release and original legacy hash", () => {
  validateTerrainPublication(fixture());
  validateTerrainPublication({ ...fixture(), receipt: legacyReceipt, legacy: true });
  assert.throws(() => validateTerrainPublication({ ...fixture(), receipt: legacyReceipt }), /coverage/);
});
for (const [name, mutate] of [
  ["archive extent", (f) => { f.header.bounds = [0, 1, 2, 3]; }],
  ["receipt extent", (f) => { f.receipt.grids[0].bounds = [0, 1, 2, 3]; }],
  ["missing receipt", (f) => { f.receipt = undefined; }],
  ["archive hash", (f) => { f.sha256 = "a".repeat(64); }],
  ["archive size", (f) => { f.bytes++; }],
  ["changed input", (f) => { f.pin = { ...pin, etag: '"changed"' }; }],
  ["bad coverage", (f) => { f.receipt.coverage.validSamples = 201; }],
  ["wrong units", (f) => { f.receipt.verticalUnits = "foot"; }],
  ["wrong datum", (f) => { f.metadata.topostack_vertical_datum = "NAVD88"; }],
]) test(`rejects ${name} before publication`, () => {
  const f = fixture(); mutate(f); assert.throws(() => validateTerrainPublication(f));
});

test("allows PMTiles coordinate rounding but rejects missing/invalid bounds", () => {
  const f = fixture(); f.header.bounds = source.bounds.map((n) => n + 1e-7);
  validateTerrainPublication(f);
  for (const bounds of [undefined, [], [NaN, 0, 1, 2], [null, 0, 1, 2]]) {
    assert.throws(() => validateTerrainPublication({ ...fixture(), header: { ...f.header, bounds } }));
  }
});

import { validateTerrainRegistrySnapshot } from "../lib/terrain-publication.mjs";
test("accepts the migrated registry and rejects manifest or active snapshot edits", () => {
  const catalog = read("terrain-sources.json");
  const manifest = readFileSync(new URL(`../data/${catalog.releaseManifest}`, import.meta.url));
  validateTerrainRegistrySnapshot(catalog, manifest);
  assert.throws(() => validateTerrainRegistrySnapshot({ ...catalog, sources: [] }, manifest), /mismatch/);
  assert.throws(() => validateTerrainRegistrySnapshot(catalog, Buffer.from("{}")), /mismatch/);
});

test("refuses to provision a development-only source to production", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "terrain-gate-"));
  const catalog = join(directory, "terrain-sources.json");
  const pending = { ...source, id: "pending-terrain-v1", availability: "development", approval: { required: true } };
  writeFileSync(catalog, JSON.stringify({ sources: [pending] }));
  const script = new URL("../provision/provision-lake-data.mjs", import.meta.url).pathname;
  const run = (...flags) => spawnSync(process.execPath, [script, join(directory, "missing.pmtiles"), `--terrain-catalog=${catalog}`, "--source=pending-terrain-v1", ...flags], { encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "" } });
  const production = run("--provision", "--prod", "--skip-digest-check");
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /development only until its publisher's approval is recorded; refusing --prod/);
  // The development bucket gets past the gate (and fails later only for missing credentials).
  assert.doesNotMatch(run("--provision", "--skip-digest-check").stderr, /refusing --prod/);
});
