import packageJson from "../package.json";
import { coverageRouteResponse, projectRouteResponse, type AgentContext } from "./agent/projects";
import { openApiDocument } from "./agent/openapi";
import { MCP_PATH, mcpResponse, serverCard } from "./mcp/server";
import { OUTLINE_INDEX_FILE, OUTLINE_PATH, outlineResponse } from "./routes/lake-outlines";
import { PREVIEW_PATH, previewResponse } from "./routes/lake-previews";
import { measureBucket } from "./data-metrics";
import { clientKey, corsHeaders, isAllowedOrigin, json, rateLimitExceeded, withCors } from "./http";
import { buildManifest } from "./manifest";
import { ARCHIVE_ROUTES, bathymetryArchives, type ArchiveRoute, isArchiveMetadataRequest, parseRangeHeader, pmtilesResponse, terrainArchives } from "./routes/archive";
import { FEEDBACK_PATH, feedbackResponse } from "./routes/feedback";
import { geocodeLimit, geocodeResponse, isGeocoderConfigured, normalizeGeoapify } from "./routes/geocode";
import { healthResponse, probeUpstreams, readinessResponse, upstreamHealth } from "./routes/health";
import { isHighVolumeCacheHit, REQUEST_LOG_SAMPLE_RATE, shouldLogRequest } from "./request-log";
import { terrainResponse, validTile } from "./routes/terrain";
import { isTerrainRefused, recordTerrainRefusal } from "./terrain-refusal";
import { collectUsage } from "./usage-events";

type Handler = (request: Request, env: Env, ctx: ExecutionContext, url: URL) => Promise<Response> | Response;

const NOT_FOUND_BUCKET = "not-found";
const TERRAIN_TILE_PATH = /^\/v1\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/;

// Per-client request budget. Archive range reads and terrain cache hits are
// R2-backed and arrive in bursts of hundreds during one generation, so they are
// not charged here; terrain charges the budget only for HEAD and before an
// upstream fetch.
async function withinRequestBudget(request: Request, env: Env, bucket: string): Promise<boolean> {
  const { success } = await env.REQUEST_LIMITER.limit({ key: `${clientKey(request)}:${bucket}` });
  return success;
}

const TERRAIN_GLOBAL_LIMIT_KEY = "terrain-global";

// Per-client first so a client already over its own budget cannot also drain
// the shared per-colo ceiling that protects origin fetches and cache writes.
// A per-client refusal is remembered so the following requests skip the R2
// cache read they would otherwise make before reaching this check.
async function withinTerrainUpstreamBudget(request: Request, env: Env): Promise<boolean> {
  if (!(await withinRequestBudget(request, env, "terrain"))) { recordTerrainRefusal(clientKey(request)); return false; }
  const { success } = await env.TERRAIN_GLOBAL_LIMITER.limit({ key: TERRAIN_GLOBAL_LIMIT_KEY });
  if (!success) console.warn(JSON.stringify({ message: "terrain_global_budget_exceeded" }));
  return success;
}

const AGENT_GLOBAL_LIMIT_KEY = "agent-global";

// Agent routes are called by chat platforms' servers, where one address stands
// for many people, so they have their own budget rather than sharing the
// browser's; the shared ceiling still caps a colo. Per-client first, as above.
async function withinAgentBudget(request: Request, env: Env): Promise<boolean> {
  const { success } = await env.AGENT_LIMITER.limit({ key: `${clientKey(request)}:agent` });
  if (!success) return false;
  const global = await env.AGENT_GLOBAL_LIMITER.limit({ key: AGENT_GLOBAL_LIMIT_KEY });
  if (!global.success) console.warn(JSON.stringify({ message: "agent_global_budget_exceeded" }));
  return global.success;
}

function agentContext(request: Request, env: Env, ctx: ExecutionContext): AgentContext {
  return { request, env, ctx, admitTerrainUpstream: () => withinTerrainUpstreamBudget(request, env), admitAgentCall: () => withinAgentBudget(request, env) };
}

