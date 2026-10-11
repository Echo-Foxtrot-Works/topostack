import { describe, expect, it } from "vitest";
import { clipPolygons } from "../primitives/offset.js";
import { signedArea } from "../primitives/geometry2d.js";
import { partitionAirspace } from "./airspace-partition.js";
import { square } from "../test-support/airspace.js";
import type { AirspaceLevelIR, AirspaceSectorIR, AirspaceTint, Polygon2D } from "../types.js";

const sector = (id: string, aviationClass: AirspaceSectorIR["aviationClass"]): AirspaceSectorIR => ({ id, aviationClass, name: id, floor: { ref: "sfc", ft: 0 }, ceiling: { ref: "msl", ft: 6000 }, ceilingCapped: false });
const level = (index: number, zMm: number, id: string, tint: AirspaceTint, outer: ReturnType<typeof square>): AirspaceLevelIR => ({ index, zMm, altitudeFt: zMm * 100, mergedFt: [], pieces: [{ id: `A${index + 1}-1`, tint, sectorIds: [id], polygons: [{ outer, holes: [] }] }] });
const area = (polygons: Polygon2D[]) => polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0), 0);

describe("airspace overlap partition", () => {
  it("keeps union area, disjoint tints and source ownership for partial overlaps", () => {
    const input = [level(0, 20, "blue", "blue", square(-70, -30, 20, 30)), level(1, 20, "magenta", "magenta", square(-20, -30, 70, 30))];
    const expected = area(clipPolygons(input.flatMap((level) => level.pieces.flatMap((piece) => piece.polygons)), [], "union"));
    const result = partitionAirspace(input, [sector("blue", "class-b"), sector("magenta", "class-c")], 3, 0.8);
    const pieces = result.levels.flatMap((level) => level.pieces);
    expect(area(pieces.flatMap((piece) => piece.polygons))).toBeCloseTo(expected, 3);
    expect(area(clipPolygons(pieces[0]!.polygons, pieces[1]!.polygons, "intersection"))).toBe(0);
    expect(pieces[0]!.sectorIds).toEqual(["blue", "magenta"]);
    expect(pieces[1]!.sectorIds).toEqual(["magenta"]);
  });

  it("carves slabs around an off-grid Class D lid without changing heights", () => {
    const input = [level(0, 20, "solid", "blue", square(-60, -60, 60, 60)), level(1, 21, "lid", "blue", square(-25, -25, 25, 25)), level(2, 23, "solid", "blue", square(-60, -60, 60, 60))];
    const result = partitionAirspace(input, [sector("solid", "class-b"), sector("lid", "class-d")], 3, 0.8);
    expect(result.levels.map((level) => level.zMm)).toEqual([20, 21, 23]);
    const lid = result.levels[1]!.pieces[0]!;
    expect(lid.sectorIds).toEqual(["lid", "solid"]);
    for (const other of [result.levels[0]!, result.levels[2]!]) expect(area(clipPolygons(lid.polygons, other.pieces.flatMap((piece) => piece.polygons), "intersection"))).toBe(0);
  });

  it("allows face contact and does not transfer ownership between touching sheets", () => {
    const result = partitionAirspace([level(0, 20, "one", "blue", square(-50, -50, 50, 50)), level(1, 23, "two", "magenta", square(-50, -50, 50, 50))], [sector("one", "class-b"), sector("two", "class-c")], 3, 0.8);
    expect(result.levels.map((level) => level.pieces[0]!.sectorIds)).toEqual([["one"], ["two"]]);
  });
});
