import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, type NestPartV1, type Point2D, type ProjectConfigV1, type ResolvedSheetNestSettings, type SheetNestPlanV1 } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";
import { jobKeyOf, planIsCurrent, prepareNestJob, sheetPreviews } from "./sheet-nest-runner";

const settings: ResolvedSheetNestSettings = { sheetWidthMm: 400, sheetHeightMm: 300, marginMm: 3, spacingMm: 2, rotation: "quarter", timeBudgetS: 30, seed: 1 };

function part(id: string, outline: Point2D[], label = id): NestPartV1 {
  return { id, label, rootLayerIndex: 0, members: [{ layerIndex: 0, polygonIndexes: [0] }], outline, areaMm2: 1 };
}

function plan(sheets: SheetNestPlanV1["sheets"]): SheetNestPlanV1 {
  return { schemaVersion: 1, jobKey: "key", engine: { name: "rectangles" }, settings, sheets, final: true, utilization: 0.5, elapsedMs: 1 };
}

/** The vertices of an `M x yLx y…Z` path. */
function vertices(path: string): Point2D[] {
  expect(path).toMatch(/^M.*Z$/);
  return path.slice(1, -1).split("L").map((pair) => {
    const [x, y] = pair.split(" ").map(Number);
    return { x: x!, y: y! };
  });
}

const rectangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }];

describe("sheetPreviews", () => {
  it("places each outline at its offset without rotation", () => {
    const [sheet] = sheetPreviews(plan([{ placements: [{ partId: "a", rotationDeg: 0, xMm: 20, yMm: 30 }], usedWidthMm: 120, method: "rectangles" }]), [part("a", rectangle, "L01")]);
    expect(sheet).toMatchObject({ widthMm: 400, heightMm: 300, provisional: false, usedWidthMm: 120 });
    expect(sheet!.parts).toHaveLength(1);
    expect(sheet!.parts[0]!.label).toBe("L01");
    expect(vertices(sheet!.parts[0]!.path)).toEqual([{ x: 20, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 35 }, { x: 20, y: 35 }]);
  });

  it("rotates clockwise in screen space about the part origin before translating", () => {
    const placed = (rotationDeg: number) => vertices(sheetPreviews(plan([{ placements: [{ partId: "a", rotationDeg, xMm: 100, yMm: 50 }], usedWidthMm: 0, method: "sparrow" }]), [part("a", rectangle)])[0]!.parts[0]!.path);
    // sheetPoint = R(θ)·modelPoint + offset, with R the standard rotation matrix.
    expect(placed(90)).toEqual([{ x: 100, y: 50 }, { x: 100, y: 60 }, { x: 95, y: 60 }, { x: 95, y: 50 }]);
    expect(placed(180)).toEqual([{ x: 100, y: 50 }, { x: 90, y: 50 }, { x: 90, y: 45 }, { x: 100, y: 45 }]);
    expect(placed(270)).toEqual([{ x: 100, y: 50 }, { x: 100, y: 40 }, { x: 105, y: 40 }, { x: 105, y: 50 }]);
    const free = placed(30);
    expect(free[1]!.x).toBeCloseTo(100 + 10 * Math.cos(Math.PI / 6), 1);
    expect(free[1]!.y).toBeCloseTo(50 + 10 * Math.sin(Math.PI / 6), 1);
  });

  it("rounds coordinates to a tenth of a millimetre", () => {
    const [sheet] = sheetPreviews(plan([{ placements: [{ partId: "a", rotationDeg: 0, xMm: 0.04, yMm: 1.26 }], usedWidthMm: 0, method: "sparrow" }]), [part("a", [{ x: 1.234, y: 5.678 }, { x: 2, y: 2 }])]);
    expect(sheet!.parts[0]!.path).toBe("M1.3 6.9L2 3.3Z");
  });

  it("thins long outlines to about 120 vertices and keeps short ones whole", () => {
    const ring = (count: number) => Array.from({ length: count }, (_, index) => ({ x: Math.cos(index / count * 2 * Math.PI) * 50, y: Math.sin(index / count * 2 * Math.PI) * 50 }));
    const count = (outlineLength: number) => vertices(sheetPreviews(plan([{ placements: [{ partId: "a", rotationDeg: 0, xMm: 0, yMm: 0 }], usedWidthMm: 0, method: "sparrow" }]), [part("a", ring(outlineLength))])[0]!.parts[0]!.path).length;
    expect(count(100)).toBe(100);
    expect(count(239)).toBe(239);
    expect(count(240)).toBe(120);
    expect(count(360)).toBe(120);
    expect(count(1000)).toBe(125);
    // The first vertex always survives thinning.
    const first = vertices(sheetPreviews(plan([{ placements: [{ partId: "a", rotationDeg: 0, xMm: 0, yMm: 0 }], usedWidthMm: 0, method: "sparrow" }]), [part("a", ring(1000))])[0]!.parts[0]!.path)[0];
    expect(first).toEqual({ x: 50, y: 0 });
  });

  it("skips placements for unknown parts and keeps every sheet, flagged provisional where it is", () => {
    const previews = sheetPreviews(plan([
      { placements: [{ partId: "missing", rotationDeg: 0, xMm: 0, yMm: 0 }, { partId: "b", rotationDeg: 0, xMm: 0, yMm: 0 }], usedWidthMm: 40, method: "sparrow" },
      { placements: [], usedWidthMm: 0, method: "rectangles", provisional: true },
    ]), [part("a", rectangle), part("b", rectangle, "L02")]);
    expect(previews).toHaveLength(2);
    expect(previews[0]!.parts.map((entry) => entry.label)).toEqual(["L02"]);
    expect(previews[1]).toMatchObject({ provisional: true, parts: [] });
  });

  it("is empty for a plan without sheets", () => {
    expect(sheetPreviews(plan([]), [part("a", rectangle)])).toEqual([]);
  });
});

