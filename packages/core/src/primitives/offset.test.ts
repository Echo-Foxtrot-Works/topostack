import { describe, expect, it } from "vitest";
import { clipPolygons, filledPolygons, nonZeroPolygons, offsetClosedRing, offsetPolygons, strokePolylines, windowPolygons } from "./offset.js";
import { pointInPolygon, ringBounds, signedArea } from "./geometry2d.js";
import type { Point2D, Polygon2D } from "../types.js";

function square(minX: number, minY: number, size: number, clockwise = false): Point2D[] {
  const ring = [{ x: minX, y: minY }, { x: minX + size, y: minY }, { x: minX + size, y: minY + size }, { x: minX, y: minY + size }];
  const ordered = clockwise ? [...ring].reverse() : ring;
  return [...ordered, { ...ordered[0]! }];
}

function area(polygons: Polygon2D[]): number {
  return polygons.reduce((total, polygon) => total + Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0), 0);
}

describe("offsetClosedRing", () => {
  it("returns nothing for a ring too short to enclose area", () => {
    expect(offsetClosedRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }], 1)).toEqual([]);
  });

  it("returns an independent copy for a zero offset", () => {
    const ring = square(0, 0, 10);
    const [result] = offsetClosedRing(ring, 0);
    expect(result).toEqual(ring);
    expect(result).not.toBe(ring);
  });

  it("grows and shrinks a square by the distance with miter joins", () => {
    const [grown] = offsetClosedRing(square(0, 0, 10), 1);
    expect(ringBounds(grown!)).toEqual({ minX: -1, minY: -1, maxX: 11, maxY: 11 });
    expect(Math.abs(signedArea(grown!))).toBeCloseTo(144, 6);
    const [shrunk] = offsetClosedRing(square(0, 0, 10), -1);
    expect(ringBounds(shrunk!)).toEqual({ minX: 1, minY: 1, maxX: 9, maxY: 9 });
    expect(Math.abs(signedArea(shrunk!))).toBeCloseTo(64, 6);
  });

  it("closes every ring and treats clockwise and open input the same", () => {
    const counter = offsetClosedRing(square(0, 0, 10), 0.5);
    const clockwise = offsetClosedRing(square(0, 0, 10, true), 0.5);
    const open = offsetClosedRing(square(0, 0, 10).slice(0, -1), 0.5);
    for (const rings of [counter, clockwise, open]) {
      expect(rings).toHaveLength(1);
      expect(rings[0]![0]).toEqual(rings[0]!.at(-1));
      expect(Math.sign(signedArea(rings[0]!))).toBe(Math.sign(signedArea(counter[0]!)));
      expect(Math.abs(signedArea(rings[0]!))).toBeCloseTo(121, 3);
    }
  });

  it("rounds corners with round joins, enclosing less than a miter", () => {
    const [round] = offsetClosedRing(square(0, 0, 10), 1, "round");
    const roundArea = Math.abs(signedArea(round!));
    expect(roundArea).toBeLessThan(144);
    expect(roundArea).toBeCloseTo(100 + 40 + Math.PI, 1);
  });

  it("vanishes when shrunk past half its width and lists split pieces largest first", () => {
    expect(offsetClosedRing(square(0, 0, 10), -5.5)).toEqual([]);
    // Two squares joined by a 1 mm neck fall apart when inset by more than half the neck.
    const dumbbell = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4.5 }, { x: 20, y: 4.5 }, { x: 20, y: 2 }, { x: 26, y: 2 },
      { x: 26, y: 8 }, { x: 20, y: 8 }, { x: 20, y: 5.5 }, { x: 10, y: 5.5 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 },
    ];
    const pieces = offsetClosedRing(dumbbell, -1);
    expect(pieces).toHaveLength(2);
    expect(Math.abs(signedArea(pieces[0]!))).toBeGreaterThan(Math.abs(signedArea(pieces[1]!)));
    expect(ringBounds(pieces[0]!).maxX).toBeLessThanOrEqual(10);
  });
});

