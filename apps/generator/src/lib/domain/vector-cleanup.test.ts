import { describe, expect, it } from "vitest";
import { signedArea, type MarkingFeature, type Point2D, type Polygon2D } from "@topostack/core";
import type { MultiPolygon, Pair } from "polygon-clipping";
import { cleanBoundaryMarkings, cleanWaterwayMarkings, clipVectorTileLine, dissolveWaterAreas, dissolveWaterPolygons, joinPaths, limitVectorMarkingGroups, MAX_VECTOR_MARKINGS, multiPolygonToAreas, shorelineMarkings, stitchTransportationMarkings } from "./vector-cleanup";

const p = (x: number, y: number): Point2D => ({ x, y });
const line = (id: string, points: Array<[number, number]>, extra: Partial<MarkingFeature> = {}): MarkingFeature => ({ id, kind: "water", operation: "score", points: points.map(([x, y]) => p(x, y)), ...extra });
const road = (id: string, points: Array<[number, number]>, extra: Partial<MarkingFeature> = {}): MarkingFeature => line(id, points, { kind: "road", transportationClass: "major-road", ...extra });
const square = (x0: number, y0: number, x1: number, y1: number): Point2D[] => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, y0)];
const pairs = (points: Point2D[]): Pair[] => points.map(({ x, y }) => [x, y]);
const closed = (ring: Point2D[]) => ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y;
const coords = (points: Point2D[]) => points.map(({ x, y }) => [x, y]);

describe("clipVectorTileLine", () => {
  it("keeps a line inside the tile unchanged", () => {
    expect(clipVectorTileLine([p(1, 1), p(5, 5), p(9, 1)], 10)).toEqual([[p(1, 1), p(5, 5), p(9, 1)]]);
  });

  it("cuts the buffer away at the tile edge", () => {
    expect(clipVectorTileLine([p(-5, 5), p(5, 5), p(15, 5)], 10)).toEqual([[p(0, 5), p(5, 5), p(10, 5)]]);
  });

  it("splits a line that leaves the tile and comes back", () => {
    const pieces = clipVectorTileLine([p(2, 2), p(2, 12), p(8, 12), p(8, 2)], 10);
    expect(pieces).toEqual([[p(2, 2), p(2, 10)], [p(8, 10), p(8, 2)]]);
  });

  it("returns nothing for lines wholly in the buffer, too short, or with no extent", () => {
    expect(clipVectorTileLine([p(-5, -5), p(-1, -1)], 10)).toEqual([]);
    expect(clipVectorTileLine([p(11, 0), p(11, 10)], 10)).toEqual([]);
    expect(clipVectorTileLine([p(5, 5)], 10)).toEqual([]);
    expect(clipVectorTileLine([p(1, 1), p(5, 5)], 0)).toEqual([]);
    expect(clipVectorTileLine([p(1, 1), p(5, 5)], Number.NaN)).toEqual([]);
  });

  it("drops a segment that only grazes a corner", () => {
    expect(clipVectorTileLine([p(-1, 1), p(1, -1)], 10)).toEqual([]);
  });

  it("collapses repeated vertices instead of emitting zero-length segments", () => {
    expect(clipVectorTileLine([p(1, 1), p(1, 1), p(4, 1)], 10)).toEqual([[p(1, 1), p(4, 1)]]);
  });
});

describe("multiPolygonToAreas", () => {
  it("winds outers positively and holes negatively whatever the input winding", () => {
    const outerCcw = pairs(square(0, 0, 20, 20));
    const outerCw = [...outerCcw].reverse();
    const hole = pairs(square(5, 5, 15, 15));
    for (const outer of [outerCcw, outerCw]) for (const ring of [hole, [...hole].reverse()]) {
      const [area] = multiPolygonToAreas([[outer, ring]], 1);
      expect(signedArea(area!.outer)).toBeGreaterThan(0);
      expect(area!.holes).toHaveLength(1);
      expect(signedArea(area!.holes[0]!)).toBeLessThan(0);
      expect(closed(area!.outer) && closed(area!.holes[0]!)).toBe(true);
    }
  });

  it("closes open rings", () => {
    const [area] = multiPolygonToAreas([[[[0, 0], [10, 0], [10, 10], [0, 10]]]], 1);
    expect(closed(area!.outer)).toBe(true);
    expect(area!.outer).toHaveLength(5);
  });

  it("drops outers and holes narrower than the minimum feature on either axis", () => {
    const multi: MultiPolygon = [
      [pairs(square(0, 0, 20, 20)), pairs(square(5, 5, 5.5, 15)), pairs(square(8, 8, 12, 12))],
      [pairs(square(30, 0, 50, 0.5))],
      [],
    ];
    const areas = multiPolygonToAreas(multi, 1);
    expect(areas).toHaveLength(1);
    expect(areas[0]!.holes).toHaveLength(1);
    expect(Math.min(...areas[0]!.holes[0]!.map((point) => point.x))).toBe(8);
  });

  it("simplifies rings within a fraction of the minimum feature", () => {
    // A 0.05 mm wobble on a 20 mm edge disappears at a 1 mm minimum feature (0.18 mm tolerance)...
    const wobbly: Pair[] = [[0, 0], [5, 0.05], [10, 0], [15, 0.05], [20, 0], [20, 20], [0, 20], [0, 0]];
    expect(multiPolygonToAreas([[wobbly]], 1)[0]!.outer).toHaveLength(5);
    // ...but a 1 mm notch survives.
    const notched: Pair[] = [[0, 0], [10, 1], [20, 0], [20, 20], [0, 20], [0, 0]];
    expect(multiPolygonToAreas([[notched]], 1)[0]!.outer).toHaveLength(6);
  });
});

