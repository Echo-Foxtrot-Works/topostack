import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { activateAviationRelease } from "../provision/activate-aviation-release.mjs";

const body = new Uint8Array(127).fill(3);
const sha256 = createHash("sha256").update(body).digest("hex");
const candidate = { schemaVersion: 1, logicalKey: "aviation/current.pmtiles", dataset: "faa-fixture-v2", bytes: body.length, sha256, objectKey: `archives/${sha256}/12345678-1234-1234-1234-123456789abc.pmtiles`, etag: '"candidate"', verifiedAt: "2026-10-10T00:00:00Z" };
const previous = { ...candidate, dataset: "faa-fixture-v1", sha256: "a".repeat(64), objectKey: `archives/${"a".repeat(64)}/12345678-1234-1234-1234-123456789abc.pmtiles` };
const manifest = { capabilities: { archiveReleases: 1 }, sources: [{ archive: "/v1/aviation.pmtiles", id: candidate.dataset }] };
function scenario({ active = false, corrupt = false, conflict = false } = {}) {
  const events = [], receipts = [];
  const request = async (key, init) => {
    events.push({ key, ...init });
    if (init.method === "PUT") return new Response(null, { status: conflict ? 412 : 200 });
    if (key.startsWith("releases/")) return Response.json(active ? candidate : previous, { headers: { etag: '"pointer"' } });
    return new Response(corrupt ? body.slice().fill(4) : body, { headers: { "content-length": String(body.length), etag: candidate.etag } });
  };
  return { events, receipts, options: { candidate, dataset: candidate.dataset, request, manifest, promote: true, checkpoint: async receipt => receipts.push(structuredClone(receipt)) } };
}
test("FAA activation verifies bytes, conditionally promotes and keeps its predecessor", async () => {
  const s = scenario(); const result = await activateAviationRelease(s.options);
  assert.equal(result.promoted, true);
  const put = s.events.find(event => event.method === "PUT");
  assert.equal(put.headers["if-match"], '"pointer"');
  assert.equal(JSON.parse(put.body).previousObjectKey, previous.objectKey);
  assert.equal(s.receipts[0].promoted, false);
  assert.equal(s.receipts[1].promoted, true);
  assert(s.events.findIndex(event => event.key === candidate.objectKey) < s.events.indexOf(put));
});
test("FAA deployment preflight hashes the candidate without changing the pointer", async () => {
  const s = scenario(); const result = await activateAviationRelease({ ...s.options, promote: false, manifest: undefined });
  assert.equal(result.promoted, false);
  assert(s.events.some(event => event.key === candidate.objectKey));
  assert(!s.events.some(event => event.method === "PUT"));
});
test("an already active FAA archive is verified without rewriting its rollback target", async () => {
  const s = scenario({ active: true }); const result = await activateAviationRelease(s.options);
  assert.equal(result.alreadyActive, true);
  assert(!s.events.some(event => event.method === "PUT"));
});
test("FAA activation refuses a registration mismatch before touching R2", async () => {
  const s = scenario();
  await assert.rejects(activateAviationRelease({ ...s.options, dataset: "different" }), /committed registration/);
  await assert.rejects(activateAviationRelease({ ...s.options, manifest: { ...manifest, sources: [] } }), /Deploy the registered/);
  await assert.rejects(activateAviationRelease({ ...s.options, manifest: { ...manifest, capabilities: {} } }), /Deploy the registered/);
  await assert.rejects(activateAviationRelease({ ...s.options, checkpoint: undefined }), /rollback checkpoint/);
  assert.equal(s.events.length, 0);
});
test("corrupt FAA bytes never promote", async () => {
  for (const promote of [false, true]) {
    const s = scenario({ corrupt: true });
    await assert.rejects(activateAviationRelease({ ...s.options, promote }), /SHA-256/);
    assert(!s.events.some(event => event.method === "PUT"));
  }
});
test("a concurrent FAA pointer change fails and preserves a rollback receipt", async () => {
  const s = scenario({ conflict: true });
  await assert.rejects(activateAviationRelease(s.options), /promotion failed/);
  assert.equal(s.receipts.length, 1);
  assert.deepEqual(s.receipts[0].previousRelease, previous);
});
