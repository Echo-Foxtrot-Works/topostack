import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry, type ProjectConfigV1 } from "@topostack/core";
import { describeExport, downloadProject, ExportNotice } from "$lib/studio/export-notice";
import { prepareProjectSettings, prepareSelectedDownload, startBrowserDownload } from "$lib/studio/native-export";
import { buildProjectPackage, loadGuideFonts } from "$lib/studio/export-policy";
import { chartsForProject } from "$lib/storage/user-charts";

vi.mock("$lib/studio/native-export", () => ({
  prepareProjectSettings: vi.fn(() => ({ fileCount: 1 })),
  prepareSelectedDownload: vi.fn(async () => ({ fileCount: 3 })),
  startBrowserDownload: vi.fn(),
}));
vi.mock("$lib/studio/export-policy", () => ({
  buildProjectPackage: vi.fn(() => ({ schemaVersion: 1, files: [] })),
  loadGuideFonts: vi.fn(async () => [{ family: "guide" }]),
}));
vi.mock("$lib/storage/user-charts", () => ({ chartsForProject: vi.fn(async () => [{ id: "round-lake-chart" }]) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("export notice", () => {
  it("describes browser and Studio exports", () => {
    expect(describeExport({ phase: "preparing", intent: "openInStudio" })).toMatchObject({ title: "Preparing Studio artwork", status: "Preparing Studio artwork" });
    expect(describeExport({ phase: "ready", intent: "download", fileCount: 1 })).toMatchObject({ title: "Download ready", status: "Download prepared · 1 file" });
    expect(describeExport({ phase: "error", intent: "download", message: "Nope" })).toEqual({ title: "Export failed", detail: "Nope", status: "Nope" });
  });

  it("reports status and returns to idle after a finished export", () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const notice = new ExportNotice((status) => statuses.push(status), 1_000);
    notice.apply({ phase: "preparing", intent: "download" });
    vi.advanceTimersByTime(5_000);
    expect(notice.phase).toBe("preparing");
    notice.apply({ phase: "ready", intent: "download", fileCount: 2 });
    expect(notice).toMatchObject({ phase: "ready", title: "Download ready" });
    vi.advanceTimersByTime(1_000);
    expect(notice.phase).toBe("idle");
    expect(statuses).toEqual(["Building your download", "Download prepared · 2 files"]);
  });

  it("blocks sample-data exports but always allows project settings", async () => {
    const project = DEFAULT_PROJECT;
    const geometry = generateGeometry(project, createSyntheticSource(project, 16));
    const notice = new ExportNotice(() => undefined);
    const track = vi.fn();
    await downloadProject({ option: "all", geometry, project, notice, track, nextFrame: async () => undefined });
    expect(notice.phase).toBe("error");
    expect(track).toHaveBeenCalledWith("export_failed");
    track.mockClear();
    await downloadProject({ option: "project", geometry, project, notice, track, nextFrame: async () => undefined });
    expect(notice).toMatchObject({ phase: "ready", detail: expect.stringContaining("1 file") });
    expect(track).not.toHaveBeenCalled();
    notice.dispose();
  });

  it("adds the layout note to a finished export", () => {
    expect(describeExport({ phase: "ready", intent: "openInStudio", fileCount: 1, layoutNote: "Laid out on 2 sheets." })).toEqual({
      title: "Artwork ready", detail: "The master SVG is prepared for Atomm to open in Studio. Laid out on 2 sheets.", status: "Master SVG prepared for Studio",
    });
    expect(describeExport({ phase: "ready", intent: "download", fileCount: 4, layoutNote: "Nested." }).detail).toBe("4 files prepared. Your browser should save them as one download. Nested.");
    expect(describeExport({ phase: "preparing", intent: "download" }).detail).toBe("Preparing your selected files…");
  });
});

describe("downloading fabrication files", () => {
  const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false };
  const geometry = generateGeometry(project, { ...createSyntheticSource(project, 16), sourceKind: "real" });
  const nextFrame = async () => undefined;
  const sheetPlan = { schemaVersion: 1 } as never;

  it("builds the selected files from real terrain and reports the export", async () => {
    const notice = new ExportNotice(() => undefined);
    const track = vi.fn();
    await downloadProject({ option: "panels", geometry, project, sheetPlan, notice, track, nextFrame });
    expect(loadGuideFonts).not.toHaveBeenCalled();
    expect(buildProjectPackage).toHaveBeenCalledWith(geometry, project, { guideFonts: [], sheetPlan, acrylicSheetPlan: undefined });
    expect(prepareSelectedDownload).toHaveBeenCalledWith({ schemaVersion: 1, files: [] }, "panels");
    expect(startBrowserDownload).toHaveBeenCalledWith({ fileCount: 3 });
    expect(track).toHaveBeenCalledWith("export_prepared");
    expect(notice).toMatchObject({ phase: "ready", title: "Download ready" });
    notice.dispose();
  });

  it("loads the guide fonts only for downloads that include the assembly booklet, which is not tracked", async () => {
    const notice = new ExportNotice(() => undefined);
    const track = vi.fn();
    await downloadProject({ option: "assembly", geometry, project, notice, track, nextFrame });
    expect(loadGuideFonts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildProjectPackage).mock.calls[0]![2]).toMatchObject({ guideFonts: [{ family: "guide" }] });
    expect(track).not.toHaveBeenCalled();
    notice.dispose();
  });

  it("waits a frame so the preparing notice paints, and ignores clicks while preparing", async () => {
    let paint: (() => void) | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { paint = callback; return 1; });
    const notice = new ExportNotice(() => undefined);
    const track = vi.fn();
    const first = downloadProject({ option: "all", geometry, project, notice, track });
    expect(notice.phase).toBe("preparing");
    await downloadProject({ option: "all", geometry, project, notice, track });
    expect(startBrowserDownload).not.toHaveBeenCalled();
    paint!();
    await first;
    expect(startBrowserDownload).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
    notice.dispose();
  });

  it("reports a failed build to the maker and the usage log", async () => {
    const statuses: string[] = [];
    const notice = new ExportNotice((status) => statuses.push(status));
    const track = vi.fn();
    vi.mocked(prepareSelectedDownload).mockRejectedValueOnce(new Error("No lake became an acrylic insert, so there are no acrylic files."));
    await downloadProject({ option: "acrylic", geometry, project, notice, track, nextFrame });
    expect(notice).toMatchObject({ phase: "error", detail: "No lake became an acrylic insert, so there are no acrylic files." });
    expect(track).toHaveBeenCalledWith("export_failed");
    vi.mocked(buildProjectPackage).mockImplementationOnce(() => { throw "worker gone"; });
    await downloadProject({ option: "master", geometry, project, notice, track, nextFrame });
    expect(statuses.at(-1)).toBe("TopoStack could not prepare this download.");
    expect(startBrowserDownload).not.toHaveBeenCalled();
    notice.dispose();
  });

  it("saves the project's traced depth charts with its settings", async () => {
    const notice = new ExportNotice(() => undefined);
    const charted = { ...DEFAULT_PROJECT, userDepthCharts: { "9092": { id: "round-lake-chart", contentHash: "a".repeat(64) } } };
    await downloadProject({ option: "project", geometry, project: charted, notice, track: vi.fn(), nextFrame });
    expect(chartsForProject).toHaveBeenCalledWith(charted);
    expect(prepareProjectSettings).toHaveBeenCalledWith(charted, [{ id: "round-lake-chart" }]);
    await downloadProject({ option: "project", geometry, project: { ...charted, userDepthCharts: {} }, notice, track: vi.fn(), nextFrame });
    expect(chartsForProject).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prepareProjectSettings).mock.calls[1]![1]).toEqual([]);
    notice.dispose();
  });
});
