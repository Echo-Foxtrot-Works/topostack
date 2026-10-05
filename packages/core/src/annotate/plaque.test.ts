import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, DEFAULT_PLAQUE_SIZE_MM, NORTH_ARROW_ANCHORS, generateGeometry, labelDimensions, labelLineSegments, plaqueFootprint, plaqueMarkings, projectFingerprint, unsupportedLabelCharacters, validateProject, type NorthArrowAnchor, type PlaqueV1, type ProjectConfigV1 } from "../index.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { masterToSvg } from "../export/svg.js";
import { plaqueLines } from "./plaque.js";
import { realSource } from "../test-support/sources.js";

const plaque = (patch: Partial<PlaqueV1> = {}): PlaqueV1 => ({ enabled: true, text: "Crater Lake\n2026", sizeMm: DEFAULT_PLAQUE_SIZE_MM, placement: { anchor: "bottom-left", offset: { x: 0, y: 0 } }, ...patch });
const withPlaque = (patch: Partial<PlaqueV1> = {}, project: Partial<ProjectConfigV1> = {}): ProjectConfigV1 => ({ ...DEFAULT_PROJECT, ...project, plaque: plaque(patch) });

function strokeBounds(project: ProjectConfigV1) {
  const points = plaqueMarkings(project).flatMap((marking) => labelLineSegments(marking.label!, marking.points[0]!, 0, 0, 0, marking.textStyle).flatMap((segment) => [segment.start, segment.end]));
  return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) };
}

