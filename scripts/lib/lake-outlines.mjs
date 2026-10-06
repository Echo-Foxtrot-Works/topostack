import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyArchiveResponse } from "./archive-provisioning.mjs";

export { sha256Hex as digest } from "./hash.mjs";
import { sha256Hex as digest } from "./hash.mjs";
export const releasePath = new URL("../data/lake-outlines-release.json", import.meta.url);
export async function inspectOutlines(directoryPath) {
  const root = pathToFileURL(resolve(directoryPath) + "/");
  const directoryBytes = await readFile(new URL("../../apps/generator/static/data/lake-depth-directory.json", import.meta.url));
  const auditBytes = await readFile(new URL("../data/lake-outline-coverage.json", import.meta.url));
  const sourceBytes = await readFile(new URL("../data/lake-survey-sources.json", import.meta.url));
  const directory = JSON.parse(directoryBytes), audit = JSON.parse(auditBytes);
  const indexBytes = await readFile(new URL("index.json", root));
  assert(indexBytes.length < 1_000_000, "Outline index exceeds its download budget");
  const index = JSON.parse(indexBytes);
  const objects = [];
  const entries = new Map(directory.lakes.map((lake) => [lake.id, lake]));
  const seen = new Set();
  assert.equal(index.schemaVersion, 1);
  for (const shard of index.shards) {
    assert.match(shard.file, /^[a-f0-9]{24}\.json$/);
    const bytes = await readFile(new URL(shard.file, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 24) + ".json", shard.file);
    assert(bytes.length < 5_000_000, "Each shard must fit the bounded browser download budget");
    objects.push({ file: shard.file, bytes, sha256: digest(bytes) });
    const { features } = JSON.parse(bytes);
    assert.equal(features.length, shard.count);
    for (const feature of features) {
      const id = `${feature.properties.sourceId}:${feature.properties.surveyId}`;
      assert(entries.has(id), `Unknown survey: ${id}`);
      assert(!seen.has(id), `Duplicate survey: ${id}`);
      seen.add(id);
      assert.equal(shard.sourceId, feature.properties.sourceId);
      const [w, s, e, n] = feature.bbox;
      assert(w < e && s < n && w >= -180 && e <= 180 && s > -85.1 && n < 85.1);
      assert(shard.bounds[0] <= w && shard.bounds[1] <= s && shard.bounds[2] >= e && shard.bounds[3] >= n);
      assert(["Polygon", "MultiPolygon"].includes(feature.geometry.type));
      const parts = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      assert(parts.length > 0);
      for (const rings of parts) for (const ring of rings) {
        assert(ring.length >= 4);
        assert.deepEqual(ring[0], ring.at(-1));
        assert(ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= w - 1e-7 && x <= e + 1e-7 && y >= s - 1e-7 && y <= n + 1e-7));
      }
    }
  }
  assert.equal(seen.size, audit.providerOutlines);
  assert.equal(entries.size, audit.directoryEntries);
  assert.equal(audit.entries.length, entries.size);
  assert.deepEqual(new Set(audit.entries.map((entry) => entry.id)), new Set(entries.keys()));
  for (const entry of audit.entries) {
    assert(entries.has(entry.id));
    if (entry.outline === "provider") assert(seen.has(entry.id), `Missing outline: ${entry.id}`);
    else {
      assert.match(entry.id, /^(noaa-great-lakes-v1|noaa-nbs-[^:]+|noaa-enc-[^:]+|usgs-[^:]+|swissbathy3d-v1):/);
      assert.equal(entry.outline, "external-fallback");
      assert(entry.reason);
    }
  }
  const indexSha256 = digest(indexBytes);
  const release = { schemaVersion: 1, index: { file: `${indexSha256}.json`, sha256: indexSha256, bytes: indexBytes.length },
    shards: index.shards.length, providerOutlines: seen.size,
    totalBytes: objects.reduce((sum, object) => sum + object.bytes.length, indexBytes.length),
    directorySha256: digest(directoryBytes), coverageSha256: digest(auditBytes), sourcesSha256: digest(sourceBytes) };
  objects.push({ file: release.index.file, bytes: indexBytes, sha256: indexSha256 });
  return { release, objects };
}

/** Conditional creation prevents overwrite; full readback also verifies pre-existing objects. Index goes last. */
export async function publishOutlines(request, objects, progress = () => {}) {
  const publish = async (object) => {
    const key = `lake-outlines/${object.file}`;
    const uploaded = await request(key, { method: "PUT", headers: { "if-none-match": "*", "content-type": "application/json",
      "cache-control": "public, max-age=31536000, immutable", "x-amz-meta-sha256": object.sha256 }, body: object.bytes });
    await uploaded.body?.cancel();
    if (!uploaded.ok && uploaded.status !== 412) throw new Error(`Outline upload failed (${uploaded.status}).`);
    const downloaded = await request(key, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (downloaded.headers.get("x-amz-meta-sha256") !== object.sha256) {
      await downloaded.body?.cancel();
      throw new Error("Remote outline integrity metadata mismatch.");
    }
    await verifyArchiveResponse(downloaded, object.bytes.length, object.sha256);
    progress(object.file);
  };
  // All shard workers settle before publishing the index or reporting failure.
  const queue = objects.slice(0, -1);
  const workers = await Promise.allSettled(Array.from({ length: 6 }, async () => {
    while (queue.length) await publish(queue.shift());
  }));
  const failed = workers.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  await publish(objects.at(-1));
}
