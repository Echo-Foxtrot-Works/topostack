import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, createSyntheticSource, type WaterAreaV1 } from "../index.js";
import { carveWaterDepth } from "./water.js";

const config = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100, waterDepthExaggeration: 1 };
const grid = { width: 5, height: 5, values: new Float32Array(25).fill(180), min: 180, max: 180 };
const ring = (lo: number, hi: number) => [{ x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }, { x: lo, y: lo }];
const lake = (depths = new Float32Array(25).fill(20)): WaterAreaV1 => ({
  id: "erie", kind: "lake", name: "Lake Erie", hylakId: 1,
  polygon: { outer: ring(-40, 40), holes: [] }, maxDepthM: 100,
  bathymetry: { width: 5, height: 5, depthsM: depths },
});

describe("NOAA lake-floor carving", () => {
  it("preserves an asymmetric measured basin and applies exaggeration once", () => {
    const area = lake();
    area.bathymetry!.depthsM[11] = 5;
    area.bathymetry!.depthsM[13] = 60;
    for (const multiplier of [1, 2]) {
      const result = carveWaterDepth(grid, { ...config, waterDepthExaggeration: multiplier }, [area], 5000);
      expect(result.grid.values[11]).toBe(180 - 5 * multiplier);
      expect(result.grid.values[13]).toBe(180 - 60 * multiplier);
      expect(result.grid.values[0]).toBe(180);
      expect(result.surfaces[0]).toMatchObject({ depthSource: "surveyed", surfaceElevationM: 180 });
      expect(result.warnings).toEqual([]);
    }
    expect(grid.values[13]).toBe(180);
  });

  it.each([{ multiplier: 1, bed: 60 }, { multiplier: 2, bed: 20 }])("scales DEM lake beds about the known waterline at $multiplier×", ({ multiplier, bed }) => {
    const terrain = { ...grid, values: Float32Array.from({ length: 25 }, (_, i) => 40 + i % 5 * 20), min: 40, max: 120 };
    const area = { ...lake(), bathymetry: undefined, surfaceElevationM: 100 };
    const result = carveWaterDepth(terrain, { ...config, waterDepthExaggeration: multiplier }, [area], 5000);
    expect(result.surfaces[0]).toMatchObject({ surfaceElevationM: 100, bedElevationM: bed });
    expect(result.grid.values[11]).toBe(bed);
    expect(result.grid.values[13]).toBe(100);
  });

  it("carves surveyed fallback outlines without modeled-depth metadata", () => {
    const area = { ...lake(), outlineSource: "provider" as const, hylakId: undefined, maxDepthM: undefined };
    const result = carveWaterDepth(grid, config, [area], 5000);
    expect(result.grid.values[12]).toBe(160);
    expect(result.surfaces[0]?.depthSource).toBe("surveyed");
  });

  it("does not infer a surveyed basin from relief inside an unknown-depth OSM outline", () => {
    const area = { ...lake(), outlineSource: "osm" as const, bathymetry: undefined, maxDepthM: undefined };
    const terrain = { ...grid, values: Float32Array.from(grid.values, (_, i) => 100 + i * 4) };
    const result = carveWaterDepth(terrain, { ...config, waterDepthExaggeration: 2 }, [area], 5000);
    expect(result.grid.values).toEqual(terrain.values);
    expect(result.surfaces).toEqual([]);
  });

  it("carves clipped lake interiors without needing a visible shoreline", () => {
    const area = lake();
    area.polygon.outer = ring(-100, 100);
    area.clipped = true;
    const result = carveWaterDepth(grid, config, [area], 5000);
    expect(result.grid.min).toBe(160);
    expect(result.grid.max).toBe(160);
    expect(result.warnings).toEqual([]);
  });

  it("keeps islands and elevated banks intact", () => {
    const area = lake();
    area.polygon.holes = [ring(-10, 10)];
    const terrain = { ...grid, values: Float32Array.from(grid.values), max: 220 };
    terrain.values[6] = 220;
    const result = carveWaterDepth(terrain, config, [area], 5000);
    expect(result.grid.values[12]).toBe(180);
    expect(result.grid.values[6]).toBe(220);
    expect(result.grid.values[13]).toBe(160);
  });

  it("uses modeled depths only at missing samples and reports mixed coverage", () => {
    const area = lake();
    area.bathymetry!.depthsM[12] = Number.NaN;
    const result = carveWaterDepth(grid, config, [area], 5000);
    expect(result.grid.values[13]).toBe(160);
    expect(result.grid.values[12]).toBeLessThan(180);
    expect(result.surfaces[0]?.depthSource).toBe("mixed");
    expect(result.warnings[0]?.code).toBe("BATHYMETRY_FALLBACK");
  });

  it("falls back to the existing basin model when there are no survey samples", () => {
    const area = lake(new Float32Array(25).fill(Number.NaN));
    const result = carveWaterDepth(grid, config, [area], 5000);
    expect(result.surfaces[0]?.depthSource).toBe("modeled");
    expect(result.grid.min).toBeLessThan(180);
  });

  it("carves a traced depth chart exactly like a survey but reports it as the maker's own depth", () => {
    const area: WaterAreaV1 = { ...lake(), bathymetryOrigin: "chart" };
    area.bathymetry!.depthsM[13] = 35;
    const result = carveWaterDepth(grid, config, [area], 5000);
    const survey = carveWaterDepth(grid, config, [lake()], 5000);
    expect(result.grid.values[12]).toBe(survey.grid.values[12]);
    expect(result.grid.values[13]).toBe(145);
    expect(result.surfaces[0]).toMatchObject({ depthSource: "user", bathymetryOrigin: "chart" });
    expect(survey.surfaces[0]).not.toHaveProperty("bathymetryOrigin");
    expect(result.warnings).toEqual([]);
  });

  it("names the depth chart when its coverage has gaps or does not fit the grid", () => {
    const gappy: WaterAreaV1 = { ...lake(), bathymetryOrigin: "chart" };
    gappy.bathymetry!.depthsM[12] = Number.NaN;
    const gaps = carveWaterDepth(grid, config, [gappy], 5000);
    expect(gaps.surfaces[0]).toMatchObject({ depthSource: "user", bathymetryOrigin: "chart", maxDepthM: 100 });
    expect(gaps.warnings[0]?.message).toContain("incomplete depth chart coverage");
    const misaligned: WaterAreaV1 = { ...lake(), bathymetryOrigin: "chart" };
    misaligned.bathymetry!.width = 6;
    expect(carveWaterDepth(grid, config, [misaligned], 5000).warnings[0]?.message).toContain("has depth chart data that does not match");
  });

  it("models a lake whose survey grid is misaligned instead of failing the map", () => {
    const area = lake();
    area.bathymetry!.width = 6;
    const other = { ...lake(), id: "other", polygon: { outer: ring(-45, -42), holes: [] }, bathymetry: undefined };
    const result = carveWaterDepth(grid, config, [area, other], 5000);
    expect(result.surfaces[0]).toMatchObject({ id: "erie", depthSource: "modeled", surfaceElevationM: 180 });
    expect(result.grid.min).toBeLessThan(180);
    expect(result.warnings.filter((warning) => warning.code === "BATHYMETRY_FALLBACK")).toHaveLength(1);
    const source = { ...createSyntheticSource(config, 5), sourceKind: "real" as const, elevation: grid, waterAreas: [area] };
    expect(generateGeometry(config, source).warnings.some((warning) => warning.code === "BATHYMETRY_FALLBACK")).toBe(true);
  });

  it("rejects invalid depths", () => {
    const area = lake();
    area.bathymetry!.depthsM[12] = -100;
    expect(() => carveWaterDepth(grid, config, [area], 5000)).toThrow(/invalid depth/);
  });

  it("reads each waterline from the original terrain when water areas overlap", () => {
    const flat = { width: 9, height: 9, values: new Float32Array(81).fill(180), min: 180, max: 180 };
    const first: WaterAreaV1 = { id: "first", kind: "lake", maxDepthM: 60, polygon: { outer: ring(-45, 20), holes: [] } };
    const second: WaterAreaV1 = { id: "second", kind: "lake", maxDepthM: 30, polygon: { outer: ring(-20, 45), holes: [] } };
    const result = carveWaterDepth(flat, config, [first, second], 5000);
    expect(result.surfaces.map((surface) => [surface.id, surface.surfaceElevationM, surface.depthSource])).toEqual([["first", 180, "modeled"], ["second", 180, "modeled"]]);
    expect(result.surfaces[1]!.bedElevationM).toBeLessThan(180);
  });

  it("does not carve disabled depth and carries archive failure into export warnings", () => {
    const source = { ...createSyntheticSource(config, 5), elevation: grid, waterAreas: [lake()], bathymetryStatus: "unavailable" as const };
    const result = generateGeometry(config, source);
    expect(result.warnings.some((warning) => warning.code === "BATHYMETRY_FALLBACK")).toBe(true);
    const disabled = generateGeometry({ ...config, showWaterDepth: false }, source);
    expect(disabled.waterSurfaces).toEqual([]);
    expect(disabled.warnings.some((warning) => warning.code === "BATHYMETRY_FALLBACK")).toBe(false);
  });

  it("uses the lake waterline when the base DEM already contains a basin", () => {
    const area = lake();
    area.surfaceElevationM = 180;
    const terrain = { ...grid, values: Float32Array.from(grid.values), min: 100 };
    terrain.values[11] = 100;
    terrain.values[12] = 120;
    terrain.values[13] = 140;
    const result = carveWaterDepth(terrain, config, [area], 5000);
    expect(result.surfaces[0]?.surfaceElevationM).toBe(180);
    expect(result.grid.values[11]).toBe(160);
  });
});


