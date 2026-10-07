import { describe, expect, it } from "vitest";
import type { GeoBounds, WaterAreaV1 } from "@topostack/core";
import { CHART_BATHYMETRY_SCHEMA, encodeChartDepths, type UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import type { SurveyResult } from "$lib/domain/bathymetry";
import { artworkToLonLat } from "$lib/domain/tile-math";
import { applyUserCharts, chartsForAreas, chartSpacingM, sampleChartDepths, type LoadedUserChart } from "$lib/domain/user-bathymetry";

const bounds: GeoBounds = { west: -94.08, south: 39.91, east: -94.06, north: 39.93 };
const HASH = "a".repeat(64);

/** A chart whose depth rises west to east, so resampling errors show up as a shifted ramp. */
function rampChart(overrides: Partial<UserChartBathymetryV1> = {}, gridBounds = bounds): UserChartBathymetryV1 {
  const width = 8;
  const height = 8;
  const depths = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) depths[row * width + column] = column;
  return {
    schema: CHART_BATHYMETRY_SCHEMA,
    id: "ramp-lake-chart",
    lake: { name: "Ramp Lake", outline: [[gridBounds.west, gridBounds.south], [gridBounds.east, gridBounds.south], [gridBounds.east, gridBounds.north], [gridBounds.west, gridBounds.south]] },
    georef: { method: "control-points", matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], rmsM: 1 },
    units: "m",
    labels: { kind: "depth" },
    intervalM: 1,
    contours: [{ depthM: 1, line: [[gridBounds.west, gridBounds.south], [gridBounds.east, gridBounds.north]], closed: false }],
    spots: [],
    grid: { bounds: gridBounds, width, height, method: "harmonic", depthsDm: encodeChartDepths(depths) },
    provenance: { title: "Ramp Lake chart", fileSha256: HASH, tool: "chart-trace@test" },
    license: { attestation: "own-work" },
    ...overrides,
  };
}

const lake = (overrides: Partial<WaterAreaV1> = {}): WaterAreaV1 => ({
  id: "lake-1", kind: "lake", hylakId: 42,
  // Wider than the 10 mm map, so the whole grid is inside this lake and the
  // assertions below are about the chart, not about the pixel mask.
  polygon: { outer: [{ x: -6, y: -6 }, { x: 6, y: -6 }, { x: 6, y: 6 }, { x: -6, y: 6 }], holes: [] },
  ...overrides,
});

const grid = { width: 9, height: 9, values: new Float32Array(81), min: 0, max: 0 };
const surveyed = (areas: WaterAreaV1[]): SurveyResult => ({ areas, status: "available", datasetVersions: ["mn-dnr-lakes-v1"], attribution: [{ name: "Minnesota DNR", url: "https://example.test/mn", license: "State licence" }] });
const loaded = (chart: UserChartBathymetryV1, contentHash = "b".repeat(64)): LoadedUserChart => ({ chart, contentHash });

describe("sampleChartDepths", () => {
  it("keeps the chart's ramp in place across the terrain grid", () => {
    const values = sampleChartDepths(rampChart(), bounds, grid);
    // West edge reads the chart's shallow end, east edge its deep end, and the
    // middle sits between them; rows all read alike, as the chart has no slope.
    expect(values[0]!).toBeCloseTo(0, 5);
    expect(values[8]!).toBeCloseTo(7, 5);
    expect(values[4]!).toBeGreaterThan(3);
    expect(values[4]!).toBeLessThan(4);
    for (let row = 1; row < 9; row += 1) expect(values[row * 9 + 4]!).toBeCloseTo(values[4]!, 4);
  });

  it("leaves terrain outside the chart uncovered", () => {
    // The map shifted half a lake west: its eastern half reads the chart, its western half nothing.
    const shifted = { west: bounds.west - 0.01, south: bounds.south, east: bounds.east - 0.01, north: bounds.north };
    const values = sampleChartDepths(rampChart(), shifted, grid);
    expect(Number.isNaN(values[0]!)).toBe(true);
    expect(values[8]!).toBeCloseTo(3.5, 1);
  });

  it("reports the chart's ground spacing", () => {
    // 0.02 degrees of latitude over 8 rows is about 278 m.
    expect(chartSpacingM(rampChart())).toBeCloseTo(278, 0);
  });
});

