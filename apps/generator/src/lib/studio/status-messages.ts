import type { GeometryIRV1, ProjectConfigV1, SourceBundleV1 } from "@topostack/core";

export type PreviewUpdateKind = "details" | "fabrication" | "customData";

export function previewPendingStatus(kind: PreviewUpdateKind, project: ProjectConfigV1): string {
  if (kind === "details") return "Updating map details…";
  if (kind === "customData") return "Updating custom data…";
  return project.outputMode === "engraving" ? "Updating engraving artwork…" : "Updating terrain geometry…";
}

export function previewUpdatedStatus(kind: PreviewUpdateKind, source: SourceBundleV1, project: ProjectConfigV1, requirements: { vectors: boolean; lakes: boolean; aviation?: boolean }): string {
  if (kind === "details") {
    if (source.vectorStatus !== "available" && requirements.vectors) return "Map details updated · source data incomplete";
    if ((source.aviationStatus === "unavailable" || source.aviationStatus === "partial") && requirements.aviation) return "Map details updated · aviation data incomplete";
    if (source.lakeDataStatus === "unavailable" && requirements.lakes) return "Map details updated · lake depth unavailable";
    if (source.sourceKind === "preview") return "Real-data sample preview updated";
    return source.sourceKind === "real" ? "Map details updated" : "Sample preview updated · generate for real map data";
  }
  if (kind === "customData") return "Custom data updated";
  if (source.sourceKind === "preview") return "Real-data sample updated";
  if (source.sourceKind === "real") return project.outputMode === "engraving" ? "Engraving artwork updated" : "Fabrication geometry updated";
  return "Sample preview updated · generate for real map data";
}

export interface GenerationOutcome {
  fallback: boolean;
  fallbackReason?: string;
  waterWarning?: string;
  vectorUnavailable: boolean;
  lakeUnavailable: boolean;
}

export function generationStatus(outcome: GenerationOutcome, project: ProjectConfigV1, geometry: GeometryIRV1): string {
  if (outcome.fallback) return `Sample terrain generated · ${outcome.fallbackReason ? `${outcome.fallbackReason.replace(/\.$/, "")} · ` : ""}connect the map API for real elevation`;
  if (outcome.vectorUnavailable) return "Terrain ready · map detail data incomplete";
  if (outcome.lakeUnavailable) return "Terrain ready · lake depth data unavailable";
  if (outcome.waterWarning) return "Terrain ready · water outlines could not be applied";
  if (project.outputMode === "engraving") return `Engraving ready · ${project.engravingContourCount} contours · one SVG`;
  return `Real terrain ready · ${geometry.layers.length} layers · ${geometry.layers.length - geometry.fabricationNests.length} cut panels`;
}

export function generationToast(outcome: GenerationOutcome, project: ProjectConfigV1): { type: "warning" | "success"; message: string } {
  const warning = outcome.fallback || outcome.vectorUnavailable || outcome.lakeUnavailable || !!outcome.waterWarning;
  const message = outcome.fallback ? "Preview generated with sample terrain"
    : outcome.vectorUnavailable ? "Terrain generated with incomplete map details"
      : outcome.lakeUnavailable ? "Terrain generated without lake depth data"
        : outcome.waterWarning ? "Terrain generated without water outlines"
          : project.outputMode === "engraving" ? "Engraving artwork ready" : "Terrain project ready";
  return { type: warning ? "warning" : "success", message };
}

export interface StatusLineState {
  generationState: "idle" | "loading" | "ready" | "error";
  status: string;
  detailsUpdating: boolean;
  terrainDataStale: boolean;
  /** "load" is the Atomm embed, which has no Generate button. */
  terrainDataAction: "regenerate" | "generate" | "load";
  verticalExaggerationStale: boolean;
  exportReady: boolean;
  exportBlockedBy: string | undefined;
  sourceKind: GeometryIRV1["sourceKind"];
}

/** The generate dock's status: in-flight work first, then what blocks export, then the latest status. */
export function statusLine(state: StatusLineState): string {
  if (state.generationState === "loading") return state.status;
  if (!state.detailsUpdating && state.terrainDataStale) return `Map area changed · ${state.terrainDataAction === "load" ? "load terrain" : `${state.terrainDataAction} terrain data`} before export`;
  if (!state.detailsUpdating && state.verticalExaggerationStale) return "Preview update incomplete · retry before export";
  if (!state.detailsUpdating && !state.exportReady && state.sourceKind === "real") return state.exportBlockedBy ?? "Design changed · refresh before export";
  return state.status;
}
