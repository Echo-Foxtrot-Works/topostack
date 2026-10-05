import { anchoredCenter, placementAt } from "./anchor.js";
import { labelDimensions } from "./labels.js";
import { cropRadiusMm } from "../primitives/crop.js";
import { scaleMarking } from "../primitives/units.js";
import type { NorthArrowPlacementV1, OperationPath, Point2D, ProjectConfigV1 } from "../types.js";

/** Half height of the end ticks, and the gap from the bar down to its label. */
const TICK_HALF_MM = 1.7;
const LABEL_DROP_MM = 5;

interface ScaleBarLayout { x: number; y: number; length: number; label: string; width: number; height: number }

/** Bar length and its label, and the size of the block they make together. */
function measure(config: ProjectConfigV1, groundWidthM: number): Omit<ScaleBarLayout, "x" | "y"> {
  const radius = cropRadiusMm(config);
  // Pick the labeled distance from whatever fits the drawn cap, so the bar
  // length and its engraved label always agree.
  const maxLengthMm = config.cropShape === "circle" ? radius * 0.55 : config.widthMm * 0.35;
  const maxDistanceM = groundWidthM > 0 ? (maxLengthMm / config.widthMm) * groundWidthM : 0;
  const scale = scaleMarking(Math.min(groundWidthM * 0.2, maxDistanceM), config.units);
  const length = groundWidthM > 0 ? (scale.distanceM / groundWidthM) * config.widthMm : 0;
  const text = labelDimensions(scale.label, config.textStyle);
  return { length, label: scale.label, width: Math.max(length, text.width), height: TICK_HALF_MM + LABEL_DROP_MM + text.height };
}

/**
 * Where the bar starts (`x`, `y` is its left end). Without a saved placement
 * it keeps its original spot near the top-left edge (lower left on a circle),
 * so older projects generate unchanged.
 */
function layout(config: ProjectConfigV1, groundWidthM: number): ScaleBarLayout {
  const size = measure(config, groundWidthM);
  if (!config.scaleBarPlacement) {
    const radius = cropRadiusMm(config);
    return {
      ...size,
      x: config.cropShape === "circle" ? -radius * 0.58 : -config.widthMm / 2 + 9,
      y: config.cropShape === "circle" ? radius * 0.58 : -config.heightMm / 2 + 10,
    };
  }
  const center = anchoredCenter(config, config.scaleBarPlacement, size.width / 2, size.height / 2, Math.hypot(size.width, size.height) / 2);
  return { ...size, x: center.x - size.width / 2, y: center.y - size.height / 2 + TICK_HALF_MM };
}

/** The bar, its end ticks and its distance label. `groundWidthM` is the mapped width on the ground. */
export function scaleBarMarkings(config: ProjectConfigV1, groundWidthM: number): OperationPath[] {
  const { x, y, length, label } = layout(config, groundWidthM);
  return [
    { id: "scale-main", operation: "engrave", kind: "guide", points: [{ x, y }, { x: x + length, y }] },
    { id: "scale-left", operation: "engrave", kind: "guide", points: [{ x, y: y - TICK_HALF_MM }, { x, y: y + TICK_HALF_MM }] },
    { id: "scale-right", operation: "engrave", kind: "guide", points: [{ x: x + length, y: y - TICK_HALF_MM }, { x: x + length, y: y + TICK_HALF_MM }] },
    { id: "scale-label", operation: "engrave", kind: "label", points: [{ x, y: y + LABEL_DROP_MM }], label, textStyle: config.textStyle },
  ];
}

/** Center of the bar and label block, relative to the artwork center. */
export function scaleBarCenter(config: ProjectConfigV1, groundWidthM: number): Point2D {
  const { x, y, width, height } = layout(config, groundWidthM);
  return { x: x + width / 2, y: y - TICK_HALF_MM + height / 2 };
}

/** The bar and label block as a closed ring. */
export function scaleBarFootprint(config: ProjectConfigV1, groundWidthM: number): Point2D[] {
  const { x, y, width, height } = layout(config, groundWidthM);
  const top = y - TICK_HALF_MM;
  return [{ x, y: top }, { x: x + width, y: top }, { x: x + width, y: top + height }, { x, y: top + height }, { x, y: top }];
}

/** The placement that puts the block's center at `center`, kept inside the crop. */
export function scaleBarPlacementAt(config: ProjectConfigV1, groundWidthM: number, center: Point2D): NorthArrowPlacementV1 {
  const { width, height } = measure(config, groundWidthM);
  return placementAt(config, center, width / 2, height / 2, Math.hypot(width, height) / 2);
}
