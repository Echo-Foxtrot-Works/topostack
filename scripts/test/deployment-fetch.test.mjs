import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithRetry } from "../lib/deployment-fetch.mjs";

const base = new URL("https://ci.invalid");
const path = "/v1/osm.pmtiles";
const preflight = { method: "OPTIONS", headers: { origin: "https://topostack.generator.atommapps.com" } };

for (const status of [403, 404, 429, 503]) {
  test(`deployment verification recovers after a transient ${status}`, async (t) => {
    const stale = new Response("previous deployment", { status });
    const ready = new Response(null, { status: 204 });
    const responses = [stale, ready];
    const fetch = t.mock.method(globalThis, "fetch", async () => responses.shift());
    t.mock.method(console, "warn", () => {});
    const response = await fetchWithRetry(base, path, preflight, { allowRolloutStatuses: true, retryDelayMs: 0 });
    assert.equal(response, ready);
    assert.equal(stale.bodyUsed, true);
    assert.equal(fetch.mock.callCount(), 2);
    for (const { arguments: [url, init] } of fetch.mock.calls) {
      assert.equal(url.href, new URL(path, base).href);
      assert.equal(init.method, "OPTIONS");
      assert.deepEqual(init.headers, preflight.headers);
    }
  });
}

for (const status of [403, 404]) {
  test(`ordinary monitoring fails ${status} immediately`, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response("denied", { status }));
    await assert.rejects(fetchWithRetry(base, path, preflight), new RegExp(`OPTIONS /v1/osm.pmtiles returned HTTP ${status}`));
    assert.equal(fetch.mock.callCount(), 1);
  });

  test(`persistent rollout ${status} still fails within its deadline`, async (t) => {
    let now = 0;
    t.mock.method(Date, "now", () => now);
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      now += 1_000;
      return new Response("still denied", { status });
    });
    t.mock.method(console, "warn", () => {});
    await assert.rejects(fetchWithRetry(base, path, preflight, {
      allowRolloutStatuses: true, verificationTimeoutMs: 2_500, retryDelayMs: 0,
    }), new RegExp(`HTTP ${status}`));
    assert.equal(fetch.mock.callCount(), 3);
  });
}

test("rollout mode does not retry other client errors", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("bad request", { status: 400 }));
  await assert.rejects(fetchWithRetry(base, path, preflight, { allowRolloutStatuses: true }), /HTTP 400/);
  assert.equal(fetch.mock.callCount(), 1);
});

test("release evidence retries a healthy old build and checks both actual range validators", async (t) => {
  const { releaseEvidence } = await import("../lib/deployment-fetch.mjs");
  const commit = "candidate";
  const deployment = { commit, id: "worker-2" };
  const archive = { status: "available", bytes: 100, etag: '"active"' };
  const readiness = { status: "ready", environment: "production", deployment, dependencies: { lakeData: archive, vectorData: archive } };
  let frontReads = 0, healthReads = 0, badLake = false;
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.pathname.endsWith(".pmtiles")) return new Response("x", { status: 206, headers: {
      "content-range": "bytes 0-0/100", "x-topostack-dataset": "dataset", etag: badLake && url.pathname.includes("lakes") ? '"old"' : archive.etag,
    } });
    assert.equal(url.searchParams.get("revision"), commit);
    if (url.pathname === "/version.json") return Response.json({ commit: ++frontReads === 1 ? "old" : commit, version: "1.2.3", environment: "production" });
    if (url.pathname === "/ready") return Response.json(readiness);
    if (url.pathname === "/health") return Response.json({ deployment: ++healthReads === 1 ? { ...deployment, id: "previous" } : deployment });
    return Response.json({ deployment, datasetVersion: "dataset" });
  });
  const result = await releaseEvidence(base, commit, "production", { retryDelayMs: 0, deploymentBase: base });
  assert.equal(result.frontend.commit, commit);
  assert.equal(frontReads, 3);
  assert.equal(healthReads, 2);
  badLake = true;
  await assert.rejects(releaseEvidence(base, commit, "production", { verificationTimeoutMs: 0 }), /range identity/);
});

test("a healthy previous revision never supplies release evidence when rollout expires", async (t) => {
  const { releaseEvidence } = await import("../lib/deployment-fetch.mjs");
  t.mock.method(globalThis, "fetch", async () => Response.json({ commit: "old", deployment: { id: "old-id", commit: "old" } }));
  await assert.rejects(releaseEvidence(base, "candidate", "production", { verificationTimeoutMs: 0 }), /served revision old/);
});
