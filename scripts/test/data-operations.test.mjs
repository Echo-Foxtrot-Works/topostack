import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { stageArchive } from "../lib/archive-provisioning.mjs";
import { GEOCODE_EXPIRY_RULE, reconcileCacheLifecycle, hasGeocodeExpiry, lifecycleSatisfies, retiredTerrainRule, terrainVersionsFromPrefixes } from "../lib/cache-lifecycle.mjs";
import { DAY_MS, planArchivePrune, pointersUnchanged, readReleasePointers } from "../lib/archive-pruning.mjs";
import { parseListObjectsXml, listObjects, retryReads } from "../lib/r2-s3.mjs";
import { liveDatasetVersion, verifyPromotionGateway } from "../lib/gateway.mjs";
import { stripJsonc } from "../lib/r2-buckets.mjs";

const bytes = new Uint8Array(127).fill(3);
const digest = createHash("sha256").update(bytes).digest("hex");
const id = "12345678-1234-1234-1234-123456789abc";
const previousRelease = { schemaVersion: 1, logicalKey: "osm/current.pmtiles", objectKey: `archives/${"b".repeat(64)}/${id}.pmtiles`, sha256: "b".repeat(64), dataset: "previous", bytes: 127, etag: '"previous-object"', verifiedAt: "2026-09-01T00:00:00Z" };
const release = { schemaVersion: 1, logicalKey: "osm/current.pmtiles", objectKey: `archives/${digest}/${id}.pmtiles`, sha256: digest, dataset: "fixture", bytes: 127, etag: '"fixture"', verifiedAt: "2026-09-16T00:00:00Z" };

function scenario({ corrupted = false, pointerStatus = 404, promoteStatus = 200, truncated = false } = {}) {
  const events = [], receipts = [], puts = [];
  const options = { logicalKey: release.logicalKey, dataset: "fixture", bytes: 127, sha256: digest, id,
    upload: async () => { events.push("upload"); },
    checkpoint: async (receipt) => { receipts.push(structuredClone(receipt)); events.push("receipt"); },
    request: async (key, init) => {
      if (init.method === "PUT") { events.push("promote"); puts.push(init); return new Response(null, { status: promoteStatus }); }
      if (key.startsWith("releases/")) {
        // Like R2, a compressible pointer comes back gzipped with a weak etag unless identity is requested.
        const etag = init.headers?.["accept-encoding"] === "identity" ? '"previous"' : 'W/"previous"';
        return pointerStatus === 200 ? Response.json(previousRelease, { headers: { etag } }) : new Response(null, { status: pointerStatus });
      }
      events.push("verify");
      const body = corrupted ? bytes.slice().fill(4) : truncated ? bytes.slice(0, -1) : bytes;
      return new Response(body, { headers: { "content-length": "127", etag: '"fixture"' } });
    },
  };
  return { options, events, puts, receipts };
}

