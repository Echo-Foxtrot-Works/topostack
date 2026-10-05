import polygonClipping, { type MultiPolygon, type Pair, type Ring } from "polygon-clipping";
import { clamp, normalizeMultiPolygon, ringBounds, simplify, toRing } from "../primitives/geometry2d.js";
import { sampleIndexAt, sampleOffset } from "../primitives/grid.js";
import type { ElevationGrid, Point2D, Polygon2D, ProjectConfigV1 } from "../types.js";


/** Douglas-Peucker tolerance for contour rings, as a fraction of the minimum feature size. */
export const CONTOUR_SIMPLIFICATION_FACTOR = 0.18;

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
export function clipContours(raw: MultiPolygon, clip: Point2D[], minimumFeatureMm: number, simplificationTolerance = minimumFeatureMm * CONTOUR_SIMPLIFICATION_FACTOR): Polygon2D[] {
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
