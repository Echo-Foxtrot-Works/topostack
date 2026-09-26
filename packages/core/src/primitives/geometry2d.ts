import type { MultiPolygon, Pair, Polygon, Ring } from "polygon-clipping";
import type { Point2D, Polygon2D } from "../types.js";

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Web Mercator world Y in [0, 1] (north at 0), clamped to the projection's latitude limit. */
export function mercatorWorldY(latitude: number): number {
  const radians = clamp(latitude, -85.0511, 85.0511) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
}

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function close(points: Point2D[]): Point2D[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || (first.x === last.x && first.y === last.y)) return points;
  return [...points, first];
}

export function toRing(points: Point2D[]): Ring {
  return points.map(({ x, y }) => [x, y] as Pair);
}

/** A polygon as polygon-clipping takes it: the outer ring, then its holes. */
export function toClipPolygon(polygon: Polygon2D): Polygon {
  return [toRing(polygon.outer), ...polygon.holes.map(toRing)];
}

export function toMultiPolygon(polygons: Polygon2D[]): MultiPolygon {
  return polygons.map(toClipPolygon);
}

export function toPoint(ringPoint: Pair): Point2D {
  return { x: ringPoint[0], y: ringPoint[1] };
}

/**
 * polygon-clipping output as engine polygons: every ring explicitly closed,
 * `outer` wound positively, `holes` negatively.
 *
 * This is the only place that establishes the `Polygon2D` invariant, so every
 * caller of a boolean op must come through here. `refine` may reshape a ring
 * (simplification) or drop it by returning undefined; the default keeps rings
 * verbatim, which is what a caller dividing already-final geometry wants -
 * re-simplifying flattens rounded corners, and dropping a ring deletes
 * material rather than tidying it.
 */
export function normalizeMultiPolygon(
  result: MultiPolygon,
  refine: (ring: Point2D[], role: "outer" | "hole") => Point2D[] | undefined = (ring) => ring,
): Polygon2D[] {
  const polygons: Polygon2D[] = [];
  for (const polygon of result) {
    const [outerRing, ...holeRings] = polygon;
    if (!outerRing) continue;
    const refinedOuter = refine(close(outerRing.map(toPoint)), "outer");
    if (!refinedOuter) continue;
    const outer = signedArea(refinedOuter) < 0 ? [...refinedOuter].reverse() : refinedOuter;
    const holes = holeRings
      .map((ring) => refine(close(ring.map(toPoint)), "hole"))
      .filter((ring): ring is Point2D[] => Boolean(ring))
      .map((ring) => (signedArea(ring) > 0 ? [...ring].reverse() : ring));
    polygons.push({ outer, holes });
  }
  return polygons;
}

export function signedArea(points: Point2D[]): number {
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current && next) area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

export function ringBounds(ring: Point2D[]): Bounds2D {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundsOverlap(a: Bounds2D, b: Bounds2D): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boundsContainBounds(outer: Bounds2D, inner: Bounds2D): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function pointInBounds(point: Point2D, bounds: Bounds2D): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

export function pointInRing(point: Point2D, ring: Point2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if (!a || !b) continue;
    const crosses = (a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Point2D, polygon: Polygon2D): boolean {
  return pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole));
}

/**
 * Slack on bounding-box rejections. Ray casting can place a crossing a few ulps
 * beyond a ring's true extent, so a box test that must agree exactly with
 * `pointInRing` rejects only points clearly outside.
 */
const BOUNDS_SLACK = 1e-6;

function pointNearBounds(point: Point2D, bounds: Bounds2D): boolean {
  return point.x >= bounds.minX - BOUNDS_SLACK && point.x <= bounds.maxX + BOUNDS_SLACK &&
    point.y >= bounds.minY - BOUNDS_SLACK && point.y <= bounds.maxY + BOUNDS_SLACK;
}

/** A balanced hierarchy over consecutive edges; contour neighbours are spatial neighbours. */
interface EdgeNode extends Bounds2D {
  start: number;
  end: number;
  left?: EdgeNode;
  right?: EdgeNode;
}

interface PreparedRing {
  ring: Point2D[];
  bounds: Bounds2D;
}

// Descriptors belong to a preparation, never to mutable input arrays globally.
// Concatenated covering sets share descriptors, so they share the same lazy index.
const edgeIndexes = new WeakMap<PreparedRing, EdgeNode>();

