import { cropRadiusMm } from "../primitives/crop.js";
import { clamp } from "../primitives/geometry2d.js";
import type { NorthArrowAnchor, NorthArrowPlacementV1, Point2D, ProjectConfigV1 } from "../types.js";

/** Clearance between an anchored annotation and the crop edge. */
const ANNOTATION_CLEARANCE_MM = 3;

export const ANCHOR_VECTORS: Record<NorthArrowAnchor, Point2D> = {
  "top-left": { x: -1, y: -1 }, top: { x: 0, y: -1 }, "top-right": { x: 1, y: -1 },
  left: { x: -1, y: 0 }, center: { x: 0, y: 0 }, right: { x: 1, y: 0 },
  "bottom-left": { x: -1, y: 1 }, bottom: { x: 0, y: 1 }, "bottom-right": { x: 1, y: 1 },
};

/**
 * Center, relative to the artwork center, of an annotation anchored inside the
 * crop. A rectangle keeps `halfWidth`/`halfHeight` plus the clearance inside
 * each edge; a circle keeps `radialHalfExtent` inside the radius.
 */
export function anchoredCenter(
  config: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "cropShape">,
  placement: NorthArrowPlacementV1,
  halfWidth: number,
  halfHeight: number,
  radialHalfExtent = Math.max(halfWidth, halfHeight),
): Point2D {
  const vector = ANCHOR_VECTORS[placement.anchor];
  const offset = placement.offset;
  if (config.cropShape === "rectangle") {
    const availableX = Math.max(0, config.widthMm / 2 - halfWidth - ANNOTATION_CLEARANCE_MM);
    const availableY = Math.max(0, config.heightMm / 2 - halfHeight - ANNOTATION_CLEARANCE_MM);
    return {
      x: clamp((vector.x + offset.x) * availableX, -availableX, availableX),
      y: clamp((vector.y + offset.y) * availableY, -availableY, availableY),
    };
  }
  const availableRadius = Math.max(0, cropRadiusMm(config) - radialHalfExtent - ANNOTATION_CLEARANCE_MM);
  const anchorLength = Math.hypot(vector.x, vector.y);
  const anchor = anchorLength > 1 ? { x: vector.x / anchorLength, y: vector.y / anchorLength } : vector;
  const desired = { x: (anchor.x + offset.x) * availableRadius, y: (anchor.y + offset.y) * availableRadius };
  const length = Math.hypot(desired.x, desired.y);
  if (length <= availableRadius || length === 0) return desired;
  return { x: desired.x * availableRadius / length, y: desired.y * availableRadius / length };
}

function nearestAnchor(x: number, y: number): NorthArrowAnchor {
  const step = (value: number) => (value > 0.5 ? 1 : value < -0.5 ? -1 : 0);
  const vector = { x: step(x), y: step(y) };
  return (Object.keys(ANCHOR_VECTORS) as NorthArrowAnchor[]).find((anchor) => ANCHOR_VECTORS[anchor].x === vector.x && ANCHOR_VECTORS[anchor].y === vector.y)!;
}

/**
 * The placement whose `anchoredCenter` is `center`, clamped into the travel.
 * The nearest anchor is chosen so offsets stay small and a title aligns
 * toward the edge it was dropped beside.
 */
export function placementAt(
  config: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "cropShape">,
  center: Point2D,
  halfWidth: number,
  halfHeight: number,
  radialHalfExtent = Math.max(halfWidth, halfHeight),
): NorthArrowPlacementV1 {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  if (config.cropShape === "rectangle") {
    const availableX = Math.max(0, config.widthMm / 2 - halfWidth - ANNOTATION_CLEARANCE_MM);
    const availableY = Math.max(0, config.heightMm / 2 - halfHeight - ANNOTATION_CLEARANCE_MM);
    const x = availableX > 0 ? clamp(center.x / availableX, -1, 1) : 0;
    const y = availableY > 0 ? clamp(center.y / availableY, -1, 1) : 0;
    const anchor = nearestAnchor(x, y);
    const vector = ANCHOR_VECTORS[anchor];
    return { anchor, offset: { x: round(x - vector.x), y: round(y - vector.y) } };
  }
  const availableRadius = Math.max(0, cropRadiusMm(config) - radialHalfExtent - ANNOTATION_CLEARANCE_MM);
  let x = availableRadius > 0 ? center.x / availableRadius : 0;
  let y = availableRadius > 0 ? center.y / availableRadius : 0;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  const anchor = nearestAnchor(x, y);
  const vector = ANCHOR_VECTORS[anchor];
  const anchorLength = Math.hypot(vector.x, vector.y);
  const normalized = anchorLength > 1 ? { x: vector.x / anchorLength, y: vector.y / anchorLength } : vector;
  return { anchor, offset: { x: round(clamp(x - normalized.x, -1, 1)), y: round(clamp(y - normalized.y, -1, 1)) } };
}
