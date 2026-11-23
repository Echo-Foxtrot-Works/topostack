import { describe, expect, it } from "vitest";
import type { OperationPath, Point2D } from "../types.js";
import { registerFont } from "../annotate/font-data.js";
import { signedArea } from "../primitives/geometry2d.js";
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

  it.each(["marker", "glyph"])("partitions a %s enclosing an opening into complementary filled areas", (kind) => {
    registerFont({ version: 1, id: "jost", kind: "outline", unitsPerEm: 16, capHeight: 16, descender: 0, kerning: {}, glyphs: { "?": [16, "M0 0L16 0L16 16L0 16Z"] } });
    const mark: OperationPath = kind === "marker"
      ? { id: "marker", operation: "engrave", kind: "marker", filled: true, points: square(-8, -8, 8, 8) }
      : { id: "glyph", operation: "engrave", kind: "label", points: [{ x: -8, y: -8 }], label: "?", textStyle: { sizeMm: 16, font: "jost" } };
    const opening = [{ outer: square(-2, -2, 2, 2), holes: [] }];
    const [wood] = markingsWithin([mark], opening, "outside");
    const [acrylic] = markingsWithin([mark], opening, "inside");
    expect(wood?.filled).toBe(true);
    expect(wood?.holes).toHaveLength(1);
    expect(signedArea(wood!.points) + signedArea(wood!.holes![0]!)).toBe(240);
    expect(signedArea(acrylic!.points)).toBe(16);
  });

  it("clips a glyph stroke that crosses an opening with both endpoints on wood", () => {
    registerFont({ version: 1, id: "hershey-sans", kind: "single-line", unitsPerEm: 16, capHeight: 16, descender: 0, kerning: {}, glyphs: { "?": [16, "M0 8L16 8"] } });
    const glyph: OperationPath = { id: "line", kind: "label", operation: "engrave", label: "?", points: [{ x: -8, y: -8 }], textStyle: { font: "hershey-sans", sizeMm: 16 } };
    const clipped = markingsWithin([glyph], [{ outer: square(-2, -2, 2, 2), holes: [] }], "outside");
    expect(clipped.map((mark) => mark.points.map(({ x }) => x))).toEqual([[-8, -2], [2, 8]]);
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
