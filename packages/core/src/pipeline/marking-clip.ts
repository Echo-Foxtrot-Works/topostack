import { clipPolygons } from "../primitives/offset.js";
import { labelGeometry } from "../annotate/labels.js";
import { labelFootprint } from "../annotate/label-placement.js";
import { type Bounds2D, boundsOverlap, clipPolyline, pointInPreparedPolygons, preparePolygons, ringBounds, somePreparedEdge, type PreparedPolygons } from "../primitives/geometry2d.js";
import { DEFAULT_TEXT_STYLE, type LayerIR, type OperationPath, type Point2D, type Polygon2D } from "../types.js";

/** Which share of the markings to keep: the part over `polygons`, or the part clear of them. */
export type MarkingSide = "inside" | "outside";

export interface MarkingClipOptions {
  /**
   * Keep a copy of a backing wherever it can erase earlier markings,
   * including on both sides of the wood/acrylic split.
   */
  keepKnockouts?: boolean;
}

/**
 * The share of `markings` that lies inside (or outside) `polygons`.
 *
 * A label clear of the boundary stays whole. Near the boundary its glyphs
 * are clipped to give each side its share. Closed marker artwork and typeface
 * letters are intersected as polygons so a fill stays a closed region rather
 * than an open arc.
 */
export function markingsWithin(markings: OperationPath[], polygons: Polygon2D[], side: MarkingSide, options: MarkingClipOptions = {}): OperationPath[] {
  if (!polygons.length) return side === "inside" ? [] : markings;
  return markings.flatMap(markingClipper(polygons, side, options));
}

function markingClipper(polygons: Polygon2D[], side: MarkingSide, options: MarkingClipOptions = {}) {
  const prepared = preparePolygons(polygons);
  const inside = side === "inside";
  const keeps = (point: Point2D) => pointInPreparedPolygons(point, prepared) === inside;
  const parted = (mark: OperationPath, parts: Point2D[][], whole: boolean): OperationPath[] => {
    if (whole && parts.length === 1) return [{ ...mark, points: parts[0]! }];
    return parts.map((points, index) => ({ ...mark, id: `${mark.id}-part-${index + 1}`, points }));
  };
  const clippedFill = (mark: OperationPath): OperationPath[] => {
    const subject = { outer: mark.points, holes: mark.holes ?? [] };
    const bounds = ringBounds(mark.points);
    const nearby = polygons.filter((_, index) => boundsOverlap(bounds, prepared.outerBounds[index]!));
    const clipped = clipPolygons([subject], nearby, inside ? "intersection" : "difference");
    if (clipped.length === 1) return [{ ...mark, points: clipped[0]!.outer, holes: clipped[0]!.holes }];
    return clipped.map((polygon, index) => ({ ...mark, id: `${mark.id}-part-${index + 1}`, points: polygon.outer, holes: polygon.holes }));
  };
  // A mark whose box reaches no polygon's box lies wholly on one side; only
  // the few near an edge pay for label glyphs and clipping.
  const reaches = (box: Bounds2D) => boundsOverlap(box, prepared.bounds) && prepared.outerBounds.some((bounds) => boundsOverlap(bounds, box));
  return (mark: OperationPath): OperationPath[] => {
    const first = mark.points[0];
    if (!first) return [];
    if (mark.knockout) return options.keepKnockouts && (!inside || boundsOverlap(ringBounds(mark.points), prepared.bounds)) ? [mark] : [];
    const bounds = markBounds(mark);
    if (!reaches(bounds)) return inside ? [] : [mark];
    // A box with no boundary in it lies entirely on one side. Testing the
    // vertices alone misses an enclosed opening or an edge crossing a glyph.
    if ((mark.filled || mark.label) && !somePreparedEdge(prepared, bounds, (a, b) =>
      Math.min(a.x, b.x) <= bounds.maxX && Math.max(a.x, b.x) >= bounds.minX &&
      Math.min(a.y, b.y) <= bounds.maxY && Math.max(a.y, b.y) >= bounds.minY)) return keeps(first) ? [mark] : [];
    let frame: PreparedPolygons | undefined;
    const clipLine = (points: Point2D[]) => inside ? clipPolyline(points, prepared) : clipPolyline(points, frame ??= surroundingFrame(bounds), prepared);
    if (mark.label) {
      const { strokes, fills } = labelGeometry(mark.label, first, 0, 0, mark.labelRotationRad, mark.textStyle);
      const { label: _label, labelRotationRad: _rotation, textStyle: _style, ...plain } = mark;
      return [
        ...parted(plain, strokes.flatMap(clipLine), false),
        ...fills.flatMap((fill, index) => clippedFill({ ...plain, id: `${mark.id}-fill-${index + 1}`, points: fill.outer, holes: fill.holes, filled: true })),
      ];
    }
    if (mark.points.length < 2) return keeps(first) ? [mark] : [];
    if (mark.filled) return clippedFill(mark);
    return parted(mark, clipLine(mark.points), true);
  };
}

