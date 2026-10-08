import { aviationSymbolSize, type AviationAltitudeCandidate } from "./aviation.js";
import { fabricationLabel } from "./transportation.js";
import { pointInRing } from "../primitives/geometry2d.js";
import { labelInkExtent } from "../annotate/labels.js";
import type { Point2D, OperationPath, TextStyleV1 } from "../types.js";
import type { GenerationContext } from "./generation-context.js";
import type { LayerClip } from "./layer-clips.js";
import { annotationPlacer } from "./annotations.js";

const AVIATION_LABEL_LIMIT = 60;
/** Airspace altitude labels placed at most, one per area. */
const AVIATION_ALTITUDE_LIMIT = 40;
/** Space between an aviation symbol and its identifier. */
const AVIATION_LABEL_GAP_MM = 0.6;
/** Aviation text is capped near the symbol size so identifiers stay attached, but never below this height. */
const AVIATION_TEXT_MIN_MM = 1.6;
const AVIATION_TEXT_PER_SYMBOL = 0.7;

/**
 * Identifiers beside airport and navaid symbols, most important first, then
 * airspace altitudes inside their areas. An identifier tries the right, then
 * the left of its symbol; an altitude label takes the roomiest place in its
 * area where it fits inside the area. Either is skipped (quietly: a busy area
 * simply shows fewer) when it would leave the crop or overlap another aviation
 * label or symbol.
 */
export function placeAviationLabels(context: GenerationContext, clips: LayerClip[]): void {
  const { config, clip, aviation } = context;
  if (!aviation.labels.length && !aviation.altitudes.length) return;
  const placer = annotationPlacer(context, clips);
  const textStyle = { ...config.textStyle, sizeMm: Math.min(config.textStyle.sizeMm, Math.max(AVIATION_TEXT_MIN_MM, aviationSymbolSize(config.lineStyle) * AVIATION_TEXT_PER_SYMBOL)) };
  type Box = { left: number; top: number; right: number; bottom: number };
  // Every drawn symbol, labelled or not (private fields, obstacles), and each label once placed.
  const occupied: Box[] = [...aviation.symbols];
  const overlaps = (box: Box) => occupied.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
  const inset = config.lineStyle.annotationMm / 2;
  const inside = (box: Box) => [[box.left - inset, box.top - inset], [box.right + inset, box.top - inset], [box.right + inset, box.bottom + inset], [box.left - inset, box.bottom + inset]].every(([x, y]) => pointInRing({ x: x!, y: y! }, clip));
  let placed = 0;
  for (const candidate of aviation.labels) {
    if (placed >= AVIATION_LABEL_LIMIT) break;
    const label = fabricationLabel(candidate.label, textStyle.font);
    if (!label) continue;
    // Boxes hold the ink, which can reach past the advance box; the origin is placed from it.
    const ink = labelInkExtent(label, textStyle);
    const width = ink.maxX - ink.minX;
    const height = ink.maxY - ink.minY;
    const offset = candidate.clearanceMm + AVIATION_LABEL_GAP_MM;
    const top = candidate.anchor.y - height / 2;
    const box = [candidate.anchor.x + offset, candidate.anchor.x - offset - width]
      .map((left): Box => ({ left, top, right: left + width, bottom: top + height }))
      .find((option) => inside(option) && !overlaps(option));
    if (!box) continue;
    occupied.push(box);
    placer.push([{ id: `aviation-label-${placed++}`, operation: "engrave", kind: "label", aviationClass: candidate.aviationClass, points: [{ x: box.left - ink.minX, y: box.top - ink.minY }], label, textStyle }], true);
  }
  const printed = new Set<string>();
  for (const candidate of aviation.altitudes) {
    if (printed.size >= AVIATION_ALTITUDE_LIMIT) break;
    if (printed.has(candidate.area)) continue;
    const layout = altitudeLabel(candidate, textStyle, `aviation-label-${placed}`);
    if (!layout) continue;
    const { box } = layout;
    // Inside the area: the label's corners lie no farther from the anchor than the area's nearest edge.
    const reach = Math.hypot(Math.max(candidate.anchor.x - box.left, box.right - candidate.anchor.x), Math.max(candidate.anchor.y - box.top, box.bottom - candidate.anchor.y));
    if (reach > candidate.clearanceMm || !inside(box) || overlaps(box)) continue;
    occupied.push(box);
    printed.add(candidate.area);
    placed += 1;
    placer.push(layout.markings, true);
  }
}

