import { DEFAULT_SHEET_NESTING, type NestPartV1, type ResolvedSheetNestSettings, type SheetNestPlanV1 } from "@topostack/core";
import { describe, expect, it, vi } from "vitest";
import { NestClient, NestJobError } from "$lib/workers/nest-client";

const settings: ResolvedSheetNestSettings = { ...DEFAULT_SHEET_NESTING, sheetWidthMm: 300, sheetHeightMm: 200 };
const square: NestPartV1 = {
  id: "layer-01:0",
  label: "L01",
  rootLayerIndex: 0,
  members: [{ layerIndex: 0, polygonIndexes: [0] }],
  outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 0 }],
  areaMm2: 2500,
};
const plan = (final: boolean): SheetNestPlanV1 => ({ schemaVersion: 1, jobKey: "nest1-x", engine: { name: "sparrow" }, settings, sheets: [], final, utilization: 0.5, elapsedMs: 10 });

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

const withWorker = () => ({ client: new NestClient(() => new FakeWorker() as unknown as Worker), worker: () => FakeWorker.last! });

describe("NestClient", () => {
  it("streams drafts and resolves with the final plan", async () => {
    const { client, worker } = withWorker();
    const onDraft = vi.fn();
    const onFallback = vi.fn();
    const running = client.run([square], settings, { budgetMs: 5000, onDraft, onFallback });
    expect(worker().posted[0]).toMatchObject({ id: 1, budgetMs: 5000, settings });
    worker().reply({ ready: true });
    worker().reply({ id: 1, fallbackReason: "no wasm" });
    worker().reply({ id: 1, draft: plan(false) });
    worker().reply({ id: 1, plan: plan(true) });
    await expect(running).resolves.toMatchObject({ final: true });
    expect(onDraft).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith("no wasm");
    expect(client.running).toBe(false);
  });

  it("stops with the best draft, discarding the worker", async () => {
    const { client, worker } = withWorker();
    const running = client.run([square], settings, { budgetMs: 5000 });
    worker().reply({ id: 1, draft: plan(false) });
    const first = worker();
    client.stop();
    await expect(running).resolves.toMatchObject({ final: false });
    expect(first.terminated).toBe(true);
  });

  it("cancels, or stops before any draft, as an abort", async () => {
    const { client } = withWorker();
    const cancelled = client.run([square], settings, { budgetMs: 5000 });
    client.cancel();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const stopped = client.run([square], settings, { budgetMs: 5000 });
    client.stop();
    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ignores replies to an abandoned job and aborts it when a new one starts", async () => {
    const { client, worker } = withWorker();
    const first = client.run([square], settings, { budgetMs: 5000 });
    const second = client.run([square], settings, { budgetMs: 5000 });
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    worker().reply({ id: 1, plan: plan(true) });
    expect(client.running).toBe(true);
    worker().reply({ id: 2, plan: plan(true) });
    await expect(second).resolves.toMatchObject({ final: true });
  });

  it("reports planner errors with their code and labels", async () => {
    const { client, worker } = withWorker();
    const running = client.run([square], settings, { budgetMs: 5000 });
    worker().reply({ id: 1, error: "L01 is larger than the sheet.", code: "oversize", labels: ["L01"] });
    const error = await running.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(NestJobError);
    expect(error).toMatchObject({ code: "oversize", labels: ["L01"] });
  });

  it("fails the job when the worker cannot start, then packs on the main thread", async () => {
    const { client, worker } = withWorker();
    const running = client.run([square], settings, { budgetMs: 5000 });
    worker().onerror?.({});
    await expect(running).rejects.toThrow(/could not start/);
    const onFallback = vi.fn();
    const local = await client.run([square], settings, { budgetMs: 5000, onFallback });
    expect(local.engine.name).toBe("rectangles");
    expect(local.sheets).toHaveLength(1);
    expect(onFallback).toHaveBeenCalled();
  });

  it("keeps using workers after one that had answered crashes mid-search", async () => {
    const { client, worker } = withWorker();
    const running = client.run([square], settings, { budgetMs: 5000 });
    const first = worker();
    first.reply({ ready: true });
    first.onerror?.({});
    await expect(running).rejects.toThrow(/stopped unexpectedly/);
    expect(first.terminated).toBe(true);
    const next = client.run([square], settings, { budgetMs: 5000 });
    expect(worker()).not.toBe(first);
    worker().onmessageerror?.({});
    await expect(next).rejects.toThrow(NestJobError);
  });

  it("packs on the main thread where workers do not exist", async () => {
    const result = await new NestClient(undefined).run([square], settings, { budgetMs: 1000 });
    expect(result.final).toBe(true);
    expect(result.sheets[0]!.placements).toHaveLength(1);
  });
});
