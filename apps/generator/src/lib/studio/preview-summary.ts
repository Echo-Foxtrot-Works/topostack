import { acrylicPanelGroups, airspacePanelGroups, AVIATION_DATA_DETAILS, displayLength, lakeDisplayNames, lengthUnit, planSeamGrid, signedArea, waterInsertLakeKey, type GeometryIRV1, type LayerIR, type ProjectConfigV1, type WaterSurfaceIR } from "@topostack/core";
import { formatNumber, t } from "$lib/i18n/i18n.svelte";
import { LINE_PRESETS } from "$lib/studio/options";

/** Pure summaries of a project and its preview geometry, shown in the sidebar and preview. */

/** The studio's settings panels, in rail order. Each subject (water, aviation) has one home. */
export type PanelId = "place" | "terrain" | "features" | "water" | "aviation" | "labels" | "make";
export const PANEL_IDS: PanelId[] = ["place", "terrain", "features", "water", "aviation", "labels", "make"];
/** Rail labels: short enough to sit under an icon. */
export const PANEL_LABELS: Readonly<Record<PanelId, string>> = Object.freeze({
  get place() { return t("app.panelPlace"); },
  get terrain() { return t("app.panelTerrain"); },
  get features() { return t("app.panelFeatures"); },
  get water() { return t("app.panelWater"); },
  get aviation() { return t("app.panelAviation"); },
  get labels() { return t("app.panelLabels"); },
  get make() { return t("app.panelMake"); },
});
/** Everything that can be a collapsible block: the panels, as the platform embed shows them, and the embed's lead rail. */
export type DisclosureId = PanelId | "setup" | "customData";

type Warning = GeometryIRV1["warnings"][number];

/** The layer with the most informative markings, so the cut preview opens on a representative sheet. */
export function featuredLayerIndex(result: GeometryIRV1): number {
  let best = { index: 0, score: -1 };
  result.layers.forEach((layer) => {
    const score = layer.markings.reduce((total, marking) => total + (marking.kind === "road" || marking.kind === "trail" || marking.kind === "water" || marking.kind === "boundary" || marking.kind === "grid" ? 3 : marking.id.startsWith("north-") || marking.id.startsWith("scale-") ? 0 : 1), 0);
    if (score > best.score) best = { index: layer.index, score };
  });
  return best.index;
}

/** The first layer showing a detail that `patch` just enabled, so the cut preview can jump to it. */
export function layerForEnabledDetail(result: GeometryIRV1, patch: Partial<ProjectConfigV1>): number | undefined {
  if (patch.showWaterDepth) return result.waterSurfaces[0]?.layerIndex;
  const matcher = patch.showRoads ? (id: string, kind: string, transportationClass?: string) => kind === "road" && transportationClass !== "rail" :
    patch.showTrails ? (id: string, kind: string) => kind === "trail" :
    patch.showRail ? (id: string, kind: string, transportationClass?: string) => transportationClass === "rail" :
    patch.showTransportationLabels ? (id: string) => id.startsWith("transport-label-") :
    patch.showWater ? (id: string, kind: string) => kind === "water" :
    patch.showBoundaries ? (id: string, kind: string) => kind === "boundary" :
    patch.showCoordinateGrid ? (id: string, kind: string) => kind === "grid" :
    patch.showAlignmentGuides ? (id: string) => id.startsWith("alignment-") :
    patch.showElevationLabels ? (id: string) => id.startsWith("elevation-") :
    patch.showNorthArrow ? (id: string) => id.startsWith("north-") :
    patch.showScaleBar ? (id: string) => id.startsWith("scale-") :
    patch.aviation && AVIATION_DATA_DETAILS.some((detail) => patch.aviation![detail]) ? (id: string, kind: string) => kind === "aviation" :
    patch.lands?.boundaries.length ? (id: string, kind: string) => kind === "land" :
    patch.plaque?.enabled ? (id: string) => id.startsWith("plaque-") : undefined;
  if (!matcher) return undefined;
  return result.layers.find((layer) => layer.markings.some((marking) => matcher(marking.id, marking.kind, marking.transportationClass)))?.index;
}