/** Flatten contour labels onto the engraving plate beneath the title, graphics and marker backings. */
export function flatArtworkMarkings(layers: LayerIR[]): OperationPath[] {
  const base = layers[0]?.markings ?? [];
  const labels = layers.slice(1).flatMap((layer) => layer.markings);
  const firstBacking = base.findIndex((mark) => mark.knockout);
  const index = firstBacking < 0 ? base.length : firstBacking;
  return [...base.slice(0, index), ...labels, ...base.slice(index)]
    .filter((mark) => !mark.id.startsWith("alignment-") && !mark.id.startsWith("piece-"));
}

/** Geometry erased by each backing is determined in drawing order, before grouping by machine operation. */
export function markingClearances(markings: OperationPath[]): Map<OperationPath, OperationPath[]> {
  const visible = new Map<OperationPath, OperationPath[]>();
  const halos: Polygon2D[] = [];
  let clip: ReturnType<typeof markingClipper> | undefined;
  for (let index = markings.length - 1; index >= 0; index--) {
    const mark = markings[index]!;
    if (mark.knockout) {
      halos.push({ outer: mark.points, holes: mark.holes ?? [] });
      visible.set(mark, []);
      clip = undefined;
    } else if (halos.length) {
      clip ??= markingClipper(halos, "outside");
      const parts = clip(mark);
      if (parts.length !== 1 || parts[0] !== mark) visible.set(mark, parts);
    }
  }
  return visible;
}

/** Visible marks for renderers that draw each clipped stroke or filled polygon individually. */
export function visibleMarkings(markings: OperationPath[]): OperationPath[] {
  const cleared = markingClearances(markings);
  return cleared.size ? markings.flatMap((mark) => cleared.get(mark) ?? [mark]) : markings;
}

/** Covers half of the widest line a project allows (1.5 mm), so the box never needs the line style. */
const LABEL_STROKE_SLACK_MM = 1;

/** A box around everything a mark engraves, a label's turned text and its stroke included. */
function markBounds(mark: OperationPath): Bounds2D {
  const box = ringBounds(mark.points);
  if (!mark.label || !mark.points[0]) return box;
  const label = ringBounds(labelFootprint(mark.label, mark.points[0], mark.labelRotationRad ?? 0, mark.textStyle ?? DEFAULT_TEXT_STYLE, LABEL_STROKE_SLACK_MM));
  return { minX: Math.min(box.minX, label.minX), minY: Math.min(box.minY, label.minY), maxX: Math.max(box.maxX, label.maxX), maxY: Math.max(box.maxY, label.maxY) };
}


/** Material containing the entire mark, for clipping to the exterior of the excluded regions. */
function surroundingFrame(bounds: Bounds2D): PreparedPolygons {
  const minX = bounds.minX - 1, minY = bounds.minY - 1;
  const maxX = bounds.maxX + 1, maxY = bounds.maxY + 1;
  return preparePolygons([{ outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] }]);
}
