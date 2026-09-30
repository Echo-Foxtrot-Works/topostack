import { describe, expect, it } from "vitest";
import { aviationSymbolPaths, aviationSymbolRadius, aviationSymbolStandsOnAnchor } from "./aviation-symbols.js";
import type { AviationSymbol, AviationSymbolDetail, Point2D } from "../types.js";

const SYMBOLS: AviationSymbol[] = [
  "airport", "airport-hard", "airport-pattern", "airport-private", "airport-military", "airport-joint", "heliport", "seaplane-base",
  "vor", "vortac", "vor-dme", "tacan", "ndb", "ndb-dme", "dme",
  "obstacle", "obstacle-tall", "obstacle-group", "obstacle-group-tall", "wind-turbine", "wind-turbine-group",
];
const EVERYTHING: AviationSymbolDetail = { fuel: true, beacon: true, highIntensity: true, runways: [[{ x: 0, y: -900 }, { x: 0, y: 900 }], [{ x: -700, y: 0 }, { x: 700, y: 0 }]] };
const origin = { x: 0, y: 0 };
const points = (paths: Point2D[][]) => paths.flat();
const closed = (path: Point2D[]) => path.length > 2 && path[0]!.x === path.at(-1)!.x && path[0]!.y === path.at(-1)!.y;

