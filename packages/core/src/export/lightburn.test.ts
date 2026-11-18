import { describe, expect, it } from "vitest";
import { buildProjectPackage, DEFAULT_PROJECT, generateGeometry, layerToSvg, type ProjectConfigV1 } from "../index.js";
import { realSource } from "../test-support/sources.js";
import { dashPolyline, LIGHTBURN_LAYERS, parseTransform, svgToLightBurn } from "./lightburn.js";

interface ReadShape { cutIndex: number; points: { x: number; y: number }[]; closed: boolean; depth: number }

/** Reads back what `svgToLightBurn` writes: layers by index, and every path with its group depth. */
function readProject(xml: string | undefined) {
  if (!xml) throw new Error("no project");
  const layers = [...xml.matchAll(/<CutSetting type="(\w+)">\s*<index Value="(\d+)"\/>\s*<name Value="([^"]*)"\/>\s*<priority Value="(\d+)"\/>/g)]
    .map(([, mode, index, name, priority]) => ({ mode, index: Number(index), name, priority: Number(priority) }));
  const shapes: ReadShape[] = [];
  let depth = 0;
  for (const match of xml.matchAll(/<Shape Type="Group">|<\/Children>|<Shape Type="Path" CutIndex="(\d+)">\s*<XForm>[^<]*<\/XForm>\s*<VertList>([^<]*)<\/VertList>\s*<PrimList>([^<]*)<\/PrimList>/g)) {
    if (match[0] === '<Shape Type="Group">') depth += 1;
    else if (match[0] === "</Children>") depth -= 1;
    else {
      const points = [...match[2]!.matchAll(/V(-?[\d.]+) (-?[\d.]+)c0x1c1x1/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
      const prims = [...match[3]!.matchAll(/L(\d+) (\d+)/g)];
      shapes.push({ cutIndex: Number(match[1]), points, closed: prims.length === points.length, depth });
    }
  }
  return { layers, shapes };
}

function bounds(points: { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)),
  };
}

const index = (key: string) => LIGHTBURN_LAYERS.find((layer) => layer.key === key)!.index;

