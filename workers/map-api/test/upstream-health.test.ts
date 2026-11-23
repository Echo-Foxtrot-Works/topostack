import { afterEach, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import worker from "../src/index";
import { elevationPng, terrainPng } from "./terrain-fixture";

const env = { ...workerEnv, GEOCODER_API_KEY: "test-key" } as unknown as Env;
const context = { waitUntil: vi.fn() } as unknown as ExecutionContext;
const controller = { scheduledTime: Date.now(), cron: "7 * * * *", noRetry: vi.fn() } satisfies ScheduledController;
const status = () => worker.fetch(new Request("https://example.test/v1/upstream-health"), env, context);
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await env.MAP_CACHE.delete("health/upstreams-v1.json"); });

it("probes origins directly without using or populating the data caches", async () => {
  const cacheGet = vi.spyOn(env.MAP_CACHE, "get");
  const cachePut = vi.spyOn(env.MAP_CACHE, "put");
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("terrarium")
    ? new Response(terrainPng.slice(), { headers: { "content-type": "image/png" } })
    : Response.json({ results: [{ lat: 42, lon: -122, formatted: "Crater Lake" }] })));
  await worker.scheduled(controller, env, context);
  expect(cacheGet).not.toHaveBeenCalled(); expect(cachePut).toHaveBeenCalledTimes(1);
  expect(cachePut.mock.calls[0]?.[0]).toBe("health/upstreams-v1.json");
  const response = await status(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "healthy", fresh: true, ok: true });
});
it("makes origin failures observable even when cached data exists", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  await expect(worker.scheduled(controller, env, context)).rejects.toThrow("probe failed");
  expect((await status()).status).toBe(503);
});
it("distinguishes an empty sentinel tile in the terrain probe from an origin outage", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("terrarium")
    ? new Response(elevationPng(() => -32768), { headers: { "content-type": "image/png" } })
    : Response.json({ results: [{ lat: 42, lon: -122, formatted: "Crater Lake" }] })));
  await expect(worker.scheduled(controller, env, context)).rejects.toThrow("probe failed");
  const response = await status();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ results: expect.arrayContaining([{ source: "terrain", status: 404, ok: false, reason: "no-data", durationMs: expect.any(Number) }]) });
});
it("rejects absent and stale probe results", async () => {
  expect((await status()).status).toBe(503);
  await env.MAP_CACHE.put("health/upstreams-v1.json", JSON.stringify({ ok: true, checkedAt: new Date(Date.now() - 3 * 3600000).toISOString() }));
  expect((await status()).status).toBe(503);
});
it("reports corrupt probe records as invalid instead of failing", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const record of ["{not json", "null", "[]"]) {
    await env.MAP_CACHE.put("health/upstreams-v1.json", record);
    const response = await status();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "invalid" });
  }
});
