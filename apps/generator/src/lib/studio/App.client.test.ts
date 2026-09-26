import { readFileSync } from "node:fs";
import { join } from "node:path";
import noaaFixture from "$lib/domain/fixtures/noaa-erie-z11.json";
import { mount, tick, unmount } from "svelte";
import { afterEach, onTestFinished, beforeAll, describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry, type GeometryIRV1 } from "@topostack/core";
import { theme } from "$lib/site/theme";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";

const noaaArchive = vi.hoisted(() => ({ getHeader: vi.fn(), getMetadata: vi.fn(), getZxy: vi.fn() }));
vi.mock("$lib/domain/archive", async (importOriginal) => ({ ...await importOriginal<typeof import("$lib/domain/archive")>(), createArchive: vi.fn(() => noaaArchive) }));
const loadTerrainMock = vi.hoisted(() => vi.fn());
const loadVectorMarkingsMock = vi.hoisted(() => vi.fn());
const loadLakeAreasMock = vi.hoisted(() => vi.fn());
vi.mock("$lib/domain/data-provider", async (importOriginal) => ({ ...await importOriginal<typeof import("$lib/domain/data-provider")>(), loadTerrain: loadTerrainMock, loadVectorMarkings: loadVectorMarkingsMock, loadLakeAreas: loadLakeAreasMock }));
vi.mock("$lib/storage/storage", async (importOriginal) => ({ ...await importOriginal<typeof import("$lib/storage/storage")>(), loadProject: vi.fn(async () => undefined), saveProject: vi.fn(async () => undefined) }));
// Glyph files are fetched in the browser; here they are read from the source tree.
vi.mock("$lib/domain/fonts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/domain/fonts")>();
  // The URL is the dev server path of the glyph file, rooted at this app.
  const read = async (url: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", url.split("?")[0]!), "utf8"));
  return { ...actual, ensureFonts: (fonts: Parameters<typeof actual.ensureFonts>[0]) => actual.ensureFonts(fonts, read) };
});
vi.mock("$lib/atomm/atomm-bridge", () => ({ connectAtomm: vi.fn(() => () => undefined) }));
vi.mock("$app/navigation", () => ({ replaceState: (url: URL) => window.history.replaceState(window.history.state, "", url) }));
vi.mock("$lib/studio/ThreePreview.svelte", async () => ({ default: (await import("$lib/studio/testing/TestPreview.svelte")).default }));

import { PROJECT_UNLOAD_COPY_KEY } from "$lib/storage/storage";
import App from "$lib/studio/App.svelte";
import { nav } from "$lib/studio/customdata/custom-data-nav.svelte";
import { resetDraft } from "$lib/studio/customdata/chart-draft.svelte";

