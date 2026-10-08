import { describe, expect, it } from "vitest";
import { CIRCLE_CROP_SEGMENTS, cropBoundary, cropElevationRange, cropRadiusMm } from "./crop.js";
import { sampleOffset } from "./grid.js";
import { signedArea } from "./geometry2d.js";
import { DEFAULT_PROJECT, type ElevationGrid, type ProjectConfigV1 } from "../types.js";

const rectangle: ProjectConfigV1 = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100, cropShape: "rectangle" };
const circle: ProjectConfigV1 = { ...rectangle, cropShape: "circle" };

/** A planar field, which bilinear sampling reproduces exactly anywhere on the grid. */
function planarGrid(size: number, config: ProjectConfigV1, elevationAt: (x: number, y: number) => number): ElevationGrid {
  const values = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      values[row * size + column] = elevationAt(sampleOffset(column, size, config.widthMm), sampleOffset(row, size, config.heightMm));
    }
  }
  return { width: size, height: size, values, min: Math.min(...values), max: Math.max(...values) };
}

describe("crop shapes", () => {
  it("inscribes the circle in the shorter side", () => {
    expect(cropRadiusMm({ widthMm: 300, heightMm: 200 })).toBe(100);
    expect(cropRadiusMm({ widthMm: 120, heightMm: 400 })).toBe(60);
  });

  it("outlines a rectangle as a closed ring on the crop edges", () => {
    const ring = cropBoundary({ ...rectangle, widthMm: 300, heightMm: 200 });
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(new Set(ring.map((point) => `${Math.abs(point.x)},${Math.abs(point.y)}`))).toEqual(new Set(["150,100"]));
    expect(Math.abs(signedArea(ring))).toBe(300 * 200);
  });

  it("closes a circle exactly, with every vertex on the inscribed radius", () => {
    const config = { ...circle, widthMm: 300, heightMm: 200 };
    const ring = cropBoundary(config);
    expect(ring).toHaveLength(CIRCLE_CROP_SEGMENTS + 1);
    expect(ring.at(-1)).toEqual(ring[0]);
    expect(ring.at(-1)).not.toBe(ring[0]);
    for (const point of ring) expect(Math.hypot(point.x, point.y)).toBeCloseTo(100, 9);
    // The polygon is inside the circle, so slightly smaller than πr².
    const area = Math.abs(signedArea(ring));
    expect(area).toBeLessThan(Math.PI * 100 * 100);
    expect(area).toBeGreaterThan(Math.PI * 100 * 100 * 0.99);
  });
});

describe("cropElevationRange", () => {
  const tilted = planarGrid(5, rectangle, (x, y) => x + y);
  const dry = new Uint8Array(25);

  it("reports a dry rectangle at the grid's declared range", () => {
    const grid = { ...tilted, min: -100.25, max: 100.25 };
    expect(cropElevationRange(rectangle, grid, dry)).toEqual({ landMin: -100.25, landMax: 100.25, min: -100, max: 100 });
  });

  it("leaves water out of the land range but not out of the visible range", () => {
    const water = new Uint8Array(25);
    water[24] = 1; // the (+50, +50) corner, the highest sample
    const range = cropElevationRange(rectangle, tilted, water);
    expect(range.max).toBe(100);
    expect(range.landMax).toBe(75);
    expect(range.landMin).toBe(-100);
  });

  it("falls back to the visible range when every sample is water", () => {
    const range = cropElevationRange(rectangle, tilted, new Uint8Array(25).fill(1));
    expect(range).toEqual({ landMin: -100, landMax: 100, min: -100, max: 100 });
  });

  it("ignores corners outside a circle and samples the crop edge between nodes", () => {
    const range = cropElevationRange(circle, tilted, dry);
    // x + y peaks on the circle at 45°, which is a crop vertex: 50·√2.
    expect(range.max).toBeCloseTo(50 * Math.SQRT2, 3);
    expect(range.min).toBeCloseTo(-50 * Math.SQRT2, 3);
    expect(range.landMax).toBeCloseTo(range.max, 9);
    expect(range.max).toBeLessThan(tilted.max);
  });

  it("finds the edge range on a grid too coarse to have interior nodes inside the circle", () => {
    const coarse = planarGrid(2, circle, (x) => 2 * x);
    const range = cropElevationRange(circle, coarse, new Uint8Array(4));
    expect(range.min).toBeCloseTo(-100, 6);
    expect(range.max).toBeCloseTo(100, 6);
    expect(Number.isFinite(range.landMin) && Number.isFinite(range.landMax)).toBe(true);
  });
});
