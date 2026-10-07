import { describe, expect, it } from "vitest";
import type { OperationPath, Point2D } from "../types.js";
import { markingsWithin } from "./marking-clip.js";

const square = (minX: number, minY: number, maxX: number, maxY: number): Point2D[] => [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
const window = [{ outer: square(0, 0, 20, 20), holes: [] }];
const road: OperationPath = { id: "road", operation: "engrave", kind: "road", points: [{ x: -10, y: 10 }, { x: 30, y: 10 }] };
const farLabel: OperationPath = { id: "far", operation: "engrave", kind: "label", points: [{ x: 200, y: 200 }], label: "FAR" };
const nearLabel: OperationPath = { id: "near", operation: "engrave", kind: "label", points: [{ x: 18, y: 10 }], label: "SHORE" };

describe("markingsWithin", () => {
  it("splits a mark the edge crosses between the two sides", () => {
    const inside = markingsWithin([road], window, "inside");
    const outside = markingsWithin([road], window, "outside");
    expect(inside.flatMap((mark) => mark.points.map((point) => point.x))).toEqual([0, 20]);
    expect(outside).toHaveLength(2);
    expect(outside.every((mark) => mark.points.every((point) => point.x <= 0 || point.x >= 20))).toBe(true);
  });

  it("keeps a mark far from every polygon whole on the outside and drops it inside", () => {
    expect(markingsWithin([farLabel], window, "outside")).toEqual([farLabel]);
    expect(markingsWithin([farLabel], window, "inside")).toEqual([]);
  });

  it("explodes a label the edge cuts into its strokes on both sides", () => {
    const inside = markingsWithin([nearLabel], window, "inside");
    const outside = markingsWithin([nearLabel], window, "outside");
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    expect([...inside, ...outside].every((mark) => mark.label === undefined)).toBe(true);
  });
});
