import { MARKER_SYMBOLS } from "../types.js";
import { PROJECT_REQUEST_AVIATION_KEYS, PROJECT_REQUEST_DETAIL_KEYS, PROJECT_REQUEST_LIMITS as LIMITS } from "./request.js";

/**
 * JSON Schema (2020-12, also valid OpenAPI 3.1) for `ProjectRequestV1`, built
 * from the same limits `parseProjectRequest` enforces. The parser stays the
 * authority: it also checks what a schema cannot, such as an area that,
 * fitted to the model's proportions, would leave the mapped world.
 */
type Schema = Record<string, unknown>;

const range = (limits: { min: number; max: number }, description?: string, integer = false): Schema =>
  ({ type: integer ? "integer" : "number", minimum: limits.min, maximum: limits.max, ...(description ? { description } : {}) });

const latitude: Schema = { type: "number", minimum: -85.0511, maximum: 85.0511 };
const longitude: Schema = { type: "number", minimum: -180, maximum: 180 };

export const AREA_SCHEMA: Schema = {
  description: "The ground to model. Use center + widthKm for a place and a span, or bounds to keep a whole box in view; the crop is fitted to the model's proportions.",
  oneOf: [
    {
      type: "object",
      title: "Center and width",
      required: ["center", "widthKm"],
      additionalProperties: false,
      properties: {
        center: { type: "object", required: ["lat", "lon"], additionalProperties: false, properties: { lat: latitude, lon: longitude } },
        widthKm: range(LIMITS.widthKm, "Ground distance shown from west to east, in kilometres."),
      },
    },
    {
      type: "object",
      title: "Bounding box",
      required: ["bounds"],
      additionalProperties: false,
      properties: {
        bounds: {
          type: "object",
          required: ["west", "south", "east", "north"],
          additionalProperties: false,
          description: "WGS84 degrees; west < east (the antimeridian cannot be crossed) and south < north.",
          properties: { west: longitude, south: latitude, east: longitude, north: latitude },
        },
      },
    },
  ],
};

export const DETAILS_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  description: "Map details to include. Anything left out keeps the studio default: water, water depth, roads, trails, elevation labels, north arrow and scale bar on; road labels, boundaries and coordinate grid off.",
  properties: Object.fromEntries(PROJECT_REQUEST_DETAIL_KEYS.map((key) => [key, { type: "boolean" }])),
};

export const AVIATION_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  description: "FAA aviation detail, US and territories only; decorative, never for navigation. Every switch is off unless set: airspace (Class B, C and D boundaries), specialUse (restricted, MOA, warning and similar areas), runways, airports, navaids, obstacles (200 ft AGL and taller), labels (airport and navaid identifiers).",
  properties: Object.fromEntries(PROJECT_REQUEST_AVIATION_KEYS.map((key) => [key, { type: "boolean" }])),
};

const SETTINGS_PROPERTIES: Record<string, Schema> = {
  placeLabel: { type: "string", maxLength: LIMITS.placeLabelLength, description: "Human-readable place name, e.g. from search_places." },
  name: { type: "string", maxLength: LIMITS.nameLength, description: "Project name; defaults to the first part of placeLabel." },
  widthMm: range(LIMITS.sizeMm, "Finished model width in millimetres (default 300)."),
  heightMm: range(LIMITS.sizeMm, "Finished model height in millimetres (default 200)."),
  shape: { enum: ["rectangle", "circle"], description: "Outline of the model (default rectangle)." },
  units: { enum: ["metric", "imperial"], description: "Units for engraved labels and the scale bar (default metric)." },
  output: { enum: ["layered", "flat"], description: "layered: a stack of laser-cut sheets forming a 3D relief (default). flat: contour lines engraved on a single sheet." },
  materialThicknessMm: range(LIMITS.materialThicknessMm, "Sheet thickness in millimetres (default 3). Thicker material gives fewer, coarser layers."),
  verticalExaggeration: range(LIMITS.verticalExaggeration, "How much to stretch the terrain vertically (default 2). The layer count follows from scale, relief, exaggeration and thickness."),
  contourCount: range(LIMITS.contourCount, "Flat output only: number of engraved contour lines (default 12).", true),
  details: DETAILS_SCHEMA,
  aviation: AVIATION_SCHEMA,
  title: { type: "string", maxLength: LIMITS.titleLines * (LIMITS.titleLineLength + 1), description: `Optional engraved title: up to ${LIMITS.titleLines} lines separated by \\n, ${LIMITS.titleLineLength} characters each.` },
  laser: {
    type: "object",
    additionalProperties: false,
    description: "Laser settings. A work area smaller than the model splits each sheet into pieces that fit the bed.",
    properties: {
      kerfMm: range(LIMITS.kerfMm, "Laser kerf in millimetres (default 0.15)."),
      workAreaWidthMm: { anyOf: [{ const: 0 }, range(LIMITS.workAreaMm)], description: "Laser bed width in millimetres; 0 for unlimited (default)." },
      workAreaHeightMm: { anyOf: [{ const: 0 }, range(LIMITS.workAreaMm)], description: "Laser bed height in millimetres; 0 for unlimited (default)." },
    },
  },
  markers: {
    type: "array",
    maxItems: LIMITS.markers,
    description: "Points of interest engraved on the model.",
    items: {
      type: "object",
      required: ["lat", "lon"],
      additionalProperties: false,
      properties: {
        lat: latitude,
        lon: longitude,
        symbol: { enum: [...MARKER_SYMBOLS], description: "Marker shape (default pin)." },
        name: { type: "string", maxLength: LIMITS.markerNameLength },
      },
    },
  },
};

/** A complete request for a new design. */
export const PROJECT_REQUEST_SCHEMA: Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://topostack.app/schemas/project-request-v1.json",
  title: "TopoStack project request v1",
  type: "object",
  required: ["requestVersion", "area"],
  additionalProperties: false,
  properties: {
    requestVersion: { const: 1 },
    area: AREA_SCHEMA,
    ...SETTINGS_PROPERTIES,
  },
};

/** A change to an open design: any settings, and optionally a new area. */
export const PROJECT_REQUEST_PATCH_SCHEMA: Schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    area: AREA_SCHEMA,
    ...SETTINGS_PROPERTIES,
  },
};
