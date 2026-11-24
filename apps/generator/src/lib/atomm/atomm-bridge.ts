import type { GeometryIRV1, ProjectConfigV1, SheetNestPlanV1 } from "@topostack/core";
import type { ExportIntent } from "$lib/studio/export-policy";
import { t } from "$lib/i18n/i18n.svelte";
import { errorText } from "$lib/i18n/errors";
import { ATOMM_SDK_URL } from "$lib/atomm/sdk";

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

async function exportFromAtomm({ intent }: AtommExportIntent) {
  currentExportUpdate?.({ phase: "preparing", intent });
  // Give Svelte a frame to paint the progress state before SVG/package
  // serialization occupies the main thread.
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  try {
    const { acrylicOutsideStudio, createAtommExport, loadGuideFonts } = await import("$lib/studio/export-policy");
    if (!currentExport) throw new Error(t("workbench.exportNotReady"));
    const fonts = intent === "download" ? await loadGuideFonts() : [];
    const getter = currentExport;
    const { geometry, project, sheetPlan, acrylicSheetPlan, layoutNote } = await getter();
    if (currentExport !== getter) throw new Error(t("workbench.exportDisconnected"));
    const output = await createAtommExport(geometry, project, intent, fonts, sheetPlan, acrylicSheetPlan);
    const acrylicNote = intent === "openInStudio" ? acrylicOutsideStudio(geometry) : "";
    // The layout note is a label ("Automatic layout · 2 sheets · …"); end it as a sentence when another follows.
    const note = [layoutNote, acrylicNote].filter((part): part is string => Boolean(part)).map((part, index, parts) => index < parts.length - 1 && !/[.!?。！？]$/.test(part) ? `${part}.` : part).join(" ");
    currentExportUpdate?.({ phase: "ready", intent, fileCount: Array.isArray(output) ? output.length : 1, ...(note ? { layoutNote: note } : {}) });
    return output;
  } catch (error) {
    const message = errorText(error, t("workbench.exportFailed"));
    currentExportUpdate?.({ phase: "error", intent, message });
    throw error;
  }
}

export function connectAtomm(getCurrent: CurrentExport, onReady: () => void, onExportUpdate: (update: ExportUpdate) => void = () => undefined): () => void {
  currentExport = getCurrent;
  currentExportUpdate = onExportUpdate;
  let connectedSdk: AtommSdk | undefined;
  const setup = () => {
    const sdk = window.atomm;
    if (!sdk) return;
    if (!registeredSdks.has(sdk)) {
      try { sdk.lifecycle.on("export", exportFromAtomm); }
      catch { return; } // The SDK can appear before its host is ready. Retry discovery.
      registeredSdks.add(sdk);
    }
    if (sdk !== connectedSdk) { connectedSdk = sdk; onReady(); }
  };
  let interval: number | undefined;
  let timeout: number | undefined;
  const stopDiscovery = () => {
    window.clearInterval(interval);
    window.clearTimeout(timeout);
  };
  const discover = () => {
    stopDiscovery();
    setup();
    interval = window.setInterval(setup, 250);
    timeout = window.setTimeout(stopDiscovery, 5_000);
  };
  // The same retry window applies when the SDK arrives late.
  const script = document.querySelector<HTMLScriptElement>(`script[src="${ATOMM_SDK_URL}"]`);
  script?.addEventListener("load", discover);
  discover();
  return () => {
    stopDiscovery();
    script?.removeEventListener("load", discover);
    // Fail closed after disconnect: a stale handler on a surviving SDK refuses
    // to export until a new connection installs its getter.
    if (currentExport === getCurrent) { currentExport = undefined; currentExportUpdate = undefined; }
  };
}
