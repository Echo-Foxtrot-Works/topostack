import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRegisteredFonts, registerFont, type FontGlyphsV1 } from "../annotate/font-data.js";
import { HIDDEN_LABEL_CLEARANCE_MM, indexLabelLayer } from "../annotate/label-placement.js";
import { labelDimensions, labelInkExtent } from "../annotate/labels.js";
import { generateGeometry } from "./generate.js";
import { preparePolygons } from "../primitives/geometry2d.js";
import { gridSource, pointInRing, scaledForLayers } from "../test-support/sources.js";
import { DEFAULT_PROJECT, type LayerIR, type OperationPath, type Point2D, type Polygon2D, type ProjectConfigV1 } from "../types.js";
import { gluedLabelPoint, hiddenLabelMarking, hiddenMarkIssues } from "./hidden-marks.js";

const config = DEFAULT_PROJECT;
const label = "L03-B2";
const { width, height } = labelDimensions(label, config.textStyle);

function rect(minX: number, minY: number, maxX: number, maxY: number): Polygon2D {
  return { outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] };
}

/** The label box's corners for a placed origin. */
function corners(origin: Point2D): Point2D[] {
  return [origin, { x: origin.x + width, y: origin.y }, { x: origin.x, y: origin.y + height }, { x: origin.x + width, y: origin.y + height }];
}

const inside = (origin: Point2D, polygon: Polygon2D) => corners(origin).every((corner) => pointInRing(corner, polygon.outer));

describe("glued piece labels", () => {
  const piece = rect(-100, -60, 100, 60);
  const place = (covering: Polygon2D[], markings: OperationPath[] = []) =>
    gluedLabelPoint(label, config, indexLabelLayer([piece], markings), piece, preparePolygons(covering));

  it("places nothing on a piece with nothing stacked above it", () => {
    expect(place([])).toBeUndefined();
  });

  it("places nothing when the layer above is elsewhere or too narrow to hide the id", () => {
    expect(place([rect(150, 70, 200, 120)])).toBeUndefined();
    expect(place([rect(-1, -1, 1, 1)])).toBeUndefined();
  });

  it("hides the id under the part of the layer above that overlaps the piece", () => {
    // The upper layer overhangs the piece's corner; only the overlap is both material and hidden.
    const cover = rect(60, 20, 180, 140);
    const origin = place([cover])!;
    expect(origin).toBeDefined();
    expect(inside(origin, rect(60, 20, 100, 60))).toBe(true);
  });

  it("prefers the largest covered region over a smaller one that also fits", () => {
    const small = rect(-95, -55, -60, -35);
    const large = rect(20, -20, 90, 50);
    const origin = place([small, large])!;
    expect(inside(origin, large)).toBe(true);
  });

  it("finds room off-centre when markings occupy the middle of the covered region", () => {
    const cover = rect(-80, -40, 80, 40);
    const across: OperationPath = { id: "road", operation: "engrave", kind: "road", points: [{ x: -80, y: 0 }, { x: 80, y: 0 }] };
    const down: OperationPath = { id: "trail", operation: "engrave", kind: "trail", points: [{ x: 0, y: -40 }, { x: 0, y: 40 }] };
    const origin = place([cover], [across, down])!;
    expect(inside(origin, cover)).toBe(true);
    const box = { minX: origin.x, maxX: origin.x + width, minY: origin.y, maxY: origin.y + height };
    expect(box.minY > 0 || box.maxY < 0).toBe(true);
    expect(box.minX > 0 || box.maxX < 0).toBe(true);
  });

  it("returns nothing when the only covered room is fully blocked", () => {
    const cover = rect(-20, -6, 20, 6);
    const blocked: OperationPath = { id: "road", operation: "engrave", kind: "road", points: [{ x: -20, y: 0 }, { x: 20, y: 0 }] };
    expect(place([cover])).toBeDefined();
    expect(place([cover], [blocked])).toBeUndefined();
  });
});

function sheet(index: number, polygons: Polygon2D[], markings: OperationPath[] = []): LayerIR {
  return { id: `layer-${index + 1}`, index, elevationM: index * 100, materialThicknessMm: 3, polygons, markings, pieces: [] };
}

