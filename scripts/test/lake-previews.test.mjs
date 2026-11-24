import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, inspectPreviews, publishPreviews } from "../lib/lake-previews.mjs";

test("the pin names each preview by content hash and keeps what the page shows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lake-previews-"));
  try {
    const image = Buffer.from("RIFF-webp-bytes");
    await writeFile(join(directory, "crater-lake-oregon.webp"), image);
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ rendererVersion: 5, lakes: { "crater-lake-oregon": {
      sha256: digest(image), width: 960, height: 854, maxDepthM: 592.1, contourIntervalM: 100, surveyedShare: 0.99, surveys: ["usgs-crater-lake-v1"], renderedAt: "2026-09-25T00:00:00.000Z", inputHash: "x", timingMs: {} } } }));
    const { pin, objects } = await inspectPreviews(directory);
    const sha256 = digest(image);
    assert.deepEqual(pin, { schemaVersion: 1, rendererVersion: 5, lakes: { "crater-lake-oregon": { file: `${sha256.slice(0, 24)}.webp`, sha256, bytes: image.length,
      width: 960, height: 854, maxDepthM: 592.1, contourIntervalM: 100, surveyedShare: 0.99, surveys: ["usgs-crater-lake-v1"], renderedAt: "2026-09-25T00:00:00.000Z" } } });
    assert.deepEqual(objects.map((object) => object.file), [pin.lakes["crater-lake-oregon"].file]);
    await writeFile(join(directory, "crater-lake-oregon.webp"), Buffer.from("newer image"));
    await assert.rejects(inspectPreviews(directory), /does not match its checkpoint/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function storage({ corrupt = false } = {}) {
  const stored = new Map();
  return async (key, init) => {
    if (init.method === "PUT") {
      assert.equal(init.headers["if-none-match"], "*");
      assert.equal(init.headers["content-type"], "image/webp");
      stored.set(key, { bytes: corrupt ? Buffer.from("broken") : init.body, sha256: init.headers["x-amz-meta-sha256"] });
      return new Response(null, { status: 200 });
    }
    const { bytes, sha256 } = stored.get(key);
    return new Response(bytes, { headers: { "content-length": String(bytes.length), etag: '"verified"', "x-amz-meta-sha256": sha256 } });
  };
}

test("previews are verified after upload, and corruption fails the run", async () => {
  const bytes = Buffer.from("preview");
  const object = { file: `${digest(bytes).slice(0, 24)}.webp`, sha256: digest(bytes), bytes };
  const seen = [];
  await publishPreviews(storage(), [object], (file) => seen.push(file));
  assert.deepEqual(seen, [object.file]);
  await assert.rejects(publishPreviews(storage({ corrupt: true }), [object]));
});
