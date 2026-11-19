import { projectFingerprint } from "../pipeline/fingerprint.js";
import { sourceRequirements } from "../pipeline/source-requirements.js";
import type { GeometryIRV1, ProjectConfigV1 } from "../types.js";

/**
 * Why an export is blocked: the English `message` (agents, the REST/MCP API),
 * and the studio's catalog key under `warnings.` with the values it fills in.
 */
export interface ExportBlock {
  message: string;
  /** Absent only when the block repeats a warning from geometry saved before warnings had keys. */
  messageKey?: string;
  params?: Record<string, string | number | string[]>;
}

const block = (message: string, messageKey: string, params?: ExportBlock["params"]): ExportBlock => ({ message, messageKey, ...(params ? { params } : {}) });

/**
 * Why `geometry` cannot be exported for `project`, or undefined when it can.
 * Pass `fingerprint` when the caller already has `projectFingerprint(project)`:
 * it serializes the whole project, so a UI rechecking on every edit computes it once.
 */
export function exportBlockReason(geometry: GeometryIRV1, project: ProjectConfigV1, fingerprint?: string): string | undefined {
  return exportBlockMessage(geometry, project, fingerprint)?.message;
}

/** `exportBlockReason` with the message key and params the studio translates it by. */
export function exportBlockMessage(geometry: GeometryIRV1, project: ProjectConfigV1, fingerprint?: string): ExportBlock | undefined {
  if (geometry.sourceKind !== "real") {
    const files = project.outputMode === "engraving" ? "engraving" : "fabrication";
    return block(`Generate real terrain data before exporting ${files} files.`, "exportBlockNotReal", { files });
  }
  if (geometry.configFingerprint !== (fingerprint ?? projectFingerprint(project))) return block("Project settings changed. Regenerate the terrain before exporting.", "exportBlockStale");
  const { vectors: needsVectors, lakes: needsLakes, aviation: needsAviation, lands: needsLands } = sourceRequirements(project);
  if (geometry.vectorStatus === "partial" && needsVectors) return block("Map detail data exceeded the safe feature limit. Narrow the map area or disable some map details, then regenerate.", "exportBlockVectorPartial");
  if (geometry.vectorStatus !== "available" && needsVectors) return block("Map detail data is unavailable. Disable those map details or regenerate after the service is restored.", "exportBlockVectorUnavailable");
  // Outside FAA coverage there is simply nothing to draw, which never blocks export.
  if (needsAviation && geometry.aviationStatus === "partial") return block("Aviation data exceeded the safe feature limit. Narrow the map area or turn off some aviation details, then regenerate.", "exportBlockAviationPartial");
  if (needsAviation && geometry.aviationStatus !== "available" && geometry.aviationStatus !== "not-covered") return block("FAA aviation data is unavailable. Turn off aviation details or regenerate after the service is restored.", "exportBlockAviationUnavailable");
  // A stencil missing part of a park would leave it unpainted, so incomplete land data blocks export; outside PAD-US there is simply none.
  if (needsLands && geometry.landsStatus === "partial") return block("Public lands data exceeded the safe feature limit. Narrow the map area or turn off some land kinds, then regenerate.", "exportBlockLandsPartial");
  if (needsLands && geometry.landsStatus !== "available" && geometry.landsStatus !== "not-covered") return block("Public lands data is unavailable. Turn off public land paint and boundaries, or regenerate after the service is restored.", "exportBlockLandsUnavailable");
  // A project that asks for airspace never exports without it; an area with none simply has no pieces.
  if (project.outputMode === "stack" && project.airspaceStack) {
    if (geometry.airspaceStatus === "partial") return block("Airspace data exceeded the safe feature limit. Narrow the map area or turn off some airspace classes, then regenerate.", "exportBlockAirspacePartial");
    const failure = geometry.warnings.find((warning) => warning.code === "AIRSPACE_TOO_COMPLEX" || warning.code === "AIRSPACE_PIECES_OVERLAP");
    // The failing warning is the reason, in its own words and key.
    if (failure) return { message: failure.message, ...(failure.messageKey ? { messageKey: failure.messageKey } : {}), ...(failure.params ? { params: failure.params } : {}) };
  }
  if (project.outputMode === "stack" && project.airspaceStack && (geometry.airspaceStatus === "unavailable" || !geometry.airspaceStack)) return block("Airspace was not loaded for this area. Turn off Airspace in 3D or regenerate after the service is restored.", "exportBlockAirspaceNotLoaded");
  if (needsLakes && geometry.lakeDataStatus !== "available") return block("Lake depth data is unavailable. Disable water depth or regenerate after the service is restored.", "exportBlockLakeDataUnavailable");
  if (project.outputMode === "stack" && geometry.layers.some((layer) => layer.polygons.length === 0)) return block("One or more layers are empty. Lower the vertical exaggeration, use thicker material, or reduce the minimum feature size, then regenerate.", "exportBlockEmptyLayers");
  return undefined;
}
