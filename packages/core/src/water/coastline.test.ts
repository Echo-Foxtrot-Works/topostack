import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, createSyntheticSource, generateGeometry, type ElevationGrid, type WaterAreaV1 } from "../index.js";
import { COASTLINE_MARGIN_M, fitTerrainToCoastline } from "./water.js";

// 11 x 11 cells over 100 mm: cell x = (column / 10 - 0.5) * 100, so column 0 sits at -50 mm.
const config = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100 };
const size = 11;
const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
// The sea fills the map's east side, from x = 5 mm (between columns 5 and 6).
const ocean: WaterAreaV1 = { id: "sea", kind: "ocean", polygon: { outer: rect(5, -60, 60, 60), holes: [] } };
const gridOf = (value: (column: number, row: number) => number): ElevationGrid => {
  const values = Float32Array.from({ length: size * size }, (_, index) => value(index % size, Math.floor(index / size)));
  return { width: size, height: size, values, min: Math.min(...values), max: Math.max(...values) };
};
const at = (grid: ElevationGrid, column: number, row: number) => grid.values[row * size + column]!;

describe("coastline fit", () => {
  it("sinks mapped sea the DEM has as land and raises reclaimed land connected to it", () => {
    // A coarse DEM: its shore lies two cells east of the vector one, and the
    // land next to the shore (columns 3-5) is a flat, dated 0 m.
    const dem = gridOf((column) => (column >= 8 ? -20 : column >= 6 ? 3 : column >= 3 ? 0 : 40));
    const { grid, loweredCells, raisedCells } = fitTerrainToCoastline(dem, config, [ocean]);
    expect(at(grid, 6, 4)).toBe(-COASTLINE_MARGIN_M);
    expect(at(grid, 7, 4)).toBe(-COASTLINE_MARGIN_M);
    expect(at(grid, 9, 4)).toBe(-20);
    expect(at(grid, 5, 4)).toBe(COASTLINE_MARGIN_M);
    expect(at(grid, 3, 4)).toBe(COASTLINE_MARGIN_M);
    expect(at(grid, 1, 4)).toBe(40);
    expect(loweredCells).toBe(2 * size);
    expect(raisedCells).toBe(3 * size);
    expect(grid.min).toBe(-20);
  });

  it("keeps a polder behind a dike and leaves lakes and inland grids alone", () => {
    // Column 5 is a dike; columns 2-4 a polder at -4 m behind it; a lake sits inside the polder.
    const dem = gridOf((column) => (column >= 6 ? -10 : column === 5 ? 6 : column >= 2 ? -4 : 10));
    const lake: WaterAreaV1 = { id: "lake", kind: "lake", polygon: { outer: rect(-32, -12, -18, 12), holes: [] } };
    const { grid, raisedCells } = fitTerrainToCoastline(dem, config, [ocean, lake]);
    expect(raisedCells).toBe(0);
    expect(at(grid, 3, 5)).toBe(-4);
    expect(at(grid, 5, 5)).toBe(6);
    const inland = gridOf(() => 0);
    expect(fitTerrainToCoastline(inland, config, [lake]).grid).toBe(inland);
  });

  it("cuts a layered model's coast on the vector shore", () => {
    const source = createSyntheticSource({ ...config, outputMode: "stack" });
    const width = 64, height = 64;
    // Land rises inland from a DEM shore at x = +15 mm; the vector sea starts at x = 0.
    const values = Float32Array.from({ length: width * height }, (_, index) => {
      const x = ((index % width) / (width - 1) - 0.5) * 100;
      return x > 15 ? -30 : 15 - x;
    });
    const elevation = { width, height, values, min: -30, max: 65 };
    const sea: WaterAreaV1 = { id: "sea", kind: "ocean", polygon: { outer: rect(0, -60, 60, 60), holes: [] } };
    const project = { ...config, outputMode: "stack" as const, showWaterDepth: true };
    const eastEdge = (waterAreas: WaterAreaV1[]) => {
      const result = generateGeometry(project, { ...source, elevation, waterAreas });
      // Sea level is a step whenever there is an ocean; that sheet's east edge is the coast.
      const seaLevel = result.layers.find((layer) => Math.abs(layer.elevationM) < 1e-6)!;
      return Math.max(...seaLevel.polygons.flatMap((polygon) => polygon.outer.map((point) => point.x)).filter((x) => x < 49.9));
    };
    // Unfitted, the sheet would end where the DEM crosses sea level, at +15 mm.
    // Fitted, it ends on the vector shore at 0 mm, within one cell (100 / 63 mm).
    expect(Math.abs(eastEdge([sea]))).toBeLessThan(100 / 63);
  });
});
