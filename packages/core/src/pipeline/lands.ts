import { leftTicks } from "./aviation.js";
import { distanceToSegment, pointInPolygon, ringBounds, signedArea } from "../primitives/geometry2d.js";
import type { LandAreaV1, LandClass, LineStyleV1, MarkingFeature, Point2D, Polygon2D, ProjectConfigV1 } from "../types.js";

/**
 * Public land as engraved lines: each unit's boundary in its class's dash,
 * optionally hatched on the inside in a flat engraving, and the names of the
 * largest units. The outlines arrive clipped to the crop rectangle, so the
 * edges they gained along the crop are not boundaries and are left out.
 */

export function landLinesRequested(config: Pick<ProjectConfigV1, "lands">): boolean {
  return Boolean(config.lands?.boundaries.length);
}

export interface LandStroke {
  widthMm: number;
  /** Dash and gap lengths in millimetres; absent for a solid line. */
  dash?: number[];
}

/**
 * Dash patterns in multiples of the boundary width (never under 0.2 mm), one
 * per class, so a map with several classes tells them apart in one colour.
 * National parks are the heaviest solid line, monuments a plain solid one.
 */
const LAND_DASHES: Record<LandClass, number[] | undefined> = {
  "national-park": undefined,
  "national-monument": undefined,
  "national-forest": [8, 3],
  wilderness: [3, 3],
  blm: [12, 4],
  "wildlife-refuge": [8, 2, 2, 2],
  "state-park": [5, 2],
  preserve: [1, 2],
  tribal: [10, 2, 2, 2, 2, 2],
  military: [6, 6],
};

/** The stroke a land class is engraved and previewed with. Shared by the machine SVG and every studio preview. */
export function landStroke(landClass: LandClass, style: Pick<LineStyleV1, "boundaryMm">): LandStroke {
  const width = style.boundaryMm;
  const unit = Math.max(width, 0.2);
  const pattern = LAND_DASHES[landClass];
  return { widthMm: landClass === "national-park" ? width * 1.5 : width, ...(pattern ? { dash: pattern.map((length) => length * unit) } : {}) };
}

/** A unit whose name may be printed, at the point farthest inside it. */
export interface LandLabelCandidate {
  unit: string;
  label: string;
  landClass: LandClass;
  anchor: Point2D;
  /** Distance from the anchor to the unit's nearest edge in the crop; the label must fit within it. */
  clearanceMm: number;
  /** In-crop area, for ranking. */
  areaMm2: number;
}

/** Names tried at most per model, largest unit first. */
const LAND_LABEL_CANDIDATES = 24;
/** Points tried across a unit's largest polygon when looking for the roomiest place. */
const ROOM_GRID = 16;
const CROP_EDGE_MM = 1e-3;

export function landFeatures(areas: readonly LandAreaV1[], config: Pick<ProjectConfigV1, "lands" | "lineStyle" | "widthMm" | "heightMm" | "outputMode">): { lines: MarkingFeature[]; labels: LandLabelCandidate[] } {
  const wanted = new Set(config.lands?.boundaries ?? []);
  if (!wanted.size) return { lines: [], labels: [] };
  const hatched = config.outputMode === "engraving" && Boolean(config.lands?.hatched);
  const onCropEdge = cropEdgeTest(config.widthMm / 2, config.heightMm / 2);
  const lines: MarkingFeature[] = [];
  const labels: LandLabelCandidate[] = [];
  for (const area of areas) {
    if (!wanted.has(area.landClass)) continue;
    const stroke = landStroke(area.landClass, config.lineStyle);
    let index = 0;
    const line = (points: Point2D[]): MarkingFeature => ({ id: `land-${area.unit}-${index++}`, kind: "land", operation: "engrave", landClass: area.landClass, points });
    for (const polygon of area.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        const oriented = landOnLeft(ring, polygon) ? ring : [...ring].reverse();
        for (const run of runsOffCropEdge(oriented, onCropEdge)) {
          lines.push(line(run));
          if (hatched) leftTicks(run, stroke.widthMm).forEach((tick) => lines.push(line(tick)));
        }
      }
    }
    if (config.lands?.labels && area.name) {
      const room = roomiestPoint(area.polygons, onCropEdge);
      if (room) labels.push({ unit: area.unit, label: area.name, landClass: area.landClass, anchor: room.point, clearanceMm: room.clearanceMm, areaMm2: area.polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0) });
    }
  }
  labels.sort((left, right) => right.areaMm2 - left.areaMm2 || left.unit.localeCompare(right.unit));
  return { lines, labels: labels.slice(0, LAND_LABEL_CANDIDATES) };
}

