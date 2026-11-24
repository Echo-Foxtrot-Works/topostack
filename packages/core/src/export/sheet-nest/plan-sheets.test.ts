import { describe, expect, it } from "vitest";
import type { NestPartV1, Point2D, ResolvedSheetNestSettings, SheetNestPlanV1 } from "../../types.js";
import type { StripEngine } from "./engine.js";
import { SheetNestError, planSheets } from "./plan-sheets.js";
import { rectangleEngine } from "./rectangles.js";
import { DEFAULT_SHEET_NESTING } from "./resolve.js";
import { verifySheetPlan } from "./verify.js";

const settings: ResolvedSheetNestSettings = { ...DEFAULT_SHEET_NESTING, sheetWidthMm: 300, sheetHeightMm: 200, marginMm: 5, spacingMm: 2 };

function part(id: string, points: Array<[number, number]>): NestPartV1 {
  const outline: Point2D[] = [...points, points[0]!].map(([x, y]) => ({ x, y }));
  let area = 0;
  for (let index = 0; index + 1 < outline.length; index += 1) area += outline[index]!.x * outline[index + 1]!.y - outline[index + 1]!.x * outline[index]!.y;
  return { id, label: id, rootLayerIndex: 0, members: [{ layerIndex: 0, polygonIndexes: [Number(id.replace(/\D/g, "")) || 0] }], outline, areaMm2: area / 2 };
}
const square = (id: string, size: number, x = -size / 2, y = -size / 2) => part(id, [[x, y], [x + size, y], [x + size, y + size], [x, y + size]]);

/** The bounding-box packer presented as sparrow, so the sheet-by-sheet search runs. */
const boxesAsSparrow: StripEngine = { name: "sparrow", info: { sparrowRev: "test" }, pack: (job) => rectangleEngine.pack(job) };

/** A clock that advances a fixed step every time the engine is called. */
function steppedClock(stepMs: number) {
  let time = 0;
  return { now: () => time, tick: () => { time += stepMs; } };
}

