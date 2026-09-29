import { describe, expect, it } from "vitest";
import { aviationSymbolPaths, aviationSymbolRadius } from "./aviation-symbols.js";
import type { AviationSymbol } from "../types.js";

const SYMBOLS: AviationSymbol[] = ["airport", "airport-towered", "airport-private", "heliport", "vor", "vortac", "vor-dme", "tacan", "ndb", "dme", "obstacle", "obstacle-tall"];

describe("aviation symbols", () => {
  it.each(SYMBOLS)("draws %s inside its nominal size around the anchor", (symbol) => {
    const center = { x: 12, y: -7 };
    const size = 4;
    const paths = aviationSymbolPaths(symbol, center, size);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.length).toBeGreaterThanOrEqual(2);
      for (const point of path) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeLessThanOrEqual(size / 2 * 1.2 + 1e-9);
      }
    }
    expect(aviationSymbolRadius(symbol, size)).toBeLessThanOrEqual(size / 2);
  });

  it("closes the rings it draws as outlines", () => {
    const [hexagon] = aviationSymbolPaths("vor", { x: 0, y: 0 }, 4);
    expect(hexagon![0]).toEqual(hexagon!.at(-1));
    expect(hexagon).toHaveLength(7);
  });

  it("tells a towered airport from an untowered one", () => {
    expect(aviationSymbolPaths("airport-towered", { x: 0, y: 0 }, 4).length).toBeGreaterThan(aviationSymbolPaths("airport", { x: 0, y: 0 }, 4).length);
  });
});
