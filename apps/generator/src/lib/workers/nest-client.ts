import { planSheets, rectangleEngine, type NestPartV1, type ResolvedSheetNestSettings, type SheetNestPlanV1 } from "@topostack/core";

/**
 * Drives the sheet-nesting worker. One job at a time: starting another, or
 * cancelling, discards the worker with its job, because sparrow cannot be
 * interrupted mid-call any other way. Stopping keeps the best layout found so
 * far; every draft the worker reports is already a complete, valid plan. Where
 * workers are unavailable the bounding-box packer runs on the main thread.
 */

export interface NestWorkerRequest {
  id: number;
  parts: NestPartV1[];
  settings: ResolvedSheetNestSettings;
  budgetMs: number;
}

export interface NestWorkerReply {
  id?: number;
  ready?: boolean;
  draft?: SheetNestPlanV1;
  plan?: SheetNestPlanV1;
  /** The WebAssembly engine could not start; bounding boxes stand in. */
  fallbackReason?: string;
  error?: string;
  code?: "no-parts" | "oversize";
  labels?: string[];
}

export class NestJobError extends Error {
  constructor(message: string, readonly code?: NestWorkerReply["code"], readonly labels: string[] = []) {
    super(message);
    this.name = "NestJobError";
  }
}

export interface NestRunOptions {
  budgetMs: number;
  onDraft?: (plan: SheetNestPlanV1) => void;
  onFallback?: (reason: string) => void;
}

export type WorkerFactory = () => Worker;

export const defaultWorkerFactory: WorkerFactory | undefined =
  typeof Worker === "undefined" ? undefined : () => new Worker(new URL("./nest.worker.ts", import.meta.url), { type: "module" });

interface Job {
  id: number;
  options: NestRunOptions;
  best: SheetNestPlanV1 | undefined;
  resolve: (plan: SheetNestPlanV1) => void;
  reject: (reason: unknown) => void;
}

const cancelled = () => new DOMException("Sheet nesting cancelled", "AbortError");

export class NestClient {
  private worker: Worker | undefined;
  private unavailable: boolean;
  /** A worker has answered in this session, so a later crash is not a blocked worker. */
  private proven = false;
  private nextId = 0;
  private job: Job | undefined;

  constructor(private readonly factory: WorkerFactory | undefined = defaultWorkerFactory) {
    this.unavailable = !factory;
  }

  get running(): boolean {
    return Boolean(this.job);
  }

  run(parts: NestPartV1[], settings: ResolvedSheetNestSettings, options: NestRunOptions): Promise<SheetNestPlanV1> {
    this.cancel();
    const worker = this.unavailable ? undefined : this.ensureWorker();
    if (!worker) {
      options.onFallback?.("Web workers are unavailable here.");
      return planSheets(parts, settings, { engine: rectangleEngine, onPlan: options.onDraft });
    }
    const id = ++this.nextId;
    return new Promise<SheetNestPlanV1>((resolve, reject) => {
      this.job = { id, options, best: undefined, resolve, reject };
      try {
        worker.postMessage({ id, parts, settings, budgetMs: options.budgetMs } satisfies NestWorkerRequest);
      } catch (error) {
        this.job = undefined;
        reject(error);
      }
    });
  }

  /** End the search now and settle for the best layout found, if there is one yet. */
  stop(): void {
    const job = this.job;
    if (!job) return;
    this.discardWorker();
    this.job = undefined;
    if (job.best) job.resolve(job.best);
    else job.reject(cancelled());
  }

  /** Abandon the search and its result. */
  cancel(): void {
    const job = this.job;
    if (!job) return;
    this.discardWorker();
    this.job = undefined;
    job.reject(cancelled());
  }

  dispose(): void {
    this.cancel();
    this.discardWorker();
  }

  private ensureWorker(): Worker | undefined {
    if (this.worker) return this.worker;
    let worker: Worker;
    try {
      worker = this.factory!();
    } catch {
      this.unavailable = true;
      return undefined;
    }
    worker.onmessage = (event: MessageEvent<NestWorkerReply>) => { this.proven = true; this.receive(event.data); };
    worker.onerror = () => this.fail();
    worker.onmessageerror = () => this.fail();
    this.worker = worker;
    return worker;
  }

  private receive(reply: NestWorkerReply): void {
    const job = this.job;
    if (reply.ready || !job || reply.id !== job.id) return;
    if (reply.fallbackReason !== undefined) job.options.onFallback?.(reply.fallbackReason);
    if (reply.draft) {
      job.best = reply.draft;
      job.options.onDraft?.(reply.draft);
    }
    if (reply.plan) {
      this.job = undefined;
      job.resolve(reply.plan);
    } else if (reply.error !== undefined) {
      this.job = undefined;
      job.reject(new NestJobError(reply.error, reply.code, reply.labels));
    }
  }

  /**
   * A worker that never answered was most likely blocked from loading, so the
   * main-thread packer takes over for the session. One that answered and then
   * crashed fails only this job; the next run starts a fresh worker.
   */
  private fail(): void {
    const job = this.job;
    this.job = undefined;
    this.discardWorker();
    if (!this.proven) this.unavailable = true;
    job?.reject(new NestJobError(this.proven ? "Sheet nesting stopped unexpectedly. Try again." : "Sheet nesting could not start in this browser."));
  }

  private discardWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }
}
