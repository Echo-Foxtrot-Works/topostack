import outlineRelease from "../../../scripts/data/lake-outlines-release.json";
import { terrainPng } from "./terrain-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv, exports } from "cloudflare:workers";
import mapWorker from "../src/index";
import { isAllowedOrigin } from "../src/http";
import { parseRangeHeader } from "../src/routes/archive";
import { geocodeLimit, isGeocoderConfigured, normalizeGeoapify } from "../src/routes/geocode";
import { validTile } from "../src/routes/terrain";
import { resetArchiveHeadCache } from "../src/archive-head";
import { mergeGeoapify } from "../src/routes/geocode";

beforeEach(() => resetArchiveHeadCache());

const env = {
  ALLOWED_ORIGINS: "http://localhost:5273,http://127.0.0.1:5273,https://dev.topostack.app,https://dev-topostack.echofoxtrot.works,https://www.atomm.com",
} satisfies Pick<Env, "ALLOWED_ORIGINS">;

describe("map API validation", () => {
  it("runs the Worker with its generated bindings", async () => {
    const response = await exports.default.fetch("http://example.com/health", {
      headers: { origin: "http://localhost:5273" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(await response.json()).toMatchObject({ service: "topostack-map-api", status: "ok" });
  });

  it("accepts valid tiles and rejects out-of-range coordinates", () => {
    expect(validTile("11", "321", "702")).toEqual({ z: 11, x: 321, y: 702 });
    expect(validTile("11", "3000", "702")).toBeNull();
    expect(validTile("16", "1", "1")).toBeNull();
  });

  it("retains the configured origin policy for event writes", () => {
    expect(isAllowedOrigin("http://localhost:5273", env)).toBe(true);
    expect(isAllowedOrigin("https://dev.topostack.app", env)).toBe(true);
    expect(isAllowedOrigin("https://runtime.atomm.com", env)).toBe(true);
    expect(isAllowedOrigin("https://other.generator.atommapps.com", env)).toBe(false);
    expect(isAllowedOrigin("https://topostack.generator.atommapps.com.evil.example", env)).toBe(false);
    expect(isAllowedOrigin("http://topostack.generator.atommapps.com", env)).toBe(false);
    expect(isAllowedOrigin("https://example.com", env)).toBe(false);
    expect(isAllowedOrigin("https://runtime.atomm.com.evil.example", env)).toBe(false);
    expect(isAllowedOrigin("https://evil-atomm.com", env)).toBe(false);
  });

  it("accepts any loopback port only on the development Worker", () => {
    const development = { ...env, ENVIRONMENT: "development" };
    const production = { ...env, ENVIRONMENT: "production" };
    // The dev server relocates when its default port is taken, so the port is
    // not knowable ahead of time.
    expect(isAllowedOrigin("http://localhost:5291", development)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5291", development)).toBe(true);
    expect(isAllowedOrigin("http://[::1]:5291", development)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5291", production)).toBe(false);
    expect(isAllowedOrigin("http://localhost:5291", env)).toBe(false);
    // Loopback-looking hosts that are not loopback stay out, in every mode.
    expect(isAllowedOrigin("http://localhost.evil.example", development)).toBe(false);
    expect(isAllowedOrigin("https://localhost:5291", development)).toBe(false);
    expect(isAllowedOrigin("not a url", development)).toBe(false);
  });

  it("honors configured origin suffixes and keeps the suffix boundary", () => {
    const configured = { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: ".example.net" };
    expect(isAllowedOrigin("https://tools.example.net", configured)).toBe(true);
    expect(isAllowedOrigin("http://tools.example.net", configured)).toBe(false);
    expect(isAllowedOrigin("https://evil-example.net", configured)).toBe(false);
    expect(isAllowedOrigin("https://runtime.atomm.com", configured)).toBe(false);
    // An empty configuration revokes suffix-based origins entirely.
    expect(isAllowedOrigin("https://runtime.atomm.com", { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: "" })).toBe(false);
    // Suffixes without a leading dot still respect the label boundary.
    expect(isAllowedOrigin("https://runtime.atomm.com", { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: "atomm.com" })).toBe(true);
    expect(isAllowedOrigin("https://evil-atomm.com", { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: "atomm.com" })).toBe(false);
  });

  it("serves public reads and range preflights to any browser without credentials", async () => {
    for (const origin of ["https://topostack.generator.atommapps.com", "https://public-client.example", "null"]) {
      const response = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "range,if-none-match" } });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toBe("GET,HEAD,OPTIONS");
      expect(response.headers.get("access-control-allow-headers")).toContain("range");
      expect(response.headers.has("access-control-allow-credentials")).toBe(false);
      const manifest = await exports.default.fetch("http://example.com/v1/manifest", { headers: { origin } });
      expect(manifest.status).toBe(200);
      expect(manifest.headers.get("access-control-allow-origin")).toBe("*");
    }
    const missing = await exports.default.fetch("http://example.com/v1/missing", { headers: { origin: "https://public-client.example" } });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("keeps cross-origin event writes restricted and rejects writes to data routes", async () => {
    for (const method of ["OPTIONS", "POST"]) {
      const denied = await exports.default.fetch("http://example.com/v1/events", { method, headers: { origin: "https://public-client.example" } });
      expect(denied.status).toBe(403);
      expect(denied.headers.has("access-control-allow-origin")).toBe(false);
    }
    const write = await exports.default.fetch("http://example.com/v1/manifest", { method: "POST", headers: { origin: "https://public-client.example" } });
    expect(write.status).toBe(405);
  });

  it("does not call geocoding without a deployed provider key", async () => {
    const response = await exports.default.fetch("http://example.com/v1/geocode?q=Rainier", { headers: { origin: "http://localhost:5273" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Geocoder is not configured." });
  });

  it("reports missing required dependencies as not ready", async () => {
    expect(isGeocoderConfigured({ GEOCODER_API_KEY: "replace-with-geoapify-key" })).toBe(false);
    expect(isGeocoderConfigured({ GEOCODER_API_KEY: "configured-key" })).toBe(true);
    const response = await exports.default.fetch("http://example.com/ready", { headers: { origin: "http://localhost:5273" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      service: "topostack-map-api",
      status: "not_ready",
      dependencies: { geocoder: { status: "unconfigured" }, vectorData: { status: "missing", key: "osm/current.pmtiles" } },
    });
  });

  it("normalizes and filters managed geocoder responses", () => {
    expect(normalizeGeoapify({ results: [
      { place_id: "abc", formatted: "Mount Rainier, Washington", lat: 46.85, lon: -121.76, result_type: "natural" },
      { formatted: "Broken", lat: "invalid", lon: 1 },
      { formatted: "Out of range", lat: 91, lon: 1 },
      { formatted: "   ", lat: 1, lon: 1 },
      { formatted: "Coerced", lat: "46.85", lon: -121.76 },
    ] })).toEqual([{ place_id: "abc", display_name: "Mount Rainier, Washington", lat: 46.85, lon: -121.76, type: "natural" }]);
  });

  it("defaults non-numeric geocode limits instead of forwarding NaN", () => {
    expect(geocodeLimit(null)).toBe(5);
    expect(geocodeLimit("abc")).toBe(5);
    expect(geocodeLimit("")).toBe(5);
    expect(geocodeLimit("3")).toBe(3);
    expect(geocodeLimit("3.9")).toBe(3);
    expect(geocodeLimit("0")).toBe(1);
    expect(geocodeLimit("99")).toBe(8);
  });

  it("parses and validates byte ranges", () => {
    expect(parseRangeHeader(null, 100)).toEqual({ kind: "missing" });
    expect(parseRangeHeader("bytes=0-9", 100)).toEqual({ kind: "partial", offset: 0, length: 10 });
    expect(parseRangeHeader("bytes=90-", 100)).toEqual({ kind: "partial", offset: 90, length: 10 });
    expect(parseRangeHeader("bytes=-27", 100)).toEqual({ kind: "partial", offset: 73, length: 27 });
    expect(parseRangeHeader("bytes=-500", 100)).toEqual({ kind: "partial", offset: 0, length: 100 });
    expect(parseRangeHeader("bytes=0-999", 100)).toEqual({ kind: "partial", offset: 0, length: 100 });
    expect(parseRangeHeader("bytes=999999999999-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
    // Syntax errors are 400s: PMTiles clients read any 416 as an archive change.
    expect(parseRangeHeader("bytes=0-1,5-6", 100)).toEqual({ kind: "malformed" });
    expect(parseRangeHeader("bytes=abc", 100)).toEqual({ kind: "malformed" });
    expect(parseRangeHeader("bytes=-", 100)).toEqual({ kind: "malformed" });
    expect(parseRangeHeader("items=0-1", 100)).toEqual({ kind: "malformed" });
    expect(parseRangeHeader("bytes=9-1", 100)).toEqual({ kind: "malformed" });
    expect(parseRangeHeader("bytes=9-1", 0)).toEqual({ kind: "malformed" });
    expect(parseRangeHeader("bytes=0-16777216", 20_000_000)).toEqual({ kind: "too_large" });
    expect(parseRangeHeader("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("geocoder proxy", () => {
  const origin = { origin: "http://localhost:5273" };
  const configuredEnv = { ...workerEnv, GEOCODER_API_KEY: "test-provider-key" } as unknown as Env;
  const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("normalizes and returns a bounded provider response", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ results: [
      { place_id: "crater", formatted: "Crater Lake, Oregon", lat: 42.9446, lon: -122.109 },
      { formatted: "invalid", lat: "not-a-number", lon: -122 },
    ] }));
    vi.stubGlobal("fetch", upstream);
    const response = await mapWorker.fetch(new Request("http://example.com/v1/geocode?q=Crater%20Lake&limit=2", { headers: origin }), configuredEnv, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-topostack-cache")).toBe("MISS");
    expect(await response.json()).toEqual([
      { place_id: "crater", display_name: "Crater Lake, Oregon", lat: 42.9446, lon: -122.109 },
    ]);
    const requested = new URL(String(upstream.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("apiKey")).toBe("test-provider-key");
    expect(requested.searchParams.get("limit")).toBe("2");
  });

  // Shapes of real Geoapify answers (2026-09-25): the default search knows only
  // the town called Mount Rainier; `type=amenity` finds the mountain.
  const rainier = {
    default: { results: [{ place_id: "town", formatted: "Mount Rainier, MD, United States of America", lat: 38.936, lon: -76.96, result_type: "city", rank: { importance: 0.187 } }] },
    amenity: { results: [{ place_id: "peak", formatted: "Mount Rainier, Pierce County, WA, United States of America", lat: 46.852, lon: -121.758, result_type: "amenity", rank: { importance: 0.519 } }] },
  };
  const byType = (answers: { default: unknown; amenity: unknown }) => vi.fn(async (input: RequestInfo | URL) => {
    const answer = new URL(String(input)).searchParams.get("type") === "amenity" ? answers.amenity : answers.default;
    return answer instanceof Response ? answer : jsonResponse(answer);
  });

  it("searches named features too and puts the more important match first", async () => {
    const upstream = byType(rainier);
    vi.stubGlobal("fetch", upstream);
    const response = await mapWorker.fetch(new Request("http://example.com/v1/geocode?q=Mount%20Rainier%20ranking", { headers: origin }), configuredEnv, context);
    expect((await response.json<Array<{ place_id: string }>>()).map(({ place_id }) => place_id)).toEqual(["peak", "town"]);
    expect(upstream.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("type"))).toEqual([null, "amenity"]);
  });

  it("keeps a notable city above the features named after it", () => {
    const merged = mergeGeoapify([
      { results: [{ place_id: "city", formatted: "Denver, CO, United States of America", lat: 39.739, lon: -104.985, rank: { importance: 0.701 } }] },
      { results: [
        { place_id: "artwork", formatted: "Denver, 2314 Arapahoe Street, Denver, CO 80203", lat: 39.755, lon: -104.987, rank: { importance: 0 } },
        { place_id: "building", formatted: "CU Denver Building, 1401 Lawrence Street, Denver, CO", lat: 39.747, lon: -105 },
      ] },
    ], 5);
    expect(merged.map(({ place_id }) => place_id)).toEqual(["city", "artwork", "building"]);
  });

  it("drops a place both searches return and respects the limit", () => {
    const lake = { place_id: "tahoe", formatted: "Lake Tahoe, Placer County, CA", lat: 39.089, lon: -120.05, rank: { importance: 0.575 } };
    const copy = { ...lake, place_id: "tahoe-again", lat: 39.0891 };
    const others = Array.from({ length: 6 }, (_, index) => ({ place_id: `other-${index}`, formatted: `Lake Tahoe ${index}`, lat: index, lon: index, rank: { importance: 0.133 } }));
    const merged = mergeGeoapify([{ results: [lake, ...others] }, { results: [copy] }], 5);
    expect(merged.map(({ place_id }) => place_id)).toEqual(["tahoe", "other-0", "other-1", "other-2", "other-3"]);
  });

  it("answers from one search when the other fails, and fails only when both do", async () => {
    vi.stubGlobal("fetch", byType({ ...rainier, amenity: new Response("down", { status: 503 }) }));
    const partial = await mapWorker.fetch(new Request("http://example.com/v1/geocode?q=Mount%20Rainier%20partial", { headers: origin }), configuredEnv, context);
    expect(partial.status).toBe(200);
    expect((await partial.json<Array<{ place_id: string }>>()).map(({ place_id }) => place_id)).toEqual(["town"]);
    vi.stubGlobal("fetch", byType({ default: new Response("down", { status: 503 }), amenity: new Response("down", { status: 500 }) }));
    const failed = await mapWorker.fetch(new Request("http://example.com/v1/geocode?q=Mount%20Rainier%20outage", { headers: origin }), configuredEnv, context);
    expect(failed.status).toBe(502);
  });

  it("refreshes expired cached results and limits browser freshness to the remaining age", async () => {
    const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${configuredEnv.GEOCODER_ORIGIN}|geoapify-v2|cache age regression|5`));
    const key = `geocode/${Array.from(new Uint8Array(keyHash)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}.json`;
    const stored = [{ place_id: "cached", display_name: "Cached place", lat: 1, lon: 2 }];
    await workerEnv.MAP_CACHE.put(key, JSON.stringify(stored));
    const cached = await workerEnv.MAP_CACHE.head(key);
    const clock = vi.spyOn(Date, "now").mockReturnValue(cached!.uploaded.getTime() + 23 * 3600 * 1000);
    const upstream = vi.fn(async () => jsonResponse({ results: [{ formatted: "Fresh place", lat: 42, lon: -122 }] }));
    vi.stubGlobal("fetch", upstream);
    const request = () => new Request("http://example.com/v1/geocode?q=cache%20age%20regression", { headers: origin });
    const hit = await mapWorker.fetch(request(), configuredEnv, context);
    expect(hit.headers.get("x-topostack-cache")).toBe("HIT");
    expect(hit.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await hit.json()).toEqual(stored);
    expect(upstream).not.toHaveBeenCalled();
    clock.mockReturnValue(cached!.uploaded.getTime() + 25 * 3600 * 1000);
    const miss = await mapWorker.fetch(request(), configuredEnv, context);
    expect(miss.headers.get("x-topostack-cache")).toBe("MISS");
    expect(await miss.json()).toMatchObject([{ display_name: "Fresh place" }]);
    // The refresh searches twice (default and named features).
    expect(upstream).toHaveBeenCalledTimes(2);
    await Promise.all(vi.mocked(context.waitUntil).mock.calls.map(([promise]) => promise));
  });

  it("returns a gateway timeout when the provider stalls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    }));
    const response = await mapWorker.fetch(new Request("http://example.com/v1/geocode?q=Mount%20Mazama", { headers: origin }), configuredEnv, context);
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: "Geocoder timed out" });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

describe("terrain proxy", () => {
  const origin = { origin: "http://localhost:5273" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects invalid tile coordinates", async () => {
    const response = await exports.default.fetch("http://example.com/v1/terrain/16/0/0.png", { headers: origin });
    expect(response.status).toBe(400);
  });

  it.each(["x-imagery-sources", "x-amz-meta-x-imagery-sources"])("fetches and stores uncached terrain with %s provenance", async (imageryHeader) => {
    await workerEnv.MAP_CACHE.delete(`terrain/${workerEnv.DATASET_VERSION}/terrarium/11/321/702.png`);
    const png = terrainPng;
    const upstream = vi.fn(async (_input: RequestInfo | URL) => new Response(png.slice(), {
      headers: { "content-type": "image/png", [imageryHeader]: "mapzen/test-source" },
    }));
    vi.stubGlobal("fetch", upstream);
    const response = await exports.default.fetch("http://example.com/v1/terrain/11/321/702.png", { headers: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-topostack-cache")).toBe("MISS");
    expect(response.headers.get("x-topostack-dataset")).toBe(workerEnv.DATASET_VERSION);
    expect(response.headers.get("x-topostack-imagery-sources")).toBe("mapzen/test-source");
    expect(response.headers.has("accept-ranges")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0]?.[0])).toBe(`${workerEnv.TERRAIN_ORIGIN}/11/321/702.png`);
    await vi.waitFor(async () => {
      const stored = await workerEnv.MAP_CACHE.head(`terrain/${workerEnv.DATASET_VERSION}/terrarium/11/321/702.png`);
      expect(stored).not.toBeNull();
      expect(stored?.customMetadata?.dataset).toBe(workerEnv.DATASET_VERSION);
    });
  });

  it("serves cached tiles with their stored dataset label without calling upstream", async () => {
    const bytes = terrainPng;
    await workerEnv.MAP_CACHE.put(`terrain/${workerEnv.DATASET_VERSION}/terrarium/11/321/703.png`, bytes.slice(), {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { terrainValidation: "png-v1", provenance: "v2", dataset: "mapzen-terrarium+protomaps-legacy", imagerySources: "mapzen/stored-source" },
    });
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await exports.default.fetch("http://example.com/v1/terrain/11/321/703.png", { headers: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-topostack-cache")).toBe("HIT");
    expect(response.headers.get("x-topostack-dataset")).toBe("mapzen-terrarium+protomaps-legacy");
    expect(response.headers.get("x-topostack-imagery-sources")).toBe("mapzen/stored-source");
    expect(response.headers.has("accept-ranges")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns a gateway timeout when the terrain origin stalls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    }));
    const response = await exports.default.fetch("http://example.com/v1/terrain/11/321/704.png", { headers: origin });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: "Terrain origin timed out" });
  });

  it("rejects non-PNG terrain responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not a tile", {
      headers: { "content-type": "text/html" },
    })));
    const response = await exports.default.fetch("http://example.com/v1/terrain/11/321/705.png", { headers: origin });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "Terrain origin returned an invalid tile" });
  });
});

describe("vector archive", () => {
  const origin = { origin: "http://localhost:5273" };
  const archive = new Uint8Array(256).map((_, index) => index % 251);

  async function seedArchive(): Promise<void> {
    await workerEnv.VECTOR_DATA.put("osm/current.pmtiles", archive.slice());
  }

  it("allows metadata reads but rejects unbounded archive downloads", async () => {
    await seedArchive();
    const head = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { method: "HEAD", headers: origin });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("256");
    expect(head.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(head.headers.get("cache-control")).not.toContain("immutable");
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(head.headers.get("etag")).toBeTruthy();

    const full = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: origin });
    expect(full.status).toBe(400);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(await full.json()).toMatchObject({ error: "A bounded Range header is required for PMTiles archives." });
  });

  it("revalidates by etag with 304", async () => {
    await seedArchive();
    const first = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { method: "HEAD", headers: origin });
    const etag = first.headers.get("etag") ?? "";
    await first.body?.cancel();
    const revalidated = await exports.default.fetch("http://example.com/v1/osm.pmtiles", {
      headers: { ...origin, "if-none-match": etag },
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("etag")).toBe(etag);
  });

  it("serves single and suffix ranges with correct content-range headers", async () => {
    await seedArchive();
    const single = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=0-126" } });
    expect(single.status).toBe(206);
    expect(single.headers.get("content-range")).toBe("bytes 0-126/256");
    expect(single.headers.get("content-length")).toBe("127");
    expect(new Uint8Array(await single.arrayBuffer())).toEqual(archive.slice(0, 127));

    const suffix = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=-27" } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 229-255/256");
    expect(suffix.headers.get("content-length")).toBe("27");
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(archive.slice(229));
  });

  it("answers unsatisfiable ranges with 416 but malformed and multipart ranges with 400", async () => {
    await seedArchive();
    const unsatisfiable = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=999999999999-" } });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */256");

    for (const range of ["bytes=0-1,5-6", "bytes=abc", "bytes=9-1"]) {
      const malformed = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range } });
      expect(malformed.status).toBe(400);
      expect(malformed.headers.has("content-range")).toBe(false);
      expect(await malformed.json()).toMatchObject({ error: expect.stringContaining("single bytes=start-end range") });
    }
  });
});

describe("lake bathymetry archive", () => {
  const origin = { origin: "http://localhost:5273" };
  const archive = new Uint8Array(128).map((_, index) => (index * 7) % 251);

  it("serves the archive and its ranges, which is all the PMTiles client asks of it", async () => {
    await workerEnv.VECTOR_DATA.put("lakes/current.pmtiles", archive.slice());

    const full = await exports.default.fetch("http://example.com/v1/lakes.pmtiles", { headers: origin });
    expect(full.status).toBe(400);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(await full.json()).toMatchObject({ error: "A bounded Range header is required for PMTiles archives." });

    // The browser never downloads the whole archive - it range-reads the header,
    // then the directory, then the handful of tiles the map window covers.
    const ranged = await exports.default.fetch("http://example.com/v1/lakes.pmtiles", { headers: { ...origin, range: "bytes=0-16" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 0-16/128");
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(archive.slice(0, 17));
  });

  it("reports a missing lake archive as 404 instead of fabricating depth data", async () => {
    await workerEnv.VECTOR_DATA.delete("lakes/current.pmtiles");
    const response = await exports.default.fetch("http://example.com/v1/lakes.pmtiles", { headers: origin });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Lake bathymetry archive has not been provisioned." });
  });

  it("requires lake data for default-project readiness", async () => {
    await workerEnv.VECTOR_DATA.put("osm/current.pmtiles", archive.slice());
    await workerEnv.VECTOR_DATA.delete("lakes/current.pmtiles");
    const configured = { ...workerEnv, GEOCODER_API_KEY: "test-provider-key" } as unknown as Env;
    const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    const response = await mapWorker.fetch(new Request("http://example.com/ready", { headers: origin }), configured, context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ dependencies: { lakeData: { status: "missing", key: "lakes/current.pmtiles" } } });
    await workerEnv.VECTOR_DATA.put("lakes/current.pmtiles", archive.slice());
    await workerEnv.VECTOR_DATA.put(`lake-outlines/${outlineRelease.index.file}`, new Uint8Array(outlineRelease.index.bytes), { customMetadata: { sha256: outlineRelease.index.sha256 } });
    const ready = await mapWorker.fetch(new Request("http://example.com/ready", { headers: origin }), configured, context);
    expect(ready.status).toBe(200);
  });
});


describe.each(["noaa-great-lakes-v1", "usgs-crater-lake-v1", "usgs-lake-tahoe-v1", "usgs-mono-lake-v1", "mn-dnr-lakes-v1", "swissbathy3d-v1", "syke-finland-lakes-v1"])("%s bathymetry archive", (dataset) => {
  const url = `http://example.com/v1/bathymetry/${dataset}.pmtiles`;
  const key = `bathymetry/${dataset}.pmtiles`;
  const origin = { origin: "http://localhost:5273" };
  it("serves bounded byte ranges with cache validators and handles missing data", async () => {
    await workerEnv.VECTOR_DATA.delete(key);
    expect((await exports.default.fetch(url, { headers: origin })).status).toBe(404);
    await workerEnv.VECTOR_DATA.put(key, new Uint8Array([1, 2, 3, 4]));
    // The 404 is memoized briefly; skip that window instead of waiting it out.
    resetArchiveHeadCache();
    const response = await exports.default.fetch(url, { headers: { ...origin, range: "bytes=1-2" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3]));
    expect(response.headers.get("etag")).toBeTruthy();
    expect((await exports.default.fetch(url, { headers: origin })).status).toBe(400);
    expect((await exports.default.fetch(url, { method: "HEAD", headers: origin })).headers.get("content-length")).toBe("4");
    await workerEnv.VECTOR_DATA.delete(key);
  });
});

describe("optional HRDEM terrain archive", () => {
  const key = "terrain-sources/nrcan-hrdem-alexander-v1.pmtiles";
  const url = `http://example.com/v1/${key}`;
  it("serves bounded archive ranges with strong etags", async () => {
    await workerEnv.VECTOR_DATA.put(key, new Uint8Array(200));
    const response = await exports.default.fetch(url, { headers: { range: "bytes=0-126" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-126/200");
    expect(response.headers.get("etag")).toBeTruthy();
    expect((await response.arrayBuffer()).byteLength).toBe(127);
    await workerEnv.VECTOR_DATA.delete(key);
  });
  it("reports missing archives and rejects unregistered source paths", async () => {
    await workerEnv.VECTOR_DATA.delete(key);
    expect((await exports.default.fetch(url)).status).toBe(404);
    expect((await exports.default.fetch("http://example.com/v1/terrain-sources/unknown-v1.pmtiles")).status).toBe(404);
  });
  it("advertises regional HRDEM coverage as optional", async () => {
    const response = await exports.default.fetch("http://example.com/v1/manifest");
    const manifest = await response.json() as { sources: unknown[] };
    expect(manifest.sources).toContainEqual(expect.objectContaining({ id: "nrcan-hrdem-alexander-v1", optional: true, verticalDatum: "CGVD2013" }));
  });
});
