import { boundsOf, spatialIndex } from "../primitives/spatial-index.js";
import { smoothTransportBends } from "./transport-bends.js";
import { clipPolyline, distanceToSegment, pointAt, preparePolygons, ringBounds, type Bounds2D } from "../primitives/geometry2d.js";
import { SCORE_BURN_WIDTH_MM, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1 } from "../types.js";
import { outlinedJunctionPaths, uniqueRoadCenterlines } from "./road-junctions.js";
import { surroundingFrame } from "./marking-clip.js";
import { transportationStrokePaths } from "./transportation.js";

const TIE_PITCH = 3.8;
const TIE_HALF = 0.6;
const CLEARANCE = SCORE_BURN_WIDTH_MM * 2;

interface Segment extends Bounds2D {
  feature: MarkingFeature;
  a: Point2D;
  b: Point2D;
  start: number;
  length: number;
  endIndex: number;
}
function halfRoad(f: MarkingFeature, config: ProjectConfigV1): number {
  return f.transportationClass === "major-road" && config.lineStyle.roadStyle === "outlined" ? config.lineStyle.majorRoadSpacingMm / 2 : 0;
}

// At an interior vertex two lines can touch and turn back. A crossing has
// alternating incident directions around the intersection, including at bends.
function crossesAtVertex(upper: Segment, lower: Segment, point: Point2D): boolean {
  function directions(s: Segment): number[] {
    const points = s.feature.points;
    const angles: number[] = [];
    for (const step of [-1, 1]) {
      let i = step < 0 ? s.endIndex - 1 : s.endIndex;
      while (points[i] && Math.hypot(points[i]!.x - point.x, points[i]!.y - point.y) < 1e-6) i += step;
      if (points[i]) angles.push(Math.atan2(points[i]!.y - point.y, points[i]!.x - point.x));
    }
    return angles;
  }
  const [a, b] = directions(upper), [c, d] = directions(lower);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return false;
  const turn = (from: number, to: number) => (to - from + 2 * Math.PI) % (2 * Math.PI);
  const end = turn(a, b), cTurn = turn(a, c), dTurn = turn(a, d);
  const nearRay = (angle: number) => Math.min(angle, 2 * Math.PI - angle, Math.abs(angle - end)) < 1e-6;
  return !nearRay(cTurn) && !nearRay(dTurn) && (cTurn < end) !== (dTurn < end);
}

/** A local bridge deck at a transverse, interior crossing. Shared approach ends stay joined. */
function bridgeGap(upper: Segment, lower: Segment, lengths: Map<MarkingFeature, number>, config: ProjectConfigV1): Polygon2D | undefined {
  const ux = (upper.b.x - upper.a.x) / upper.length, uy = (upper.b.y - upper.a.y) / upper.length;
  const lx = (lower.b.x - lower.a.x) / lower.length, ly = (lower.b.y - lower.a.y) / lower.length;
  const sine = ux * ly - uy * lx;
  if (Math.abs(sine) < 1e-6) return;
  const dx = lower.a.x - upper.a.x, dy = lower.a.y - upper.a.y;
  const u = (dx * ly - dy * lx) / sine, l = (dx * uy - dy * ux) / sine;
  if (u < -1e-7 || u > upper.length + 1e-7 || l < -1e-7 || l > lower.length + 1e-7) return;
  const uRun = upper.start + u, lRun = lower.start + l;
  if (Math.min(uRun, lengths.get(upper.feature)! - uRun, lRun, lengths.get(lower.feature)! - lRun) < 1e-5) return;
  const center = pointAt(upper.a, upper.b, u / upper.length);
  if (Math.min(u, upper.length - u, l, lower.length - l) < 1e-6 && !crossesAtVertex(upper, lower, center)) return;
  const width = halfRoad(upper.feature, config) + SCORE_BURN_WIDTH_MM + CLEARANCE;
  const reach = Math.min(6 + width, (width + halfRoad(lower.feature, config) + SCORE_BURN_WIDTH_MM) / Math.abs(sine));
  const corner = (along: number, across: number) => ({ x: center.x + ux * along - uy * across, y: center.y + uy * along + ux * across });
  const first = corner(-reach, -width);
  return { outer: [first, corner(reach, -width), corner(reach, width), corner(-reach, width), first], holes: [] };
}