function edgeIndex(prepared: PreparedRing): EdgeNode | undefined {
  const { ring } = prepared;
  if (ring.length < 64) return undefined;
  let root = edgeIndexes.get(prepared);
  if (root) return root;
  const build = (start: number, end: number): EdgeNode => {
    const node: EdgeNode = { start, end, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    if (end - start > 16) {
      const middle = (start + end) >>> 1;
      node.left = build(start, middle);
      node.right = build(middle, end);
      node.minX = Math.min(node.left.minX, node.right.minX);
      node.minY = Math.min(node.left.minY, node.right.minY);
      node.maxX = Math.max(node.left.maxX, node.right.maxX);
      node.maxY = Math.max(node.left.maxY, node.right.maxY);
    } else {
      for (let edge = start; edge < end; edge += 1) {
        for (const point of [ring[edge]!, ring[(edge + 1) % ring.length]!]) {
          node.minX = Math.min(node.minX, point.x); node.minY = Math.min(node.minY, point.y);
          node.maxX = Math.max(node.maxX, point.x); node.maxY = Math.max(node.maxY, point.y);
        }
      }
    }
    return node;
  };
  root = build(0, ring.length);
  edgeIndexes.set(prepared, root);
  return root;
}

function pointInPreparedRing(point: Point2D, prepared: PreparedRing): boolean {
  if (!pointNearBounds(point, prepared.bounds)) return false;
  const root = edgeIndex(prepared);
  if (!root) return pointInRing(point, prepared.ring);
  const { ring } = prepared;
  const crosses = (node: EdgeNode): boolean => {
    if (point.y < node.minY || point.y > node.maxY || point.x > node.maxX + BOUNDS_SLACK) return false;
    if (node.left && node.right) return crosses(node.left) !== crosses(node.right);
    let inside = false;
    for (let edge = node.start; edge < node.end; edge += 1) {
      const a = ring[(edge + 1) % ring.length]!, b = ring[edge]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  return crosses(root);
}

/** Visit only edges near a query box, stopping as soon as a predicate succeeds. */
function someNearbyEdge(prepared: PreparedRing, bounds: Bounds2D, predicate: (start: Point2D, end: Point2D) => boolean): boolean {
  if (!boundsOverlap(bounds, prepared.bounds)) return false;
  const { ring } = prepared;
  const scan = (start: number, end: number): boolean => {
    for (let edge = start; edge < Math.min(end, ring.length - 1); edge += 1) {
      if (predicate(ring[edge]!, ring[edge + 1]!)) return true;
    }
    return false;
  };
  const root = edgeIndex(prepared);
  if (!root) return scan(0, ring.length - 1);
  const visit = (node: EdgeNode): boolean => {
    if (!boundsOverlap(bounds, node)) return false;
    return node.left && node.right ? visit(node.left) || visit(node.right) : scan(node.start, node.end);
  };
  return visit(root);
}

/** Broad-phase boundary query; the caller retains its exact geometric predicate. */
export function somePreparedEdge(prepared: PreparedPolygons, bounds: Bounds2D, predicate: (start: Point2D, end: Point2D) => boolean, outerOnly = false): boolean {
  if (outerOnly) return prepared.polygonRings.some(({ outer }) => someNearbyEdge(outer, bounds, predicate));
  return prepared.rings.some((ring) => someNearbyEdge(ring, bounds, predicate));
}

function ringCuts(a: Point2D, b: Point2D, bounds: Bounds2D, prepared: PreparedRing, cuts: number[]): void {
  someNearbyEdge(prepared, bounds, (start, end) => {
    const t = segmentIntersectionT(a, b, start, end);
    if (t !== undefined) cuts.push(t);
    return false;
  });
}

/** Polygons with their ring bounding boxes, built once for repeated clipping and containment tests. */
export interface PreparedPolygons {
  polygons: Polygon2D[];
  outerBounds: Bounds2D[];
  rings: PreparedRing[];
  /** Ring descriptors grouped for repeated point containment queries. */
  polygonRings: Array<{ outer: PreparedRing; holes: PreparedRing[] }>;
  /** Union of every outer ring's bounds; empty (inverted) when there are no polygons. */
  bounds: Bounds2D;
}

export function preparePolygons(polygons: Polygon2D[]): PreparedPolygons {
  const outerBounds = polygons.map((polygon) => ringBounds(polygon.outer));
  const polygonRings = polygons.map((polygon, index) => ({
    outer: { ring: polygon.outer, bounds: outerBounds[index]! },
    holes: polygon.holes.map((ring) => ({ ring, bounds: ringBounds(ring) })),
  }));
  const rings = polygonRings.flatMap(({ outer, holes }) => [outer, ...holes]);
  const bounds = outerBounds.reduce((union, box) => ({
    minX: Math.min(union.minX, box.minX),
    minY: Math.min(union.minY, box.minY),
    maxX: Math.max(union.maxX, box.maxX),
    maxY: Math.max(union.maxY, box.maxY),
  }), { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
  return { polygons, outerBounds, rings, polygonRings, bounds };
}

/** `polygons.some((polygon) => pointInPolygon(point, polygon))`, skipping polygons whose box excludes the point. */
export function pointInPreparedPolygons(point: Point2D, prepared: PreparedPolygons): boolean {
  return prepared.polygonRings.some(({ outer, holes }) => pointInPreparedRing(point, outer) && !holes.some((hole) => pointInPreparedRing(point, hole)));
}

const NO_POLYGONS = preparePolygons([]);

function asPrepared(polygons: Polygon2D[] | PreparedPolygons): PreparedPolygons {
  return Array.isArray(polygons) ? polygons.length ? preparePolygons(polygons) : NO_POLYGONS : polygons;
}

/**
 * Split a polyline at every ring crossing and keep the pieces inside
 * `polygons` but outside `excludedPolygons`. Pass `preparePolygons` results
 * when clipping many lines against the same material.
 */
export function clipPolyline(points: Point2D[], polygons: Polygon2D[] | PreparedPolygons, excludedPolygons: Polygon2D[] | PreparedPolygons = []): Point2D[][] {
  if (points.length < 2) return [];
  const included = asPrepared(polygons);
  if (!included.polygons.length) return [];
  const pathBounds = ringBounds(points);
  const reach = { minX: pathBounds.minX - BOUNDS_SLACK, minY: pathBounds.minY - BOUNDS_SLACK, maxX: pathBounds.maxX + BOUNDS_SLACK, maxY: pathBounds.maxY + BOUNDS_SLACK };
  // No piece of a line wholly outside the material's box can be inside it.
  if (!boundsOverlap(reach, included.bounds)) return [];
  // Likewise an exclusion set whose box misses the line can neither cut nor contain it.
  const excludedSet = asPrepared(excludedPolygons);
  const excluded = boundsOverlap(reach, excludedSet.bounds) ? excludedSet : NO_POLYGONS;
  const result: Point2D[][] = [];
  let active: Point2D[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;
    const segmentBounds: Bounds2D = {
      minX: Math.min(a.x, b.x) - 1e-6,
      minY: Math.min(a.y, b.y) - 1e-6,
      maxX: Math.max(a.x, b.x) + 1e-6,
      maxY: Math.max(a.y, b.y) + 1e-6,
    };
    const cuts = [0, 1];
    for (let set = 0; set < 2; set += 1) {
      for (const ring of set === 0 ? included.rings : excluded.rings) {
        if (boundsOverlap(segmentBounds, ring.bounds)) ringCuts(a, b, segmentBounds, ring, cuts);
      }
    }
    cuts.sort((left, right) => left - right);
    const unique = cuts.filter((value, cutIndex) => cutIndex === 0 || Math.abs(value - cuts[cutIndex - 1]!) > 1e-7);
    for (let cutIndex = 0; cutIndex < unique.length - 1; cutIndex += 1) {
      const startT = unique[cutIndex]!;
      const endT = unique[cutIndex + 1]!;
      const midpoint = pointAt(a, b, (startT + endT) / 2);
      if (pointInPreparedPolygons(midpoint, included) && !pointInPreparedPolygons(midpoint, excluded)) {
        const start = pointAt(a, b, startT);
        const end = pointAt(a, b, endT);
        const previous = active[active.length - 1];
        if (!previous || Math.hypot(previous.x - start.x, previous.y - start.y) > 1e-6) {
          if (active.length > 1) result.push(active);
          active = [start];
        }
        active.push(end);
      } else if (active.length > 1) {
        result.push(active);
        active = [];
      }
    }
  }
  if (active.length > 1) result.push(active);
  return result;
}

export function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: Point2D, a: Point2D, b: Point2D): boolean {
  return Math.abs(orientation(a, b, point)) < 1e-8 &&
    point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8 &&
    point.y >= Math.min(a.y, b.y) - 1e-8 && point.y <= Math.max(a.y, b.y) + 1e-8;
}

export function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-8 && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) < 1e-8 && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) < 1e-8 && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) < 1e-8 && pointOnSegment(b, c, d));
}

