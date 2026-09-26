import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { BodyTooLargeError, readBounded } from "../body";
import { headCache, readCache, writeCache } from "../cache";
import { edgeCacheKey, matchEdge, putEdge, teeToEdge } from "../edge-cache";
import { etagMatches, json, rateLimitExceeded, upstreamFailure, upstreamSignal } from "../http";

const MAX_TERRAIN_BYTES = 2_000_000;
// R2 keys are versioned; public tile URLs are mutable across deployments.
const TERRAIN_CACHE_SECONDS = 60 * 60;
const MAX_PROVENANCE_HEADER_CHARS = 1900;
// Bump when the metadata stored with a cached tile changes meaning. Entries
// without the current marker are refetched lazily and overwritten; v2 marks
// tiles whose provenance includes the S3 `x-amz-meta-*` fallback.
const TERRAIN_PROVENANCE_VERSION = "v2";

export interface Tile { z: number; x: number; y: number }

export function validTile(zText: string, xText: string, yText: string): Tile | null {
  const z = Number(zText);
  const x = Number(xText);
  const y = Number(yText);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 15) return null;
  const limit = 2 ** z;
  if (x < 0 || y < 0 || x >= limit || y >= limit) return null;
  return { z, x, y };
}

function terrainKey(env: Env, tile: Tile): string {
  return `terrain/${env.DATASET_VERSION}/terrarium/${tile.z}/${tile.x}/${tile.y}.png`;
}

/** Versioned like the R2 key, plus the provenance marker, so a bump never serves an older edge entry. */
function terrainEdgeKey(request: Request, env: Env, tile: Tile): string {
  return edgeCacheKey(request, `terrain/${encodeURIComponent(env.DATASET_VERSION)}/${TERRAIN_PROVENANCE_VERSION}/${tile.z}/${tile.x}/${tile.y}.png`);
}

/** Edge entries are stored with the headers of the response that filled them. */
function edgeHeaders(edge: Response): Headers {
  const headers = new Headers(edge.headers);
  headers.set("x-topostack-cache", "EDGE");
  return headers;
}

function isCurrentEntry(metadata: Record<string, string> | undefined): boolean {
  return metadata?.terrainValidation === "png-v1" && metadata.provenance === TERRAIN_PROVENANCE_VERSION;
}

/** The single header builder for every terrain response: hit, miss, stale and 304. */
function terrainHeaders(options: { etag: string; dataset: string; imagerySources?: string; cache: string; size: number }): Headers {
  const headers = new Headers({
    "content-type": "image/png",
    "content-length": String(options.size),
    "etag": options.etag,
    "cache-control": `public, max-age=${TERRAIN_CACHE_SECONDS}, must-revalidate`,
    "x-topostack-cache": options.cache,
    "x-topostack-dataset": options.dataset,
  });
  const sources = options.imagerySources?.slice(0, MAX_PROVENANCE_HEADER_CHARS);
  if (sources) headers.set("x-topostack-imagery-sources", sources);
  return headers;
}

function cachedHeaders(object: R2Object, env: Env, cache: string): Headers {
  return terrainHeaders({ etag: object.httpEtag, dataset: object.customMetadata?.dataset ?? env.DATASET_VERSION, imagerySources: object.customMetadata?.imagerySources, cache, size: object.size });
}

/** R2 conditionals take one bare etag; lists and wildcards fall back to a full read. */
function singleEtag(ifNoneMatch: string | null): string | null {
  if (!ifNoneMatch) return null;
  const match = /^\s*(?:W\/)?"([^",]+)"\s*$/.exec(ifNoneMatch);
  return match?.[1] ?? null;
}