test("staging verifies full bytes but never activates implicitly", async () => {
  const s = scenario(); const result = await stageArchive(s.options);
  assert.equal(result.promoted, false); assert.deepEqual(s.events, ["upload", "verify", "receipt"]);
});
test("activation follows full verification and retains rollback receipt", async () => {
  const s = scenario({ pointerStatus: 200 }); await stageArchive({ ...s.options, promote: true });
  assert.deepEqual(s.events, ["upload", "verify", "receipt", "promote", "receipt"]);
  assert.equal(s.puts[0].headers["if-match"], '"previous"');
  assert.deepEqual(s.receipts[0].previousRelease, previousRelease); assert.equal(s.receipts[1].promoted, true);
  assert.equal(JSON.parse(s.puts[0].body).previousObjectKey, previousRelease.objectKey);
});
test("a first activation records that it has no archive predecessor", async () => {
  const s = scenario(); await stageArchive({ ...s.options, promote: true });
  assert.equal(JSON.parse(s.puts[0].body).previousObjectKey, null);
});
test("first activation cannot overwrite a concurrently created pointer", async () => {
  const s = scenario({ promoteStatus: 412 });
  await assert.rejects(stageArchive({ ...s.options, promote: true }), /promotion failed/);
  assert.equal(s.puts[0].headers["if-none-match"], "*"); assert.equal(s.receipts[0].promoted, false);
});
for (const options of [{ corrupted: true }, { truncated: true }, { pointerStatus: 403 }]) test(`failed verification never activates: ${JSON.stringify(options)}`, async () => {
  const s = scenario(options); await assert.rejects(stageArchive({ ...s.options, promote: true })); assert.equal(s.puts.length, 0);
});
test("expiry preserves multipart cleanup and is idempotent", () => {
  const existing = { id: "abort", enabled: true, conditions: {}, abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 604800 } } };
  const next = reconcileCacheLifecycle({ rules: [existing] });
  assert.deepEqual(next.rules, [existing, GEOCODE_EXPIRY_RULE]); assert.ok(hasGeocodeExpiry(next));
  assert.deepEqual(reconcileCacheLifecycle(next), next);
});
test("expiry refuses to carry forward broad deletion rules", () => {
  for (const prefix of ["", "terrain/", "lakes/"]) assert.throws(() => reconcileCacheLifecycle({ rules: [{ id: "unsafe", enabled: true, conditions: { prefix }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 1 } } }] }));
});

test("activation requires the deployed gateway to understand release pointers", async () => {
  await assert.rejects(verifyPromotionGateway("https://example.test", async () => Response.json({ schemaVersion: 1 })), /Deploy the release-aware gateway/);
  await verifyPromotionGateway("https://example.test", async () => Response.json({ capabilities: { archiveReleases: 1 } }));
});

const current = "mapzen-terrarium+protomaps-20260905-z12-v1", retiredVersion = "mapzen-terrarium+protomaps-20260801-z12-v1";
test("retired terrain versions get their own expiry and protected versions never do", () => {
  const next = reconcileCacheLifecycle({ rules: [] }, { retiredTerrainVersions: [retiredVersion], protectedTerrainVersions: [current] });
  assert.deepEqual(next.rules, [GEOCODE_EXPIRY_RULE, retiredTerrainRule(retiredVersion)]);
  assert.equal(next.rules[1].conditions.prefix, `terrain/${retiredVersion}/`);
  assert.ok(lifecycleSatisfies(next, next));
  assert.ok(!lifecycleSatisfies({ rules: [GEOCODE_EXPIRY_RULE] }, next));
  // Rules survive once the retired prefix is empty and no longer listed.
  assert.deepEqual(reconcileCacheLifecycle(next, { protectedTerrainVersions: [current] }), next);
  assert.throws(() => reconcileCacheLifecycle({ rules: [] }, { retiredTerrainVersions: [current], protectedTerrainVersions: [current] }), /protected/);
});
test("a managed rule for a version that became current again is removed", () => {
  const stale = { rules: [GEOCODE_EXPIRY_RULE, retiredTerrainRule(current)] };
  const next = reconcileCacheLifecycle(stale, { protectedTerrainVersions: [current] });
  assert.deepEqual(next.rules, [GEOCODE_EXPIRY_RULE]);
  assert.ok(!lifecycleSatisfies(stale, next));
});
test("verification notices unrelated rules the replace dropped", () => {
  const multipart = { id: "abort-incomplete-uploads", enabled: true, conditions: {}, abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 604800 } } };
  const proposed = reconcileCacheLifecycle({ rules: [multipart] }, { retiredTerrainVersions: [retiredVersion], protectedTerrainVersions: [current] });
  assert.ok(lifecycleSatisfies(proposed, proposed));
  // The PUT replaces the whole rule set; a silently dropped or renamed
  // unrelated rule must not read as "applied and verified".
  assert.ok(!lifecycleSatisfies({ rules: proposed.rules.filter((rule) => rule.id !== multipart.id) }, proposed));
  assert.ok(!lifecycleSatisfies({ rules: proposed.rules.map((rule) => rule.id === multipart.id ? { ...rule, id: "renamed" } : rule) }, proposed));
  // Fields the API adds or reorders on the managed rules are still tolerated.
  assert.ok(lifecycleSatisfies({ rules: [...proposed.rules].reverse().map((rule) => ({ ...rule, echoed: true })) }, proposed));
});