/** POST routes for agents, answered before the read-only method check. */
const PROJECT_ROUTES = new Map<string, "resolve" | "plan" | "link">([
  ["/v1/projects/resolve", "resolve"],
  ["/v1/projects/plan", "plan"],
  ["/v1/projects/link", "link"],
]);

// Range reads of a present archive stay unmetered, including the conditional
// ones a browser sends to revalidate them. Metadata-only requests (HEAD, or
// If-None-Match without a Range) re-resolve from R2 each time, and missing or
// invalid archives answer 404/503; both are charged so they cannot become an
// unmetered R2 read loop.
async function archiveResponse(request: Request, env: Env, ctx: ExecutionContext, archive: ArchiveRoute): Promise<Response> {
  if (isArchiveMetadataRequest(request) && !(await withinRequestBudget(request, env, "archive-meta"))) {
    return rateLimitExceeded();
  }
  const response = await pmtilesResponse(request, env, ctx, archive);
  if ((response.status === 404 || response.status === 503) && !(await withinRequestBudget(request, env, NOT_FOUND_BUCKET))) {
    await response.body?.cancel();
    return rateLimitExceeded();
  }
  return response;
}

function limited(bucket: string, handler: Handler): Handler {
  return async (request, env, ctx, url) => (await withinRequestBudget(request, env, bucket)) ? handler(request, env, ctx, url) : rateLimitExceeded();
}

