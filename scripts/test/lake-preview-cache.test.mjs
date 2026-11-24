import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../lib/hash.mjs";
import { previewCheckpoints, previewInputHash, previewIsCurrent } from "../lib/lake-preview-cache.mjs";

test("resume validates upstream samples and the image left by an interrupted write", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lake-preview-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "lake.webp");
  const lake = { input: { width: 1, height: 1, elevation: new Float32Array([50]), depth: new Float32Array([4]), water: Uint8Array.of(1), surveyed: Uint8Array.of(1), target: Uint8Array.of(1) }, datasetVersion: "same" };
  const inputHash = previewInputHash(5, lake);
  const entry = { inputHash, sha256: sha256Hex("original") };
  await writeFile(path, "original");
  assert.equal(await previewIsCurrent(entry, inputHash, path), true);
  lake.input.depth[0]++;
  assert.equal(await previewIsCurrent(entry, previewInputHash(5, lake), path), false);
  await writeFile(path, "replacement");
  assert.equal(await previewIsCurrent(entry, inputHash, path), false);
  const manifestPath = join(dir, "manifest.json"), manifest = { lakes: {} };
  const save = previewCheckpoints(manifestPath, manifest);
  await Promise.all(["one", "two", "three"].map(async (name) => { manifest.lakes[name] = entry; await save(); }));
  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), manifest);
});
