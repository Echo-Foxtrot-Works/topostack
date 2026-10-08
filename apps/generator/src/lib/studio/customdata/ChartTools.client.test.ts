import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import type { ChartBuildResult } from "$lib/domain/chart-build";
import type { ChartableLake } from "$lib/domain/lake-lookup";
import type { SavedChartSummary } from "$lib/storage/user-charts";
import type { StudioContext } from "$lib/studio/studio-context";

const lookup = vi.hoisted(() => ({ lakesNear: vi.fn(), wholeLake: vi.fn(), searchPlaces: vi.fn() }));
const storage = vi.hoisted(() => ({ listUserCharts: vi.fn(), deleteUserChart: vi.fn() }));
const builds = vi.hoisted(() => [] as { request: Record<string, unknown>; resolve: (result: unknown) => void }[]);
vi.mock("$lib/domain/lake-lookup", () => ({ lakesNear: lookup.lakesNear, wholeLake: lookup.wholeLake }));
vi.mock("$lib/domain/geocode", () => ({ searchPlaces: lookup.searchPlaces }));
vi.mock("$lib/storage/user-charts", () => ({ listUserCharts: storage.listUserCharts, deleteUserChart: storage.deleteUserChart }));
vi.mock("$lib/workers/chart-trace-client", () => ({
  ChartTraceClient: class {
    prepare(request: Record<string, unknown>) { return this.build(request); }
    build(request: Record<string, unknown>) { return new Promise((resolve) => builds.push({ request, resolve })); }
    dispose() {}
  },
}));

const { default: ChartTools } = await import("$lib/studio/customdata/ChartTools.svelte");
const { default: WithStudio } = await import("$lib/studio/testing/WithStudio.svelte");
const { draft, resetDraft } = await import("$lib/studio/customdata/chart-draft.svelte");
const { library } = await import("$lib/studio/customdata/chart-library.svelte");
const { resetSession, traceInputsKey } = await import("$lib/studio/customdata/chart-tracing.svelte");

const HASH = "a".repeat(64);
const lake = (overrides: Partial<ChartableLake> = {}): ChartableLake => ({ id: "lake-1", name: "Round Lake", hylakId: 9092, footprint: 1, spanKm: [2, 1], distanceKm: 3, clipped: false, outline: [[-80, 45], [-79.99, 45], [-79.99, 45.01]], ...overrides });
const saved = (overrides: Partial<SavedChartSummary> = {}): SavedChartSummary => ({ reviewed: true, id: "round-lake-chart", savedAt: "2026-09-01T00:00:00Z", name: "Round Lake depth chart", lakeName: "Round Lake", hylakId: 9092, contentHash: HASH, ...overrides });

function stubStudio(project: Partial<ProjectConfigV1> = {}) {
  return {
    project: { ...DEFAULT_PROJECT, ...project },
    geometry: { waterSurfaces: [] },
    saveChartToLibrary: vi.fn(async () => ({ id: "round-lake-chart", contentHash: HASH })),
    useChartForLake: vi.fn(async () => {}),
    clearDepthChart: vi.fn(async (_key: string) => {}),
  };
}

