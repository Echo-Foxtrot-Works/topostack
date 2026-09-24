import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, DEFAULT_SHEET_NESTING, type ProjectConfigV1, type SheetNestPlanV1 } from "@topostack/core";
import type { StudioContext } from "$lib/studio/studio-context";
import SheetLayoutSection from "$lib/studio/panels/SheetLayoutSection.svelte";
import WithStudio from "$lib/studio/testing/WithStudio.svelte";
import { SheetNesting } from "$lib/studio/sheet-nesting.svelte";

const settings = { ...DEFAULT_SHEET_NESTING, sheetWidthMm: 400, sheetHeightMm: 300 };
const plan: SheetNestPlanV1 = {
  schemaVersion: 1, jobKey: "nest1-x", engine: { name: "sparrow" }, settings, final: true, utilization: 0.61, elapsedMs: 10,
  sheets: [{ placements: [], usedWidthMm: 400, method: "sparrow" }, { placements: [], usedWidthMm: 120, method: "sparrow" }],
};

describe("the sheet layout section", () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(async () => { if (component) await unmount(component); component = undefined; });

  async function render(project: Partial<ProjectConfigV1> = {}) {
    const nesting = new SheetNesting(() => Promise.reject(new Error("not loaded in this test")));
    const updateProject = vi.fn();
    const studio = {
      project: { ...DEFAULT_PROJECT, ...project },
      geometry: {},
      sheetNesting: nesting,
      shownLengthUnit: "mm",
      shownLength: (value: number) => value,
      storedLength: (value: number) => value,
      updateProject,
    } as unknown as StudioContext;
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio, component: SheetLayoutSection } });
    await tick();
    return { target, nesting, updateProject };
  }

  it("credits sparrow and jagua-rs whenever the tool is shown", async () => {
    const { target } = await render();
    const credit = target.querySelector(".sheet-layout-credit")!;
    expect(credit.textContent).toContain("Nesting by sparrow");
    expect(credit.textContent).toContain("Jeroen Gardeyn (KU Leuven)");
    const links = [...credit.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(links).toEqual(["https://github.com/JeroenGar/sparrow", "https://github.com/JeroenGar/jagua-rs", "/attribution#software", "/licenses/third-party.txt"]);
  });

  it("keeps the original panels until the maker picks nested sheets", async () => {
    const { target, nesting } = await render();
    expect(target.querySelector(".sheet-layout-fields")).toBeNull();
    target.querySelector<HTMLInputElement>('input[type="radio"]:not(:checked)')!.click();
    flushSync();
    expect(nesting.useSheets).toBe(true);
    expect(target.querySelector(".sheet-layout-fields")).not.toBeNull();
    expect(target.textContent).toContain("Set a sheet size, or a machine work area");
    expect([...target.querySelectorAll("button")].find((button) => button.textContent?.includes("Nest parts"))?.disabled).toBe(true);
  });

  it("saves edited sheet settings to the project", async () => {
    const { target, nesting, updateProject } = await render({ workAreaWidthMm: 400, workAreaHeightMm: 300 });
    nesting.useSheets = true;
    flushSync();
    expect(target.textContent).toContain("A size of 0 uses the machine work area.");
    const rotation = target.querySelector<HTMLSelectElement>(".sheet-layout-select select")!;
    rotation.value = "free";
    rotation.dispatchEvent(new Event("change", { bubbles: true }));
    expect(updateProject).toHaveBeenCalledWith({ sheetNesting: { ...DEFAULT_SHEET_NESTING, rotation: "free" } });
    expect([...target.querySelectorAll("button")].find((button) => button.textContent?.includes("Nest parts"))?.disabled).toBe(false);
  });

  it("summarises a plan, draws its sheets, and warns when it goes stale", async () => {
    const { target, nesting } = await render({ sheetNesting: settings });
    nesting.useSheets = true;
    nesting.plan = plan;
    nesting.current = true;
    nesting.status = "done";
    nesting.previews = [
      { widthMm: 400, heightMm: 300, provisional: false, usedWidthMm: 400, parts: [{ label: "L01", path: "M0 0L10 0L10 10Z" }] },
      { widthMm: 400, heightMm: 300, provisional: true, usedWidthMm: 120, parts: [] },
    ];
    flushSync();
    expect(target.querySelector(".sheet-layout-status")?.textContent).toContain("2 sheets · 61% material used");
    expect(target.querySelectorAll(".sheet-previews li")).toHaveLength(2);
    expect(target.querySelector(".sheet-preview--provisional")?.textContent).toContain("pending");
    expect([...target.querySelectorAll("button")].some((button) => button.textContent?.includes("Nest again"))).toBe(true);
    nesting.current = false;
    flushSync();
    expect(target.textContent).toContain("Nest again to export sheets");
  });

  it("offers stop and cancel while searching", async () => {
    const { target, nesting } = await render({ sheetNesting: settings });
    nesting.useSheets = true;
    nesting.status = "running";
    nesting.budgetMs = 30_000;
    flushSync();
    const labels = [...target.querySelectorAll(".sheet-layout-actions button")].map((button) => button.textContent?.trim());
    expect(labels).toEqual(["Stop and keep best", "Cancel"]);
    expect(target.querySelector("progress")).not.toBeNull();
    expect(target.querySelector<HTMLSelectElement>(".sheet-layout-select select")?.disabled).toBe(true);
  });
});
