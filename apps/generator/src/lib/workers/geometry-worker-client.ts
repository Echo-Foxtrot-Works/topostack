import { createGeometryGenerator, type GeometryIRV1, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";

/** Messages exchanged with geometry.worker.ts. */
export interface GeometryWorkerRequest {
  id: number;
  config: ProjectConfigV1;
  /** Identity of the source bundle. The worker keeps the last one it received. */
  sourceId: number;
  /** Omitted when the worker already holds `sourceId`, so a slider tick posts only config. */
  source?: SourceBundleV1;
}
export interface GeometryWorkerCancel { cancelId: number }
/**
 * Posted once when the worker script has loaded and evaluated. It separates a
 * worker that never started (blocked by CSP, missing chunk) from a started
 * worker that later crashed (for example out of memory on a large generation).
 */
export interface GeometryWorkerReady { ready: true }
export interface GeometryWorkerResponse {
  ready?: undefined;
  cancelled?: boolean;
  progress?: { stage: "alignment" | "elevation-labels"; completed: number; total: number };
  id: number;
  result?: GeometryIRV1;
  error?: string;
  /** The worker no longer holds the source this request referenced. */
  missingSource?: boolean;
}

const sourceIds = new WeakMap<SourceBundleV1, number>();
let lastSourceId = 0;
/** Stable per-object identity, so an unchanged source is never structured-cloned twice. */
function sourceIdentity(source: SourceBundleV1): number {
  let id = sourceIds.get(source);
  if (id === undefined) { id = ++lastSourceId; sourceIds.set(source, id); }
  return id;
}

type WorkerFactory = () => Worker;
type Generate = (config: ProjectConfigV1, source: SourceBundleV1) => GeometryIRV1;

const defaultWorkerFactory: WorkerFactory | undefined = typeof Worker === "undefined"
  ? undefined
  : () => new Worker(new URL("./geometry.worker.ts", import.meta.url), { type: "module" });

/**
 * How long an abandoned computation may keep the worker busy before it is
 * terminated. Short jobs finish and keep the cached source; long ones would
 * delay the next preview by more than a restart and source re-clone costs.
 */
const ABANDONED_WORK_LIMIT_MS = 1_000;

interface PendingRequest {
  id: number;
  worker: Worker;
  config: ProjectConfigV1;
  source: SourceBundleV1;
  sourceId: number;
  resentSource: boolean;
  /** Already moved to a fresh worker after a crash that may have been abandoned work's. */
  retried: boolean;
  resolve: (result: GeometryIRV1) => void;
  reject: (reason: unknown) => void;
}

/**
 * One long-lived geometry worker that caches the last source, so repeated edits
 * against unchanged map data post only the project config. Cancelling a request
 * keeps the worker and drops its late reply by id; the worker is terminated
 * only when abandoned work runs past `abandonedWorkLimitMs`, when it fails, or
 * on dispose. Falls back to main-thread generation where workers are
 * unavailable — no Worker in jsdom, or a CSP that blocks worker construction
 * inside a host frame.
 */
export class GeometryWorkerClient {
  private worker: Worker | undefined;
  private workerSourceId = 0;
  /** Session-wide: once any worker has answered, workers are known to load here. */
  private workerProven = false;
  private unavailable: boolean;
  private pending: PendingRequest | undefined;
  private nextId = 0;
  /** Posted ids the current worker has not answered yet, with their start time. */
  private outstanding = new Map<number, number>();
  private abandonTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly factory: WorkerFactory | undefined = defaultWorkerFactory,
    private readonly generate: Generate = createGeometryGenerator(),
    private readonly abandonedWorkLimitMs = ABANDONED_WORK_LIMIT_MS,
  ) {
    this.unavailable = !factory;
  }

  run(config: ProjectConfigV1, source: SourceBundleV1): Promise<GeometryIRV1> {
    this.cancel(new DOMException("Preview superseded", "AbortError"));
    const worker = this.unavailable ? undefined : this.ensureWorker();
    if (!worker) return this.runSynchronously(config, source);
    return new Promise<GeometryIRV1>((resolve, reject) => {
      const request: PendingRequest = { id: ++this.nextId, worker, config, source, sourceId: sourceIdentity(source), resentSource: false, retried: false, resolve, reject };
      this.pending = request;
      this.post(request, request.sourceId !== this.workerSourceId);
    });
  }

  /**
   * Abandon the in-flight request, if any. The worker and its cached source
   * are kept unless the abandoned computation is already long-running.
   */
  cancel(reason: unknown = new DOMException("Preview superseded", "AbortError")): void {
    const request = this.pending;
    if (!request) return;
    this.pending = undefined;
    request.reject(reason);
    // An awaiting coordinator can abort its helpers immediately and acknowledge cancellation.
    try { request.worker.postMessage({ cancelId: request.id } satisfies GeometryWorkerCancel); } catch { /* The existing restart path handles a dead worker. */ }
    const startedAt = this.outstanding.get(request.id);
    if (request.worker !== this.worker || startedAt === undefined) return;
    const remaining = startedAt + this.abandonedWorkLimitMs - Date.now();
    if (remaining <= 0) this.discardWorker(request.worker);
    else this.scheduleAbandonCheck(remaining);
  }

  dispose(): void {
    this.cancel(new DOMException("Generator closed", "AbortError"));
    if (this.worker) this.discardWorker(this.worker);
  }

  private runSynchronously(config: ProjectConfigV1, source: SourceBundleV1): Promise<GeometryIRV1> {
    try { return Promise.resolve(this.generate(config, source)); }
    catch (error) { return Promise.reject(error); }
  }

  private ensureWorker(): Worker | undefined {
    if (this.worker) return this.worker;
    let worker: Worker;
    try { worker = this.factory!(); }
    catch (error) {
      console.warn("TopoStack geometry worker is unavailable; generating on the main thread.", error);
      this.unavailable = true;
      return undefined;
    }
    this.worker = worker;
    this.workerSourceId = 0;
    worker.onmessage = (event: MessageEvent<GeometryWorkerResponse | GeometryWorkerReady>) => this.handleMessage(worker, event.data);
    worker.onerror = (event) => { event.preventDefault?.(); this.handleFailure(worker, new Error(event.message || "Geometry worker failed.")); };
    worker.onmessageerror = () => this.handleFailure(worker, new Error("Geometry worker returned an unreadable result."));
    return worker;
  }

  private post(request: PendingRequest, includeSource: boolean): void {
    const message: GeometryWorkerRequest = { id: request.id, config: request.config, sourceId: request.sourceId, ...(includeSource ? { source: request.source } : {}) };
    try {
      request.worker.postMessage(message);
      if (!this.outstanding.has(request.id)) this.outstanding.set(request.id, Date.now());
      if (includeSource) this.workerSourceId = request.sourceId;
    } catch (error) {
      this.handleFailure(request.worker, error);
    }
  }

  /** Terminate the worker if abandoned work is still running once its time is up. */
  private scheduleAbandonCheck(delayMs: number): void {
    if (this.abandonTimer !== undefined) return;
    this.abandonTimer = setTimeout(() => {
      this.abandonTimer = undefined;
      const worker = this.worker;
      if (!worker) return;
      const now = Date.now();
      let nextDeadline = Infinity;
      for (const [id, startedAt] of this.outstanding) {
        if (id === this.pending?.id) continue;
        nextDeadline = Math.min(nextDeadline, startedAt + this.abandonedWorkLimitMs);
      }
      if (nextDeadline === Infinity) return;
      if (nextDeadline > now) { this.scheduleAbandonCheck(nextDeadline - now); return; }
      this.restart(worker);
    }, delayMs);
  }

  /** Replace a worker stuck on abandoned work, moving the current request to a fresh one. */
  private restart(worker: Worker): void {
    const request = this.pending?.worker === worker ? this.pending : undefined;
    this.discardWorker(worker);
    if (request) this.moveToFreshWorker(request);
  }

  private moveToFreshWorker(request: PendingRequest): void {
    const next = this.ensureWorker();
    if (!next) {
      if (this.pending === request) this.pending = undefined;
      this.runSynchronously(request.config, request.source).then(request.resolve, request.reject);
      return;
    }
    request.worker = next;
    request.resentSource = false;
    this.post(request, true);
  }

  private handleMessage(worker: Worker, data: GeometryWorkerResponse | GeometryWorkerReady): void {
    if (worker !== this.worker) return;
    this.workerProven = true;
    if (data.ready) return;
    if (data.progress) {
      // A helper batch proves the coordinator is responsive. Allow its cancel
      // acknowledgement to preserve the source cache before forcing a restart.
      if (data.id === this.pending?.id) this.outstanding.set(data.id, Date.now());
      return;
    }
    const request = this.pending;
    // Late replies to a superseded request are dropped by id.
    if (!request || request.worker !== worker || data.id !== request.id) {
      this.outstanding.delete(data.id);
      return;
    }
    if (data.missingSource && !request.resentSource) {
      request.resentSource = true;
      this.post(request, true);
      return;
    }
    this.outstanding.delete(data.id);
    this.pending = undefined;
    if (data.result) request.resolve(data.result);
    else request.reject(new Error(data.error ?? "Geometry generation failed."));
  }

  private handleFailure(worker: Worker, error: unknown): void {
    if (worker !== this.worker) return;
    const neverWorked = !this.workerProven;
    const request = this.pending?.worker === worker ? this.pending : undefined;
    // The crash may belong to abandoned work queued ahead of the current request.
    const abandonedWork = [...this.outstanding.keys()].some((id) => id !== request?.id);
    this.discardWorker(worker);
    if (!request) return;
    // A worker that never started or answered in this session was most likely
    // blocked from loading (CSP in an embedding host). Finish this request on
    // the main thread and stop trying workers, instead of failing every future
    // edit. A worker that reported ready and then crashed stays enabled.
    if (neverWorked) {
      this.pending = undefined;
      this.unavailable = true;
      console.warn("TopoStack geometry worker failed to start; generating on the main thread.", error);
      this.runSynchronously(request.config, request.source).then(request.resolve, request.reject);
      return;
    }
    if (abandonedWork && !request.retried) {
      request.retried = true;
      this.moveToFreshWorker(request);
      return;
    }
    this.pending = undefined;
    request.reject(error);
  }

  private discardWorker(worker: Worker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    if (this.worker === worker) {
      this.worker = undefined;
      this.workerSourceId = 0;
      this.outstanding.clear();
      if (this.abandonTimer !== undefined) { clearTimeout(this.abandonTimer); this.abandonTimer = undefined; }
    }
  }
}
