import { filledPolygons, clipPolygons, strokePolylines, type StrokeCap, type StrokeJoin } from "../primitives/offset.js";
import { ringBounds, signedArea, simplify } from "../primitives/geometry2d.js";
import { MARKER_ICON_UNITS, MAX_MARKER_ICON_POINTS, type MarkerIconShapeV1, type MarkerIconV1, type Point2D, type Polygon2D } from "../types.js";
import type { PathPolyline } from "./svg-path-data.js";

/**
 * One thing an SVG draws, already in shared coordinates (y down): a fill of
 * rings under a fill rule, or a stroke along polylines. `erase` marks white
 * paint, which covers what was drawn before it instead of adding ink.
 */
export type MarkerIconPaint =
  | { kind: "fill"; polylines: PathPolyline[]; rule: "nonzero" | "evenodd"; erase?: boolean }
  | { kind: "stroke"; polylines: PathPolyline[]; width: number; cap: StrokeCap; join: StrokeJoin; erase?: boolean };

export class MarkerIconError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkerIconError";
  }
}

const HALF_UNITS = MARKER_ICON_UNITS / 2;
/** Simplification starts well under a pixel of a 1000-unit icon and doubles until the icon fits the point budget. */
const FIRST_TOLERANCE_UNITS = 0.5;
const LAST_TOLERANCE_UNITS = 16;

/** The region the paints leave inked, in paint order: later white paint covers earlier ink. */
export function paintedRegion(paints: MarkerIconPaint[]): Polygon2D[] {
  let region: Polygon2D[] = [];
  for (const paint of paints) {
    const painted = paint.kind === "fill"
      // SVG fills every subpath as if closed.
      ? filledPolygons(paint.polylines.map(({ points }) => points), paint.rule)
      : strokePolylines(paint.polylines, paint.width, paint.cap, paint.join);
    if (!painted.length) continue;
    region = paint.erase
      ? (region.length ? clipPolygons(region, painted, "difference") : region)
      : clipPolygons(region, painted, "union");
  }
  return region;
}

function pointCount(shapes: MarkerIconShapeV1[]): number {
  return shapes.reduce((sum, shape) => sum + shape.outer.length / 2 + (shape.holes ?? []).reduce((holes, hole) => holes + hole.length / 2, 0), 0);
}

/** A closed ring as stored: rounded to whole units, repeated points and the closing point dropped. */
function quantizedRing(ring: Point2D[], tolerance: number, transform: (point: Point2D) => Point2D): number[] | undefined {
  const simplified = simplify(ring.map(transform), tolerance);
  const flat: number[] = [];
  for (const point of simplified) {
    // `|| 0` folds -0, which JSON would not keep.
    const x = Math.round(point.x) || 0; const y = Math.round(point.y) || 0;
    if (flat.length && flat.at(-2) === x && flat.at(-1) === y) continue;
    flat.push(x, y);
  }
  if (flat.length >= 4 && flat[0] === flat.at(-2) && flat[1] === flat.at(-1)) flat.splice(-2, 2);
  if (flat.length < 6) return undefined;
  // A ring rounding left without area is a sliver no laser could draw.
  return Math.abs(signedArea(decodeRing(flat))) >= 1 ? flat : undefined;
}

function decodeRing(flat: number[]): Point2D[] {
  const ring: Point2D[] = [];
  for (let index = 0; index + 1 < flat.length; index += 2) ring.push({ x: flat[index]!, y: flat[index + 1]! });
  if (ring.length) ring.push({ ...ring[0]! });
  return ring;
}

/**
 * Turns what an SVG paints into a stored marker icon: fitted so its longer
 * side spans MARKER_ICON_UNITS about the origin, then simplified only as far
 * as the point budget needs. Throws MarkerIconError when nothing is painted or
 * the drawing stays too detailed at the coarsest tolerance.
 */
