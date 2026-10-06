import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, signedArea, type MarkingFeature, type Point2D, type Polygon2D, type SourceBundleV1, type WaterAreaV1 } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";
import { MAX_VECTOR_MARKINGS } from "$lib/domain/vector-cleanup";
import { applyLakeShorelines, assembleWater, combineWaterAreas } from "./water-assembly";

const p = (x: number, y: number): Point2D => ({ x, y });
const square = (x0: number, y0: number, x1: number, y1: number): Point2D[] => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, y0)];
const polygon = (x0: number, y0: number, x1: number, y1: number): Polygon2D => ({ outer: square(x0, y0, x1, y1), holes: [] });
const lake = (id: string, shape: Polygon2D, extra: Partial<WaterAreaV1> = {}): WaterAreaV1 => ({ id, kind: "lake", polygon: shape, ...extra });
const road: MarkingFeature = { id: "road-0", kind: "road", operation: "score", transportationClass: "major-road", points: [p(-50, 0), p(50, 0)] };
const staleShore: MarkingFeature = { id: "water-area-0-shore-0", kind: "water", operation: "score", points: square(0, 0, 1, 1) };

function source(overrides: Partial<SourceBundleV1> = {}): SourceBundleV1 {
  return { ...createSamplePreviewSource(), markings: [road, staleShore], vectorStatus: "available", ...overrides };
}

describe("combineWaterAreas", () => {
  it("returns lakes and ocean unchanged when one side is missing", () => {
    const ocean = [polygon(0, 0, 100, 100), polygon(200, 0, 300, 100)];
    expect(combineWaterAreas([], ocean, 1)).toEqual([
      { id: "ocean-0", kind: "ocean", polygon: ocean[0] },
      { id: "ocean-1", kind: "ocean", polygon: ocean[1] },
    ]);
    const lakes = [lake("hydro-1", polygon(0, 0, 10, 10))];
    expect(combineWaterAreas(lakes, [], 1)).toEqual(lakes);
    expect(combineWaterAreas([], [], 1)).toEqual([]);
  });

  it("cuts a lake out of the ocean it sits in, so the two shores never double up", () => {
    const inner = lake("hydro-1", polygon(40, 40, 60, 60), { hylakId: 1 });
    const areas = combineWaterAreas([inner], [polygon(0, 0, 100, 100)], 1);
    expect(areas.map((area) => area.id)).toEqual(["ocean-0-0", "hydro-1"]);
    const ocean = areas[0]!;
    expect(ocean.kind).toBe("ocean");
    expect(ocean.polygon.holes).toHaveLength(1);
    expect(signedArea(ocean.polygon.outer)).toBeGreaterThan(0);
    expect(signedArea(ocean.polygon.holes[0]!)).toBeLessThan(0);
    // The lake itself is passed through untouched.
    expect(areas[1]).toBe(inner);
  });

  it("trims an overlapping lake's share off the ocean edge", () => {
    const areas = combineWaterAreas([lake("hydro-1", polygon(80, 0, 120, 100))], [polygon(0, 0, 100, 100)], 1);
    const ocean = areas.find((area) => area.kind === "ocean")!;
    expect(ocean.polygon.holes).toEqual([]);
    expect(Math.max(...ocean.polygon.outer.map((point) => point.x))).toBe(80);
    expect(signedArea(ocean.polygon.outer)).toBeCloseTo(8000);
  });

  it("drops ocean wholly under a lake and slivers below the minimum feature", () => {
    const covered = combineWaterAreas([lake("hydro-1", polygon(-10, -10, 110, 110))], [polygon(0, 0, 100, 100)], 1);
    expect(covered.map((area) => area.id)).toEqual(["hydro-1"]);
    const sliver = combineWaterAreas([lake("hydro-1", polygon(0, 0, 99.5, 100))], [polygon(0, 0, 100, 100)], 1);
    expect(sliver.map((area) => area.id)).toEqual(["hydro-1"]);
  });

  it("numbers every piece of an ocean split in two by a lake", () => {
    const areas = combineWaterAreas([lake("hydro-1", polygon(40, -10, 60, 110))], [polygon(0, 0, 100, 100), polygon(200, 0, 300, 100)], 1);
    expect(areas.map((area) => area.id).sort()).toEqual(["hydro-1", "ocean-0-0", "ocean-0-1", "ocean-1-0"]);
  });
});

