import { CONTOUR_SIMPLIFICATION_TOLERANCE_MM, distanceToSegment, polylineLength, ringBounds, signedArea, type MarkingFeature, type Point2D, type Polygon2D } from "@topostack/core";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";

/** Pure vector-tile geometry cleanup shared by the data provider and preview refreshes. */
export const MAX_VECTOR_MARKINGS = 1800;

// Vector tiles deliberately repeat linework in a buffer outside each tile so a
// map renderer can draw seamless strokes. Fabrication geometry cannot retain
// that buffer: adjacent tiles would score or engrave the same path several times.
export function clipVectorTileLine(points: Point2D[], extent: number): Point2D[][] {
  if (points.length < 2 || !(extent > 0)) return [];
  const result: Point2D[][] = [];
  let active: Point2D[] = [];
  const samePoint = (left: Point2D, right: Point2D) => Math.hypot(left.x - right.x, left.y - right.y) <= 1e-7;
  const flush = () => {
    if (active.length > 1) result.push(active);
    active = [];
  };
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let entry = 0;
    let exit = 1;
    let visible = true;
    for (const [p, q] of [[-dx, start.x], [dx, extent - start.x], [-dy, start.y], [dy, extent - start.y]] as Array<[number, number]>) {
      if (Math.abs(p) <= 1e-12) {
        if (q < 0) { visible = false; break; }
        continue;
      }
      const ratio = q / p;
      if (p < 0) entry = Math.max(entry, ratio);
      else exit = Math.min(exit, ratio);
      if (entry > exit) { visible = false; break; }
    }
    if (!visible || exit - entry <= 1e-12) {
      flush();
      continue;
    }
    const clippedStart = { x: start.x + dx * entry, y: start.y + dy * entry };
    const clippedEnd = { x: start.x + dx * exit, y: start.y + dy * exit };
    const previous = active.at(-1);
    if (!previous || !samePoint(previous, clippedStart)) {
      flush();
      active = [clippedStart];
    }
    if (!samePoint(active.at(-1)!, clippedEnd)) active.push(clippedEnd);
  }
  flush();
  return result;
}

function pointKey(point: Point2D, toleranceMm = 1e-4): string {
  return `${Math.round(point.x / toleranceMm)},${Math.round(point.y / toleranceMm)}`;
}

function samePoint(left: Point2D, right: Point2D, tolerance = 1e-7): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= tolerance;
}

function simplifyPath(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length < 3 || tolerance <= 0) return points;
  const closed = samePoint(points[0]!, points.at(-1)!);
  const source = closed ? points.slice(0, -1) : points;
  if (source.length < 3) return points;
  const keep = new Uint8Array(source.length);
  keep[0] = 1;
  keep[source.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, source.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maximum = tolerance;
    let selected = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToSegment(source[index]!, source[start]!, source[end]!);
      if (distance > maximum) { maximum = distance; selected = index; }
    }
    if (selected > 0) {
      keep[selected] = 1;
      stack.push([start, selected], [selected, end]);
    }
  }
  const simplified = source.filter((_, index) => keep[index] === 1);
  if (closed && simplified[0]) simplified.push({ ...simplified[0] });
  return simplified;
}

function ringIsLargeEnough(points: Point2D[], minimumFeatureMm: number): boolean {
  if (points.length < 4) return false;
  const { minX, minY, maxX, maxY } = ringBounds(points);
  return maxX - minX >= minimumFeatureMm && maxY - minY >= minimumFeatureMm;
}

/** Rejoin buffered tile fragments before measuring outlines, preserving printable holes. */
export function dissolveTilePolygons(polygons: Polygon2D[], minimumFeatureMm: number): Polygon2D[] {
  if (!polygons.length) return [];
  const inputs: MultiPolygon[] = polygons.map((polygon) => [[
    polygon.outer.map((point) => [point.x, point.y] as Pair),
    ...polygon.holes.map((ring) => ring.map((point) => [point.x, point.y] as Pair)),
  ]]);
  const dissolved = polygonClipping.union(inputs[0]!, ...inputs.slice(1));
  return multiPolygonToAreas(dissolved, minimumFeatureMm);
}

