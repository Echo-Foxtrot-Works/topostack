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
    expect(cropElevationRange(rectangle, grid, dry)).toMatchObject({ landMin: -100.25, landMax: 100.25, waterMin: Infinity, min: -100, max: 100 });
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
    expect(range).toMatchObject({ landMin: -100, landMax: 100, waterMin: -100, min: -100, max: 100, cuttableMin: -100, cuttableWaterMin: -100 });
  });

  it("ignores corners outside a circle and samples the crop edge between nodes", () => {
    const range = cropElevationRange(circle, tilted, dry);
    // x + y peaks on the circle at 45°, which is a crop vertex: 50·√2.
    expect(range.max).toBeCloseTo(50 * Math.SQRT2, 3);
    expect(range.min).toBeCloseTo(-50 * Math.SQRT2, 3);
    expect(range.landMax).toBeCloseTo(range.max, 9);
    expect(range.max).toBeLessThan(tilted.max);
  });

  describe("extremes too small to cut", () => {
    // 0.5 mm cells and a 0.8 mm minimum feature: a cuttable patch is 11 cells.
    const fine: ProjectConfigV1 = { ...rectangle, minimumFeatureMm: 0.8 };
    const size = 201;
    const rolling = (x: number, y: number) => 20 + 0.3 * x + 0.1 * y;
    const withCells = (cells: Array<[number, number]>, water = false) => {
      const grid = planarGrid(size, fine, rolling);
      const mask = new Uint8Array(size * size);
      for (const [index, value] of cells) { grid.values[index] = value; if (water) mask[index] = 1; }
      return cropElevationRange(fine, { ...grid, min: Math.min(...grid.values), max: Math.max(...grid.values) }, mask);
    };
    const centre = 100 * size + 100;
    const smooth = withCells([]);

    it("keeps a spike of a few cells out of the land range", () => {
      const range = withCells([[centre, 400], [centre + 1, 380], [centre + size, -300]]);
      expect(range.landMax).toBeCloseTo(smooth.landMax, 0);
      expect(range.landMin).toBeCloseTo(smooth.landMin, 0);
      // What was measured is still reported.
      expect(range.max).toBe(400);
    });

    it("keeps a summit wide enough to cut", () => {
      const cells: Array<[number, number]> = [];
      for (let row = 98; row < 103; row += 1) for (let column = 98; column < 103; column += 1) cells.push([row * size + column, 400]);
      expect(withCells(cells).landMax).toBe(400);
    });

    it("keeps an exact summit that adds little to the range", () => {
      const range = withCells([[centre, smooth.landMax + 5]]);
      expect(range.landMax).toBe(smooth.landMax + 5);
    });

    it("reports the deepest water a cut can show beside the deepest measured", () => {
      const range = withCells([[centre, -500], [centre + 1, -500]], true);
      expect(range.waterMin).toBe(-500);
      expect(range.cuttableWaterMin).toBe(Infinity);
      expect(range.min).toBeGreaterThan(-500);
      expect(range.cuttableMin).toBeGreaterThan(-500);
      const pond: Array<[number, number]> = [];
      for (let row = 96; row < 105; row += 1) for (let column = 96; column < 105; column += 1) pond.push([row * size + column, -500]);
      const wide = withCells(pond, true);
      expect(wide.waterMin).toBe(-500);
      expect(wide.cuttableWaterMin).toBe(-500);
      expect(wide.cuttableMin).toBe(-500);
    });
  });

  it("finds the edge range on a grid too coarse to have interior nodes inside the circle", () => {
    const coarse = planarGrid(2, circle, (x) => 2 * x);
    const range = cropElevationRange(circle, coarse, new Uint8Array(4));
    expect(range.min).toBeCloseTo(-100, 6);
    expect(range.max).toBeCloseTo(100, 6);
    expect(Number.isFinite(range.landMin) && Number.isFinite(range.landMax)).toBe(true);
  });
});

it("excludes water only in the discarded corners from the depth budget", () => {
  const grid = planarGrid(5, circle, (x, y) => x + y);
  const mask = new Uint8Array(grid.values.length);
  mask[0] = 1;
  expect(cropElevationRange(circle, grid, mask).waterMin).toBe(Infinity);
});
