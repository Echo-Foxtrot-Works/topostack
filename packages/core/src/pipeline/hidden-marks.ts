import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { placeLabel, type LabelLayerIndex } from "../annotate/label-placement.js";
import { labelGeometry, labelInkExtent, labelStrokeReachMm } from "../annotate/labels.js";
import { boundsOverlap, distanceToSegment, normalizeMultiPolygon, pointInPreparedPolygons, preparePolygons, ringBounds, signedArea, toMultiPolygon, type Bounds2D, type PreparedPolygons } from "../primitives/geometry2d.js";
import type { GeometryIRV1, LayerIR, OperationPath, Point2D, Polygon2D, ProjectConfigV1 } from "../types.js";
import { polygonCenter } from "./nesting.js";

/**
 * Hidden marks: assembly engravings that only work if the sheet above covers
 * them once glued - the alignment outline and id each sheet carries for the
 * sheet above, and each cut piece's own id. A hidden label sits inside the
 * glue area: its own piece under one piece of the sheet directly above.
 * Everything that places one goes through this module, and
 * `hiddenMarkIssues` checks the finished geometry against the same rule, so
 * a stray mark has one place to be debugged.
 */
const HIDDEN_MARK_PREFIXES = ["alignment-", "piece-"] as const;

/** Whether a marking is an assembly mark that must end up covered. Ids keep their prefix through dedupe and sheet clipping. */
function isHiddenMark(mark: Pick<OperationPath, "id">): boolean {
  return HIDDEN_MARK_PREFIXES.some((prefix) => mark.id.startsWith(prefix));
}

/**
 * Least gap between an alignment outline's engraved edge and the edge of the
 * sheet above. With kerf compensation off, a cut piece really is smaller by
 * half the laser's kerf, which is rarely under this.
 */
const ALIGNMENT_OUTLINE_MIN_CLEARANCE_MM = 0.1;

/**
 * How far inside the upper sheet's edge its alignment outline is engraved,
 * measured to the line's centre: half the line, so the whole stroke is
 * inside, plus one kerf (at least `ALIGNMENT_OUTLINE_MIN_CLEARANCE_MM`) of
 * slack. A line wider than the kerf, or a kerf of zero, then leaves no sliver
 * beside the sheet above.
 */
export function alignmentOutlineInsetMm(config: Pick<ProjectConfigV1, "laserKerfMm" | "lineStyle">): number {
  return Math.max(config.laserKerfMm, ALIGNMENT_OUTLINE_MIN_CLEARANCE_MM) + config.lineStyle.annotationMm / 2;
}

/**
 * Where `polygon` is glued to the sheet directly above: one region per piece
 * of that sheet, never merged, so a seam between two pieces above is an edge
 * a label stays clear of rather than a joint it could show through.
 */
function gluedParts(polygon: Polygon2D, above: PreparedPolygons): Polygon2D[] {
  const box = ringBounds(polygon.outer);
  return above.polygons.flatMap((piece, index) => boundsOverlap(box, above.outerBounds[index]!)
    ? normalizeMultiPolygon(polygonClipping.intersection(toMultiPolygon([polygon]), toMultiPolygon([piece])) as MultiPolygon)
    : []);
}

/**
 * Candidate label centres spanning a region at label-box spacing. The global
 * grid is 10% of the model, far coarser than one piece's covered area, and
 * the alignment guide usually already owns the region's centre.
 */
function regionCandidates(label: string, config: ProjectConfigV1, region: Polygon2D): Point2D[] {
  const ink = labelInkExtent(label, config.textStyle);
  const bounds = ringBounds(region.outer);
  const stepX = (ink.maxX - ink.minX + 1.6) / 2;
  const stepY = ink.maxY - ink.minY + 1.6;
  const candidates: Point2D[] = [];
  for (let y = bounds.minY + stepY / 2; y <= bounds.maxY - stepY / 2 && candidates.length < 400; y += stepY) {
    for (let x = bounds.minX + stepX / 2; x <= bounds.maxX - stepX / 2 && candidates.length < 400; x += stepX) {
      candidates.push({ x: x / (config.widthMm / 2), y: y / (config.heightMm / 2) });
    }
  }
  return candidates;
}

