import { describe, expect, it } from "vitest";
import type { Point2 } from "./local-frame.ts";
import { buildChartRecord, type ChartRecordRequest } from "./record.ts";

// Chart pixels to lon/lat: about 0.8 m per pixel east and 1.1 m south, near 45°N.
const matrix = [1e-5, 0, -120, 0, -1e-5, 45, 0, 0, 1];
const square = (from: number, to: number): Point2[] => [[from, from], [to, from], [to, to], [from, to], [from, from]];

const request = (overrides: Partial<ChartRecordRequest> = {}): ChartRecordRequest => ({
  id: "square-lake-chart",
  lake: { name: "Square Lake" },
  georef: { matrix, rmsM: 1.234, method: "snap" },
  units: "m",
  labels: { kind: "depth" },
  interval: 2,
  contours: [{ points: square(20, 80), closed: true, value: 2 }, { points: square(40, 60), closed: true, value: 4 }],
  water: { pixels: [square(0, 100)] },
  spots: [{ x: 50, y: 50, value: 6.25 }],
  resolutionM: 5,
  provenance: { title: "Square Lake", fileSha256: "a".repeat(64), tool: "test" },
  license: { attestation: "own-work" },
  ...overrides,
});

describe("buildChartRecord", () => {
  it("keeps the spot depths that shaped the grid", () => {
    const { record, report } = buildChartRecord(request());
    expect(record.spots).toEqual([{ lon: -119.9995, lat: 44.9995, depthM: 6.25 }]);
    expect(record.contours.map(({ depthM }) => depthM)).toEqual([2, 4]);
    expect(record.georef).toMatchObject({ method: "snap", rmsM: 1.23 });
    expect(report.deepestM).toBeGreaterThanOrEqual(4);
    expect(report.waterCells).toBeGreaterThan(0);
  });

  it("refuses a resolution that would never finish simplifying", () => {
    for (const resolutionM of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildChartRecord(request({ resolutionM })), String(resolutionM)).toThrow(/grid resolution must be a positive number/);
    }
  });

  it("names what the maker must fix when nothing can be gridded", () => {
    expect(() => buildChartRecord(request({ contours: [{ points: square(20, 80), closed: true, value: -3 }] }))).toThrow(/no contour got a level/);
    expect(() => buildChartRecord(request({ water: { pixels: [[[0, 0], [1, 1]]] } }))).toThrow(/no water outline/);
  });
  it("refuses a georeference that collapses the chart to a point", () => {
    expect(() => buildChartRecord(request({ georef: { matrix: [0, 0, -120, 0, 0, 45, 0, 0, 1], rmsM: 0, method: "snap" } }))).toThrow(/collapses the chart to a point/);
  });

  it("turns elevation labels in feet into depths below the surface, dropping levels above it", () => {
    const { record } = buildChartRecord(request({
      units: "ft",
      labels: { kind: "elevation", surfaceElevationM: 100 },
      interval: 10,
      contours: [{ points: square(20, 80), closed: true, value: 320 }, { points: square(40, 60), closed: true, value: 300 }, { points: square(45, 55), closed: true, value: 400 }],
      spots: [{ x: 50, y: 50, value: 290 }, { x: 30, y: 30, value: 330 }],
    }));
    expect(record.contours.map(({ depthM }) => depthM)).toEqual([2.464, 8.56]);
    expect(record.spots.map(({ depthM }) => depthM)).toEqual([11.608]);
    expect(record.intervalM).toBeCloseTo(3.048, 9);
  });

  it("keeps reviewed interiors, islands, and how the chart was georeferenced", () => {
    const controlPoints = [{ x: 0, y: 0, lon: -120, lat: 45 }, { x: 100, y: 0, lon: -119.999, lat: 45 }, { x: 100, y: 100, lon: -119.999, lat: 44.999 }, { x: 0, y: 100, lon: -120, lat: 44.999 }];
    const { record } = buildChartRecord(request({
      lake: { name: "Square Lake", region: "Oregon", hylakId: 42 },
      georef: { matrix, rmsM: 0.5, method: "control-points", controlPoints, iou: 0.91234 },
      explicitInteriors: true,
      interval: undefined,
      contours: [{ points: square(20, 80), closed: true, value: 2, inside: "deeper", interiorValue: 3 }, { points: square(30, 40), closed: true, value: 4 }],
      water: { pixels: [square(0, 100), square(60, 70)] },
      spots: [],
    }));
    expect(record.lake).toMatchObject({ name: "Square Lake", region: "Oregon", hylakId: 42 });
    expect(record.lake.islands).toEqual([square(60, 70).map(([x, y]) => [Math.round((-120 + x * 1e-5) * 1e6) / 1e6, Math.round((45 - y * 1e-5) * 1e6) / 1e6])]);
    expect(record.georef).toMatchObject({ method: "control-points", controlPoints, iou: 0.912 });
    expect(record.contours.map(({ inside, interiorDepthM }) => [inside, interiorDepthM])).toEqual([["deeper", 3], [undefined, 4]]);
    expect(record).not.toHaveProperty("intervalM");
  });

  it("uses a known lake outline as given and closes one too short to be a ring", () => {
    const triangle: Point2[] = [[-120, 45], [-119.999, 45], [-119.9995, 44.999]];
    const { record, report } = buildChartRecord(request({ water: { lonLat: [triangle] } }));
    expect(record.lake.outline).toEqual([...triangle, triangle[0]]);
    expect(report.waterCells).toBeGreaterThan(0);
  });

  it("thins a lake outline past the record's point limit", () => {
    const ring: Point2[] = Array.from({ length: 25_000 }, (_, index) => {
      const angle = (index / 25_000) * Math.PI * 2;
      return [-119.9995 + Math.cos(angle) * 5e-4, 44.9995 + Math.sin(angle) * 5e-4];
    });
    const { record } = buildChartRecord(request({ water: { lonLat: [ring] } }));
    expect(record.lake.outline.length).toBeLessThanOrEqual(20_000);
    expect(record.lake.outline.length).toBeGreaterThan(10_000);
  });

  it("keeps the longest contours, in their own order, when a scan yields more than a record holds", () => {
    const short = { points: [[25, 25], [26, 26]] as Point2[], closed: false, value: 9 };
    const lines = Array.from({ length: 5000 }, (_, index) => ({ points: [[20, 20 + index * 0.01], [50, 20 + index * 0.01], [80, 20 + index * 0.01]] as Point2[], closed: false, value: 2 }));
    const { record } = buildChartRecord(request({ contours: [short, ...lines], spots: [] }));
    expect(record.contours).toHaveLength(5000);
    expect(record.contours.some(({ depthM }) => depthM === 9)).toBe(false);
  });

  it("simplifies a dense trace until it fits the point budget, but never thins reviewed geometry", () => {
    // 5000 zigzags of 41 points are 205,000 points: one over the budget at the
    // starting tolerance, which keeps every corner of a zigzag this sharp.
    const zigzag = (row: number): Point2[] => Array.from({ length: 41 }, (_, index) => [20 + index * 1.5, 20 + row * 0.012 + (index % 2 ? 2 : -2)]);
    const contours = Array.from({ length: 5000 }, (_, row) => ({ points: zigzag(row), closed: false, value: 2 }));
    const { report } = buildChartRecord(request({ contours, spots: [] }));
    expect(report.contours).toBe(5000);
    expect(report.contourPoints).toBeLessThanOrEqual(200_000);
    // Only as coarse as it must be: the tolerance grows in small steps.
    expect(report.contourPoints).toBeGreaterThan(190_000);
    expect(() => buildChartRecord(request({ explicitInteriors: true, contours, spots: [] }))).toThrow(/exceeds the point limit/);
  });

  it("refuses more spot depths than a record holds", () => {
    const spots = Array.from({ length: 5001 }, (_, index) => ({ x: 10 + (index % 80), y: 10 + Math.floor(index / 80), value: 3 }));
    expect(() => buildChartRecord(request({ spots }))).toThrow(/5001 spot depths is more than a record holds/);
  });
});