describe("applyUserCharts", () => {
  const dimensions = { widthMm: 10, heightMm: 10 };

  it("replaces a lake's provider depths and records the chart", async () => {
    const provider = new Float32Array(81).fill(99);
    const result = await applyUserCharts(surveyed([lake({ bathymetry: { width: 9, height: 9, depthsM: provider, sampleSpacingM: 50 } })]),
      new Map([["42", loaded(rampChart())]]), bounds, grid, undefined, dimensions);
    const depths = result.areas[0]!.bathymetry!.depthsM;
    expect(result.areas[0]!.bathymetryOrigin).toBe("chart");
    expect(depths[0]!).toBeCloseTo(0, 5);
    expect(depths[8]!).toBeCloseTo(7, 5);
    expect(Array.from(depths).some((depth) => depth === 99)).toBe(false);
    expect(result.datasetVersions).toEqual(["mn-dnr-lakes-v1", "userchart-bbbbbbbb"]);
    // A chart of the maker's own has nobody else to credit.
    expect(result.attribution).toHaveLength(1);
  });

  it("credits a chart traced from a published source", async () => {
    const chart = rampChart({ provenance: { title: "Lake Viking 2019", publisher: "U.S. Geological Survey", sourceUrl: "https://example.test/sheet.pdf", fileSha256: HASH, tool: "chart-trace@test" }, license: { attestation: "public-domain" } });
    const result = await applyUserCharts(surveyed([lake()]), new Map([["42", loaded(chart)]]), bounds, grid, undefined, dimensions);
    expect(result.attribution.at(-1)).toEqual({ name: "Depth chart: Lake Viking 2019", url: "https://example.test/sheet.pdf", license: "U.S. Geological Survey; public-domain" });
  });

  it("names a map-only lake by its chart, which lasts where the map's own numbering does not", async () => {
    const square = [[bounds.west, bounds.south], [bounds.east, bounds.south], [bounds.east, bounds.north], [bounds.west, bounds.north], [bounds.west, bounds.south]] as Array<[number, number]>;
    const chart = rampChart({ id: "pond-chart-0001", lake: { name: "Pond", outline: square } });
    const pond = lake({ id: "osm-lake-3", hylakId: undefined, outlineSource: "osm", polygon: { outer: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], holes: [] } });
    const result = await applyUserCharts(surveyed([pond]), new Map([["outline:pond-chart-0001", loaded(chart)]]), bounds, grid, undefined, dimensions);
    expect(result.areas[0]).toMatchObject({ id: "osm-lake-3", lakeKey: "outline:pond-chart-0001", bathymetryOrigin: "chart" });
    // HydroLAKES already names its lakes for good.
    const known = await applyUserCharts(surveyed([lake()]), new Map([["42", loaded(rampChart())]]), bounds, grid, undefined, dimensions);
    expect(known.areas[0]!.lakeKey).toBeUndefined();
  });

  it("leaves lakes without a chart, and charts for absent lakes, alone", async () => {
    const other = lake({ id: "lake-2", hylakId: 7 });
    const before = surveyed([other]);
    expect(await applyUserCharts(before, new Map([["42", loaded(rampChart())]]), bounds, grid, undefined, dimensions)).toBe(before);
    const unkeyed = surveyed([lake({ hylakId: undefined })]);
    expect(await applyUserCharts(unkeyed, new Map([["42", loaded(rampChart())]]), bounds, grid, undefined, dimensions)).toBe(unkeyed);
  });

  it("ignores a chart that does not reach this map", async () => {
    const elsewhere = rampChart({}, { west: 10, south: 50, east: 10.02, north: 50.02 });
    const before = surveyed([lake()]);
    expect(await applyUserCharts(before, new Map([["42", loaded(elsewhere)]]), bounds, grid, undefined, dimensions)).toBe(before);
  });

  it("keeps a provider's depths where the chart has none", async () => {
    // A chart covering only the map's western quarter leaves the east surveyed.
    const narrow = rampChart({}, { west: bounds.west, south: bounds.south, east: -94.075, north: bounds.north });
    const provider = new Float32Array(81).fill(99);
    const result = await applyUserCharts(surveyed([lake({ bathymetry: { width: 9, height: 9, depthsM: provider, sampleSpacingM: 50 } })]),
      new Map([["42", loaded(narrow)]]), bounds, grid, undefined, dimensions);
    const depths = result.areas[0]!.bathymetry!.depthsM;
    expect(depths[0]!).not.toBe(99);
    expect(depths[8]!).toBe(99);
  });

  it("carries a lake with no survey at all", async () => {
    const none: SurveyResult = { areas: [lake()], status: "not-covered", datasetVersions: [], attribution: [] };
    const result = await applyUserCharts(none, new Map([["42", loaded(rampChart())]]), bounds, grid, undefined, dimensions);
    expect(result.status).toBe("available");
    expect(result.areas[0]!.bathymetry!.depthsM[8]!).toBeCloseTo(7, 5);
  });

  it("does nothing without charts", async () => {
    const before = surveyed([lake()]);
    expect(await applyUserCharts(before, new Map(), bounds, grid)).toBe(before);
  });
});