describe("sheet planning", () => {
  it("lays out every part validly and never uses more sheets than the bounding-box fallback", async () => {
    const parts = [square("p1", 120), square("p2", 110), square("p3", 90), square("p4", 60), square("p5", 60), square("p6", 40), square("p7", 30)];
    const plans: SheetNestPlanV1[] = [];
    const result = await planSheets(parts, settings, { engine: boxesAsSparrow, budgetMs: 10_000, onPlan: (plan) => plans.push(plan) });
    expect(verifySheetPlan(parts, result)).toEqual([]);
    expect(result.final).toBe(true);
    expect(result.jobKey).toMatch(/^nest2-/);
    expect(plans[0]!.engine).toEqual({ name: "sparrow", sparrowRev: "test" });
    expect(plans[0]!.sheets.every((sheet) => sheet.method === "rectangles")).toBe(true);
    expect(result.sheets.length).toBeLessThanOrEqual(plans[0]!.sheets.length);
    // Every draft is a complete, valid plan too.
    for (const plan of plans) expect(verifySheetPlan(parts, plan)).toEqual([]);
    expect(result.utilization).toBeGreaterThan(0);
    expect(result.utilization).toBeLessThanOrEqual(1);
  });

  it("returns the bounding-box plan straight away for the rectangle engine", async () => {
    const parts = [square("p1", 100), square("p2", 100)];
    const result = await planSheets(parts, settings, { engine: rectangleEngine });
    expect(result.engine.name).toBe("rectangles");
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]!.method).toBe("rectangles");
    expect(verifySheetPlan(parts, result)).toEqual([]);
  });

  it("names every part too large for the sheet", async () => {
    const parts = [square("small", 50), square("huge", 250), part("long", [[0, 0], [295, 0], [295, 10], [0, 10]])];
    const planning = planSheets(parts, settings, { engine: rectangleEngine });
    await expect(planning).rejects.toBeInstanceOf(SheetNestError);
    await expect(planning).rejects.toMatchObject({ code: "oversize", labels: ["huge", "long"] });
  });

  it("reports the near-fit envelope without emitting empty sheets", async () => {
    const partTooWide = part("near", [[0, 0], [100.01, 0], [100.01, 50], [0, 50]]);
    const stock = { ...settings, sheetWidthMm: 100, sheetHeightMm: 100, marginMm: 0 };
    await expect(planSheets([partTooWide], stock, { engine: rectangleEngine })).rejects.toMatchObject({ code: "oversize", labels: ["near"] });
  });

  it.each([[100, 100], [112.5, 56]])("finds a diagonal fit on a %s × %s sheet only with free rotation", async (width, height) => {
    const strip = part("strip", [[0, 0], [120, 0], [120, 5], [0, 5]]);
    const stock = { ...settings, sheetWidthMm: width, sheetHeightMm: height, marginMm: 0 };
    const plan = await planSheets([strip], { ...stock, rotation: "free" }, { engine: rectangleEngine });
    expect(plan.sheets).toHaveLength(1);
    expect(plan.sheets[0]!.placements[0]!.rotationDeg % 90).toBeGreaterThan(0);
    expect(verifySheetPlan([strip], plan)).toEqual([]);
    await expect(planSheets([strip], stock, { engine: rectangleEngine })).rejects.toMatchObject({ code: "oversize" });
  });

  it("allows a part exactly the size of the usable sheet", async () => {
    const parts = [part("full", [[0, 0], [290, 0], [290, 190], [0, 190]]), square("p2", 20)];
    const result = await planSheets(parts, settings, { engine: boxesAsSparrow, budgetMs: 2000 });
    expect(result.sheets).toHaveLength(2);
    expect(verifySheetPlan(parts, result)).toEqual([]);
  });

  it("rejects engine layouts that fail the independent check", async () => {
    const overlapping: StripEngine = {
      name: "sparrow",
      pack: (job) => ({ stripWidth: 10, placements: job.items.map((_, index) => ({ index, rotationDeg: 0, x: 50, y: 50 })) }),
    };
    const parts = [square("p1", 50), square("p2", 50), square("p3", 50)];
    const result = await planSheets(parts, settings, { engine: overlapping, budgetMs: 2000 });
    expect(verifySheetPlan(parts, result)).toEqual([]);
    expect(result.sheets.every((sheet) => sheet.method === "rectangles")).toBe(true);
  });

  it("survives an engine that throws", async () => {
    const failing: StripEngine = { name: "sparrow", pack: () => { throw new Error("construction failed"); } };
    const parts = [square("p1", 50), square("p2", 50)];
    const result = await planSheets(parts, settings, { engine: failing, budgetMs: 1000 });
    expect(verifySheetPlan(parts, result)).toEqual([]);
  });

  it("stops when asked and still returns a complete plan", async () => {
    const parts = Array.from({ length: 12 }, (_, index) => square(`p${index + 1}`, 70));
    let calls = 0;
    const counting: StripEngine = { name: "sparrow", pack: (job) => { calls += 1; return rectangleEngine.pack(job); } };
    const result = await planSheets(parts, settings, { engine: counting, budgetMs: 60_000, shouldStop: () => calls >= 2 });
    expect(calls).toBeLessThanOrEqual(2);
    expect(result.final).toBe(true);
    expect(verifySheetPlan(parts, result)).toEqual([]);
  });

  it("spreads its budget over probes and stays within it", async () => {
    const clock = steppedClock(400);
    const limits: number[] = [];
    const timed: StripEngine = { name: "sparrow", pack: (job) => { limits.push(job.timeLimitMs); clock.tick(); return rectangleEngine.pack(job); } };
    const parts = Array.from({ length: 20 }, (_, index) => square(`p${index + 1}`, 60 + (index % 5) * 5));
    const result = await planSheets(parts, settings, { engine: timed, budgetMs: 4000, now: clock.now });
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((limit) => limit >= 300 && limit <= 20_000)).toBe(true);
    // One probe may start just before the deadline.
    expect(clock.now()).toBeLessThanOrEqual(4000 + 400);
    expect(verifySheetPlan(parts, result)).toEqual([]);
  });

  it("marks drafts provisional where the packer has not reached yet", async () => {
    const parts = Array.from({ length: 10 }, (_, index) => square(`p${index + 1}`, 80));
    const drafts: SheetNestPlanV1[] = [];
    await planSheets(parts, settings, { engine: boxesAsSparrow, budgetMs: 10_000, onPlan: (plan) => { if (!plan.final) drafts.push(plan); } });
    expect(drafts.some((plan) => plan.sheets.some((sheet) => sheet.provisional))).toBe(true);
  });

  it("refuses an empty job", async () => {
    await expect(planSheets([], settings, { engine: rectangleEngine })).rejects.toMatchObject({ code: "no-parts" });
  });
});