describe("dissolveWaterAreas", () => {
  it("is empty for no input", () => {
    expect(dissolveWaterAreas([], 1)).toEqual([]);
    expect(dissolveWaterPolygons([], 1)).toEqual([]);
  });

  it("joins tile fragments into one water body without a seam", () => {
    const left: Polygon2D = { outer: square(0, 0, 10, 10), holes: [] };
    const right: Polygon2D = { outer: square(10, 0, 20, 10), holes: [] };
    const areas = dissolveWaterAreas([left, right], 1);
    expect(areas).toHaveLength(1);
    const xs = areas[0]!.outer.map((point) => point.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 20]);
    expect(areas[0]!.outer.some((point) => point.x === 10)).toBe(false);
    expect(signedArea(areas[0]!.outer)).toBeCloseTo(200);
  });

  it("keeps islands as holes and separate lakes apart", () => {
    const lake: Polygon2D = { outer: square(0, 0, 30, 30), holes: [square(10, 10, 20, 20)] };
    const pond: Polygon2D = { outer: square(50, 50, 55, 55), holes: [] };
    const areas = dissolveWaterAreas([lake, pond], 1);
    expect(areas).toHaveLength(2);
    const withIsland = areas.find((area) => area.holes.length === 1)!;
    expect(signedArea(withIsland.holes[0]!)).toBeLessThan(0);
  });

  it("emits one scored shoreline per ring with stable ids", () => {
    const lake: Polygon2D = { outer: square(0, 0, 30, 30), holes: [square(10, 10, 20, 20)] };
    const markings = dissolveWaterPolygons([lake], 1);
    expect(markings.map((marking) => marking.id)).toEqual(["water-area-0-shore-0", "water-area-0-shore-1"]);
    expect(markings.every((marking) => marking.kind === "water" && marking.operation === "score")).toBe(true);
  });
});

describe("shorelineMarkings", () => {
  it("numbers rings per area, outer first", () => {
    const areas: Polygon2D[] = [{ outer: square(0, 0, 1, 1), holes: [] }, { outer: square(0, 0, 3, 3), holes: [square(1, 1, 2, 2)] }];
    const markings = shorelineMarkings(areas);
    expect(markings.map((marking) => marking.id)).toEqual(["water-area-0-shore-0", "water-area-1-shore-0", "water-area-1-shore-1"]);
    expect(markings[2]!.points).toBe(areas[1]!.holes[0]);
  });
});

