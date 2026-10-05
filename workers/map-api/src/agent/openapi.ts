import { GEOCODE_DEFAULT_RESULTS, GEOCODE_MAX_RESULTS, GEOCODE_QUERY_MAX_CHARS } from "../routes/geocode";
import { ATTRIBUTION_SCHEMA, coverageResultSchema, PLAN_SCHEMA, PROJECT_REQUEST_BODY_SCHEMA } from "./schemas";

/**
 * The OpenAPI 3.1 description of the agent routes. The request schema is the
 * one `parseProjectRequest` is tested against, and the response schemas are
 * the MCP tools' output schemas, so the document cannot drift from what the
 * routes accept or return. The route table test keeps the paths honest.
 */
const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const jsonBody = (ref: string) => ({ required: true, content: { "application/json": { schema: { $ref: ref } } } });
const jsonResponse = (description: string, schema: Record<string, unknown>) => ({ description, content: { "application/json": { schema } } });

/** Every POST route reads its body the same way and draws on the agent budget. */
const bodyErrors = {
  "400": errorResponse("The body is not valid JSON."),
  "413": errorResponse("The body is over 128,000 bytes, or the design does not fit in an 8,000-character studio link."),
  "415": errorResponse("The body is not sent as application/json."),
  "422": errorResponse("The request is invalid; `errors` lists each field by path."),
  "429": errorResponse("The agent budget (per client and shared) is used up; retry after the `retry-after` seconds."),
};

export const AGENT_ROUTES = ["/v1/projects/resolve", "/v1/projects/plan", "/v1/projects/link", "/v1/coverage", "/v1/geocode", "/v1/openapi.json"] as const;

/** `apiOrigin` serves these routes; `siteOrigin` hosts the studio and the attribution page (the same host except in local development). */
export function openApiDocument(apiOrigin: string, siteOrigin: string, version: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "TopoStack API",
      version,
      summary: "Plan laser-cut terrain models and hand them to the TopoStack studio.",
      description: "Describe a place and a model (layered stack or flat engraving), get it validated, estimate its sheets from sampled terrain, and receive a studio link that opens and generates it. Files are generated and exported in the browser. Anonymous and rate limited; responses carry attribution that must be kept with anything derived from them. An MCP server with the same operations is at /mcp.",
      license: { name: "Data licenses vary by source", url: new URL("/attribution", siteOrigin).toString() },
    },
    servers: [{ url: apiOrigin }],
    paths: {
      "/v1/projects/resolve": {
        post: {
          operationId: "resolveProject",
          summary: "Validate a request and expand it into a full project",
          requestBody: jsonBody("#/components/schemas/ProjectRequestV1"),
          responses: {
            "200": { description: "The expanded ProjectConfigV1, its studio link, and attribution.", content: { "application/json": { schema: { type: "object", required: ["project", "studioUrl", "attribution"], properties: { project: { type: "object" }, studioUrl: { type: "string", format: "uri" }, attribution: { $ref: "#/components/schemas/Attribution" } } } } } },
            ...bodyErrors,
          },
        },
      },
      "/v1/projects/plan": {
        post: {
          operationId: "planProject",
          summary: "Estimate sheets, stack height and scale from sampled terrain",
          description: "Samples at most four low-zoom terrain tiles. The sheet count is an estimate; the studio's is authoritative.",
          requestBody: jsonBody("#/components/schemas/ProjectRequestV1"),
          responses: {
            "200": jsonResponse("The plan, coverage, notes, studio link and attribution.", { $ref: "#/components/schemas/ProjectPlan" }),
            ...bodyErrors,
            "429": errorResponse("The agent budget is used up, or the terrain budget for sampling tiles is (a different message says which)."),
            "502": errorResponse("Terrain is unavailable."),
          },
        },
      },
      "/v1/projects/link": {
        post: {
          operationId: "linkProject",
          summary: "Mint a studio link for a request or a full project",
          requestBody: { required: true, content: { "application/json": { schema: { oneOf: [{ $ref: "#/components/schemas/ProjectRequestV1" }, { type: "object", required: ["project"], properties: { project: { type: "object", description: "A ProjectConfigV1, such as a saved project file's `project`." } } }] } } } },
          responses: {
            "200": { description: "The link.", content: { "application/json": { schema: { type: "object", required: ["url", "length"], properties: { url: { type: "string", format: "uri" }, length: { type: "integer" } } } } } },
            ...bodyErrors,
            "422": errorResponse("The request or project is invalid. For a full project, `error` carries the parser's message and there is no `errors` list."),
          },
        },
      },
      "/v1/coverage": {
        get: {
          operationId: "areaCoverage",
          summary: "Which high-resolution terrain and lake surveys cover an area",
          parameters: [
            { name: "bbox", in: "query", schema: { type: "string" }, description: "west,south,east,north in degrees." },
            { name: "lat", in: "query", schema: { type: "number" } },
            { name: "lon", in: "query", schema: { type: "number" } },
            { name: "widthKm", in: "query", schema: { type: "number" } },
          ],
          description: "Pass `bbox`, or `lat`, `lon` and `widthKm` for a square area; `bbox` wins when both are given.",
          responses: {
            "200": jsonResponse("Coverage and attribution. Cacheable for an hour.", { $ref: "#/components/schemas/CoverageResult" }),
            "400": errorResponse("Give bbox, or lat, lon and widthKm. `errors` paths name request fields such as `area.center.lat`."),
            "429": errorResponse("Rate limited."),
          },
        },
      },
      "/v1/geocode": {
        get: {
          operationId: "searchPlaces",
          summary: "Search for a place by name",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 }, description: `Longer queries are cut to ${GEOCODE_QUERY_MAX_CHARS} characters.` },
            { name: "limit", in: "query", schema: { type: "integer", default: GEOCODE_DEFAULT_RESULTS }, description: `Clamped to 1–${GEOCODE_MAX_RESULTS}.` },
          ],
          responses: {
            "200": {
              description: "Matches from Geoapify (© OpenStreetMap contributors), most important first. Cached for a day, or five minutes when empty.",
              headers: { "x-topostack-cache": { description: "HIT, MISS or BYPASS.", schema: { enum: ["HIT", "MISS", "BYPASS"] } } },
              content: { "application/json": { schema: { type: "array", items: { type: "object", required: ["place_id", "display_name", "lat", "lon"], properties: { place_id: { type: "string" }, display_name: { type: "string" }, lat: { type: "number" }, lon: { type: "number" }, type: { type: "string" } } } } } },
            },
            "400": errorResponse("The query has fewer than two characters."),
            "429": errorResponse("Place search is rate limited for this client, or busy for everyone."),
            "502": errorResponse("The geocoder failed."),
            "503": errorResponse("The geocoder is not configured on this server."),
            "504": errorResponse("The geocoder timed out."),
          },
        },
      },
      "/v1/openapi.json": { get: { operationId: "openApi", summary: "This document", responses: { "200": { description: "OpenAPI 3.1" }, "429": errorResponse("Rate limited.") } } },
    },
    components: {
      schemas: {
        ProjectRequestV1: PROJECT_REQUEST_BODY_SCHEMA,
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, errors: { type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } } } },
        Attribution: ATTRIBUTION_SCHEMA,
        CoverageResult: coverageResultSchema({ $ref: "#/components/schemas/Attribution" }),
        ProjectPlan: PLAN_SCHEMA,
      },
    },
  };
}
