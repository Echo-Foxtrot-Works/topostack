import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type LayerIR, type Polygon2D } from "@topostack/core";
import { rampColor, renderContours, renderStack } from "./render";

const square = (half: number): Polygon2D => ({ outer: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }, { x: -half, y: -half }], holes: [] });
const layer = (index: number, half: number): LayerIR => ({ id: `layer-${index}`, index, elevationM: index * 100, materialThicknessMm: 3, polygons: [square(half)], markings: [], pieces: [] });
const model = { widthMm: 300, heightMm: 200, layers: [layer(2, 40), layer(0, 100), layer(1, 70)] };

describe("preview drawing", () => {
  it("stacks sheets from the bottom up, each with an edge and a top face", () => {
    const svg = renderStack(model, { width: 624 });
    expect(svg.match(/<path /g)).toHaveLength(6);
    // The bottom sheet is widest and drawn first.
    const firstFace = /<path d="M([\d.]+) /.exec(svg.split("/>")[1]!)![1];
    expect(Number(firstFace)).toBeCloseTo(312 - 100 * 2, 0);
    // Cropped to the drawing: the bottom face spans ±116 px (100 mm × 2 px/mm × 0.58), plus its edge and the margins.
    const [, top, , height] = /viewBox="0 (-?\d+) (\d+) (\d+)"/.exec(svg)!.map(Number);
    expect(top).toBe(-128);
    expect(height).toBe(262);
    expect(svg).toContain('aria-label="Preview of 3 stacked sheets"');
  });

  it("draws a flat engraving as contour lines with heavier index lines", () => {
    const layers = Array.from({ length: 11 }, (_, index) => layer(index, 100 - index * 8));
    const svg = renderContours({ widthMm: 300, heightMm: 200, layers }, { ...DEFAULT_PROJECT, engravingIndexInterval: 5 });
    expect(svg.match(/<path /g)).toHaveLength(10);
    expect(svg.match(/stroke-opacity="0.95"/g)).toHaveLength(2);
    expect(svg).toContain('aria-label="Preview of 10 engraved contour lines"');
    expect(svg).toContain('<rect x="-150" y="-100" width="300" height="200"/>');
  });

  it("removes clipped crop edges and renders the border only when selected", () => {
    const clipped: Polygon2D = { outer: [{ x: 0, y: -100 }, { x: 150, y: -100 }, { x: 150, y: 100 }, { x: 0, y: 100 }, { x: 0, y: -100 }], holes: [] };
    const ir = { ...model, layers: [layer(0, 100), { ...layer(1, 100), polygons: [clipped] }] };
    const open = renderContours(ir, { ...DEFAULT_PROJECT, showEngravingBorder: false });
    expect(open).toContain('<path d="M0 100L0 -100"');
    expect(open).not.toContain('<rect');
    const empty = renderContours(ir, { ...DEFAULT_PROJECT, showEngravingContours: false, showEngravingBorder: false });
    expect(empty).not.toMatch(/<(path|rect|circle)\b/);
    expect(empty).toContain('aria-label="Preview of 0 engraved contour lines"');
    const circle = renderContours({ ...ir, heightMm: ir.widthMm }, { ...DEFAULT_PROJECT, cropShape: "circle", showEngravingContours: false });
    expect(circle).toContain('<circle r="150"/>');
    expect(circle).not.toContain('<path');
  });

  it("colors low sheets green and the highest pale", () => {
    expect(rampColor(0)).toBe("rgb(96 128 88)");
    expect(rampColor(1)).toBe("rgb(236 234 228)");
    expect(rampColor(-3)).toBe(rampColor(0));
  });

  it("writes only numbers and fixed markup, whatever the geometry holds", () => {
    const svg = renderStack({ ...model, layers: [{ ...layer(0, 50), id: "<script>alert(1)</script>" }] });
    expect(svg).not.toContain("script");
  });
});
