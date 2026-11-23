import type { Point2D } from "../../types.js";
import type { StripEngine, StripEngineItem, StripEnginePlacement, StripEngineResult } from "./engine.js";
import { candidateOrientations, rotatedBounds, sheetFitOrientations } from "./transform.js";

const EPSILON = 1e-6;

interface Segment {
  y0: number;
  y1: number;
  /** Occupied up to this x across [y0, y1). */
  x: number;
}

interface Orientation {
  rotationDeg: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
}

export interface RectanglePackResult extends StripEngineResult {
  /** Indexes of items that did not fit the strip, or the width limit. */
  unplaced: number[];
}

function orientationsOf(item: StripEngineItem, maxWidth: number, maxHeight: number): Orientation[] {
  const points: Point2D[] = item.outline.map(([x, y]) => ({ x, y }));
  const measure = (rotationDeg: number): Orientation => {
    const bounds = rotatedBounds(points, rotationDeg);
    return { rotationDeg, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, minX: bounds.minX, minY: bounds.minY };
  };
  const candidates = candidateOrientations(points, item.orientationsDeg).map(measure);
  const fits = (box: Orientation) => box.width <= maxWidth + EPSILON && box.height <= maxHeight + EPSILON;
  if (!item.orientationsDeg && !candidates.some(fits)) {
    for (const angle of sheetFitOrientations(points, maxWidth)) {
      const candidate = measure(angle);
      if (fits(candidate)) {
        candidates.push(candidate);
        break;
      }
    }
  }
  return candidates;
}

/**
 * Skyline packing of each item's rotated bounding box into a strip of fixed
 * height, growing along x. Boxes never overlap, so the parts inside them
 * cannot either; it wastes the concavities sparrow would use, but is instant
 * and never wrong. Boxes are grown by the spacing on their far sides, so
 * parts may touch the strip edges but keep `spacing` from each other.
 */
export function packRectangles(items: StripEngineItem[], stripHeight: number, spacing: number, maxWidth = Number.POSITIVE_INFINITY): RectanglePackResult {
  const height = stripHeight + spacing;
  const widthLimit = maxWidth + spacing;
  let skyline: Segment[] = [{ y0: 0, y1: height, x: 0 }];
  const candidates = items.map((item, index) => ({ index, orientations: orientationsOf(item, maxWidth, stripHeight) }));
  const footprint = (orientations: Orientation[]) => Math.min(...orientations.map((o) => o.width * o.height));
  const longest = (orientations: Orientation[]) => Math.min(...orientations.map((o) => Math.max(o.width, o.height)));
  // Big parts first; among equals, the long thin ones, which are hardest to place late.
  candidates.sort((left, right) => footprint(right.orientations) - footprint(left.orientations) || longest(right.orientations) - longest(left.orientations) || left.index - right.index);

  const placements: StripEnginePlacement[] = [];
  const unplaced: number[] = [];
  let usedWidth = 0;
  for (const { index, orientations } of candidates) {
    let best: { y: number; x: number; right: number; orientation: Orientation } | undefined;
    for (const orientation of orientations) {
      const boxWidth = orientation.width + spacing;
      const boxHeight = orientation.height + spacing;
      if (boxHeight > height + EPSILON) continue;
      for (let start = 0; start < skyline.length; start += 1) {
        const y = skyline[start]!.y0;
        if (y + boxHeight > height + EPSILON) break;
        let x = 0;
        for (let covering = start; covering < skyline.length && skyline[covering]!.y0 < y + boxHeight - EPSILON; covering += 1) {
          x = Math.max(x, skyline[covering]!.x);
        }
        const right = x + boxWidth;
        if (right > widthLimit + EPSILON) continue;
        if (!best || right < best.right - EPSILON || (Math.abs(right - best.right) <= EPSILON && y < best.y)) best = { y, x, right, orientation };
      }
    }
    if (!best) {
      unplaced.push(index);
      continue;
    }
    const top = best.y + best.orientation.height + spacing;
    skyline = raise(skyline, best.y, Math.min(top, height), best.right);
    usedWidth = Math.max(usedWidth, best.x + best.orientation.width);
    placements.push({ index, rotationDeg: best.orientation.rotationDeg, x: best.x - best.orientation.minX, y: best.y - best.orientation.minY });
  }
  placements.sort((left, right) => left.index - right.index);
  return { stripWidth: usedWidth, placements, unplaced: unplaced.sort((left, right) => left - right) };
}

/** The skyline with [y0, y1) raised to x, adjacent equal segments merged. */
function raise(skyline: Segment[], y0: number, y1: number, x: number): Segment[] {
  const next: Segment[] = [];
  for (const segment of skyline) {
    if (segment.y1 <= y0 + EPSILON || segment.y0 >= y1 - EPSILON) {
      next.push(segment);
      continue;
    }
    if (segment.y0 < y0 - EPSILON) next.push({ y0: segment.y0, y1: y0, x: segment.x });
    if (segment.y1 > y1 + EPSILON) next.push({ y0: y1, y1: segment.y1, x: segment.x });
  }
  next.push({ y0, y1, x });
  next.sort((left, right) => left.y0 - right.y0);
  const merged: Segment[] = [];
  for (const segment of next) {
    const last = merged.at(-1);
    if (last && Math.abs(last.x - segment.x) <= EPSILON && Math.abs(last.y1 - segment.y0) <= EPSILON) last.y1 = segment.y1;
    else merged.push({ ...segment });
  }
  return merged;
}

/** Instant, always-valid strip packing of bounding boxes. */
export const rectangleEngine: StripEngine = {
  name: "rectangles",
  pack(job) {
    const result = packRectangles(job.items, job.stripHeight, job.spacing);
    if (result.unplaced.length) throw new Error(`Items ${result.unplaced.join(", ")} are taller than the strip in every allowed rotation.`);
    return { stripWidth: result.stripWidth, placements: result.placements };
  },
};