/**
 * Where to engrave `label` on this sheet so that it lies wholly inside one of
 * `regions` - the material something above will hide - or undefined when no
 * spot holds it. `placeLabel` requires the label's ink, the clearance and the
 * stroke included, inside both the sheet's material and one region, clear of
 * every marking already indexed.
 */
export function placeHiddenLabel(label: string, config: ProjectConfigV1, labelIndex: LabelLayerIndex, regions: Polygon2D[]): Point2D | undefined {
  // Aim at the middle of the largest region rather than the middle of the
  // piece: `placeLabel` tries the preferred point first and then falls back
  // to a grid spanning the whole model, whose spacing is far coarser than one
  // cut piece, so a poor first guess loses the label.
  const largest = regions.reduce<Polygon2D | undefined>((best, part) =>
    !best || Math.abs(signedArea(part.outer)) > Math.abs(signedArea(best.outer)) ? part : best, undefined);
  return largest ? placeLabel(label, config, labelIndex, polygonCenter(largest, config), regions, regionCandidates(label, config, largest)) : undefined;
}

/**
 * Where to engrave `label` on `polygon` so a piece of the sheet directly
 * above (`above`) is glued over it, or undefined when no glued spot holds it.
 * Only that sheet counts: anything higher covers this one only across an air
 * gap, such as a nest cavity, never glued down.
 */
export function gluedLabelPoint(label: string, config: ProjectConfigV1, labelIndex: LabelLayerIndex, polygon: Polygon2D, above: PreparedPolygons): Point2D | undefined {
  return placeHiddenLabel(label, config, labelIndex, gluedParts(polygon, above));
}

/** The engraving for a hidden label placed by `placeHiddenLabel`. */
export function hiddenLabelMarking(id: string, label: string, point: Point2D, config: ProjectConfigV1): OperationPath {
  return { id, operation: "engrave", kind: "guide", points: [point], label, textStyle: config.textStyle };
}

/** A hidden mark whose engraved line comes closer than allowed to the edge of what covers it. */
export interface HiddenMarkIssue {
  layerIndex: number;
  markingId: string;
  label?: string;
  /** Least distance from the engraved line's edge to the edge of the hidden area; negative where it shows. */
  clearanceMm: number;
}

/** Points along every line at most `step` apart, ends included. */
function samplePolylines(lines: Point2D[][], step: number): Point2D[] {
  const samples: Point2D[] = [];
  for (const line of lines) {
    if (line.length === 1) samples.push(line[0]!);
    for (let index = 0; index < line.length - 1; index += 1) {
      const start = line[index]!;
      const end = line[index + 1]!;
      const count = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / step));
      for (let sample = index === 0 ? 0 : 1; sample <= count; sample += 1) {
        samples.push({ x: start.x + (end.x - start.x) * sample / count, y: start.y + (end.y - start.y) * sample / count });
      }
    }
  }
  return samples;
}

function expandedBounds(points: Point2D[], margin: number): Bounds2D {
  const box = ringBounds(points);
  return { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin };
}

/**
 * Signed least distance from `samples` to the edge of `region`, less `reach`:
 * negative where a sample lies outside. Edges farther than `horizon` are
 * ignored, which also hides the edge of a window the region was clipped to.
 */
function clearanceWithin(samples: Point2D[], region: Polygon2D[], reach: number, horizon: number): number {
  const prepared = preparePolygons(region);
  const near = expandedBounds(samples, horizon);
  const edges: Array<[Point2D, Point2D]> = [];
  for (const ring of region.flatMap((polygon) => [polygon.outer, ...polygon.holes])) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index]!;
      const end = ring[index + 1]!;
      if (Math.max(start.x, end.x) < near.minX || Math.min(start.x, end.x) > near.maxX || Math.max(start.y, end.y) < near.minY || Math.min(start.y, end.y) > near.maxY) continue;
      edges.push([start, end]);
    }
  }
  let clearance = Number.POSITIVE_INFINITY;
  for (const point of samples) {
    let distance = horizon;
    for (const [start, end] of edges) distance = Math.min(distance, distanceToSegment(point, start, end));
    clearance = Math.min(clearance, (pointInPreparedPolygons(point, prepared) ? distance : -distance) - reach);
  }
  return clearance;
}

