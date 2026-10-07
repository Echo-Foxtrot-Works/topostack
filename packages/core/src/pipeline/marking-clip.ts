import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { labelDimensions, labelGeometry } from "../annotate/labels.js";
import { type Bounds2D, boundsOverlap, clipPolyline, normalizeMultiPolygon, pointInPreparedPolygons, preparePolygons, ringBounds, toMultiPolygon, toRing, type PreparedPolygons } from "../primitives/geometry2d.js";
import type { OperationPath, Point2D, Polygon2D } from "../types.js";

/** Which share of the markings to keep: the part over `polygons`, or the part clear of them. */
export type MarkingSide = "inside" | "outside";

export interface MarkingClipOptions {
  /**
   * Keep marker halos whole instead of dropping them. A halo never serializes;
   * `markerClearance` reads it against the whole layer, so a split that keeps
   * clipping by it (the acrylic and its wood) needs a copy on both sides.
   */
  keepKnockouts?: boolean;
}

/**
 * The share of `markings` that lies inside (or outside) `polygons`.
 *
 * A label whose every stroke lies on the kept side ships whole; one the edge
 * cuts through is exploded into its strokes and each stroke clipped, so both
 * sides carry their share of the glyph. Closed marker artwork and typeface
 * letters are intersected as polygons so a fill stays a closed region rather
 * than an open arc.
 */
export function markingsWithin(markings: OperationPath[], polygons: Polygon2D[], side: MarkingSide, options: MarkingClipOptions = {}): OperationPath[] {
  const prepared = preparePolygons(polygons);
  const inside = side === "inside";
  if (!prepared.polygons.length) return inside ? [] : markings;
  // Outside is everything but the polygons: a frame around every marking with the polygons excluded.
  const frame = inside ? undefined : everywhere(markings);
  const keeps = (point: Point2D) => pointInPreparedPolygons(point, prepared) === inside;
  const clipLine = (points: Point2D[]) => inside ? clipPolyline(points, prepared) : clipPolyline(points, frame!, prepared);
  const parted = (mark: OperationPath, parts: Point2D[][], whole: boolean): OperationPath[] => {
    if (whole && parts.length === 1) return [{ ...mark, points: parts[0]! }];
    return parts.map((points, index) => ({ ...mark, id: `${mark.id}-part-${index + 1}`, points }));
  };
  const clippedFill = (mark: OperationPath): OperationPath[] => {
    const first = mark.points[0]!;
    if (mark.points.every(keeps) && (mark.holes ?? []).every((hole) => hole.every(keeps))) return [mark];
    try {
      const subject = [[toRing(mark.points), ...(mark.holes ?? []).map(toRing)]] as MultiPolygon;
      const clipped = normalizeMultiPolygon((inside
        ? polygonClipping.intersection(subject, toMultiPolygon(polygons))
        : polygonClipping.difference(subject, toMultiPolygon(polygons))) as MultiPolygon);
      if (clipped.length === 1) return [{ ...mark, points: clipped[0]!.outer, holes: clipped[0]!.holes }];
      return clipped.map((polygon, index) => ({ ...mark, id: `${mark.id}-part-${index + 1}`, points: polygon.outer, holes: polygon.holes }));
    } catch {
      // A degenerate ring the clipper refuses is not worth losing the sheet over.
      return keeps(first) ? [mark] : [];
    }
  };
  // A mark whose box reaches no polygon's box lies wholly on one side; only
  // the few near an edge pay for label glyphs and clipping.
  const reaches = (box: Bounds2D) => boundsOverlap(box, prepared.bounds) && prepared.outerBounds.some((bounds) => boundsOverlap(bounds, box));
  return markings.flatMap((mark) => {
    const first = mark.points[0];
    if (!first) return [];
    if (mark.knockout) return options.keepKnockouts && (!inside || boundsOverlap(ringBounds(mark.points), prepared.bounds)) ? [mark] : [];
    if (!reaches(markBounds(mark))) return inside ? [] : [mark];
    if (mark.label) {
      const { strokes, fills } = labelGeometry(mark.label, first, 0, 0, mark.labelRotationRad, mark.textStyle);
      if ([...strokes, ...fills.flatMap((fill) => [fill.outer, ...fill.holes])].every((line) => line.every(keeps))) return [mark];
      const { label: _label, labelRotationRad: _rotation, textStyle: _style, ...plain } = mark;
      return [
        ...parted(plain, strokes.flatMap(clipLine), false),
        ...fills.flatMap((fill, index) => clippedFill({ ...plain, id: `${mark.id}-fill-${index + 1}`, points: fill.outer, holes: fill.holes, filled: true })),
      ];
    }
    if (mark.points.length < 2) return keeps(first) ? [mark] : [];
    if (mark.filled) return clippedFill(mark);
    return parted(mark, clipLine(mark.points), true);
  });
}

/** A box around everything a mark engraves; a label's text may turn any way about its anchor. */
function markBounds(mark: OperationPath): Bounds2D {
  const box = ringBounds(mark.points);
  if (!mark.label) return box;
  const { width, height } = labelDimensions(mark.label, mark.textStyle);
  // Generous: glyphs may overhang their advance box a little.
  const reach = Math.hypot(width, height) * 1.25 + 1;
  return { minX: box.minX - reach, minY: box.minY - reach, maxX: box.maxX + reach, maxY: box.maxY + reach };
}

/** One rectangle comfortably around every marking, label boxes included. */
function everywhere(markings: OperationPath[]): PreparedPolygons {
  const points = markings.flatMap((mark) => mark.points);
  const bounds = points.length ? ringBounds(points) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  // Labels reach past their anchor; any margin larger than a label box will do.
  const pad = 1_000;
  const { minX, minY, maxX, maxY } = { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad };
  return preparePolygons([{ outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] }]);
}
