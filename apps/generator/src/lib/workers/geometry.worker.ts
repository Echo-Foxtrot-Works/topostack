import { createParallelGeometryGenerator, projectFonts, type SourceBundleV1 } from "@topostack/core";
import { ensureFonts } from "$lib/domain/fonts";
import { ensureAirspaceStage } from "$lib/domain/airspace-stage";
import type { GeometryWorkerCancel, GeometryWorkerReady, GeometryWorkerRequest, GeometryWorkerResponse } from "$lib/workers/geometry-worker-client";
import { GeometryTaskPool, geometryWorkerCount } from "$lib/workers/geometry-task-pool";

const generateGeometry = createParallelGeometryGenerator();
let cached: { id: number; source: SourceBundleV1 } | undefined;
let queued: { request: GeometryWorkerRequest; source: SourceBundleV1 } | undefined;
let active: { id: number; controller: AbortController } | undefined;
let draining = false;
let pool: GeometryTaskPool | undefined;
const reply = (message: GeometryWorkerResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<GeometryWorkerRequest | GeometryWorkerCancel>) => {
  const message = event.data;
  if ("cancelId" in message) {
    if (active?.id === message.cancelId) active.controller.abort();
    if (queued?.request.id === message.cancelId) { reply({ id: message.cancelId, cancelled: true }); queued = undefined; }
    return;
  }
  if (message.source) cached = { id: message.sourceId, source: message.source };
  if (!cached || cached.id !== message.sourceId) { reply({ id: message.id, missingSource: true }); return; }
  if (queued) reply({ id: queued.request.id, cancelled: true });
  queued = { request: message, source: cached.source };
  active?.controller.abort();
  if (!draining) void drain();
};

/** Serialize sessions: a superseding request cannot race the previous terrain cache. */
async function drain(): Promise<void> {
  draining = true;
  try {
    while (queued) {
      const { request: { id, config }, source } = queued;
      queued = undefined;
      const controller = new AbortController();
      active = { id, controller };
      const { signal } = controller;
      try {
        await ensureFonts(projectFonts(config));
        if (config.airspaceStack) await ensureAirspaceStage();
        signal.throwIfAborted();
        const result = await generateGeometry(config, source, {
          checkCancelled: () => signal.throwIfAborted(),
          execute: async batch => {
            // Helpers are started only for large generation jobs.
            if (!pool) {
              signal.throwIfAborted();
              pool = new GeometryTaskPool(
                () => new Worker(new URL("./geometry-task.worker.ts", import.meta.url), { type: "module" }),
                geometryWorkerCount(navigator.hardwareConcurrency),
                30_000,
                error => console.warn("Parallel geometry helpers unavailable; using the coordinator.", error),
              );
            }
            return pool.run(batch, signal, (completed, total) => reply({ id, progress: { stage: batch.tasks[0]!.kind, completed, total } }));
          },
        });
        signal.throwIfAborted();
        reply({ id, result });
      } catch (error) {
        if (signal.aborted) reply({ id, cancelled: true });
        else reply({ id, error: error instanceof Error ? error.message : "Geometry generation failed." });
      } finally { active = undefined; }
    }
  } finally { draining = false; }
}
self.postMessage({ ready: true } satisfies GeometryWorkerReady);