describe("joinPaths", () => {
  it("joins pieces at shared degree-two endpoints whichever way they run", () => {
    const joined = joinPaths([line("b", [[10, 0], [20, 0]]), line("a", [[0, 0], [10, 0]]), line("c", [[30, 0], [20, 0]])]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.feature.id).toBe("b");
    expect(coords(joined[0]!.points)).toEqual([[0, 0], [10, 0], [20, 0], [30, 0]]);
  });

  it("drops exact repeats, including reversed ones", () => {
    const joined = joinPaths([line("a", [[0, 0], [5, 5]]), line("b", [[0, 0], [5, 5]]), line("c", [[5, 5], [0, 0]])]);
    expect(joined).toHaveLength(1);
    expect(coords(joined[0]!.points)).toEqual([[0, 0], [5, 5]]);
  });

  it("leaves forks and crossings as separate branches", () => {
    const joined = joinPaths([line("a", [[0, 0], [10, 0]]), line("b", [[10, 0], [20, 0]]), line("c", [[10, 0], [10, 10]])]);
    expect(joined).toHaveLength(3);
  });

  it("closes a loop without running round it twice", () => {
    const joined = joinPaths([line("a", [[0, 0], [10, 0], [10, 10]]), line("b", [[10, 10], [0, 10], [0, 0]])]);
    expect(joined).toHaveLength(1);
    expect(coords(joined[0]!.points)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  });

  it("only joins features within the same group", () => {
    const joined = joinPaths([line("a", [[0, 0], [10, 0]], { label: "x" }), line("b", [[10, 0], [20, 0]], { label: "y" })], (feature) => feature.label ?? "");
    expect(joined.map(({ feature }) => feature.id)).toEqual(["a", "b"]);
  });
});

describe("cleanWaterwayMarkings", () => {
  it("drops lines shorter than the minimum feature and renumbers the rest", () => {
    const cleaned = cleanWaterwayMarkings([line("short", [[0, 0], [0.5, 0]]), line("long", [[0, 10], [20, 10]]), line("dot", [[3, 3]]), line("other", [[0, 20], [0, 25]])], 1);
    expect(cleaned.map((marking) => marking.id)).toEqual(["waterway-0", "waterway-1"]);
    expect(cleaned.map((marking) => marking.points.length)).toEqual([2, 2]);
  });

  it("keeps a line exactly at the minimum length", () => {
    expect(cleanWaterwayMarkings([line("a", [[0, 0], [1, 0]])], 1)).toHaveLength(1);
  });

  it("judges length after joining tile pieces", () => {
    const pieces = [line("a", [[0, 0], [0.6, 0]]), line("b", [[0.6, 0], [1.2, 0]])];
    const cleaned = cleanWaterwayMarkings(pieces, 1);
    expect(cleaned).toHaveLength(1);
    expect(coords(cleaned[0]!.points)).toEqual([[0, 0], [1.2, 0]]);
  });

  it("removes collinear and near-collinear vertices but keeps real bends", () => {
    const [straight] = cleanWaterwayMarkings([line("a", [[0, 0], [5, 0.05], [10, 0], [15, -0.05], [20, 0]])], 1);
    expect(coords(straight!.points)).toEqual([[0, 0], [20, 0]]);
    const [bent] = cleanWaterwayMarkings([line("a", [[0, 0], [10, 5], [20, 0]])], 1);
    expect(bent!.points).toHaveLength(3);
  });

  it("keeps a closed waterway closed after simplification", () => {
    const [loop] = cleanWaterwayMarkings([line("a", [[0, 0], [5, 0.01], [10, 0], [10, 10], [0, 10], [0, 0]])], 1);
    expect(closed(loop!.points)).toBe(true);
    expect(loop!.points).toHaveLength(5);
  });

  it("keeps feature fields and names boundaries with their own prefix", () => {
    const cleaned = cleanBoundaryMarkings([line("a", [[0, 0], [10, 0]], { kind: "boundary", label: "State line" })], 1);
    expect(cleaned).toEqual([expect.objectContaining({ id: "boundary-0", kind: "boundary", label: "State line" })]);
  });
});

describe("stitchTransportationMarkings", () => {
  it("joins pieces of the same road and class across tile edges", () => {
    const stitched = stitchTransportationMarkings([road("a", [[0, 0], [10, 0]]), road("b", [[10, 0], [20, 5]])]);
    expect(stitched).toHaveLength(1);
    expect(coords(stitched[0]!.points)).toEqual([[0, 0], [10, 0], [20, 5]]);
  });

  it("does not join different classes, kinds, or names", () => {
    const stitched = stitchTransportationMarkings([
      road("a", [[0, 0], [10, 0]]),
      road("b", [[10, 0], [20, 0]], { transportationClass: "local-road" }),
      road("c", [[20, 0], [30, 0]], { label: "Main St" }),
      road("d", [[30, 0], [40, 0]], { label: "Main St", kind: "trail" }),
    ]);
    expect(stitched.map((marking) => marking.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("passes other markings through after the roads, untouched", () => {
    const shore = line("shore", [[0, 0], [10, 0]]);
    const stub = road("stub", [[5, 5]]);
    const stitched = stitchTransportationMarkings([shore, road("a", [[0, 0], [10, 0]]), stub]);
    expect(stitched.map((marking) => marking.id)).toEqual(["a", "shore", "stub"]);
    expect(stitched[1]).toBe(shore);
  });
});

describe("limitVectorMarkingGroups", () => {
  const group = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => line(`${prefix}${index}`, [[0, index], [1, index]]));

  it("takes from every group in turn so one dense group cannot crowd out the rest", () => {
    const { markings, truncated } = limitVectorMarkingGroups([group("a", 5), [], group("b", 2), group("c", 1)], 6);
    expect(markings.map((marking) => marking.id)).toEqual(["a0", "b0", "c0", "a1", "b1", "a2"]);
    expect(truncated).toBe(true);
  });

  it("keeps everything when it fits", () => {
    const { markings, truncated } = limitVectorMarkingGroups([group("a", 2), group("b", 3)], 5);
    expect(markings.map((marking) => marking.id)).toEqual(["a0", "b0", "a1", "b1", "b2"]);
    expect(truncated).toBe(false);
  });

  it("handles no groups and a zero maximum", () => {
    expect(limitVectorMarkingGroups([])).toEqual({ markings: [], truncated: false });
    expect(limitVectorMarkingGroups([[], []])).toEqual({ markings: [], truncated: false });
    expect(limitVectorMarkingGroups([group("a", 1)], 0)).toEqual({ markings: [], truncated: true });
  });

  it("defaults to the shared marking cap", () => {
    const { markings, truncated } = limitVectorMarkingGroups([group("a", MAX_VECTOR_MARKINGS), group("b", 1)]);
    expect(markings).toHaveLength(MAX_VECTOR_MARKINGS);
    expect(markings.some((marking) => marking.id === "b0")).toBe(true);
    expect(truncated).toBe(true);
  });
});
