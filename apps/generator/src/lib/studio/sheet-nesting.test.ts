import { DEFAULT_PROJECT, DEFAULT_SHEET_NESTING, type GeometryIRV1, type SheetNestPlanV1 } from "@topostack/core";
import { describe, expect, it, vi } from "vitest";
import { SheetNesting } from "$lib/studio/sheet-nesting.svelte";
import type { NestRunOptions } from "$lib/workers/nest-client";

const settings = { ...DEFAULT_SHEET_NESTING, sheetWidthMm: 300, sheetHeightMm: 200 };
const plan = (final: boolean): SheetNestPlanV1 => ({ schemaVersion: 1, jobKey: "nest1-x", engine: { name: "sparrow" }, settings, sheets: [], final, utilization: 0.5, elapsedMs: 10 });
const geometry = {} as GeometryIRV1;

function fakeRunner(overrides: { run?: (options: NestRunOptions) => Promise<SheetNestPlanV1>; job?: unknown; current?: boolean } = {}) {
  const client = { run: vi.fn((_parts: unknown, _settings: unknown, options: NestRunOptions) => overrides.run?.(options) ?? Promise.resolve(plan(true))), stop: vi.fn(), cancel: vi.fn(), dispose: vi.fn() };
  const runner = {
    NestClient: vi.fn(function NestClient() { return client; }),
    NestJobError: Error,
    prepareNestJob: vi.fn(() => overrides.job ?? { ok: true, parts: [], settings }),
    planIsCurrent: vi.fn(() => overrides.current ?? true),
    jobKeyOf: vi.fn(() => "nest1-x"),
    sheetPreviews: vi.fn(() => [{ widthMm: 300, heightMm: 200, provisional: false, usedWidthMm: 100, parts: [] }]),
  };
  return { runner, client, load: () => Promise.resolve(runner as never) };
}

function fakeCache(saved?: { plan: SheetNestPlanV1; useSheets: boolean; savedAt: number }) {
  const cache = { loadNestPlan: vi.fn(async () => saved), saveNestPlan: vi.fn(async () => undefined), setNestPlanChoice: vi.fn(async () => undefined) };
  return { cache, load: () => Promise.resolve(cache as never) };
}

