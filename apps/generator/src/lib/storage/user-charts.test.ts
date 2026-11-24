import { buildChartFromImage } from "$lib/domain/chart-build";
import { reviewFixture } from "$lib/domain/testing/chart-review-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProjectPackage, carveWaterDepth, createSyntheticSource, DEFAULT_PROJECT, DEPTH_CHART_ID_PATTERN, generateGeometry, type ProjectConfigV1, type WaterAreaV1 } from "@topostack/core";
import { CHART_BATHYMETRY_SCHEMA, CHART_ID_PATTERN, encodeChartDepths, type UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import { strFromU8, unzipSync } from "fflate";
import { applyUserCharts } from "$lib/domain/user-bathymetry";
import { prepareSelectedDownload } from "$lib/studio/native-export";
import { readProjectFile } from "$lib/studio/project-file";

const store = vi.hoisted(() => new Map<string, unknown>());
const failReads = vi.hoisted(() => ({ enabled: false }));
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => { if (failReads.enabled) throw new Error("Storage is blocked"); return store.get(key); }),
  set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  del: vi.fn(async (key: string) => { store.delete(key); }),
  keys: vi.fn(async () => [...store.keys()]),
  getMany: vi.fn(async (keys: string[]) => { if (failReads.enabled) throw new Error("Storage is blocked"); return keys.map((key) => store.get(key)); }),
}));

const { chartContentHash, chartsForProject, currentChartReferences, deleteUserChart, listUserCharts, loadUserChart, loadUserCharts, saveProjectCharts, saveUserChart } = await import("$lib/storage/user-charts");

const chart = (id = "round-lake-chart", name = "Round Lake"): UserChartBathymetryV1 => ({
  schema: CHART_BATHYMETRY_SCHEMA,
  id,
  lake: { name, outline: [[-80, 45], [-79.99, 45], [-79.99, 45.01], [-80, 45]] },
  georef: { method: "snap", matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], rmsM: 2, iou: 0.95 },
  units: "m",
  labels: { kind: "depth" },
  intervalM: 1,
  contours: [{ depthM: 1, line: [[-79.999, 45.002], [-79.995, 45.005]], closed: false }],
  spots: [],
  grid: { bounds: { west: -80, south: 45, east: -79.99, north: 45.01 }, width: 2, height: 2, method: "harmonic", depthsDm: encodeChartDepths([0, 1, 2, 3]) },
  provenance: { title: `${name} depth map`, fileSha256: "a".repeat(64), tool: "chart-trace@test" },
  license: { attestation: "own-work" },
});

beforeEach(() => {
  store.clear();
  failReads.enabled = false;
  vi.restoreAllMocks();
});

