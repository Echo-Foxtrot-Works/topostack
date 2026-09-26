import { areaBounds, boundsForProject, expandProjectRequest, isMercatorBounds, parseProject, parseProjectRequest, planFromRelief, type GeoBounds, type ModelPlan, type ProjectConfigV1, type ProjectRequestV1, type RequestIssue } from "@topostack/core/project";
import { MAX_SHARE_URL_LENGTH, ShareLinkTooLongError } from "@topostack/data-contracts/share-link";
import { BodyTooLargeError, readBounded } from "../body";
import { json } from "../http";
import { terrainResponse } from "../routes/terrain";
import { attributionFor, type Attribution } from "./attribution";
import { areaCoverage, type AreaCoverage } from "./coverage";
import { studioLink } from "./links";
import { estimateRelief, ReliefUnavailableError, type ReliefEstimate, type ReliefTile } from "./relief";

/**
 * The agent-facing project operations. REST routes and MCP tools both call
 * these functions, so a request means the same thing on either surface.
 */
export const MAX_AGENT_BODY_BYTES = 128_000;
/** Plans past this many sheets get a note suggesting thicker material or less exaggeration. */
const MANY_SHEETS = 60;

export class AgentError extends Error {
  constructor(readonly status: number, message: string, readonly errors: RequestIssue[] = []) { super(message); this.name = "AgentError"; }
}

export interface AgentContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  /** Charges the caller's terrain budget before a tile has to come from the origin. */
  admitTerrainUpstream: () => Promise<boolean>;
  /** Charges the caller's agent budget once more, for work past what the request itself paid for. */
  admitAgentCall: () => Promise<boolean>;
}

export function publicOrigin(context: Pick<AgentContext, "env" | "request">): string {
  return context.env.PUBLIC_ORIGIN || new URL(context.request.url).origin;
}

/** The request body as JSON: 415 unless it says it is JSON, 413 past the size limit, 400 when it does not parse. */
export async function readJsonBody(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new AgentError(415, "Send the request as application/json.");
  let bytes: Uint8Array;
  try { bytes = await readBounded(request.body, MAX_AGENT_BODY_BYTES); }
  catch (error) {
    if (error instanceof BodyTooLargeError) throw new AgentError(413, `Request bodies are limited to ${MAX_AGENT_BODY_BYTES} bytes.`);
    throw error;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AgentError(400, "The request body is not valid JSON."); }
}

export function resolveProjectRequest(value: unknown): { request: ProjectRequestV1; project: ProjectConfigV1 } {
  const parsed = parseProjectRequest(value);
  if (!parsed.ok) throw new AgentError(422, "The project request is invalid.", parsed.errors);
  return { request: parsed.value, project: expandProjectRequest(parsed.value) };
}

export function linkFor(project: ProjectConfigV1, origin: string): string {
  try { return studioLink(project, origin); }
  catch (error) {
    if (error instanceof ShareLinkTooLongError) throw new AgentError(413, `This design does not fit in a ${MAX_SHARE_URL_LENGTH}-character link. Remove custom data, or export a project file from the studio.`);
    throw error;
  }
}

/** A short, stable description of a resolved project for agents to repeat back. */
export function projectSummary(project: ProjectConfigV1) {
  return {
    name: project.name,
    placeLabel: project.location.label,
    output: project.outputMode === "engraving" ? "flat" as const : "layered" as const,
    widthMm: project.widthMm,
    heightMm: project.heightMm,
    shape: project.cropShape,
    materialThicknessMm: project.materialThicknessMm,
    verticalExaggeration: project.verticalExaggeration,
    bounds: boundsForProject(project),
  };
}

export interface ProjectPlan {
  project: ReturnType<typeof projectSummary>;
  plan: ModelPlan & { estimate: true };
  relief: { sampleZoom: number; tiles: number; coastal: boolean };
  coverage: AreaCoverage;
  notes: string[];
  studioUrl: string;
  attribution: Attribution;
}

function tileLoader(context: AgentContext): (tile: ReliefTile) => Promise<Uint8Array> {
  return async (tile) => {
    const url = new URL(`/v1/terrain/${tile.z}/${tile.x}/${tile.y}.png`, context.request.url);
    const address = context.request.headers.get("cf-connecting-ip");
    const response = await terrainResponse(new Request(url, { headers: address ? { "cf-connecting-ip": address } : {} }), context.env, context.ctx, tile, { admitUpstream: context.admitTerrainUpstream });
    if (response.status === 429) { await response.body?.cancel(); throw new ReliefUnavailableError(429, "The terrain budget for this client is used up. Try again in a minute."); }
    if (!response.ok) { await response.body?.cancel(); throw new ReliefUnavailableError(502, "Terrain is unavailable right now. Try again shortly."); }
    return new Uint8Array(await response.arrayBuffer());
  };
}

