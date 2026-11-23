import { convexHull } from "../../primitives/convex-hull.js";
import type { Bounds2D } from "../../primitives/geometry2d.js";
import type { Point2D } from "../../types.js";

export interface RigidTransform {
  rotationDeg: number;
  x: number;
  y: number;
}

/** `R(rotationDeg) · p + (x, y)` for every point. */
export function transformPoints(points: Point2D[], transform: RigidTransform): Point2D[] {
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point) => ({ x: cos * point.x - sin * point.y + transform.x, y: sin * point.x + cos * point.y + transform.y }));
}

/** Bounds of the points after rotating them about the origin. */
export function rotatedBounds(points: Point2D[], rotationDeg: number): Bounds2D {
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const x = cos * point.x - sin * point.y;
    const y = sin * point.x + cos * point.y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

const normalizeDegrees = (value: number) => ((value % 360) + 360) % 360;

/**
 * Rotations worth trying when a bounding box stands in for the part: the
 * allowed set as given, or for free rotation the quarter turns plus the
 * angles that align a convex-hull edge with an axis (the minimum-area
 * bounding rectangle is always one of them).
 */
export function candidateOrientations(outline: Point2D[], allowed: number[] | undefined): number[] {
  if (allowed) return allowed;
  const angles = new Set([0, 90, 180, 270]);
  const hull = convexHull(outline);
  const scored: Array<{ angle: number; area: number }> = [];
  for (let index = 0; index + 1 < hull.length; index += 1) {
    const a = hull[index]!;
    const b = hull[index + 1]!;
    const angle = normalizeDegrees(-(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
    const bounds = rotatedBounds(hull, angle);
    scored.push({ angle, area: (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) });
  }
  // The four best edge alignments cover the minimum-area box and its quarter turns.
  scored.sort((left, right) => left.area - right.area).slice(0, 4).forEach(({ angle }) => {
    for (const quarter of [0, 90, 180, 270]) angles.add(Number(normalizeDegrees(angle + quarter).toFixed(6)));
  });
  return [...angles];
}

/**
 * Extra orientations for a part whose minimum-area box misses the sheet.
 * Between hull-edge alignments the vertices defining the width and height
 * stay fixed. Each extent is a positive sinusoid, hence concave there. Split
 * each interval again where the width equals the sheet width. On its
 * width-feasible pieces, the minimum height is attained at an endpoint.
 */
export function* sheetFitOrientations(points: Point2D[], sheetWidth: number): Generator<number> {
  const hull = convexHull(points);
  const breaks = new Set([0, Math.PI]);
  for (let i = 1; i < hull.length; i++) {
    const a = hull[i - 1]!, b = hull[i]!;
    const alignment = -Math.atan2(b.y - a.y, b.x - a.x);
    for (const offset of [0, Math.PI / 2]) breaks.add((alignment + offset + 2 * Math.PI) % Math.PI);
  }
  const angles = [...breaks].sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i++) {
    const lo = angles[i - 1]!, hi = angles[i]!;
    yield lo * 180 / Math.PI;
    if (!Number.isFinite(sheetWidth)) continue;
    const mid = (lo + hi) / 2;
    const cos = Math.cos(mid), sin = Math.sin(mid);
    const projectedX = (p: Point2D) => p.x * cos - p.y * sin;
    let left = hull[0]!, right = left;
    for (const p of hull) {
      if (projectedX(p) < projectedX(left)) left = p;
      if (projectedX(p) > projectedX(right)) right = p;
    }
    const dx = right.x - left.x, dy = right.y - left.y;
    const span = Math.hypot(dx, dy);
    if (span < sheetWidth || !span) continue;
    const phase = Math.atan2(-dy, dx);
    const delta = Math.acos(sheetWidth / span);
    for (const root of [phase - delta, phase + delta]) {
      const angle = (root + 2 * Math.PI) % (2 * Math.PI);
      if (angle >= lo && angle <= hi) yield angle * 180 / Math.PI;
    }
  }
}
