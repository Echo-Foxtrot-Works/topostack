import type { Point2 } from "./local-frame.ts";

/** Total length of an open path. */
export function pathLength(points: readonly Point2[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  return total;
}

/** Unsigned area of a ring, open or closed. */
export function ringArea(ring: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}