// R2 stores single-part uploads under the MD5 of their bytes, so a miss can
// advertise the same validator its cached copy will carry.
async function r2Etag(body: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("MD5", body);
  return `"${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

function readTerrainCache(request: Request, env: Env, key: string): Promise<R2Object | R2ObjectBody | null> {
  const etag = singleEtag(request.headers.get("if-none-match"));
  return etag ? readCache(env.MAP_CACHE, key, "terrain", { etagDoesNotMatch: etag }) : readCache(env.MAP_CACHE, key, "terrain");
}

async function fetchUpstreamTile(request: Request, env: Env, tile: Tile): Promise<Response | { body: Uint8Array<ArrayBuffer>; imagerySources: string }> {
  let upstream: Response;
  try {
    upstream = await fetch(`${env.TERRAIN_ORIGIN}/${tile.z}/${tile.x}/${tile.y}.png`, {
      headers: { "user-agent": "TopoStack/0.1 (terrain fabrication generator)" },
      signal: upstreamSignal(request),
    });
  } catch (error) {
    return upstreamFailure(error, "Terrain origin");
  }
  if (upstream.status !== 200 || !upstream.body) {
    await upstream.body?.cancel();
    return json({ error: "Terrain tile unavailable", status: upstream.status }, { status: 502 });
  }
  const contentLength = Number(upstream.headers.get("content-length") ?? 0);
  const contentType = upstream.headers.get("content-type") ?? "";
  if ((contentLength > 0 && contentLength > MAX_TERRAIN_BYTES) || !contentType.includes("image/png")) {
    await upstream.body.cancel();
    return json({ error: "Terrain origin returned an invalid tile" }, { status: 502 });
  }
  const imagerySources = upstream.headers.get("x-imagery-sources") ?? upstream.headers.get("x-amz-meta-x-imagery-sources") ?? "";
  let body: Uint8Array<ArrayBuffer>;
  try { body = await readBounded(upstream.body, MAX_TERRAIN_BYTES); }
  catch (error) {
    if (error instanceof BodyTooLargeError) return json({ error: "Terrain origin returned an oversized tile" }, { status: 502 });
    return upstreamFailure(error, "Terrain origin");
  }
  try { decodeTerrainPng(body); }
  catch { return json({ error: "Terrain origin returned an invalid tile" }, { status: 502 }); }
  return { body, imagerySources };
}

/** Serves a previously validated tile when its refresh cannot reach the origin. */
async function staleResponse(env: Env, key: string, stale: R2Object | null): Promise<Response | null> {
  if (stale?.customMetadata?.terrainValidation !== "png-v1") return null;
  const object = await readCache(env.MAP_CACHE, key, "terrain");
  if (!object || object.httpEtag !== stale.httpEtag) { await object?.body.cancel(); return null; }
  console.warn(JSON.stringify({ message: "terrain_stale_served", reason: "refresh_failed" }));
  return new Response(object.body, { headers: cachedHeaders(object, env, "STALE") });
}

function hasBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return "body" in object;
}

function notModified(headers: Headers): Response {
  headers.delete("content-length");
  return new Response(null, { status: 304, headers });
}

export interface TerrainOptions {
  bypassCache?: boolean;
  /** Called only before an upstream fetch; returns false when the caller is over its budget. */
  admitUpstream?: () => Promise<boolean>;
}

/**
 * HEAD is answered from R2 metadata only, so probes never cost an origin fetch,
 * PNG decode or cache write. The caller charges the per-client request budget
 * first because each HEAD still costs one R2 read.
 */
async function terrainHeadResponse(request: Request, env: Env, key: string, edgeKey: string): Promise<Response> {
  const edge = await matchEdge(edgeKey);
  if (edge) {
    await edge.body?.cancel();
    const headers = edgeHeaders(edge);
    return etagMatches(request.headers.get("if-none-match"), headers.get("etag") ?? "") ? notModified(headers) : new Response(null, { headers });
  }
  const object = await headCache(env.MAP_CACHE, key, "terrain");
  if (object && isCurrentEntry(object.customMetadata)) {
    const headers = cachedHeaders(object, env, "HIT");
    return etagMatches(request.headers.get("if-none-match"), object.httpEtag) ? notModified(headers) : new Response(null, { headers });
  }
  // Uncached tile: 200 means "addressable", not "a GET will succeed". The origin
  // has not been contacted, so a later GET may still answer 502/504. Clients
  // must read `x-topostack-cache: MISS` as "unverified". RFC 9110 section 9.3.2
  // lets HEAD omit fields (etag, length) only known after generating content,
  // and no-store keeps shared caches from pinning this validator-less answer.
  return new Response(null, { headers: {
    "content-type": "image/png",
    "cache-control": "no-store",
    "x-topostack-cache": "MISS",
    "x-topostack-dataset": env.DATASET_VERSION,
  } });
}

export async function terrainResponse(request: Request, env: Env, ctx: ExecutionContext, tile: Tile, options: TerrainOptions = {}): Promise<Response> {
  const key = terrainKey(env, tile);
  const edgeKey = terrainEdgeKey(request, env, tile);
  if (request.method === "HEAD") return terrainHeadResponse(request, env, key, edgeKey);
  const edge = options.bypassCache ? null : await matchEdge(edgeKey);
  if (edge?.body) {
    const headers = edgeHeaders(edge);
    if (etagMatches(request.headers.get("if-none-match"), headers.get("etag") ?? "")) {
      await edge.body.cancel();
      return notModified(headers);
    }
    return new Response(edge.body, { headers });
  }
  const cached = options.bypassCache ? null : await readTerrainCache(request, env, key);
  if (cached && isCurrentEntry(cached.customMetadata)) {
    if (!hasBody(cached)) return notModified(cachedHeaders(cached, env, "HIT"));
    if (etagMatches(request.headers.get("if-none-match"), cached.httpEtag)) {
      await cached.body.cancel();
      return notModified(cachedHeaders(cached, env, "HIT"));
    }
    const headers = cachedHeaders(cached, env, "HIT");
    return new Response(teeToEdge(ctx, edgeKey, cached.body, headers), { headers });
  }
  // Legacy or unvalidated entries are misses; keep their metadata for a stale fallback.
  if (cached && hasBody(cached)) await cached.body.cancel();

  if (options.admitUpstream && !(await options.admitUpstream())) {
    return (await staleResponse(env, key, cached)) ?? rateLimitExceeded();
  }
  const fetched = await fetchUpstreamTile(request, env, tile);
  if (fetched instanceof Response) {
    const stale = await staleResponse(env, key, cached);
    if (stale) { await fetched.body?.cancel(); return stale; }
    return fetched;
  }
  const { body, imagerySources } = fetched;
  const etag = await r2Etag(body);
  if (!options.bypassCache) writeCache(ctx, "terrain", () => env.MAP_CACHE.put(key, body, {
    httpMetadata: { contentType: "image/png", cacheControl: `public, max-age=${TERRAIN_CACHE_SECONDS}` },
    customMetadata: {
      terrainValidation: "png-v1",
      provenance: TERRAIN_PROVENANCE_VERSION,
      dataset: env.DATASET_VERSION,
      cachedAt: new Date().toISOString(),
      imagerySources: imagerySources.slice(0, MAX_PROVENANCE_HEADER_CHARS),
    },
  }));
  const headers = terrainHeaders({ etag, dataset: env.DATASET_VERSION, imagerySources, cache: options.bypassCache ? "BYPASS" : "MISS", size: body.byteLength });
  if (!options.bypassCache) putEdge(ctx, edgeKey, new Response(body.slice(), { headers }));
  if (etagMatches(request.headers.get("if-none-match"), etag)) return notModified(headers);
  return new Response(body, { headers });
}