/**
 * An airspace altitude label centred on its anchor, as the sectional prints it:
 * Class B and C ceiling over floor with a bar between, Class D its ceiling in a
 * dashed box. Undefined when the font cannot print the text.
 */
function altitudeLabel(candidate: AviationAltitudeCandidate, textStyle: TextStyleV1, id: string): { box: { left: number; top: number; right: number; bottom: number }; markings: OperationPath[] } | undefined {
  const { anchor: { x, y }, aviationClass } = candidate;
  // Laid out by ink, so a glyph past its advance box stays inside the reserved box.
  const text = (value: string) => {
    const label = fabricationLabel(value, textStyle.font);
    if (!label) return undefined;
    const ink = labelInkExtent(label, textStyle);
    return { label, ink, width: ink.maxX - ink.minX, height: ink.maxY - ink.minY };
  };
  const ceiling = text(candidate.ceiling);
  if (!ceiling) return undefined;
  const line = (points: Point2D[], suffix: string): OperationPath => ({ id: `${id}-${suffix}`, operation: "engrave", kind: "label", aviationClass, points });
  const word = (value: { label: string; width: number; ink: { minX: number; minY: number } }, top: number, suffix: string): OperationPath =>
    ({ id: `${id}-${suffix}`, operation: "engrave", kind: "label", aviationClass, points: [{ x: x - value.width / 2 - value.ink.minX, y: top - value.ink.minY }], label: value.label, textStyle });
  if (candidate.floor === undefined) {
    const margin = ceiling.height * 0.4;
    const [left, right, top, bottom] = [x - ceiling.width / 2 - margin, x + ceiling.width / 2 + margin, y - ceiling.height / 2 - margin, y + ceiling.height / 2 + margin];
    const dash = Math.max(ceiling.height * 0.3, 0.5);
    const dashes = dashedRing([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }], dash, dash * 0.7);
    return { box: { left, top, right, bottom }, markings: [word(ceiling, y - ceiling.height / 2, "ceiling"), ...dashes.map((points, index) => line(points, `box-${index}`))] };
  }
  const floor = text(candidate.floor);
  if (!floor) return undefined;
  const gap = Math.max(ceiling.height * 0.35, 0.4);
  const half = Math.max(ceiling.width, floor.width) / 2 + ceiling.height * 0.15;
  return {
    box: { left: x - half, top: y - gap / 2 - ceiling.height, right: x + half, bottom: y + gap / 2 + floor.height },
    markings: [word(ceiling, y - gap / 2 - ceiling.height, "ceiling"), line([{ x: x - half, y }, { x: x + half, y }], "bar"), word(floor, y + gap / 2, "floor")],
  };
}

/** A closed outline as dashes `dash` long with `gap` between, each its own open path, starting with a dash at the first corner. */
function dashedRing(ring: Point2D[], dash: number, gap: number): Point2D[][] {
  const lengths = ring.slice(1).map((point, index) => Math.hypot(point.x - ring[index]!.x, point.y - ring[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  // The point `distance` along the outline, and every corner passed between two distances.
  const pointAt = (distance: number): Point2D => {
    let rest = distance;
    for (let index = 0; index < lengths.length; index += 1) {
      const length = lengths[index]!;
      if (rest <= length || index === lengths.length - 1) {
        const [a, b] = [ring[index]!, ring[index + 1]!];
        const t = length > 0 ? Math.min(1, rest / length) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      rest -= length;
    }
    return ring[0]!;
  };
  const corners = (from: number, to: number) => {
    const inside: Point2D[] = [];
    let at = 0;
    lengths.forEach((length, index) => { at += length; if (at > from && at < to) inside.push(ring[index + 1]!); });
    return inside;
  };
  const dashes: Point2D[][] = [];
  for (let index = 0; index * (dash + gap) < total; index += 1) {
    const from = index * (dash + gap);
    const to = Math.min(total, from + dash);
    dashes.push([pointAt(from), ...corners(from, to), pointAt(to)]);
  }
  return dashes;
}