export interface DetailCounts {
  road: number; trail: number; rail: number; transportationLabel: number; water: number; contour: number; alignment: number;
  elevation: number; north: number; scale: number; plaque: number; marker: number; customLine: number; piece: number;
  aviation: number; aviationLabel: number; land: number; landLabel: number;
}

/** Marking counts per detail, exposed on the preview stage for tests and diagnostics. */
export function countDetailMarkings(layers: readonly LayerIR[], outputMode: ProjectConfigV1["outputMode"]): DetailCounts {
  const counts: DetailCounts = { road: 0, trail: 0, rail: 0, transportationLabel: 0, water: 0, contour: outputMode === "engraving" ? Math.max(0, layers.length - 1) : 0, alignment: 0, elevation: 0, north: 0, scale: 0, plaque: 0, marker: 0, customLine: 0, piece: 0, aviation: 0, aviationLabel: 0, land: 0, landLabel: 0 };
  for (const layer of layers) {
    for (const marking of layer.markings) {
      if (marking.transportationClass === "rail") counts.rail += 1;
      else if (marking.kind === "road") counts.road += 1;
      else if (marking.kind === "trail") counts.trail += 1;
      else if (marking.kind === "water") counts.water += 1;
      else if (marking.kind === "contour") counts.contour += 1;
      else if (marking.kind === "aviation") counts.aviation += 1;
      else if (marking.kind === "land") counts.land += 1;
      if (marking.id.startsWith("custom-data-line-")) counts.customLine += 1;
      else if (marking.id.startsWith("alignment-")) counts.alignment += 1;
      else if (marking.id.startsWith("piece-")) counts.piece += 1;
      else if (marking.id.startsWith("transport-label-")) counts.transportationLabel += 1;
      else if (marking.id.startsWith("aviation-label-")) counts.aviationLabel += 1;
      else if (marking.id.startsWith("land-label-")) counts.landLabel += 1;
      else if (marking.id.startsWith("elevation-")) counts.elevation += 1;
      else if (marking.id.startsWith("north-")) counts.north += 1;
      else if (marking.id.startsWith("scale-")) counts.scale += 1;
      else if (marking.id.startsWith("plaque-")) counts.plaque += 1;
      else if (marking.id.startsWith("map-marker-")) counts.marker += 1;
    }
  }
  return counts;
}

export interface ModeledLake { id: string; hylakId: number; name: string; maxDepthM: number; depthSource: WaterSurfaceIR["depthSource"] }

/**
 * Lakes deep enough to be worth a control, largest basin first. HydroLAKES
 * only names waterbodies of 500 km2 and up, so the label falls back to the
 * OSM name and then to a plain index.
 */
export function modeledLakes(waterSurfaces: readonly WaterSurfaceIR[] | undefined, limit = 4): ModeledLake[] {
  const names = lakeDisplayNames(waterSurfaces ?? []);
  return (waterSurfaces ?? [])
    // A maximum-depth override only affects modeled basins. Surveyed beds come
    // from the DEM or NOAA, so showing the same control for them would be a no-op.
    .filter((surface) => surface.kind === "lake" && surface.hylakId !== undefined && surface.depthSource !== "surveyed" && surface.maxDepthM !== undefined)
    .map((surface, index) => ({
      id: surface.id,
      hylakId: surface.hylakId!,
      name: names.get(waterInsertLakeKey(surface)) ?? surface.name ?? t("app.lakeNumber", { number: index + 1 }),
      maxDepthM: surface.maxDepthM ?? surface.surfaceElevationM - surface.bedElevationM,
      depthSource: surface.depthSource,
    }))
    .sort((left, right) => right.maxDepthM - left.maxDepthM)
    .slice(0, limit);
}

export interface InsertLake { key: string; name: string; insertIds: string[]; excluded: boolean }

