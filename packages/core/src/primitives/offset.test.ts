import { describe, expect, it } from "vitest";
import type { Point2D, Polygon2D } from "../types.js";
import { signedArea } from "./geometry2d.js";
import { clipPolygons, windowPolygons } from "./offset.js";

const square = (minX: number, minY: number, maxX: number, maxY: number): Point2D[] => [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
const area = (polygons: Polygon2D[]) => polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((holes, hole) => holes + Math.abs(signedArea(hole)), 0), 0);

describe("windowPolygons", () => {
  // A comb: a bar along the bottom with teeth rising out of the window and back, and a hole in the bar.
  const comb: Polygon2D = {
    outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 50 }, { x: 30, y: 50 }, { x: 30, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
    holes: [square(45, 2, 55, 8).reverse()],
  };
  const window = { minX: 20, minY: -5, maxX: 80, maxY: 30 };
  const rectangle = [{ outer: square(window.minX, window.minY, window.maxX, window.maxY), holes: [] }];

  it("gives a boolean the same region as the whole polygon would", () => {
    const probe = [{ outer: square(25, 5, 75, 25), holes: [] }];
    const whole = clipPolygons(probe, [comb], "intersection");
    const windowed = clipPolygons(probe, windowPolygons([comb], window), "intersection");
    expect(area(windowed)).toBeCloseTo(area(whole), 6);
    expect(area(clipPolygons(windowPolygons([comb], window), rectangle, "intersection"))).toBeCloseTo(area(clipPolygons([comb], rectangle, "intersection")), 6);
  });

  it("drops what lies outside and keeps what lies inside untouched", () => {
    const inside: Polygon2D = { outer: square(30, 0, 40, 5), holes: [] };
    const outside: Polygon2D = { outer: square(200, 200, 210, 210), holes: [] };
    expect(windowPolygons([inside, outside], window)).toEqual([inside]);
  });
});