describe("polygon booleans", () => {
  it("cuts a hole with difference and measures overlap with intersection", () => {
    const outer: Polygon2D = { outer: square(0, 0, 10), holes: [] };
    const [framed] = clipPolygons([outer], [{ outer: square(3, 3, 4), holes: [] }], "difference");
    expect(framed!.holes).toHaveLength(1);
    expect(area([framed!])).toBeCloseTo(84, 6);
    expect(pointInPolygon({ x: 5, y: 5 }, framed!)).toBe(false);
    expect(area(clipPolygons([outer], [{ outer: square(5, 5, 10), holes: [] }], "intersection"))).toBeCloseTo(25, 6);
  });

  it("merges squares that only share an edge into one polygon", () => {
    const merged = clipPolygons([{ outer: square(0, 0, 10), holes: [] }], [{ outer: square(10, 0, 10, true), holes: [] }], "union");
    expect(merged).toHaveLength(1);
    expect(area(merged)).toBeCloseTo(200, 6);
  });

  it("reads nested rings by winding under non-zero and by parity under even-odd", () => {
    const sameWinding = [square(0, 0, 10), square(3, 3, 4)];
    expect(area(filledPolygons(sameWinding, "nonzero"))).toBeCloseTo(100, 6);
    expect(area(filledPolygons(sameWinding, "evenodd"))).toBeCloseTo(84, 6);
    const counterWound = nonZeroPolygons([square(0, 0, 10), square(3, 3, 4, true)]);
    expect(counterWound).toHaveLength(1);
    expect(counterWound[0]!.holes).toHaveLength(1);
    expect(filledPolygons([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], "nonzero")).toEqual([]);
  });
});

describe("strokePolylines", () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

  it("paints width times length with butt caps and extends square caps by half the width", () => {
    expect(strokePolylines([{ points: line, closed: false }], 0)).toEqual([]);
    expect(area(strokePolylines([{ points: line, closed: false }], 2))).toBeCloseTo(20, 3);
    expect(area(strokePolylines([{ points: line, closed: false }], 2, "square"))).toBeCloseTo(24, 3);
  });

  it("paints a dot for a lone point only when the cap has extent", () => {
    const dot = [{ points: [{ x: 5, y: 5 }], closed: false }];
    expect(strokePolylines(dot, 2, "butt")).toEqual([]);
    // Round join too: Clipper shapes a single-point path by its join, not its end type.
    expect(area(strokePolylines(dot, 2, "round", "round"))).toBeCloseTo(Math.PI, 1);
  });

  it("strokes a closed ring into a band with a hole", () => {
    const [band] = strokePolylines([{ points: square(0, 0, 10), closed: true }], 2);
    expect(band!.holes).toHaveLength(1);
    expect(area([band!])).toBeCloseTo(144 - 64, 3);
  });
});

describe("offsetPolygons", () => {
  it("shrinks holes as the outer grows and keeps an island inside a hole", () => {
    const frame: Polygon2D = { outer: square(0, 0, 30), holes: [square(5, 5, 20, true)] };
    const island: Polygon2D = { outer: square(12, 12, 6), holes: [] };
    const grown = offsetPolygons([frame, island], 1);
    expect(grown).toHaveLength(2);
    const outer = grown.find((polygon) => polygon.holes.length === 1)!;
    expect(ringBounds(outer.outer)).toEqual({ minX: -1, minY: -1, maxX: 31, maxY: 31 });
    expect(ringBounds(outer.holes[0]!)).toEqual({ minX: 6, minY: 6, maxX: 24, maxY: 24 });
    expect(ringBounds(grown.find((polygon) => polygon !== outer)!.outer)).toEqual({ minX: 11, minY: 11, maxX: 19, maxY: 19 });
    expect(offsetPolygons([], 1)).toEqual([]);
  });
});

describe("windowPolygons", () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number): Point2D[] => [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
  // A comb: a bar along the bottom with teeth rising out of the window and back, and a hole in the bar.
  const comb: Polygon2D = {
    outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 50 }, { x: 30, y: 50 }, { x: 30, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
    holes: [box(45, 2, 55, 8).reverse()],
  };
  const window = { minX: 20, minY: -5, maxX: 80, maxY: 30 };
  const rectangle = [{ outer: box(window.minX, window.minY, window.maxX, window.maxY), holes: [] }];

  it("gives a boolean the same region as the whole polygon would", () => {
    const probe = [{ outer: box(25, 5, 75, 25), holes: [] }];
    const whole = clipPolygons(probe, [comb], "intersection");
    const windowed = clipPolygons(probe, windowPolygons([comb], window), "intersection");
    expect(area(windowed)).toBeCloseTo(area(whole), 6);
    expect(area(clipPolygons(windowPolygons([comb], window), rectangle, "intersection"))).toBeCloseTo(area(clipPolygons([comb], rectangle, "intersection")), 6);
  });

  it("drops what lies outside and keeps what lies inside untouched", () => {
    const inside: Polygon2D = { outer: box(30, 0, 40, 5), holes: [] };
    const outside: Polygon2D = { outer: box(200, 200, 210, 210), holes: [] };
    expect(windowPolygons([inside, outside], window)).toEqual([inside]);
  });
});