/** polygon-clipping emits outer-first rings; restore the winding Polygon2D promises. */
export function multiPolygonToAreas(multi: MultiPolygon, minimumFeatureMm: number): Polygon2D[] {
  const areas: Polygon2D[] = [];
  for (const polygon of multi) {
    const [outerRing, ...holeRings] = polygon;
    if (!outerRing) continue;
    const outer = closedSimplified(outerRing, CONTOUR_SIMPLIFICATION_TOLERANCE_MM);
    if (!ringIsLargeEnough(outer, minimumFeatureMm)) continue;
    areas.push({
      outer: signedArea(outer) < 0 ? [...outer].reverse() : outer,
      holes: holeRings
        .map((ring) => closedSimplified(ring, CONTOUR_SIMPLIFICATION_TOLERANCE_MM))
        .filter((ring) => ringIsLargeEnough(ring, minimumFeatureMm))
        .map((ring) => (signedArea(ring) > 0 ? [...ring].reverse() : ring)),
    });
  }
  return areas;
}

function closedSimplified(ring: readonly Pair[], tolerance: number): Point2D[] {
  const points = simplifyPath(ring.map(([x, y]) => ({ x, y })), tolerance);
  if (!samePoint(points[0]!, points.at(-1)!)) points.push({ ...points[0]! });
  return points;
}

/** Dissolve vector-tile polygon fragments before extracting their shorelines. */
export function dissolveWaterPolygons(polygons: Polygon2D[], minimumFeatureMm: number): MarkingFeature[] {
  return shorelineMarkings(dissolveTilePolygons(polygons, minimumFeatureMm));
}

export function shorelineMarkings(areas: Polygon2D[]): MarkingFeature[] {
  const markings: MarkingFeature[] = [];
  areas.forEach((area, areaIndex) => [area.outer, ...area.holes].forEach((points, ringIndex) => {
    markings.push({ id: `water-area-${areaIndex}-shore-${ringIndex}`, kind: "water", operation: "score", points });
  }));
  return markings;
}

/**
 * Deduplicate buffered repeats, then join pieces at unambiguous degree-two
 * endpoints. Features sharing a `groupKey` are only ever joined with each
 * other; groups are emitted in first-seen order.
 */
export function joinPaths(features: MarkingFeature[], groupKey: (feature: MarkingFeature) => string = () => ""): Array<{ feature: MarkingFeature; points: Point2D[] }> {
  const groups = new Map<string, MarkingFeature[]>();
  for (const feature of features) {
    const key = groupKey(feature);
    const group = groups.get(key);
    if (group) group.push(feature); else groups.set(key, [feature]);
  }
  const joined: Array<{ feature: MarkingFeature; points: Point2D[] }> = [];
  for (const group of groups.values()) {
    const unique: MarkingFeature[] = [];
    const paths = new Set<string>();
    for (const feature of group) {
      const forward = feature.points.map((point) => pointKey(point)).join(";");
      const reverse = [...feature.points].reverse().map((point) => pointKey(point)).join(";");
      const key = forward < reverse ? forward : reverse;
      if (!paths.has(key)) { paths.add(key); unique.push(feature); }
    }
    const endpoints = new Map<string, Set<number>>();
    unique.forEach((feature, index) => {
      for (const point of [feature.points[0]!, feature.points.at(-1)!]) {
        const key = pointKey(point);
        const owners = endpoints.get(key) ?? new Set<number>();
        owners.add(index);
        endpoints.set(key, owners);
      }
    });
    const used = new Set<number>();
    unique.forEach((feature, featureIndex) => {
      if (used.has(featureIndex)) return;
      used.add(featureIndex);
      // Collect chains in each direction before flattening. Prepending each
      // neighbor copies the full chain, and spreading a long tile path can
      // exceed the JS argument limit even inside the source point budget.
      const extend = (start: Point2D): Point2D[][] => {
        let shared = start;
        const parts: Point2D[][] = [];
        while (true) {
          const owners = endpoints.get(pointKey(shared));
          if (owners?.size !== 2) break;
          const nextIndex = [...owners].find(index => !used.has(index));
          if (nextIndex === undefined) break;
          const next = unique[nextIndex]!.points;
          const outward = pointKey(next[0]!) === pointKey(shared) ? next.slice(1) : next.slice(0, -1).reverse();
          parts.push(outward);
          used.add(nextIndex);
          shared = outward.at(-1) ?? shared;
        }
        return parts;
      };
      const after = extend(feature.points.at(-1)!);
      const before = extend(feature.points[0]!);
      const points = before.flat().reverse().concat(feature.points, after.flat());
      joined.push({ feature, points });
    });
  }
  return joined;
}

