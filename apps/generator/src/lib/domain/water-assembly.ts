import type { Polygon2D, ProjectConfigV1, SourceBundleV1, WaterAreaV1 } from "@topostack/core";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { resolveLakeOutlines } from "$lib/domain/lake-outlines";
import { limitVectorMarkingGroups, multiPolygonToAreas, shorelineMarkings } from "$lib/domain/vector-cleanup";

/**
 * Merge the depth-bearing lakes with the OSM ocean.
 *
 * Where a HydroLAKES lake covers OSM water, the lake wins and the OSM shape is
 * cut away. Both would otherwise describe the same shoreline a few tens of
 * meters apart, and the scored outline would visibly miss the cut recess.
 */
export function combineWaterAreas(lakes: WaterAreaV1[], ocean: Polygon2D[], minimumFeatureMm: number): WaterAreaV1[] {
  const oceanAreas: WaterAreaV1[] = ocean.map((polygon, index) => ({ id: `ocean-${index}`, kind: "ocean", polygon }));
  if (!lakes.length || !ocean.length) return [...oceanAreas, ...lakes];
  const lakeInput: MultiPolygon = lakes.map((lake) => [
    lake.polygon.outer.map((point) => [point.x, point.y] as Pair),
    ...lake.polygon.holes.map((ring) => ring.map((point) => [point.x, point.y] as Pair)),
  ]);
  const trimmed: WaterAreaV1[] = [];
  oceanAreas.forEach((area, areaIndex) => {
    const difference = polygonClipping.difference(
      [[area.polygon.outer.map((point) => [point.x, point.y] as Pair), ...area.polygon.holes.map((ring) => ring.map((point) => [point.x, point.y] as Pair))]],
      lakeInput,
    );
    multiPolygonToAreas(difference, minimumFeatureMm).forEach((polygon, index) => {
      trimmed.push({ id: `ocean-${areaIndex}-${index}`, kind: "ocean", polygon });
    });
  });
  return [...trimmed, ...lakes];
}

/** Keep visible shorelines aligned with the polygons used for lake depths. */
export function applyLakeShorelines(source: SourceBundleV1, config: ProjectConfigV1): SourceBundleV1 {
  if (!source.waterAreas?.length) return source;
  const lakes = resolveLakeOutlines([], source.waterAreas.filter((area) => area.kind === "lake"), source.inlandWaterAreas ?? []);
  // A lake that takes a more detailed shore here must be carved to that shore.
  const shores = new Map(lakes.map((lake) => [lake.id, lake.polygon]));
  const waterAreas = source.waterAreas.map((area) => {
    const shore = area.kind === "lake" ? shores.get(area.id) : undefined;
    return shore && shore !== area.polygon ? { ...area, polygon: shore } : area;
  });
  const polygons = [...source.waterAreas.filter((area) => area.kind === "ocean").map((area) => area.polygon), ...lakes.map((area) => area.polygon)];
  const limited = limitVectorMarkingGroups([
    source.markings.filter((marking) => !marking.id.startsWith("water-area-")),
    config.showWater ? shorelineMarkings(polygons) : [],
  ]);
  return { ...source, waterAreas, markings: limited.markings, waterPatternAreas: polygons,
    vectorStatus: limited.truncated && source.vectorStatus === "available" ? "partial" : source.vectorStatus };
}

/**
 * The final water step shared by full generation and in-place preview
 * refreshes: trim the ocean under lakes, then rebuild shorelines to match.
 */
export function assembleWater(source: SourceBundleV1, lakes: WaterAreaV1[], ocean: Polygon2D[], config: ProjectConfigV1): SourceBundleV1 {
  return applyLakeShorelines({ ...source, waterAreas: combineWaterAreas(lakes, ocean, config.minimumFeatureMm) }, config);
}
