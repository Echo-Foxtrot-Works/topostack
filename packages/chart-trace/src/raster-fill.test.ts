import { describe, expect, it } from "vitest";
import type { Point2 } from "./local-frame.ts";
import { fillRings, type GridLayout } from "./raster-fill.ts";

/** A 10x10 grid of unit cells covering x 0..10 and y 0..10, row 0 at the top. */
const layout: GridLayout = { left: 0, top: 10, resolution: 1, width: 10, height: 10 };

const rect = (x0: number, y0: number, x1: number, y1: number): Point2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** The mask as rows of "#" and ".", top row first, for readable failures. */
const picture = (mask: Uint8Array, { width, height }: GridLayout = layout): string[] =>
  Array.from({ length: height }, (_, row) => Array.from(mask.subarray(row * width, (row + 1) * width), (cell) => (cell ? "#" : ".")).join(""));

const count = (mask: Uint8Array) => mask.reduce((sum, cell) => sum + cell, 0);

describe("fillRings", () => {
  it("returns an empty mask the size of the grid for no rings", () => {
    const mask = fillRings([], layout);
    expect(mask).toBeInstanceOf(Uint8Array);
    expect(mask.length).toBe(100);
    expect(count(mask)).toBe(0);
  });

  it("returns an empty mask for an empty grid", () => {
    expect(fillRings([rect(0, 0, 10, 10)], { ...layout, width: 0, height: 0 }).length).toBe(0);
  });

  it("ignores rings without area", () => {
    expect(count(fillRings([[]], layout))).toBe(0);
    expect(count(fillRings([[[5, 5]]], layout))).toBe(0);
    expect(count(fillRings([[[1, 1], [8, 8]]], layout))).toBe(0);
    expect(count(fillRings([[[1, 5], [5, 5], [8, 5]]], layout))).toBe(0);
  });

  it("marks the cells whose centres fall inside, with row 0 at the top", () => {
    // x 2..5, y 6..9: columns 2-4, rows 1-3 counted down from y = 10.
    const mask = fillRings([rect(2, 6, 5, 9)], layout);
    expect(picture(mask)).toEqual([
      "..........",
      "..###.....",
      "..###.....",
      "..###.....",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
    ]);
  });

  it("uses the cell centre test: a ring through centres keeps its low side and drops its high side", () => {
    // Edges at x 1.5 and 4.5 and y 5.5 and 8.5 run through cell centres.
    const mask = fillRings([rect(1.5, 5.5, 4.5, 8.5)], layout);
    expect(picture(mask).slice(0, 5)).toEqual([
      "..........",
      "..........",
      ".###......",
      ".###......",
      ".###......",
    ]);
    expect(count(mask)).toBe(9);
  });

  it("leaves a cell empty when the ring covers most of it but not its centre", () => {
    expect(count(fillRings([rect(0, 0, 0.49, 10)], layout))).toBe(0);
    expect(count(fillRings([rect(0, 0, 0.51, 10)], layout))).toBe(10);
  });

  it("gives the same mask for either winding and for an explicitly closed ring", () => {
    const ring: Point2[] = [
      [1, 1],
      [9, 2],
      [7, 9],
      [2, 6],
    ];
    const expected = fillRings([ring], layout);
    expect(count(expected)).toBeGreaterThan(20);
    expect(fillRings([[...ring].reverse()], layout)).toEqual(expected);
    expect(fillRings([[...ring, ring[0]!]], layout)).toEqual(expected);
  });

  it("treats a second ring inside the first as a hole", () => {
    const mask = fillRings([rect(1, 1, 9, 9), rect(3, 3, 7, 7)], layout);
    expect(picture(mask)).toEqual([
      "..........",
      ".########.",
      ".########.",
      ".##....##.",
      ".##....##.",
      ".##....##.",
      ".##....##.",
      ".########.",
      ".########.",
      "..........",
    ]);
  });

  it("fills an island inside a hole, alternating with each nesting level", () => {
    const mask = fillRings([rect(0, 0, 10, 10), rect(2, 2, 8, 8), rect(4, 4, 6, 6)], layout);
    expect(picture(mask)).toEqual([
      "##########",
      "##########",
      "##......##",
      "##......##",
      "##..##..##",
      "##..##..##",
      "##......##",
      "##......##",
      "##########",
      "##########",
    ]);
  });

  it("does not depend on ring order or orientation for holes", () => {
    const outer = rect(1, 1, 9, 9);
    const hole = rect(3, 3, 7, 7);
    const expected = fillRings([outer, hole], layout);
    expect(fillRings([hole, outer], layout)).toEqual(expected);
    expect(fillRings([outer, [...hole].reverse()], layout)).toEqual(expected);
  });

  it("cancels where two separate rings overlap, under the even-odd rule", () => {
    const mask = fillRings([rect(0, 4, 6, 6), rect(4, 4, 10, 6)], layout);
    expect(picture(mask).slice(4, 6)).toEqual(["####..####", "####..####"]);
  });

  it("fills the whole grid for a ring on its edges", () => {
    expect(count(fillRings([rect(0, 0, 10, 10)], layout))).toBe(100);
  });

  it("clips a ring that runs past the grid without writing outside its rows", () => {
    // Overhangs left, right and bottom; row 0 stays empty.
    const mask = fillRings([rect(-5, -5, 15, 9)], layout);
    expect(mask.length).toBe(100);
    expect(picture(mask)[0]).toBe("..........");
    expect(picture(mask).slice(1).every((row) => row === "##########")).toBe(true);
  });

  it("marks nothing for rings entirely beside the grid", () => {
    expect(count(fillRings([rect(-8, 2, -1, 8)], layout))).toBe(0);
    expect(count(fillRings([rect(11, 2, 20, 8)], layout))).toBe(0);
    expect(count(fillRings([rect(2, 11, 8, 20)], layout))).toBe(0);
    expect(count(fillRings([rect(2, -20, 8, -1)], layout))).toBe(0);
  });

  it("counts a vertex lying exactly on a scanline once", () => {
    // A diamond whose left and right vertices sit on the row 7 centre line (y = 2.5).
    const diamond: Point2[] = [
      [0, 2.5],
      [5, 7.5],
      [10, 2.5],
      [5, -2.5],
    ];
    const rows = picture(fillRings([diamond], layout));
    expect(rows[7]).toBe("##########");
    // A spike that only touches a scanline marks nothing on it.
    const spike: Point2[] = [
      [2, 0],
      [8, 0],
      [5, 2.5],
    ];
    const spikeRows = picture(fillRings([spike], layout));
    expect(spikeRows[7]).toBe("..........");
    expect(spikeRows[9]).not.toBe("..........");
  });

  it("follows the layout's origin and resolution", () => {
    // 4x4 cells of 25 m with the top-left corner at (1000, 5000).
    const metres: GridLayout = { left: 1000, top: 5000, resolution: 25, width: 4, height: 4 };
    const mask = fillRings([rect(1025, 4925, 1075, 4975)], metres);
    expect(picture(mask, metres)).toEqual(["....", ".##.", ".##.", "...."]);
  });

  it("matches a circle's area to within the edge cells", () => {
    const fine: GridLayout = { left: -50, top: 50, resolution: 1, width: 100, height: 100 };
    const circle: Point2[] = Array.from({ length: 360 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 360;
      return [40 * Math.cos(angle), 40 * Math.sin(angle)];
    });
    const filled = count(fillRings([circle], fine));
    expect(Math.abs(filled - Math.PI * 40 * 40)).toBeLessThan(2 * Math.PI * 40 * 0.5);
  });
});
