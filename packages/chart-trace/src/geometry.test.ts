import { describe, expect, it } from "vitest";
import { pathLength, ringArea } from "./geometry.ts";
import type { Point2 } from "./local-frame.ts";

const square: Point2[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

describe("pathLength", () => {
  it("is zero for an empty path or a single point", () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([[3, 7]])).toBe(0);
  });

  it("measures a straight segment with Euclidean distance", () => {
    expect(pathLength([[0, 0], [3, 4]])).toBe(5);
    expect(pathLength([[-1, -1], [-4, -5]])).toBe(5);
  });

  it("sums every segment of a polyline", () => {
    expect(
      pathLength([
        [0, 0],
        [3, 4],
        [3, 10],
        [0, 6],
      ]),
    ).toBe(5 + 6 + 5);
  });

  it("treats the path as open, so a ring is not closed back to its start", () => {
    expect(pathLength(square)).toBe(12);
    expect(pathLength([...square, square[0]!])).toBe(16);
  });

  it("does not count repeated points", () => {
    expect(
      pathLength([
        [0, 0],
        [0, 0],
        [2, 0],
        [2, 0],
      ]),
    ).toBe(2);
  });

  it("is the same in either direction", () => {
    const line: Point2[] = [
      [0, 0],
      [1, 2],
      [5, -1],
      [6, 6],
    ];
    expect(pathLength([...line].reverse())).toBeCloseTo(pathLength(line), 12);
  });
});

describe("ringArea", () => {
  it("gives the same area for an open ring and the same ring closed", () => {
    expect(ringArea(square)).toBe(16);
    expect(ringArea([...square, square[0]!])).toBe(16);
  });

  it("is unsigned, so winding direction does not matter", () => {
    expect(ringArea([...square].reverse())).toBe(16);
    const triangle: Point2[] = [
      [0, 0],
      [6, 0],
      [0, 3],
    ];
    expect(ringArea(triangle)).toBe(9);
    expect(ringArea([...triangle].reverse())).toBe(9);
  });

  it("does not depend on where the ring sits or where it starts", () => {
    const shifted = square.map(([x, y]): Point2 => [x + 1000, y - 250]);
    expect(ringArea(shifted)).toBeCloseTo(16, 9);
    expect(ringArea([...square.slice(2), ...square.slice(0, 2)])).toBe(16);
  });

  it("measures a concave ring", () => {
    // A 4x4 square with a 2x2 notch cut from one corner.
    const ell: Point2[] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ];
    expect(ringArea(ell)).toBe(12);
  });

  it.each<[string, Point2[]]>([
    ["no points", []],
    ["one point", [[2, 3]]],
    ["two points", [[0, 0], [5, 5]]],
    ["collinear points", [[0, 0], [1, 1], [3, 3]]],
    ["a repeated point", [[1, 1], [1, 1], [1, 1]]],
  ])("is zero for a degenerate ring with %s", (_name, ring) => {
    expect(ringArea(ring)).toBe(0);
  });

  it("nets the lobes of a self-crossing ring against each other", () => {
    // A bow-tie: two unit-area triangles wound in opposite directions.
    const bowtie: Point2[] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ];
    expect(ringArea(bowtie)).toBe(0);
  });
});