describe("chartsForAreas", () => {
  const dimensions = { widthMm: 100, heightMm: 100 };
  const toLonLat = artworkToLonLat(bounds, dimensions.widthMm, dimensions.heightMm);
  /** A square lake in artwork millimetres, centred on (x, y). */
  const pond = (id: string, x: number, y: number, half: number, overrides: Partial<WaterAreaV1> = {}): WaterAreaV1 => ({
    id, kind: "lake", outlineSource: "osm",
    polygon: { outer: [{ x: x - half, y: y - half }, { x: x + half, y: y - half }, { x: x + half, y: y + half }, { x: x - half, y: y + half }], holes: [] },
    ...overrides,
  });
  const charted = (area: WaterAreaV1, id = "pond-chart-0001"): LoadedUserChart => {
    const outline = area.polygon.outer.map(toLonLat);
    return { chart: rampChart({ id, lake: { name: "Pond", outline: [...outline, outline[0]!] } }), contentHash: HASH };
  };

  it("finds the lake an outline-keyed chart was traced for among lakes with no HydroLAKES id", () => {
    const west = pond("osm-lake-0", -25, 0, 10);
    const east = pond("osm-lake-1", 25, 0, 10);
    const chosen = chartsForAreas([west, east], new Map([["outline:pond-chart-0001", charted(east)]]), bounds, dimensions);
    expect([...chosen.keys()]).toEqual(["osm-lake-1"]);
  });

  it("matches a lake the map area cuts off, by the part inside the map", () => {
    // The chart covers a lake twice the map's height; the map holds its middle.
    const whole = pond("osm-lake-0", 0, 0, 90);
    const inMap = pond("osm-lake-0", 0, 0, 50, { clipped: true });
    const loaded = { chart: rampChart({ id: "big-chart-0001", lake: { name: "Big", outline: whole.polygon.outer.map((point) => [bounds.west + (bounds.east - bounds.west) * (point.x / 100 + 0.5), bounds.north - (bounds.north - bounds.south) * (point.y / 100 + 0.5)] as [number, number]) } }), contentHash: HASH };
    expect(chartsForAreas([inMap], new Map([["outline:big-chart-0001", loaded]]), bounds, dimensions).has("osm-lake-0")).toBe(true);
  });

  it("leaves a lake alone when the outlines barely overlap, and keeps HydroLAKES charts first", () => {
    const pondArea = pond("osm-lake-0", 0, 0, 10);
    const elsewhere = pond("osm-lake-9", 30, 30, 10);
    expect(chartsForAreas([pondArea], new Map([["outline:pond-chart-0001", charted(elsewhere)]]), bounds, dimensions).size).toBe(0);
    const known = pond("lake-42-0", 0, 0, 10, { hylakId: 42, outlineSource: undefined });
    const byId = charted(known, "known-chart-0001");
    const chosen = chartsForAreas([known], new Map([["42", byId], ["outline:pond-chart-0001", charted(known)]]), bounds, dimensions);
    expect(chosen.get("lake-42-0")).toBe(byId);
    // Without the map's size there is no placing an outline, so only ids match.
    expect(chartsForAreas([pondArea], new Map([["outline:pond-chart-0001", charted(pondArea)]]), bounds).size).toBe(0);
  });
});

it("preserves chart islands as terrain polygon holes even when the provider omitted them", async () => {
  const chart = rampChart();
  chart.lake.islands = [[[-94.074,39.916],[-94.066,39.916],[-94.066,39.924],[-94.074,39.924]]];
  const sampled = sampleChartDepths(chart, bounds, grid);
  expect(Number.isNaN(sampled[40]!)).toBe(true);
  const result = await applyUserCharts(surveyed([lake()]), new Map([["42",loaded(chart)]]), bounds, grid, undefined, {widthMm:10,heightMm:10});
  expect(result.areas[0]!.polygon.holes).toHaveLength(1);
  expect(result.areas[0]!.polygon.holes[0]!.length).toBeGreaterThanOrEqual(4);
});
