import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type ElevationGrid, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1, type WaterSurfaceIR } from "../index.js";
import { cropBoundary } from "../primitives/crop.js";
import { pointInPolygon } from "../primitives/geometry2d.js";
import { createSyntheticSource } from "./synthetic-source.js";
import type { ElevationLadder, GenerationContext } from "./generation-context.js";
import { flatWaterAreas, waterOutputs } from "./water-outputs.js";

// DEFAULT_PROJECT is 300 x 200 mm, so the crop spans x -150..150, y -100..100.
function square(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
}

function polygon(outer: Point2D[], holes: Point2D[][] = []): Polygon2D {
  return { outer, holes };
}

function context(config: Partial<ProjectConfigV1> = {}, source: Partial<SourceBundleV1> = {}, flags: Partial<Pick<GenerationContext, "flatEngraving" | "usesWaterDepth">> = {}): GenerationContext {
  const project = { ...DEFAULT_PROJECT, ...config };
  return {
    config: project,
    source: { ...createSyntheticSource(project, 2), ...source },
    flatEngraving: false,
    usesWaterDepth: false,
    clip: cropBoundary(project),
    warnings: [],
    aviation: { lines: [], labels: [], altitudes: [], symbols: [] },
    ...flags,
  };
}

/** Left half of the artwork at 100 m, right half at 300 m. */
function splitGrid(): ElevationGrid {
  const width = 31;
  const height = 21;
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) values[y * width + x] = x < width / 2 ? 100 : 300;
  return { width, height, values, min: 100, max: 300 };
}

function ladder(surfaces: WaterSurfaceIR[] = [], thresholds = [0, 200, 400]): ElevationLadder {
  const grid = splitGrid();
  return {
    landMin: 0, landMax: 500, visibleMin: 0, visibleMax: 500, depthBelowLandM: 0,
    stack: {} as ElevationLadder["stack"],
    ladderBase: 0,
    thresholds,
    water: { grid, surfaces, warnings: [], waterMask: new Uint8Array(grid.width * grid.height) },
    modelGrid: grid,
  };
}

function surface(overrides: Partial<WaterSurfaceIR> = {}): WaterSurfaceIR {
  return { id: "lake-1", kind: "lake", polygons: [polygon(square(-20, -20, 20, 20))], surfaceElevationM: 250, bedElevationM: 150, layerIndex: -1, depthSource: "modeled", ...overrides };
}

function lake(overrides: Partial<WaterAreaV1> = {}): WaterAreaV1 {
  return { id: "lake-1", kind: "lake", polygon: polygon(square(40, -20, 80, 20)), ...overrides };
}

function shore(id: string, points: Point2D[], kind: MarkingFeature["kind"] = "water"): MarkingFeature {
  return { id, kind, operation: "score", points };
}

function bounds(polygons: Polygon2D[]): { minX: number; maxX: number } {
  const xs = polygons.flatMap((entry) => entry.outer.map((point) => point.x));
  return { minX: Math.min(...xs), maxX: Math.max(...xs) };
}