describe("aviation symbols", () => {
  it.each(SYMBOLS)("draws %s within its extent around the anchor, with every detail", (symbol) => {
    const center = { x: 12, y: -7 };
    const size = 4;
    for (const detail of [{}, EVERYTHING]) {
      const paths = aviationSymbolPaths(symbol, center, size, detail, 0.24);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.length).toBeGreaterThanOrEqual(2);
        for (const point of path) {
          expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
          expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeLessThanOrEqual(aviationSymbolRadius(symbol, size) * 1.1 + 1e-9);
        }
      }
    }
  });

  it("stands obstacles on their position and rises above it", () => {
    for (const symbol of SYMBOLS.filter(aviationSymbolStandsOnAnchor)) {
      const all = points(aviationSymbolPaths(symbol, origin, 4));
      expect(Math.max(...all.map((point) => point.y)), symbol).toBeLessThanOrEqual(0.05);
      expect(Math.min(...all.map((point) => point.y)), symbol).toBeLessThan(-2);
    }
    expect(aviationSymbolStandsOnAnchor("vor")).toBe(false);
  });

  it("puts fuel ticks, not a tower mark, around an airport", () => {
    expect(aviationSymbolPaths("airport", origin, 4, { fuel: true })).toHaveLength(5);
    expect(aviationSymbolPaths("airport", origin, 4)).toHaveLength(1);
    // A beacon star takes the north tick's place.
    expect(aviationSymbolPaths("airport", origin, 4, { fuel: true, beacon: true })).toHaveLength(5);
    // Military fields chart neither fuel nor repair.
    expect(aviationSymbolPaths("airport-military", origin, 4, { fuel: true })).toHaveLength(2);
  });

  it("fills a hard-surfaced airport and leaves its runways unengraved", () => {
    const stroke = 0.24;
    const plain = aviationSymbolPaths("airport-hard", origin, 3.2, {}, stroke);
    const withRunway = aviationSymbolPaths("airport-hard", origin, 3.2, { runways: [[{ x: 0, y: -1 }, { x: 0, y: 1 }]] }, stroke);
    // Hatch lines under a stroke apart cover the disc.
    const rows = plain.slice(1).map((line) => line[0]!.y);
    expect(Math.max(...rows.slice(1).map((y, index) => y - rows[index]!))).toBeLessThan(stroke);
    // The north-south runway splits the rows it crosses, and the gap stays open after the strokes' round caps.
    expect(withRunway.length).toBeGreaterThan(plain.length);
    for (const line of withRunway.slice(1)) {
      if (Math.abs(line[0]!.y) < 0.6) expect(Math.min(...line.map((point) => Math.abs(point.x))) - stroke / 2).toBeGreaterThanOrEqual(stroke * 0.6 - 1e-9);
    }
  });

  it("draws a long-runway airport as its runway layout: hollow when large enough, centerlines when small", () => {
    const large = points(aviationSymbolPaths("airport-pattern", origin, 8, { runways: EVERYTHING.runways }, 0.24));
    // Two crossing strips: no outline edge runs through the crossing itself.
    expect(large.some((point) => Math.hypot(point.x, point.y) < 0.2)).toBe(false);
    // Runway ends reach the symbol's radius less a strip's half width.
    expect(Math.max(...large.map((point) => Math.abs(point.y)))).toBeCloseTo(3.8 - 0.56, 2);
    const small = aviationSymbolPaths("airport-pattern", origin, 3.2, { runways: EVERYTHING.runways }, 0.24);
    expect(small).toHaveLength(2);
    expect(small[0]).toEqual([{ x: 0, y: -(1.52 - 0.12) }, { x: 0, y: 1.52 - 0.12 }]);
    // Without a layout it falls back to the filled disc.
    expect(aviationSymbolPaths("airport-pattern", origin, 4)).toEqual(aviationSymbolPaths("airport-hard", origin, 4));
  });

  it("carries the VORTAC's tabs on the bottom and upper sides", () => {
    const [hexagon, ...rest] = aviationSymbolPaths("vortac", origin, 4);
    expect(hexagon).toHaveLength(7);
    const tabs = rest.filter(closed).filter((path) => path.length === 5 && Math.hypot(path[0]!.x - path[2]!.x, path[0]!.y - path[2]!.y) > 0.6);
    expect(tabs).toHaveLength(3);
    const centroids = tabs.map((tab) => ({ x: tab.slice(0, 4).reduce((sum, point) => sum + point.x, 0) / 4, y: tab.slice(0, 4).reduce((sum, point) => sum + point.y, 0) / 4 }));
    const bottom = centroids.filter((point) => point.y > 0);
    expect(bottom).toHaveLength(1);
    expect(bottom[0]!.x).toBeCloseTo(0);
    expect(centroids.filter((point) => point.y < 0).map((point) => Math.sign(point.x)).sort()).toEqual([-1, 1]);
  });

  it("draws the TACAN as one outline and the VOR-DME hexagon touching its rectangle", () => {
    const tacan = aviationSymbolPaths("tacan", origin, 4);
    expect(tacan).toHaveLength(1);
    expect(tacan[0]).toHaveLength(6 + 3 * 2 + 1);
    const [hexagon, rectangle] = aviationSymbolPaths("vor-dme", origin, 4);
    const maxX = (path: Point2D[]) => Math.max(...path.map((point) => point.x));
    const maxY = (path: Point2D[]) => Math.max(...path.map((point) => point.y));
    expect(maxX(hexagon!)).toBeCloseTo(maxX(rectangle!));
    expect(maxY(hexagon!)).toBeCloseTo(maxY(rectangle!));
  });

  it("keeps NDB stipple dots apart at the engraving stroke", () => {
    const stroke = 0.24;
    const dots = aviationSymbolPaths("ndb", origin, 6, {}, stroke).slice(2).map((path) => path[0]!);
    expect(dots.length).toBeGreaterThan(10);
    const nearest = dots.map((dot, index) => Math.min(...dots.filter((_, other) => other !== index).map((other) => Math.hypot(other.x - dot.x, other.y - dot.y))));
    expect(Math.min(...nearest)).toBeGreaterThan(stroke * 2);
    expect(aviationSymbolPaths("ndb-dme", origin, 6, {}, stroke).some((path) => closed(path) && path.length === 5 && Math.abs(path[0]!.x) > 0.5)).toBe(true);
  });

  it("adds rays for high-intensity lights only", () => {
    expect(aviationSymbolPaths("obstacle-tall", origin, 4, { highIntensity: true }).length).toBe(aviationSymbolPaths("obstacle-tall", origin, 4).length + 5);
  });
});