describe("LightBurn projects", () => {
  it("puts a layer SVG's cut, score and engraving on named layers, in running order, at millimetre size", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const layer = result.layers[0]!;
    const svg = layerToSvg(result, layer);
    const { layers, shapes } = readProject(svgToLightBurn(svg));

    expect(layers.map((entry) => entry.name)).toEqual(LIGHTBURN_LAYERS.filter((entry) => layers.some((used) => used.index === entry.index)).map((entry) => entry.name));
    expect(layers.map((entry) => entry.priority)).toEqual(layers.map((_, position) => position));
    expect(layers.at(-1)).toMatchObject({ name: "Cut", mode: "Cut", index: index("cut") });

    // Every CUT path in the SVG is one closed LightBurn path on the cut layer.
    const cutGroup = svg.slice(svg.indexOf('data-operation="CUT"'));
    const cutPaths = [...cutGroup.matchAll(/<path[^>]* d="([^"]+)"/g)];
    const cuts = shapes.filter((shape) => shape.cutIndex === index("cut"));
    expect(cuts).toHaveLength(cutPaths.length);
    expect(cuts.every((shape) => shape.closed)).toBe(true);

    // The kerf-offset outline fills the centred 300.15 × 200.15 mm canvas, which lands with its lower-left corner at the origin.
    const outline = bounds(cuts.flatMap((shape) => shape.points));
    expect(outline.minX).toBeCloseTo(0, 3);
    expect(outline.minY).toBeCloseTo(0, 3);
    expect(outline.maxX).toBeCloseTo(300.15, 3);
    expect(outline.maxY).toBeCloseTo(200.15, 3);
  });

  it("flips Y so the artwork reads the same way up as the SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><g data-operation="ENGRAVE" fill="none" stroke="#2366FF"><path d="M10 5 L90 5"/></g></svg>`;
    const [line] = readProject(svgToLightBurn(svg)).shapes;
    // 5 mm below the SVG's top edge is 45 mm above LightBurn's bottom edge.
    expect(line!.points).toEqual([{ x: 10, y: 45 }, { x: 90, y: 45 }]);
    expect(line!.closed).toBe(false);
    expect(line!.cutIndex).toBe(index("engrave"));
  });

  it("separates SCORE from ENGRAVE although both are blue, and fills from lines", () => {
    const svg = `<svg width="20mm" height="20mm" viewBox="0 0 20 20">
      <g id="ENGRAVE" data-operation="ENGRAVE" fill="none" stroke="#2366FF"><path d="M1 1 L2 2"/><path d="M3 3 L4 3 L4 4 Z" fill="#2366FF" stroke="none"/></g>
      <g id="ASSEMBLY" data-operation="ENGRAVE" fill="none" stroke="#00A651"><path d="M5 5 L6 6"/></g>
      <g id="SCORE" data-operation="SCORE" fill="none" stroke="#2366FF"><path d="M7 7 L8 8"/></g>
      <g id="CUT" data-operation="CUT" fill="none" stroke="#FE0002"><rect x="0" y="0" width="20" height="20"/></g>
    </svg>`;
    const { layers, shapes } = readProject(svgToLightBurn(svg));
    expect(layers.map((layer) => layer.name)).toEqual(["Engrave fill", "Engrave lines", "Assembly ids", "Score", "Cut"]);
    expect(layers.find((layer) => layer.name === "Engrave fill")!.mode).toBe("Scan");
    expect(shapes.map((shape) => shape.cutIndex)).toEqual([index("engrave"), index("engrave-fill"), index("assembly"), index("score"), index("cut")]);
    expect(shapes.at(-1)!.points).toHaveLength(4);
  });

  it("keeps placed panels and nested parts as LightBurn groups, with transforms applied", () => {
    const svg = `<svg width="100mm" height="100mm" viewBox="0 0 100 100"><g data-operation="CUT" fill="none" stroke="#FE0002">
      <g transform="translate(10 20)"><path d="M0 0 L10 0 L10 10 Z"/><path d="M1 1 L2 1 L2 2 Z"/></g>
      <g transform="matrix(0 1 -1 0 50 50)"><path d="M0 0 L10 0 L10 10 Z"/><path d="M1 1 L2 1 L2 2 Z"/></g>
    </g></svg>`;
    const { shapes } = readProject(svgToLightBurn(svg));
    expect(shapes.map((shape) => shape.depth)).toEqual([1, 1, 1, 1]);
    expect(shapes[0]!.points).toEqual([{ x: 10, y: 80 }, { x: 20, y: 80 }, { x: 20, y: 70 }]);
    // Rotated 90°: (10, 0) → (50, 60) in SVG, so y 40 in LightBurn.
    expect(shapes[2]!.points[1]).toEqual({ x: 50, y: 40 });
  });

  it("draws dash patterns as separate dashes, since LightBurn ignores stroke-dasharray", () => {
    const svg = `<svg width="20mm" height="10mm" viewBox="0 0 20 10"><g data-operation="ENGRAVE" fill="none" stroke="#2366FF" stroke-dasharray="2 3"><path d="M0 5 L12 5"/></g></svg>`;
    const { shapes } = readProject(svgToLightBurn(svg));
    expect(shapes.map((shape) => [shape.points[0]!.x, shape.points.at(-1)!.x])).toEqual([[0, 2], [5, 7], [10, 12]]);
  });

  it("splits dashes across corners and closes closed rings", () => {
    const dashes = dashPolyline({ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], closed: true }, [5, 1]);
    expect(dashes[0]!.points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }]);
    expect(dashes.reduce((sum, dash) => sum + dash.points.length, 0)).toBeGreaterThan(4);
    expect(dashes.at(-1)!.points.at(-1)).toEqual({ x: 0, y: 0 });
    expect(dashPolyline({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: false }, [0, 0])).toHaveLength(1);
    expect(dashPolyline({ points: [{ x: 0, y: 0 }, { x: 3, y: 0 }], closed: false }, [0, 1])).toEqual([]);
  });

  it("reads SVG transform lists", () => {
    expect(parseTransform("translate(3,4) scale(2)")).toEqual([2, 0, 0, 2, 3, 4]);
    const [a, b, c, d, e, f] = parseTransform("rotate(90 10 10)");
    expect([a, b, c, d, e, f].map((value) => Math.round(value))).toEqual([0, 1, -1, 0, 20, 0]);
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("turns circles into closed paths and skips hidden or metadata elements", () => {
    const svg = `<svg width="40mm" height="40mm" viewBox="-20 -20 40 40"><title>t</title><desc>d</desc><defs><path d="M0 0 L1 1" stroke="#2366FF"/></defs>
      <g data-operation="ENGRAVE" fill="none" stroke="#2366FF"><circle cx="0" cy="0" r="10"/><path display="none" d="M0 0 L5 5"/><path stroke="none" d="M0 0 L5 5"/></g></svg>`;
    const { shapes } = readProject(svgToLightBurn(svg));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.closed).toBe(true);
    expect(shapes[0]!.points.every((point) => Math.abs(Math.hypot(point.x - 20, point.y - 20) - 10) < 1e-3)).toBe(true);
  });

  it("reads line, polyline and polygon elements, and sizes from inches or a missing viewBox", () => {
    const inches = `<svg width="1in" height="1in" viewBox="0 0 100 100"><g data-operation="SCORE" fill="none" stroke="#2366FF">
      <line x1="0" y1="0" x2="100" y2="0"/><polyline points="0,50 50,50 50,100"/><polygon points="10 10 20 10 20 20"/><path visibility="hidden" d="M0 0 L9 9"/></g></svg>`;
    const { layers, shapes } = readProject(svgToLightBurn(inches));
    expect(layers.map((layer) => layer.name)).toEqual(["Score"]);
    expect(shapes.map((shape) => shape.closed)).toEqual([false, false, true]);
    // 100 user units across one inch: the line along the top edge is 25.4 mm long, 25.4 mm up.
    expect(shapes[0]!.points).toEqual([{ x: 0, y: 25.4 }, { x: 25.4, y: 25.4 }]);
    const unscaled = readProject(svgToLightBurn(`<svg width="10mm" height="10mm"><path d="M0 0 L10 0" stroke="#FE0002" fill="none"/></svg>`));
    expect(unscaled.layers.map((layer) => layer.name)).toEqual(["Cut"]);
    expect(unscaled.shapes[0]!.points).toEqual([{ x: 0, y: 10 }, { x: 10, y: 10 }]);
  });

  it("writes notes LightBurn shows on open, and nothing for an SVG with nothing to run", () => {
    const xml = svgToLightBurn(`<svg width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0 L1 1" stroke="#FE0002" fill="none"/></svg>`, { notes: "Line one\nA & B" });
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<LightBurnProject /);
    expect(xml).toContain('<Notes ShowOnLoad="1" Notes="Line one&#10;A &amp; B&#10;Made with TopoStack');
    expect(xml).toContain('<kerf Value="0"/>');
    expect(svgToLightBurn(`<svg width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0 L1 1" fill="none" stroke="none"/></svg>`)).toBeUndefined();
  });

  it("converts every artwork SVG of a flat engraving package", async () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving", showEngravingBorder: true, cropShape: "circle" };
    const output = buildProjectPackage(generateGeometry(project, realSource(project)), project);
    const { layers, shapes } = readProject(svgToLightBurn(await output.master.blob.text()));
    expect(layers.map((layer) => layer.name)).toContain("Engrave lines");
    expect(shapes.length).toBeGreaterThan(10);
  });
});
