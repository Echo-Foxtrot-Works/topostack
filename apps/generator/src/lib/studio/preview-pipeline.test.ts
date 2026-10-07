import { describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, type GeometryIRV1, type SourceBundleV1 } from "@topostack/core";
import { GeometryWorkerClient, type GeometryWorkerCancel, type GeometryWorkerRequest, type GeometryWorkerResponse } from "$lib/workers/geometry-worker-client";
import { PreviewPipeline } from "$lib/studio/preview-pipeline";

class FakeWorker {
  onmessage: ((event: { data: GeometryWorkerResponse }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault?: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: GeometryWorkerRequest[] = [];
  terminated = false;
  cancellations: number[] = [];
  postMessage(message: GeometryWorkerRequest | GeometryWorkerCancel): void { if ("cancelId" in message) this.cancellations.push(message.cancelId); else this.posted.push(message); }
  terminate(): void { this.terminated = true; }
  reply(data: GeometryWorkerResponse): void { this.onmessage?.({ data }); }
  get last(): GeometryWorkerRequest { return this.posted.at(-1)!; }
}

const geometry = (name: string) => ({ projectName: name }) as unknown as GeometryIRV1;
const source = (): SourceBundleV1 => createSyntheticSource(DEFAULT_PROJECT, 8);

function setup(generate = vi.fn(() => geometry("sync"))) {
  const workers: FakeWorker[] = [];
  const factory = vi.fn(() => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; });
  return { client: new GeometryWorkerClient(factory, generate), workers, factory, generate };
}

describe("geometry worker client", () => {
  it("keeps one worker and posts an unchanged source only once", async () => {
    const { client, workers, factory } = setup();
    const bundle = source();
    const first = client.run(DEFAULT_PROJECT, bundle);
    expect(workers[0]!.last.source).toBe(bundle);
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("first") });
    await expect(first).resolves.toMatchObject({ projectName: "first" });

    const second = client.run({ ...DEFAULT_PROJECT, materialThicknessMm: 6 }, bundle);
    expect(workers[0]!.last.source).toBeUndefined();
    expect(workers[0]!.last.config.materialThicknessMm).toBe(6);
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("second") });
    await expect(second).resolves.toMatchObject({ projectName: "second" });
    expect(factory).toHaveBeenCalledOnce();
    expect(workers[0]!.terminated).toBe(false);
  });

  it("adopts a warm worker and reuses the source it already holds", async () => {
    const { client, workers, factory } = setup();
    const warm = new FakeWorker();
    const bundle = source();
    client.adopt({ worker: warm as unknown as Worker, source: bundle, sourceId: 0 });
    const pending = client.run({ ...DEFAULT_PROJECT, materialThicknessMm: 6 }, bundle);
    expect(factory).not.toHaveBeenCalled();
    expect(warm.last.sourceId).toBe(0);
    expect(warm.last.source).toBeUndefined();
    warm.reply({ id: warm.last.id, result: geometry("warm") });
    await expect(pending).resolves.toMatchObject({ projectName: "warm" });

    // A crash later is a crash of a proven worker: it fails the request rather than disabling workers.
    const next = client.run(DEFAULT_PROJECT, source());
    warm.onerror?.({ message: "out of memory" });
    await expect(next).rejects.toThrow("out of memory");
    expect(warm.terminated).toBe(true);
    void client.run(DEFAULT_PROJECT, bundle);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.last.source).toBe(bundle);
  });

  it("terminates a warm worker it cannot use", () => {
    const { client, workers } = setup();
    void client.run(DEFAULT_PROJECT, source());
    const warm = new FakeWorker();
    client.adopt({ worker: warm as unknown as Worker, source: source(), sourceId: 0 });
    expect(warm.terminated).toBe(true);
    expect(workers[0]!.terminated).toBe(false);

    const fallback = new GeometryWorkerClient(undefined, () => geometry("sync"));
    const unused = new FakeWorker();
    fallback.adopt({ worker: unused as unknown as Worker, source: source(), sourceId: 0 });
    expect(unused.terminated).toBe(true);
  });

  it("resends the source when the worker reports it missing", async () => {
    const { client, workers } = setup();
    const bundle = source();
    const first = client.run(DEFAULT_PROJECT, bundle);
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("first") });
    await first;
    const pending = client.run(DEFAULT_PROJECT, bundle);
    const { id } = workers[0]!.last;
    workers[0]!.reply({ id, missingSource: true });
    expect(workers[0]!.last).toMatchObject({ id, source: bundle });
    workers[0]!.reply({ id, result: geometry("resent") });
    await expect(pending).resolves.toMatchObject({ projectName: "resent" });
  });

  it("keeps the worker and its cached source when a request is cancelled", async () => {
    const { client, workers, factory } = setup();
    const bundle = source();
    const pending = client.run(DEFAULT_PROJECT, bundle);
    const staleId = workers[0]!.last.id;
    client.cancel();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(false);

    const next = client.run(DEFAULT_PROJECT, bundle);
    expect(workers[0]!.last.source).toBeUndefined();
    // The cancelled request's late reply is dropped by id, so the new request
    // still resolves from its own.
    workers[0]!.reply({ id: staleId, result: geometry("stale") });
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("next") });
    await expect(next).resolves.toMatchObject({ projectName: "next" });
    expect(factory).toHaveBeenCalledOnce();
    client.dispose();
    expect(workers[0]!.terminated).toBe(true);
  });

  it("uses progress and a cancellation acknowledgement to preserve a long job's source cache", async () => {
    vi.useFakeTimers();
    const { client, workers, factory } = setup();
    try {
      const bundle = source();
      const pending = client.run(DEFAULT_PROJECT, bundle).catch((error: unknown) => error);
      const id = workers[0]!.last.id;
      await vi.advanceTimersByTimeAsync(5_000);
      workers[0]!.reply({ id, progress: { stage: "alignment", completed: 2, total: 100 } });
      client.cancel();
      expect(await pending).toMatchObject({ name: "AbortError" });
      expect(workers[0]!.cancellations).toEqual([id]);
      expect(workers[0]!.terminated).toBe(false);
      workers[0]!.reply({ id, cancelled: true });
      await vi.advanceTimersByTimeAsync(2_000);
      const next = client.run(DEFAULT_PROJECT, bundle);
      expect(workers[0]!.last.source).toBeUndefined();
      // Stale progress does not resolve the current request.
      workers[0]!.reply({ id, progress: { stage: "alignment", completed: 4, total: 100 } });
      workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("current") });
      await expect(next).resolves.toMatchObject({ projectName: "current" });
      expect(factory).toHaveBeenCalledOnce();
    } finally { client.dispose(); vi.useRealTimers(); }
  });

  it("terminates a worker still busy with abandoned work past the limit and moves the current request", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const client = new GeometryWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; }, () => geometry("sync"), 500);
      const bundle = source();
      void client.run(DEFAULT_PROJECT, bundle).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(200);
      const current = client.run({ ...DEFAULT_PROJECT, name: "current" }, bundle);
      expect(workers[0]!.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(workers[0]!.terminated).toBe(true);
      expect(workers[1]!.last).toMatchObject({ source: bundle, config: { name: "current" } });
      workers[1]!.reply({ id: workers[1]!.last.id, result: geometry("current") });
      await expect(current).resolves.toMatchObject({ projectName: "current" });

      // Cancelling work that already ran past the limit terminates at once.
      void client.run(DEFAULT_PROJECT, bundle).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(600);
      client.cancel();
      expect(workers[1]!.terminated).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("does not terminate when abandoned work finishes in time", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      const client = new GeometryWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; }, () => geometry("sync"), 500);
      const bundle = source();
      void client.run(DEFAULT_PROJECT, bundle).catch(() => undefined);
      const staleId = workers[0]!.last.id;
      const current = client.run(DEFAULT_PROJECT, bundle);
      workers[0]!.reply({ id: staleId, result: geometry("stale") });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(workers[0]!.terminated).toBe(false);
      workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("current") });
      await expect(current).resolves.toMatchObject({ projectName: "current" });
    } finally { vi.useRealTimers(); }
  });

  it("retries the current request on a fresh worker when abandoned work crashes the worker", async () => {
    const { client, workers } = setup();
    const bundle = source();
    const first = client.run(DEFAULT_PROJECT, bundle);
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("ok") });
    await first;
    void client.run(DEFAULT_PROJECT, bundle).catch(() => undefined);
    const current = client.run(DEFAULT_PROJECT, bundle);
    workers[0]!.onerror!({ message: "Out of memory" });
    expect(workers[1]!.last.source).toBe(bundle);
    workers[1]!.reply({ id: workers[1]!.last.id, result: geometry("retried") });
    await expect(current).resolves.toMatchObject({ projectName: "retried" });
  });

  it("rejects generation errors without discarding a working worker", async () => {
    const { client, workers } = setup();
    const ok = client.run(DEFAULT_PROJECT, source());
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("ok") });
    await ok;
    const failing = client.run(DEFAULT_PROJECT, source());
    workers[0]!.reply({ id: workers[0]!.last.id, error: "Contours failed" });
    await expect(failing).rejects.toThrow("Contours failed");
    expect(workers[0]!.terminated).toBe(false);
  });

  it("ignores late replies from a superseded request or replaced worker", async () => {
    const { client, workers } = setup();
    const bundle = source();
    const first = client.run(DEFAULT_PROJECT, bundle);
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("first") });
    await first;
    const stale = client.run(DEFAULT_PROJECT, bundle).catch((error: unknown) => error);
    const staleId = workers[0]!.last.id;
    const current = client.run({ ...DEFAULT_PROJECT, name: "current" }, bundle);
    expect(await stale).toMatchObject({ name: "AbortError" });
    workers[0]!.reply({ id: staleId, result: geometry("stale") });
    // A message already queued on a replaced worker still arrives.
    const replacedHandler = workers[0]!.onmessage!;
    workers[0]!.onerror!({ message: "Out of memory" });
    await expect(current).rejects.toThrow("Out of memory");
    const next = client.run(DEFAULT_PROJECT, bundle);
    replacedHandler({ data: { id: workers[1]!.last.id, result: geometry("replaced") } });
    workers[1]!.reply({ id: workers[1]!.last.id, result: geometry("next") });
    await expect(next).resolves.toMatchObject({ projectName: "next" });
  });

  it("falls back to main-thread generation when the worker cannot be constructed", async () => {
    const generate = vi.fn(() => geometry("sync"));
    const factory = vi.fn(() => { throw new DOMException("Blocked by CSP", "SecurityError"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = new GeometryWorkerClient(factory, generate);
    await expect(client.run(DEFAULT_PROJECT, source())).resolves.toMatchObject({ projectName: "sync" });
    await expect(client.run(DEFAULT_PROJECT, source())).resolves.toMatchObject({ projectName: "sync" });
    expect(factory).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("finishes on the main thread when a worker fails before ever answering", async () => {
    const { client, workers, generate } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending = client.run(DEFAULT_PROJECT, source());
    workers[0]!.onerror!({ message: "Failed to load worker script" });
    await expect(pending).resolves.toMatchObject({ projectName: "sync" });
    expect(workers[0]!.terminated).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("keeps workers enabled when a started worker crashes before its first answer", async () => {
    const { client, workers, factory, generate } = setup();
    const crashed = client.run(DEFAULT_PROJECT, source());
    // The script loaded and evaluated, then the first large generation ran out of memory.
    workers[0]!.onmessage!({ data: { ready: true } as unknown as GeometryWorkerResponse });
    workers[0]!.onerror!({ message: "Out of memory" });
    await expect(crashed).rejects.toThrow("Out of memory");
    expect(generate).not.toHaveBeenCalled();
    const next = client.run(DEFAULT_PROJECT, source());
    expect(factory).toHaveBeenCalledTimes(2);
    workers[1]!.reply({ id: workers[1]!.last.id, result: geometry("worker") });
    await expect(next).resolves.toMatchObject({ projectName: "worker" });
  });

  it("rejects and replaces a proven worker after a runtime or deserialization error", async () => {
    const { client, workers } = setup();
    const first = client.run(DEFAULT_PROJECT, source());
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("ok") });
    await first;
    const crashed = client.run(DEFAULT_PROJECT, source());
    workers[0]!.onerror!({ message: "Out of memory" });
    await expect(crashed).rejects.toThrow("Out of memory");
    const unreadable = client.run(DEFAULT_PROJECT, source());
    expect(workers).toHaveLength(2);
    workers[1]!.reply({ id: workers[1]!.last.id, result: geometry("ok") });
    await unreadable;
    const next = client.run(DEFAULT_PROJECT, source());
    workers[1]!.onmessageerror!();
    await expect(next).rejects.toThrow("unreadable");
    expect(workers[1]!.terminated).toBe(true);
  });

  it("remembers across restarts that workers load, so a later crash never disables them", async () => {
    const { client, workers, factory, generate } = setup();
    const first = client.run(DEFAULT_PROJECT, source());
    workers[0]!.reply({ id: workers[0]!.last.id, result: geometry("ok") });
    await first;
    const crashed = client.run(DEFAULT_PROJECT, source());
    workers[0]!.onerror!({ message: "Out of memory" });
    await expect(crashed).rejects.toThrow("Out of memory");
    // The fresh worker crashes before its first answer: still a runtime error, not a blocked worker.
    const crashedAgain = client.run(DEFAULT_PROJECT, source());
    workers[1]!.onerror!({ message: "Out of memory" });
    await expect(crashedAgain).rejects.toThrow("Out of memory");
    void client.run(DEFAULT_PROJECT, source()).catch(() => undefined);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(generate).not.toHaveBeenCalled();
    client.dispose();
  });
});

describe("preview pipeline", () => {
  const update = (overrides: Partial<Parameters<PreviewPipeline["runPreviewUpdate"]>[0]> = {}) => ({
    config: DEFAULT_PROJECT,
    prepareSource: vi.fn(async () => source()),
    onCommit: vi.fn(),
    onError: vi.fn(),
    onSettled: vi.fn(),
    ...overrides,
  });

  it("coalesces edits made during the trailing delay", async () => {
    vi.useFakeTimers();
    try {
      const pipeline = new PreviewPipeline(async () => new GeometryWorkerClient(undefined, () => geometry("sync")));
      const first = update();
      const firstRun = pipeline.runPreviewUpdate(first, 120);
      pipeline.invalidate();
      const second = update();
      const secondRun = pipeline.runPreviewUpdate(second, 120);
      await vi.advanceTimersByTimeAsync(120);
      await Promise.all([firstRun, secondRun]);
      expect(first.prepareSource).not.toHaveBeenCalled();
      expect(second.onCommit).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("settles a debounce replaced at the same revision and runs only the last update", async () => {
    vi.useFakeTimers();
    try {
      const pipeline = new PreviewPipeline(async () => new GeometryWorkerClient(undefined, () => geometry("sync")));
      // Two refreshes without an invalidation between them: a cosmetic or
      // style edit keeps pending work, so both share one revision. The first
      // promise must still settle, or its caller's pending state never clears.
      const first = update();
      const firstRun = pipeline.runPreviewUpdate(first, 120);
      const second = update();
      const secondRun = pipeline.runPreviewUpdate(second, 120);
      await vi.advanceTimersByTimeAsync(120);
      await Promise.all([firstRun, secondRun]);
      expect(first.prepareSource).not.toHaveBeenCalled();
      expect(first.onCommit).not.toHaveBeenCalled();
      expect(second.onCommit).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("never commits a refresh superseded while loading data, and aborts its signal", async () => {
    const pipeline = new PreviewPipeline(async () => setup().client);
    let signal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    const stale = update({ prepareSource: vi.fn((abort: AbortSignal) => { signal = abort; return new Promise<SourceBundleV1>((resolve) => { finish = () => resolve(source()); }); }) });
    const run = pipeline.runPreviewUpdate(stale);
    await Promise.resolve();
    pipeline.invalidate();
    expect(signal?.aborted).toBe(true);
    finish!();
    await run;
    expect(stale.onCommit).not.toHaveBeenCalled();
    expect(stale.onError).not.toHaveBeenCalled();
    expect(stale.onSettled).toHaveBeenCalledWith(false);
  });

  it("retries a failed worker-client chunk load on the next generation", async () => {
    const loadClient = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockImplementation(async () => new GeometryWorkerClient(undefined, () => geometry("sync")));
    const pipeline = new PreviewPipeline(loadClient);
    await expect(pipeline.generate(DEFAULT_PROJECT, source())).rejects.toThrow("dynamically imported module");
    await expect(pipeline.generate(DEFAULT_PROJECT, source())).resolves.toMatchObject({ projectName: "sync" });
    await pipeline.generate(DEFAULT_PROJECT, source());
    expect(loadClient).toHaveBeenCalledTimes(2);
    pipeline.dispose();
  });

  it("reports failures of the current refresh", async () => {
    const failing = update();
    const syncPipeline = new PreviewPipeline(async () => new GeometryWorkerClient(undefined, () => { throw new Error("Bad geometry"); }));
    await syncPipeline.runPreviewUpdate(failing);
    expect(failing.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Bad geometry" }));
    expect(failing.onSettled).toHaveBeenCalledWith(true);
    syncPipeline.dispose();
  });
});

describe("preview pipeline fonts", () => {
  it("loads a project's fonts on the page before generating, and not when a newer edit won", async () => {
    const run = vi.fn(async () => geometry("typeset"));
    const client = { run, cancel: vi.fn(), dispose: vi.fn() } as unknown as GeometryWorkerClient;
    let finishFonts!: () => void;
    const loadFonts = vi.fn(() => new Promise<void>((resolve) => { finishFonts = resolve; }));
    const pipeline = new PreviewPipeline(async () => client, loadFonts);
    const project = { ...DEFAULT_PROJECT, textStyle: { font: "relief" as const, sizeMm: 4 }, plaque: { enabled: true, text: "T", sizeMm: 6, font: "lora" as const, placement: { anchor: "top" as const, offset: { x: 0, y: 0 } } } };
    const pending = pipeline.generate(project, source());
    await vi.waitFor(() => expect(loadFonts).toHaveBeenCalledWith(["relief", "lora"]));
    expect(run).not.toHaveBeenCalled();
    finishFonts();
    await expect(pending).resolves.toMatchObject({ projectName: "typeset" });

    const superseded = pipeline.generate(project, source());
    pipeline.invalidate();
    finishFonts();
    await expect(superseded).rejects.toMatchObject({ name: "AbortError" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
