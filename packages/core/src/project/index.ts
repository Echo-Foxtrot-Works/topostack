/**
 * `@topostack/core/project`: reading, describing and planning projects without
 * generating geometry. The map-api Worker imports only this entry point, so
 * nothing here may reach contour tracing, generation, or export.
 */
export { parseProject } from "./parse.js";
export { MERCATOR_MAX_LATITUDE, TILE_SIZE, boundsAround, boundsForProject, coverBounds, fitCutBounds, isMercatorBounds, latToWorldY, lonToWorldX, worldSize, worldXToLon, worldYToLat, zoomForBounds } from "./bounds.js";
export { PROJECT_REQUEST_DETAIL_KEYS, PROJECT_REQUEST_LIMITS, PROJECT_REQUEST_VERSION, areaBounds, cleanRequestText, describeProject, expandProjectRequest, parseProjectRequest, parseProjectRequestPatch, requestPatch, type ProjectRequestArea, type ProjectRequestDetails, type ProjectRequestLaser, type ProjectRequestMarker, type ProjectRequestSettings, type ProjectRequestV1, type RequestIssue, type RequestResult } from "./request.js";
export { AREA_SCHEMA, DETAILS_SCHEMA, PROJECT_REQUEST_PATCH_SCHEMA, PROJECT_REQUEST_SCHEMA } from "./schema.js";
export { planFromRelief, type ModelPlan, type ReliefSample } from "./plan.js";
export { validateProject } from "../pipeline/validate.js";
export { groundWidthMFor, horizontalScaleFor, planTerrainStack } from "../pipeline/stack-plan.js";
export { EARTH_RADIUS_M } from "../primitives/units.js";
export { DEFAULT_PROJECT, northArrowMaximumMm, type GeoBounds, type GeoPoint, type ProjectConfigV1 } from "../types.js";