type EdgeTest = (a: Point2D, b: Point2D) => boolean;

/** True for a segment lying along the crop rectangle: an edge clipping added, not a boundary. */
function cropEdgeTest(halfWidth: number, halfHeight: number): EdgeTest {
  const on = (value: number, edge: number) => Math.abs(value - edge) <= CROP_EDGE_MM;
  return (a, b) => [halfWidth, -halfWidth].some((x) => on(a.x, x) && on(b.x, x)) || [halfHeight, -halfHeight].some((y) => on(a.y, y) && on(b.y, y));
}

/** A ring cut into the runs between its crop-edge segments; the whole ring when it never touches the crop. */
function runsOffCropEdge(ring: Point2D[], onCropEdge: EdgeTest): Point2D[][] {
  const segments = ring.length - 1;
  const first = Array.from({ length: segments }, (_, index) => index).find((index) => onCropEdge(ring[index]!, ring[index + 1]!));
  if (first === undefined) return [ring];
  // Start just after a crop-edge segment, so no run wraps around the ring's seam.
  const runs: Point2D[][] = [];
  let run: Point2D[] = [];
  for (let step = 1; step <= segments; step += 1) {
    const index = (first + step) % segments;
    const a = ring[index]!;
    const b = ring[index + 1]!;
    if (onCropEdge(a, b)) {
      if (run.length >= 2) runs.push(run);
      run = [];
      continue;
    }
    if (!run.length) run.push(a);
    run.push(b);
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/** True when the land lies to the left of travel along `ring` (y down), the side `leftTicks` draws on. */
function landOnLeft(ring: Point2D[], polygon: Polygon2D): boolean {
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index]!;
    const b = ring[index + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    const step = Math.min(0.01, length / 4);
    const probe = { x: (a.x + b.x) / 2 + (b.y - a.y) / length * step, y: (a.y + b.y) / 2 - (b.x - a.x) / length * step };
    return pointInPolygon(probe, polygon);
  }
  return true;
}

/** The sampled point farthest inside a unit's largest polygon, measured to its true edges only. */
function roomiestPoint(polygons: Polygon2D[], onCropEdge: EdgeTest): { point: Point2D; clearanceMm: number } | undefined {
  const polygon = polygons.reduce<Polygon2D | undefined>((best, candidate) => (!best || polygonArea(candidate) > polygonArea(best) ? candidate : best), undefined);
  if (!polygon) return undefined;
  const edges = [polygon.outer, ...polygon.holes].flatMap((ring) => ring.slice(1).map((point, index) => [ring[index]!, point] as const).filter(([a, b]) => !onCropEdge(a, b)));
  const box = ringBounds(polygon.outer);
  let best: { point: Point2D; clearanceMm: number } | undefined;
  for (let row = 0; row < ROOM_GRID; row += 1) {
    for (let column = 0; column < ROOM_GRID; column += 1) {
      const point = { x: box.minX + (box.maxX - box.minX) * (column + 0.5) / ROOM_GRID, y: box.minY + (box.maxY - box.minY) * (row + 0.5) / ROOM_GRID };
      if (!pointInPolygon(point, polygon)) continue;
      const clearanceMm = edges.length ? Math.min(...edges.map(([a, b]) => distanceToSegment(point, a, b))) : Math.min(box.maxX - box.minX, box.maxY - box.minY) / 2;
      if (!best || clearanceMm > best.clearanceMm) best = { point, clearanceMm };
    }
  }
  return best;
}

function polygonArea(polygon: Polygon2D): number {
  return Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
}
