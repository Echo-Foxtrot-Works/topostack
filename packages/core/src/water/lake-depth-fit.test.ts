import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type WaterSurfaceIR } from "../types.js";
import { fitLakesToLadder, type CarvedWater } from "./water.js";

const config = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100, fitLakeDepth: true, waterDepthExaggeration: 2 };
const ring = (lo: number, hi: number) => [{ x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }, { x: lo, y: lo }];
const surface: WaterSurfaceIR = {
  id: "deep", kind: "lake", polygons: [{ outer: ring(-40, 40), holes: [ring(-10, 10)] }],
  surfaceElevationM: 180, bedElevationM: -420, layerIndex: 0, depthSource: "surveyed",
};
function fixture(): CarvedWater {
  const values = new Float32Array(25).fill(180);
  values[6] = 220; // bank
  values[11] = -420;
  values[13] = -120;
  values[17] = 60;
  return { grid: { width: 5, height: 5, values, min: -420, max: 220 }, surfaces: [surface], warnings: [], waterMask: new Uint8Array(25) };
}

describe("lake depth fitting", () => {
  it("keeps surveyed depth ratios, waterlines, islands, and banks while fitting to the floor", () => {
    const original = fixture();
    const result = fitLakesToLadder(original, config, 0);
    expect(result.grid.values[11]).toBe(0);
    expect(result.grid.values[13]).toBe(90);
    expect(result.grid.values[17]).toBe(144);
    expect(result.grid.values[0]).toBe(180);
    expect(result.grid.values[12]).toBe(180);
    expect(result.grid.values[6]).toBe(220);
    expect(result.surfaces[0]).toMatchObject({ surfaceElevationM: 180, bedElevationM: 0, unfittedBedElevationM: -420, depthFitScale: 0.3, appliedDepthExaggeration: 0.6 });
    expect(original.grid.values[11]).toBe(-420);
    expect(original.surfaces[0]?.depthFitScale).toBeUndefined();
  });

  it("leaves shallow lakes, oceans, and lakes with no usable depth unchanged", () => {
    for (const [kind, floor] of [["lake", -500], ["lake", -420], ["ocean", 0], ["lake", 180], ["lake", 200]] as const) {
      const original = fixture();
      original.surfaces = [{ ...surface, kind }];
      const result = fitLakesToLadder(original, config, floor);
      expect(result.grid.values).toEqual(original.grid.values);
      expect(result.surfaces).toEqual(original.surfaces);
    }
  });

  it("fits neighboring lakes independently at different waterline elevations", () => {
    const original = fixture();
    const rectangle = (left: number, right: number) => [{ x: left, y: -40 }, { x: right, y: -40 }, { x: right, y: 40 }, { x: left, y: 40 }, { x: left, y: -40 }];
    original.surfaces = [
      { ...surface, polygons: [{ outer: rectangle(-40, -10), holes: [] }] },
      { ...surface, id: "higher", surfaceElevationM: 300, bedElevationM: -120, polygons: [{ outer: rectangle(10, 40), holes: [] }] },
    ];
    const result = fitLakesToLadder(original, config, 0);
    expect(result.grid.values[11]).toBe(0);
    expect(result.grid.values[13]).toBe(0);
    expect(result.surfaces[0]?.depthFitScale).toBeCloseTo(180 / 600);
    expect(result.surfaces[1]?.depthFitScale).toBeCloseTo(300 / 420);
    expect(result.grid.values[17]).toBe(60); // outside both lakes
  });

  it("fits every part of a lake split into several outlines with one scale", () => {
    const original = fixture();
    const rectangle = (left: number, right: number) => [{ x: left, y: -40 }, { x: right, y: -40 }, { x: right, y: 40 }, { x: left, y: 40 }, { x: left, y: -40 }];
    original.surfaces = [{ ...surface, polygons: [{ outer: rectangle(-40, -10), holes: [] }, { outer: rectangle(10, 40), holes: [] }] }];
    const result = fitLakesToLadder(original, config, 0);
    expect(result.grid.values[11]).toBe(0);
    expect(result.grid.values[13]).toBe(90);
    expect(result.grid.values[17]).toBe(60); // between the parts
    expect(result.surfaces[0]?.depthFitScale).toBeCloseTo(0.3);
  });

  it("keeps a fractional floor representable without reporting false clipping", () => {
    for (const floor of [1 / 3, -1 / 3, 1882.6 / 7]) {
      const original = fixture();
      if (floor >= 180) continue;
      const result = fitLakesToLadder(original, config, floor);
      expect(result.grid.min).toBeGreaterThanOrEqual(floor);
      expect(result.grid.min).toBeCloseTo(floor, 4);
    }
  });
});
