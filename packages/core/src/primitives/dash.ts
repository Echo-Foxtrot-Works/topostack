import type { Point2D } from "../types.js";

export interface Polyline { points: Point2D[]; closed: boolean }

/** Split a polyline into the drawn dashes of an SVG dash array, starting with a dash at offset 0. */
export function dashPolyline(line: Polyline, pattern: readonly number[]): Polyline[] {
  const lengths = pattern.length % 2 ? [...pattern, ...pattern] : [...pattern];
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!lengths.length || total <= 0) return [line];
  const points = line.closed && line.points.length > 1 ? [...line.points, line.points[0]!] : line.points;
  const dashes: Polyline[] = [];
  // A zero-length dash is a round-cap dot in SVG; LightBurn drops a path with no length.
  const finish = (dash: Point2D[] | undefined) => {
    if (dash && dash.length > 1 && (dash[0]!.x !== dash.at(-1)!.x || dash[0]!.y !== dash.at(-1)!.y)) dashes.push({ points: dash, closed: false });
  };
  let slot = 0;
  let remaining = lengths[0]!;
  let current: Point2D[] | undefined = [points[0]!];
  for (let index = 1; index < points.length; index += 1) {
    let start = points[index - 1]!;
    const end = points[index]!;
    let segment = Math.hypot(end.x - start.x, end.y - start.y);
    while (segment > 0) {
      const step = Math.min(segment, remaining);
      const t = step / segment;
      const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      if (current) current.push(point);
      segment -= step;
      remaining -= step;
      start = point;
      if (remaining <= 1e-9) {
        finish(current);
        slot = (slot + 1) % lengths.length;
        remaining = lengths[slot]!;
        current = slot % 2 === 0 ? [point] : undefined;
      }
    }
  }
  finish(current);
  return dashes;
}
