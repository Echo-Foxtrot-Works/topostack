import ClipperLib from "clipper-lib";
import type { Point2D, Polygon2D } from "../types.js";

const CLIPPER_SCALE = 10_000;

function samePoint(left: Point2D, right: Point2D): boolean {
  return left.x === right.x && left.y === right.y;
}

export function offsetClosedRing(points: Point2D[], distanceMm: number, join: "miter" | "round" = "miter"): Point2D[][] {
  if (points.length < 4) return [];
  if (Math.abs(distanceMm) < 1e-9) return [[...points]];
  const first = points[0]!;
  const open = samePoint(first, points.at(-1)!) ? points.slice(0, -1) : [...points];
  const path: ClipperLib.Path = open.map((point) => ({ X: Math.round(point.x * CLIPPER_SCALE), Y: Math.round(point.y * CLIPPER_SCALE) }));
  if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
  const offsetter = new ClipperLib.ClipperOffset(2, 0.01 * CLIPPER_SCALE);
  offsetter.AddPath(path, join === "round" ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution: ClipperLib.Paths = [];
  offsetter.Execute(solution, distanceMm * CLIPPER_SCALE);
  return solution
    .filter((ring) => ring.length >= 3)
    .sort((left, right) => Math.abs(ClipperLib.Clipper.Area(right)) - Math.abs(ClipperLib.Clipper.Area(left)))
    .map((ring) => {
      const result = ring.map((point) => ({ x: point.X / CLIPPER_SCALE, y: point.Y / CLIPPER_SCALE }));
      return [...result, result[0]!];
    });
}

function toPath(points: Point2D[]): ClipperLib.Path {
  const open = points.length > 1 && samePoint(points[0]!, points.at(-1)!) ? points.slice(0, -1) : points;
  return open.map((point) => ({ X: Math.round(point.x * CLIPPER_SCALE), Y: Math.round(point.y * CLIPPER_SCALE) }));
}

/** Every ring of `polygons` as Clipper paths: outers wound positive, holes negative, so non-zero filling reads them as one region. */
function toPaths(polygons: Polygon2D[]): ClipperLib.Paths {
  return polygons.flatMap((polygon) => {
    const outer = toPath(polygon.outer);
    if (ClipperLib.Clipper.Area(outer) < 0) outer.reverse();
    return [outer, ...polygon.holes.map((hole) => {
      const path = toPath(hole);
      if (ClipperLib.Clipper.Area(path) > 0) path.reverse();
      return path;
    })];
  }).filter((path) => path.length >= 3);
}

function fromTree(tree: ClipperLib.PolyTree): Polygon2D[] {
  const toRing = (path: ClipperLib.Path): Point2D[] => {
    const ring = path.map((point) => ({ x: point.X / CLIPPER_SCALE, y: point.Y / CLIPPER_SCALE }));
    return [...ring, ring[0]!];
  };
  return ClipperLib.JS.PolyTreeToExPolygons(tree)
    .filter((polygon) => polygon.outer.length >= 3)
    .map((polygon) => ({ outer: toRing(polygon.outer), holes: polygon.holes.filter((hole) => hole.length >= 3).map(toRing) }));
}

/**
 * A boolean of two polygon sets on Clipper's integer grid (0.1 µm), which
 * copes with the edge-on-edge input that a stencil is made of: the windows
 * of a piece run along the piece's own outline for long stretches.
 */
export function clipPolygons(subject: Polygon2D[], clip: Polygon2D[], operation: "difference" | "intersection" | "union"): Polygon2D[] {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toPaths(subject), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(toPaths(clip), ClipperLib.PolyType.ptClip, true);
  const type = { difference: ClipperLib.ClipType.ctDifference, intersection: ClipperLib.ClipType.ctIntersection, union: ClipperLib.ClipType.ctUnion }[operation];
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromTree(tree);
}

/**
 * The share of `polygons` inside an axis-aligned window, cut ring by ring in
 * one linear pass (Sutherland–Hodgman), for a `clipPolygons` call that only
 * needs the neighbourhood of something small: a boolean then pays for the
 * few edges near it instead of every edge of a sheet-sized ring.
 *
 * Only for use as `clipPolygons` input. A ring that leaves and re-enters the
 * window comes back with zero-width spurs along the window's edge; Clipper's
 * non-zero fill reads those as nothing, so the region is exact.
 */
export function windowPolygons(polygons: Polygon2D[], window: { minX: number; minY: number; maxX: number; maxY: number }): Polygon2D[] {
  const overlaps = (ring: Point2D[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of ring) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    if (maxX < window.minX || minX > window.maxX || maxY < window.minY || minY > window.maxY) return "outside";
    return minX >= window.minX && maxX <= window.maxX && minY >= window.minY && maxY <= window.maxY ? "inside" : "crossing";
  };
  const cut = (ring: Point2D[]): Point2D[] => {
    const edges: Array<[(point: Point2D) => boolean, (from: Point2D, to: Point2D) => Point2D]> = [
      [(point) => point.x >= window.minX, (from, to) => ({ x: window.minX, y: from.y + ((to.y - from.y) * (window.minX - from.x)) / (to.x - from.x) })],
      [(point) => point.x <= window.maxX, (from, to) => ({ x: window.maxX, y: from.y + ((to.y - from.y) * (window.maxX - from.x)) / (to.x - from.x) })],
      [(point) => point.y >= window.minY, (from, to) => ({ x: from.x + ((to.x - from.x) * (window.minY - from.y)) / (to.y - from.y), y: window.minY })],
      [(point) => point.y <= window.maxY, (from, to) => ({ x: from.x + ((to.x - from.x) * (window.maxY - from.y)) / (to.y - from.y), y: window.maxY })],
    ];
    let points = samePoint(ring[0]!, ring.at(-1)!) ? ring.slice(0, -1) : ring;
    for (const [keeps, crossing] of edges) {
      const next: Point2D[] = [];
      points.forEach((point, index) => {
        const previous = points[(index + points.length - 1) % points.length]!;
        if (keeps(point)) {
          if (!keeps(previous)) next.push(crossing(previous, point));
          next.push(point);
        } else if (keeps(previous)) next.push(crossing(previous, point));
      });
      points = next;
      if (!points.length) return [];
    }
    return points;
  };
  return polygons.flatMap((polygon) => {
    const where = overlaps(polygon.outer);
    if (where === "outside") return [];
    const outer = where === "inside" ? polygon.outer : cut(polygon.outer);
    if (outer.length < 3) return [];
    const holes = polygon.holes.flatMap((hole) => {
      const at = overlaps(hole);
      if (at === "outside") return [];
      const kept = at === "inside" ? hole : cut(hole);
      return kept.length >= 3 ? [kept] : [];
    });
    return [{ outer, holes }];
  });
}

/**
 * The region that closed rings enclose under the non-zero rule, as outers with
 * holes. Winding is taken as drawn, so a font glyph's counter-wound contours
 * become holes and its overlapping strokes merge.
 */
export function nonZeroPolygons(rings: Point2D[][]): Polygon2D[] {
  return filledPolygons(rings, "nonzero");
}

/** The region closed rings enclose under an SVG fill rule, as outers with holes. */
export function filledPolygons(rings: Point2D[][], rule: "nonzero" | "evenodd"): Polygon2D[] {
  const paths = rings.map(toPath).filter((path) => path.length >= 3);
  if (!paths.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  const fill = rule === "evenodd" ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
  clipper.Execute(ClipperLib.ClipType.ctUnion, tree, fill, fill);
  return fromTree(tree);
}

export type StrokeCap = "butt" | "round" | "square";
export type StrokeJoin = "miter" | "round" | "bevel";

/**
 * The region a stroke of `width` paints along polylines, as SVG draws it:
 * open lines get `cap` at both ends, closed rings are stroked all the way
 * round with no ends. Miters past SVG's default limit of 4 are cut square.
 */
export function strokePolylines(polylines: Array<{ points: Point2D[]; closed: boolean }>, width: number, cap: StrokeCap = "butt", join: StrokeJoin = "miter"): Polygon2D[] {
  if (!(width > 0)) return [];
  const joinType = { miter: ClipperLib.JoinType.jtMiter, round: ClipperLib.JoinType.jtRound, bevel: ClipperLib.JoinType.jtSquare }[join];
  const openEnd = { butt: ClipperLib.EndType.etOpenButt, round: ClipperLib.EndType.etOpenRound, square: ClipperLib.EndType.etOpenSquare }[cap];
  const offsetter = new ClipperLib.ClipperOffset(4, Math.max(1, width * 0.005 * CLIPPER_SCALE));
  let added = false;
  for (const { points, closed } of polylines) {
    const path = toPath(points);
    if (path.length < (closed ? 3 : 1)) continue;
    // A lone point with round or square caps still paints a dot, as in SVG.
    if (path.length === 1) {
      if (cap === "butt") continue;
      path.push({ ...path[0]! });
    }
    offsetter.AddPath(path, joinType, closed ? ClipperLib.EndType.etClosedLine : openEnd);
    added = true;
  }
  if (!added) return [];
  const tree = new ClipperLib.PolyTree();
  offsetter.Execute(tree, width / 2 * CLIPPER_SCALE);
  return fromTree(tree);
}

/**
 * Offset a polygon set as one region: positive grows, negative shrinks. Holes
 * travel with their outer, so an island inside a hole is offset on its own
 * and never carved away by the hole around it.
 */
export function offsetPolygons(polygons: Polygon2D[], distanceMm: number, join: "miter" | "round" = "miter"): Polygon2D[] {
  const paths = toPaths(polygons);
  if (!paths.length) return [];
  const offsetter = new ClipperLib.ClipperOffset(2, 0.01 * CLIPPER_SCALE);
  offsetter.AddPaths(paths, join === "round" ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  offsetter.Execute(tree, distanceMm * CLIPPER_SCALE);
  return fromTree(tree);
}