export function segmentIntersectionT(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  return t > 1e-8 && t < 1 - 1e-8 && u >= 0 && u <= 1 ? t : undefined;
}

export function pointAt(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function rotatedPoint(point: Point2D, origin: Point2D, angleRad: number): Point2D {
  if (angleRad === 0) return point;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return { x: origin.x + dx * cosine - dy * sine, y: origin.y + dx * sine + dy * cosine };
}

export function ringFitsInsidePolygon(ring: Point2D[], polygon: Polygon2D, marginMm: number, allowContainedHoles = false, prepared = preparePolygons([polygon])): boolean {
  // A connected ring cannot leave material without crossing its boundary.
  // Check one anchor, then prove every edge stays clear below. Ray-casting
  // every vertex and midpoint was quadratic on detailed terrain contours.
  if (ring.length < 2 || !pointInPreparedPolygons(ring[0]!, prepared)) return false;
  const reach = Math.max(0, marginMm) + BOUNDS_SLACK;
  const threshold = marginMm - 1e-7;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (!start || !end) return false;
    const edgeBox = { minX: Math.min(start.x, end.x) - reach, minY: Math.min(start.y, end.y) - reach, maxX: Math.max(start.x, end.x) + reach, maxY: Math.max(start.y, end.y) + reach };
    for (const boundary of prepared.rings) {
      if (someNearbyEdge(boundary, edgeBox, (boundaryStart, boundaryEnd) => {
        if (Math.min(boundaryStart.x, boundaryEnd.x) > edgeBox.maxX || Math.max(boundaryStart.x, boundaryEnd.x) < edgeBox.minX ||
          Math.min(boundaryStart.y, boundaryEnd.y) > edgeBox.maxY || Math.max(boundaryStart.y, boundaryEnd.y) < edgeBox.minY) return false;
        if (segmentsIntersect(start, end, boundaryStart, boundaryEnd)) return true;
        // Preserve the original distance test and tolerance at fabrication boundaries.
        return threshold > 0 && Math.min(distanceToSegment(start, boundaryStart, boundaryEnd), distanceToSegment(end, boundaryStart, boundaryEnd), distanceToSegment(boundaryStart, start, end), distanceToSegment(boundaryEnd, start, end)) < threshold;
      })) return false;
    }
  }
  if (allowContainedHoles || !polygon.holes.length) return true;
  const child = preparePolygons([{ outer: ring, holes: [] }]);
  // No boundary crossed, so a hole is either entirely enclosed or entirely outside.
  return !polygon.holes.some((hole) => hole.length > 1 && pointInPreparedPolygons(hole[0]!, child));
}

// Douglas–Peucker: keeps every vertex that deviates from the simplified shape
// by more than tolerance. The previous distance-bucket thinning kept collinear
// stair-step vertices while dropping genuine curvature, which read as chunky.
export function simplify(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 5 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDistance = tolerance;
    let maxIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToSegment(points[index]!, points[start]!, points[end]!);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxIndex > 0) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return close(points.filter((_, index) => keep[index] === 1));
}

/** Douglas-Peucker thinning of a closed ring; the result stays closed. */
export function simplifyClosedRing(ring: Point2D[], tolerance: number): Point2D[] {
  const open = ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y ? ring.slice(0, -1) : ring;
  if (open.length <= 4) return ring;
  const keep = new Uint8Array(open.length);
  keep[0] = 1;
  keep[open.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, open.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = open[start]!;
    const b = open[end]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const point = open[index]!;
      const d = length ? Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / length : Math.hypot(point.x - a.x, point.y - a.y);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  const kept = open.filter((_, index) => keep[index]);
  return kept.length >= 3 ? [...kept, kept[0]!] : ring;
}