describe("saved depth charts", () => {
  it("saves a chart under its own key and reads it back with the hash a project pins", async () => {
    const reference = await saveUserChart(chart());
    expect(reference.id).toBe("round-lake-chart");
    expect(reference.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect([...store.keys()].sort()).toEqual(["topostack:chart-summary:v1:round-lake-chart", "topostack:chart:v1:round-lake-chart"]);
    const loaded = await loadUserChart("round-lake-chart");
    expect(loaded?.contentHash).toBe(reference.contentHash);
    expect(loaded?.chart.lake.name).toBe("Round Lake");
    // The same chart always hashes the same, so a project's pin is stable.
    expect(await chartContentHash(chart())).toBe(reference.contentHash);
  });

  it("treats a missing, unreadable, or unavailable chart as no chart", async () => {
    expect(await loadUserChart("absent-lake-chart")).toBeUndefined();
    store.set("topostack:chart:v1:broken-lake-chart", { chart: { schema: "nonsense" } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadUserChart("broken-lake-chart")).toBeUndefined();
    failReads.enabled = true;
    expect(await loadUserChart("round-lake-chart")).toBeUndefined();
  });

  it("loads one chart per lake, sharing a chart used twice", async () => {
    const ready = buildChartFromImage(reviewFixture().request).record;
    ready.review = { version: 1, profile: "closed-contours-v1", reviewedAt: new Date().toISOString(), contours: true, alignment: true, layers: true };
    const one = await saveUserChart({ ...ready, id: "round-lake-chart" });
    const two = await saveUserChart({ ...ready, id: "other-lake-chart" });
    const charts = await loadUserCharts({ "1": one, "2": one, "3": two, "4": { id: "absent-lake-chart", contentHash: "b".repeat(64) } });
    expect([...charts.keys()]).toEqual(["1", "2", "3"]);
    expect(charts.get("1")).toBe(charts.get("2"));
    expect(charts.get("3")!.chart.id).toBe("other-lake-chart");
    expect(await loadUserCharts(undefined)).toEqual(new Map());
  });

  it("retains legacy charts for export but excludes them from generation", async () => {
    const reference = await saveUserChart(chart());
    expect(await loadUserChart(reference.id)).toBeDefined();
    expect((await listUserCharts())[0]?.reviewed).toBe(false);
    expect(await loadUserCharts({ "1": reference })).toEqual(new Map());
    expect(await chartsForProject({ userDepthCharts: { "1": reference } })).toHaveLength(1);
  });

  it("lists saved charts newest first and deletes one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await saveUserChart(chart());
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    await saveUserChart(chart("other-lake-chart", "Other Lake"));
    vi.useRealTimers();
    // Listed by the chart's own name, with the lake it can carve beside it.
    expect((await listUserCharts()).map((item) => item.name)).toEqual(["Other Lake depth map", "Round Lake depth map"]);
    expect((await listUserCharts()).map((item) => item.lakeName)).toEqual(["Other Lake", "Round Lake"]);
    expect((await listUserCharts()).every((item) => item.hylakId === undefined)).toBe(true);
    await deleteUserChart("other-lake-chart");
    expect((await listUserCharts()).map((item) => item.id)).toEqual(["round-lake-chart"]);
    expect([...store.keys()].some((key) => key.includes("other-lake-chart")), "the summary goes with the chart").toBe(false);
  });

  it("lists from summaries without reading whole charts, and gives an older chart one", async () => {
    await saveUserChart(chart());
    // A chart saved before summaries existed.
    const legacy = chart("older-lake-chart", "Older Lake");
    store.set("topostack:chart:v1:older-lake-chart", { savedAt: "2025-01-01T00:00:00Z", contentHash: await chartContentHash(legacy), chart: legacy });
    const { get } = await import("idb-keyval");
    vi.mocked(get).mockClear();
    expect((await listUserCharts()).map((item) => item.id)).toEqual(["round-lake-chart", "older-lake-chart"]);
    expect(vi.mocked(get).mock.calls.map(([key]) => key), "only the chart with no summary is read whole").toEqual(["topostack:chart:v1:older-lake-chart"]);
    expect(store.has("topostack:chart-summary:v1:older-lake-chart")).toBe(true);
    vi.mocked(get).mockClear();
    await listUserCharts();
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("brings a project's references up to the charts as saved now", async () => {
    const first = await saveUserChart(chart());
    const references = { "1": first, "2": { id: "absent-lake-chart", contentHash: "b".repeat(64) } };
    expect(await currentChartReferences(references), "nothing changed: the same object").toBe(references);
    // The same chart saved again with different content, as an import would.
    const second = await saveUserChart({ ...chart(), intervalM: 2 });
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(await currentChartReferences(references)).toEqual({ "1": second, "2": references["2"] });
    expect(await currentChartReferences(undefined)).toBeUndefined();
  });
});

describe("charts travelling with a project file", () => {
  it("exports only the charts the project references", async () => {
    const one = await saveUserChart(chart());
    await saveUserChart(chart("other-lake-chart", "Other Lake"));
    expect((await chartsForProject({ userDepthCharts: { "1": one, "2": one } })).map((item) => item.id)).toEqual(["round-lake-chart"]);
    expect(await chartsForProject({})).toEqual([]);
  });

  it("rejects a backup when a referenced chart is absent or differs from the pinned record", async () => {
    const reference = await saveUserChart(chart());
    const project = { userDepthCharts: { "1": reference } };
    await saveUserChart({ ...chart(), intervalM: 2 });
    await expect(chartsForProject(project)).rejects.toThrow(/round-lake-chart/);
    // The record's canonical contents must still match even if the cached hash is stale.
    const key = "topostack:chart:v1:round-lake-chart";
    store.set(key, { chart: { ...chart(), intervalM: 2 }, contentHash: reference.contentHash });
    await expect(chartsForProject(project)).rejects.toThrow(/round-lake-chart/);
    store.delete(key);
    await expect(chartsForProject(project)).rejects.toThrow(/round-lake-chart/);
  });

  it.each(["stack", "engraving"] as const)("restores 17 reviewed charts and the same carved bed from the complete %s ZIP", async (outputMode) => {
    const { request } = reviewFixture();
    const ready = buildChartFromImage(request).record;
    ready.review = { version: 1, profile: "closed-contours-v1", reviewedAt: "2026-11-22T12:00:00Z", contours: true, alignment: true, layers: true };
    const refs: NonNullable<ProjectConfigV1["userDepthCharts"]> = {};
    for (let lake = 1; lake <= 17; lake++) {
      refs[String(lake)] = await saveUserChart({ ...ready, id: `reviewed-lake-${lake}`, lake: { ...ready.lake, hylakId: lake } });
    }
    const project = { ...DEFAULT_PROJECT, name: "Chart backup", outputMode, widthMm: 100, heightMm: 100, userDepthCharts: refs };
    const bounds = ready.grid.bounds;
    const elevation = { width: 21, height: 21, min: 100, max: 100, values: new Float32Array(21 ** 2).fill(100) };
    const lake: WaterAreaV1 = { id: "lake-17", hylakId: 17, kind: "lake", polygon: {
      outer: [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }], holes: [],
    } };
    const prepareLake = async (config: ProjectConfigV1) => {
      const result = await applyUserCharts({ areas: [lake], status: "not-covered", datasetVersions: [], attribution: [] },
        await loadUserCharts(config.userDepthCharts), bounds, elevation, undefined, config);
      return { areas: result.areas, carved: carveWaterDepth(elevation, config, result.areas, 1000) };
    };
    const before = await prepareLake(project);
    expect(before.carved.surfaces[0]).toMatchObject({ depthSource: "user", bathymetryOrigin: "chart" });
    expect(before.carved.grid.min).toBeLessThan(100);
    const geometry = generateGeometry(project, { ...createSyntheticSource(project, 21), sourceKind: "real", lakeDataStatus: "available", vectorStatus: "available", bounds, elevation, waterAreas: before.areas });
    const output = buildProjectPackage(geometry, project, { charts: await chartsForProject(project) });
    const download = await prepareSelectedDownload(output, "all");
    const entries = unzipSync(new Uint8Array(await download.blob.arrayBuffer()));
    expect(entries[outputMode === "stack" ? "chart-backup-master.svg" : "chart-backup-engraving.svg"]).toBeDefined();
    const filename = "chart-backup-project.json";
    const json = strFromU8(entries[filename]!);

    store.clear();
    const restored = await readProjectFile(new File([json], filename));
    expect(restored.savedCharts).toBe(17);
    expect(restored.project.userDepthCharts).toEqual(refs);
    const restoredCharts = await loadUserCharts(restored.project.userDepthCharts);
    expect([...restoredCharts.values()].map(item => item.contentHash).sort()).toEqual(Object.values(refs).map(ref => ref.contentHash).sort());
    const after = await prepareLake(restored.project);
    expect(after.carved.surfaces).toEqual(before.carved.surfaces);
    expect(after.carved.grid.values).toEqual(before.carved.grid.values);
  });

  it("saves only referenced charts on import and skips the rest", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hash = await chartContentHash(chart());
    const config = { userDepthCharts: { "1": { id: "round-lake-chart", contentHash: hash } } };
    const result = await saveProjectCharts([chart(), chart("other-lake-chart", "Other Lake"), { schema: "nonsense" }], config);
    expect(result).toEqual({ saved: 1, skipped: 2 });
    expect(await loadUserChart("round-lake-chart")).toBeDefined();
    // A project file cannot fill this browser with charts nothing uses.
    expect(await loadUserChart("other-lake-chart")).toBeUndefined();
    expect(await saveProjectCharts(undefined, config)).toEqual({ saved: 0, skipped: 0 });
  });
});

describe("chart ids", () => {
  it("holds core's chart id pattern to the record contract's", () => {
    // Core is built on its own and keeps a copy; this is what keeps it honest.
    expect(DEPTH_CHART_ID_PATTERN.source).toBe(CHART_ID_PATTERN.source);
    expect(DEPTH_CHART_ID_PATTERN.flags).toBe(CHART_ID_PATTERN.flags);
  });
});
