import type { MarkingFeature, Point2D } from "../types.js";
import { offsetPolyline } from "./transportation.js";

const pointKey = (p: Point2D) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;
const heading = (p: Point2D, next: Point2D) => Math.atan2(next.y - p.y, next.x - p.x);
const rayKey = (angle: number) => `${Math.round(Math.cos(angle) * 1e6)},${Math.round(Math.sin(angle) * 1e6)}`;
const distinctPoints = (points: Point2D[]) => points.filter((p, i) => !i || pointKey(p) !== pointKey(points[i - 1]!));

interface Arm { angle: number; length: number; major: boolean; left?: Point2D; right?: Point2D; stop?: Point2D }
interface Node { point: Point2D; arms: Map<string, Arm> }

function finishJunction({ point, arms }: Node, radius: number): boolean {
  const major = [...arms.values()].filter(arm => arm.major).sort((a, b) => a.angle - b.angle);
  if (arms.size < 2 || !major.length) return false;
  if (major.length === 1) {
    // A double-line road narrows to a single line at a change of class.
    major[0]!.left = major[0]!.right = point;
    return true;
  }
  for (let i = 0; i < major.length; i++) {
    const a = major[i]!, b = major[(i + 1) % major.length]!;
    const half = ((b.angle - a.angle + 2 * Math.PI) % (2 * Math.PI)) / 2;
    // Adjacent arms share this offset corner. Limit the miter at acute forks.
    const travelLimit = 0.45 * Math.min(a.length, b.length) / Math.max(1e-8, Math.abs(Math.cos(half)));
    const distance = Math.min(travelLimit, radius / Math.max(0.5, Math.sin(half)));
    a.left = b.right = { x: point.x + distance * Math.cos(a.angle + half), y: point.y + distance * Math.sin(a.angle + half) };
  }
  for (const arm of arms.values()) {
    if (arm.major) continue;
    // A single-line approach stops at the near edge of the outlined road.
    let sine = 1;
    for (const other of major) {
      const angle = other.angle - arm.angle;
      if (Math.cos(angle) > 0) sine = Math.min(sine, Math.abs(Math.sin(angle)));
    }
    const distance = Math.min(arm.length * 0.45, radius / Math.max(0.5, sine));
    arm.stop = { x: point.x + distance * Math.cos(arm.angle), y: point.y + distance * Math.sin(arm.angle) };
  }
  return true;
}

/** Keep a coincident road leg on one toolpath, even when two named routes share it. */
export function uniqueRoadCenterlines(roads: MarkingFeature[]): Map<MarkingFeature, Point2D[][]> {
  const used = new Set<string>();
  const result = new Map<MarkingFeature, Point2D[][]>();
  // A shared arterial and side-road segment belongs to the arterial SVG group.
  const ordered = [...roads].sort((a, b) => Number(b.transportationClass === "major-road") - Number(a.transportationClass === "major-road"));
  for (const f of ordered) {
    const points = distinctPoints(f.points);
    const parts: Point2D[][] = [];
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      const a = pointKey(points[i - 1]!), b = pointKey(points[i]!);
      const edge = `${f.transportLevel ?? (f.isBridge ? 1 : 0)}/${a < b ? a + "/" + b : b + "/" + a}`;
      if (!used.has(edge)) {
        used.add(edge);
        continue;
      }
      if (i - start >= 2) parts.push(points.slice(start, i));
      start = i;
    }
    if (start > 0 || points.length !== f.points.length) {
      if (points.length - start >= 2) parts.push(points.slice(start));
      result.set(f, parts);
    }
  }
  return result;
}

/** A deck can start partway around a bend. Allow only a single pair of
 * major-road ends to share offset corners across that grade change. */
