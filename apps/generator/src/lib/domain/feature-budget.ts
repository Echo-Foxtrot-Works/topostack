import type { Point2D } from "@topostack/core";

export const MAX_SOURCE_POINTS = 200_000;
export const MAX_SOURCE_RINGS = 4_000;

export class FeatureBudgetExceededError extends Error {
  constructor() {
    super("Map geometry exceeds the safe complexity limit. Narrow the map area and regenerate.");
  }
}

/** Bound decode/projection/union work before retaining a source's geometry. */
export function createFeatureBudget(used = { points: 0, rings: 0 }) {
  return (geometry: readonly (readonly Point2D[])[], polygon = false): void => {
    if (polygon) used.rings += geometry.length;
    for (const path of geometry) {
      used.points += path.length;
      if (used.points > MAX_SOURCE_POINTS || used.rings > MAX_SOURCE_RINGS) throw new FeatureBudgetExceededError();
    }
  };
}

export async function yieldForCancellation(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}
