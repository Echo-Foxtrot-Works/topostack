import { fabricationLabel } from "./transportation.js";
import { pointInRing } from "../primitives/geometry2d.js";
import { labelInkExtent } from "../annotate/labels.js";
import type { GenerationContext } from "./generation-context.js";
import type { LayerClip } from "./layer-clips.js";
import { annotationPlacer } from "./annotations.js";

/** Unit names printed at most per model. */
const LAND_LABEL_LIMIT = 12;

/**
 * The names of the largest public land units, centred on the roomiest point
 * of each. A name is skipped (quietly: a crowded map simply shows fewer) when
 * it would reach past its unit's nearest edge, leave the crop, or overlap
 * another name.
 */
export function placeLandLabels(context: GenerationContext, clips: LayerClip[]): void {
  const { config, clip, lands } = context;
  if (!lands.labels.length) return;
  const placer = annotationPlacer(context, clips);
  const textStyle = config.textStyle;
  type Box = { left: number; top: number; right: number; bottom: number };
  const occupied: Box[] = [];
  const overlaps = (box: Box) => occupied.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
  const inset = config.lineStyle.annotationMm / 2;
  const inside = (box: Box) => [[box.left - inset, box.top - inset], [box.right + inset, box.top - inset], [box.right + inset, box.bottom + inset], [box.left - inset, box.bottom + inset]].every(([x, y]) => pointInRing({ x: x!, y: y! }, clip));
  let placed = 0;
  for (const candidate of lands.labels) {
    if (placed >= LAND_LABEL_LIMIT) break;
    const label = fabricationLabel(candidate.label, textStyle.font);
    if (!label) continue;
    // Laid out by ink, so a glyph past its advance box stays inside the reserved box.
    const ink = labelInkExtent(label, textStyle);
    const width = ink.maxX - ink.minX;
    const height = ink.maxY - ink.minY;
    const box = { left: candidate.anchor.x - width / 2, top: candidate.anchor.y - height / 2, right: candidate.anchor.x + width / 2, bottom: candidate.anchor.y + height / 2 };
    // Inside the unit: the label's corners lie no farther from the anchor than the unit's nearest edge.
    if (Math.hypot(width / 2, height / 2) > candidate.clearanceMm || !inside(box) || overlaps(box)) continue;
    occupied.push(box);
    placer.push([{ id: `land-label-${placed++}`, operation: "engrave", kind: "label", landClass: candidate.landClass, points: [{ x: box.left - ink.minX, y: box.top - ink.minY }], label, textStyle }], true);
  }
}
