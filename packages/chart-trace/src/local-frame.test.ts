import { describe, expect, it } from "vitest";
import { frameFor, localFrame, type Point2 } from "./local-frame.ts";

/** Metres per degree on the mean Earth sphere the frame uses. */
const METRES_PER_DEGREE = (Math.PI / 180) * 6_371_008.8;

describe("localFrame", () => {
  it("maps its origin to 0,0 and back", () => {
    const frame = localFrame(-94.6, 46.9);
    expect(frame.origin).toEqual([-94.6, 46.9]);
    expect(frame.toLocal(-94.6, 46.9)).toEqual([0, 0]);
    expect(frame.toLonLat(0, 0)).toEqual([-94.6, 46.9]);
  });

  it("uses one degree of latitude as about 111 km everywhere", () => {
    for (const lat of [-60, 0, 30, 75]) {
      const frame = localFrame(10, lat);
      expect(frame.scaleY).toBeCloseTo(METRES_PER_DEGREE, 6);
      expect(frame.scaleY).toBeCloseTo(111_195, 0);
    }
  });

  it.each([
    [0, 1],
    [45, Math.SQRT1_2],
    [60, 0.5],
    [-60, 0.5],
  ])("shrinks a degree of longitude by cos(latitude) at %d degrees", (lat, factor) => {
    const frame = localFrame(0, lat);
    expect(frame.scaleX / frame.scaleY).toBeCloseTo(factor, 12);
    const [x] = frame.toLocal(1, lat);
    expect(x).toBeCloseTo(METRES_PER_DEGREE * factor, 6);
  });

  it("puts east and north on +x and +y", () => {
    const frame = localFrame(-120, 39);
    const [east, north] = frame.toLocal(-119.99, 39.01);
    expect(east).toBeGreaterThan(0);
    expect(north).toBeGreaterThan(0);
    const [west, south] = frame.toLocal(-120.01, 38.99);
    expect(west).toBeLessThan(0);
    expect(south).toBeLessThan(0);
  });

  it("round-trips lon/lat through metres to well under a millimetre", () => {
    const frame = localFrame(-84.6, 44.6);
    const points: Point2[] = [
      [-84.6, 44.6],
      [-84.7, 44.65],
      [-84.45, 44.52],
      [-85.2, 45.1],
    ];
    for (const [lon, lat] of points) {
      const [x, y] = frame.toLocal(lon, lat);
      const [lonBack, latBack] = frame.toLonLat(x, y);
      // 1e-9 degrees is about 0.1 mm.
      expect(lonBack).toBeCloseTo(lon, 9);
      expect(latBack).toBeCloseTo(lat, 9);
    }
  });

  it("round-trips metres through lon/lat", () => {
    const frame = localFrame(151.2, -33.9);
    for (const [x, y] of [[0, 0], [1234.5, -987.6], [-25_000, 40_000]] as Point2[]) {
      const [lon, lat] = frame.toLonLat(x, y);
      const [xBack, yBack] = frame.toLocal(lon, lat);
      expect(xBack).toBeCloseTo(x, 6);
      expect(yBack).toBeCloseTo(y, 6);
    }
  });

  it("is affine, so equal lon/lat steps are equal metre steps across the frame", () => {
    const frame = localFrame(-94, 47);
    const step = (lon: number, lat: number) => {
      const [x0, y0] = frame.toLocal(lon, lat);
      const [x1, y1] = frame.toLocal(lon + 0.01, lat + 0.01);
      return [x1 - x0, y1 - y0];
    };
    const [dxA, dyA] = step(-94.2, 46.8);
    const [dxB, dyB] = step(-93.8, 47.3);
    expect(dxA).toBeCloseTo(dxB!, 6);
    expect(dyA).toBeCloseTo(dyB!, 6);
  });
});

describe("frameFor", () => {
  it("centres the frame on the bounding box, not the mean of the points", () => {
    // Three points crowd the west edge; the mean would sit well west of centre.
    const frame = frameFor([
      [-90, 40],
      [-90, 40.1],
      [-89.99, 40.05],
      [-89, 41],
    ]);
    expect(frame.origin[0]).toBeCloseTo(-89.5, 12);
    expect(frame.origin[1]).toBeCloseTo(40.5, 12);
    const [x, y] = frame.toLocal(-89.5, 40.5);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("matches localFrame at the box centre, scaling longitude at that latitude", () => {
    const fromPoints = frameFor([
      [10, 50],
      [12, 60],
    ]);
    const direct = localFrame(11, 55);
    expect(fromPoints.origin).toEqual(direct.origin);
    expect(fromPoints.scaleX).toBeCloseTo(direct.scaleX, 9);
    expect(fromPoints.scaleY).toBe(direct.scaleY);
  });

  it("puts a single point at the origin", () => {
    const frame = frameFor([[7.5, -12.25]]);
    expect(frame.origin).toEqual([7.5, -12.25]);
    expect(frame.toLocal(7.5, -12.25)).toEqual([0, 0]);
  });

  it("gives opposite corners of the box opposite local coordinates", () => {
    const frame = frameFor([
      [-100.2, 35.1],
      [-99.8, 35.3],
    ]);
    const [x1, y1] = frame.toLocal(-100.2, 35.1);
    const [x2, y2] = frame.toLocal(-99.8, 35.3);
    expect(x1).toBeCloseTo(-x2, 6);
    expect(y1).toBeCloseTo(-y2, 6);
  });

  it("refuses an empty point list", () => {
    expect(() => frameFor([])).toThrow(/at least one point/);
  });
});
