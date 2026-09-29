import { aviationRequested } from "./aviation.js";
import type { ProjectConfigV1 } from "../types.js";

/** Source capabilities required by both generation and fabrication exports. */
export function sourceRequirements(config: ProjectConfigV1): { vectors: boolean; lakes: boolean; water: boolean; aviation: boolean } {
  const lakes = config.outputMode === "stack" && config.showWaterDepth;
  // Water outlines are wanted for drawing, for carving, or for windowing a
  // paint stencil - any of which needs the vector water layer fetched.
  const water = config.showWater || lakes || (config.outputMode === "stack" && config.paintTemplates.includes("water"));
  return { vectors: config.showRoads || config.showTrails || water || config.showBoundaries, lakes, water, aviation: aviationRequested(config) };
}
