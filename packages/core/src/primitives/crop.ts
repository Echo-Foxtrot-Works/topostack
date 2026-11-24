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


export function cropElevationRange(config: ProjectConfigV1, grid: ElevationGrid, waterMask: Uint8Array) {
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
    if (waterMask[index]) { waterCells += 1; waterMin = Math.min(waterMin, value); continue; }
    if (value < landMin) landMin = value;
    if (value > landMax) landMax = value;
  }
  // Include interpolated crop-edge elevations. The surrounding raster remains
  // intact for contour interpolation, but excluded corner extrema do not set
  // the ladder range. This also handles coarse grids with no interior nodes.
  if (config.cropShape === "circle") {
    const edge = cropBoundary(config);
    const spacing = Math.min(config.widthMm / (grid.width - 1), config.heightMm / (grid.height - 1));
    for (let segment = 0; segment < edge.length - 1; segment += 1) {
      const start = edge[segment]!; const end = edge[segment + 1]!;
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
        if (waterMask[Math.round(y) * grid.width + Math.round(x)]) { waterMin = Math.min(waterMin, value); continue; }
        landMin = Math.min(landMin, value); landMax = Math.max(landMax, value);
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
  return { landMin, landMax, waterMin, min: visibleMin, max: visibleMax };
}