/**
 * Every lake an acrylic insert could replace, one row per lake (a lake the
 * crop or its islands break into several surfaces is still one switch),
 * largest first. A lake with neither insert nor exclusion was skipped, and
 * the generation warnings say why.
 */
export function insertLakes(geometry: Pick<GeometryIRV1, "waterSurfaces" | "waterInserts">, project: Pick<ProjectConfigV1, "waterInserts">): InsertLake[] {
  const excluded = new Set(project.waterInserts?.excludedLakeIds ?? []);
  const rows = new Map<string, InsertLake & { areaMm2: number }>();
  for (const surface of geometry.waterSurfaces) {
    if (surface.kind !== "lake") continue;
    const key = waterInsertLakeKey(surface);
    const row = rows.get(key) ?? { key, name: surface.name ?? "", insertIds: [], excluded: excluded.has(key), areaMm2: 0 };
    row.areaMm2 += surface.polygons.reduce((total, polygon) => total + Math.abs(signedArea(polygon.outer)), 0);
    rows.set(key, row);
  }
  for (const insert of geometry.waterInserts ?? []) rows.get(insert.lakeKey)?.insertIds.push(insert.id);
  // Unnamed lakes take the numbers generation warnings use (largest first).
  const names = lakeDisplayNames(geometry.waterSurfaces);
  return [...rows.values()].sort((left, right) => right.areaMm2 - left.areaMm2).map(({ areaMm2: _area, ...row }) => ({ ...row, name: row.name || names.get(row.key) || row.key }));
}

/** How many unnested acrylic panels the export writes, by the grouping the export itself uses. */
export function acrylicPanelCount(geometry: Pick<GeometryIRV1, "waterInserts" | "waterInsertMaterial">, project: Pick<ProjectConfigV1, "workAreaWidthMm" | "workAreaHeightMm">): number {
  const material = geometry.waterInsertMaterial;
  return material ? acrylicPanelGroups(geometry.waterInserts ?? [], material, project).length : 0;
}

/** How many airspace panels the export writes, by the grouping the export itself uses. */
export function airspacePanelCount(geometry: Pick<GeometryIRV1, "airspaceStack">, project: Pick<ProjectConfigV1, "workAreaWidthMm" | "workAreaHeightMm">): number {
  return geometry.airspaceStack ? airspacePanelGroups(geometry.airspaceStack, project).length : 0;
}

const warningKey = (warning: Warning): string => `${warning.code}-${warning.message}`;

// Keep the depth provenance notice visible alongside a depth-fitting action,
// even when lower-priority messages exceed the preview's warning limit.
const warningPriority = (warning: Warning) => warning.action === "fit-lake-depth" ? 2 : warning.code === "LAKE_DEPTH_PREDICTED" ? 1 : 0;

/**
 * The warnings the preview shows. Several unnamed lakes can emit the same
 * coverage warning, so each message is rendered and dismissed once, keeping
 * keyed rows unique.
 */
export function visibleWarnings(warnings: readonly Warning[], dismissed: readonly string[], limit = 2): Warning[] {
  return [...new Map(warnings.map((warning) => [warningKey(warning), warning])).values()]
    .filter((warning) => !dismissed.includes(warningKey(warning)))
    .sort((a, b) => warningPriority(b) - warningPriority(a))
    .slice(0, limit);
}

/** Enabled map details that apply to the current output mode. */
export function activeDetailCount(project: ProjectConfigV1): number {
  return [
    project.showRoads,
    project.showTrails,
    project.showRail,
    project.showTransportationLabels,
    project.showWater,
    project.showBoundaries,
    project.showCoordinateGrid,
    project.showElevationLabels,
    project.showNorthArrow,
    project.showScaleBar,
    project.plaque?.enabled === true,
    ...AVIATION_DATA_DETAILS.map((detail) => project.aviation?.[detail] === true),
    Boolean(project.lands?.boundaries.length),
    project.outputMode === "stack" && project.showWaterDepth,
    project.outputMode === "stack" && project.showAlignmentGuides,
    project.outputMode === "engraving" && project.showEngravingBorder,
  ].filter(Boolean).length;
}

