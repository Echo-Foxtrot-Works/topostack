import { projectFingerprint } from "../pipeline/fingerprint.js";
import { sourceRequirements } from "../pipeline/source-requirements.js";
import type { GeometryIRV1, ProjectConfigV1 } from "../types.js";

/**
 * Why `geometry` cannot be exported for `project`, or undefined when it can.
 * Pass `fingerprint` when the caller already has `projectFingerprint(project)`:
 * it serializes the whole project, so a UI rechecking on every edit computes it once.
 */
export function exportBlockReason(geometry: GeometryIRV1, project: ProjectConfigV1, fingerprint?: string): string | undefined {
  if (geometry.sourceKind !== "real") return `Generate real terrain data before exporting ${project.outputMode === "engraving" ? "engraving" : "fabrication"} files.`;
  if (geometry.configFingerprint !== (fingerprint ?? projectFingerprint(project))) return "Project settings changed. Regenerate the terrain before exporting.";
  const { vectors: needsVectors, lakes: needsLakes, aviation: needsAviation } = sourceRequirements(project);
  if (geometry.vectorStatus === "partial" && needsVectors) return "Map detail data exceeded the safe feature limit. Narrow the map area or disable some map details, then regenerate.";
  if (geometry.vectorStatus !== "available" && needsVectors) return "Map detail data is unavailable. Disable those map details or regenerate after the service is restored.";
  // Outside FAA coverage there is simply nothing to draw, which never blocks export.
  if (needsAviation && geometry.aviationStatus === "partial") return "Aviation data exceeded the safe feature limit. Narrow the map area or turn off some aviation details, then regenerate.";
  if (needsAviation && geometry.aviationStatus !== "available" && geometry.aviationStatus !== "not-covered") return "FAA aviation data is unavailable. Turn off aviation details or regenerate after the service is restored.";
  if (needsLakes && geometry.lakeDataStatus !== "available") return "Lake depth data is unavailable. Disable water depth or regenerate after the service is restored.";
  if (project.outputMode === "stack" && geometry.layers.some((layer) => layer.polygons.length === 0)) return "One or more layers are empty. Lower the vertical exaggeration, use thicker material, or reduce the minimum feature size, then regenerate.";
  return undefined;
}