/** Styled, single-pass paths in artwork millimetres, before clipping to individual terrain faces. */
export function transportScorePaths(features: MarkingFeature[], config: ProjectConfigV1): Map<MarkingFeature, Point2D[][]> {
  const transport = features.filter(f => f.kind === "road" || f.kind === "trail");
  const roads = transport.filter(f => !f.transportationClass ? f.kind === "road" : f.transportationClass === "major-road" || f.transportationClass === "local-road");
  const paths = config.lineStyle.roadStyle === "outlined" ? outlinedJunctionPaths(roads, config.lineStyle.majorRoadSpacingMm) : uniqueRoadCenterlines(roads);
  for (const f of transport) {
    if (paths.has(f)) continue;
    const styled = transportationStrokePaths(f.points, f.transportationClass ?? (f.kind === "trail" ? "trail" : "local-road"), config);
    if (styled) paths.set(f, styled);
  }
  if (!transport.some(f => f.isBridge || f.transportationClass === "rail")) return smoothTransportBends(transport, paths, [], config);

  const segments: Segment[] = [];
  const lengths = new Map<MarkingFeature, number>();
  for (const feature of transport) {
    let start = 0;
    for (let i = 1; i < feature.points.length; i++) {
      const a = feature.points[i - 1]!, b = feature.points[i]!, length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-8) continue;
      segments.push({ ...ringBounds([a, b]), a, b, length, start, feature, endIndex: i });
      start += length;
    }
    lengths.set(feature, start);
  }
  const nearby = spatialIndex(segments);
  const plateRadius = Math.hypot(config.widthMm, config.heightMm) / 2 + TIE_PITCH;
  const gaps = new Map<MarkingFeature, Polygon2D[]>();
  for (const seg of segments) {
    const f = seg.feature;
    if (f.isBridge) {
      nearby(seg, other => {
        if ((other.feature.transportLevel ?? (other.feature.isBridge ? 1 : 0)) >= (f.transportLevel ?? 1)) return false;
        const gap = bridgeGap(seg, other, lengths, config);
        if (gap) {
          const masks = gaps.get(other.feature) ?? [];
          masks.push(gap);
          gaps.set(other.feature, masks);
        }
        return false;
      });
    }
    if (f.transportationClass !== "rail") continue;
    const inset = TIE_HALF + CLEARANCE;
    const toCenter = Math.hypot(seg.a.x, seg.a.y);
    const from = seg.start + Math.max(0, toCenter - plateRadius);
    const to = Math.min(seg.start + toCenter + plateRadius, lengths.get(f)! - TIE_PITCH / 2);
    const first = TIE_PITCH / 2 + Math.max(0, Math.ceil((from - TIE_PITCH / 2) / TIE_PITCH)) * TIE_PITCH;
    for (let run = first; run < seg.start + seg.length && run <= to; run += TIE_PITCH) {
      const p = pointAt(seg.a, seg.b, (run - seg.start) / seg.length);
      if (Math.abs(p.x) > config.widthMm / 2 + inset || Math.abs(p.y) > config.heightMm / 2 + inset) continue;
      const reach = inset + Math.max(TIE_HALF, config.lineStyle.roadStyle === "outlined" ? config.lineStyle.majorRoadSpacingMm / 2 : 0);
      const box = { minX: p.x - reach, minY: p.y - reach, maxX: p.x + reach, maxY: p.y + reach };
      if (nearby(box, other => {
        // On adjacent open tracks the ends of two ties can touch even when
        // neither tie reaches the neighbouring centerline.
        const neighbourWidth = other.feature.transportationClass === "rail" ? TIE_HALF : halfRoad(other.feature, config);
        const clearance = inset + neighbourWidth;
        if (other.feature === f && run >= other.start - clearance && run <= other.start + other.length + clearance) return false;
        return distanceToSegment(p, other.a, other.b) <= clearance;
      })) continue;
      const nx = -(seg.b.y - seg.a.y) * TIE_HALF / seg.length, ny = (seg.b.x - seg.a.x) * TIE_HALF / seg.length;
      const strokes = paths.get(f) ?? [f.points];
      strokes.push([{ x: p.x - nx, y: p.y - ny }, { x: p.x + nx, y: p.y + ny }]);
      paths.set(f, strokes);
    }
  }
  for (const [f, masks] of gaps) {
    // Keep both edges of outlined underpasses and every dash on the lower route clear of the deck.
    const strokes = paths.get(f) ?? [f.points];
    if (!strokes.length) continue;
    const material = surroundingFrame(boundsOf(strokes.map(ringBounds)));
    const excluded = preparePolygons(masks);
    paths.set(f, strokes.flatMap(stroke => clipPolyline(stroke, material, excluded)));
  }
  return smoothTransportBends(transport, paths, [...gaps.values()].flat(), config);
}