const EXACT_ROUTES = new Map<string, Handler>([
  ["/health", limited("root", (_request, env) => healthResponse(env))],
  ["/ready", limited("root", (_request, env) => readinessResponse(env))],
  ["/v1/upstream-health", limited("upstream-health", (_request, env) => upstreamHealth(env))],
  ["/v1/manifest", limited("manifest", (_request, env) => json(
    buildManifest(env.DATASET_VERSION, terrainArchives, bathymetryArchives),
    { headers: { "cache-control": "public, max-age=3600" } },
  ))],
  ["/v1/geocode", limited("geocode", (request, env, ctx, url) => geocodeResponse(request, env, ctx, url))],
  ["/v1/coverage", limited("coverage", (request, env, _ctx, url) => coverageRouteResponse(url, { request, env }))],
  ["/.well-known/mcp/server-card.json", limited("mcp-card", (request, env) => json(serverCard({ request, env }), { headers: { "cache-control": "public, max-age=3600" } }))],
  ["/v1/openapi.json", limited("openapi", (request, env) => json(openApiDocument(new URL(request.url).origin, env.PUBLIC_ORIGIN || new URL(request.url).origin, packageJson.version), { headers: { "cache-control": "public, max-age=3600" } }))],
]);

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const isWrite = url.pathname === "/v1/events" || url.pathname === FEEDBACK_PATH;
  if (isWrite && !isAllowedOrigin(request.headers.get("origin"), env)) return json({ error: "Origin is not allowed." }, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (url.pathname === "/v1/events") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST,OPTIONS" } });
    if (!(await withinRequestBudget(request, env, "events"))) return rateLimitExceeded("Rate limit exceeded.");
    return collectUsage(request, env.ENVIRONMENT);
  }
  if (url.pathname === FEEDBACK_PATH) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST,OPTIONS" } });
    return feedbackResponse(request, env);
  }
  if (url.pathname === MCP_PATH) {
    if (!(await withinAgentBudget(request, env))) return rateLimitExceeded();
    return mcpResponse(agentContext(request, env, ctx));
  }
  const projectAction = PROJECT_ROUTES.get(url.pathname);
  if (projectAction) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST,OPTIONS" } });
    if (!(await withinAgentBudget(request, env))) return rateLimitExceeded();
    return projectRouteResponse(projectAction, agentContext(request, env, ctx));
  }
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET,HEAD,OPTIONS" } });

  // Existing browser sessions can still request the former static URLs.
  const legacyOutline = /^\/data\/lake-outlines\/(index|[a-f0-9]{24})\.json$/.exec(url.pathname);
  if (legacyOutline) {
    const file = legacyOutline[1] === "index" ? OUTLINE_INDEX_FILE : `${legacyOutline[1]}.json`;
    return new Response(null, { status: 307, headers: { location: `/v1/lake-outlines/${file}`, "cache-control": "public, max-age=3600" } });
  }
  const exact = EXACT_ROUTES.get(url.pathname);
  if (exact) return exact(request, env, ctx, url);
  const archive = ARCHIVE_ROUTES.get(url.pathname);
  if (archive) return archiveResponse(request, env, ctx, archive);
  if (OUTLINE_PATH.test(url.pathname)) return limited("lake-outlines", outlineResponse)(request, env, ctx, url);
  if (PREVIEW_PATH.test(url.pathname)) return limited("lake-previews", previewResponse)(request, env, ctx, url);
  const terrainMatch = TERRAIN_TILE_PATH.exec(url.pathname);
  if (terrainMatch) {
    const tile = validTile(terrainMatch[1] ?? "", terrainMatch[2] ?? "", terrainMatch[3] ?? "");
    if (!tile) return json({ error: "Invalid terrain tile coordinates." }, { status: 400 });
    // HEAD reads R2 metadata on every call (no memo), so it is metered in its
    // own bucket rather than competing with the upstream-miss budget.
    if (request.method === "HEAD" && !(await withinRequestBudget(request, env, "terrain-head"))) return rateLimitExceeded();
    // Already over budget in this window: refuse before the R2 cache read, so a
    // walk across distinct coordinates cannot keep billing reads for 429s.
    if (isTerrainRefused(clientKey(request))) return rateLimitExceeded();
    return terrainResponse(request, env, ctx, tile, { admitUpstream: () => withinTerrainUpstreamBudget(request, env) });
  }
  // One fixed bucket: a path-derived key would let callers mint fresh budgets
  // or drain the real terrain/geocode buckets with 404s.
  return limited(NOT_FOUND_BUCKET, () => json({ error: "Not found." }, { status: 404 }))(request, env, ctx, url);
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await probeUpstreams(env, ctx);
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      const startedAt = Date.now();
      const metrics = { r2Reads: 0, r2Writes: 0 };
      const measuredEnv = { ...env, MAP_CACHE: measureBucket(env.MAP_CACHE, metrics), VECTOR_DATA: measureBucket(env.VECTOR_DATA, metrics) };
      const response = await route(request, measuredEnv, ctx);
      response.headers.set("x-topostack-r2-reads", String(metrics.r2Reads));
      // Archive ranges and terrain tiles arrive in bursts of hundreds per
      // generation; their cache hits are sampled. Cache-miss failures, non-2xx
      // statuses and every other route stay fully logged, so a canary hitting
      // R2 or a broken upstream is still visible per request.
      const cache = response.headers.get("x-topostack-cache");
      const highVolumeRoute = ARCHIVE_ROUTES.has(url.pathname) || TERRAIN_TILE_PATH.test(url.pathname);
      const sampledLine = highVolumeRoute && isHighVolumeCacheHit(response.status, cache);
      if (shouldLogRequest({ highVolumeRoute, status: response.status, cache })) {
        console.log(JSON.stringify({ message: "request_completed", method: request.method, path: url.pathname, environment: env.ENVIRONMENT, status: response.status, cache, durationMs: Date.now() - startedAt,
          ...(sampledLine ? { sampleRate: REQUEST_LOG_SAMPLE_RATE } : {}), ...metrics }));
      }
      return withCors(response, request, env);
    } catch (error) {
      console.error(JSON.stringify({ message: "request_failed", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return withCors(json({ error: "Internal map service error." }, { status: 500 }), request, env);
    }
  },
} satisfies ExportedHandler<Env>;

export { geocodeLimit, isAllowedOrigin, isGeocoderConfigured, normalizeGeoapify, parseRangeHeader, shouldLogRequest, validTile };