/** Remove buffered duplicates and join continuous river/stream tile pieces. */
export function cleanWaterwayMarkings(markings: MarkingFeature[], minimumFeatureMm: number): MarkingFeature[] {
  const result: MarkingFeature[] = [];
  for (const { feature, points } of joinPaths(markings.filter((marking) => marking.points.length >= 2))) {
    const simplified = simplifyPath(points, CONTOUR_SIMPLIFICATION_TOLERANCE_MM);
    if (polylineLength(simplified) >= minimumFeatureMm) result.push({ ...feature, id: `waterway-${result.length}`, points: simplified });
  }
  return result;
}

export function cleanBoundaryMarkings(markings: MarkingFeature[], minimumFeatureMm: number): MarkingFeature[] {
  return cleanWaterwayMarkings(markings, minimumFeatureMm).map((marking, index) => ({ ...marking, id: `boundary-${index}` }));
}

// Once tile buffers are removed, join matching road pieces at unambiguous
// degree-two endpoints. This keeps offset normals continuous around bends while
// preserving real forks and intersections as separate branches.
export function stitchTransportationMarkings(markings: MarkingFeature[]): MarkingFeature[] {
  const transportation = markings.filter((marking) => marking.transportationClass && marking.points.length > 1);
  const other = markings.filter((marking) => !marking.transportationClass || marking.points.length < 2);
  const stitched = joinPaths(transportation, (marking) => [marking.kind, marking.transportationClass, marking.transportLevel ?? 0, marking.isBridge ?? false, marking.label ?? ""].join("\u0000"))
    .map(({ feature, points }) => ({ ...feature, points }));
  return [...stitched, ...other];
}

/**
 * Put a group's roads in the order they should survive a cut: major roads
 * before local ones, longer before shorter. Tile order otherwise decides, and
 * it has dropped a trunk road's bridge while keeping side streets. Only the
 * slots roads already hold are reordered, so other markings keep their turn.
 */
function roadsByImportance(group: MarkingFeature[]): MarkingFeature[] {
  const isRoad = (marking: MarkingFeature) => marking.kind === "road";
  const roads = group.filter(isRoad);
  if (roads.length < 2) return group;
  const rank = (marking: MarkingFeature) => marking.transportationClass === "major-road" ? 0 : marking.transportationClass === "local-road" ? 2 : 1;
  const ordered = roads
    .map((marking, index) => ({ marking, index, rank: rank(marking), length: polylineLength(marking.points) }))
    .sort((a, b) => a.rank - b.rank || b.length - a.length || a.index - b.index);
  let next = 0;
  return group.map((marking) => isRoad(marking) ? ordered[next++]!.marking : marking);
}

export function limitVectorMarkingGroups(groups: MarkingFeature[][], maximum = MAX_VECTOR_MARKINGS): { markings: MarkingFeature[]; truncated: boolean } {
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  // Nothing is reordered when everything fits.
  const nonempty = groups.filter((group) => group.length > 0).map((group) => total > maximum ? roadsByImportance(group) : group);
  const markings: MarkingFeature[] = [];
  for (let index = 0; markings.length < maximum; index += 1) {
    let added = false;
    for (const group of nonempty) {
      const marking = group[index];
      if (!marking) continue;
      markings.push(marking);
      added = true;
      if (markings.length >= maximum) break;
    }
    if (!added) break;
  }
  return { markings, truncated: total > markings.length };
}