describe("the depth chart tools", () => {
  let component: ReturnType<typeof mount> | undefined;
  beforeAll(() => { HTMLCanvasElement.prototype.getContext ??= () => null; });
  beforeEach(() => {
    storage.listUserCharts.mockResolvedValue([]);
    storage.deleteUserChart.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    if (component) await unmount(component);
    component = undefined;
    document.body.replaceChildren();
    resetDraft();
    resetSession();
    library.saved = [];
    library.note = "";
    library.error = "";
    builds.length = 0;
    vi.clearAllMocks();
  });

  async function open(studio = stubStudio()): Promise<HTMLElement> {
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio: studio as unknown as StudioContext, component: ChartTools } });
    await vi.waitFor(() => expect(storage.listUserCharts).toHaveBeenCalled());
    await tick();
    return target;
  }
  const button = (target: HTMLElement, text: string | RegExp) => [...target.querySelectorAll("button")].find((item) => (typeof text === "string" ? item.textContent?.trim() === text : text.test(item.textContent ?? "")));

  it("reports library failures and lets the maker retry without losing the draft", async () => {
    storage.listUserCharts.mockRejectedValueOnce(new Error("Storage unavailable"));
    const target = await open();
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toContain("saved charts could not be loaded"));
    expect(target.textContent).not.toContain("Nothing kept yet");
    button(target, "Try again")!.click();
    await vi.waitFor(() => expect(target.textContent).toContain("Nothing kept yet"));
    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it("finds lakes near a place, names surveyed ones, and loads the whole of a cut-off lake it picks", async () => {
    lookup.searchPlaces.mockResolvedValue([{ id: "walker", label: "Walker, MN", lat: 47.1, lon: -94.6 }]);
    lookup.lakesNear.mockResolvedValue({ lakes: [lake({ clipped: true })], ponds: [lake({ id: "osm-lake-0", name: "Lake from the map", hylakId: undefined, spanKm: [0.4, 0.3], distanceKm: 1.2 })], surveyed: ["Leech (Main Basin)"] });
    const whole = lake({ spanKm: [9, 7] });
    lookup.wholeLake.mockResolvedValue(whole);
    const target = await open();
    const input = target.querySelector<HTMLInputElement>('input[aria-label="Search for a lake"]')!;
    input.value = "Walker";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    target.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(target.textContent).toContain("Lake from the map"));
    expect(target.textContent).toContain("At least 2.0 × 1.0 km");
    expect(target.textContent).toContain("400 × 300 m · 1.2 km away");
    expect(target.textContent).toContain("Leech (Main Basin) has a published survey and already carves from it");
    button(target, /Round Lake/)!.click();
    await vi.waitFor(() => expect(draft.lake).toEqual(whole));
    expect(lookup.wholeLake).toHaveBeenCalledWith(expect.objectContaining({ clipped: true }), expect.any(AbortSignal));
    expect(draft.title).toBe("Round Lake depth chart");
  });

  it("uses a kept chart under its lake's key, and lets go of one this browser does not have", async () => {
    storage.listUserCharts.mockResolvedValue([saved(), saved({ id: "pond-chart-0001", name: "Pond chart", lakeName: "Lake from the map", hylakId: undefined })]);
    const studio = stubStudio({ userDepthCharts: { "outline:pond-chart-0001": { id: "pond-chart-0001", contentHash: HASH }, "555": { id: "gone-lake-chart", contentHash: HASH } } });
    const target = await open(studio);
    await vi.waitFor(() => expect(target.textContent).toContain("A chart this project uses"));
    expect(target.textContent).toContain("In use for Lake from the map");
    button(target, "Use for Round Lake")!.click();
    expect(studio.useChartForLake).toHaveBeenCalledWith("9092", { id: "round-lake-chart", contentHash: HASH });
    const stops = [...target.querySelectorAll("button")].filter((item) => item.textContent?.trim() === "Stop using");
    stops.forEach((item) => item.click());
    expect(studio.clearDepthChart.mock.calls.map(([key]) => key).sort()).toEqual(["555", "outline:pond-chart-0001"]);
  });

  it("deletes only on a second press, and stops a lake using the chart first", async () => {
    storage.listUserCharts.mockResolvedValue([saved()]);
    const studio = stubStudio({ userDepthCharts: { "9092": { id: "round-lake-chart", contentHash: HASH } } });
    const target = await open(studio);
    await vi.waitFor(() => expect(button(target, "Delete")).toBeDefined());
    button(target, "Delete")!.click();
    await tick();
    expect(storage.deleteUserChart).not.toHaveBeenCalled();
    button(target, "Delete for good?")!.click();
    await vi.waitFor(() => expect(storage.deleteUserChart).toHaveBeenCalledWith("round-lake-chart"));
    expect(studio.clearDepthChart).toHaveBeenCalledWith("9092");
    expect(studio.clearDepthChart.mock.invocationCallOrder[0]!).toBeLessThan(storage.deleteUserChart.mock.invocationCallOrder[0]!);
  });

  it("offers the next placement when the lake fits the chart more than one way", async () => {
    draft.lake = lake();
    draft.image = { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4) };
    draft.depths = [{ x: 1, y: 1, value: 10, reach: 2 }, { x: 5, y: 5, value: 20, reach: 2 }, { x: 9, y: 9, value: 30, reach: 2 }];
    draft.result = { record: { id: "round-lake-chart" }, report: { placements: 3, placement: 0, ambiguous: true, deepestM: 6, coverage: 1, iou: 0.97, snapUncertain: false } } as unknown as ChartBuildResult;
    draft.resultKey = traceInputsKey();
    const target = await open();
    const next = button(target, /Try another placement \(1 of 3\)/);
    expect(next).toBeDefined();
    next!.click();
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    expect(builds[0]!.request.placement).toBe(1);
  });
});
