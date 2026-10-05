import { BodyTooLargeError, readBounded } from "../body";
import { headCache, readCache, writeCache } from "../cache";
import { clientKey, json, rateLimitExceeded, upstreamFailure, upstreamSignal } from "../http";

const MAX_GEOCODER_BYTES = 256_000;
const GEOCODE_CACHE_SECONDS = 60 * 60 * 24;
// Empty answers are often transient (partial queries, provider hiccups); keep
// them out of R2 and let browsers hold them only briefly.
const EMPTY_GEOCODE_CACHE_SECONDS = 5 * 60;
// Missing Origin headers are allowed and CORS is not access control, so a
// shared budget caps provider spend across every client. It has its own
// GEOCODE_GLOBAL_LIMITER binding so generic request traffic cannot drain it.
// Ratelimit bindings count per Cloudflare location, not account-wide: this is
// a per-colo ceiling, and the provider-side daily cap configured in the
// Geoapify dashboard remains the real spend limit.
const GEOCODE_GLOBAL_LIMIT_KEY = "geocode-global";

interface GeoapifyResult { lat?: unknown; lon?: unknown; formatted?: unknown; place_id?: unknown; result_type?: unknown; rank?: { importance?: unknown } }

function geoapifyResults(payload: unknown): GeoapifyResult[] {
  return payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results) ? (payload as { results: GeoapifyResult[] }).results : [];
}

/** Geoapify's id, or one made from the position when it sends none; the merge matches places back to results by it. */
function geoapifyPlaceId(item: GeoapifyResult | undefined, index: number): string {
  return String(item?.place_id ?? (String(item?.lat) + "," + String(item?.lon) + "," + String(index)));
}

export function normalizeGeoapify(payload: unknown): Array<{ place_id: string; display_name: string; lat: number; lon: number; type?: string }> {
  return geoapifyResults(payload).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const lat = item.lat;
    const lon = item.lon;
    const label = typeof item.formatted === "string" ? item.formatted.trim() : "";
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -85.0511 || lat > 85.0511 || typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180 || !label) return [];
    return [{ place_id: geoapifyPlaceId(item, index), display_name: label, lat, lon, ...(typeof item.result_type === "string" ? { type: item.result_type } : {}) }];
  });
}

/**
 * Geoapify's default search favors populated places, so "Mount Rainier" finds
 * only the town in Maryland and "Grand Canyon" a housing estate in Indonesia.
 * The route also asks for named features (`type=amenity`, which covers peaks,
 * lakes and canyons) and orders the union by Geoapify's own `rank.importance`,
 * which puts the mountain first while Denver the city still beats a Denver
 * artwork. Ties keep the provider's order; duplicates keep their first copy.
 */
export function mergeGeoapify(payloads: unknown[], limit: number): ReturnType<typeof normalizeGeoapify> {
  const ranked: Array<{ place: ReturnType<typeof normalizeGeoapify>[number]; importance: number; order: number }> = [];
  const seen = new Set<string>();
  for (const payload of payloads) {
    const places = normalizeGeoapify(payload);
    // normalizeGeoapify drops invalid results, so match each place back to its raw result by id.
    const importanceById = new Map(geoapifyResults(payload).map((item, index) => [geoapifyPlaceId(item, index), typeof item?.rank?.importance === "number" && Number.isFinite(item.rank.importance) ? item.rank.importance : 0]));
    for (const place of places) {
      const duplicate = [place.place_id, `${place.display_name.toLowerCase()}|${place.lat.toFixed(2)}|${place.lon.toFixed(2)}`];
      if (duplicate.some((key) => seen.has(key))) continue;
      duplicate.forEach((key) => seen.add(key));
      ranked.push({ place, importance: importanceById.get(place.place_id) ?? 0, order: ranked.length });
    }
  }
  return ranked.sort((a, b) => b.importance - a.importance || a.order - b.order).slice(0, limit).map(({ place }) => place);
}

/** Longer queries are cut to this many characters. */
export const GEOCODE_QUERY_MAX_CHARS = 160;
/** Results per search; the REST route clamps `limit` to 1 through this. */
export const GEOCODE_MAX_RESULTS = 8;
export const GEOCODE_DEFAULT_RESULTS = 5;

export function geocodeLimit(value: string | null): number {
  if (value === null || value.trim() === "") return GEOCODE_DEFAULT_RESULTS;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(GEOCODE_MAX_RESULTS, Math.trunc(parsed))) : GEOCODE_DEFAULT_RESULTS;
}

export function isGeocoderConfigured(env: Pick<Env, "GEOCODER_API_KEY">): boolean {
  return Boolean(env.GEOCODER_API_KEY && env.GEOCODER_API_KEY !== "replace-with-geoapify-key");
}

/** Case and whitespace variants of one query share a cache entry. */
function normalizeGeocodeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** `query` must already be normalized by normalizeGeocodeQuery. */
async function cacheKey(env: Env, query: string, limit: number): Promise<string> {
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.GEOCODER_ORIGIN}|geoapify-v2|${query}|${limit}`));
  return `geocode/${Array.from(new Uint8Array(keyHash)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}.json`;
}

function jsonHeaders(maxAge: number, cache: string): Headers {
  return new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}`, "x-topostack-cache": cache });
}

export interface GeocodeOptions {
  /** Skip the R2 result cache in both directions (health probes). */
  bypassCache?: boolean;
  /** Skip the public per-client and shared limiters (the internal hourly probe). */
  bypassLimits?: boolean;
}

function freshSeconds(object: R2Object): number {
  return GEOCODE_CACHE_SECONDS - Math.max(0, (Date.now() - object.uploaded.getTime()) / 1000);
}

