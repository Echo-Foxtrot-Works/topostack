import type { GeometryIRV1, ProjectConfigV1, SourceBundleV1 } from "@topostack/core";
import { t } from "$lib/i18n/i18n.svelte";

export type PreviewUpdateKind = "details" | "fabrication" | "customData";

export function previewPendingStatus(kind: PreviewUpdateKind, project: ProjectConfigV1): string {
  if (kind === "details") return t("status.updatingMapDetails");
  if (kind === "customData") return t("status.updatingCustomData");
  return project.outputMode === "engraving" ? t("status.updatingEngravingArtwork") : t("status.updatingTerrainGeometry");
}

export function previewUpdatedStatus(kind: PreviewUpdateKind, source: SourceBundleV1, project: ProjectConfigV1, requirements: { vectors: boolean; lakes: boolean; aviation?: boolean }): string {
  if (kind === "details") {
    if (source.vectorStatus !== "available" && requirements.vectors) return t("status.mapDetailsUpdatedSourceIncomplete");
    if ((source.aviationStatus === "unavailable" || source.aviationStatus === "partial") && requirements.aviation) return t("status.mapDetailsUpdatedAviationIncomplete");
    if (source.lakeDataStatus === "unavailable" && requirements.lakes) return t("status.mapDetailsUpdatedLakeDepthUnavailable");
    if (source.sourceKind === "preview") return t("status.realDataSamplePreviewUpdated");
    return source.sourceKind === "real" ? t("status.mapDetailsUpdated") : t("status.samplePreviewUpdated");
  }
  if (kind === "customData") return t("status.customDataUpdated");
  if (source.sourceKind === "preview") return t("status.realDataSampleUpdated");
  if (source.sourceKind === "real") return project.outputMode === "engraving" ? t("status.engravingArtworkUpdated") : t("status.fabricationGeometryUpdated");
  return t("status.samplePreviewUpdated");
}

export interface GenerationOutcome {
  fallback: boolean;
  fallbackReason?: string;
  waterWarning?: string;
  vectorUnavailable: boolean;
  lakeUnavailable: boolean;
}

export function generationStatus(outcome: GenerationOutcome, project: ProjectConfigV1, geometry: GeometryIRV1): string {
  if (outcome.fallback) return outcome.fallbackReason ? t("status.sampleTerrainGeneratedBecause", { reason: outcome.fallbackReason.replace(/\.$/, "") }) : t("status.sampleTerrainGenerated");
  if (outcome.vectorUnavailable) return t("status.terrainReadyMapDetailIncomplete");
  if (outcome.lakeUnavailable) return t("status.terrainReadyLakeDepthUnavailable");
  if (outcome.waterWarning) return t("status.terrainReadyWaterOutlinesFailed");
  if (project.outputMode === "engraving") return project.showEngravingContours ? t("status.engravingReady", { count: project.engravingContourCount }) : t("status.engravingReadyNoContours");
  return t("status.realTerrainReady", { layers: geometry.layers.length, panels: geometry.layers.length - geometry.fabricationNests.length });
}

export function generationToast(outcome: GenerationOutcome, project: ProjectConfigV1): { type: "warning" | "success"; message: string } {
  const warning = outcome.fallback || outcome.vectorUnavailable || outcome.lakeUnavailable || !!outcome.waterWarning;
  const message = outcome.fallback ? t("status.toastSampleTerrain")
    : outcome.vectorUnavailable ? t("status.toastIncompleteMapDetails")
      : outcome.lakeUnavailable ? t("status.toastNoLakeDepth")
        : outcome.waterWarning ? t("status.toastNoWaterOutlines")
          : project.outputMode === "engraving" ? t("status.toastEngravingReady") : t("status.toastTerrainReady");
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
  if (!state.detailsUpdating && state.terrainDataStale) return t("status.mapAreaChanged", { action: state.terrainDataAction });
  if (!state.detailsUpdating && state.verticalExaggerationStale) return t("status.previewUpdateIncomplete");
  if (!state.detailsUpdating && !state.exportReady && state.sourceKind === "real") return state.exportBlockedBy ?? t("status.designChanged");
  return state.status;
}