test("managed terrain rules that were edited by hand fail closed", () => {
  const tampered = { ...retiredTerrainRule(retiredVersion), conditions: { prefix: "terrain/" } };
  assert.throws(() => reconcileCacheLifecycle({ rules: [tampered] }, { protectedTerrainVersions: [current] }), /Review managed terrain rule/);
  assert.throws(() => terrainVersionsFromPrefixes(["terrain/"]));
  assert.deepEqual(terrainVersionsFromPrefixes([`terrain/${current}/`]), [current]);
});

test("R2 reads retry a failed connection; writes and HTTP errors do not", async (t) => {
  t.mock.method(console, "warn", () => {});
  const failing = (outcomes) => t.mock.fn(async () => {
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const dropped = () => new TypeError("fetch failed");
  for (const method of ["GET", "HEAD", "head"]) {
    const send = failing([dropped(), dropped(), new Response("ok")]);
    assert.equal((await retryReads(send, method, { delayMs: 0 })).status, 200);
    assert.equal(send.mock.callCount(), 3);
  }
  const exhausted = failing([dropped(), dropped(), dropped()]);
  await assert.rejects(retryReads(exhausted, "GET", { delayMs: 0 }), TypeError);
  assert.equal(exhausted.mock.callCount(), 3);
  const write = failing([dropped()]);
  await assert.rejects(retryReads(write, "PUT", { delayMs: 0 }), TypeError);
  assert.equal(write.mock.callCount(), 1);
  const missing = failing([new Response("missing", { status: 404 })]);
  assert.equal((await retryReads(missing, undefined, { delayMs: 0 })).status, 404);
  assert.equal(missing.mock.callCount(), 1);
});

test("R2 listings parse XML entities and follow continuation tokens", async () => {
  const page = (body) => new Response(`<?xml version="1.0"?><ListBucketResult>${body}</ListBucketResult>`, { status: 200 });
  const pages = [
    page("<IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b</NextContinuationToken><Contents><Key>terrain/x&amp;y.png</Key><Size>5</Size><LastModified>2026-09-01T00:00:00.000Z</LastModified></Contents>"),
    page("<IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>terrain/v1/</Prefix></CommonPrefixes>"),
  ];
  const queries = [];
  const result = await listObjects(async (query) => { queries.push(new URLSearchParams(query)); return pages.shift(); }, { prefix: "terrain/", delimiter: "/" });
  assert.deepEqual(result.objects.map(({ key, size }) => [key, size]), [["terrain/x&y.png", 5]]);
  assert.deepEqual(result.prefixes, ["terrain/v1/"]);
  assert.equal(queries[1].get("continuation-token"), "a&b");
  assert.throws(() => parseListObjectsXml("<IsTruncated>true</IsTruncated>"), /continuation/);
});
test("JSONC stripping keeps URLs and removes comments and trailing commas", () => {
  assert.deepEqual(JSON.parse(stripJsonc('{ "url": "https://a.test//b", // note\n "list": [1, 2,], /* x */ }')), { url: "https://a.test//b", list: [1, 2] });
});
test("the live dataset version comes from the deployed manifest and fails closed", async () => {
  assert.equal(await liveDatasetVersion("https://example.test", async () => Response.json({ datasetVersion: current })), current);
  await assert.rejects(liveDatasetVersion("https://example.test", async () => new Response(null, { status: 502 })), /live manifest/);
});

const now = Date.parse("2026-09-17T00:00:00Z");
const archiveKey = (n) => `archives/${String(n).repeat(64)}/12345678-1234-1234-1234-123456789abc.pmtiles`;
const object = (key, ageDays, size = 100) => ({ key, size, uploaded: new Date(now - ageDays * DAY_MS) });
const pointer = (patch) => ({ key: "releases/osm/current.pmtiles.json", etag: '"p"', release: { ...release, verifiedAt: new Date(now - 60 * DAY_MS).toISOString(), ...patch } });
test("pruning keeps active, rollback and recent archives and removes superseded ones", () => {
  const plan = planArchivePrune({ now, pointers: [pointer({ objectKey: archiveKey(1), previousObjectKey: archiveKey(2) })],
    archives: [object(archiveKey(1), 90), object(archiveKey(2), 90), object(archiveKey(3), 90), object(archiveKey(4), 3), object("archives/stray.bin", 90)] });
  assert.deepEqual(Object.fromEntries([...plan.keep, ...plan.remove].map(({ key, reason }) => [key, reason])), {
    [archiveKey(1)]: "active", [archiveKey(2)]: "rollback", [archiveKey(3)]: "superseded", [archiveKey(4)]: "recent", "archives/stray.bin": "unrecognized",
  });
  assert.equal(plan.removeBytes, 100);
});
test("pointers without recorded history protect every archive during the grace period", () => {
  const recent = planArchivePrune({ now, pointers: [pointer({ objectKey: archiveKey(1), verifiedAt: new Date(now - DAY_MS).toISOString() })], archives: [object(archiveKey(3), 90)] });
  assert.deepEqual(recent.remove, []); assert.equal(recent.keep[0].reason, "unknown-predecessor");
  const settled = planArchivePrune({ now, pointers: [pointer({ objectKey: archiveKey(1) })], archives: [object(archiveKey(3), 90)] });
  assert.equal(settled.remove[0].reason, "superseded");
});
test("legacy objects are removed only when opted in and settled", () => {
  const legacy = [object("osm/current.pmtiles", 400)];
  const base = { now, archives: [], legacy, pointers: [pointer({ objectKey: archiveKey(1), previousObjectKey: null })] };
  assert.equal(planArchivePrune(base).keep[0].reason, "legacy-opt-in");
  assert.equal(planArchivePrune({ ...base, includeLegacy: true }).remove[0].reason, "legacy-shadowed");
  const fresh = { ...base, includeLegacy: true, pointers: [pointer({ objectKey: archiveKey(1), previousObjectKey: null, verifiedAt: new Date(now - DAY_MS).toISOString() })] };
  assert.equal(planArchivePrune(fresh).keep[0].reason, "legacy-recent");
});
test("pruning refuses unsafe inputs", () => {
  assert.throws(() => planArchivePrune({ now, pointers: [], archives: [object(archiveKey(3), 90)] }), /No release pointers/);
  assert.throws(() => planArchivePrune({ now, pointers: [pointer({})], archives: [], graceDays: 1 }), /at least 7/);
  assert.ok(!pointersUnchanged([pointer({})], [{ ...pointer({}), etag: '"changed"' }]));
});
test("an unreadable or invalid release pointer aborts pruning", async () => {
  await assert.rejects(readReleasePointers(async () => new Response(null, { status: 500 }), ["releases/osm/current.pmtiles.json"]), /could not be read/);
  await assert.rejects(readReleasePointers(async () => Response.json({ ...release, previousObjectKey: "private/file" }, { headers: { etag: '"p"' } }), ["releases/osm/current.pmtiles.json"]), /Invalid archive release/);
  const [read] = await readReleasePointers(async () => Response.json({ ...release, previousObjectKey: archiveKey(2) }, { headers: { etag: '"p"' } }), ["releases/osm/current.pmtiles.json"]);
  assert.equal(read.release.previousObjectKey, archiveKey(2));
});