describe("waterOutputs", () => {
  it("clips surfaces to the crop, drops those outside it, and seats each on the layer holding its level", () => {
    const run = context();
    const { waterSurfaces } = waterOutputs(run, ladder([
      surface({ id: "inside", surfaceElevationM: 250 }),
      surface({ id: "straddling", polygons: [polygon(square(120, -10, 200, 10))], surfaceElevationM: 450 }),
      surface({ id: "outside", polygons: [polygon(square(200, -10, 260, 10))] }),
    ]));
    expect(waterSurfaces.map((entry) => [entry.id, entry.layerIndex])).toEqual([["inside", 1], ["straddling", 2]]);
    expect(bounds(waterSurfaces[1]!.polygons)).toEqual({ minX: 120, maxX: 150 });
  });

  it("warns that lake depths are predicted unless every carved lake was surveyed or charted", () => {
    const codes = (surfaces: WaterSurfaceIR[]): string[] => {
      const run = context();
      waterOutputs(run, ladder(surfaces));
      return run.warnings.map((warning) => warning.code);
    };
    expect(codes([surface({ depthSource: "surveyed" })])).toEqual([]);
    expect(codes([surface({ kind: "ocean", depthSource: "modeled" })])).toEqual([]);
    expect(codes([surface({ depthSource: "surveyed" }), surface({ id: "lake-2", depthSource: "mixed" })])).toEqual(["LAKE_DEPTH_PREDICTED"]);
    expect(codes([surface({ depthSource: "modeled", bathymetryOrigin: "chart" })])).toEqual(["LAKE_DEPTH_FROM_CHART"]);
    expect(codes([surface({ depthSource: "user" }), surface({ id: "lake-2", bathymetryOrigin: "chart" })])).toEqual(["LAKE_DEPTH_PREDICTED", "LAKE_DEPTH_FROM_CHART"]);
  });

  it("ignores a lake clipped out of the crop when reporting depth provenance", () => {
    const run = context();
    waterOutputs(run, ladder([surface({ polygons: [polygon(square(200, -10, 260, 10))] })]));
    expect(run.warnings).toEqual([]);
  });

  it("fills water patterns only on flat engravings with water shown and a pattern chosen", () => {
    const source = { waterPatternAreas: [polygon(square(-20, -20, 20, 20))] };
    const areas = (config: Partial<ProjectConfigV1>, flatEngraving: boolean) => waterOutputs(context(config, source, { flatEngraving }), ladder()).waterPatternAreas;
    expect(areas({ waterFillPattern: "lines" }, true)).toHaveLength(1);
    expect(areas({ waterFillPattern: "lines" }, false)).toEqual([]);
    expect(areas({ waterFillPattern: "lines", showWater: false }, true)).toEqual([]);
    expect(areas({ waterFillPattern: "none" }, true)).toEqual([]);
  });

  it("prefers retained pattern polygons, then water areas, then rebuilt shorelines", () => {
    const pattern = polygon(square(-60, -10, -40, 10));
    const area = lake({ polygon: polygon(square(-10, -10, 10, 10)) });
    const shoreline = shore("water-area-0-shore-0", square(40, -10, 60, 10));
    const areas = (source: Partial<SourceBundleV1>) => bounds(waterOutputs(context({ waterFillPattern: "ripples" }, source, { flatEngraving: true }), ladder()).waterPatternAreas);
    expect(areas({ waterPatternAreas: [pattern], waterAreas: [area], markings: [shoreline] })).toEqual({ minX: -60, maxX: -40 });
    expect(areas({ waterAreas: [area], markings: [shoreline] })).toEqual({ minX: -10, maxX: 10 });
    expect(areas({ markings: [shoreline] })).toEqual({ minX: 40, maxX: 60 });
  });

  it("clips pattern areas to the crop", () => {
    const run = context({ waterFillPattern: "dots" }, { waterPatternAreas: [polygon(square(100, -10, 400, 10)), polygon(square(300, -10, 400, 10))] }, { flatEngraving: true });
    const { waterPatternAreas } = waterOutputs(run, ladder());
    expect(waterPatternAreas).toHaveLength(1);
    expect(bounds(waterPatternAreas)).toEqual({ minX: 100, maxX: 150 });
  });

  it("rebuilds each area from its numbered shoreline rings, with the later rings as holes", () => {
    const markings = [
      shore("layer-2-water-area-7-shore-2", square(50, -5, 60, 5)),
      shore("layer-2-water-area-7-shore-0", square(-80, -40, 80, 40)),
      shore("layer-2-water-area-7-shore-1", square(-60, -5, -50, 5)),
      shore("water-area-9-shore-0", square(100, 50, 120, 70)),
    ];
    const { waterPatternAreas } = waterOutputs(context({ waterFillPattern: "lines" }, { markings }, { flatEngraving: true }), ladder());
    expect(waterPatternAreas).toHaveLength(2);
    const holed = waterPatternAreas.find((entry) => entry.holes.length)!;
    expect(holed.holes).toHaveLength(2);
    expect(pointInPolygon({ x: 0, y: 0 }, holed)).toBe(true);
    expect(pointInPolygon({ x: 55, y: 0 }, holed)).toBe(false);
    expect(pointInPolygon({ x: -55, y: 0 }, holed)).toBe(false);
  });

  it("skips shorelines that are not water, are too short to close, or have no outer ring", () => {
    const markings = [
      shore("water-area-0-shore-0", square(-10, -10, 10, 10), "road"),
      shore("water-area-1-shore-0", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }]),
      shore("water-area-2-shore-1", square(-10, -10, 10, 10)),
      shore("water-area-3-outline", square(-10, -10, 10, 10)),
    ];
    expect(waterOutputs(context({ waterFillPattern: "lines" }, { markings }, { flatEngraving: true }), ladder()).waterPatternAreas).toEqual([]);
  });
});

describe("flatWaterAreas", () => {
  const paint: Partial<ProjectConfigV1> = { paintTemplates: ["water"] };

  it("is empty when depth is carved or no water stencil is requested", () => {
    const source = { waterAreas: [lake({ surfaceElevationM: 250 })] };
    expect(flatWaterAreas(context(paint, source, { usesWaterDepth: true }), splitGrid(), ladder())).toEqual([]);
    expect(flatWaterAreas(context({ paintTemplates: [] }, source), splitGrid(), ladder())).toEqual([]);
    expect(flatWaterAreas(context(paint, source), splitGrid(), ladder())).toHaveLength(1);
  });

  it("places each lake on the layer holding its recorded level, or its DEM median when none is recorded", () => {
    const source = {
      waterAreas: [
        lake({ id: "recorded", surfaceElevationM: 450 }),
        lake({ id: "east", polygon: polygon(square(40, -20, 80, 20)) }),
        lake({ id: "west", polygon: polygon(square(-80, -20, -40, 20)) }),
        lake({ id: "sea", kind: "ocean", polygon: polygon(square(40, -20, 80, 20)) }),
      ],
    };
    expect(flatWaterAreas(context(paint, source), splitGrid(), ladder([], [-50, 50, 200, 400])).map((area) => area.layerIndex)).toEqual([3, 2, 1, 0]);
  });

  it("drops lakes with no level to read or nothing left inside the crop", () => {
    const source = {
      waterAreas: [
        lake({ id: "off-grid", polygon: polygon(square(400, 300, 420, 320)) }),
        lake({ id: "off-crop", surfaceElevationM: 250, polygon: polygon(square(400, 300, 420, 320)) }),
        lake({ id: "kept", surfaceElevationM: 250, polygon: polygon(square(120, -10, 200, 10)) }),
      ],
    };
    const areas = flatWaterAreas(context(paint, source), splitGrid(), ladder());
    expect(areas).toHaveLength(1);
    expect(bounds(areas[0]!.polygons)).toEqual({ minX: 120, maxX: 150 });
  });
});