function planNotes(project: ProjectConfigV1, plan: ModelPlan, relief: ReliefEstimate, coverage: AreaCoverage): string[] {
  const notes = [`Estimated from terrain sampled at zoom ${relief.zoom}; peaks can be smoothed, so expect the studio's count to differ by a sheet or two. The studio's count is the one that is cut.`];
  if (plan.reliefM < 20) notes.push(plan.output === "flat" ? "This area is nearly flat, so contour lines may be sparse." : "This area is nearly flat, so the layers may look alike. Try a smaller area or more exaggeration.");
  if (plan.output === "layered" && plan.sheetCount > MANY_SHEETS) notes.push(`${plan.sheetCount} sheets is a large stack. Thicker material or less exaggeration makes fewer sheets.`);
  if (relief.coastal) notes.push("The area reaches the sea; the sea is cut flat and the stack is sized from the land.");
  if (coverage.lakeSurveys.length && project.showWaterDepth && plan.output === "layered") notes.push("Lake depth adds sheets below the shoreline; the studio counts them.");
  const bedWidth = project.workAreaWidthMm || Infinity, bedHeight = project.workAreaHeightMm || Infinity;
  if (project.widthMm > bedWidth || project.heightMm > bedHeight) notes.push("The model is larger than the laser bed, so each sheet is split into pieces with alignment tabs.");
  return notes;
}

export async function planProject(project: ProjectConfigV1, context: AgentContext): Promise<ProjectPlan> {
  const bounds = boundsForProject(project);
  const coverage = areaCoverage(bounds);
  let relief: ReliefEstimate;
  try { relief = await estimateRelief(bounds, project.cropShape === "circle", tileLoader(context)); }
  catch (error) {
    if (error instanceof ReliefUnavailableError) throw new AgentError(error.status, error.message);
    throw error;
  }
  const plan = planFromRelief(project, relief);
  const origin = publicOrigin(context);
  return {
    project: projectSummary(project),
    plan: { ...plan, estimate: true },
    relief: { sampleZoom: relief.zoom, tiles: relief.tiles, coastal: relief.coastal },
    coverage,
    notes: planNotes(project, plan, relief, coverage),
    studioUrl: linkFor(project, origin),
    attribution: attributionFor(origin, coverage),
  };
}

/** Coverage for `?bbox=west,south,east,north` or `?lat=&lon=&widthKm=`. */
export function coverageBoundsFromQuery(url: URL): GeoBounds {
  const bbox = url.searchParams.get("bbox");
  if (bbox !== null) {
    const parts = bbox.split(",").map((part) => part.trim() === "" ? Number.NaN : Number(part));
    const [west, south, east, north] = parts as [number, number, number, number];
    const bounds = { west, south, east, north };
    if (parts.length !== 4 || !isMercatorBounds(bounds)) throw new AgentError(400, "bbox must be west,south,east,north in degrees inside ±180° and ±85.0511°, with west < east and south < north.");
    return bounds;
  }
  const [lat, lon, widthKm] = ["lat", "lon", "widthKm"].map((key) => { const value = url.searchParams.get(key); return value === null || value.trim() === "" ? Number.NaN : Number(value); }) as [number, number, number];
  const parsed = parseProjectRequest({ requestVersion: 1, area: { center: { lat, lon }, widthKm }, widthMm: 100, heightMm: 100 });
  if (!parsed.ok) throw new AgentError(400, "Give bbox=west,south,east,north or lat, lon and widthKm.", parsed.errors);
  return areaBounds(parsed.value.area, 100, 100);
}

export function agentErrorResponse(error: AgentError): Response {
  return json({ error: error.message, ...(error.errors.length ? { errors: error.errors } : {}) }, { status: error.status, headers: { "cache-control": "no-store" } });
}

/** POST /v1/projects/resolve, /plan and /link. */
export async function projectRouteResponse(action: "resolve" | "plan" | "link", context: AgentContext): Promise<Response> {
  try {
    const body = await readJsonBody(context.request);
    const origin = publicOrigin(context);
    if (action === "link" && body && typeof body === "object" && "project" in body) {
      let project: ProjectConfigV1;
      try { project = parseProject((body as { project: unknown }).project); }
      catch (error) { throw new AgentError(422, error instanceof Error ? error.message : "The project is invalid."); }
      const url = linkFor(project, origin);
      return json({ url, length: url.length });
    }
    const { project } = resolveProjectRequest(body);
    if (action === "resolve") return json({ project, studioUrl: linkFor(project, origin), attribution: attributionFor(origin, areaCoverage(boundsForProject(project))) });
    if (action === "link") { const url = linkFor(project, origin); return json({ url, length: url.length }); }
    return json(await planProject(project, context));
  } catch (error) {
    if (error instanceof AgentError) return agentErrorResponse(error);
    throw error;
  }
}

/** GET /v1/coverage. */
export function coverageRouteResponse(url: URL, context: Pick<AgentContext, "env" | "request">): Response {
  try {
    const coverage = areaCoverage(coverageBoundsFromQuery(url));
    return json({ ...coverage, attribution: attributionFor(publicOrigin(context), coverage) }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (error) {
    if (error instanceof AgentError) return agentErrorResponse(error);
    throw error;
  }
}
