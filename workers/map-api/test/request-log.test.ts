import { afterEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import worker from "../src/index";
import { shouldLogRequest } from "../src/request-log";
import { REQUEST_LOG_SAMPLE_RATE } from "../src/request-log";
import { terrainPng } from "./terrain-fixture";

const env = { ...workerEnv } as unknown as Env;
const jobs: Promise<unknown>[] = [];
const context = { waitUntil: (job: Promise<unknown>) => { jobs.push(job); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
const settle = async () => { await Promise.all(jobs.splice(0)); };
const completions = (log: { mock: { calls: unknown[][] } }) => log.mock.calls.filter(([line]) => typeof line === "string" && line.includes("request_completed"));

afterEach(async () => { await settle(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("request_completed sampling", () => {
  it("only samples cached successes of the archive and terrain routes", () => {
    const never = () => 1;
    const always = () => 0;
    expect(REQUEST_LOG_SAMPLE_RATE).toBeGreaterThan(0);
    expect(REQUEST_LOG_SAMPLE_RATE).toBeLessThan(1);
    for (const cache of ["EDGE", "HIT", "R2"]) {
      expect(shouldLogRequest({ highVolumeRoute: true, status: 200, cache }, never)).toBe(false);
      expect(shouldLogRequest({ highVolumeRoute: true, status: 206, cache }, never)).toBe(false);
      expect(shouldLogRequest({ highVolumeRoute: true, status: 200, cache }, always)).toBe(true);
    }
    // Misses, upstream fallbacks, revalidations and failures stay whole.
    for (const cache of ["MISS", "BYPASS", "STALE", null]) {
      expect(shouldLogRequest({ highVolumeRoute: true, status: 200, cache }, never)).toBe(true);
    }
    for (const status of [304, 400, 404, 416, 429, 500, 503]) {
      expect(shouldLogRequest({ highVolumeRoute: true, status, cache: "R2" }, never)).toBe(true);
    }
    // Every other route is low volume, including cached geocode answers.
    expect(shouldLogRequest({ highVolumeRoute: false, status: 200, cache: "HIT" }, never)).toBe(true);
  });

  it("drops sampled-out terrain cache hits and keeps every miss", async () => {
    const key = `terrain/${env.DATASET_VERSION}/terrarium/8/70/90.png`;
    await env.MAP_CACHE.put(key, terrainPng.slice(), {
      httpMetadata: { contentType: "image/png" }, customMetadata: { terrainValidation: "png-v1", provenance: "v2" },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(1);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const hit = await worker.fetch(new Request("https://logs.test/v1/terrain/8/70/90.png"), env, context);
      expect(hit.headers.get("x-topostack-cache")).toBe("HIT");
      await hit.arrayBuffer();
    }
    expect(completions(log)).toHaveLength(0);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(terrainPng.slice(), { headers: { "content-type": "image/png" } })));
    const miss = await worker.fetch(new Request("https://logs.test/v1/terrain/8/71/90.png"), env, context);
    expect(miss.headers.get("x-topostack-cache")).toBe("MISS");
    await miss.arrayBuffer();
    await settle();
    expect(completions(log)).toHaveLength(1);

    const notFound = await worker.fetch(new Request("https://logs.test/v1/nothing-here"), env, context);
    expect(notFound.status).toBe(404);
    await notFound.arrayBuffer();
    expect(completions(log)).toHaveLength(2);
  });

  it("marks a kept sample so log-derived counts can be scaled back up", async () => {
    await env.MAP_CACHE.put(`terrain/${env.DATASET_VERSION}/terrarium/8/72/90.png`, terrainPng.slice(), {
      httpMetadata: { contentType: "image/png" }, customMetadata: { terrainValidation: "png-v1", provenance: "v2" },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    const hit = await worker.fetch(new Request("https://logs.test/v1/terrain/8/72/90.png"), env, context);
    expect(hit.headers.get("x-topostack-cache")).toBe("HIT");
    await hit.arrayBuffer();
    const lines = completions(log).map(([line]) => JSON.parse(line as string));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ path: "/v1/terrain/8/72/90.png", status: 200, cache: "HIT", sampleRate: REQUEST_LOG_SAMPLE_RATE });
  });
});