describe("predicted lake-depth warning", () => {
  const warningsFor = (areas: WaterAreaV1[], project = config) => generateGeometry(project,
    { ...createSyntheticSource(project, 5), elevation: grid, waterAreas: areas }).warnings
    .filter((warning) => warning.code === "LAKE_DEPTH_PREDICTED");

  it("warns once for modeled lakes, including user maximum-depth overrides", () => {
    const modeled = lake();
    delete modeled.bathymetry;
    const warnings = warningsFor([modeled]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("estimated rather than surveyed");
    expect(warningsFor([modeled], { ...config, waterDepthOverrides: { "1": 50 } })).toHaveLength(1);
    expect(warningsFor([modeled, { ...modeled, id: "second-lake" }])).toHaveLength(1);
  });

  it("warns for gaps in survey coverage", () => {
    const area = lake();
    area.bathymetry!.depthsM[12] = Number.NaN;
    expect(warningsFor([area])).toHaveLength(1);
  });

  it("does not warn for fully surveyed lakes, oceans, or absent lakes", () => {
    expect(warningsFor([lake()])).toEqual([]);
    expect(warningsFor([{ ...lake(), kind: "ocean" }])).toEqual([]);
    expect(warningsFor([])).toEqual([]);
  });

  it("reports a traced chart separately from predicted depths", () => {
    const chart: WaterAreaV1 = { ...lake(), bathymetryOrigin: "chart" };
    const all = (areas: WaterAreaV1[]) => generateGeometry(config, { ...createSyntheticSource(config, 5), elevation: grid, waterAreas: areas }).warnings;
    expect(warningsFor([chart])).toEqual([]);
    expect(all([chart]).filter((warning) => warning.code === "LAKE_DEPTH_FROM_CHART")).toHaveLength(1);
    const band = (lo: number, hi: number) => ({ outer: [{ x: lo, y: -50 }, { x: hi, y: -50 }, { x: hi, y: 50 }, { x: lo, y: 50 }, { x: lo, y: -50 }], holes: [] });
    const modeled: WaterAreaV1 = { ...lake(), id: "modeled", hylakId: 2, polygon: band(10, 50), bathymetry: undefined };
    expect(warningsFor([{ ...chart, polygon: band(-50, -10) }, modeled])).toHaveLength(1);
    expect(all([lake()]).some((warning) => warning.code === "LAKE_DEPTH_FROM_CHART")).toBe(false);
  });

  it("does not warn when water depth is disabled or output is flat engraving", () => {
    const area = lake();
    delete area.bathymetry;
    expect(warningsFor([area], { ...config, showWaterDepth: false })).toEqual([]);
    expect(warningsFor([area], { ...config, outputMode: "engraving" })).toEqual([]);
  });

  it("does not warn for a modeled lake outside the circular cut", () => {
    const area = lake();
    delete area.bathymetry;
    area.polygon.outer = [{ x: 41, y: 41 }, { x: 60, y: 41 }, { x: 60, y: 60 }, { x: 41, y: 60 }];
    expect(warningsFor([area], { ...config, cropShape: "circle" })).toEqual([]);
  });
});