function bridgeApproaches(paths: { f: MarkingFeature; points: Point2D[] }[]): Set<string> {
  type End = { feature: MarkingFeature; angle: number };
  const candidates = new Map<string, End[]>();
  for (const { f, points } of paths) {
    if (f.isBridge && f.transportationClass === "major-road" && points.length > 1) {
      candidates.set(pointKey(points[0]!), []);
      candidates.set(pointKey(points.at(-1)!), []);
    }
  }
  const joins = new Set<string>();
  if (!candidates.size) return joins;
  for (const { f, points } of paths) {
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!, key = pointKey(point), ends = candidates.get(key);
      if (!ends) continue;
      const adjacent = i === 0 ? points[1] : i === points.length - 1 ? points[i - 1] : undefined;
      if (!adjacent || f.transportationClass !== "major-road" || ends.length === 2) candidates.delete(key);
      else ends.push({ feature: f, angle: heading(point, adjacent) });
    }
  }
  for (const [key, [a, b]] of candidates) {
    if (a && b && Boolean(a.feature.isBridge) !== Boolean(b.feature.isBridge)
      && !(a.feature.label && b.feature.label && a.feature.label !== b.feature.label)
      && Math.cos(a.angle - b.angle) < -0.5) joins.add(key);
  }
  return joins;
}

/** Solve edge endpoints only at shared, same-grade road vertices. Nearby parallel roads stay separate. */
export function outlinedJunctionPaths(roads: MarkingFeature[], spacing: number): Map<MarkingFeature, Point2D[][]> {
  const nodes = new Map<string, Node>();
  const unique = uniqueRoadCenterlines(roads);
  const paths = roads.flatMap(f => (unique.get(f) ?? [f.points]).map(points => ({ f, points })));
  const approaches = bridgeApproaches(paths);
  function nodeKey(f: MarkingFeature, p: Point2D): string {
    const key = pointKey(p);
    return approaches.has(key) ? `approach/${key}` : `${f.transportLevel ?? (f.isBridge ? 1 : 0)}/${key}`;
  }
  const owners = new Map<string, MarkingFeature>();
  const shared = new Set<string>();
  for (const { f, points } of paths) {
    for (const p of points) {
      const key = nodeKey(f, p), owner = owners.get(key);
      if (owner && owner !== f) shared.add(key);
      else owners.set(key, f);
    }
  }
  for (const { f, points } of paths) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!, key = nodeKey(f, p);
      if (!shared.has(key)) continue;
      const node = nodes.get(key) ?? { point: p, arms: new Map<string, Arm>() };
      for (const next of [points[i - 1], points[i + 1]]) {
        if (!next) continue;
        const angle = heading(p, next), ray = rayKey(angle);
        const length = Math.hypot(next.x - p.x, next.y - p.y);
        const arm = node.arms.get(ray) ?? { angle, length, major: false };
        arm.length = Math.min(arm.length, length);
        arm.major ||= f.transportationClass === "major-road";
        node.arms.set(ray, arm);
      }
      nodes.set(key, node);
    }
  }
  for (const [key, node] of nodes) if (!finishJunction(node, spacing / 2)) nodes.delete(key);
  const result = new Map<MarkingFeature, Point2D[][]>([...unique.keys()].map(f => [f, []]));
  for (const { f, points: original } of paths) {
    const split = original.findIndex(p => nodes.has(nodeKey(f, p)));
    if (original.length < 2 || (split < 0 && !unique.has(f))) continue;
    // Rotate closed streets to a junction so their arbitrary seam stays smooth.
    const closed = pointKey(original[0]!) === pointKey(original.at(-1)!);
    const points = closed && split >= 0 ? original.slice(split, -1).concat(original.slice(0, split + 1)) : original;
    const output = result.get(f) ?? [];
    let start = 0;
    for (let end = 1; end < points.length; end++) {
      const last = points[end]!, endNode = nodes.get(nodeKey(f, last));
      if (!endNode && end < points.length - 1) continue;
      const first = points[start]!, run = points.slice(start, end + 1);
      const a = nodes.get(nodeKey(f, first))?.arms.get(rayKey(heading(first, points[start + 1]!)));
      const b = endNode?.arms.get(rayKey(heading(last, points[end - 1]!)));
      if (f.transportationClass === "major-road") {
        for (const side of [-1, 1]) {
          const edge = offsetPolyline(run, side * spacing / 2);
          edge[0] = (side > 0 ? a?.left : a?.right) ?? edge[0]!;
          edge[edge.length - 1] = (side > 0 ? b?.right : b?.left) ?? edge.at(-1)!;
          output.push(edge);
        }
      } else {
        run[0] = a?.stop ?? first;
        run[run.length - 1] = b?.stop ?? last;
        output.push(run);
      }
      start = end;
    }
    result.set(f, output);
  }
  return result;
}
