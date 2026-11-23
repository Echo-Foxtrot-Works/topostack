import { CIRCLE_CROP_SEGMENTS, cropRadiusMm } from "../primitives/crop.js";
import { formatNumber as format } from "../primitives/format.js";
import polygonClipping, { type MultiPolygon, type Pair, type Ring } from "polygon-clipping";
import { clamp, pointAt, normalizeMultiPolygon, ringBounds, simplify, toRing } from "../primitives/geometry2d.js";
import { sampleIndexAt, sampleOffset } from "../primitives/grid.js";
import type { ElevationGrid, Point2D, Polygon2D, ProjectConfigV1 } from "../types.js";


/**
 * Douglas-Peucker tolerance for contour rings. Fixed rather than derived from
 * the minimum feature size, so raising that setting removes undersized pieces
 * and holes without coarsening the outlines that remain.
 */
export const CONTOUR_SIMPLIFICATION_TOLERANCE_MM = 0.144;

export function removeTinyRing(points: Point2D[], minimumFeatureMm: number): boolean {
  if (points.length < 4) return true;
  const bounds = ringBounds(points);
  return bounds.maxX - bounds.minX < minimumFeatureMm || bounds.maxY - bounds.minY < minimumFeatureMm;
}

// Replace only visibly sharp turns with a short quadratic arc. Both smoothing
// modes begin with the same simplified iso-line; the enabled mode therefore
// changes corner shape rather than exposing more source-grid detail. Limiting
// the trim to one grid cell prevents broad terrain features from shrinking.
export function roundContourRing(ring: Pair[], maximumTrimMm: number): Pair[] {
  if (ring.length < 5) return ring;
  const open = ring.slice(0, -1);
  const rounded: Ring = [];
  for (let index = 0; index < open.length; index += 1) {
    const previous = open[(index - 1 + open.length) % open.length]!;
    const current = open[index]!;
    const next = open[(index + 1) % open.length]!;
    const incomingX = current[0] - previous[0];
    const incomingY = current[1] - previous[1];
    const outgoingX = next[0] - current[0];
    const outgoingY = next[1] - current[1];
    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);
    if (incomingLength <= 1e-9 || outgoingLength <= 1e-9) {
      rounded.push([current[0], current[1]]);
      continue;
    }
    const dot = clamp((incomingX * outgoingX + incomingY * outgoingY) / (incomingLength * outgoingLength), -1, 1);
    if (Math.acos(dot) < Math.PI / 15) {
      rounded.push([current[0], current[1]]);
      continue;
    }
    const trim = Math.min(maximumTrimMm, incomingLength * 0.4, outgoingLength * 0.4);
    const start: Pair = [current[0] - incomingX * trim / incomingLength, current[1] - incomingY * trim / incomingLength];
    const end: Pair = [current[0] + outgoingX * trim / outgoingLength, current[1] + outgoingY * trim / outgoingLength];
    rounded.push(
      start,
      [start[0] * 0.25 + current[0] * 0.5 + end[0] * 0.25, start[1] * 0.25 + current[1] * 0.5 + end[1] * 0.25],
      end,
    );
  }
  rounded.push([rounded[0]![0], rounded[0]![1]]);
  return rounded;
}

// d3-contour emits ring coordinates in cell space where sample (i, j) sits at
// (i + 0.5, j + 0.5); map samples 0..n-1 onto the full material span so the
// forward mapping stays the exact inverse of sampleElevation.
export function contourToMm(point: [number, number], grid: ElevationGrid, config: ProjectConfigV1): Point2D {
  return {
    x: sampleOffset(point[0] - 0.5, grid.width, config.widthMm),
    y: sampleOffset(point[1] - 0.5, grid.height, config.heightMm),
  };
}

/** Pass `simplificationTolerance` 0 for rings already simplified, or simplifying again flattens their rounded corners. */
export function clipContours(raw: MultiPolygon, clip: Point2D[], minimumFeatureMm: number, simplificationTolerance = CONTOUR_SIMPLIFICATION_TOLERANCE_MM): Polygon2D[] {
  return normalizeMultiPolygon(polygonClipping.intersection(raw, [[toRing(clip)]]) as MultiPolygon, (ring) => {
    const refined = simplify(ring, simplificationTolerance);
    return removeTinyRing(refined, minimumFeatureMm) ? undefined : refined;
  });
}

export function sampleElevation(grid: ElevationGrid, point: Point2D, config: ProjectConfigV1): number {
  const gridX = clamp(Math.round(sampleIndexAt(point.x, grid.width, config.widthMm)), 0, grid.width - 1);
  const gridY = clamp(Math.round(sampleIndexAt(point.y, grid.height, config.heightMm)), 0, grid.height - 1);
  return grid.values[gridY * grid.width + gridX] ?? grid.min;
}

export function layerForElevation(elevation: number, thresholds: number[]): number {
  let layer = 0;
  for (let index = 1; index < thresholds.length; index += 1) {
    if (elevation >= (thresholds[index] ?? Number.POSITIVE_INFINITY)) layer = index;
  }
  return layer;
}

type EngravingCrop = Pick<ProjectConfigV1, "cropShape" | "widthMm" | "heightMm">;

function segmentOnCropBoundary(start: Point2D, end: Point2D, config: EngravingCrop): boolean {
  const epsilon = 0.02;
  if (config.cropShape === "circle") {
    // Contours are clipped to a polygon, not a true circle, and simplified
    // afterwards. A vertex on the crop can therefore sit up to one chord
    // sagitta inside the radius, and a simplified run of crop edges bows
    // inward by up to the simplification tolerance as well. A fixed epsilon
    // smaller than that sagitta let whole arcs through as engraved stubs.
    const radius = cropRadiusMm(config);
    const sagitta = radius * (1 - Math.cos(Math.PI / CIRCLE_CROP_SEGMENTS));
    const inner = radius - sagitta - CONTOUR_SIMPLIFICATION_TOLERANCE_MM - epsilon;
    const onBoundary = (point: Point2D) => {
      const distance = Math.hypot(point.x, point.y);
      return distance >= inner && distance <= radius + epsilon;
    };
    return onBoundary(start) && onBoundary(end) && onBoundary(pointAt(start, end, 0.5));
  }
  const halfWidth = config.widthMm / 2;
  const halfHeight = config.heightMm / 2;
  return (Math.abs(start.x - halfWidth) <= epsilon && Math.abs(end.x - halfWidth) <= epsilon) ||
    (Math.abs(start.x + halfWidth) <= epsilon && Math.abs(end.x + halfWidth) <= epsilon) ||
    (Math.abs(start.y - halfHeight) <= epsilon && Math.abs(end.y - halfHeight) <= epsilon) ||
    (Math.abs(start.y + halfHeight) <= epsilon && Math.abs(end.y + halfHeight) <= epsilon);
}

/**
 * Filled contour polygons include pieces of the crop edge whenever terrain
 * continues beyond the artwork. Remove those edge-following pieces so a flat
 * topographic line terminates naturally at the optional border.
 */
export function openContourPath(points: Point2D[], config: EngravingCrop): string {
  let result = "";
  let connected = false;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (segmentOnCropBoundary(start, end, config)) {
      connected = false;
      continue;
    }
    if (!connected) result += `M${format(start.x)} ${format(start.y)}`;
    result += `L${format(end.x)} ${format(end.y)}`;
    connected = true;
  }
  return result;
}
