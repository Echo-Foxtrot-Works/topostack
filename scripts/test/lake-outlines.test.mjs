import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { digest, publishOutlines, releasePath } from "../lib/lake-outlines.mjs";

test("outline release pins the source catalog, directory and coverage audit", async () => {
  const release = JSON.parse(await readFile(releasePath));
  const auditBytes = await readFile(new URL("../data/lake-outline-coverage.json", import.meta.url));
  const directory = await readFile(new URL("../../apps/generator/static/data/lake-depth-directory.json", import.meta.url));
  const sources = await readFile(new URL("../data/lake-survey-sources.json", import.meta.url));
  const audit = JSON.parse(auditBytes);
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.directorySha256, digest(directory));
  assert.equal(release.coverageSha256, digest(auditBytes));
  assert.equal(release.sourcesSha256, digest(sources));
  assert.equal(release.providerOutlines, audit.providerOutlines);
  assert.equal(release.shards, audit.shards);
  assert.equal(release.index.file, `${release.index.sha256}.json`);
  assert.match(release.index.sha256, /^[a-f0-9]{64}$/);
  assert(release.index.bytes > 0 && release.index.bytes < 1_000_000);
});

const object = (text) => { const bytes = Buffer.from(text); return { bytes, sha256: digest(bytes), file: `${digest(bytes)}.json` }; };
function storage({ corrupt = false, existing = [], metadata = true } = {}) {
  const calls = [], stored = new Map(existing.map((entry) => [`lake-outlines/${entry.file}`, corrupt ? Buffer.from("broken") : entry.bytes]));
  return { calls, stored, request: async (key, init) => {
    calls.push([key, init.method]);
    if (init.method === "PUT") {
      assert.equal(init.headers["if-none-match"], "*");
      if (stored.has(key)) return new Response(null, { status: 412 });
      stored.set(key, corrupt ? Buffer.from("broken") : init.body);
      return new Response(null, { status: 200 });
    }
    const bytes = stored.get(key);
    return new Response(bytes, { headers: { "content-length": String(bytes.length), etag: '"verified"', ...(metadata ? { "x-amz-meta-sha256": key.split("/").at(-1).slice(0, -5) } : {}) } });
  } };
}

test("index is published only after all shards have passed full remote verification", async () => {
  const objects = [object("first"), object("second"), object("index")];
  const remote = storage();
  await publishOutlines(remote.request, objects);
  assert.deepEqual(remote.calls.slice(-2), [[`lake-outlines/${objects[2].file}`, "PUT"], [`lake-outlines/${objects[2].file}`, "GET"]]);
  const retry = storage({ existing: objects });
  await publishOutlines(retry.request, objects);
  assert.deepEqual(retry.calls, remote.calls);
  for (const entry of objects) assert.equal(retry.stored.get(`lake-outlines/${entry.file}`), entry.bytes);
});

test("corrupt uploads or existing objects prevent publication of the index", async () => {
  for (const existing of [false, true]) {
    const objects = [object("first"), object("index")];
    const remote = storage({ corrupt: true, existing: existing ? [objects[0]] : [] });
    await assert.rejects(publishOutlines(remote.request, objects), /mismatch|verification/);
    assert(!remote.calls.some(([key]) => key.endsWith(objects[1].file)));
  }
});


test("pre-existing objects without integrity metadata cannot publish a release", async () => {
  const objects = [object("first"), object("index")];
  const remote = storage({ existing: objects, metadata: false });
  await assert.rejects(publishOutlines(remote.request, objects), /metadata mismatch/);
  assert.equal(remote.calls.length, 2);
});
