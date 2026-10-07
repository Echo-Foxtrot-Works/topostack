import { clipContours, layerForElevation } from "./contours.js";
import { toMultiPolygon } from "../primitives/geometry2d.js";
import { waterSurfaceLevelM } from "../water/water.js";
import type { FlatWaterArea } from "./paint-regions.js";
import type { ElevationGrid, MarkingFeature, Point2D, Polygon2D, WaterSurfaceIR } from "../types.js";
import type { ElevationLadder, GenerationContext } from "./generation-context.js";

function waterPatternAreasFromShorelines(markings: MarkingFeature[]): Polygon2D[] {
  const grouped = new Map<string, Map<number, Point2D[]>>();
  for (const marking of markings) {
    const match = marking.kind === "water" ? marking.id.match(/^(.*water-area-[^-]+)-shore-(\d+)/) : undefined;
    if (!match || marking.points.length < 4) continue;
    const rings = grouped.get(match[1]!) ?? new Map<number, Point2D[]>();
    rings.set(Number(match[2]), marking.points);
    grouped.set(match[1]!, rings);
  }
  return [...grouped.values()].flatMap((rings) => {
    const outer = rings.get(0);
    return outer ? [{ outer, holes: [...rings.entries()].filter(([index]) => index > 0).sort(([left], [right]) => left - right).map(([, points]) => points) }] : [];
  });
}

function clipToCrop(polygon: Polygon2D, clip: Point2D[], minimumFeatureMm: number): Polygon2D[] {
  return clipContours(toMultiPolygon([polygon]), clip, minimumFeatureMm);
}

/**
 * Water for paint stencils when nothing carves it. With depth off no surface
 * is modelled, but a lake still lies flat in the DEM, so its whole face
 * belongs to the layer holding its level. Empty when carved surfaces already
 * describe every area.
 */
export function flatWaterAreas({ config, source, usesWaterDepth, clip }: GenerationContext, grid: ElevationGrid, ladder: ElevationLadder): FlatWaterArea[] {
  if (usesWaterDepth || !config.paintTemplates.includes("water")) return [];
  return (source.waterAreas ?? []).flatMap((area) => {
    const level = Number.isFinite(area.surfaceElevationM) ? area.surfaceElevationM! : waterSurfaceLevelM(area, grid, config);
    if (!Number.isFinite(level)) return [];
    const polygons = clipToCrop(area.polygon, clip, config.minimumFeatureMm);
    return polygons.length ? [{ layerIndex: layerForElevation(level, ladder.thresholds), polygons }] : [];
  });
}

export function waterOutputs({ config, source, flatEngraving, clip, warnings }: GenerationContext, ladder: ElevationLadder): { waterSurfaces: WaterSurfaceIR[]; waterPatternAreas: Polygon2D[] } {
  // Surfaces are virtual - never cut, only drawn - so they are clipped to the
  // crop here and carried on the IR for the previews to float over the basin.
  const waterSurfaces: WaterSurfaceIR[] = ladder.water.surfaces.flatMap((surface) => {
    const polygons = surface.polygons.flatMap((polygon) => clipToCrop(polygon, clip, config.minimumFeatureMm));
    if (!polygons.length) return [];
    return [{ ...surface, polygons, layerIndex: layerForElevation(surface.surfaceElevationM, ladder.thresholds) }];
  });

  // Report provenance for lakes actually included in the output. A user-set
  // maximum or partial survey does not make the rest of a lake floor measured.
  // A traced chart is neither surveyed nor modeled; gaps in one are reported
  // per lake as BATHYMETRY_FALLBACK when it is carved.
  const lakes = waterSurfaces.filter((surface) => surface.kind === "lake");
  if (lakes.some((surface) => surface.depthSource !== "surveyed" && surface.bathymetryOrigin !== "chart")) warnings.push({
    code: "LAKE_DEPTH_PREDICTED",
    message: "Some lake depths are estimated rather than surveyed. Modeled lake floors may differ from the actual underwater terrain.",
  });
  if (lakes.some((surface) => surface.bathymetryOrigin === "chart")) warnings.push({
    code: "LAKE_DEPTH_FROM_CHART",
    message: "Some lake floors come from a traced depth chart. They are only as accurate as the chart and its tracing.",
  });

  const waterPatternAreas = flatEngraving && config.showWater && config.waterFillPattern !== "none"
    ? (source.waterPatternAreas ?? source.waterAreas?.map((area) => area.polygon) ?? waterPatternAreasFromShorelines(source.markings))
        .flatMap((polygon) => clipToCrop(polygon, clip, config.minimumFeatureMm))
    : [];
  return { waterSurfaces, waterPatternAreas };
}
