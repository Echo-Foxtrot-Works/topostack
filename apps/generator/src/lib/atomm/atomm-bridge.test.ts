// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, createSyntheticSource, generateGeometry, type SheetNestPlanV1 } from "@topostack/core";
import { createAtommExport } from "$lib/studio/export-policy";

vi.mock("$lib/studio/export-policy", async (importOriginal) => {
  const { acrylicOutsideStudio } = await importOriginal<typeof import("$lib/studio/export-policy")>();
  return { acrylicOutsideStudio, createAtommExport: vi.fn(() => []), loadGuideFonts: vi.fn(async () => []) };
});

describe("Atomm bridge", () => {
  beforeEach(() => { vi.resetModules(); vi.mocked(createAtommExport).mockClear(); delete window.atomm; });

  it("connects when an async SDK arrives after the discovery timeout", async () => {
    vi.useFakeTimers();
    const script = document.createElement("script");
    script.src = "https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js";
    document.head.append(script);
    const { connectAtomm } = await import("$lib/atomm/atomm-bridge");
    const on = vi.fn().mockImplementationOnce(() => { throw new Error("Host not ready"); });
    const ready = vi.fn();
    const disconnect = connectAtomm(() => { throw new Error("Not exporting in this test"); }, ready);
    await vi.advanceTimersByTimeAsync(6000);
    window.atomm = { lifecycle: { on } } as unknown as AtommSdk;
    script.dispatchEvent(new Event("load"));
    expect(on).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(on).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledOnce();
    disconnect();
    script.dispatchEvent(new Event("load"));
    expect(ready).toHaveBeenCalledOnce();
    script.remove();
    vi.useRealTimers();
  });

  it("waits for the SDK, registers once, and exports the latest state", async () => {
    vi.useFakeTimers();
    const geometry = generateGeometry(DEFAULT_PROJECT, createSyntheticSource(DEFAULT_PROJECT));
    let project = DEFAULT_PROJECT;
    let handler: ((value: AtommExportIntent) => Promise<AtommExportFile | AtommExportFile[]>) | undefined;
    const on = vi.fn((_event: "export", callback: typeof handler) => { handler = callback; });
    const ready = vi.fn();
    const exportUpdate = vi.fn();
    const { connectAtomm } = await import("$lib/atomm/atomm-bridge");
    let sheetPlan: SheetNestPlanV1 | undefined = undefined;
    const disconnect = connectAtomm(() => ({ geometry, project, sheetPlan }), ready, exportUpdate);
    window.atomm = { lifecycle: { on }, ui: { toast: vi.fn(), closeToast: vi.fn() }, app: { getLocale: vi.fn() } } as unknown as AtommSdk;
    await vi.advanceTimersByTimeAsync(250);
    expect(on).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    project = { ...DEFAULT_PROJECT, name: "Latest project" };
    // A nested layout chosen in the export dialog travels with the handoff.
    sheetPlan = { jobKey: "nest1-x" } as SheetNestPlanV1;
    const exported = handler?.({ intent: "download" });
    await vi.advanceTimersByTimeAsync(20);
    await exported;
    expect(createAtommExport).toHaveBeenCalledWith(geometry, project, "download", [], sheetPlan, undefined);
    expect(exportUpdate).toHaveBeenNthCalledWith(1, { phase: "preparing", intent: "download" });
    expect(exportUpdate).toHaveBeenNthCalledWith(2, { phase: "ready", intent: "download", fileCount: 0 });
    vi.mocked(createAtommExport).mockImplementationOnce(() => { throw new Error("Package could not be built"); });
    const failed = handler?.({ intent: "download" });
    const rejection = expect(failed).rejects.toThrow("Package could not be built");
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(exportUpdate).toHaveBeenNthCalledWith(3, { phase: "preparing", intent: "download" });
    expect(exportUpdate).toHaveBeenNthCalledWith(4, { phase: "error", intent: "download", message: "Package could not be built" });

    // Studio receives only the wood master, so the ready note says where the acrylic went.
    const withAirspace = { ...geometry, airspaceStack: { levels: [{}] } } as unknown as typeof geometry;
    const disconnectAirspace = connectAtomm(() => ({ geometry: withAirspace, project }), ready, exportUpdate);
    const studioExport = handler?.({ intent: "openInStudio" });
    await vi.advanceTimersByTimeAsync(20);
    await studioExport;
    expect(exportUpdate).toHaveBeenLastCalledWith({ phase: "ready", intent: "openInStudio", fileCount: 0, layoutNote: "The acrylic airspace is not in it: download the project files for their own SVGs." });
    disconnectAirspace();

    // With a sheet layout too, the layout label is ended as a sentence before the acrylic note.
    const disconnectLaidOut = connectAtomm(() => ({ geometry: withAirspace, project, layoutNote: "Automatic layout · 3 sheets · 600 × 400 mm" }), ready, exportUpdate);
    const laidOut = handler?.({ intent: "openInStudio" });
    await vi.advanceTimersByTimeAsync(20);
    await laidOut;
    expect(exportUpdate).toHaveBeenLastCalledWith({ phase: "ready", intent: "openInStudio", fileCount: 0, layoutNote: "Automatic layout · 3 sheets · 600 × 400 mm. The acrylic airspace is not in it: download the project files for their own SVGs." });
    disconnectLaidOut();

    const disconnectAgain = connectAtomm(() => ({ geometry, project }), ready);
    expect(on).toHaveBeenCalledTimes(1);
    disconnect();
    disconnectAgain();
    vi.useRealTimers();
  });
  it("awaits automatic layout and refuses a result after disconnect", async () => {
    vi.useFakeTimers();
    const geometry = generateGeometry(DEFAULT_PROJECT, createSyntheticSource(DEFAULT_PROJECT));
    let handler!: (value: AtommExportIntent) => Promise<AtommExportFile | AtommExportFile[]>;
    window.atomm = { lifecycle: { on: (_event: string, callback: typeof handler) => { handler = callback; } } } as unknown as AtommSdk;
    const { connectAtomm } = await import("$lib/atomm/atomm-bridge");
    let finish!: (snapshot: { geometry: typeof geometry; project: typeof DEFAULT_PROJECT; layoutNote: string }) => void;
    const updates = vi.fn();
    const disconnect = connectAtomm(() => new Promise(resolve => { finish = resolve; }), vi.fn(), updates);
    const pending = handler({ intent: "openInStudio" });
    const rejected = expect(pending).rejects.toThrow("disconnected");
    await vi.advanceTimersByTimeAsync(20);
    expect(createAtommExport).not.toHaveBeenCalled();
    disconnect();
    finish({ geometry, project: DEFAULT_PROJECT, layoutNote: "Automatic layout" });
    await rejected;
    expect(createAtommExport).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("sends the wood master to Studio and includes separate acrylic in Download", async () => {
    const { createAtommExport: exportArtwork } = await vi.importActual<typeof import("$lib/studio/export-policy")>("$lib/studio/export-policy");
    const { lat, lon } = DEFAULT_PROJECT.location;
    const project = {
      ...DEFAULT_PROJECT, name: "Bowl", waterDepthLayerLimit: 6,
      location: { ...DEFAULT_PROJECT.location, bounds: { west: lon - 0.042, east: lon + 0.042, south: lat - 0.029, north: lat + 0.029 } },
      waterInserts: { kerfMm: 0.1, fitClearanceMm: 0.1, excludedLakeIds: [] },
    };
    const size = 64;
    const values = Float32Array.from({ length: size * size }, (_, index) => {
      const x = (index % size / (size - 1) - 0.5) * project.widthMm;
      const y = (Math.floor(index / size) / (size - 1) - 0.5) * project.heightMm;
      return 1500 + Math.max(0, Math.hypot(x, y) - 42) * 4;
    });
    const outer = Array.from({ length: 64 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return { x: Math.cos(angle) * 40, y: Math.sin(angle) * 40 };
    });
    outer.push(outer[0]!);
    const geometry = generateGeometry(project, {
      ...createSyntheticSource(project, 2), sourceKind: "real",
      elevation: { width: size, height: size, values, min: Math.min(...values), max: Math.max(...values) },
      waterAreas: [{ id: "bowl", kind: "lake", name: "Bowl", hylakId: 42, maxDepthM: 150, meanDepthM: 60, polygon: { outer, holes: [] } }],
    });
    expect(geometry.waterInserts).toHaveLength(1);
    const studio = await exportArtwork(geometry, project, "openInStudio");
    expect(studio).toMatchObject({ filename: "bowl-master.svg" });
    const download = await exportArtwork(geometry, project, "download");
    expect(Array.isArray(download) && download.map(({ filename }) => filename)).toEqual(expect.arrayContaining(["bowl-master.svg", "bowl-acrylic-master.svg", "bowl-assembly-guide.html"]));
  });
});
