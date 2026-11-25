import { clamp, pointAt } from "./geometry2d.js";
import { sampleIndexAt, sampleOffset } from "./grid.js";
import type { ElevationGrid, Point2D, ProjectConfigV1 } from "../types.js";

/** Vertices approximating a circular crop; see `cropBoundary`. */
export const CIRCLE_CROP_SEGMENTS = 96;

/** A circular crop is inscribed in the artwork, so its radius follows the shorter side. */
export function cropRadiusMm(config: Pick<ProjectConfigV1, "widthMm" | "heightMm">): number {
  return Math.min(config.widthMm, config.heightMm) / 2;
}

export function cropBoundary(config: ProjectConfigV1): Point2D[] {
  const w = config.widthMm / 2;
  const h = config.heightMm / 2;
  if (config.cropShape === "rectangle") {
    return [
      { x: -w, y: -h },
      { x: w, y: -h },
      { x: w, y: h },
      { x: -w, y: h },
      { x: -w, y: -h },
    ];
  }

  const radius = cropRadiusMm(config);
  const points = Array.from({ length: CIRCLE_CROP_SEGMENTS }, (_, index) => {
    const angle = (index / CIRCLE_CROP_SEGMENTS) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  // sin/cos of 2π are not exactly 0, so close with a copy of the first point
  // rather than a 97th sample; consumers require first === last exactly.
  return [...points, { ...points[0]! }];
}


/** How much of the remaining range an extreme must add, on a patch too small to cut, before it stops setting the range. */
const UNCUTTABLE_EXTREME_SHARE = 0.25;
const EXTREME_SAMPLE_LIMIT = 64;

/** The `count` lowest or highest values seen, kept in order; `at(count - 1)` is the count-th extreme. */
function extremeTracker(count: number, lowest: boolean) {
  const kept: number[] = [];
  return {
    add(value: number): void {
      const key = lowest ? value : -value;
      if (kept.length === count && key >= kept[count - 1]!) return;
      let slot = kept.length < count ? kept.length : count - 1;
      while (slot > 0 && kept[slot - 1]! > key) { kept[slot] = kept[slot - 1]!; slot -= 1; }
      kept[slot] = key;
    },
    /** The count-th extreme, or undefined when fewer values were seen. */
    get edge(): number | undefined {
      return kept.length === count ? (lowest ? kept[count - 1]! : -kept[count - 1]!) : undefined;
    },
  };
}

/**
 * The elevation range the layer ladder is sized from. An extreme held by a
 * patch too small to cut (under twice the minimum feature across) is ignored
 * when it alone would add a quarter or more to the range: one bad DEM pixel on
 * a flat coast otherwise sets the step for every sheet and leaves the real
 * relief in one layer. Such cells still join the top sheet or are flattened at
 * the base. Ordinary summits and deep points differ from their surroundings by
 * far less and keep their exact values.
 */
export function cropElevationRange(config: ProjectConfigV1, grid: ElevationGrid, waterMask: Uint8Array) {
  const cellAreaMm2 = (config.widthMm / Math.max(1, grid.width - 1)) * (config.heightMm / Math.max(1, grid.height - 1));
  const patchCells = Math.min(EXTREME_SAMPLE_LIMIT, Math.max(1, Math.ceil((2 * config.minimumFeatureMm) ** 2 / cellAreaMm2)));
  const landLow = extremeTracker(patchCells, true), landHigh = extremeTracker(patchCells, false);
  const visibleLow = extremeTracker(patchCells, true), waterLow = extremeTracker(patchCells, true);
  let landMin = Number.POSITIVE_INFINITY;
  let landMax = Number.NEGATIVE_INFINITY;
  let waterCells = 0;
  let waterMin = Infinity;
  let visibleMin = Number.POSITIVE_INFINITY;
  let visibleMax = Number.NEGATIVE_INFINITY;
  const radius = cropRadiusMm(config);
  for (let index = 0; index < grid.values.length; index += 1) {
    const x = sampleOffset(index % grid.width, grid.width, config.widthMm);
    const y = sampleOffset(Math.floor(index / grid.width), grid.height, config.heightMm);
    if (config.cropShape === "circle" && x * x + y * y > radius * radius) continue;
    const value = grid.values[index]!;
    visibleMin = Math.min(visibleMin, value);
    visibleMax = Math.max(visibleMax, value);
    visibleLow.add(value);
    if (waterMask[index]) { waterCells += 1; waterMin = Math.min(waterMin, value); waterLow.add(value); continue; }
    if (value < landMin) landMin = value;
    if (value > landMax) landMax = value;
    landLow.add(value);
    landHigh.add(value);
  }
  // Include interpolated crop-edge elevations. The surrounding raster remains
  // intact for contour interpolation, but excluded corner extrema do not set
  // the ladder range. This also handles coarse grids with no interior nodes.
  const cells = { landMin, landMax, visibleMin, waterMin };
  const edge = { landMin: Infinity, landMax: -Infinity, visibleMin: Infinity, waterMin: Infinity };
  if (config.cropShape === "circle") {
    const boundary = cropBoundary(config);
    const spacing = Math.min(config.widthMm / (grid.width - 1), config.heightMm / (grid.height - 1));
    for (let segment = 0; segment < boundary.length - 1; segment += 1) {
      const start = boundary[segment]!; const end = boundary[segment + 1]!;
      const steps = Math.max(2, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / spacing * 2));
      for (let step = 0; step <= steps; step += 1) {
        const point = pointAt(start, end, step / steps);
        const x = clamp(sampleIndexAt(point.x, grid.width, config.widthMm), 0, grid.width - 1);
        const y = clamp(sampleIndexAt(point.y, grid.height, config.heightMm), 0, grid.height - 1);
        const left = Math.floor(x); const top = Math.floor(y);
        const right = Math.min(left + 1, grid.width - 1); const bottom = Math.min(top + 1, grid.height - 1);
        const values = grid.values;
        const upper = values[top * grid.width + left]! * (1 - x + left) + values[top * grid.width + right]! * (x - left);
        const lower = values[bottom * grid.width + left]! * (1 - x + left) + values[bottom * grid.width + right]! * (x - left);
        const value = upper * (1 - y + top) + lower * (y - top);
        visibleMin = Math.min(visibleMin, value); visibleMax = Math.max(visibleMax, value);
        edge.visibleMin = Math.min(edge.visibleMin, value);
        if (waterMask[Math.round(y) * grid.width + Math.round(x)]) { waterMin = Math.min(waterMin, value); edge.waterMin = Math.min(edge.waterMin, value); continue; }
        landMin = Math.min(landMin, value); landMax = Math.max(landMax, value);
        edge.landMin = Math.min(edge.landMin, value); edge.landMax = Math.max(edge.landMax, value);
      }
    }
  }
  // Preserve declared precision for uncropped, water-free rectangular grids.
  if (config.cropShape === "rectangle" && waterCells === 0) {
    landMin = grid.min;
    landMax = grid.max;
  } else if (!Number.isFinite(landMin) || !Number.isFinite(landMax)) {
    landMin = Number.isFinite(visibleMin) ? visibleMin : grid.min;
    landMax = Number.isFinite(visibleMax) ? visibleMax : grid.max;
  }
  // Only grid cells are judged: an interpolated crop-edge sample is a slope
  // running out of the crop, not a patch, so it still extends the range.
  const high = landHigh.edge, low = landLow.edge;
  if (high !== undefined && low !== undefined && high > low) {
    const allowance = UNCUTTABLE_EXTREME_SHARE * (high - low);
    if (cells.landMax - high > allowance) landMax = Math.max(high, edge.landMax);
    if (low - cells.landMin > allowance) landMin = Math.min(low, edge.landMin);
    const floor = visibleLow.edge;
    if (floor !== undefined) {
      const depthAllowance = UNCUTTABLE_EXTREME_SHARE * (high - Math.min(low, floor));
      if (floor - cells.visibleMin > depthAllowance) visibleMin = Math.min(floor, edge.visibleMin);
      const waterFloor = waterLow.edge;
      if (waterFloor !== undefined && waterFloor - cells.waterMin > depthAllowance) waterMin = Math.min(waterFloor, edge.waterMin);
    }
  }
  // The lowest elevation held by a patch large enough to cut; a smaller hole
  // would be culled, so the ladder need not reach below it.
  const cuttableMin = Math.max(visibleMin, Math.min(visibleLow.edge ?? visibleMin, edge.visibleMin));
  const cuttableWaterMin = Math.max(waterMin, Math.min(waterLow.edge ?? Infinity, edge.waterMin));
  return { landMin, landMax, waterMin, min: visibleMin, max: visibleMax, cuttableMin, cuttableWaterMin };
}