function intersect(...parts: Polygon2D[][]): Polygon2D[] {
  if (parts.some((part) => !part.length)) return [];
  const [first, ...rest] = parts.map((part) => toMultiPolygon(part));
  return normalizeMultiPolygon(polygonClipping.intersection(first!, ...rest) as MultiPolygon);
}

/**
 * Every hidden mark whose engraving reaches closer than `minimumClearanceMm`
 * to the edge of the glue area it must stay inside: its own sheet's material
 * under one piece of the sheet directly above for a label (as
 * `gluedLabelPoint` places them, so a seam above counts as an edge), and
 * under that sheet as a whole for an alignment outline, which crosses its
 * seams by design. Ink is checked as the export draws it: glyph strokes and
 * outlines widened by half the line, typeface letters as filled shapes. It
 * samples every 0.1 mm, so it is for tests and debugging, not generation.
 */
export function hiddenMarkIssues(ir: Pick<GeometryIRV1, "layers" | "lineStyle">, minimumClearanceMm = 0): HiddenMarkIssue[] {
  const issues: HiddenMarkIssue[] = [];
  const strokeMm = ir.lineStyle.annotationMm;
  ir.layers.forEach((layer, layerIndex) => {
    const marks = layer.markings.filter(isHiddenMark);
    const above = ir.layers[layerIndex + 1]?.polygons ?? [];
    for (const mark of marks) {
      const { lines, reach } = markInk(mark, strokeMm);
      if (!lines.length) continue;
      const samples = samplePolylines(lines, 0.1);
      const horizon = minimumClearanceMm + reach + 1;
      const window = expandedBounds(samples, horizon + 4);
      const near = (polygon: Polygon2D) => boundsOverlap(ringBounds(polygon.outer), window);
      const windowPolygon: Polygon2D = { outer: [{ x: window.minX, y: window.minY }, { x: window.maxX, y: window.minY }, { x: window.maxX, y: window.maxY }, { x: window.minX, y: window.maxY }, { x: window.minX, y: window.minY }], holes: [] };
      const own = intersect([windowPolygon], layer.polygons.filter(near));
      const pieces = above.filter(near);
      const clearance = mark.label
        ? Math.max(-horizon - reach, ...pieces.map((piece) => clearanceWithin(samples, intersect(own, [piece]), reach, horizon)))
        : clearanceWithin(samples, pieces.length ? intersect(own, normalizeMultiPolygon(polygonClipping.union(toMultiPolygon(pieces)) as MultiPolygon)) : [], reach, horizon);
      if (clearance < minimumClearanceMm - 1e-6) issues.push({ layerIndex, markingId: mark.id, ...(mark.label ? { label: mark.label } : {}), clearanceMm: clearance });
    }
  });
  return issues;
}

/** The lines a mark engraves and how far its ink reaches past them. */
function markInk(mark: LayerIR["markings"][number], strokeMm: number): { lines: Point2D[][]; reach: number } {
  if (mark.label && mark.points[0]) {
    const { strokes, fills } = labelGeometry(mark.label, mark.points[0], 0, 0, mark.labelRotationRad, mark.textStyle);
    return { lines: [...strokes, ...fills.flatMap((fill) => [fill.outer, ...fill.holes])], reach: labelStrokeReachMm(mark.textStyle, strokeMm) };
  }
  if (mark.filled) return { lines: [mark.points, ...(mark.holes ?? [])], reach: 0 };
  return { lines: mark.points.length > 1 ? [mark.points] : [], reach: strokeMm / 2 };
}
