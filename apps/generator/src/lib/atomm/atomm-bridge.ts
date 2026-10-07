import type { GeometryIRV1, ProjectConfigV1, SheetNestPlanV1 } from "@topostack/core";
import type { ExportIntent } from "$lib/studio/export-policy";

type ExportSnapshot = { geometry: GeometryIRV1; project: ProjectConfigV1; sheetPlan?: SheetNestPlanV1; acrylicSheetPlan?: SheetNestPlanV1; layoutNote?: string };
type CurrentExport = () => ExportSnapshot | Promise<ExportSnapshot>;

export type ExportUpdate =
  | { phase: "preparing"; intent: ExportIntent }
  | { phase: "ready"; intent: ExportIntent; fileCount: number; layoutNote?: string }
  | { phase: "error"; intent: ExportIntent; message: string };

let currentExport: CurrentExport | undefined;
let currentExportUpdate: ((update: ExportUpdate) => void) | undefined;
// Register the export handler once per SDK instance. The handler reads the
// module-level getter, so a reconnect swaps in a fresh getter without stacking
// duplicate handlers, and a fresh SDK object gets its own registration.
const registeredSdks = new WeakSet<AtommSdk>();

export function connectAtomm(getCurrent: CurrentExport, onReady: () => void, onExportUpdate: (update: ExportUpdate) => void = () => undefined): () => void {
  currentExport = getCurrent;
  currentExportUpdate = onExportUpdate;
  let connectedSdk: AtommSdk | undefined;
  const setup = () => {
    const sdk = window.atomm;
    if (!sdk) return;
    if (sdk !== connectedSdk) { connectedSdk = sdk; onReady(); }
    if (registeredSdks.has(sdk)) return;
    registeredSdks.add(sdk);
    sdk.lifecycle.on("export", async ({ intent }) => {
      currentExportUpdate?.({ phase: "preparing", intent });
      // Give Svelte a frame to paint the progress state before SVG/package
      // serialization occupies the main thread.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      try {
        const { createAtommExport, loadGuideFonts } = await import("$lib/studio/export-policy");
        if (!currentExport) throw new Error("TopoStack is not ready to export.");
        const fonts = intent === "download" ? await loadGuideFonts() : [];
        const getter = currentExport;
        const { geometry, project, sheetPlan, acrylicSheetPlan, layoutNote } = await getter();
        if (currentExport !== getter) throw new Error("TopoStack disconnected while preparing the export.");
        const output = await createAtommExport(geometry, project, intent, fonts, sheetPlan, acrylicSheetPlan);
        // Studio opens one file, the wood master; acrylic is another material and another job.
        const acrylicNote = intent === "openInStudio" && geometry.waterInserts?.length ? "The acrylic water inserts are not in it: download the project files for their own SVGs." : "";
        const note = [layoutNote, acrylicNote].filter(Boolean).join(" ");
        currentExportUpdate?.({ phase: "ready", intent, fileCount: Array.isArray(output) ? output.length : 1, ...(note ? { layoutNote: note } : {}) });
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : "TopoStack could not prepare this export.";
        currentExportUpdate?.({ phase: "error", intent, message });
        throw error;
      }
    });
  };
  // Async SDK downloads can finish after the short discovery polling window.
  const script = document.querySelector<HTMLScriptElement>('script[src="https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js"]');
  script?.addEventListener("load", setup);
  setup();
  const interval = window.setInterval(setup, 250);
  const timeout = window.setTimeout(() => window.clearInterval(interval), 5_000);
  return () => {
    window.clearInterval(interval);
    window.clearTimeout(timeout);
    script?.removeEventListener("load", setup);
    // Fail closed after disconnect: a stale handler on a surviving SDK refuses
    // to export until a new connection installs its getter.
    if (currentExport === getCurrent) { currentExport = undefined; currentExportUpdate = undefined; }
  };
}
