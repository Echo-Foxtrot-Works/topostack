import { cropBoundary } from "../primitives/crop.js";
import { distanceToSegment, pointAt, pointInRing, ringBounds, segmentIntersectionT, segmentsIntersect, type Bounds2D } from "../primitives/geometry2d.js";
import { spatialIndex } from "../primitives/spatial-index.js";
import type { MarkingFeature, Point2D, Polygon2D, ProjectConfigV1 } from "../types.js";

const MAX_TRIM_MM = 2.4;
const MAX_SHIFT_MM = 0.30;
const MIN_BEND_MM = 0.02;
const CHORD_ERROR_MM = 0.005;
const SVG_PRECISION_MM = 0.001;

interface Obstacle extends Bounds2D {
  edge?: { path: Point2D[]; index: number; feature?: MarkingFeature };
}
type Neighbours = ReturnType<typeof spatialIndex<Obstacle>>;

function searchBounds(points: Point2D[], margin: number): Bounds2D {
  const box = ringBounds(points);
  return { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin };
}

// Both routes may round a bend in the same pass. Leave room for the other
// route's entire displacement, even if its original segment misses the triangle.
function nearTriangle(a: Point2D, b: Point2D, triangle: Point2D[]): boolean {
  if (pointInRing(a, triangle)) return true;
  return triangle.some((p, i) => {
    const q = triangle[(i + 1) % 3]!;
    return segmentsIntersect(a, b, p, q) || distanceToSegment(p, a, b) <= MAX_SHIFT_MM ||
      distanceToSegment(a, p, q) <= MAX_SHIFT_MM || distanceToSegment(b, p, q) <= MAX_SHIFT_MM;
  });
}

function smoothPath(path: Point2D[], feature: MarkingFeature, nearby: Neighbours): Point2D[] {
  if (path.length < 3) return path;
  const last = path.length - 1;
  const closed = last > 2 && path[0]!.x === path[last]!.x && path[0]!.y === path[last]!.y;
  let rounded: Point2D[] | undefined;
  let copied = 0;
  // Keep the complete segment through an un-noded crossing. Changing even a
  // distant endpoint can rotate the serialized line when SVG rounds to microns.
  const fixed = new Map<number, boolean>();
  function hasInteriorContact(index: number): boolean {
    const cached = fixed.get(index);
    if (cached !== undefined) return cached;
    const a = path[index]!, b = path[index + 1]!;
    const result = nearby(searchBounds([a, b], SVG_PRECISION_MM), ({ edge }) => {
      if (!edge) return false;
      if (edge.feature === feature && edge.path === path && edge.index === index) return false;
      // A track's perpendicular ties are held in place by the local triangle
      // check. The intervening bends can still round on a long tied segment.
      if (edge.feature === feature && edge.path !== path && feature.transportationClass === "rail" && edge.path.length === 2) return false;
      const c = edge.path[edge.index]!, d = edge.path[edge.index + 1]!;
      if (segmentIntersectionT(a, b, c, d) !== undefined) return true;
      // Collinear overlaps and a T ending within output precision of this leg.
      return [c, d].some(v => distanceToSegment(v, a, b) < SVG_PRECISION_MM &&
        Math.hypot(v.x - a.x, v.y - a.y) > SVG_PRECISION_MM && Math.hypot(v.x - b.x, v.y - b.y) > SVG_PRECISION_MM);
    });
    fixed.set(index, result);
    return result;
  }
  for (let i = closed ? 0 : 1; i < last; i++) {
    const incoming = (i + last - 1) % last;
    const a = path[incoming]!, p = path[i]!, b = path[i + 1]!;
    const left = Math.hypot(a.x - p.x, a.y - p.y), right = Math.hypot(b.x - p.x, b.y - p.y);
    if (Math.min(left, right) < MIN_BEND_MM) continue;
    // The midpoint of a tangent quadratic lies this fraction of the trim
    // from its control vertex. Keep tight reversals in their mapped shape.
    const bend = Math.hypot((a.x - p.x) / left + (b.x - p.x) / right, (a.y - p.y) / left + (b.y - p.y) / right) / 4;
    if (bend <= 1e-8 || bend > Math.sin(Math.PI / 3) / 2) continue;
    const maxTrim = Math.min(MAX_TRIM_MM, 0.4 * left, 0.4 * right, MAX_SHIFT_MM / bend);
    if (maxTrim * bend <= MIN_BEND_MM || hasInteriorContact(incoming) || hasInteriorContact(i)) continue;
    for (let trim = maxTrim; trim * bend > MIN_BEND_MM; trim /= 2) {
      const start = pointAt(p, a, trim / left), end = pointAt(p, b, trim / right);
      const triangle = [start, p, end];
      if (nearby(searchBounds(triangle, MAX_SHIFT_MM), ({ edge }) => {
        if (!edge) return true; // The complete bridge opening is reserved, including its empty interior.
        if (edge.feature === feature && edge.path === path && (edge.index === incoming || edge.index === i)) return false;
        return nearTriangle(edge.path[edge.index]!, edge.path[edge.index + 1]!, triangle);
      })) continue;
      rounded ??= [];
      for (; copied < i; copied++) rounded.push(path[copied]!);
      // An even subdivision includes the midpoint, where displacement is greatest.
      const steps = 2 * Math.ceil(Math.sqrt(trim * bend / CHORD_ERROR_MM) / 2);
      rounded.push(start);
      for (let step = 1; step < steps; step++) {
        const t = step / steps;
        rounded.push(pointAt(pointAt(start, p, t), pointAt(p, end, t), t));
      }
      rounded.push(end);
      copied = i + 1;
      break;
    }
  }
  if (!rounded) return path;
  for (; copied < last; copied++) rounded.push(path[copied]!);
  rounded.push(closed ? rounded[0]! : path[last]!);
  return rounded;
}

/** Round finished score strokes before terrain routing. Every existing crossing,
 * tie, dash end and crop edge participates in the clearance check. */
export function smoothTransportBends(transport: MarkingFeature[], paths: Map<MarkingFeature, Point2D[][]>, gaps: Polygon2D[], config: ProjectConfigV1): Map<MarkingFeature, Point2D[][]> {
  if (!transport.some(f => f.kind === "road" && (paths.get(f) ?? [f.points]).some(path => path.length > 2))) return paths;
  const obstacles: Obstacle[] = gaps.map(gap => ringBounds(gap.outer));
  const addEdges = (path: Point2D[], feature?: MarkingFeature) => {
    for (let index = 0; index + 1 < path.length; index++) {
      obstacles.push({ ...ringBounds([path[index]!, path[index + 1]!]), edge: { path, index, feature } });
    }
  };
  addEdges(cropBoundary(config));
  for (const feature of transport) {
    for (const path of paths.get(feature) ?? [feature.points]) addEdges(path, feature);
  }
  const nearby = spatialIndex(obstacles);
  for (const feature of transport) {
    if (feature.kind !== "road" || feature.transportationClass === "trail") continue;
    const original = paths.get(feature) ?? [feature.points];
    const rounded = original.map(path => smoothPath(path, feature, nearby));
    if (rounded.some((path, i) => path !== original[i])) paths.set(feature, rounded);
  }
  return paths;
}
