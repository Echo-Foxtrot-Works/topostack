import { aviationRequested } from "./aviation.js";
import { landLinesRequested } from "./lands.js";
import { LAND_CLASSES, type LandClass, type ProjectConfigV1 } from "../types.js";

/** The land classes a project needs loaded: those it paints (layered models only) and those it engraves. */
export function landClassesNeeded(config: Pick<ProjectConfigV1, "outputMode" | "paintTemplates" | "lands">): LandClass[] {
  const painted = config.outputMode === "stack" ? config.paintTemplates.filter((kind): kind is LandClass => (LAND_CLASSES as readonly string[]).includes(kind)) : [];
  return [...new Set([...painted, ...(config.lands?.boundaries ?? [])])];
}

/** Source capabilities required by both generation and fabrication exports. */
export function sourceRequirements(config: ProjectConfigV1): { vectors: boolean; lakes: boolean; water: boolean; aviation: boolean; airspace: boolean; lands: boolean } {
  const lakes = config.outputMode === "stack" && config.showWaterDepth;
  // Water outlines are wanted for drawing, for carving, or for windowing a
  // paint stencil - any of which needs the vector water layer fetched.
  const water = config.showWater || lakes || (config.outputMode === "stack" && config.paintTemplates.includes("water"));
  return {
    vectors: config.showRoads || config.showTrails || water || config.showBoundaries, lakes, water, aviation: aviationRequested(config),
    // Airspace volumes for building airspace in acrylic, a layered-model feature.
    airspace: config.outputMode === "stack" && Boolean(config.airspaceStack),
    // Public land outlines for windowing a paint stencil (layered models) or engraving boundaries.
    lands: landClassesNeeded(config).length > 0 && (config.outputMode === "stack" || landLinesRequested(config)),
  };
}
