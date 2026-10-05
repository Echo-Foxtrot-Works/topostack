import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT,
  FONT_CATALOG,
  TEXT_FONTS,
  clearRegisteredFonts,
  decodeFontGlyphs,
  generateGeometry,
  isFontLoaded,
  labelDimensions,
  labelLineSegments,
  labelPathData,
  labelSvgPaths,
  layerToSvg,
  plaqueMarkings,
  projectFingerprint,
  projectFonts,
  unsupportedLabelCharacters,
  validateProject,
  type ProjectConfigV1,
} from "../index.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { masterToSvg } from "../export/svg.js";
import { FontNotLoadedError } from "./font-data.js";
import { labelGeometry } from "./labels.js";
import { plaqueLines } from "./plaque.js";
import { fabricationLabel } from "../pipeline/transportation.js";
import { OUTLINE_FIXTURE, registerFixtureFonts } from "../test-support/fonts.js";
import { realSource } from "../test-support/sources.js";

const singleLine = { font: "hershey-sans" as const, sizeMm: 7 };
const outline = { font: "jost" as const, sizeMm: 7 };
const origin = { x: 0, y: 0 };

describe("typeface fonts", () => {
  beforeEach(registerFixtureFonts);
  afterEach(clearRegisteredFonts);

  it("catalogs every project font exactly once", () => {
    expect(FONT_CATALOG.map((entry) => entry.id)).toEqual([...TEXT_FONTS]);
  });

  it("validates glyph data before it is registered", () => {
    expect(decodeFontGlyphs(JSON.parse(JSON.stringify(OUTLINE_FIXTURE)))).toEqual(OUTLINE_FIXTURE);
    expect(() => decodeFontGlyphs({ ...OUTLINE_FIXTURE, version: 2 })).toThrow(/version 1/);
    expect(() => decodeFontGlyphs({ ...OUTLINE_FIXTURE, id: "technical" })).toThrow(/unknown font/);
    expect(() => decodeFontGlyphs({ ...OUTLINE_FIXTURE, kind: "single-line" })).toThrow(/wrong kind/);
    expect(() => decodeFontGlyphs({ ...OUTLINE_FIXTURE, glyphs: { ...OUTLINE_FIXTURE.glyphs, O: [800, "M0 0 A1 1"] } })).toThrow(/glyph O/);
    expect(() => decodeFontGlyphs({ ...OUTLINE_FIXTURE, glyphs: { O: [800, ""] } })).toThrow(/"\?"/);
    expect(() => decodeFontGlyphs({ ...OUTLINE_FIXTURE, kerning: { ABC: 1 } })).toThrow(/kerning/);
  });

  it("refuses to draw a typeface that has not loaded instead of substituting one", () => {
    clearRegisteredFonts();
    expect(isFontLoaded("jost")).toBe(false);
    expect(isFontLoaded("technical")).toBe(true);
    expect(() => labelDimensions("O", outline)).toThrow(FontNotLoadedError);
    expect(unsupportedLabelCharacters("Ö", "jost")).toEqual([]);
  });

  it("sizes text by cap height, kerns pairs, and reaches down to the descender", () => {
    const scale = 7 / 700;
    expect(labelDimensions("A", singleLine)).toEqual({ width: 600 * scale, height: 900 * scale });
    expect(labelDimensions("AV", singleLine).width).toBeCloseTo((600 + 600 - 100) * scale);
    expect(labelDimensions("VA", singleLine).width).toBeCloseTo(1200 * scale);
    const [apex] = labelGeometry("A", origin, 0, 0, 0, singleLine).strokes[0]!.slice(1, 2);
    expect(apex).toEqual({ x: 3, y: 0 });
    const descender = labelGeometry("g", origin, 0, 0, 0, singleLine).strokes[0]!;
    expect(Math.max(...descender.map((point) => point.y))).toBeCloseTo(9);
  });

  it("draws single-line fonts as open strokes with flattened curves and round pen ends", () => {
    const { strokes, fills } = labelGeometry("Ao", origin, 0, 0, 0, singleLine);
    expect(fills).toEqual([]);
    expect(strokes.length).toBe(3);
    expect(strokes[2]!.length).toBeGreaterThan(8);
    expect(strokes[2]![0]).toEqual(strokes[2]!.at(-1));
    const { stroke, fill } = labelSvgPaths("Ao", origin, 0, 0, 0, singleLine);
    expect(fill).toBe("");
    expect(stroke).toMatch(/^[ML\d. -]+$/);
    expect(labelPathData("Ao", origin, 0, 0, 0, singleLine)).toBe(stroke);
    // Cubic curves flatten too, and stay within the glyph box.
    const [curve] = labelGeometry("c", origin, 0, 0, 0, singleLine).strokes;
    expect(curve!.length).toBeGreaterThan(8);
    expect(curve!.every((point) => point.x >= 0.99 && point.x <= 4.01 && point.y >= 1.2 && point.y <= 7.01)).toBe(true);
  });

  it("fills outline fonts under the non-zero rule, holes included", () => {
    const ring = labelGeometry("O", origin, 0, 0, 0, outline).fills;
    expect(ring).toHaveLength(1);
    expect(ring[0]!.holes).toHaveLength(1);
    const merged = labelGeometry("H", origin, 0, 0, 0, outline).fills;
    expect(merged).toHaveLength(1);
    expect(merged[0]!.holes).toHaveLength(0);
    const { stroke, fill } = labelSvgPaths("OH", origin, 0, 0, 0, outline);
    expect(stroke).toBe("");
    expect(fill.match(/Z/g)).toHaveLength(3);
    // Line-only renderers still see every outline.
    expect(labelLineSegments("O", origin, 0, 0, 0, outline).length).toBeGreaterThanOrEqual(8);
  });

  it("rotates typeface text about its origin", () => {
    const flat = labelGeometry("V", { x: 10, y: 5 }, 0, 0, 0, singleLine).strokes[0]!;
    const turned = labelGeometry("V", { x: 10, y: 5 }, 0, 0, Math.PI / 2, singleLine).strokes[0]!;
    flat.forEach((point, index) => {
      expect(turned[index]!.x).toBeCloseTo(10 - (point.y - 5));
      expect(turned[index]!.y).toBeCloseTo(5 + (point.x - 10));
    });
  });

  it("reports and replaces characters a typeface lacks", () => {
    expect(unsupportedLabelCharacters("AOx", "hershey-sans")).toEqual(["O", "x"]);
    expect(labelGeometry("x", origin, 0, 0, 0, singleLine)).toEqual(labelGeometry("?", origin, 0, 0, 0, singleLine));
    expect(fabricationLabel("Ålgata Vägen", "hershey-sans")).toBe("g V g");
    expect(fabricationLabel("Ålgata Vägen")).toBe("ALGATA VAGEN");
  });

  it("keeps a title's case in a typeface and follows the label font unless it has its own", () => {
    expect(plaqueLines("Crater Lake", "jost")).toEqual(["Crater Lake"]);
    expect(plaqueLines("Crater Lake")).toEqual(["CRATER LAKE"]);
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, plaque: { enabled: true, text: "HO", sizeMm: 8, placement: { anchor: "bottom", offset: { x: 0, y: 0 } } } };
    expect(plaqueMarkings(project)[0]!.textStyle?.font).toBe("technical");
    expect(projectFonts(project)).toEqual(["technical"]);
    const titled = { ...project, plaque: { ...project.plaque!, font: "jost" as const } };
    expect(plaqueMarkings(titled)[0]!.textStyle?.font).toBe("jost");
    expect(projectFonts({ ...titled, textStyle: singleLine })).toEqual(["hershey-sans", "jost"]);
    expect(projectFingerprint(titled)).not.toBe(projectFingerprint(project));
    expect(() => validateProject(titled)).not.toThrow();
    expect(() => validateProject({ ...titled, plaque: { ...titled.plaque, font: "serif" as never } })).toThrow(/Title font/);
  });

  it("engraves an outline title as filled areas on every exposed sheet, never as <text>", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, plaque: { enabled: true, text: "HOH", sizeMm: 12, font: "jost", placement: { anchor: "center", offset: { x: 0, y: 0 } } } };
    const stack = generateGeometry(project, realSource(project));
    const fills = stack.layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("plaque-line-") && marking.filled);
    // The title spans several terraces; each sheet engraves the part exposed on it.
    expect(new Set(fills.map((marking) => marking.id.split("-")[3])).size).toBeGreaterThan(1);
    const master = masterToSvg(stack);
    expect(master).not.toContain("<text");
    expect(master).toMatch(/id="plaque-line-1-\d+-fill-[^"]*"[^>]*fill="#/);

    const flat = { ...project, outputMode: "engraving" as const };
    const engraving = generateGeometry(flat, realSource(flat));
    const svg = engravingToSvg(engraving, flat);
    const title = /<path id="plaque-line-1" d="([^"]+)" fill="[^"]+" stroke="none" fill-rule="evenodd"\/>/.exec(svg);
    // H, the O and its counter, H.
    expect(title?.[1]!.match(/Z/g)).toHaveLength(4);
    expect(layerToSvg(engraving, engraving.layers[0]!)).not.toContain("<text");
  });

  it("engraves single-line map labels as round-capped strokes", () => {
    const project = { ...DEFAULT_PROJECT, textStyle: singleLine };
    const source = realSource(project);
    source.markings = [{ id: "summit", kind: "label", operation: "engrave", points: [{ x: 10, y: 10 }], label: "AV", elevationM: source.elevation.min }];
    const flat = { ...project, outputMode: "engraving" as const };
    const svg = engravingToSvg(generateGeometry(flat, { ...source }), flat);
    expect(svg).toMatch(/fill="none" stroke="[^"]+" stroke-linecap="round" stroke-linejoin="round"/);
  });
});

describe("built-in fonts", () => {
  it("draw exactly as before typefaces existed", () => {
    for (const font of ["technical", "rounded", "stencil"] as const) {
      expect(labelSvgPaths("1m", origin, 0, 0, 0, { font, sizeMm: 5 })).toEqual({ stroke: labelPathData("1m", origin, 0, 0, 0, { font, sizeMm: 5 }), fill: "" });
    }
    expect(labelPathData("1", origin, 0, 0, 0, { font: "technical", sizeMm: 5 })).toMatchInlineSnapshot(`"M1 0L1.72 0 M0 1L0.72 1 M1 1L1.72 1 M1 2L1.72 2 M1 3L1.72 3 M0 4L0.72 4 M1 4L1.72 4 M2 4L2.72 4"`);
  });
});