describe("title plaque", () => {
  it("engraves trimmed, capitalized lines and ignores blank ones", () => {
    expect(plaqueLines("  Mount Rainier \n\n Summer 2026 \n Loop \n extra")).toEqual(["MOUNT RAINIER", "SUMMER 2026", "LOOP"]);
    const markings = plaqueMarkings(withPlaque());
    expect(markings.map((marking) => marking.label)).toEqual(["CRATER LAKE", "2026"]);
    expect(markings.every((marking) => marking.kind === "label" && marking.operation === "engrave" && marking.textStyle?.sizeMm === DEFAULT_PLAQUE_SIZE_MM)).toBe(true);
    expect(markings[1]!.points[0]!.y).toBeGreaterThan(markings[0]!.points[0]!.y + DEFAULT_PLAQUE_SIZE_MM);
  });

  it("renders nothing when switched off or empty, and keeps old fingerprints", () => {
    expect(plaqueMarkings(withPlaque({ enabled: false }))).toEqual([]);
    expect(plaqueMarkings(withPlaque({ text: " \n " }))).toEqual([]);
    expect(plaqueFootprint(withPlaque({ enabled: false }))).toBeUndefined();
    expect(projectFingerprint({ ...DEFAULT_PROJECT, plaque: undefined })).toBe(projectFingerprint(DEFAULT_PROJECT));
    expect(projectFingerprint(withPlaque())).not.toBe(projectFingerprint(DEFAULT_PROJECT));
  });

  it("stays inside the crop at every anchor and aligns toward the anchored edge", () => {
    for (const cropShape of ["rectangle", "circle"] as const) {
      for (const anchor of NORTH_ARROW_ANCHORS as readonly NorthArrowAnchor[]) {
        const project = withPlaque({ placement: { anchor, offset: { x: 0, y: 0 } } }, { cropShape, widthMm: 300, heightMm: 200 });
        const bounds = strokeBounds(project);
        if (cropShape === "rectangle") {
          expect(bounds.minX).toBeGreaterThanOrEqual(-150);
          expect(bounds.maxX).toBeLessThanOrEqual(150);
          expect(bounds.minY).toBeGreaterThanOrEqual(-100);
          expect(bounds.maxY).toBeLessThanOrEqual(100);
        } else {
          for (const [x, y] of [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY]]) expect(Math.hypot(x!, y!)).toBeLessThanOrEqual(100);
        }
      }
    }
    const [left, right] = [withPlaque({ placement: { anchor: "top-left", offset: { x: 0, y: 0 } } }), withPlaque({ placement: { anchor: "top-right", offset: { x: 0, y: 0 } } })].map(plaqueMarkings);
    const style = left![0]!.textStyle;
    expect(left![1]!.points[0]!.x).toBeCloseTo(left![0]!.points[0]!.x);
    expect(right![1]!.points[0]!.x + labelDimensions("2026", style).width).toBeCloseTo(right![0]!.points[0]!.x + labelDimensions("CRATER LAKE", style).width);
  });

  it("is engraved into generated artwork and survives the export", () => {
    const project = withPlaque({}, { outputMode: "engraving" });
    const result = generateGeometry(project, realSource(project));
    const base = result.layers[0]!.markings;
    expect(base.filter((marking) => marking.id.startsWith("plaque-line-")).map((marking) => marking.id)).toEqual(["plaque-line-1", "plaque-line-2"]);
    // A material-colored backing clears the details beneath the letters.
    const backing = base.filter((marking) => marking.id.startsWith("plaque-backing-"));
    expect(backing.length).toBeGreaterThan(0);
    expect(backing.every((marking) => marking.knockout && marking.filled)).toBe(true);
    expect(base.findIndex((marking) => marking.id.startsWith("plaque-backing-"))).toBeLessThan(base.findIndex((marking) => marking.id === "plaque-line-1"));
    const svg = engravingToSvg(result, project);
    expect(svg).toContain("plaque-line-1");
    expect(svg).not.toContain("<text");
    const box = plaqueFootprint(project)!;
    const [minX, maxX, minY, maxY] = [Math.min(...box.map((p) => p.x)) + 0.5, Math.max(...box.map((p) => p.x)) - 0.5, Math.min(...box.map((p) => p.y)) + 0.5, Math.max(...box.map((p) => p.y)) - 0.5];
    const inside = (source: string) => [...source.matchAll(/<path id="contour-[^"]+"[^>]* d="([^"]+)"/g)]
      .flatMap((match) => [...match[1]!.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((point) => ({ x: Number(point[1]), y: Number(point[2]) })))
      .filter(({ x, y }) => x > minX && x < maxX && y > minY && y < maxY);
    const untitled = { ...project, plaque: { ...project.plaque!, enabled: false } };
    expect(inside(engravingToSvg(generateGeometry(untitled, realSource(untitled)), untitled)).length).toBeGreaterThan(0);
    expect(inside(svg)).toEqual([]);
    const stack = withPlaque();
    const layered = generateGeometry(stack, realSource(stack));
    expect(layered.layers.some((layer) => layer.markings.some((marking) => marking.id.startsWith("plaque-line-")))).toBe(true);
    expect(masterToSvg(layered)).toContain("plaque-line-");
  });

  it("is omitted with a warning when it cannot fit the material", () => {
    const project = withPlaque({ text: "A VERY LONG TITLE THAT CANNOT FIT HERE", sizeMm: 30 }, { outputMode: "engraving", widthMm: 80, heightMm: 60 });
    const result = generateGeometry(project, realSource(project));
    expect(result.layers[0]!.markings.some((marking) => marking.id.startsWith("plaque-"))).toBe(false);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "LABEL_OMITTED", message: expect.stringContaining("Title") }));
  });

  it("validates its limits and reports characters the stroke font cannot draw", () => {
    expect(() => validateProject(withPlaque())).not.toThrow();
    expect(() => validateProject(withPlaque({ text: "1\n2\n3\n4" }))).toThrow(/3 lines/);
    expect(() => validateProject(withPlaque({ text: "X".repeat(41) }))).toThrow(/40 characters/);
    expect(() => validateProject(withPlaque({ sizeMm: 2 }))).toThrow(/Title size/);
    expect(() => validateProject(withPlaque({ placement: { anchor: "middle" as NorthArrowAnchor, offset: { x: 0, y: 0 } } }))).toThrow(/anchor/);
    expect(() => validateProject(withPlaque({ placement: { anchor: "top", offset: { x: 2, y: 0 } } }))).toThrow(/offsets/);
    expect(unsupportedLabelCharacters("Rainier, 14'410 ft & more (#1)! 46°N\nok")).toEqual([]);
    expect(unsupportedLabelCharacters("Café @ Zürich")).toEqual(["é", "@", "ü"]);
  });
});