describe("SheetNesting", () => {
  it("runs a job, shows drafts, and exports the final plan once chosen", async () => {
    let draft: ((plan: SheetNestPlanV1) => void) | undefined;
    let finish: ((plan: SheetNestPlanV1) => void) | undefined;
    const { load } = fakeRunner({ run: (options) => new Promise((resolve) => { draft = options.onDraft; finish = resolve; }) });
    const nesting = new SheetNesting(load, () => 1000);
    const running = nesting.start(geometry, DEFAULT_PROJECT);
    await vi.waitFor(() => expect(nesting.status).toBe("running"));
    expect(nesting.budgetMs).toBe(30_000);
    draft!(plan(false));
    expect(nesting.plan?.final).toBe(false);
    expect(nesting.previews).toHaveLength(1);
    expect(nesting.exportPlan).toBeUndefined();
    finish!(plan(true));
    await running;
    expect(nesting.status).toBe("done");
    expect(nesting.useSheets).toBe(true);
    expect(nesting.exportPlan?.final).toBe(true);
    nesting.useSheets = false;
    expect(nesting.exportPlan).toBeUndefined();
  });

  it("reports a job that cannot start", async () => {
    const { load } = fakeRunner({ job: { ok: false, error: "Set a sheet size." } });
    const nesting = new SheetNesting(load);
    await nesting.start(geometry, DEFAULT_PROJECT);
    expect(nesting.status).toBe("error");
    expect(nesting.error).toBe("Set a sheet size.");
  });

  it("returns to idle on cancel and reports engine errors", async () => {
    const abort = new DOMException("cancelled", "AbortError");
    const cancelled = fakeRunner({ run: () => Promise.reject(abort) });
    const nesting = new SheetNesting(cancelled.load);
    await nesting.start(geometry, DEFAULT_PROJECT);
    expect(nesting.status).toBe("idle");
    const failing = fakeRunner({ run: () => Promise.reject(new Error("L01 is larger than the sheet.")) });
    const other = new SheetNesting(failing.load);
    await other.start(geometry, DEFAULT_PROJECT);
    expect(other.status).toBe("error");
    expect(other.error).toMatch(/larger/);
  });

  it("marks a finished plan stale when the design changed during the search", async () => {
    let finish: ((plan: SheetNestPlanV1) => void) | undefined;
    const { load, runner } = fakeRunner({ run: () => new Promise((resolve) => { finish = resolve; }) });
    const nesting = new SheetNesting(load);
    const running = nesting.start(geometry, DEFAULT_PROJECT);
    await vi.waitFor(() => expect(nesting.status).toBe("running"));
    const edited = { ...DEFAULT_PROJECT, widthMm: DEFAULT_PROJECT.widthMm + 10 };
    await nesting.refresh(geometry, edited);
    runner.planIsCurrent.mockReturnValue(false);
    finish!(plan(true));
    await running;
    // Checked against the edit made during the search, not the design it started from.
    expect((runner.planIsCurrent.mock.lastCall as unknown[] | undefined)?.[2]).toBe(edited);
    expect(nesting.status).toBe("done");
    expect(nesting.current).toBe(false);
    expect(nesting.exportPlan).toBeUndefined();
  });

  it("marks a plan stale when the design or settings change, and forgets it on cancel", async () => {
    const { load, runner, client } = fakeRunner();
    const nesting = new SheetNesting(load);
    await nesting.start(geometry, DEFAULT_PROJECT);
    expect(nesting.exportPlan).toBeDefined();
    runner.planIsCurrent.mockReturnValue(false);
    await nesting.refresh(geometry, DEFAULT_PROJECT);
    expect(nesting.current).toBe(false);
    expect(nesting.exportPlan).toBeUndefined();
    nesting.stop();
    expect(client.stop).toHaveBeenCalled();
    nesting.cancel();
    expect(nesting.plan).toBeUndefined();
    expect(nesting.previews).toEqual([]);
    nesting.dispose();
    expect(client.dispose).toHaveBeenCalled();
  });

  it("saves a finished layout and remembers the maker's choice", async () => {
    const { load } = fakeRunner();
    const { cache, load: loadCache } = fakeCache();
    const nesting = new SheetNesting(load, () => 0, loadCache);
    await nesting.start(geometry, DEFAULT_PROJECT);
    await vi.waitFor(() => expect(cache.saveNestPlan).toHaveBeenCalledWith(plan(true), true));
    nesting.setUseSheets(false);
    expect(nesting.exportPlan).toBeUndefined();
    await vi.waitFor(() => expect(cache.setNestPlanChoice).toHaveBeenCalledWith("nest1-x", false));
  });

  it("restores a layout saved for the same design, once per job", async () => {
    const { load, runner } = fakeRunner();
    const { cache, load: loadCache } = fakeCache({ plan: plan(true), useSheets: false, savedAt: 1 });
    const nesting = new SheetNesting(load, () => 0, loadCache);
    await nesting.restore(geometry, DEFAULT_PROJECT);
    expect(cache.loadNestPlan).toHaveBeenCalledWith("nest1-x");
    expect(nesting.status).toBe("done");
    expect(nesting.plan?.jobKey).toBe("nest1-x");
    expect(nesting.useSheets).toBe(false);
    expect(nesting.previews).toHaveLength(1);
    nesting.setUseSheets(true);
    expect(nesting.exportPlan).toBeDefined();
    await nesting.restore(geometry, DEFAULT_PROJECT);
    expect(runner.prepareNestJob).toHaveBeenCalledTimes(1);
  });

  it("finds nothing to restore for a new design or an unfinished job", async () => {
    const missing = new SheetNesting(fakeRunner().load, () => 0, fakeCache().load);
    await missing.restore(geometry, DEFAULT_PROJECT);
    expect(missing.plan).toBeUndefined();
    expect(missing.status).toBe("idle");
    const noSheet = fakeCache({ plan: plan(true), useSheets: true, savedAt: 1 });
    const unready = new SheetNesting(fakeRunner({ job: { ok: false, error: "Set a sheet size." } }).load, () => 0, noSheet.load);
    await unready.restore(geometry, DEFAULT_PROJECT);
    expect(noSheet.cache.loadNestPlan).not.toHaveBeenCalled();
  });
});
