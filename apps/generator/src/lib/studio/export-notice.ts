import { exportBlockReason, type GeometryIRV1, type ProjectConfigV1, type SheetNestPlanV1 } from "@topostack/core";
import { createSubscriber } from "svelte/reactivity";
import type { ExportUpdate } from "$lib/atomm/atomm-bridge";
import { t } from "$lib/i18n/i18n.svelte";
import { prepareProjectSettings, prepareSelectedDownload, startBrowserDownload, type DownloadOption } from "$lib/studio/native-export";

export type ExportPhase = "idle" | "preparing" | "ready" | "error";

/** How long a finished or failed export stays announced before the notice returns to idle. */
const EXPORT_NOTICE_MS = 8_000;

/** The notice describing an export, shared by the browser download and the Atomm handoff. */
export function describeExport(update: ExportUpdate): { title: string; detail: string; status: string } {
  if (update.phase === "preparing") {
    const title = update.intent === "openInStudio" ? t("status.exportPreparingStudioTitle") : t("status.exportPreparingDownloadTitle");
    return { title, detail: update.intent === "openInStudio" ? t("status.exportPreparingStudioDetail") : t("status.exportPreparingDownloadDetail"), status: title };
  }
  if (update.phase === "ready") {
    return update.intent === "openInStudio"
      ? { title: t("status.exportArtworkReadyTitle"), detail: [t("status.exportArtworkReadyDetail"), update.layoutNote].filter(Boolean).join(" "), status: t("status.exportArtworkReadyStatus") }
      : { title: t("status.exportDownloadReadyTitle"), detail: [t("status.exportDownloadReadyDetail", { count: update.fileCount }), update.layoutNote].filter(Boolean).join(" "), status: t("status.exportDownloadReadyStatus", { count: update.fileCount }) };
  }
  return { title: t("status.exportFailedTitle"), detail: update.message, status: update.message };
}

/**
 * Reactive export notice state. `phase`, `title`, and `detail` are reactive
 * when read from markup or deriveds; a ready or failed notice falls back to
 * idle after `EXPORT_NOTICE_MS`.
 */
export class ExportNotice {
  #phase: ExportPhase = "idle";
  #title = "";
  #detail = "";
  #timeout: ReturnType<typeof setTimeout> | undefined;
  #notify: (() => void) | undefined;
  readonly #subscribe = createSubscriber((update) => {
    this.#notify = update;
    return () => { this.#notify = undefined; };
  });

  constructor(private readonly onStatus: (status: string) => void, private readonly noticeMs = EXPORT_NOTICE_MS) {}

  get phase(): ExportPhase { this.#subscribe(); return this.#phase; }
  get title(): string { this.#subscribe(); return this.#title; }
  get detail(): string { this.#subscribe(); return this.#detail; }

  apply(update: ExportUpdate): void {
    this.#clearTimer();
    const notice = describeExport(update);
    this.#phase = update.phase; this.#title = notice.title; this.#detail = notice.detail;
    this.onStatus(notice.status);
    if (update.phase !== "preparing") {
      this.#timeout = setTimeout(() => { this.#timeout = undefined; this.#phase = "idle"; this.#notify?.(); }, this.noticeMs);
    }
    this.#notify?.();
  }

  dispose(): void { this.#clearTimer(); }

  #clearTimer(): void {
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
    this.#timeout = undefined;
  }
}

export interface DownloadRequest {
  option: DownloadOption;
  geometry: GeometryIRV1;
  project: ProjectConfigV1;
  /** Lay the files out on stock sheets, when the maker nested them. */
  sheetPlan?: SheetNestPlanV1;
  /** Lay the acrylic water inserts out on acrylic stock sheets, when the maker nested them. */
  acrylicSheetPlan?: SheetNestPlanV1;
  notice: ExportNotice;
  /** Reports fabrication export outcomes; project settings and assembly guides are not tracked. */
  track: (event: "export_prepared" | "export_failed") => void;
  /** Lets the preparing notice paint before the synchronous package build. */
  nextFrame?: () => Promise<void>;
}

/** Build and start a browser download, reporting progress and failures through `notice`. */
export async function downloadProject({ option, geometry, project, sheetPlan, acrylicSheetPlan, notice, track, nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve())) }: DownloadRequest): Promise<void> {
  if (notice.phase === "preparing") return;
  const tracked = option !== "project" && option !== "assembly";
  const reason = option === "project" ? undefined : exportBlockReason(geometry, project);
  if (reason) {
    notice.apply({ phase: "error", intent: "download", message: reason });
    track("export_failed");
    return;
  }
  notice.apply({ phase: "preparing", intent: "download" });
  await nextFrame();
  try {
    const download = option === "project"
      ? prepareProjectSettings(project, await (async () => {
        if (!project.userDepthCharts || !Object.keys(project.userDepthCharts).length) return [];
        return (await import("$lib/storage/user-charts")).chartsForProject(project);
      })())
      : await (async () => {
        const { buildProjectPackage, loadGuideFonts, withLightBurnProjects } = await import("$lib/studio/export-policy");
        // Only the booklet uses the fonts; skip fetching them for files without it.
        const guideFonts = option === "all" || option === "assembly" ? await loadGuideFonts() : [];
        const output = buildProjectPackage(geometry, project, { guideFonts, sheetPlan, acrylicSheetPlan });
        return prepareSelectedDownload(option === "lightburn" ? await withLightBurnProjects(output) : output, option);
      })();
    startBrowserDownload(download);
    if (tracked) track("export_prepared");
    notice.apply({ phase: "ready", intent: "download", fileCount: download.fileCount });
  } catch (error) {
    if (tracked) track("export_failed");
    notice.apply({ phase: "error", intent: "download", message: error instanceof Error ? error.message : t("status.exportDownloadFailed") });
  }
}
