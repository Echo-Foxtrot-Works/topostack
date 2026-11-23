import type { Point2D } from "../types.js";

/** Convex hull, counter-clockwise and closed (Andrew's monotone chain). */
export function convexHull(points: Point2D[]): Point2D[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (o: Point2D, a: Point2D, b: Point2D) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point2D[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point2D[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length ? [...hull, hull[0]!] : [];
}

/** Minimum distance between parallel supporting lines, independent of map rotation. */
export function minimumCaliperWidth(points: Point2D[]): number {
  const hull = convexHull(points);
  const count = hull.length - 1;
  if (count < 3) return 0;
  let opposite = 1;
  let width = Infinity;
  for (let i = 0; i < count; i++) {
    const a = hull[i]!, b = hull[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const area = (j: number) => dx * (hull[j]!.y - a.y) - dy * (hull[j]!.x - a.x);
    // The antipodal vertex advances around the hull as each edge becomes the base.
    while (area((opposite + 1) % count) > area(opposite)) opposite = (opposite + 1) % count;
    width = Math.min(width, area(opposite) / Math.hypot(dx, dy));
  }
  return width;
}
