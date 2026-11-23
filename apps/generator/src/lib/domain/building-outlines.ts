import { classifyRings, type VectorTileLayer } from "@mapbox/vector-tile";
import { boundsOverlap, clipPolyline, cropBoundary, cropRadiusMm, ringBounds, minimumCaliperWidth, preparePolygons, type Bounds2D, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1 } from "@topostack/core";
import polygonClipping, { type Pair } from "polygon-clipping";
import type { DataTile } from "./tile-math";
import { type createFeatureBudget, yieldForCancellation } from "./feature-budget";

interface SeamSpan { key: string; low: number; high: number; before: boolean; buffered: boolean }
export interface BuildingFragment { id?: number; polygon: Polygon2D; spans: SeamSpan[] }

/** Intersect each footprint with its tile edges. Coordinates along a shared
 * edge are in tile units, independent of the feature's MVT extent. */
export function buildingSeams(rings: Point2D[][], box: Bounds2D, tile: DataTile, extent: number): SeamSpan[] {
  const spans: SeamSpan[] = [];
  for (const axis of ["x", "y"] as const) {
    const along = axis === "x" ? "y" : "x";
    const min = axis === "x" ? box.minX : box.minY;
    const max = axis === "x" ? box.maxX : box.maxY;
    for (const edge of [0, extent]) {
      if (min > edge || max < edge) continue;
      const before = edge === extent;
      const key = axis === "x" ? `x/${tile.worldX + Number(before)}/${tile.y}` : `y/${tile.worldX}/${tile.y + Number(before)}`;
      // Sample just inside the owned tile, including footprints clipped without a buffer.
      const at = edge + (before ? -1e-7 : 1e-7);
      const crossings: number[] = [];
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!;
        if ((a[axis] > at) === (b[axis] > at)) continue;
        crossings.push((a[along] + (b[along] - a[along]) * (at - a[axis]) / (b[axis] - a[axis])) / extent);
      }
      crossings.sort((a, b) => a - b);
      for (let i = 1; i < crossings.length; i += 2) {
        spans.push({ key, before, low: crossings[i - 1]!, high: crossings[i]!, buffered: min < edge && edge < max });
      }
    }
  }
  return spans;
}

/** Read only owned fragments that can reach the artwork, charging their rings
 * to the same source budget as the other selected map details. */
export async function readBuildingFragments(layer: VectorTileLayer, tile: DataTile, projectPoint: (extent: number, point: Point2D) => Point2D,
  config: ProjectConfigV1, consume: ReturnType<typeof createFeatureBudget>, fragments: BuildingFragment[], signal?: AbortSignal): Promise<boolean> {
  const crop = { minX: -config.widthMm / 2, maxX: config.widthMm / 2, minY: -config.heightMm / 2, maxY: config.heightMm / 2 };
  for (let i = 0; i < layer.length; i++) {
    if (i % 64 === 0) await yieldForCancellation(signal);
    const feature = layer.feature(i);
    if (feature.type !== 3 || feature.properties.kind !== "building") continue;
    const project = (p: Point2D) => projectPoint(feature.extent, p);
    // Generalized tiles can pack thousands of unrelated footprints into one feature.
    for (const [j, rings] of classifyRings(feature.loadGeometry()).entries()) {
      if (j && j % 128 === 0) await yieldForCancellation(signal);
      const [outer, ...holes] = rings;
      if (!outer) continue;
      const box = ringBounds(outer);
      if (box.maxX <= 0 || box.maxY <= 0 || box.minX >= feature.extent || box.minY >= feature.extent) continue;
      const min = project({ x: box.minX, y: box.minY }), max = project({ x: box.maxX, y: box.maxY });
      if (!boundsOverlap(crop, { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y })) continue;
      if (config.cropShape === "circle" && Math.hypot(Math.max(0, min.x, -max.x), Math.max(0, min.y, -max.y)) > cropRadiusMm(config)) continue;
      const insideTile = box.minX > 0 && box.minY > 0 && box.maxX < feature.extent && box.maxY < feature.extent;
      if (insideTile && Math.min(max.x - min.x, max.y - min.y) + 1e-7 < config.minimumFeatureMm) continue;
      try { consume(rings, true); } catch { return false; }
      fragments.push({ id: feature.id, polygon: { outer: outer.map(project), holes: holes.map(ring => ring.map(project)) },
        spans: insideTile ? [] : buildingSeams(rings, box, tile, feature.extent) });
    }
  }
  return true;
}

