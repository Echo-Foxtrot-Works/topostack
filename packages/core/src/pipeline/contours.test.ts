import { describe, expect, it } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry, planTerrainStack } from "../index.js";
import { gridSource, scaledForLayers } from "../test-support/sources.js";

describe("contour tracing", () => {
  it("generates nested physical layers from a deterministic elevation grid", () => {
    const source = createSyntheticSource(DEFAULT_PROJECT, 48);
    const result = generateGeometry(DEFAULT_PROJECT, source);
    const plan = planTerrainStack(DEFAULT_PROJECT, source.elevation.max - source.elevation.min, source.bounds);
    expect(result.layers).toHaveLength(plan.layerCount);
    expect(result.verticalExaggeration).toBeCloseTo(plan.verticalExaggeration, 9);
    expect(result.layers[0]?.polygons).toHaveLength(1);
    expect(result.maxElevationM).toBeGreaterThan(result.minElevationM);
  });

  it("traces smooth, accurate iso-lines instead of grid stair-steps", () => {
    const base = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, smoothing: 1 };
    const cone = (nx: number, ny: number) => 1000 - 500 * Math.hypot(nx, ny);
    const [project, source] = scaledForLayers(base, gridSource(base, 96, cone), 4);
    const smoothed = generateGeometry(project, source);
    // Layer 2's threshold sits at min + relief/2, so the cone's iso-line is a
    // circle of radius sqrt(2)/2 in normalized space = 70.71 mm.
    const ring = smoothed.layers[2]?.polygons[0]?.outer ?? [];
    expect(ring.length).toBeGreaterThan(40);
    const radius = Math.SQRT1_2 * 100;
    const deviation = (points: Array<{ x: number; y: number }>) => Math.max(...points.map((point) => Math.abs(Math.hypot(point.x, point.y) - radius)));
    expect(deviation(ring)).toBeLessThan(2.5);
    const stepped = generateGeometry({ ...project, smoothing: 0 }, source);
    expect(deviation(ring)).toBeLessThanOrEqual(deviation(stepped.layers[2]?.polygons[0]?.outer ?? []));
  });

  it("removes undersized pieces by minimum feature without coarsening the rest", () => {
    const base = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, optimizeMaterialUse: false };
    // A broad hill plus a needle about 3 mm across at half height.
    const terrain = (nx: number, ny: number) => Math.max(
      1000 - 1000 * Math.hypot(nx + 0.3, ny + 0.3),
      1000 - 1000 * Math.hypot(nx - 0.7, ny - 0.7) / 0.03,
    );
    const [project, source] = scaledForLayers(base, gridSource(base, 193, terrain), 6);
    const fine = generateGeometry({ ...project, minimumFeatureMm: 0.8 }, source);
    const coarse = generateGeometry({ ...project, minimumFeatureMm: 4 }, source);
    const narrowSide = (ring: Array<{ x: number; y: number }>) => Math.min(
      Math.max(...ring.map((point) => point.x)) - Math.min(...ring.map((point) => point.x)),
      Math.max(...ring.map((point) => point.y)) - Math.min(...ring.map((point) => point.y)),
    );

    expect(coarse.layers).toHaveLength(fine.layers.length);
    // The same outlines, minus only the pieces narrower than 4 mm.
    expect(coarse.layers.map((layer) => layer.polygons))
      .toEqual(fine.layers.map((layer) => layer.polygons.filter((polygon) => narrowSide(polygon.outer) >= 4)));
    expect(coarse.layers.flatMap((layer) => layer.polygons).length).toBeLessThan(fine.layers.flatMap((layer) => layer.polygons).length);
  });

  it("rounds contour corners instead of simplifying them into chamfers", () => {
    const base = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, minimumFeatureMm: 1, smoothing: 1 };
    const squareHill = (nx: number, ny: number) => 1000 - 500 * Math.max(Math.abs(nx), Math.abs(ny));
    const [project, source] = scaledForLayers(base, gridSource(base, 33, squareHill), 4);
    const smoothed = generateGeometry(project, source).layers[2]?.polygons[0]?.outer ?? [];
    const standard = generateGeometry({ ...project, smoothing: 0 }, source).layers[2]?.polygons[0]?.outer ?? [];
    const largestTurn = (ring: Array<{ x: number; y: number }>) => Math.max(...ring.slice(0, -1).map((point, index) => {
      const previous = ring[(index - 1 + ring.length - 1) % (ring.length - 1)]!;
      const next = ring[(index + 1) % (ring.length - 1)]!;
      const incoming = Math.atan2(point.y - previous.y, point.x - previous.x);
      const outgoing = Math.atan2(next.y - point.y, next.x - point.x);
      const difference = Math.abs(outgoing - incoming);
      return Math.min(difference, Math.PI * 2 - difference);
    }));

    expect(smoothed.length).toBeGreaterThanOrEqual(standard.length);
    expect(largestTurn(smoothed)).toBeLessThan(largestTurn(standard) * 0.75);
  });
});