describe("glue area", () => {
  const piece = rect(-100, -60, 100, 60);

  it("never hides an id under the seam between two pieces of the sheet above", () => {
    // Together the two pieces above are wide enough for the id; neither is alone.
    const halfWidth = (labelInkExtent(label, config.textStyle).maxX + 2 * HIDDEN_LABEL_CLEARANCE_MM) / 2 + 1;
    const twoPieces = [rect(-halfWidth, -8, 0, 8), rect(0, -8, halfWidth, 8)];
    expect(gluedLabelPoint(label, config, indexLabelLayer([piece], []), piece, preparePolygons(twoPieces))).toBeUndefined();
    expect(gluedLabelPoint(label, config, indexLabelLayer([piece], []), piece, preparePolygons([rect(-halfWidth, -8, halfWidth, 8)]))).toBeDefined();
  });

  it("reports an id whose ink reaches past the sheet above, and one on the top sheet", () => {
    const cover = rect(-40, -10, 40, 10);
    const mark = (y: number) => hiddenLabelMarking("piece-L01-label", label, { x: -5, y }, config);
    const hidden = { layers: [sheet(0, [piece], [mark(-2)]), sheet(1, [cover])], lineStyle: config.lineStyle };
    expect(hiddenMarkIssues(hidden)).toEqual([]);
    const straddling = { layers: [sheet(0, [piece], [mark(9)]), sheet(1, [cover])], lineStyle: config.lineStyle };
    const [issue] = hiddenMarkIssues(straddling);
    expect(issue).toMatchObject({ layerIndex: 0, markingId: "piece-L01-label", label });
    expect(issue!.clearanceMm).toBeLessThan(0);
    expect(hiddenMarkIssues({ layers: [sheet(0, [piece], [mark(-2)])], lineStyle: config.lineStyle })).toHaveLength(1);
  });
});

/**
 * A typeface whose every glyph reaches past its advance box: 1 mm left of the
 * origin, 2.5 mm above the cap line and 0.5 mm past the last advance at 7 mm.
 */
const OVERHANGING: FontGlyphsV1 = {
  version: 1, id: "lora", kind: "outline", unitsPerEm: 1000, capHeight: 700, descender: -200,
  glyphs: { "?": [500, "M-100 -150L-100 950L550 950L550 -150Z"] }, kerning: {},
};

describe("hidden labels in a typeface that overhangs its box", () => {
  beforeEach(() => registerFont(OVERHANGING));
  afterEach(clearRegisteredFonts);
  const style = { font: "lora" as const, sizeMm: 7 };
  const project = { ...config, textStyle: style };
  const piece = rect(-100, -60, 100, 60);
  const place = (cover: Polygon2D) => gluedLabelPoint("L03", project, indexLabelLayer([piece], []), piece, preparePolygons([cover]));

  it("measures the ink, not the advance box", () => {
    expect(labelDimensions("L03", style)).toEqual({ width: 15, height: 9 });
    const ink = labelInkExtent("L03", style);
    expect(ink.minX).toBeCloseTo(-1, 9);
    expect(ink.minY).toBeCloseTo(-2.5, 9);
    expect(ink.maxX).toBeCloseTo(15.5, 9);
    expect(ink.maxY).toBeCloseTo(9, 9);
  });

  it("refuses a strip that holds the box but not the glyphs, and keeps the clearance in one that does", () => {
    const ink = labelInkExtent("L03", style);
    const needed = ink.maxY - ink.minY + 2 * HIDDEN_LABEL_CLEARANCE_MM;
    // Tall enough for the advance box and the clearance, as placement used to measure it.
    expect(place(rect(-40, -(needed - 0.6) / 2, 40, (needed - 0.6) / 2))).toBeUndefined();
    const cover = rect(-40, -(needed + 0.2) / 2, 40, (needed + 0.2) / 2);
    const point = place(cover)!;
    expect(point).toBeDefined();
    const ir = { layers: [sheet(0, [piece], [hiddenLabelMarking("piece-L01-label", "L03", point, project)]), sheet(1, [cover])], lineStyle: project.lineStyle };
    expect(hiddenMarkIssues(ir, HIDDEN_LABEL_CLEARANCE_MM - 1e-6)).toEqual([]);
  });
});

describe("hidden marks in generated stacks", () => {
  const ridges = (project: ProjectConfigV1) => gridSource(project, 96, (x, y) => 600 + 400 * Math.sin(3 * x + 1.3 * y) * Math.cos(2.2 * y - x) + 150 * x);
  const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, widthMm: 240, heightMm: 180, showWater: false, showWaterDepth: false, showRoads: false, showTrails: false, showNorthArrow: false, showScaleBar: false, showElevationLabels: false };

  it.each([
    ["split and nested", { workAreaWidthMm: 130, workAreaHeightMm: 110, optimizeMaterialUse: true }],
    ["no kerf and a wide line", { laserKerfMm: 0, lineStyle: { ...DEFAULT_PROJECT.lineStyle, annotationMm: 1 }, textStyle: { ...DEFAULT_PROJECT.textStyle, sizeMm: 8 } }],
  ] as Array<[string, Partial<ProjectConfigV1>]>)("keeps every outline and id inside its glue area when %s", (_, patch) => {
    const [project, source] = scaledForLayers({ ...base, ...patch }, ridges({ ...base, ...patch }), 9);
    const ir = generateGeometry(project, source);
    const labels = ir.layers.flatMap((layer) => layer.markings).filter((marking) => marking.label && (marking.id.startsWith("alignment-") || marking.id.startsWith("piece-")));
    expect(labels.length).toBeGreaterThan(10);
    expect(hiddenMarkIssues(ir).map((i) => `${i.markingId} ${i.clearanceMm.toFixed(3)}`)).toEqual([]);
    expect(hiddenMarkIssues(ir, HIDDEN_LABEL_CLEARANCE_MM - 1e-3).filter((issue) => issue.label)).toEqual([]);
  });
});