describe("nest jobs", () => {
  const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
  const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, workAreaWidthMm: 400, workAreaHeightMm: 300 };

  it("needs a sheet size before anything else", () => {
    const job = prepareNestJob(geometry, DEFAULT_PROJECT);
    expect(job.ok).toBe(false);
    if (!job.ok) expect(job.error).toMatch(/sheet size|work area/i);
  });

  it("needs generated parts", () => {
    const job = prepareNestJob({ ...geometry, layers: [] }, project);
    expect(job).toEqual({ ok: false, error: "Generate the terrain before nesting its parts." });
  });

  it("resolves the sheet from the work area and lists the stack's parts", () => {
    const job = prepareNestJob(geometry, project);
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    expect(job.settings).toMatchObject({ sheetWidthMm: 400, sheetHeightMm: 300 });
    expect(job.parts.length).toBeGreaterThan(0);
    expect(new Set(job.parts.map((entry) => entry.id)).size).toBe(job.parts.length);
  });

  it("treats a plan as current only for the same parts and sheet settings", () => {
    const job = prepareNestJob(geometry, project);
    if (!job.ok) throw new Error(job.error);
    const saved = { ...plan([]), jobKey: jobKeyOf(job) };
    expect(jobKeyOf(job)).toBe(jobKeyOf(prepareNestJob(geometry, structuredClone(project)) as typeof job));
    expect(planIsCurrent(saved, geometry, project)).toBe(true);
    expect(planIsCurrent(saved, geometry, { ...project, sheetNesting: { sheetWidthMm: 0, sheetHeightMm: 0, marginMm: 3, spacingMm: 5, rotation: "quarter", timeBudgetS: 30, seed: 1 } })).toBe(false);
    expect(planIsCurrent(saved, geometry, { ...project, workAreaWidthMm: 500 })).toBe(false);
    expect(planIsCurrent(saved, geometry, DEFAULT_PROJECT)).toBe(false);
    expect(planIsCurrent(saved, { ...geometry, layers: [] }, project)).toBe(false);
  });
});
