import { describe, expect, it } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry, layerToSvg, type OperationPath, type Point2D } from "../index.js";
import { engravingToSvg } from "./engraving-svg.js";
import { masterToSvg } from "./svg.js";

const square = (r: number): Point2D[] => [{ x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }, { x: -r, y: r }, { x: -r, y: -r }];
const config = { ...DEFAULT_PROJECT, showWaterDepth: false, showRoads: false, showTrails: false, showWater: false, showNorthArrow: false, showScaleBar: false, showAlignmentGuides: false, showElevationLabels: false, optimizeMaterialUse: false };
function artwork() {
  const ir = generateGeometry(config, createSyntheticSource(config, 16));
  const markings: OperationPath[] = [
    { id: "crossing", operation: "engrave", kind: "guide", points: [{ x: -10, y: 0 }, { x: 10, y: 0 }] },
    { id: "water-crossing", operation: "score", kind: "water", points: [{ x: 0, y: -10 }, { x: 0, y: 10 }] },
    { id: "halo", operation: "engrave", kind: "marker", points: square(2), filled: true, knockout: true },
    { id: "solid-marker", operation: "engrave", kind: "marker", points: square(1), filled: true },
  ];
  ir.layers = [{ ...ir.layers[0]!, index: 0, markings, polygons: [{ outer: square(20), holes: [] }] }];
  ir.fabricationNests = [];
  return ir;
}
function data(svg: string, id: string) { return svg.match(new RegExp(`id="${id}"[^>]* d="([^"]*)"`))?.[1]; }

describe("fabrication marker clearances", () => {
  it.each(["layer", "master", "flat"])("exports %s clearances as missing line segments, never white paint or duplicated fill/stroke operations", mode => {
    const ir = artwork();
    const render = () => mode === "layer" ? layerToSvg(ir, ir.layers[0]!) : mode === "master" ? masterToSvg(ir) : engravingToSvg(ir, { ...config, outputMode: "engraving" });
    const svg = render();
    expect(data(svg, "crossing")).toBe("M-10 0 L-2 0 M2 0 L10 0");
    expect(data(svg, "water-crossing")).toBe("M0 -10 L0 -2 M0 2 L0 10");
    expect(svg).not.toContain('id="halo"');
    expect(svg).not.toContain("#ffffff");
    expect(svg).toContain('d="M-1 -1 L1 -1 L1 1 L-1 1 L-1 -1 Z" fill="#2366FF" stroke="none"');
    expect(svg.match(/id="solid-marker"/g)).toHaveLength(1);
    const cuts = [...svg.matchAll(/<path[^>]+stroke="#FE0002"[^>]*\/>/g)].map(match => match[0]);
    ir.layers[0]!.markings = ir.layers[0]!.markings.filter(mark => !mark.knockout);
    const withoutClearance = render();
    expect([...withoutClearance.matchAll(/<path[^>]+stroke="#FE0002"[^>]*\/>/g)].map(match => match[0])).toEqual(cuts);
    expect(data(withoutClearance, "crossing")).toBe("M-10 0 L10 0");
  });

  it.each(["layer", "master", "flat"])("retains marker and clearance holes in %s output", mode => {
    const ir = artwork();
    ir.layers[0]!.markings.find(mark => mark.id === "solid-marker")!.holes = [square(0.5)];
    ir.layers[0]!.markings.find(mark => mark.id === "halo")!.holes = [square(1)];
    const svg = mode === "layer" ? layerToSvg(ir,ir.layers[0]!) : mode === "master" ? masterToSvg(ir) : engravingToSvg(ir,{...config,outputMode:"engraving"});
    expect(data(svg,"solid-marker")?.match(/M/g)).toHaveLength(2);
    expect(svg).toMatch(/id="solid-marker"[^>]*fill-rule="evenodd"/);
    expect(data(svg,"crossing")).toBe("M-10 0 L-2 0 M-1 0 L1 0 M2 0 L10 0");
  });

  it("also removes flat contour segments under a marker", () => {
    const ir = artwork();
    ir.layers.push({ ...ir.layers[0]!, id: "layer-2", index: 1, markings: [], polygons: [{ outer: [{x: -10,y: 0},{x: 10,y: 0},{x: 10,y: 10},{x: -10,y: 0}], holes: [] }] });
    const svg = engravingToSvg(ir, { ...config, outputMode: "engraving" });
    expect(data(svg, "contour-1-0-0")).toMatch(/^M-10 0 L-2 0 M2 0 L10 0/);
  });
});