// Entries of "[]" predate the empty-result policy and are refreshed.
function isServable(object: R2Object): boolean {
  return freshSeconds(object) > 0 && object.size > 2;
}

/**
 * HEAD never reaches the provider or spends the geocode budgets: it reports a
 * fresh cached answer by metadata, otherwise an unverified 200 that no cache
 * may keep. Only GET pays for a provider lookup.
 */
async function geocodeHeadResponse(env: Env, key: string): Promise<Response> {
  const cached = await headCache(env.MAP_CACHE, key, "geocoder");
  if (cached && isServable(cached)) return new Response(null, { headers: jsonHeaders(Math.floor(freshSeconds(cached)), "HIT") });
  if (!isGeocoderConfigured(env)) return json({ error: "Geocoder is not configured." }, { status: 503 });
  return new Response(null, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-topostack-cache": "MISS" } });
}

/** One Geoapify search, validated and parsed; failures come back as the route's error response. */
async function searchGeoapify(request: Request, env: Env, apiKey: string, query: string, limit: number, type?: string): Promise<{ payload: unknown } | Response> {
  const upstreamUrl = new URL("/v1/geocode/search", env.GEOCODER_ORIGIN);
  upstreamUrl.searchParams.set("text", query);
  upstreamUrl.searchParams.set("limit", String(limit));
  upstreamUrl.searchParams.set("format", "json");
  if (type) upstreamUrl.searchParams.set("type", type);
  upstreamUrl.searchParams.set("apiKey", apiKey);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: { "accept": "application/json" }, signal: upstreamSignal(request) });
  } catch (error) {
    return upstreamFailure(error, "Geocoder");
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return json({ error: "Geocoder unavailable", status: upstream.status }, { status: 502 });
  }
  const contentLength = Number(upstream.headers.get("content-length") ?? 0);
  if (contentLength > MAX_GEOCODER_BYTES) {
    await upstream.body?.cancel();
    return json({ error: "Geocoder response too large" }, { status: 502 });
  }
  let body: Uint8Array;
  try { body = await readBounded(upstream.body, MAX_GEOCODER_BYTES); }
  catch (error) {
    if (error instanceof BodyTooLargeError) return json({ error: "Geocoder response too large" }, { status: 502 });
    return upstreamFailure(error, "Geocoder");
  }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ error: "Geocoder returned invalid JSON" }, { status: 502 }); }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
    return json({ error: "Geocoder returned an unexpected response" }, { status: 502 });
  }
  return { payload };
}

export async function geocodeResponse(request: Request, env: Env, ctx: ExecutionContext, url: URL, options: GeocodeOptions = {}): Promise<Response> {
  const { bypassCache = false, bypassLimits = false } = options;
  const query = normalizeGeocodeQuery(url.searchParams.get("q") ?? "").slice(0, GEOCODE_QUERY_MAX_CHARS).trim();
  const limit = geocodeLimit(url.searchParams.get("limit"));
  if (query.length < 2) return json({ error: "Query must contain at least two characters." }, { status: 400 });
  const key = await cacheKey(env, query, limit);
  if (request.method === "HEAD") return geocodeHeadResponse(env, key);
  const cached = bypassCache ? null : await readCache(env.MAP_CACHE, key, "geocoder");
  if (cached && isServable(cached)) {
    return new Response(cached.body, { headers: jsonHeaders(Math.floor(freshSeconds(cached)), "HIT") });
  }
  if (cached) await cached.body.cancel();

  const apiKey = env.GEOCODER_API_KEY;
  if (!apiKey || !isGeocoderConfigured(env)) return json({ error: "Geocoder is not configured." }, { status: 503 });
  if (!bypassLimits) {
    // Per-client first: a rejected client must not also spend the shared budget,
    // otherwise one caller spamming past its own limit drains search for every
    // client in the colo. The cost is that a request refused by the shared
    // budget has already used one per-client token.
    const perClient = await env.GEOCODE_LIMITER.limit({ key: `${clientKey(request)}:geocode` });
    if (!perClient.success) return rateLimitExceeded("Place-search rate limit exceeded. Try again shortly.");
    const global = await env.GEOCODE_GLOBAL_LIMITER.limit({ key: GEOCODE_GLOBAL_LIMIT_KEY });
    if (!global.success) {
      console.warn(JSON.stringify({ message: "geocode_global_budget_exceeded" }));
      return rateLimitExceeded("Place search is busy. Try again shortly.");
    }
  }
  const answers = await Promise.all([undefined, "amenity"].map((type) => searchGeoapify(request, env, apiKey, query, limit, type)));
  const payloads = answers.filter((answer): answer is { payload: unknown } => !(answer instanceof Response));
  // One failed search still leaves a usable list; only when both fail does the caller see the error.
  const failures = answers.filter((answer): answer is Response => answer instanceof Response);
  if (!payloads.length) {
    await failures[1]?.body?.cancel();
    return failures[0]!;
  }
  for (const failure of failures) await failure.body?.cancel();
  const normalized = mergeGeoapify(payloads.map(({ payload }) => payload), limit);
  const normalizedBody = JSON.stringify(normalized);
  const cacheLabel = bypassCache ? "BYPASS" : "MISS";
  if (normalized.length === 0) return new Response(normalizedBody, { headers: jsonHeaders(EMPTY_GEOCODE_CACHE_SECONDS, cacheLabel) });
  if (!bypassCache) writeCache(ctx, "geocoder", () => env.MAP_CACHE.put(key, normalizedBody, { httpMetadata: { contentType: "application/json", cacheControl: `public, max-age=${GEOCODE_CACHE_SECONDS}` } }));
  return new Response(normalizedBody, { headers: jsonHeaders(GEOCODE_CACHE_SECONDS, cacheLabel) });
}
