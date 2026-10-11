/**
 * The airspace stage on its own, for hosts that build airspace in acrylic:
 * import it when a project turns airspace on, and pass `buildAirspaceStack` to
 * `registerAirspaceStage` before generating. Kept apart from the main entry so
 * a studio that never builds airspace never downloads it.
 */
export { buildAirspaceStack } from "./pipeline/airspace-stack.js";
