import { describe, expect, it } from "vitest";
import { buildProjectPackage, DEFAULT_PROJECT, generateGeometry, parseProject, layerToSvg, placedGraphicPlacementAt, projectFingerprint, validateProject, type CustomGraphicV1, type PlacedGraphicV1, type Polygon2D, type ProjectConfigV1 } from "../index.js";
import { gridSource } from "../test-support/sources.js";
import { operationBody } from "../test-support/svg.js";

// A square with a square window: the window becomes an island when cut.
const graphic: CustomGraphicV1 = {
  id: "graphic-0001",
  name: "Frame",
  shapes: [{ outer: [-500, -500, 500, -500, 500, 500, -500, 500], holes: [[-200, -200, -200, 200, 200, 200, 200, -200]] }],
};
const placed = (overrides: Partial<PlacedGraphicV1> = {}): PlacedGraphicV1 => ({
  id: "placed-0001",
  graphicId: graphic.id,
  placement: { anchor: "center", offset: { x: 0, y: 0 } },
  sizeMm: 12,
  rotationDeg: 0,
  operation: "engrave",
  ...overrides,
});

const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, cropShape: "rectangle", widthMm: 160, heightMm: 160, optimizeMaterialUse: false, showNorthArrow: false, showScaleBar: false, showElevationLabels: false };
// A cone: the top sheet is a small disc around the summit, and only the bottom sheet is exposed at the corners.
const source = gridSource(base, 64, (nx, ny) => 1000 - 900 * Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2));
const plain = generateGeometry(base, source);
const topIndex = plain.layers.length - 1;
const summit = (() => {
  const points = plain.layers[topIndex]!.polygons.flatMap(({ outer }) => outer);
  const xs = points.map(({ x }) => x); const ys = points.map(({ y }) => y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
})();
const onSummit = { customGraphics: [graphic], placedGraphics: [placed()] };
const summitPlacement = placedGraphicPlacementAt({ ...base, ...onSummit }, placed(), summit);

function areaOf(polygons: Polygon2D[]): number {
  const ring = (points: Polygon2D["outer"]) => Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  return polygons.reduce((sum, { outer, holes }) => sum + ring(outer) - holes.reduce((total, hole) => total + ring(hole), 0), 0);
}

function withGraphic(overrides: Partial<PlacedGraphicV1> = {}, project = base): ProjectConfigV1 {
  return { ...project, customGraphics: [graphic], placedGraphics: [placed({ placement: summitPlacement, ...overrides })] };
}

describe("placed graphics in generation", () => {
  it("leaves a project without graphics exactly as it was", () => {
    const withEmptyLibrary: ProjectConfigV1 = { ...base, customGraphics: undefined, placedGraphics: undefined };
    expect(projectFingerprint(withEmptyLibrary)).toBe(projectFingerprint(base));
    const { generatedAt: _a, ...emptyLibrary } = generateGeometry(withEmptyLibrary, source);
    const { generatedAt: _b, ...unchanged } = plain;
    expect(emptyLibrary).toEqual(unchanged);
  });

  it("engraves a graphic onto the exposed sheet over a material-colored halo", () => {
    const result = generateGeometry(withGraphic(), source);
    const top = result.layers.at(-1)!;
    const markings = top.markings.filter(({ id }) => id.startsWith("graphic-placed-0001-"));
    expect(markings.some(({ knockout }) => knockout)).toBe(true);
    const fill = markings.find(({ knockout }) => !knockout)!;
    expect(fill).toMatchObject({ operation: "engrave", kind: "marker", filled: true });
    expect(fill.holes).toHaveLength(1);
    // Nothing lands on the covered sheets below.
    expect(result.layers.slice(0, -1).flatMap(({ markings }) => markings).some(({ id }) => id.startsWith("graphic-"))).toBe(false);
  });

  it("scores a graphic's outlines", () => {
    const result = generateGeometry(withGraphic({ operation: "score" }), source);
    const scored = result.layers.flatMap(({ markings }) => markings).filter(({ id }) => id.startsWith("graphic-"));
    expect(scored.length).toBeGreaterThanOrEqual(2);
    expect(scored.every(({ operation, filled }) => operation === "score" && !filled)).toBe(true);
  });

  it("cuts a graphic out of exactly the exposed sheet", () => {
    const cut = generateGeometry(withGraphic({ operation: "cut" }), source);
    // 12 mm square less its 4.8 mm window.
    expect(areaOf(plain.layers[topIndex]!.polygons) - areaOf(cut.layers[topIndex]!.polygons)).toBeCloseTo(12 * 12 - 4.8 * 4.8, 0);
    // The window survives as its own piece, glued to the sheet below.
    expect(cut.layers[topIndex]!.polygons.length).toBe(plain.layers[topIndex]!.polygons.length + 1);
    plain.layers.slice(0, topIndex).forEach((layer, index) => expect(cut.layers[index]!.polygons).toEqual(layer.polygons));
    expect(cut.warnings.some(({ code }) => code === "GRAPHIC_LOOSE_PIECES")).toBe(false);
    expect(cut.layers.flatMap(({ markings }) => markings).some(({ id }) => id.startsWith("graphic-"))).toBe(false);
    // The opening and its island are cut lines on that sheet's panel.
    const cutPaths = (svg: string) => (operationBody(svg, "CUT").match(/<path /g) ?? []).length;
    expect(cutPaths(layerToSvg(cut, cut.layers[topIndex]!))).toBeGreaterThan(cutPaths(layerToSvg(plain, plain.layers[topIndex]!)));
  });

  it("scores and engraves onto the SVG's own operation groups", () => {
    const scored = generateGeometry(withGraphic({ operation: "score" }), source);
    expect(operationBody(layerToSvg(scored, scored.layers[topIndex]!), "SCORE")).toContain('id="graphic-placed-0001-score-');
    const engraved = generateGeometry(withGraphic(), source);
    expect(operationBody(layerToSvg(engraved, engraved.layers[topIndex]!), "ENGRAVE")).toContain('id="graphic-placed-0001-0-');
  });

  it("warns when a cut through the bottom sheet leaves islands with nothing under them", () => {
    const corner = generateGeometry(withGraphic({ operation: "cut", placement: { anchor: "top-left", offset: { x: 0, y: 0 } } }), source);
    expect(corner.warnings.some(({ code }) => code === "GRAPHIC_LOOSE_PIECES")).toBe(true);
  });

  it("keeps a legacy flat cut graphic as outlined engraving in the downloaded file", async () => {
    const legacy = withGraphic({ operation: "cut" }, { ...base, outputMode: "engraving" });
    const migrated = parseProject(legacy);
    expect(migrated.placedGraphics![0]!.operation).toBe("score");
    for (const settings of [legacy, migrated]) {
      const ir = generateGeometry(settings, source);
      expect(ir.layers[0]!.polygons[0]!.holes).toEqual([]);
      expect(ir.warnings.some(({ code }) => code === "GRAPHIC_LOOSE_PIECES")).toBe(false);
      const svg = await buildProjectPackage(ir, settings).master.blob.text();
      expect(svg).toContain("graphic-placed-0001-score-");
      expect(svg).not.toContain('data-operation="CUT"');
    }
  });

  it("omits a graphic too large for the material with a warning", () => {
    const result = generateGeometry(withGraphic({ sizeMm: 300 }), source);
    expect(result.layers.flatMap(({ markings }) => markings).some(({ id }) => id.startsWith("graphic-"))).toBe(false);
    expect(result.warnings.some(({ code, message }) => code === "LABEL_OMITTED" && /Graphic 1/.test(message))).toBe(true);
  });

  it("validates graphics and their placements", () => {
    expect(() => validateProject(withGraphic())).not.toThrow();
    expect(() => validateProject({ ...withGraphic(), customGraphics: [] })).toThrow(/custom graphics/i);
    expect(() => validateProject(withGraphic({ rotationDeg: 360 }))).toThrow(/rotation/i);
    expect(() => validateProject(withGraphic({ sizeMm: 1 }))).toThrow(/graphic size/i);
    expect(() => validateProject(withGraphic({ operation: "etch" as never }))).toThrow(/operation/i);
    expect(() => validateProject(withGraphic({ placement: { anchor: "center", offset: { x: 2, y: 0 } } }))).toThrow(/offsets/i);
    expect(() => validateProject({ ...withGraphic(), customGraphics: [graphic, graphic] })).toThrow(/unique/i);
    expect(() => validateProject({ ...withGraphic(), placedGraphics: [placed(), placed()] })).toThrow(/unique/i);
    const huge = { ...graphic, shapes: [{ outer: Array.from({ length: 6002 }, (_, index) => (index % 2 ? Math.round(400 * Math.sin(index)) : Math.round(400 * Math.cos(index)))) }] };
    expect(() => validateProject({ ...withGraphic(), customGraphics: [huge] })).toThrow(/3000 points/i);
    // Renaming artwork is bookkeeping, not design.
    expect(projectFingerprint({ ...withGraphic(), customGraphics: [{ ...graphic, name: "Renamed" }] })).toBe(projectFingerprint(withGraphic()));
  });
});
