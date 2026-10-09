import { projectFonts, type GeometryIRV1, type ProjectConfigV1, type SourceBundleV1, type TextFont } from "@topostack/core";
import { ensureFonts } from "$lib/domain/fonts";
import { ensureAirspaceStage } from "$lib/domain/airspace-stage";
import type { GeometryWorkerClient, WarmGeometryWorker } from "$lib/workers/geometry-worker-client";
import { ModuleLoadError } from "$lib/studio/lazy-load";

export const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

export interface PreviewUpdate {
  config: ProjectConfigV1;
  /** Loads or reuses whatever map data the edit needs. */
  prepareSource: (signal: AbortSignal) => Promise<SourceBundleV1>;
  onCommit: (geometry: GeometryIRV1, source: SourceBundleV1) => void;
  onError: (error: unknown) => void;
  /** Runs after a started update ends; `current` is false once a newer edit superseded it. */
  onSettled: (current: boolean) => void;
}

/**
 * The worker client loads on first use, keeping it out of the startup bundle.
 * `takeWarmWorker` hands over a worker that is already running, if any.
 */
export async function loadGeometryClient(takeWarmWorker?: () => WarmGeometryWorker | undefined): Promise<GeometryWorkerClient> {
  const module = await import("$lib/workers/geometry-worker-client").catch((error: unknown) => { throw new ModuleLoadError("The geometry engine", error); });
  const client = new module.GeometryWorkerClient();
  const warm = takeWarmWorker?.();
  if (warm) client.adopt(warm);
  return client;
}

/** A pending trailing debounce; `settle(true)` ends it as superseded. */
interface DebouncedWake { timer: ReturnType<typeof setTimeout>; settle: (superseded: boolean) => void }

/**
 * Revision-guarded preview refreshes. Every edit bumps the revision through
 * `invalidate`; a refresh commits only if nothing superseded it while it
 * waited, loaded map data, or generated geometry.
 */
export class PreviewPipeline {
  revision = 0;
  private detailAbort: AbortController | undefined;
  private wake: DebouncedWake | undefined;
  private client: GeometryWorkerClient | undefined;
  private clientLoad: Promise<GeometryWorkerClient> | undefined;
  private disposed = false;

  constructor(
    private readonly loadClient: () => Promise<GeometryWorkerClient> = loadGeometryClient,
    private readonly loadFonts: (fonts: TextFont[]) => Promise<void> = ensureFonts,
  ) {}

  invalidate(reason?: unknown): void {
    this.revision += 1;
    this.detailAbort?.abort();
    this.detailAbort = undefined;
    this.wake?.settle(true);
    this.client?.cancel(reason);
  }

  /** Abandon only in-flight geometry generation. */
  cancelGeometry(reason?: unknown): void { this.client?.cancel(reason); }

  /** Generate on the shared worker, unless `revision` was superseded while the client loaded. */
  async generate(config: ProjectConfigV1, source: SourceBundleV1, revision = this.revision): Promise<GeometryIRV1> {
    if (!this.clientLoad) {
      const load = this.loadClient().then((client) => {
        if (this.disposed) client.dispose();
        this.client = client;
        return client;
      });
      this.clientLoad = load;
      // A failed chunk load (a deploy replaced it, or the network dropped) must
      // not stick: forget it so the next generation retries the import.
      load.catch(() => { if (this.clientLoad === load) this.clientLoad = undefined; });
    }
    // The page draws the result's text too (previews, exports), so its fonts must load here as well as in the worker.
    // The airspace stage, like the fonts, is registered in the page too: generation falls back to it when no worker starts.
    const [client] = await Promise.all([this.client ?? this.clientLoad, this.loadFonts(projectFonts(config)), config.airspaceStack ? ensureAirspaceStage() : undefined]);
    if (revision !== this.revision || this.disposed) throw new DOMException("Preview superseded", "AbortError");
    return client.run(config, source);
  }

  isCurrent(revision: number, signal?: AbortSignal): boolean {
    return revision === this.revision && !signal?.aborted;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate(new DOMException("Generator closed", "AbortError"));
    this.client?.dispose();
  }

  /** Trailing-debounced: a newer edit within `delayMs` replaces this one before any work starts. */
  async runPreviewUpdate(update: PreviewUpdate, delayMs = 0): Promise<void> {
    const revision = this.revision;
    if (delayMs > 0) {
      const superseded = await new Promise<boolean>((resolve) => {
        // Settle the debounce this update replaces instead of dropping its
        // resolver: two updates at the same revision (an edit that keeps
        // pending work running) left the first promise pending forever, and
        // with it whatever its caller awaited.
        this.wake?.settle(true);
        const wake: DebouncedWake = {
          timer: setTimeout(() => wake.settle(false), delayMs),
          settle: (replaced) => { clearTimeout(wake.timer); if (this.wake === wake) this.wake = undefined; resolve(replaced); },
        };
        this.wake = wake;
      });
      if (superseded || revision !== this.revision) return;
    }
    const controller = new AbortController();
    this.detailAbort = controller;
    const current = () => this.isCurrent(revision, controller.signal);
    try {
      const source = await update.prepareSource(controller.signal);
      if (!current()) return;
      const geometry = await this.generate(update.config, source, revision);
      if (!current()) return;
      update.onCommit(geometry, source);
    } catch (error) {
      if (!current() || isAbortError(error)) return;
      update.onError(error);
    } finally {
      if (this.detailAbort === controller) this.detailAbort = undefined;
      update.onSettled(revision === this.revision);
    }
  }
}
