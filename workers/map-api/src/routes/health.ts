import { OUTLINE_INDEX_KEY, outlineReadiness } from "./lake-outlines";
import { archiveHead } from "../archive-head";
import { json } from "../http";
import { LAKE_ARCHIVE_KEY, VECTOR_ARCHIVE_KEY } from "./archive";
import { geocodeResponse, isGeocoderConfigured } from "./geocode";
import { terrainResponse } from "./terrain";

const UPSTREAM_HEALTH_KEY = "health/upstreams-v1.json";
const MAX_HEALTH_RECORD_BYTES = 4096;
const HEALTH_FRESH_MS = 2 * 60 * 60 * 1000;

export function healthResponse(env: Env): Response {
  return json({ service: "topostack-map-api", status: "ok", environment: env.ENVIRONMENT });
}

export async function readinessResponse(env: Env): Promise<Response> {
  // Readiness resolves releases directly rather than through the range-read memo.
  const [vectorCheck, lakeCheck, outlineCheck] = await Promise.allSettled([
    archiveHead(env.VECTOR_DATA, VECTOR_ARCHIVE_KEY),
    archiveHead(env.VECTOR_DATA, LAKE_ARCHIVE_KEY),
    outlineReadiness(env.VECTOR_DATA),
  ]);
  const vectorArchive = vectorCheck.status === "fulfilled" ? vectorCheck.value.head : null;
  const lakeArchive = lakeCheck.status === "fulfilled" ? lakeCheck.value.head : null;
  const geocoderConfigured = isGeocoderConfigured(env);
  const ready = Boolean(vectorArchive && lakeArchive && outlineCheck.status === "fulfilled" && outlineCheck.value && geocoderConfigured);
  return json({
    service: "topostack-map-api",
    status: ready ? "ready" : "not_ready",
    environment: env.ENVIRONMENT,
    dependencies: {
      lakeOutlines: { status: outlineCheck.status === "rejected" ? "unavailable" : outlineCheck.value ? "available" : "missing", key: OUTLINE_INDEX_KEY },
      terrain: { status: "configured" },
      geocoder: { status: geocoderConfigured ? "configured" : "unconfigured" },
      vectorData: {
        status: vectorCheck.status === "rejected" ? "unavailable" : vectorArchive ? "available" : "missing",
        key: VECTOR_ARCHIVE_KEY,
        ...(vectorCheck.status === "fulfilled" && vectorCheck.value.release ? { release: vectorCheck.value.release } : {}),
        ...(vectorArchive ? { bytes: vectorArchive.size, etag: vectorArchive.httpEtag } : {}),
      },
      // Default projects request water depth, so readiness requires both archives.
      lakeData: {
        status: lakeCheck.status === "rejected" ? "unavailable" : lakeArchive ? "available" : "missing",
        key: LAKE_ARCHIVE_KEY,
        ...(lakeCheck.status === "fulfilled" && lakeCheck.value.release ? { release: lakeCheck.value.release } : {}),
        ...(lakeArchive ? { bytes: lakeArchive.size, etag: lakeArchive.httpEtag } : {}),
      },
    },
  }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}

export async function upstreamHealth(env: Env): Promise<Response> {
  const stored = await env.MAP_CACHE.get(UPSTREAM_HEALTH_KEY);
  if (!stored) return json({ status: "unknown", error: "No upstream probe has completed." }, { status: 503 });
  if (stored.size > MAX_HEALTH_RECORD_BYTES) { await stored.body.cancel(); return json({ status: "invalid" }, { status: 503 }); }
  let result: { checkedAt?: unknown; ok?: unknown; environment?: unknown };
  try {
    const parsed: unknown = await stored.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Upstream health record is not an object.");
    result = parsed as typeof result;
  } catch {
    console.warn(JSON.stringify({ message: "upstream_health_invalid" }));
    return json({ status: "invalid" }, { status: 503 });
  }
  const age = Date.now() - Date.parse(String(result.checkedAt));
  const fresh = Number.isFinite(age) && age >= 0 && age < HEALTH_FRESH_MS;
  return json({ ...result, status: fresh && result.ok === true ? "healthy" : "unhealthy", fresh }, {
    status: fresh && result.ok === true ? 200 : 503, headers: { "cache-control": "no-store" },
  });
}

/** Hourly cron: probes origins directly, never through or into the data caches. */
export async function probeUpstreams(env: Env, ctx: ExecutionContext): Promise<void> {
  const checks = [
    { source: "terrain", run: () => terrainResponse(new Request("https://probe.invalid/v1/terrain/0/0/0.png"), env, ctx, { z: 0, x: 0, y: 0 }, { bypassCache: true }) },
    { source: "geocoder", run: () => {
      const url = new URL("https://probe.invalid/v1/geocode?q=Crater%20Lake&limit=1");
      // The probe is internal and hourly: public limiters would report a busy colo as an outage.
      return geocodeResponse(new Request(url), env, ctx, url, { bypassCache: true, bypassLimits: true });
    } },
  ];
  const results = await Promise.all(checks.map(async ({ source, run }) => {
    const start = Date.now();
    try {
      const response = await run();
      let ok = response.ok;
      if (ok && source === "geocoder") ok = (await response.json<unknown[]>()).length > 0;
      else await response.body?.cancel();
      return { source, ok, status: response.status, durationMs: Date.now() - start };
    } catch { return { source, ok: false, status: 0, durationMs: Date.now() - start }; }
  }));
  const snapshot = { checkedAt: new Date().toISOString(), environment: env.ENVIRONMENT, ok: results.every((result) => result.ok), results };
  console.log(JSON.stringify({ message: "upstream_probe", ...snapshot }));
  await env.MAP_CACHE.put(UPSTREAM_HEALTH_KEY, JSON.stringify(snapshot), { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
  if (!snapshot.ok) throw new Error("An uncached upstream probe failed.");
}