function joinFootprints(fragments: BuildingFragment[]): Polygon2D[] {
  const parent = fragments.map((_, i) => i);
  function root(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  }
  const seams = new Map<string, Array<SeamSpan & { owner: number }>>();
  fragments.forEach(({ spans }, owner) => {
    for (const span of spans) {
      const group = seams.get(span.key);
      const entry = { ...span, owner };
      if (group) group.push(entry); else seams.set(span.key, [entry]);
    }
  });
  for (const spans of seams.values()) {
    spans.sort((a, b) => a.low - b.low);
    for (let i = 0; i < spans.length; i++) {
      const a = spans[i]!;
      for (let j = i + 1; j < spans.length; j++) {
        const b = spans[j]!;
        if (b.low >= a.high - 1e-9) break;
        if (a.before === b.before) continue;
        const aId = fragments[a.owner]!.id, bId = fragments[b.owner]!.id;
        // Generalized tiles can repack the same building under a different ID.
        // In that case require matching cross sections and actual buffered area.
        if (aId === undefined || aId !== bId) {
          if (Math.abs(a.low - b.low) > 1e-8 || Math.abs(a.high - b.high) > 1e-8) continue;
          if (!a.buffered && !b.buffered && aId !== undefined && bId !== undefined) continue;
        }
        parent[root(b.owner)] = root(a.owner);
      }
    }
  }
  const groups = new Map<number, Polygon2D[]>();
  fragments.forEach(({ polygon }, i) => {
    const key = root(i), group = groups.get(key);
    if (group) group.push(polygon); else groups.set(key, [polygon]);
  });
  const footprints: Polygon2D[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { footprints.push(group[0]!); continue; }
    const rings = group.map(p => [p.outer, ...p.holes].map(r => r.map(({ x, y }): Pair => [x, y])));
    for (const polygon of polygonClipping.union(rings[0]!, ...rings.slice(1))) {
      const [outer, ...holes] = polygon.map(r => r.map(([x, y]) => ({ x, y })));
      if (outer) footprints.push({ outer, holes });
    }
  }
  return footprints;
}

interface Wall {
  a: Point2D; b: Point2D; start: number; end: number;
  kept: [number, number][];
}

/** Assign each collinear interval to one outline, including walls digitized with
 * extra vertices on only one side. Keep adjacent strokes together for export. */
function uniqueWalls(markings: MarkingFeature[]): MarkingFeature[] {
  const lines = new Map<string, Wall[]>();
  const paths = markings.map(({ points }) => {
    const walls: Wall[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.hypot(dx, dy) < 1e-7) continue;
      const horizontal = Math.abs(dx) >= Math.abs(dy) * (1 - 1e-10);
      const slope = horizontal ? dy / dx : dx / dy;
      const offset = horizontal ? a.y - slope * a.x : a.x - slope * a.y;
      const key = `${horizontal}/${Math.round(slope * 1e7)}/${Math.round(offset * 1e6)}`;
      const wall: Wall = { a, b, start: horizontal ? a.x : a.y, end: horizontal ? b.x : b.y, kept: [] };
      const group = lines.get(key);
      if (group) group.push(wall); else lines.set(key, [wall]);
      walls.push(wall);
    }
    return walls;
  });
  for (const group of lines.values()) {
    if (group.length === 1) {
      const wall = group[0]!;
      wall.kept.push([Math.min(wall.start, wall.end), Math.max(wall.start, wall.end)]);
      continue;
    }
    const events = group.flatMap(wall => [
      { at: Math.min(wall.start, wall.end), entering: true, wall },
      { at: Math.max(wall.start, wall.end), entering: false, wall },
    ]).sort((a, b) => a.at - b.at);
    const active = new Set<Wall>();
    let previous = events[0]!.at;
    for (const { at, entering, wall } of events) {
      const owner = active.values().next().value;
      if (owner && at - previous > 1e-7) {
        const last = owner.kept.at(-1);
        if (last && Math.abs(last[1] - previous) < 1e-7) last[1] = at;
        else owner.kept.push([previous, at]);
      }
      if (entering) active.add(wall); else active.delete(wall);
      previous = at;
    }
  }
  const same = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  return paths.flatMap((walls, i) => {
    const strokes: Point2D[][] = [];
    for (const { a, b, start, end, kept } of walls) {
      const point = (at: number) => {
        const t = (at - start) / (end - start);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      };
      for (const interval of start < end ? kept : kept.reverse()) {
        const from = point(interval[start < end ? 0 : 1]), to = point(interval[start < end ? 1 : 0]);
        const stroke = strokes.at(-1);
        if (stroke && same(stroke.at(-1)!, from)) stroke.push(to);
        else strokes.push([from, to]);
      }
    }
    if (strokes.length > 1 && same(strokes.at(-1)!.at(-1)!, strokes[0]![0]!)) {
      strokes[0] = strokes.pop()!.concat(strokes[0]!.slice(1));
    }
    const mark = markings[i]!;
    return strokes.map((points, j) => ({ ...mark, id: j ? `${mark.id}-wall-${j}` : mark.id, points }));
  });
}

export async function buildingMarkings(fragments: BuildingFragment[], config: ProjectConfigV1, signal?: AbortSignal): Promise<MarkingFeature[]> {
  if (!fragments.length) return [];
  const crop = preparePolygons([{ outer: cropBoundary(config), holes: [] }]);
  const markings: MarkingFeature[] = [];
  const footprints = joinFootprints(fragments);
  for (const [i, footprint] of footprints.entries()) {
    if (i % 128 === 0) await yieldForCancellation(signal);
    for (const [j, ring] of [footprint.outer, ...footprint.holes].entries()) {
      if (minimumCaliperWidth(ring) + 1e-7 < config.minimumFeatureMm) {
        if (!j) break;
        continue;
      }
      for (const [k, points] of clipPolyline(ring, crop).entries()) {
        const id = `building-${i}-${j}${k ? "-" + k : ""}`;
        markings.push({ id, kind: "building", operation: "engrave", points });
      }
    }
  }
  return uniqueWalls(markings);
}
