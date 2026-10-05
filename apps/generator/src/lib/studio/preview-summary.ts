import { AVIATION_DATA_DETAILS, displayLength, lengthUnit, planSeamGrid, type GeometryIRV1, type LayerIR, type ProjectConfigV1, type WaterSurfaceIR } from "@topostack/core";
import { LINE_PRESETS } from "$lib/studio/options";

/** Pure summaries of a project and its preview geometry, shown in the sidebar and preview. */

export type ConfigSectionId = "setup" | "size" | "terrain" | "details" | "customData" | "linework" | "advanced";
export const CONFIG_SECTION_IDS: ConfigSectionId[] = ["setup", "size", "terrain", "details", "customData", "linework", "advanced"];

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
  const matcher = patch.showRoads ? (id: string, kind: string) => kind === "road" :
    patch.showTrails ? (id: string, kind: string) => kind === "trail" :
    patch.showTransportationLabels ? (id: string) => id.startsWith("transport-label-") :
    patch.showWater ? (id: string, kind: string) => kind === "water" :
    patch.showBoundaries ? (id: string, kind: string) => kind === "boundary" :
    patch.showCoordinateGrid ? (id: string, kind: string) => kind === "grid" :
    patch.showAlignmentGuides ? (id: string) => id.startsWith("alignment-") :
    patch.showElevationLabels ? (id: string) => id.startsWith("elevation-") :
    patch.showNorthArrow ? (id: string) => id.startsWith("north-") :
    patch.showScaleBar ? (id: string) => id.startsWith("scale-") :
    patch.aviation && AVIATION_DATA_DETAILS.some((detail) => patch.aviation![detail]) ? (id: string, kind: string) => kind === "aviation" :
    patch.plaque?.enabled ? (id: string) => id.startsWith("plaque-") : undefined;
  if (!matcher) return undefined;
  return result.layers.find((layer) => layer.markings.some((marking) => matcher(marking.id, marking.kind)))?.index;
}

export interface DetailCounts {
  road: number; trail: number; transportationLabel: number; water: number; contour: number; alignment: number;
  elevation: number; north: number; scale: number; plaque: number; marker: number; customLine: number; piece: number;
  aviation: number; aviationLabel: number;
}

/** Marking counts per detail, exposed on the preview stage for tests and diagnostics. */
export function countDetailMarkings(layers: readonly LayerIR[], outputMode: ProjectConfigV1["outputMode"]): DetailCounts {
  const counts: DetailCounts = { road: 0, trail: 0, transportationLabel: 0, water: 0, contour: outputMode === "engraving" ? Math.max(0, layers.length - 1) : 0, alignment: 0, elevation: 0, north: 0, scale: 0, plaque: 0, marker: 0, customLine: 0, piece: 0, aviation: 0, aviationLabel: 0 };
  for (const layer of layers) {
    for (const marking of layer.markings) {
      if (marking.kind === "road") counts.road += 1;
      else if (marking.kind === "trail") counts.trail += 1;
      else if (marking.kind === "water") counts.water += 1;
      else if (marking.kind === "contour") counts.contour += 1;
      else if (marking.kind === "aviation") counts.aviation += 1;
      if (marking.id.startsWith("custom-data-line-")) counts.customLine += 1;
      else if (marking.id.startsWith("alignment-")) counts.alignment += 1;
      else if (marking.id.startsWith("piece-")) counts.piece += 1;
      else if (marking.id.startsWith("transport-label-")) counts.transportationLabel += 1;
      else if (marking.id.startsWith("aviation-label-")) counts.aviationLabel += 1;
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
  return (waterSurfaces ?? [])
    // A maximum-depth override only affects modeled basins. Surveyed beds come
    // from the DEM or NOAA, so showing the same control for them would be a no-op.
    .filter((surface) => surface.kind === "lake" && surface.hylakId !== undefined && surface.depthSource !== "surveyed" && surface.maxDepthM !== undefined)
    .map((surface, index) => ({
      id: surface.id,
      hylakId: surface.hylakId!,
      name: surface.name ?? `Lake ${index + 1}`,
      maxDepthM: surface.maxDepthM ?? surface.surfaceElevationM - surface.bedElevationM,
      depthSource: surface.depthSource,
    }))
    .sort((left, right) => right.maxDepthM - left.maxDepthM)
    .slice(0, limit);
}

export const warningKey = (warning: Warning): string => `${warning.code}-${warning.message}`;

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
    project.showTransportationLabels,
    project.showWater,
    project.showBoundaries,
    project.showCoordinateGrid,
    project.showElevationLabels,
    project.showNorthArrow,
    project.showScaleBar,
    project.plaque?.enabled === true,
    ...AVIATION_DATA_DETAILS.map((detail) => project.aviation?.[detail] === true),
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

function shownLength(valueMm: number, units: ProjectConfigV1["units"]): number {
  return Number(displayLength(valueMm, units).toFixed(3));
}

/** One-line summary under each collapsible sidebar section title. */
export function sectionSummary(section: ConfigSectionId, project: ProjectConfigV1, stackLayerCount: number): string {
  const unit = lengthUnit(project.units);
  switch (section) {
    case "setup": return `${project.outputMode === "engraving" ? "Flat engraving" : "Layered relief"} · ${project.location.label.split(",")[0]}`;
    case "size": return `${project.cropShape === "circle" ? "Circle" : "Rectangle"} · ${shownLength(project.widthMm, project.units)} × ${shownLength(project.heightMm, project.units)} ${unit}`;
    case "terrain": return project.outputMode === "engraving" ? `${project.engravingContourCount} contours · index every ${project.engravingIndexInterval}` : `${stackLayerCount} layers · ${shownLength(project.materialThicknessMm, project.units)} ${unit} material`;
    case "details": { const count = activeDetailCount(project); return `${count} ${count === 1 ? "detail" : "details"} enabled`; }
    case "customData": return `${project.markers.length} ${project.markers.length === 1 ? "marker" : "markers"} · ${project.customLines.length} ${project.customLines.length === 1 ? "path" : "paths"}`;
    case "linework": { const preset = activeLinePreset(project.lineStyle); return preset ? `${LINE_PRESETS.find((option) => option.value === preset)?.label ?? preset} preset` : "Custom stroke widths"; }
    case "advanced": {
      const seams = planSeamGrid(project);
      const contours = project.smoothing === 1 ? "Smooth contours" : "Standard contours";
      const paint = project.outputMode === "stack" && project.paintTemplates.length ? " · Paint templates" : "";
      return `${seams ? `${seams.columns} × ${seams.rows} sheets per layer · ${contours}` : contours}${paint}`;
    }
  }
}
