import { PROJECT_REQUEST_SCHEMA } from "@topostack/core/project";

/**
 * JSON Schemas for the agent responses. The MCP tools use them as
 * `outputSchema` and the OpenAPI document lists them as components, so the two
 * descriptions of one response cannot drift apart.
 */
export type Schema = Record<string, unknown>;

export const ATTRIBUTION_SCHEMA: Schema = {
  type: "object",
  required: ["text", "sources", "fullNotice"],
  properties: {
    text: { type: "string", description: "Credit line to keep with anything shown from this result." },
    sources: { type: "array", items: { type: "object", required: ["name", "license"], properties: { name: { type: "string" }, license: { type: "string" }, url: { type: "string" } } } },
    fullNotice: { type: "string", format: "uri" },
  },
};
const BOUNDS_SCHEMA: Schema = { type: "object", required: ["west", "south", "east", "north"], properties: { west: { type: "number" }, south: { type: "number" }, east: { type: "number" }, north: { type: "number" } } };
export const SUMMARY_SCHEMA: Schema = {
  type: "object",
  required: ["name", "placeLabel", "output", "widthMm", "heightMm", "shape", "materialThicknessMm", "verticalExaggeration", "bounds"],
  properties: {
    name: { type: "string" }, placeLabel: { type: "string" }, output: { enum: ["layered", "flat"] },
    widthMm: { type: "number" }, heightMm: { type: "number" }, shape: { enum: ["rectangle", "circle"] },
    materialThicknessMm: { type: "number" }, verticalExaggeration: { type: "number" }, bounds: BOUNDS_SCHEMA,
  },
};
export const COVERAGE_SCHEMA: Schema = {
  type: "object",
  required: ["terrain", "lakeSurveys", "roadsAndWater", "notes"],
  properties: {
    terrain: { type: "object", required: ["base", "highResolution"], properties: { base: { type: "string" }, highResolution: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, resolutionM: { type: "number" }, license: { type: "string" } } } } } },
    lakeSurveys: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, license: { type: "string" } } } },
    roadsAndWater: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
};
export const PLAN_SCHEMA: Schema = {
  type: "object",
  required: ["project", "plan", "relief", "coverage", "notes", "studioUrl", "attribution"],
  properties: {
    project: SUMMARY_SCHEMA,
    plan: {
      type: "object",
      required: ["output", "sheetCount", "heightOfModelMm", "fittedVerticalExaggeration", "scaleDenominator", "reliefM", "estimate"],
      properties: {
        output: { enum: ["layered", "flat"] }, sheetCount: { type: "integer", description: "Sheets to cut; 1 for flat output. An estimate." },
        heightOfModelMm: { type: "number" }, materialThicknessMm: { type: "number" }, requestedVerticalExaggeration: { type: "number" }, fittedVerticalExaggeration: { type: "number" },
        metersPerStep: { type: "number", description: "Elevation per sheet, or between engraved contours." }, scaleDenominator: { type: "integer", description: "The model is 1:scaleDenominator across its width." },
        groundWidthKm: { type: "number" }, groundHeightKm: { type: "number" }, minElevationM: { type: "number" }, maxElevationM: { type: "number" }, reliefM: { type: "number" }, estimate: { const: true },
      },
    },
    relief: { type: "object", properties: { sampleZoom: { type: "integer" }, tiles: { type: "integer" }, coastal: { type: "boolean" } } },
    coverage: COVERAGE_SCHEMA,
    notes: { type: "array", items: { type: "string" } },
    studioUrl: { type: "string", format: "uri", description: "Opens the design in TopoStack and generates it; files are exported there." },
    attribution: ATTRIBUTION_SCHEMA,
  },
};

/** The project request embedded in another document: `$schema` and `$id` belong to the standalone file. */
const { $schema: _dialect, $id: _id, ...projectRequestBody } = PROJECT_REQUEST_SCHEMA as Schema;
export const PROJECT_REQUEST_BODY_SCHEMA: Schema = projectRequestBody;

/** Coverage and its attribution; the OpenAPI document passes a `$ref`, the MCP tool the schema itself. */
export function coverageResultSchema(attribution: Schema): Schema {
  return { ...COVERAGE_SCHEMA, required: [...(COVERAGE_SCHEMA.required as string[]), "attribution"], properties: { ...(COVERAGE_SCHEMA.properties as Schema), attribution } };
}
