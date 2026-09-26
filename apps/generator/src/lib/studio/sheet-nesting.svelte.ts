import type { GeometryIRV1, NestPartV1, ProjectConfigV1, SheetNestPlanV1 } from "@topostack/core";
import type { SheetPreview } from "$lib/studio/sheet-nest-runner";
import type { NestClient } from "$lib/workers/nest-client";

export type SheetNestStatus = "idle" | "running" | "done" | "error";

type Runner = typeof import("$lib/studio/sheet-nest-runner");
type Cache = typeof import("$lib/storage/nest-cache");

/**
 * Sheet nesting for the export dialog: the search in progress, the layout it
 * found, and whether the export uses it. The plan lives for the session; a
 * change to the design or the sheet settings makes it stale, and the export
 * then falls back to the original panels until the maker nests again.
 */
export class SheetNesting {
  status = $state<SheetNestStatus>("idle");
  /** Best layout so far while running, the final one after. */
  plan = $state<SheetNestPlanV1 | undefined>(undefined);
  /** The plan's sheets drawn as outlines, for the dialog. */
  previews = $state<SheetPreview[]>([]);
  /** Whether the plan matches the current geometry and settings. */
  current = $state(false);
  error = $state<string | undefined>(undefined);
  /** Why the WebAssembly engine is not in use, when it is not. */
  fallback = $state<string | undefined>(undefined);
  startedAt = $state(0);
  budgetMs = $state(0);
  /** The maker chose nested sheets for the export. */
  useSheets = $state(false);

  #runner: Promise<Runner> | undefined;
  #cache: Promise<Cache> | undefined;
  #restoring: string | undefined;
  #client: NestClient | undefined;
  #parts: NestPartV1[] = [];
  #previewsOf: Runner["sheetPreviews"] | undefined;
  /** The design the studio shows now, which a search may outlive. */
  #latest: { geometry: GeometryIRV1; project: ProjectConfigV1 } | undefined;

  constructor(
    private readonly loadRunner: () => Promise<Runner> = () => import("$lib/studio/sheet-nest-runner"),
    private readonly now: () => number = () => performance.now(),
    private readonly loadCache: () => Promise<Cache> = () => import("$lib/storage/nest-cache"),
  ) {}

  /** The plan to export with: only when chosen and still current. */
  get exportPlan(): SheetNestPlanV1 | undefined {
    return this.useSheets && this.current ? this.plan : undefined;
  }

  async start(geometry: GeometryIRV1, project: ProjectConfigV1): Promise<void> {
    this.#latest = { geometry, project };
    const runner = await this.#load();
    const job = runner.prepareNestJob(geometry, project);
    if (!job.ok) {
      this.status = "error";
      this.error = job.error;
      return;
    }
    this.#client ??= new runner.NestClient();
    this.#parts = job.parts;
    this.#previewsOf = runner.sheetPreviews;
    this.status = "running";
    this.error = undefined;
    this.fallback = undefined;
    this.startedAt = this.now();
    this.budgetMs = job.settings.timeBudgetS * 1000;
    try {
      const plan = await this.#client.run(job.parts, job.settings, {
        budgetMs: this.budgetMs,
        onDraft: (draft) => this.#show(draft),
        onFallback: (reason) => { this.fallback = reason; },
      });
      this.#show(plan);
      // The design may have changed while the search ran; refresh() waited for it.
      const latest = this.#latest;
      if (latest) this.current = runner.planIsCurrent(plan, latest.geometry, latest.project);
      this.useSheets = true;
      this.status = "done";
      void this.#storage().then((cache) => cache.saveNestPlan(plan, true));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Cancelled, or stopped before any layout existed.
        if (this.status === "running") this.status = "idle";
        return;
      }
      this.status = "error";
      this.error = error instanceof Error ? error.message : "Sheet nesting failed.";
    }
  }

  /** Choose between nested sheets and the original panels, remembered with a saved layout. */
  setUseSheets(useSheets: boolean): void {
    this.useSheets = useSheets;
    const plan = this.plan;
    if (plan && this.status === "done") void this.#storage().then((cache) => cache.setNestPlanChoice(plan.jobKey, useSheets));
  }

  /**
   * Bring back a layout saved for this exact design and these sheet
   * settings, after a reload. Does nothing while a layout is already shown.
   */
  async restore(geometry: GeometryIRV1, project: ProjectConfigV1): Promise<void> {
    if (this.#busy()) return;
    const runner = await this.#load();
    const job = runner.prepareNestJob(geometry, project);
    if (!job.ok) return;
    const key = runner.jobKeyOf(job);
    // One lookup per job, however often the studio asks.
    if (this.#restoring === key) return;
    this.#restoring = key;
    const saved = await (await this.#storage()).loadNestPlan(key);
    // A search, or another restore, may have produced a layout meanwhile.
    if (!saved || this.#busy()) return;
    this.#parts = job.parts;
    this.#previewsOf = runner.sheetPreviews;
    this.#show(saved.plan);
    this.useSheets = saved.useSheets;
    this.status = "done";
  }

  /** Keep the best layout found so far. */
  stop(): void {
    this.#client?.stop();
  }

  /** Discard the search and its layout. */
  cancel(): void {
    this.status = "idle";
    this.plan = undefined;
    this.previews = [];
    this.current = false;
    this.#client?.cancel();
  }

  /** Re-check the plan after the geometry or the sheet settings change. */
  async refresh(geometry: GeometryIRV1, project: ProjectConfigV1): Promise<void> {
    this.#latest = { geometry, project };
    const plan = this.plan;
    if (!plan || this.status === "running") return;
    const runner = await this.#load();
    // A newer plan may have landed while the runner loaded.
    if (this.plan === plan) this.current = runner.planIsCurrent(plan, geometry, project);
  }

  dispose(): void {
    this.#client?.dispose();
  }

  #show(plan: SheetNestPlanV1): void {
    this.plan = plan;
    this.current = true;
    this.previews = this.#previewsOf?.(plan, this.#parts) ?? [];
  }

  #busy(): boolean {
    return Boolean(this.plan) || this.status === "running";
  }

  #storage(): Promise<Cache> {
    this.#cache ??= this.loadCache();
    return this.#cache;
  }

  #load(): Promise<Runner> {
    this.#runner ??= this.loadRunner();
    return this.#runner;
  }
}