/** The linework preset matching the project's style exactly, if any. */
export function activeLinePreset(lineStyle: ProjectConfigV1["lineStyle"]): string | undefined {
  const style = JSON.stringify(lineStyle);
  return LINE_PRESETS.find((preset) => JSON.stringify(preset.style) === style)?.value;
}

/** A length in display units, up to three decimals, without digit grouping ("1200 × 200 mm"). */
function shownLength(valueMm: number, units: ProjectConfigV1["units"]): string {
  return formatNumber(Number(displayLength(valueMm, units).toFixed(3)), { maximumFractionDigits: 3, useGrouping: false });
}

/** One-line summary under each panel's title. */
export function panelSummary(panel: DisclosureId, project: ProjectConfigV1, stackLayerCount: number): string {
  const unit = lengthUnit(project.units);
  const stack = project.outputMode === "stack";
  switch (panel) {
    case "setup": return t("app.summarySetup", { mode: stack ? "stack" : "engraving", place: project.location.label.split(",")[0] });
    case "place": return t("app.summaryPlace", { shape: project.cropShape === "circle" ? "circle" : "rectangle", width: shownLength(project.widthMm, project.units), height: shownLength(project.heightMm, project.units), unit });
    case "terrain": return stack ? t("app.summaryTerrainStack", { count: stackLayerCount, thickness: shownLength(project.materialThicknessMm, project.units), unit }) : project.showEngravingContours ? t("app.summaryTerrainContours", { count: project.engravingContourCount, interval: project.engravingIndexInterval }) : t("app.summaryTerrainContoursOff");
    case "features": {
      const count = [project.showRoads, project.showTrails, project.showRail, project.showTransportationLabels, project.showBoundaries, project.showCoordinateGrid, !stack && project.showEngravingBorder, Boolean(project.lands?.boundaries.length), stack && project.paintTemplates.some((kind) => kind !== "water")].filter(Boolean).length;
      const preset = activeLinePreset(project.lineStyle);
      return t("app.summaryFeatures", { count, preset: preset && LINE_PRESETS.some((option) => option.value === preset) ? preset : "custom" });
    }
    case "water": {
      const parts = [stack && project.showWaterDepth ? t("app.summaryWaterCarvedDepth") : project.showWater ? t("app.summaryWaterOutlines") : t("app.summaryOff")];
      if (stack && project.waterInserts) parts.push(t("app.summaryWaterAcrylicInserts"));
      if (stack && project.paintTemplates.length) parts.push(t("app.summaryWaterPaintTemplates"));
      return parts.join(" · ");
    }
    case "aviation": {
      const count = AVIATION_DATA_DETAILS.filter((detail) => project.aviation?.[detail] === true).length;
      const parts = [count ? t("app.summaryAviationLayers", { count }) : t("app.summaryOff")];
      if (stack && project.airspaceStack) parts.push(t("app.summaryAviationAirspace3d"));
      return parts.join(" · ");
    }
    case "labels": {
      const count = [project.showElevationLabels, project.showNorthArrow, project.showScaleBar, project.plaque?.enabled === true].filter(Boolean).length;
      return t("app.summaryLabels", { count, size: shownLength(project.textStyle.sizeMm, project.units), unit });
    }
    case "make": {
      if (!stack) return t("app.summaryMakeEngraving", { size: shownLength(project.minimumFeatureMm, project.units), unit });
      const seams = planSeamGrid(project);
      const kerf = shownLength(project.laserKerfMm, project.units);
      return seams ? t("app.summaryMakeSeams", { kerf, unit, columns: seams.columns, rows: seams.rows }) : t("app.summaryMakeOnePiece", { kerf, unit });
    }
    case "customData": return t("app.summaryCustomData", { markers: project.markers.length, paths: project.customLines.length });
  }
}
