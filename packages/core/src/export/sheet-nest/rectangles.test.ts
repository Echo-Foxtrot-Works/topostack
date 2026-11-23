import { describe, expect, it } from "vitest";
import type { StripEngineItem } from "./engine.js";
import { packRectangles, rectangleEngine } from "./rectangles.js";
import { convexHull } from "../../primitives/convex-hull.js";
import { candidateOrientations, rotatedBounds, transformPoints } from "./transform.js";

const rect = (width: number, height: number, x = 0, y = 0): Array<[number, number]> => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
const placedBounds = (item: StripEngineItem, placement: { rotationDeg: number; x: number; y: number }) =>
  rotatedBounds(transformPoints(item.outline.map(([x, y]) => ({ x, y })), placement), 0);

describe("bounding-box strip packing", () => {
  it("packs boxes without overlap, inside the strip, with spacing between them", () => {
    const items: StripEngineItem[] = [rect(40, 30, 5, 5), rect(40, 30), rect(20, 62, -10, 3), rect(10, 10)].map((outline) => ({ outline, orientationsDeg: [0] }));
    const { placements, stripWidth, unplaced } = packRectangles(items, 62, 2);
    expect(unplaced).toEqual([]);
    const boxes = placements.map((placement) => placedBounds(items[placement.index]!, placement));
    for (const box of boxes) {
      expect(box.minX).toBeGreaterThanOrEqual(-1e-9);
      expect(box.minY).toBeGreaterThanOrEqual(-1e-9);
      expect(box.maxY).toBeLessThanOrEqual(62 + 1e-9);
      expect(box.maxX).toBeLessThanOrEqual(stripWidth + 1e-9);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        const apart = a.maxX + 2 <= b.minX + 1e-9 || b.maxX + 2 <= a.minX + 1e-9 || a.maxY + 2 <= b.minY + 1e-9 || b.maxY + 2 <= a.minY + 1e-9;
        expect(apart).toBe(true);
      }
    }
    // 20 x 62 fills the height alone; the two 40 x 30 stack beside it (30 + 2 + 30 = 62).
    expect(stripWidth).toBeLessThanOrEqual(20 + 2 + 40 + 2 + 10 + 1e-9);
  });

  it("rotates a box that only fits turned", () => {
    const items = [{ outline: rect(80, 20), orientationsDeg: [0, 90] }];
    const { placements } = packRectangles(items, 50, 0);
    expect(placements[0]!.rotationDeg).toBe(0);
    const tall = packRectangles([{ outline: rect(20, 80), orientationsDeg: [0, 90] }], 50, 0);
    expect(tall.placements[0]!.rotationDeg).toBe(90);
    expect(tall.stripWidth).toBeCloseTo(80, 9);
  });

  it("leaves boxes past the width limit for the next sheet", () => {
    const items = [0, 1, 2].map(() => ({ outline: rect(40, 40), orientationsDeg: [0] }));
    const { placements, unplaced } = packRectangles(items, 50, 0, 90);
    expect(placements).toHaveLength(2);
    expect(unplaced).toHaveLength(1);
  });

  it("reports items taller than the strip through the engine", () => {
    expect(() => rectangleEngine.pack({ items: [{ outline: rect(10, 90), orientationsDeg: [0] }], stripHeight: 50, spacing: 0, timeLimitMs: 1, seed: 0 })).toThrow(/taller than the strip/);
  });

  it("finds the minimum-area rotation for free rotation", () => {
    // A 60 x 10 bar tilted by 30 degrees has a large axis-aligned box.
    const tilted = transformPoints(rect(60, 10).map(([x, y]) => ({ x, y })), { rotationDeg: 30, x: 0, y: 0 });
    const angles = candidateOrientations(tilted, undefined);
    const best = Math.min(...angles.map((angle) => {
      const bounds = rotatedBounds(tilted, angle);
      return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    }));
    expect(best).toBeCloseTo(600, 3);
    expect(convexHull(tilted)).toHaveLength(5);
  });
});
