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
});
