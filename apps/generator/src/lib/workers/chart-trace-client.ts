import { prepareChartReview, type ChartReview } from "$lib/domain/chart-review";
import { detectChartContours, type ChartContour } from "$lib/domain/chart-contours";
import { buildChartFromImage, type ChartBuildRequest, type ChartBuildResult } from "$lib/domain/chart-build";
import { palette, type Swatch } from "@topostack/chart-trace/raster";

/**
 * Drives the chart-tracing worker for the custom data view.
 *
 * Tracing is one-shot work the maker waits for, not a stream of edits, so this
 * is simpler than the geometry client: one worker while the custom data view is open,
 * one request at a time, and every reply matched by id so a cancelled trace
 * cannot land on a later one. Where workers are unavailable — jsdom in tests,
 * or a host frame whose policy blocks them — the same functions run on the
 * main thread, because a slow trace beats no tracing at all.
 */

export type WorkerFactory = () => Worker;

export const defaultWorkerFactory: WorkerFactory | undefined =
  typeof Worker === "undefined" ? undefined : () => new Worker(new URL("./chart-trace.worker.ts", import.meta.url), { type: "module" });

interface WorkerReply {
  id: number;
  ready?: boolean;
  swatches?: Swatch[];
  built?: ChartBuildResult;
  contours?: ChartContour[];
  review?: ChartReview;
  error?: string;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
}

const CANCELLED = () => new DOMException("Chart tracing cancelled", "AbortError");

export class ChartTraceClient {
  private worker: Worker | undefined;
  private unavailable: boolean;
  /** A worker has answered in this session, so a later crash is not a blocked worker. */
  private proven = false;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  constructor(
    private readonly factory: WorkerFactory | undefined = defaultWorkerFactory,
    private readonly buildLocally = buildChartFromImage,
    private readonly swatchesOf = palette,
  ) {
    this.unavailable = !factory;
  }

  /** The image's main colours, for choosing which ink is contour line. */
  palette(image: ChartBuildRequest["image"], count = 8): Promise<Swatch[]> {
    return this.send<Swatch[]>({ kind: "palette", image, count }, () => this.swatchesOf(image, count));
  }

  contours(image: ChartBuildRequest["image"]): Promise<ChartContour[]> {
    return this.send<ChartContour[]>({ kind: "contours", image }, () => detectChartContours(image));
  }

  prepare(request: ChartBuildRequest): Promise<ChartReview> {
    return this.send<ChartReview>({ kind: "prepare", request }, () => prepareChartReview(request));
  }

  /** Trace, place and grid one chart. */
  build(request: ChartBuildRequest): Promise<ChartBuildResult> {
    return this.send<ChartBuildResult>({ kind: "build", request }, () => this.buildLocally(request));
  }

  /** Abandon every in-flight request; the worker is discarded with them. */
  cancel(): void {
    for (const pending of this.pending.values()) pending.reject(CANCELLED());
    this.pending.clear();
    if (this.worker) { this.worker.terminate(); this.worker = undefined; }
  }

  dispose(): void {
    this.cancel();
  }

  private send<T>(message: Record<string, unknown>, locally: () => T): Promise<T> {
    const worker = this.unavailable ? undefined : this.ensureWorker();
    if (!worker) {
      try { return Promise.resolve(locally()); }
      catch (error) { return Promise.reject(error); }
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject });
      try {
        worker.postMessage({ ...message, id });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private ensureWorker(): Worker | undefined {
    if (this.worker) return this.worker;
    let worker: Worker;
    try {
      worker = this.factory!();
    } catch {
      // A policy that forbids workers: everything runs on the main thread from here.
      this.unavailable = true;
      return undefined;
    }
    worker.onmessage = (event: MessageEvent<WorkerReply>) => { this.proven = true; this.receive(event.data); };
    worker.onerror = () => this.fail();
    worker.onmessageerror = () => this.fail();
    this.worker = worker;
    return worker;
  }

  private receive(reply: WorkerReply): void {
    if (reply.ready) return;
    const pending = this.pending.get(reply.id);
    // A reply to a cancelled request; its promise was already settled.
    if (!pending) return;
    this.pending.delete(reply.id);
    if (reply.error !== undefined) pending.reject(new Error(reply.error));
    else pending.resolve((reply.built ?? reply.swatches ?? reply.contours ?? reply.review) as never);
  }

  /** As in NestClient: only a worker that never answered sends later work to the main thread. */
  private fail(): void {
    const error = new Error(this.proven ? "Chart tracing stopped unexpectedly. Try again." : "Chart tracing could not start in this browser.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (this.worker) { this.worker.terminate(); this.worker = undefined; }
    if (!this.proven) this.unavailable = true;
  }
}