/** Opens a header menu if it is closed and returns the item whose text starts with `name`. */
async function menuItem(target: HTMLElement, menu: string, name: string) {
  const trigger = target.querySelector<HTMLButtonElement>(`button[aria-label^="${menu}"]`)!;
  if (trigger.getAttribute("aria-expanded") !== "true") {
    trigger.click();
    await tick();
  }
  return [...target.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find((item) => item.textContent?.trim().startsWith(name))! as HTMLButtonElement;
}

/**
 * Opens the custom data view, where markers, paths, file import and depth
 * charts are edited. Every section's tools mount with the sidebar; `expand`
 * names the one whose disclosure should also be opened.
 */
async function openCustomData(target: HTMLElement, expand?: string) {
  [...target.querySelectorAll<HTMLButtonElement>('.mode-switch [role="radio"]')].find((button) => button.textContent?.includes("Custom data"))!.click();
  await vi.waitFor(() => expect(target.querySelector(".custom-data-section")).not.toBeNull());
  if (!expand) return;
  const header = [...target.querySelectorAll<HTMLButtonElement>(".custom-data-section .section-disclosure")].find((button) => button.textContent?.includes(expand))!;
  header.click();
  await tick();
}

describe("TopoStack Svelte shell", () => {
  let component: ReturnType<typeof mount> | undefined;
  let initialPreview: GeometryIRV1;
  const stored = new Map<string, string>();
  const localStorageStub: Storage = {
    get length() { return stored.size; },
    clear: () => stored.clear(),
    getItem: (key) => stored.get(key) ?? null,
    key: (index) => [...stored.keys()][index] ?? null,
    removeItem: (key) => { stored.delete(key); },
    setItem: (key, value) => { stored.set(key, String(value)); },
  };
  // The app lazy-loads the 3D preview. Resolve the mocked module once up front
  // so the first in-test dynamic import cannot race mock registration and pull
  // in the real WebGL component.
  beforeAll(async () => {
    HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
    HTMLDialogElement.prototype.close ??= function () { this.open = false; this.dispatchEvent(new Event("close")); };
    // Match the page's precomputed Worker result. Clone it at each mount so
    // tests remain isolated without recalculating the same preview for every test.
    initialPreview = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageStub });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element): void { this.callback([{ target, contentRect: { width: 500, height: 500 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect(): void {}
      unobserve(): void {}
    } });
    await import("$lib/studio/ThreePreview.svelte");
  });
  afterEach(async () => { if (component) await unmount(component); component = undefined; loadTerrainMock.mockReset(); loadVectorMarkingsMock.mockReset(); loadLakeAreasMock.mockReset(); Object.values(noaaArchive).forEach((mock) => mock.mockReset()); theme.preference = "system"; localStorage.removeItem("topostack-theme"); localStorage.removeItem("topostack-menu-sections-v1"); delete window.atomm; nav.section = "charts"; nav.expanded = true; resetDraft(); });

  it("title edits survive committing an open placement draft", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Title"]')!.click();
    await vi.waitFor(() => expect(target.querySelector(".plaque-settings button.placement-start")).not.toBeNull());
    target.querySelector<HTMLButtonElement>(".plaque-settings button.placement-start")!.click();
    // First placement lazily imports and instruments the SVG components under coverage.
    await vi.waitFor(() => expect(target.querySelector('[data-placeable="plaque"]')).not.toBeNull(), { timeout: 5_000 });
    target.querySelector('[data-placeable="plaque"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    const text = target.querySelector<HTMLTextAreaElement>('.plaque-settings textarea')!;
    text.value = "Updated title";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall![0].plaque?.text).toBe("Updated title");
    [...target.querySelectorAll<HTMLButtonElement>(".placement-toolbar button")].find(b => b.textContent?.trim() === "Done")!.click();
    // Done allows up to four seconds for generation, then fades out.
    await vi.waitFor(() => expect(target.querySelector("[data-placement-layer]")).toBeNull(), { timeout: 6_000 });
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall![0].plaque?.text).toBe("Updated title");
  });
  it("uploads a graphic, then places, turns and cuts it on the preview as one edit", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    await openCustomData(target, "Graphics");
    const input = target.querySelector<HTMLInputElement>("input[data-graphic-import]")!;
    const file = new File([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>`], "badge.svg", { type: "image/svg+xml" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Uploaded graphics"]')?.textContent).toBeDefined());
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('[aria-label="Name for graphic badge"]')).not.toBeNull());
    [...target.querySelectorAll<HTMLButtonElement>(".graphic-place")].find((button) => button.textContent?.includes("Place"))!.click();
    await vi.waitFor(() => expect(target.querySelector('[data-placeable^="graphic:"]')).not.toBeNull(), { timeout: 5_000 });
    // Nothing is saved until Done.
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall![0].placedGraphics).toBeUndefined();
    const handle = target.querySelector('[data-placeable^="graphic:"]')!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true }));
    await tick();
    expect(target.querySelector(".placement-toolbar")?.textContent).toContain("15°");
    [...target.querySelectorAll<HTMLButtonElement>('.placement-operation [role="radio"]')].find((button) => button.textContent === "Cut")!.click();
    await tick();
    expect(target.querySelector(".placement-cut-draft")).not.toBeNull();
    [...target.querySelectorAll<HTMLButtonElement>(".placement-toolbar button")].find((button) => button.textContent?.trim() === "Done")!.click();
    await vi.waitFor(() => expect(target.querySelector("[data-placement-layer]")).toBeNull(), { timeout: 6_000 });
    window.dispatchEvent(new Event("pagehide"));
    const saved = vi.mocked(saveProject).mock.lastCall![0];
    expect(saved.placedGraphics).toEqual([expect.objectContaining({ graphicId: saved.customGraphics![0]!.id, rotationDeg: 15, operation: "cut" })]);
    expect(target.querySelector('[aria-label="Graphics on the piece"]')?.textContent).toContain("15°");
  });

  it("toolbar undo is paused during placement", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const name = target.querySelector<HTMLInputElement>('[aria-label="Project name"]')!;
    name.value = "Changed name";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    target.querySelector<HTMLButtonElement>("button.placement-start")!.click();
    await vi.waitFor(() => expect(target.querySelector("[data-placement-layer]")).not.toBeNull());
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await tick();
    expect(name.value).toBe("Changed name");
  });

  it("resets the entire saved project to Crater Lake defaults and supports Undo", async () => {
    const { loadProject, saveProject } = await import("$lib/storage/storage");
    const saved = { ...DEFAULT_PROJECT, name: "My mountain", widthMm: 450, outputMode: "engraving" as const,
      location: { lat: 46.85, lon: -121.76, label: "Mount Rainier", zoom: 12 }, showWater: false, verticalExaggeration: 5 };
    vi.mocked(loadProject).mockResolvedValueOnce(saved);
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    const reset = () => menuItem(target, "Project actions", "Reset project");
    await vi.waitFor(async () => expect((await reset()).disabled).toBe(false));
    (await reset()).click();
    await tick();
    const dialog = target.querySelector<HTMLDialogElement>(".reset-dialog")!;
    expect(dialog.open).toBe(true);
    expect(target.querySelector<HTMLInputElement>('[aria-label="Project name"]')?.value).toBe(saved.name);
    dialog.querySelector<HTMLButtonElement>("button")!.click();
    await tick();
    expect(target.querySelector(".reset-dialog")).toBeNull();
    expect(target.querySelector<HTMLInputElement>('[aria-label="Project name"]')?.value).toBe(saved.name);
    (await reset()).click();
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>(".reset-dialog button")].find((button) => button.textContent?.trim() === "Reset project")!.click();
    await tick();
    // Flush the pending snapshot: covered preview work can occupy the main
    // thread longer than waitFor's default timeout before the save timer runs.
    window.dispatchEvent(new Event("pagehide"));
    expect(saveProject).toHaveBeenLastCalledWith(DEFAULT_PROJECT);
    expect(target.querySelector<HTMLInputElement>('[aria-label="Project name"]')?.value).toBe("Crater Lake");
    expect(target.querySelector('[aria-label="Layered relief"]')?.getAttribute("aria-checked")).toBe("true");
    await vi.waitFor(() => expect(target.textContent).toContain("Some lake depths are estimated rather than surveyed."));
    expect(loadTerrainMock).not.toHaveBeenCalled();
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await vi.waitFor(() => expect(saveProject).toHaveBeenLastCalledWith(saved));
    target.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!.click();
    await vi.waitFor(() => expect(saveProject).toHaveBeenLastCalledWith(DEFAULT_PROJECT));
  });

  it("undoes and redoes project edits from the keyboard outside text fields", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    const name = () => target.querySelector<HTMLInputElement>('[aria-label="Project name"]')!;
    await vi.waitFor(async () => expect((await menuItem(target, "Project actions", "Reset project")).disabled).toBe(false));
    target.querySelector<HTMLButtonElement>('button[aria-label="Project actions"]')!.click();
    name().value = "Keyboard peak";
    name().dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')?.disabled).toBe(false));
    // Inside a text field the browser's own undo wins.
    const fromField = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    name().dispatchEvent(fromField);
    expect(fromField.defaultPrevented).toBe(false);
    expect(name().value).toBe("Keyboard peak");
    const undoKey = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(undoKey);
    expect(undoKey.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(name().value).toBe("Crater Lake"));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Z", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(name().value).toBe("Keyboard peak"));
    target.remove();
  });

  it("discards terrain generation that finishes after resetting the project", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    let finish: ((value: unknown) => void) | undefined;
    loadTerrainMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    const reset = () => menuItem(target, "Project actions", "Reset project");
    await vi.waitFor(async () => expect((await reset()).disabled).toBe(false));
    target.querySelector<HTMLButtonElement>(".generate-button")!.click();
    await vi.waitFor(() => expect(finish).toBeDefined());
    (await reset()).click();
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>(".reset-dialog button")].find((button) => button.textContent?.trim() === "Reset project")!.click();
    await tick();
    finish!({ source: createSyntheticSource(DEFAULT_PROJECT, 32), fallback: true });
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Project reset to Crater Lake defaults"));
    // Flush the pending snapshot rather than relying on an earlier test's last save.
    vi.mocked(saveProject).mockClear();
    window.dispatchEvent(new Event("pagehide"));
    expect(saveProject).toHaveBeenLastCalledWith(DEFAULT_PROJECT);
    // The unloading page may abandon that IndexedDB write, so a synchronous copy lands too.
    expect(JSON.parse(localStorage.getItem(PROJECT_UNLOAD_COPY_KEY)!).value).toEqual(DEFAULT_PROJECT);
    localStorage.removeItem(PROJECT_UNLOAD_COPY_KEY);
    expect(target.textContent).not.toContain("Sample terrain generated");
  });

  it("deduplicates repeated survey-gap warnings without hiding distinct warnings", async () => {
    const preview = structuredClone(initialPreview);
    const gap = { code: "BATHYMETRY_FALLBACK" as const, message: "A lake has incomplete survey coverage." };
    preview.warnings = [gap, { ...gap }, { code: "LOW_RELIEF", message: "Very little elevation change." }];
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: preview } });
    await tick();
    expect(target.querySelectorAll(".preview-warning")).toHaveLength(2);
    expect([...target.querySelectorAll(".preview-warning")].filter((warning) => warning.textContent?.includes(gap.message))).toHaveLength(1);
    const dismiss = [...target.querySelectorAll<HTMLButtonElement>(".warning-dismiss")].find((button) => button.getAttribute("aria-label")?.includes(gap.message))!;
    dismiss.click();
    await tick();
    expect(target.textContent).not.toContain(gap.message);
    expect(target.textContent).toContain("Very little elevation change.");
  });

  it("dismisses preview warnings without clearing export restrictions and restores warnings for fresh terrain", async () => {
    loadTerrainMock.mockResolvedValue({ source: createSyntheticSource(DEFAULT_PROJECT, 32), fallback: true });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const dismissAll = async (): Promise<void> => {
      for (let count = 0; count < 20; count++) {
        const button = target.querySelector<HTMLButtonElement>(".warning-dismiss");
        if (!button) break;
        button.click();
        await tick();
      }
      expect(target.querySelector(".warning-stack")).toBeNull();
    };
    expect(target.querySelector(".warning-stack")).not.toBeNull();
    await dismissAll();
    const name = target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
    name.value = "Quiet preview";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(target.querySelector(".warning-stack")).toBeNull();
    expect(target.querySelector(".context-export-status")?.textContent).toContain("Generate before export");
    for (let generation = 1; generation <= 2; generation++) {
      target.querySelector<HTMLButtonElement>(".generate-button")!.click();
      await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledTimes(generation));
      await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Sample terrain generated"));
      expect(target.querySelector(".warning-stack")).not.toBeNull();
      await dismissAll();
      expect(target.querySelector(".context-export-status")?.textContent).toContain("Generate before export");
    }
  });

  it("fits lake depth from the clipping warning and restores manual depth from the preview", async () => {
    const source = createSyntheticSource(DEFAULT_PROJECT, 32);
    const values = new Float32Array(32 * 32);
    const depthsM = new Float32Array(32 * 32);
    for (let row = 0; row < 32; row++) for (let column = 0; column < 32; column++) {
      const x = (column / 31 - 0.5) * DEFAULT_PROJECT.widthMm;
      const y = (row / 31 - 0.5) * DEFAULT_PROJECT.heightMm;
      const inside = Math.abs(x) < 40 && Math.abs(y) < 40;
      values[row * 32 + column] = inside ? 180 : 180 + Math.hypot(x, y);
      depthsM[row * 32 + column] = inside ? 600 * (1 - Math.max(Math.abs(x), Math.abs(y)) / 40) : NaN;
    }
    loadTerrainMock.mockResolvedValue({ source: {
      ...source, sourceKind: "real", vectorStatus: "available", lakeDataStatus: "available", bathymetryStatus: "available", markings: [],
      elevation: { width: 32, height: 32, values, min: 180, max: Math.max(...values) },
      waterAreas: [{ id: "test-lake", kind: "lake", name: "Deep test lake",
        polygon: { outer: [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }, { x: -40, y: -40 }], holes: [] },
        bathymetry: { width: 32, height: 32, depthsM },
      }],
    }, fallback: false });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Limit depth layers"]')!.click();
    await tick();
    const allowance = target.querySelector<HTMLInputElement>('input[aria-label="Maximum depth layers"]')!;
    allowance.value = "6";
    allowance.dispatchEvent(new Event("input", { bubbles: true }));
    target.querySelector<HTMLButtonElement>(".generate-button")!.click();
    const fitButton = () => [...target.querySelectorAll<HTMLButtonElement>(".preview-warning button")].find((button) => button.textContent?.trim() === "Fit depth");
    await vi.waitFor(() => expect(fitButton()).toBeDefined());
    fitButton()!.click();
    const fitSwitch = () => target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Fit lake depth to available layers"]')!;
    await vi.waitFor(() => expect(fitSwitch().getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.textContent).toContain("% of requested depth"));
    expect(fitButton()).toBeUndefined();
    expect(target.textContent).not.toContain("so its floor is flattened");
    [...target.querySelectorAll<HTMLButtonElement>(".warning-action")].find((button) => button.textContent?.trim() === "Use manual depth")!.click();
    await vi.waitFor(() => expect(fitSwitch().getAttribute("aria-checked")).toBe("false"));
    await vi.waitFor(() => expect(fitButton()).toBeDefined());
    expect(target.textContent).not.toContain("% of requested depth");
    expect(loadTerrainMock).toHaveBeenCalledTimes(1);
    expect(loadLakeAreasMock).not.toHaveBeenCalled();

    // Returning to automatic coverage restores the full floor without fetching terrain.
    const limitedLayers = Number(target.querySelector<HTMLInputElement>('.layer-range')!.max) + 1;
    target.querySelector<HTMLButtonElement>('[aria-label="Limit depth layers"]')!.click();
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('.layer-range')!.max).not.toBe(String(limitedLayers - 1)));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    expect(Number(target.querySelector<HTMLInputElement>('.layer-range')!.max) + 1).toBeGreaterThan(limitedLayers);
    expect(target.querySelector('[aria-label="Maximum depth layers"]')).toBeNull();
    expect(fitButton()).toBeUndefined();
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await vi.waitFor(() => expect(fitButton()).toBeDefined());
    expect(target.querySelector<HTMLInputElement>('[aria-label="Maximum depth layers"]')!.value).toBe("6");
    expect(loadTerrainMock).toHaveBeenCalledTimes(1);

    // Keeping the preference enabled must not show a notice for a shallower lake.
    fitButton()!.click();
    await vi.waitFor(() => expect(target.textContent).toContain("Lake depth fitting is on."));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    depthsM.fill(1);
    target.querySelector<HTMLButtonElement>(".generate-button")!.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    expect(fitSwitch().getAttribute("aria-checked")).toBe("true");
    expect(target.textContent).not.toContain("Lake depth fitting is on.");
    expect(target.textContent).not.toContain("% of requested depth");
    expect([...target.querySelectorAll(".warning-action")].some((button) => button.textContent?.trim() === "Use manual depth")).toBe(false);
    expect(fitButton()).toBeUndefined();
  });

  it("hides the fitting notice for a restored preference without fitted lakes and saves manual depth", async () => {
    const { loadProject, saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    vi.mocked(loadProject).mockResolvedValueOnce({ ...DEFAULT_PROJECT, fitLakeDepth: true, waterDepthLayerLimit: 6 });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    const manualButton = () => [...target.querySelectorAll<HTMLButtonElement>(".warning-action")].find((button) => button.textContent?.trim() === "Use manual depth");
    await vi.waitFor(() => expect(target.textContent).toContain("Local project restored"));
    expect(target.textContent).not.toContain("Lake depth fitting is on.");
    expect(manualButton()).toBeUndefined();
    const fitSwitch = target.querySelector<HTMLButtonElement>('[aria-label="Fit lake depth to available layers"]')!;
    expect(fitSwitch.getAttribute("aria-checked")).toBe("true");
    fitSwitch.click();
    await vi.waitFor(() => expect(target.querySelector('[aria-label="Fit lake depth to available layers"]')?.getAttribute("aria-checked")).toBe("false"));
    await tick();
    // Flush the pending snapshot rather than waiting out the debounce under coverage.
    window.dispatchEvent(new Event("pagehide"));
    expect(saveProject).toHaveBeenLastCalledWith(expect.objectContaining({ fitLakeDepth: false }));
    expect(manualButton()).toBeUndefined();
    const saved = vi.mocked(saveProject).mock.lastCall![0];
    await unmount(component!);
    component = undefined;
    vi.mocked(loadProject).mockResolvedValueOnce(saved);
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(target.textContent).toContain("Local project restored"));
    expect(target.querySelector('[aria-label="Fit lake depth to available layers"]')?.getAttribute("aria-checked")).toBe("false");
    expect(manualButton()).toBeUndefined();
  });

  it("shows the predicted-depth notice alongside Fit depth and allows dismissal", async () => {
    const preview = structuredClone(initialPreview);
    const prediction = "Some lake depths are estimated rather than surveyed.";
    preview.warnings = [
      { code: "LABEL_OMITTED", message: "Some labels do not fit." },
      { code: "BATHYMETRY_FALLBACK", message: "Partial survey coverage." },
      { code: "LAKE_DEPTH_PREDICTED", message: prediction },
      { code: "WATER_DEPTH_CLAMPED", message: "The lake is too deep for the stack.", action: "fit-lake-depth" },
    ];
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: preview } });
    await tick();
    expect(target.querySelectorAll(".preview-warning")).toHaveLength(2);
    expect(target.querySelector(".preview-warning .warning-action")?.textContent?.trim()).toBe("Fit depth");
    expect(target.querySelector(".warning-stack")?.textContent).toContain(prediction);
    expect(target.querySelector<HTMLAnchorElement>('.warning-stack a[href$="/guides/how-lake-depths-work"]')?.target).toBe("_blank");
    target.querySelector<HTMLButtonElement>(`button[aria-label="Dismiss warning: ${prediction}"]`)!.click();
    await tick();
    expect(target.querySelector(".warning-stack")?.textContent).not.toContain(prediction);
    expect(preview.warnings.some((warning) => warning.code === "LAKE_DEPTH_PREDICTED")).toBe(true);
  });

  it("keeps the fit action visible when other warnings fill the preview", async () => {
    const preview = structuredClone(initialPreview);
    preview.warnings = [
      { code: "BATHYMETRY_FALLBACK", message: "Partial survey coverage." },
      { code: "LABEL_OMITTED", message: "Some labels do not fit." },
      { code: "WATER_DEPTH_CLAMPED", message: "The lake is too deep for the stack.", action: "fit-lake-depth" },
    ];
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: preview } });
    await tick();
    expect(target.querySelectorAll(".preview-warning")).toHaveLength(2);
    expect(target.querySelector(".preview-warning .warning-action")?.textContent?.trim()).toBe("Fit depth");
  });

  it("opens a directory lake after restoring settings, consumes the place link once and generates it", async () => {
    const { loadProject, saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    loadTerrainMock.mockImplementationOnce(() => new Promise(() => undefined));
    vi.mocked(loadProject).mockResolvedValueOnce({ ...DEFAULT_PROJECT, name: "Saved mountain", materialThicknessMm: 5, outputMode: "engraving", showWaterDepth: false });
    window.history.replaceState(null, "", "/studio?lake=Lake%20Tahoe&bounds=-120.2,38.9,-119.8,39.3");
    try {
      const target = document.createElement("div");
      component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
      await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());
      expect(loadTerrainMock.mock.calls[0]![0]).toMatchObject({ name: "Lake Tahoe", outputMode: "stack", showWaterDepth: true, location: { label: "Lake Tahoe" } });
      expect(target.textContent).toContain("Fetching elevation and map details");
      expect(target.querySelector<HTMLInputElement>('[aria-label="Project name"]')?.value).toBe("Lake Tahoe");
      expect(target.querySelector('[aria-label="Water depth"]')?.getAttribute("aria-checked")).toBe("true");
      expect(window.location.search).toBe("");
      await vi.waitFor(() => expect(saveProject).toHaveBeenLastCalledWith(expect.objectContaining({
        name: "Lake Tahoe", materialThicknessMm: 5, outputMode: "stack", showWaterDepth: true,
        location: expect.objectContaining({ label: "Lake Tahoe", lon: -120 }),
      })));
      expect(vi.mocked(saveProject).mock.lastCall![0].location.lat).toBeCloseTo(39.1);
    } finally { window.history.replaceState(null, "", "/"); }
  });

  it("copies a share link and opens a shared design on top of the saved project", async () => {
    const { loadProject, saveProject } = await import("$lib/storage/storage");
    const { projectFromShareLink } = await import("$lib/studio/share-link");
    const saved = { ...DEFAULT_PROJECT, name: "Saved mountain", materialThicknessMm: 5 };
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.mocked(loadProject).mockResolvedValueOnce(saved);
    const first = document.createElement("div");
    component = mount(App, { target: first, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(first.querySelector<HTMLInputElement>('[aria-label="Project name"]')?.value).toBe("Saved mountain"));
    (await menuItem(first, "Project actions", "Copy share link")).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const link = new URL((writeText.mock.calls[0] as unknown as [string])[0]);
    expect(link.pathname).toBe("/studio");
    expect(projectFromShareLink(link.hash)).toMatchObject({ name: "Saved mountain", materialThicknessMm: 5 });
    await vi.waitFor(() => expect(first.textContent).toContain("Share link copied"));
    await unmount(component);

    vi.mocked(saveProject).mockClear();
    vi.mocked(loadProject).mockResolvedValueOnce({ ...DEFAULT_PROJECT, name: "Recipient project" });
    window.history.replaceState(null, "", `/studio${link.hash}`);
    try {
      const target = document.createElement("div");
      component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
      const name = () => target.querySelector<HTMLInputElement>('[aria-label="Project name"]')!;
      await vi.waitFor(() => expect(target.textContent).toContain("Shared design opened"));
      expect(name().value).toBe("Saved mountain");
      expect(window.location.hash).toBe("");
      target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
      await vi.waitFor(() => expect(name().value).toBe("Recipient project"));
    } finally { window.history.replaceState(null, "", "/"); }
  });

  it("shares a design through the system share sheet, stays quiet on cancel and copies when sharing fails", async () => {
    const { projectFromShareLink } = await import("$lib/studio/share-link");
    const writeText = vi.fn(async () => undefined);
    const share = vi.fn(async (_data: ShareData) => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    try {
      const target = document.createElement("div");
      component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
      await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('[aria-label="Project name"]')).not.toBeNull());
      (await menuItem(target, "Project actions", "Share design")).click();
      await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
      const data = share.mock.calls[0]![0];
      expect(data.title).toContain("TopoStack");
      expect(projectFromShareLink(new URL(data.url!).hash)).toMatchObject({ name: DEFAULT_PROJECT.name });
      await vi.waitFor(() => expect(target.textContent).toContain("Design shared"));
      expect(writeText).not.toHaveBeenCalled();

      share.mockRejectedValueOnce(Object.assign(new Error("Share canceled"), { name: "AbortError" }));
      (await menuItem(target, "Project actions", "Share design")).click();
      await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(2));
      await tick();
      expect(writeText).not.toHaveBeenCalled();

      share.mockRejectedValueOnce(Object.assign(new Error("Not allowed"), { name: "NotAllowedError" }));
      (await menuItem(target, "Project actions", "Share design")).click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      expect((writeText.mock.calls[0] as unknown as [string])[0]).toBe(data.url);
      await vi.waitFor(() => expect(target.textContent).toContain("Share link copied"));
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });

  it("offers only the copy action where the browser has no share sheet", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('[aria-label="Project name"]')).not.toBeNull());
    expect(await menuItem(target, "Project actions", "Copy share link")).toBeTruthy();
    expect(await menuItem(target, "Project actions", "Share design")).toBeUndefined();
  });

  it("edits and undoes the project name and switches preview modes", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const name = target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
    name.value = "Alpine study";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(name.value).toBe("Alpine study");
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await tick();
    expect(name.value).toBe(DEFAULT_PROJECT.name);
    [...target.querySelectorAll("button")].find((button) => button.textContent?.includes("Cut layers"))!.click();
    await vi.waitFor(() => expect(target.querySelector('svg[aria-label^="Cut preview for layer"]')).not.toBeNull());
    await vi.waitFor(() => expect(target.querySelector('[data-marking-kind="road"]')).not.toBeNull());
    expect(target.querySelector(".layer-heading")?.textContent).toMatch(/Layer \d+ of 12/);
  });

  it("refreshes the preview and export state when undoing and redoing a fabrication change", async () => {
    const source = { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" as const, vectorStatus: "available" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    target.querySelector<HTMLButtonElement>(".generate-button")!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    const exportStatus = () => target.querySelector(".context-export-status")?.textContent;
    expect(exportStatus()).toContain("Ready to export");
    const stackSummary = () => target.querySelector(".output-summary")?.textContent;
    const initialStack = stackSummary();

    const material = target.querySelector<HTMLInputElement>('input[aria-label="Material"]')!;
    const originalThickness = material.value;
    material.value = String(Number(originalThickness) * 2);
    material.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Fabrication geometry updated"));
    await vi.waitFor(() => expect(stackSummary()).not.toBe(initialStack));
    expect(exportStatus()).toContain("Ready to export");

    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('input[aria-label="Material"]')?.value).toBe(originalThickness));
    await vi.waitFor(() => expect(stackSummary()).toBe(initialStack));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    expect(exportStatus()).toContain("Ready to export");

    target.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!.click();
    await vi.waitFor(() => expect(stackSummary()).not.toBe(initialStack));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    expect(exportStatus()).toContain("Ready to export");
    expect(loadTerrainMock).toHaveBeenCalledOnce();
  });

  it("restores map-detail markings when undoing a detail toggle", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    const initialRoads = stage.dataset.roadMarkings;
    expect(Number(initialRoads)).toBeGreaterThan(0);
    const roads = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Roads"]')!;
    roads.click();
    await vi.waitFor(() => expect(stage.dataset.roadMarkings).toBe("0"));
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await vi.waitFor(() => expect(roads.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(stage.dataset.roadMarkings).toBe(initialRoads));
    expect(target.querySelector(".status-line")?.textContent).toMatch(/updated/i);
  });

  it("asks for regeneration instead of refreshing when undo restores a different map area", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>(".preset-row button")].find((button) => button.textContent === "Grand Teton and Jenny Lake")!.click();
    await tick();
    expect(target.querySelector(".status-line")?.textContent).toContain("Map area changed");
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await tick();
    expect(target.querySelector(".status-line")?.textContent).not.toContain("Map area changed");
    target.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!.click();
    await tick();
    expect(target.querySelector(".status-line")?.textContent).toContain("Map area changed");
    expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps autosave working and reports the problem when restoring a saved project fails", async () => {
    const { loadProject, saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    vi.mocked(loadProject).mockRejectedValueOnce(new Error("IndexedDB blocked"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const target = document.createElement("div");
      component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
      await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Saved project could not be restored"));
      const name = target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
      name.value = "Still saved";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.waitFor(() => expect(saveProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Still saved" })));
    } finally { errors.mockRestore(); }
  });

  it("flushes a pending autosave when the tab is closing or hidden", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    // Autosave only starts once the saved project has been restored.
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalled(), { timeout: 2_000 });
    vi.mocked(saveProject).mockClear();
    const name = target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
    name.value = "Closed mid-edit";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    // Still inside the debounce: only the flush can explain a write here.
    expect(saveProject).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({ name: "Closed mid-edit" }));
    try {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      // The same snapshot is written once, however often the tab is hidden.
      expect(saveProject).toHaveBeenCalledOnce();
    } finally { Object.defineProperty(document, "hidden", { configurable: true, value: false }); }
  });

  it("discards a generation started before the saved project finished restoring", async () => {
    const { loadProject } = await import("$lib/storage/storage");
    let finishRestore: ((project: typeof DEFAULT_PROJECT) => void) | undefined;
    vi.mocked(loadProject).mockImplementationOnce(() => new Promise((resolve) => { finishRestore = resolve; }));
    loadTerrainMock.mockImplementation((_project, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true })));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    target.querySelector<HTMLButtonElement>(".generate-button")!.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());
    finishRestore!({ ...DEFAULT_PROJECT, name: "Restored ridge" });
    await vi.waitFor(() => expect(target.textContent).toContain("Local project restored"));
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')?.value).toBe("Restored ridge");
    expect(target.querySelector(".generate-button")?.textContent).not.toContain("Cancel generation");
    expect(target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')?.disabled).toBe(true);
  });

  it("switches to a flat engraving workflow with dedicated controls and preview", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const engraving = target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Flat engraving"]')!;
    engraving.click();
    await vi.waitFor(() => expect(engraving.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector('svg[aria-label="Flat engraving preview"]')).not.toBeNull());
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Contour density"]')?.value).toBe("12");
    expect(target.querySelector('button[role="switch"][aria-label="Engraved border"]')).not.toBeNull();
    expect(target.querySelector('button[role="switch"][aria-label="Water depth"]')).toBeNull();
    const waterFill = target.querySelector<HTMLElement>('div[aria-label="Water fill pattern"]')!;
    const noWaterFill = [...waterFill.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent === "None")!;
    const rippleFill = [...waterFill.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent === "Ripples")!;
    expect(noWaterFill.getAttribute("aria-checked")).toBe("true");
    rippleFill.click();
    await vi.waitFor(() => expect(rippleFill.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector('[data-water-pattern="ripples"]')).not.toBeNull());
    expect(target.querySelector(".layer-dock")).toBeNull();
    expect(target.querySelector(".output-summary")?.textContent).toContain("No cut paths");
    const viewport = target.querySelector<HTMLElement>("[data-svg-viewport]")!;
    const artwork = target.querySelector<SVGSVGElement>('svg[aria-label="Flat engraving preview"]')!;
    const initialViewBox = artwork.getAttribute("viewBox");
    expect(viewport.dataset.zoom).toBe("1.00");
    target.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click();
    await vi.waitFor(() => expect(viewport.dataset.zoom).toBe("1.50"));
    expect(viewport.dataset.rendering).toBe("preview");
    expect(artwork.getAttribute("viewBox")).toBe(initialViewBox);
    await vi.waitFor(() => expect(viewport.dataset.rendering).toBe("sharp"));
    expect(viewport.dataset.renderZoom).toBe("1.50");
    expect(artwork.getAttribute("viewBox")).not.toBe(initialViewBox);
    expect(Number(artwork.getAttribute("viewBox")!.split(" ")[2])).toBeLessThan(Number(initialViewBox!.split(" ")[2]));
    expect(target.querySelector(".svg-zoom-value")?.textContent).toBe("150%");
    target.querySelector<HTMLButtonElement>('button[aria-label="Reset engraving view"]')!.click();
    await vi.waitFor(() => expect(viewport.dataset.zoom).toBe("1.00"));
    expect(artwork.getAttribute("viewBox")).toBe(initialViewBox);
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -80, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(Number(viewport.dataset.zoom)).toBeGreaterThan(1));
    expect(viewport.dataset.rendering).toBe("preview");
    expect(viewport.dataset.renderZoom).toBe("1.00");
    expect(artwork.getAttribute("viewBox")).toBe(initialViewBox);
    expect(target.querySelector<HTMLElement>(".svg-canvas")?.style.transform).toMatch(/scale\(1\./);
    await vi.waitFor(() => expect(viewport.dataset.rendering).toBe("sharp"));
    expect(viewport.dataset.renderZoom).toBe(viewport.dataset.zoom);
    expect(artwork.getAttribute("viewBox")).not.toBe(initialViewBox);
    expect(target.querySelector<HTMLElement>(".svg-canvas")?.style.transform).toContain("scale(1)");
    const settledViewBox = artwork.getAttribute("viewBox");
    viewport.setPointerCapture = vi.fn();
    viewport.hasPointerCapture = vi.fn(() => true);
    viewport.releasePointerCapture = vi.fn();
    const pointerEvent = (type: string, clientX: number, clientY: number): MouseEvent => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    viewport.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    viewport.dispatchEvent(pointerEvent("pointermove", 110, 108));
    const panLayer = target.querySelector<HTMLElement>(".svg-pan-layer")!;
    await vi.waitFor(() => {
      const offset = panLayer.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/);
      expect(Number(offset?.[1])).toBeCloseTo(10);
      expect(Number(offset?.[2])).toBeCloseTo(8);
    });
    expect(artwork.getAttribute("viewBox")).toBe(settledViewBox);
    viewport.dispatchEvent(pointerEvent("pointerup", 110, 108));
    await vi.waitFor(() => expect(panLayer.style.transform).toBe("translate3d(0, 0, 0)"));
    expect(artwork.getAttribute("viewBox")).toBe(settledViewBox);
    expect(target.querySelector<HTMLElement>(".svg-canvas")?.style.transform).not.toContain("translate3d(0px, 0px");
  });

  it("applies linework presets and custom trail patterns to the engraving preview", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const bold = [...target.querySelectorAll<HTMLButtonElement>('.line-presets button[role="radio"]')].find((button) => button.textContent?.includes("Bold"))!;
    bold.click();
    await vi.waitFor(() => expect(bold.getAttribute("aria-checked")).toBe("true"));
    target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Flat engraving"]')!.click();
    await vi.waitFor(() => expect(target.querySelector('svg[aria-label="Flat engraving preview"]')).not.toBeNull());
    await vi.waitFor(() => expect(target.querySelector('.engraving-contours path:not(.index-contour)')?.getAttribute("stroke-width")).toBe("0.24"));
    target.querySelector<HTMLButtonElement>(".linework-customize")!.click();
    await tick();
    const dotted = [...target.querySelectorAll<HTMLButtonElement>('.trail-pattern-options button[role="radio"]')].find((button) => button.textContent?.includes("Dotted"))!;
    dotted.click();
    await vi.waitFor(() => expect(dotted.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector('[data-transportation-class="trail"] path')?.getAttribute("stroke-dasharray")).toMatch(/^0\.01 /));
    const outlined = [...target.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent?.includes("Outlined"))!;
    outlined.click();
    await vi.waitFor(() => expect(outlined.getAttribute("aria-checked")).toBe("true"));
    expect(target.querySelector('input[aria-label="Major road outline spacing"]')).not.toBeNull();
    const square = [...target.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((button) => button.textContent?.includes("Square"))!;
    square.click();
    await vi.waitFor(() => expect(target.querySelector('[data-transportation-class="major-road"] path')?.getAttribute("stroke-linecap")).toBe("square"));
  });

  it("lays out fabrication controls in full-width rows with a compact position pair", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Fabrication settings"))!.click();
    await tick();
    const fields = target.querySelector<HTMLElement>(".advanced-fields")!;
    // Material-saving nests, water paint templates, and smooth contours.
    expect(fields.querySelectorAll('.toggle-stack button[role="switch"]')).toHaveLength(3);
    // Glue margin, laser kerf, minimum feature, and the two work-area fields.
    expect(fields.querySelectorAll(".field-stack > .field-row")).toHaveLength(5);
    // Text engraving and the elevation label position now sit beside what they
    // affect in Map details rather than in the fabrication panel.
    expect(fields.querySelector(".swatch-options")).toBeNull();
    // One compact picker row; its list holds three built-in styles, four
    // single-line fonts and four filled typefaces.
    const fontPicker = target.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="Engraving font"]')!;
    expect(fontPicker.textContent).toContain("Technical");
    expect(target.querySelector('[role="listbox"][aria-label="Engraving font"]')).toBeNull();
    fontPicker.click();
    await vi.waitFor(() => expect(target.querySelectorAll('[role="listbox"][aria-label="Engraving font"] [role="option"]')).toHaveLength(11));
    expect(target.querySelectorAll('[role="listbox"][aria-label="Engraving font"] [role="group"]')).toHaveLength(3);
    expect(target.querySelectorAll('input[aria-label="Label X"]')).toHaveLength(1);
  });

  it("reports the sheet grid a machine work area implies", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Fabrication settings"))!.click();
    await tick();
    const fields = target.querySelector<HTMLElement>(".advanced-fields")!;
    // No work area: the model is cut whole and there is nothing to label.
    expect(fields.querySelector(".seam-summary")?.textContent).toMatch(/one piece/i);
    expect([...fields.querySelectorAll('button[role="switch"]')].some((button) => button.getAttribute("aria-label") === "Assembly labels")).toBe(false);

    const width = target.querySelector<HTMLInputElement>('input[aria-label="Work area width"]')!;
    const height = target.querySelector<HTMLInputElement>('input[aria-label="Work area height"]')!;
    for (const [input, value] of [[width, "160"], [height, "120"]] as const) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      await tick();
    }
    await vi.waitFor(() => expect(target.querySelector(".seam-summary")?.textContent).toContain("2 × 2 sheets per layer"));
    expect([...target.querySelectorAll('button[role="switch"]')].some((button) => button.getAttribute("aria-label") === "Assembly labels")).toBe(true);
  });

  it("offers water paint templates for a layered model and stores the kind list", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const heading = [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Fabrication settings"))!;
    heading.click();
    await tick();
    const paintSwitch = () => target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Water paint templates"]');
    expect(paintSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(heading.textContent).not.toContain("Paint templates");
    paintSwitch()!.click();
    await vi.waitFor(() => expect(paintSwitch()?.getAttribute("aria-checked")).toBe("true"));
    // The section summary reads the stored kind list, so it proves the project took ["water"].
    await vi.waitFor(() => expect(heading.textContent).toContain("Paint templates"));
    paintSwitch()!.click();
    await vi.waitFor(() => expect(heading.textContent).not.toContain("Paint templates"));

    // A flat engraving has no layers to stencil.
    target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Flat engraving"]')!.click();
    await vi.waitFor(() => expect(paintSwitch()).toBeNull());
  });

  it("changes engraving font and exact physical text size without refetching terrain", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const picker = target.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="Engraving font"]')!;
    picker.click();
    await tick();
    // Keyboard: typeahead lands on Stencil and Enter picks it and closes the list.
    const list = target.querySelector<HTMLElement>('[role="listbox"][aria-label="Engraving font"]')!;
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    await tick();
    expect(list.querySelector(`#${CSS.escape(list.getAttribute("aria-activedescendant")!)}`)?.textContent).toContain("Stencil");
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(picker.textContent).toContain("Stencil"));
    expect(target.querySelector('[role="listbox"][aria-label="Engraving font"]')).toBeNull();
    const size = target.querySelector<HTMLInputElement>('input[aria-label="Text size"]')!;
    size.value = "5";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('input[aria-label="Text size slider"]')?.value).toBe("5"));
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("customizes north-arrow design and physical size without refetching terrain", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const designs = target.querySelectorAll<HTMLButtonElement>('.swatch-options[aria-label="North arrow design"] button[role="radio"]');
    expect(designs).toHaveLength(3);
    const mariner = [...designs].find((button) => button.textContent?.includes("Mariner"))!;
    mariner.click();
    await vi.waitFor(() => expect(mariner.getAttribute("aria-checked")).toBe("true"));
    const size = target.querySelector<HTMLInputElement>('input[aria-label="North arrow size"]')!;
    size.value = "30";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector<HTMLInputElement>('input[aria-label="North arrow size slider"]')?.value).toBe("30"));
    // Preview refreshes trail rapid edits, so wait for the coalesced rebuild.
    await vi.waitFor(() => expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.northMarkings)).toBeGreaterThan(10));
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("places the compass and title in placement mode and bakes them only on Done", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    const target = document.createElement("div");
    // Attached, so focus moves to the placement handles.
    document.body.append(target);
    onTestFinished(() => target.remove());
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const moveButtons = () => [...target.querySelectorAll<HTMLButtonElement>("button.placement-start")];
    const pointer = (type: string, clientX: number, clientY: number): MouseEvent => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
      Object.defineProperty(event, "pointerId", { value: 7 });
      return event;
    };
    const layer = () => target.querySelector<SVGSVGElement>("[data-placement-layer]");
    const handle = (id: string) => target.querySelector<SVGPathElement>(`[data-placeable="${id}"]`)!;
    const northCenter = () => { const project = vi.mocked(saveProject).mock.lastCall![0]; return project.northArrowPlacement; };

    // Layered output keeps the 3D preview mounted under the placement layer.
    moveButtons()[0]!.click();
    await vi.waitFor(() => expect(layer()).not.toBeNull());
    expect(target.querySelector('[data-placement-backdrop="3d"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="three-preview"]')).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(handle("north")));
    // jsdom lays nothing out: fit the viewBox to 500 px so one pixel is a known length.
    const [, , viewWidth, viewHeight] = layer()!.getAttribute("viewBox")!.split(" ").map(Number);
    layer()!.getBoundingClientRect = () => ({ width: 500, height: 500, left: 0, top: 0, right: 500, bottom: 500, x: 0, y: 0, toJSON: () => ({}) });
    const millimetersPerPixel = Math.max(viewWidth! / 500, viewHeight! / 500);
    const moved = (id: string) => target.querySelector(`[data-placement-item="${id}"]`)!;
    handle("north").setPointerCapture = vi.fn();
    window.dispatchEvent(new Event("pagehide"));
    const before = northCenter();
    const circleX = () => Number(moved("north").querySelector<SVGPathElement>(".placement-handle")!.getAttribute("d")!.match(/^M\s*([-\d.]+)/)![1]);
    const startX = circleX();
    handle("north").dispatchEvent(pointer("pointerdown", 400, 400));
    handle("north").dispatchEvent(pointer("pointermove", 300, 350));
    handle("north").dispatchEvent(pointer("pointerup", 300, 350));
    await vi.waitFor(() => expect(target.querySelector(".placement-item--selected")?.getAttribute("data-placement-item")).toBe("north"));
    // The draft follows the pointer: 100 px left.
    expect(circleX()).toBeCloseTo(startX - 100 * millimetersPerPixel, 3);
    // Nothing is saved or regenerated while the draft is open.
    window.dispatchEvent(new Event("pagehide"));
    expect(northCenter()).toEqual(before);
    [...target.querySelectorAll<HTMLButtonElement>(".placement-toolbar button")].find((button) => button.textContent?.trim() === "Done")!.click();
    // Coverage instrumentation can make generation exceed waitFor's default second.
    await vi.waitFor(() => expect(layer()).toBeNull(), { timeout: 6_000 });
    window.dispatchEvent(new Event("pagehide"));
    expect(northCenter()).not.toEqual(before);
    expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.northMarkings)).toBeGreaterThan(0);

    // Flat engravings place over the top-down composite, with the baked markings hidden.
    target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Flat engraving"]')!.click();
    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Title"]')!.click();
    await vi.waitFor(() => expect(moveButtons()).toHaveLength(3));
    await vi.waitFor(() => expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.plaqueMarkings)).toBeGreaterThan(0));
    target.querySelector<HTMLButtonElement>(".plaque-settings button.placement-start")!.click();
    await vi.waitFor(() => expect(target.querySelector('[data-placement-backdrop="flat"]')).not.toBeNull());
    // The scale bar is placed in the same session.
    expect(handle("scale")).not.toBeNull();
    const topView = target.querySelector<SVGSVGElement>(".stack-top-view")!;
    expect(topView.querySelector("rect, circle")).not.toBeNull();
    expect(target.querySelectorAll("[data-placement-artwork] path").length).toBeGreaterThan(10);
    await vi.waitFor(() => expect(document.activeElement).toBe(handle("plaque")));
    const titleLeft = () => Number(handle("plaque").getAttribute("d")!.match(/^M\s*([-\d.]+)/)![1]);
    const startLeft = titleLeft();
    handle("plaque").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(titleLeft()).toBeCloseTo(startLeft + 10, 3));
    // Plus grows the title about its center; the toolbar reads the new size.
    handle("plaque").dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(target.querySelector(".placement-toolbar__size")?.textContent).toContain("Letter height 6.5 mm"));
    expect(target.querySelector('[data-placement-grip="plaque"]')).not.toBeNull();
    // Escape discards the draft.
    handle("plaque").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(layer()).toBeNull());
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall![0].plaque?.placement).toEqual({ anchor: "bottom-left", offset: { x: 0, y: 0 } });
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("collapses, expands, and remembers configuration sections", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();

    const sections = [...target.querySelectorAll<HTMLButtonElement>(".section-disclosure")];
    expect(sections).toHaveLength(6);
    expect(sections[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(sections.slice(1).every((section) => section.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(target.querySelector<HTMLElement>("#section-size")?.hidden).toBe(true);

    [...target.querySelectorAll<HTMLButtonElement>(".section-tools button")].find((button) => button.textContent === "Expand all")!.click();
    await tick();
    expect(sections.every((section) => section.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(target.querySelector<HTMLElement>("#section-size")?.hidden).toBe(false);

    sections.find((section) => section.textContent?.includes("Map details"))!.click();
    await tick();
    const saved = JSON.parse(localStorage.getItem("topostack-menu-sections-v1") ?? "{}") as Record<string, boolean>;
    expect(saved.details).toBe(false);
    expect(saved.size).toBe(true);
  });

  it("updates vertical exaggeration immediately from retained terrain, including undo and redo", async () => {
    const source = { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    target.querySelector<HTMLButtonElement>(".generate-button")!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    const initialLayers = target.querySelector(".layer-heading")?.textContent;
    const exaggeration = target.querySelector<HTMLInputElement>('input[aria-label="Vertical exaggeration"]')!;
    exaggeration.value = "4";
    exaggeration.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".layer-heading")?.textContent).not.toBe(initialLayers));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    const updatedLayers = target.querySelector(".layer-heading")?.textContent;
    expect(loadTerrainMock).toHaveBeenCalledOnce();
    expect(target.querySelector(".vertical-exaggeration-heading .terrain-data-badge")?.textContent).toBe("Updates automatically");
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await vi.waitFor(() => expect(target.querySelector(".layer-heading")?.textContent).toBe(initialLayers));
    target.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!.click();
    await vi.waitFor(() => expect(target.querySelector(".layer-heading")?.textContent).toBe(updatedLayers));
    expect(loadTerrainMock).toHaveBeenCalledOnce();
  });

  it("explains automatic sidebar updates and flags a manually selected map area", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const note = target.querySelector<HTMLElement>(".terrain-data-note")!;
    expect(note.textContent).toContain("Sidebar settings update the preview automatically.");
    [...target.querySelectorAll<HTMLButtonElement>(".preset-row button")].find((button) => button.textContent === "Grand Teton and Jenny Lake")!.click();
    await tick();
    expect(note.textContent).toContain("Terrain data is from the previous map area.");
    expect(target.querySelector(".status-line")?.textContent).toContain("Map area changed · generate terrain data before export");
  });

  it("applies and persists an explicit color scheme", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const scheme = (name: string) => menuItem(target, "Studio menu", name);
    expect((await scheme("System")).getAttribute("aria-checked")).toBe("true");
    (await scheme("Light")).click();
    await tick();
    expect(theme.preference).toBe("light");
    expect(target.querySelector('[role="menu"]')).toBeNull();
    (await scheme("Dark")).click();
    await tick();
    expect((await scheme("Dark")).getAttribute("aria-checked")).toBe("true");
    expect((await scheme("Light")).getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("topostack-theme")).toBe("dark");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')).not.toBeNull();
  });

  it("moves through header menus from the keyboard and returns focus on Escape", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const trigger = target.querySelector<HTMLButtonElement>('button[aria-label^="Studio menu"]')!;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() => expect(document.activeElement?.textContent).toContain("Light"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = target.querySelector<HTMLElement>('[role="menu"]')!;
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("TopoStack home");
    expect(document.activeElement?.getAttribute("href")).toBe("/");
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("Light");
    expect(menu.querySelector(".studio-menu__version")?.textContent).toMatch(/^TopoStack v\d+\.\d+\.\d+$/);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    target.remove();
  });

  it("automatically fetches the new map area after debounced cut aspect-ratio edits", async () => {
    loadTerrainMock.mockImplementation(async (config: typeof DEFAULT_PROJECT) => ({ source: createSyntheticSource(config, 32), fallback: true }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const width = target.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(width.max).toBe("10000");
    width.value = "1200";
    width.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("true"));
    expect(target.querySelector(".preview-readout")?.textContent).toContain("1200 × 200 mm");
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();
    expect(loadLakeAreasMock).not.toHaveBeenCalled();
  });

  it("converts units and automatically refreshes aspect-ratio edits", async () => {
    loadTerrainMock.mockImplementation(async (config: typeof DEFAULT_PROJECT) => ({ source: createSyntheticSource(config, 32), fallback: true }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const width = target.querySelector<HTMLInputElement>('input[type="number"]')!;
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Imperial"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".preview-readout")?.textContent).toContain("11.811 × 7.874 in"));
    expect(width.value).toBe("11.811");
    expect(width.closest(".field-row")?.textContent).toContain("in");
    expect(target.querySelector(".layer-heading")?.textContent).toContain("ft");
    width.value = "10";
    width.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("true"));
    expect(target.querySelector(".preview-readout")?.textContent).toContain("10 × 7.874 in");
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Metric"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".preview-readout")?.textContent).toContain("254 × 200 mm"));
    expect(width.value).toBe("254");
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("false"));
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();
    expect(loadLakeAreasMock).not.toHaveBeenCalled();
  });

  it("cancels an in-flight terrain request and reports the outcome", async () => {
    loadTerrainMock.mockImplementation((_project, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true })));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const generate = [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!;
    generate.click();
    await tick();
    expect(generate.textContent).toContain("Cancel generation");
    expect(target.querySelector(".generation-step")?.textContent).toBe("Step 1 of 3");
    const onStage = loadTerrainMock.mock.calls.at(-1)![2];
    onStage("preparing");
    await tick();
    expect(target.querySelector(".generation-step")?.textContent).toBe("Step 2 of 3");
    expect(target.querySelector(".generation-overlay")?.textContent).toContain("Preparing terrain and lake depths");
    generate.click();
    await tick(); await Promise.resolve();
    expect(target.querySelector(".status-line")?.textContent).toContain("Generation canceled");
    expect(target.querySelector(".generation-overlay")).toBeNull();
    onStage("fetching"); // Late progress must not replace the cancellation message.
    await tick();
    expect(target.querySelector(".status-line")?.textContent).toContain("Generation canceled");
  });

  it("preserves cosmetic edits made while terrain generation is in flight", async () => {
    let finishTerrain: (() => void) | undefined;
    loadTerrainMock.mockImplementation((requested: typeof DEFAULT_PROJECT) => new Promise((resolve) => {
      finishTerrain = () => resolve({
        source: {
          ...createSyntheticSource(requested, 32),
          sourceKind: "real" as const,
          vectorStatus: "available" as const,
        },
        fallback: false,
      });
    }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const generate = [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!;
    generate.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());

    const name = target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
    name.value = "Renamed while loading";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const exploded = target.querySelector<HTMLInputElement>(".explode-control input")!;
    exploded.value = "0.75";
    exploded.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    finishTerrain?.();

    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    expect(name.value).toBe("Renamed while loading");
    expect(target.querySelector<HTMLInputElement>(".explode-control input")?.value).toBe("0.75");
  });

  it("keeps terrain generation running when undo only restores the project name", async () => {
    let finishTerrain: (() => void) | undefined;
    let terrainSignal: AbortSignal | undefined;
    loadTerrainMock.mockImplementation((requested: typeof DEFAULT_PROJECT, signal: AbortSignal) => new Promise((resolve) => {
      terrainSignal = signal;
      finishTerrain = () => resolve({ source: { ...createSyntheticSource(requested, 32), sourceKind: "real" as const, vectorStatus: "available" as const }, fallback: false });
    }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const name = target.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
    name.value = "Renamed first";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    const generate = target.querySelector<HTMLButtonElement>(".generate-button")!;
    generate.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());

    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await tick();
    expect(name.value).toBe(DEFAULT_PROJECT.name);
    expect(terrainSignal?.aborted).toBe(false);
    expect(generate.textContent).toContain("Cancel generation");

    finishTerrain?.();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    expect(name.value).toBe(DEFAULT_PROJECT.name);
  });

  it("keeps terrain generation running through text-size edits and renders the latest size", async () => {
    let finishTerrain: (() => void) | undefined;
    let terrainSignal: AbortSignal | undefined;
    loadTerrainMock.mockImplementation((requested: typeof DEFAULT_PROJECT, signal: AbortSignal) => new Promise((resolve) => {
      terrainSignal = signal;
      finishTerrain = () => resolve({ source: { ...createSyntheticSource(requested, 32), sourceKind: "real" as const, vectorStatus: "available" as const }, fallback: false });
    }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const generate = target.querySelector<HTMLButtonElement>(".generate-button")!;
    generate.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());

    const size = target.querySelector<HTMLInputElement>('input[aria-label="Text size"]')!;
    size.value = "5";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(terrainSignal?.aborted).toBe(false);
    expect(generate.textContent).toContain("Cancel generation");
    // Undoing the style edit mid-run keeps the run alive too.
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await tick();
    target.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!.click();
    await tick();
    expect(terrainSignal?.aborted).toBe(false);

    finishTerrain?.();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Text size slider"]')?.value).toBe("5");
    expect(target.querySelector(".context-export-status")?.textContent).toContain("Ready to export");
  });

  it("applies style edits made during a generation that fails or is canceled", async () => {
    const { connectAtomm } = await import("$lib/atomm/atomm-bridge");
    let failTerrain: (() => void) | undefined;
    loadTerrainMock.mockImplementation((_project, signal: AbortSignal) => new Promise((_resolve, reject) => {
      failTerrain = () => reject(new Error("Elevation service unavailable"));
      signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
    }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const current = vi.mocked(connectAtomm).mock.lastCall![0] as () => { geometry: GeometryIRV1 };
    const generate = target.querySelector<HTMLButtonElement>(".generate-button")!;
    target.querySelector<HTMLButtonElement>(".linework-customize")!.click();
    await tick();
    const chooseTrailPattern = async (label: string) => {
      [...target.querySelectorAll<HTMLButtonElement>('.trail-pattern-options button[role="radio"]')].find((button) => button.textContent?.includes(label))!.click();
      await tick();
    };

    generate.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());
    await chooseTrailPattern("Dotted");
    expect(generate.textContent).toContain("Cancel generation");
    expect(current().geometry.lineStyle.trailPattern).not.toBe("dotted");
    failTerrain!();
    await vi.waitFor(() => expect(current().geometry.lineStyle.trailPattern).toBe("dotted"));
    expect(target.querySelector(".status-line")?.textContent).toContain("Elevation service unavailable");

    generate.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledTimes(2));
    await chooseTrailPattern("Dashed");
    generate.click();
    await vi.waitFor(() => expect(current().geometry.lineStyle.trailPattern).toBe("dashed"));
    expect(target.querySelector(".status-line")?.textContent).toContain("Generation canceled");
  });

  it("reports a rejected import on the status line without ending a running generation", async () => {
    loadTerrainMock.mockImplementation((_project, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true })));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const generate = target.querySelector<HTMLButtonElement>(".generate-button")!;
    generate.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledOnce());
    const input = target.querySelector<HTMLInputElement>('input[type="file"][accept^="application/json"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["not json"], "broken.json", { type: "application/json" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).not.toContain("Fetching elevation and map details"));
    expect(generate.textContent).toContain("Cancel generation");
    expect(target.querySelector(".preview-stage")?.getAttribute("aria-busy")).toBe("true");
  });

  it("does not let an unresolved platform toast block generation", async () => {
    window.atomm = {
      lifecycle: { on: vi.fn() },
      ui: { toast: vi.fn(() => new Promise<string>(() => undefined)), closeToast: vi.fn(async () => undefined) },
      app: { getLocale: vi.fn(async () => "en-US"), getSupportedLocales: vi.fn(async () => [{ code: "en", name: "English" }]) },
      user: { isLoggedIn: vi.fn(async () => false), login: vi.fn(async () => false) },
    };
    loadTerrainMock.mockImplementation(() => new Promise(() => undefined));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await tick();
    expect(loadTerrainMock).toHaveBeenCalledOnce();
  });

  it("updates every Map Details feature without pressing Generate", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    const cases = [
      ["Roads", "road"],
      ["Trails", "trail"],
      ["Water outlines", "water"],
      ["Assembly guides", "alignment"],
      ["Elevation labels", "elevation"],
      ["North arrow", "north"],
      ["Scale bar", "scale"],
    ] as const;

    for (const [label, attribute] of cases) {
      const input = target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;
      expect(Number(stage.dataset[`${attribute}Markings` as keyof DOMStringMap])).toBeGreaterThan(0);
      input.click();
      await vi.waitFor(() => expect(input.getAttribute("aria-checked"), label).toBe("false"));
      await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent, label).toMatch(/updated/i));
      await vi.waitFor(() => expect(stage.dataset[`${attribute}Markings` as keyof DOMStringMap], label).toBe("0"));
    }
    const transportationLabels = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Transportation labels"]')!;
    expect(transportationLabels.getAttribute("aria-checked")).toBe("false");
    transportationLabels.click();
    await vi.waitFor(() => expect(transportationLabels.getAttribute("aria-checked")).toBe("true"));
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("engraves a title from the project name, edits it, and keeps it when switched off", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalled(), { timeout: 2_000 });
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    expect(stage.dataset.plaqueMarkings).toBe("0");
    const title = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Title"]')!;
    title.click();
    const text = () => target.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title text"]');
    await vi.waitFor(() => expect(text()?.value).toBe("Crater Lake"));
    await vi.waitFor(() => expect(Number(stage.dataset.plaqueMarkings)).toBeGreaterThan(0));
    text()!.value = "Crater Lake\nOregon, 2026\nthird\nfourth line dropped";
    text()!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(text()!.value).toBe("Crater Lake\nOregon, 2026\nthird"));
    text()!.value = "Café";
    text()!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(target.querySelector(".plaque-warning")?.textContent).toContain("é"));
    title.click();
    await vi.waitFor(() => expect(stage.dataset.plaqueMarkings).toBe("0"));
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall![0].plaque).toMatchObject({ enabled: false, text: "Café", placement: { anchor: "bottom-left" } });
  });

  it("gives the title its own typeface, loaded on demand, keeping its case", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalled(), { timeout: 2_000 });
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Title"]')!.click();
    const picker = () => target.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="Title font"]')!;
    const options = () => [...target.querySelectorAll<HTMLElement>('[role="listbox"][aria-label="Title font"] [role="option"]')];
    await vi.waitFor(() => expect(picker()).not.toBeNull());
    expect(picker().textContent).toContain("Same as labels");
    picker().click();
    await vi.waitFor(() => expect(options()).toHaveLength(12));
    expect(options()[0]!.textContent).toContain("Same as labels");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    options().find((option) => option.textContent?.includes("Jost"))!.click();
    await vi.waitFor(() => expect(picker().textContent).toContain("Jost"));
    await vi.waitFor(() => expect(Number(stage.dataset.plaqueMarkings)).toBeGreaterThan(0));
    expect(target.querySelector("#plaque-text-hint")?.textContent).toContain("engraved as typed in Jost");
    const text = target.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title text"]')!;
    text.value = "Café Ωmega";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    // Jost draws é; Greek is outside the shipped subset.
    await vi.waitFor(() => expect(target.querySelector(".plaque-warning")?.textContent).toMatch(/Not in Jost.*Ω/));
    expect(target.querySelector(".plaque-warning")?.textContent).not.toContain("é");
    picker().click();
    await vi.waitFor(() => expect(options().find((option) => option.textContent?.includes("Jost"))?.getAttribute("aria-selected")).toBe("true"));
    // A click outside closes the list without choosing.
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    picker().click();
    await vi.waitFor(() => expect(options()).toHaveLength(12));
    options()[0]!.click();
    await vi.waitFor(() => expect(picker().textContent).toContain("Same as labels"));
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall![0].plaque).not.toHaveProperty("font");
  });

  it("keeps the current preview visible and interactive during an expensive detail refresh", async () => {
    const projectWithoutVectors = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false };
    const source = { ...createSyntheticSource(projectWithoutVectors, 32), sourceKind: "real" as const, vectorStatus: "not-requested" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadVectorMarkingsMock.mockImplementation((_bounds, _zoom, _project, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
    }));
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    for (const label of ["Roads", "Trails", "Water outlines", "Water depth"]) {
      target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!.click();
      await vi.waitFor(() => expect(target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!.getAttribute("aria-checked")).toBe("false"));
    }
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));

    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Roads"]')!.click();
    await tick();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    const feedback = stage.querySelector<HTMLElement>(".preview-update-overlay")!;
    expect(stage.getAttribute("aria-busy")).toBe("true");
    expect(feedback.textContent).toContain("Refreshing preview");
    expect(feedback.textContent).toContain("Updating map details");
    expect(getComputedStyle(feedback).pointerEvents).toBe("none");
    expect(stage.querySelector('[data-testid="three-preview"]')).not.toBeNull();
    expect(target.querySelector(".status-line")?.classList.contains("status-loading")).toBe(true);
  });

  it("enables labels after a real generation without refetching retained names", async () => {
    const source = { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" as const, markings: [{ id: "named-road", kind: "road" as const, operation: "engrave" as const, transportationClass: "major-road" as const, label: "Rim Drive", points: [{ x: -130, y: 0 }, { x: 130, y: 0 }] }] };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    expect(stage.dataset.transportationLabelMarkings).toBe("0");
    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Transportation labels"]')!.click();
    await vi.waitFor(() => expect(Number(stage.dataset.transportationLabelMarkings)).toBeGreaterThan(0));
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();
  });

  it("renders named road engravings when transportation labels are enabled", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    const labels = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Transportation labels"]')!;
    expect(stage.dataset.transportationLabelMarkings).toBe("0");
    labels.click();
    await vi.waitFor(() => expect(Number(stage.dataset.transportationLabelMarkings)).toBeGreaterThan(0));
    expect(target.querySelector(".status-line")?.textContent).toMatch(/updated/i);
    expect(loadTerrainMock).not.toHaveBeenCalled();
  });

  it("commits only the latest result when a detail is toggled rapidly", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const roads = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Roads"]')!;
    roads.click(); roads.click();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    await vi.waitFor(() => expect(Number(stage.dataset.roadMarkings)).toBeGreaterThan(0));
    expect(roads.getAttribute("aria-checked")).toBe("true");
  });

  it("fetches only vector markings when a generated source did not request them", async () => {
    const source = { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" as const, vectorStatus: "not-requested" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadVectorMarkingsMock.mockResolvedValue({
      markings: [{ id: "fetched-road", kind: "road", operation: "engrave", elevationM: source.elevation.min, points: [{ x: -100, y: -80 }, { x: 100, y: -80 }] }],
      inland: [],
      ocean: [],
    });
    loadLakeAreasMock.mockResolvedValue([]);
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    for (const label of ["Roads", "Trails", "Water outlines", "Water depth"]) {
      const input = target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;
      input.click();
      await vi.waitFor(() => expect(input.getAttribute("aria-checked")).toBe("false"));
    }
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    const roads = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Roads"]')!;
    roads.click();
    const stage = target.querySelector<HTMLElement>(".preview-stage")!;
    await vi.waitFor(() => expect(loadVectorMarkingsMock).toHaveBeenCalledOnce());
    expect(loadVectorMarkingsMock.mock.calls[0]?.[2]).toMatchObject({ showRoads: true, showTrails: false, showWater: false });
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Map details updated"));
    await vi.waitFor(() => expect(Number(stage.dataset.roadMarkings)).toBeGreaterThan(0));
    expect(loadTerrainMock).toHaveBeenCalledOnce();
  });


  it("refetches newly enabled vector categories after a complete generation", async () => {
    const generated = { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" as const, vectorStatus: "available" as const };
    loadTerrainMock.mockResolvedValue({ source: generated, fallback: false });
    loadVectorMarkingsMock.mockResolvedValue({
      markings: [{ id: "fetched-boundary", kind: "boundary", operation: "engrave", points: [{ x: -100, y: -40 }, { x: 100, y: 40 }] }],
      inland: [],
      ocean: [],
      truncated: false,
    });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="State and province boundaries"]')!.click();
    await vi.waitFor(() => expect(loadVectorMarkingsMock).toHaveBeenCalledOnce());
    expect(loadVectorMarkingsMock.mock.calls[0]?.[2]).toMatchObject({ showBoundaries: true });
  });

  it("fetches and renders state and province boundaries on demand", async () => {
    const projectWithoutVectors = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false, showBoundaries: false, showWaterDepth: false };
    const source = { ...createSyntheticSource(projectWithoutVectors, 32), sourceKind: "real" as const, vectorStatus: "not-requested" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadVectorMarkingsMock.mockResolvedValue({
      markings: [{ id: "fetched-boundary", kind: "boundary", operation: "engrave", points: [{ x: -100, y: -40 }, { x: 100, y: 40 }] }],
      inland: [],
      ocean: [],
    });
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    for (const label of ["Roads", "Trails", "Water outlines", "Water depth"]) {
      const input = target.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;
      input.click();
      await vi.waitFor(() => expect(input.getAttribute("aria-checked")).toBe("false"));
    }
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));

    const boundaries = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="State and province boundaries"]')!;
    boundaries.click();
    await vi.waitFor(() => expect(loadVectorMarkingsMock).toHaveBeenCalledOnce());
    expect(loadVectorMarkingsMock.mock.calls[0]?.[2]).toMatchObject({ showBoundaries: true, showRoads: false, showTrails: false, showWater: false });
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Map details updated"));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Cut layers"))!.click();
    await vi.waitFor(() => expect(target.querySelector('[data-marking-kind="boundary"]')).not.toBeNull());
    expect(boundaries.getAttribute("aria-checked")).toBe("true");
  });

  it("generates and renders a coordinate grid locally without fetching vectors", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();

    const coordinateGrid = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Latitude and longitude grid"]')!;
    coordinateGrid.click();
    await vi.waitFor(() => expect(coordinateGrid.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toMatch(/updated/i));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Cut layers"))!.click();
    await vi.waitFor(() => expect(target.querySelector('[data-marking-kind="grid"]')).not.toBeNull());
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();
  });

  it("imports a GPX file as markers and trails in one undo step", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalled(), { timeout: 2_000 });
    await openCustomData(target, "Import");
    const { lat, lon } = DEFAULT_PROJECT.location;
    const gpx = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="${lat}" lon="${lon}"/><trk><trkseg><trkpt lat="${lat}" lon="${lon}"/><trkpt lat="${lat + 0.01}" lon="${lon + 0.01}"/><trkpt lat="${lat + 0.02}" lon="${lon}"/></trkseg></trk></gpx>`;
    const input = target.querySelector<HTMLInputElement>("input[data-custom-import]")!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File([gpx], "hike.gpx", { type: "application/gpx+xml" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(target.textContent).toContain("Imported 1 path and 1 marker"));
    expect(target.querySelectorAll(".marker-card:not(.custom-line-card)")).toHaveLength(1);
    expect(target.querySelectorAll(".custom-line-card")).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    const saved = vi.mocked(saveProject).mock.lastCall![0];
    expect(saved.markers).toEqual([expect.objectContaining({ lat, lon, symbol: "pin" })]);
    expect(saved.customLines).toEqual([expect.objectContaining({ kind: "trail", points: [{ lat, lon }, { lat: lat + 0.01, lon: lon + 0.01 }, { lat: lat + 0.02, lon }] })]);
    target.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".marker-card")).toHaveLength(0));

    Object.defineProperty(input, "files", { configurable: true, value: [new File(["<gpx><trk>"], "broken.gpx")] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(target.textContent).toContain("This GPX file is not valid XML."));
  });

  it("places markers on the custom data view's own map, and ends placement when that map cannot be shown", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    await openCustomData(target, "Markers");
    const place = () => [...target.querySelectorAll<HTMLButtonElement>(".marker-add-button")].find((button) => button.title === "Click the map to place markers")!;
    await vi.waitFor(() => expect(place()).toBeDefined());
    expect(place().getAttribute("aria-pressed")).toBe("false");
    place().click();
    await tick();
    // Earlier map loading can report unavailable before this click.
    // Only the final disarmed state matters when WebGL is unavailable.
    // Placing no longer leaves this view: its viewport shows the same map.
    expect(target.querySelector('.mode-switch [aria-checked="true"]')?.textContent).toContain("Custom data");
    // jsdom has no WebGL, so the map says so, and a placement mode with no map
    // to click must not stay on.
    await vi.waitFor(() => expect(target.textContent).toContain("The map is unavailable in this browser"));
    await vi.waitFor(() => expect(place().getAttribute("aria-pressed")).toBe("false"));
    expect(target.querySelector('.mode-switch [aria-checked="true"]')?.textContent).toContain("Custom data");
  });

  it("swaps the sidebar for the custom data sections and opens one at a time", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    await openCustomData(target);
    // The project's size, terrain and linework controls say nothing about a
    // chart or a marker, so they give way entirely while this view is open.
    expect(target.querySelector("#section-size")).toBeNull();
    const headers = () => [...target.querySelectorAll<HTMLButtonElement>(".custom-data-section .section-disclosure")];
    expect(headers().map((header) => header.querySelector(".section-title")!.textContent)).toEqual([
      "Depth chartsTrace a printed chart",
      "MarkersNone yet",
      "Trails & boundariesNone yet",
      "GraphicsLogos and artwork",
      "ImportGPX, KML or GeoJSON",
    ]);
    // Depth charts opens first, and its tools are in the sidebar beside the
    // chart the viewport shows.
    expect(headers()[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(target.querySelector<HTMLElement>("#custom-data-charts")?.hidden).toBe(false);
    expect(target.querySelector("#custom-data-charts")?.textContent).toContain("Search a lake or nearby town");
    expect(target.querySelector(".chart-lake-map")?.textContent).toContain("Choose the lake your chart shows");
    expect(target.querySelector(".generate-dock")).toBeNull();

    // The active section can close without switching or unmounting the workspace.
    const chartStage = target.querySelector(".chart-lake-map");
    headers()[0]!.click();
    await tick();
    expect(headers().every((header) => header.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(target.querySelector<HTMLElement>("#custom-data-charts")?.hidden).toBe(true);
    expect(target.querySelector(".chart-lake-map")).toBe(chartStage);
    headers()[0]!.click();
    await tick();
    expect(headers()[0]!.getAttribute("aria-expanded")).toBe("true");

    // Every data type supports open → close → reopen, including switching from closed.
    for (const header of headers().slice(1)) {
      header.click();
      await tick();
      expect(header.getAttribute("aria-expanded")).toBe("true");
      header.click();
      await tick();
      expect(headers().every((item) => item.getAttribute("aria-expanded") === "false")).toBe(true);
      expect(target.querySelector<HTMLElement>(`#${header.getAttribute("aria-controls")}`)?.hidden).toBe(true);
    }
    headers()[4]!.click();
    await tick();
    expect(headers()[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(target.querySelector<HTMLElement>("#custom-data-import")?.hidden).toBe(false);
    expect(target.querySelector(".chart-lake-map"), "the map takes the viewport for anything placed on it").toBeNull();
  });

  it("adds, edits, symbolizes, and removes an arbitrary marker list", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    // Wait for startup restore to enable autosave before editing the marker.
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalled(), { timeout: 2_000 });
    await openCustomData(target, "Markers");

    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add marker"))!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".marker-card")).toHaveLength(1));
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Marker 1 latitude"]')?.value).toBe(String(DEFAULT_PROJECT.location.lat));
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Marker 1 longitude"]')?.value).toBe(String(DEFAULT_PROJECT.location.lon));
    const size = target.querySelector<HTMLInputElement>('input[aria-label="Marker 1 size"]')!;
    expect(size.value).toBe("8");
    size.value = "16";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(size.value).toBe("16");
    // Flush the pending snapshot: covered preview work can occupy the main
    // thread longer than waitFor's default timeout before the save timer runs.
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall?.[0].markers[0]?.sizeMm).toBe(16);
    const star = target.querySelector<HTMLButtonElement>('.marker-symbol-options button[title="Star"]')!;
    star.click();
    await vi.waitFor(() => expect(star.getAttribute("aria-checked")).toBe("true"));
    await vi.waitFor(() => expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.markerMarkings)).toBeGreaterThan(0));
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();

    target.querySelector<HTMLButtonElement>('button[aria-label="Remove marker 1"]')!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".marker-card")).toHaveLength(0));
    await vi.waitFor(() => expect(target.querySelector<HTMLElement>(".preview-stage")?.dataset.markerMarkings).toBe("0"));
  });

  it("names a marker and a path, and keeps the name out of the export fingerprint", async () => {
    const { saveProject } = await import("$lib/storage/storage");
    vi.mocked(saveProject).mockClear();
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalled(), { timeout: 2_000 });
    await openCustomData(target, "Markers");
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add marker"))!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".marker-card")).toHaveLength(1));
    const exportStatus = () => target.querySelector(".context-export-status")?.textContent;
    const before = exportStatus();

    const name = target.querySelector<HTMLInputElement>('input[aria-label="Name for marker 1"]')!;
    // Until one is typed, the card is called by its number.
    expect(name.value).toBe("");
    expect(name.placeholder).toBe("Marker 1");
    name.value = "Trailhead";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(target.querySelector('button[aria-label="Remove Trailhead"]')).not.toBeNull();
    // A name carves nothing, so it must not make the export stale.
    expect(exportStatus()).toBe(before);

    await openCustomData(target, "Trails & boundaries");
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add path"))!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".custom-line-card")).toHaveLength(1));
    const pathName = target.querySelector<HTMLInputElement>('input[aria-label="Name for path 1"]')!;
    pathName.value = "  North boundary  ";
    pathName.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    window.dispatchEvent(new Event("pagehide"));
    const saved = vi.mocked(saveProject).mock.lastCall![0];
    expect(saved.markers[0]).toMatchObject({ name: "Trailhead" });
    expect(saved.customLines[0], "a name is stored trimmed").toMatchObject({ name: "North boundary" });

    // Blanking it removes the name rather than storing an empty one.
    name.value = "";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.mocked(saveProject).mock.lastCall![0].markers[0]).not.toHaveProperty("name");
    expect(target.querySelector('button[aria-label="Remove marker 1"]')).not.toBeNull();
  });

  it("adds custom trail and boundary paths with arbitrary coordinate points", async () => {
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();

    await openCustomData(target, "Trails & boundaries");
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add path"))!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".custom-line-card")).toHaveLength(1));
    expect(target.querySelectorAll<HTMLInputElement>('input[aria-label^="Path 1 point"]')).toHaveLength(4);
    const boundary = [...target.querySelectorAll<HTMLButtonElement>('.custom-line-kind-options button[role="radio"]')].find((button) => button.textContent?.includes("Boundary"))!;
    boundary.click();
    await vi.waitFor(() => expect(boundary.getAttribute("aria-checked")).toBe("true"));
    target.querySelector<HTMLButtonElement>(".custom-point-add")!.click();
    await vi.waitFor(() => expect(target.querySelectorAll<HTMLInputElement>('input[aria-label^="Path 1 point"]')).toHaveLength(6));
    await vi.waitFor(() => expect(Number(target.querySelector<HTMLElement>(".preview-stage")?.dataset.customLineMarkings)).toBeGreaterThan(0));
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();

    target.querySelector<HTMLButtonElement>('button[aria-label="Remove point 3 from path 1"]')!.click();
    await vi.waitFor(() => expect(target.querySelectorAll<HTMLInputElement>('input[aria-label^="Path 1 point"]')).toHaveLength(4));
    target.querySelector<HTMLButtonElement>('button[aria-label="Remove path 1"]')!.click();
    await vi.waitFor(() => expect(target.querySelectorAll(".custom-line-card")).toHaveLength(0));
    await vi.waitFor(() => expect(target.querySelector<HTMLElement>(".preview-stage")?.dataset.customLineMarkings).toBe("0"));
  });


  it("loads lake metadata when switching a generated engraving back to layered relief", async () => {
    loadTerrainMock.mockImplementation(async (requested: typeof DEFAULT_PROJECT) => ({
      source: { ...createSyntheticSource(requested, 32), sourceKind: "real" as const, vectorStatus: "available" as const, lakeDataStatus: "not-requested" as const },
      fallback: false,
    }));
    loadLakeAreasMock.mockResolvedValue([]);
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Flat engraving"]')!.click();
    await vi.waitFor(() => expect(target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Flat engraving"]')!.getAttribute("aria-checked")).toBe("true"));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Engraving ready"));
    target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Layered relief"]')!.click();
    await vi.waitFor(() => expect(loadLakeAreasMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(target.querySelector<HTMLButtonElement>('button[role="radio"][aria-label="Layered relief"]')!.getAttribute("aria-checked")).toBe("true"));
  });

  it.each([[false, false], [true, false], [false, true]])("loads NOAA on enabling depth (unavailable=%s, OSM fallback=%s)", async (unavailable, osmFallback) => {
    noaaArchive.getHeader.mockResolvedValue({ tileType: 2, minZoom: 0, maxZoom: 11 });
    noaaArchive.getMetadata.mockResolvedValue({ topostack_dataset: "noaa-great-lakes-v1", topostack_encoding: "depth-terrarium-v1" });
    const png = readFileSync("src/lib/domain/fixtures/noaa-erie-z11.png");
    if (unavailable) noaaArchive.getZxy.mockRejectedValue(new Error("NOAA offline"));
    else noaaArchive.getZxy.mockResolvedValue({ data: Uint8Array.from(png).buffer });
    const source = {
      ...createSyntheticSource(DEFAULT_PROJECT, 16), bounds: noaaFixture.bounds,
      elevation: { width: 16, height: 16, values: new Float32Array(256).fill(180), min: 180, max: 180 },
      sourceKind: "real" as const, vectorStatus: "available" as const, lakeDataStatus: "not-requested" as const, waterAreas: [],
    };
    const polygon = { outer: [{ x: -80, y: -60 }, { x: 80, y: -60 }, { x: 80, y: 60 }, { x: -80, y: 60 }, { x: -80, y: -60 }], holes: [] };
    loadTerrainMock.mockResolvedValue({ source: { ...source, inlandWaterAreas: osmFallback ? [polygon] : [] }, fallback: false });
    if (osmFallback) loadLakeAreasMock.mockRejectedValue(new Error("Lake archive offline"));
    else loadLakeAreasMock.mockResolvedValue([{
      id: "erie", hylakId: 9, kind: "lake", name: "Erie", maxDepthM: 64, lmaxM: 10000, polygon,
    }]);
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();
    const depth = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Water depth"]')!;
    depth.click();
    await vi.waitFor(() => expect(depth.getAttribute("aria-checked")).toBe("false"));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    expect(noaaArchive.getZxy).not.toHaveBeenCalled();
    depth.click();
    await vi.waitFor(() => expect(noaaArchive.getZxy).toHaveBeenCalled());
    await vi.waitFor(() => expect(target.textContent).toContain(unavailable ? "Some surveyed lake-floor data is unavailable" : "Surveyed lake-floor data is used where available"));
    expect(target.querySelector(".context-export-status")?.textContent).toContain("Ready to export");
    if (!unavailable) {
      const calls = noaaArchive.getZxy.mock.calls.length;
      const slider = target.querySelector<HTMLInputElement>('input[aria-label="Water depth exaggeration slider"]')!;
      slider.value = "2";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("updated"));
      expect(noaaArchive.getZxy).toHaveBeenCalledTimes(calls);
    }
  });

  it("fetches lake metadata when water depth is enabled after generation", async () => {
    const projectWithoutDepth = { ...DEFAULT_PROJECT, showWaterDepth: false };
    const source = {
      ...createSyntheticSource(projectWithoutDepth, 32),
      sourceKind: "real" as const,
      vectorStatus: "available" as const,
      lakeDataStatus: "not-requested" as const,
      waterAreas: [],
    };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    loadLakeAreasMock.mockResolvedValue([]);
    const target = document.createElement("div");
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await tick();

    const depth = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Water depth"]')!;
    depth.click();
    await vi.waitFor(() => expect(depth.getAttribute("aria-checked")).toBe("false"));
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Generate terrain"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));

    depth.click();
    await vi.waitFor(() => expect(loadLakeAreasMock).toHaveBeenCalledOnce());
    expect(loadVectorMarkingsMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(depth.getAttribute("aria-checked")).toBe("true"));
  });

  it("loads terrain on its own inside Atomm, follows the map area, and previews the export", async () => {
    // The embed is detected by running in a frame.
    const parent = Object.getOwnPropertyDescriptor(window, "parent");
    Object.defineProperty(window, "parent", { configurable: true, value: {} });
    const createObjectURL = vi.fn(() => "blob:export-preview");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    onTestFinished(() => { if (parent) Object.defineProperty(window, "parent", parent); });
    const source = { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" as const, vectorStatus: "available" as const, lakeDataStatus: "available" as const };
    loadTerrainMock.mockResolvedValue({ source, fallback: false });
    const target = document.createElement("div");
    document.body.append(target);
    onTestFinished(() => target.remove());
    component = mount(App, { target, props: { initialPreview: structuredClone(initialPreview) } });
    await vi.waitFor(() => expect(target.querySelector(".atomm-workbench")).not.toBeNull());

    // No Generate step: the bundled preview is replaced by real terrain on its own.
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Real terrain ready"));
    expect(loadTerrainMock).toHaveBeenCalledOnce();
    expect(target.querySelector(".generate-button, .generate-retry")).toBeNull();
    expect([...target.querySelectorAll('.mode-switch [role="radio"]')].map((tab) => tab.textContent?.trim())).toEqual(["2D", "3D", "Export"]);
    // Depth charts and graphics belong to the full studio.
    expect(target.textContent).not.toContain("Upload SVG");

    // A new place reloads its terrain without pressing anything.
    [...target.querySelectorAll<HTMLButtonElement>(".preset-row button")].find((button) => button.textContent?.includes("Rainier"))!.click();
    await vi.waitFor(() => expect(loadTerrainMock).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    await vi.waitFor(() => expect(target.querySelector(".status-line")?.textContent).toContain("Terrain loaded for the new map area"));
    expect(target.querySelector(".generate-retry")).toBeNull();

    [...target.querySelectorAll<HTMLButtonElement>('.mode-switch [role="radio"]')].find((tab) => tab.textContent?.includes("Export"))!.click();
    await vi.waitFor(() => expect(target.querySelector(".export-manifest")?.textContent).toMatch(/Open in Studio.*master\.svg/), { timeout: 5_000 });
    expect(target.querySelector(".export-manifest-row")?.textContent).toMatch(/Open in Studio.*1 editable SVG.*Entire layout/);
    expect(target.querySelector(".export-manifest summary")?.textContent).toMatch(/Download.*Complete project bundle.*\d+ files.*View included files/);
    expect(target.querySelector(".export-sheet image")?.getAttribute("href")).toBe("blob:export-preview");

    // Tips step through one slide at a time.
    [...target.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Tips")!.click();
    const tips = target.querySelector<HTMLDialogElement>(".atomm-tips-dialog")!;
    await vi.waitFor(() => expect(tips.open).toBe(true));
    expect(tips.querySelector("h3")?.textContent).toBe("Pick a place");
    [...tips.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Next")!.click();
    await tick();
    expect(tips.querySelector("h3")?.textContent).toBe("Terrain layers");
  });
});
