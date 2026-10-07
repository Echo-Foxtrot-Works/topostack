// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, createSyntheticSource, generateGeometry, type SheetNestPlanV1 } from "@topostack/core";
import { createAtommExport } from "$lib/studio/export-policy";

vi.mock("$lib/studio/export-policy", () => ({ createAtommExport: vi.fn(() => []), loadGuideFonts: vi.fn(async () => []) }));

describe("Atomm bridge", () => {
  beforeEach(() => { vi.resetModules(); vi.mocked(createAtommExport).mockClear(); delete window.atomm; });

  it("connects when an async SDK arrives after the discovery timeout", async () => {
    vi.useFakeTimers();
    const script = document.createElement("script");
    script.src = "https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js";
    document.head.append(script);
    const { connectAtomm } = await import("$lib/atomm/atomm-bridge");
    const on = vi.fn(); const ready = vi.fn();
    const disconnect = connectAtomm(() => { throw new Error("Not exporting in this test"); }, ready);
    await vi.advanceTimersByTimeAsync(6000);
    window.atomm = { lifecycle: { on } } as unknown as AtommSdk;
    script.dispatchEvent(new Event("load"));
    expect(on).toHaveBeenCalledOnce();
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

});