export function buildMarkerIcon(paints: MarkerIconPaint[], options: { id: string; name: string; anchor?: "bottom"; maxPoints?: number; noun?: string }): MarkerIconV1 {
  const maxPoints = options.maxPoints ?? MAX_MARKER_ICON_POINTS;
  const region = paintedRegion(paints);
  if (!region.length) throw new MarkerIconError("The SVG draws no filled or stroked shapes.");
  const bounds = region.map(({ outer }) => ringBounds(outer)).reduce((all, next) => ({
    minX: Math.min(all.minX, next.minX), minY: Math.min(all.minY, next.minY),
    maxX: Math.max(all.maxX, next.maxX), maxY: Math.max(all.maxY, next.maxY),
  }));
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (!(extent > 0)) throw new MarkerIconError("The SVG's shapes have no size.");
  const scale = MARKER_ICON_UNITS / extent;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const transform = (point: Point2D): Point2D => ({ x: (point.x - centerX) * scale, y: (point.y - centerY) * scale });
  for (let tolerance = FIRST_TOLERANCE_UNITS; tolerance <= LAST_TOLERANCE_UNITS; tolerance *= 2) {
    const shapes = [...region]
      // Largest first, so a budget-busting speck never outranks the icon's body.
      .sort((left, right) => Math.abs(signedArea(right.outer)) - Math.abs(signedArea(left.outer)))
      .flatMap((polygon): MarkerIconShapeV1[] => {
        const outer = quantizedRing(polygon.outer, tolerance, transform);
        if (!outer) return [];
        const holes = polygon.holes.map((hole) => quantizedRing(hole, tolerance, transform)).filter((hole): hole is number[] => hole !== undefined);
        return [{ outer, ...(holes.length ? { holes } : {}) }];
      });
    if (!shapes.length) throw new MarkerIconError("The SVG's shapes are too thin to engrave.");
    if (pointCount(shapes) <= maxPoints) {
      return { id: options.id, name: options.name, ...(options.anchor ? { anchor: options.anchor } : {}), shapes };
    }
  }
  throw new MarkerIconError(`The SVG is too detailed for ${options.noun ?? "a marker"}; simplify it to fewer than ${maxPoints} points.`);
}

/** Every point of an icon, for budget checks. */
export function markerIconPointCount(icon: Pick<MarkerIconV1, "shapes">): number {
  return pointCount(icon.shapes);
}

/** The lowest point of an icon in stored units (y down), where a bottom anchor sits. */
export function markerIconBottom(icon: Pick<MarkerIconV1, "shapes">): number {
  let bottom = -HALF_UNITS;
  for (const shape of icon.shapes) {
    for (let index = 1; index < shape.outer.length; index += 2) bottom = Math.max(bottom, shape.outer[index]!);
  }
  return bottom;
}

/**
 * Stored shapes drawn `size` across their longer side, turned `rotationRad`
 * clockwise on the artwork (y down) about their center, then centered on
 * `center`, as filled polygons.
 */
export function iconShapePolygons(shapes: MarkerIconShapeV1[], center: Point2D, size: number, rotationRad = 0): Polygon2D[] {
  const scale = size / MARKER_ICON_UNITS;
  const cos = Math.cos(rotationRad) * scale;
  const sin = Math.sin(rotationRad) * scale;
  // Unrotated shapes skip the matrix so markers draw exactly as they always have.
  const place = rotationRad === 0
    ? (flat: number[]) => decodeRing(flat).map(({ x, y }) => ({ x: center.x + x * scale, y: center.y + y * scale }))
    : (flat: number[]) => decodeRing(flat).map(({ x, y }) => ({ x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }));
  return shapes.map((shape) => ({ outer: place(shape.outer), holes: (shape.holes ?? []).map(place) }));
}

/** An icon drawn `size` across its longer side, centered on `center`, as filled polygons. */
export function markerIconPolygons(icon: Pick<MarkerIconV1, "shapes">, center: Point2D, size: number): Polygon2D[] {
  return iconShapePolygons(icon.shapes, center, size);
}
