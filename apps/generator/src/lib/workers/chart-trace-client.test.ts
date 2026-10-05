import { describe, expect, it, vi } from "vitest";
import { ChartTraceClient } from "$lib/workers/chart-trace-client";
import type { ChartBuildRequest, ChartBuildResult } from "$lib/domain/chart-build";

const image = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
const request = { image } as unknown as ChartBuildRequest;
const built = { record: { id: "round-lake-chart" }, report: { coverage: 1 } } as unknown as ChartBuildResult;

class FakeWorker {
  static last: FakeWorker | undefined;
  posted: Record<string, unknown>[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | undefined;
  onerror: ((event: unknown) => void) | undefined;
  onmessageerror: ((event: unknown) => void) | undefined;
  constructor() { FakeWorker.last = this; }
  postMessage(message: Record<string, unknown>): void { this.posted.push(message); }
  terminate(): void { this.terminated = true; }
  reply(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}

const clientWithWorker = () => {
  const client = new ChartTraceClient(() => new FakeWorker() as unknown as Worker);
  return { client, worker: () => FakeWorker.last! };
};

describe("ChartTraceClient", () => {
  it("answers a build from the worker and ignores its ready handshake", async () => {
    const { client, worker } = clientWithWorker();
    const pending = client.build(request);
    worker().reply({ ready: true });
    expect(worker().posted[0]).toMatchObject({ kind: "build", id: 1 });
    worker().reply({ id: 1, built });
    await expect(pending).resolves.toBe(built);
  });

  it("returns unlabelled contours from the worker", async () => {
    const { client, worker } = clientWithWorker();
    const pending = client.contours(image);
    expect(worker().posted[0]).toMatchObject({ kind: "contours", id: 1 });
    const contours = [{ points: [[0, 0], [10, 10]], closed: false }];
    worker().reply({ id: 1, contours });
    await expect(pending).resolves.toEqual(contours);
  });

  it("reports a failed trace as an error, not a hang", async () => {
    const { client, worker } = clientWithWorker();
    const pending = client.build(request);
    worker().reply({ id: 1, error: "No lines were traced from this image." });
    await expect(pending).rejects.toThrow("No lines were traced");
  });

  it("drops a cancelled request's late reply", async () => {
    const { client, worker } = clientWithWorker();
    const pending = client.build(request);
    const first = worker();
    client.cancel();
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(first.terminated).toBe(true);
    // The abandoned worker answering now must not settle anything.
    expect(() => first.reply({ id: 1, built })).not.toThrow();
    // A fresh worker takes the next request, under the next id.
    const next = client.palette(image);
    expect(worker()).not.toBe(first);
    worker().reply({ id: 2, swatches: [] });
    await expect(next).resolves.toEqual([]);
  });

  it("runs on the main thread where workers are unavailable", async () => {
    const build = vi.fn(() => built);
    const swatches = vi.fn(() => []);
    const client = new ChartTraceClient(undefined, build, swatches);
    await expect(client.build(request)).resolves.toBe(built);
    await expect(client.palette(image, 4)).resolves.toEqual([]);
    expect(build).toHaveBeenCalledWith(request);
    expect(swatches).toHaveBeenCalledWith(image, 4);
  });

  it("falls back to the main thread when a worker cannot be constructed", async () => {
    const build = vi.fn(() => built);
    const client = new ChartTraceClient(() => { throw new Error("Blocked by policy"); }, build);
    await expect(client.build(request)).resolves.toBe(built);
    expect(build).toHaveBeenCalledOnce();
  });

  it("starts a fresh worker after one that had answered crashes", async () => {
    const { client, worker } = clientWithWorker();
    const pending = client.build(request);
    const first = worker();
    first.reply({ ready: true });
    first.onmessageerror?.({});
    await expect(pending).rejects.toThrow(/stopped unexpectedly/);
    const next = client.build(request);
    expect(worker()).not.toBe(first);
    const id = worker().posted[0]!.id;
    worker().reply({ id, built });
    await expect(next).resolves.toBe(built);
  });

  it("fails every pending request when the worker itself errors", async () => {
    const { client, worker } = clientWithWorker();
    const pending = client.build(request);
    worker().onerror?.({});
    await expect(pending).rejects.toThrow(/could not start/);
  });
});