describe("applyLakeShorelines", () => {
  it("leaves a source without water areas as it is", () => {
    const original = source({ waterAreas: [] });
    expect(applyLakeShorelines(original, DEFAULT_PROJECT)).toBe(original);
    const missing = source({ waterAreas: undefined });
    expect(applyLakeShorelines(missing, DEFAULT_PROJECT)).toBe(missing);
  });

  it("replaces old shorelines with ones traced from ocean and lake outlines", () => {
    const ocean: WaterAreaV1 = { id: "ocean-0", kind: "ocean", polygon: { outer: square(0, 0, 100, 100), holes: [square(40, 40, 60, 60)] } };
    const inner = lake("hydro-1", polygon(40, 40, 60, 60));
    const result = applyLakeShorelines(source({ waterAreas: [ocean, inner] }), DEFAULT_PROJECT);
    expect(result.markings[0]).toBe(road);
    const shores = result.markings.filter((marking) => marking.id.startsWith("water-area-"));
    expect(shores.map((marking) => marking.id).sort()).toEqual(["water-area-0-shore-0", "water-area-0-shore-1", "water-area-1-shore-0"]);
    expect(shores.find((marking) => marking.id === "water-area-1-shore-0")!.points).toBe(inner.polygon.outer);
    expect(result.waterPatternAreas).toEqual([ocean.polygon, inner.polygon]);
    expect(result.vectorStatus).toBe("available");
  });

  it("adds an OSM lake from inland map water that no depth lake covers", () => {
    const inland = polygon(200, 200, 240, 240);
    const result = applyLakeShorelines(source({ waterAreas: [lake("hydro-1", polygon(0, 0, 20, 20))], inlandWaterAreas: [inland] }), DEFAULT_PROJECT);
    expect(result.waterPatternAreas).toEqual([polygon(0, 0, 20, 20), inland]);
    expect(result.markings.filter((marking) => marking.id.startsWith("water-area-"))).toHaveLength(2);
  });

  it("does not trace inland water that a depth lake already describes", () => {
    const outline = polygon(0, 0, 20, 20);
    const result = applyLakeShorelines(source({ waterAreas: [lake("hydro-1", outline)], inlandWaterAreas: [polygon(0.5, 0.5, 20, 20)] }), DEFAULT_PROJECT);
    expect(result.waterPatternAreas).toEqual([outline]);
  });

  it("removes shorelines when water is hidden but still records the pattern areas", () => {
    const inner = lake("hydro-1", polygon(40, 40, 60, 60));
    const result = applyLakeShorelines(source({ waterAreas: [inner] }), { ...DEFAULT_PROJECT, showWater: false });
    expect(result.markings).toEqual([road]);
    expect(result.waterPatternAreas).toEqual([inner.polygon]);
  });

  it("marks available vectors partial when shorelines overflow the marking cap", () => {
    const crowded = Array.from({ length: MAX_VECTOR_MARKINGS }, (_, index): MarkingFeature => ({ ...road, id: `road-${index}` }));
    const waterAreas = [lake("hydro-1", polygon(40, 40, 60, 60))];
    const result = applyLakeShorelines(source({ markings: crowded, waterAreas }), DEFAULT_PROJECT);
    expect(result.markings).toHaveLength(MAX_VECTOR_MARKINGS);
    expect(result.markings.some((marking) => marking.id === "water-area-0-shore-0")).toBe(true);
    expect(result.vectorStatus).toBe("partial");
    expect(applyLakeShorelines(source({ markings: crowded, waterAreas, vectorStatus: "unavailable" }), DEFAULT_PROJECT).vectorStatus).toBe("unavailable");
  });
});

describe("assembleWater", () => {
  it("trims the ocean under lakes and traces the shores of the result", () => {
    const inner = lake("hydro-1", polygon(40, 40, 60, 60));
    const result = assembleWater(source(), [inner], [polygon(0, 0, 100, 100)], DEFAULT_PROJECT);
    expect(result.waterAreas!.map((area) => area.id)).toEqual(["ocean-0-0", "hydro-1"]);
    const shores = result.markings.filter((marking) => marking.id.startsWith("water-area-"));
    // Ocean outer, the ocean's hole around the lake, and the lake's own shore.
    expect(shores).toHaveLength(3);
    expect(result.markings).toContain(road);
    expect(result.markings).not.toContain(staleShore);
  });

  it("keeps the vector layer's own shorelines when no water area is left to trace", () => {
    const result = assembleWater(source(), [], [], DEFAULT_PROJECT);
    expect(result.waterAreas).toEqual([]);
    // Map-only water keeps the shores the vector loader traced; nothing is rebuilt.
    expect(result.markings).toEqual([road, staleShore]);
  });
});
