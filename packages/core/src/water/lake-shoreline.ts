import polygonClipping, { type Pair } from "polygon-clipping";
import { close, distanceToSegment, signedArea } from "../primitives/geometry2d.js";
import type { Point2D, Polygon2D, ProjectConfigV1, SourceBundleV1 } from "../types.js";

/** Drop points that coincide with their predecessor around a closed ring. */
function withoutRepeats(ring: Point2D[]): Point2D[] {
  return ring.filter((p, i, all) => {
    const previous = all[(i + all.length - 1) % all.length]!;
    return Math.hypot(p.x - previous.x, p.y - previous.y) > 1e-7;
  });
}

/**
 * Largest corner trim when rounding a shoreline. Fixed, like the contour
 * simplification tolerance, so the minimum feature size only decides which
 * slivers are removed and never how coarsely the remaining shore is drawn.
 */
const LAKE_CORNER_TRIM_MM = 0.8;

/** Round sparse shore samples without extrapolating beyond their local edges. */
export function smoothLakePolygon(polygon: Polygon2D, minimumFeatureMm: number): Polygon2D {
  const smooth = (ring: Point2D[]): Point2D[] => {
    let points = withoutRepeats(close(ring).slice(0, -1));
    if (points.length < 3) return ring;
    // Remove sub-feature slivers: a near reversal can be long enough to survive
    // ordinary simplification while its width is too small to fabricate.
    for (let i = points.length - 1; i >= 0 && points.length > 3; i -= 1) {
      const p = points[i]!, a = points[(i + points.length - 1) % points.length]!, b = points[(i + 1) % points.length]!;
      const ax = p.x - a.x, ay = p.y - a.y, bx = b.x - p.x, by = b.y - p.y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      const width = Math.abs(ax * by - ay * bx) / Math.max(la, lb);
      if (ax * bx + ay * by < -0.8 * la * lb && width < minimumFeatureMm * 0.18 &&
        distanceToSegment(p, a, b) <= Math.min(2, minimumFeatureMm * 2)) points.splice(i, 1);
    }
    // A removed spike can leave its two neighbours coincident: without a second
    // dedupe, a zero-length leg divides the trim by 0 and NaN vertices reach the
    // union below, which throws on a degenerate segment.
    points = withoutRepeats(points);
    if (points.length < 3) return ring;
    const result: Point2D[] = [];
    points.forEach((p, i) => {
      const a = points[(i + points.length - 1) % points.length]!;
      const b = points[(i + 1) % points.length]!;
      const incoming = Math.hypot(p.x - a.x, p.y - a.y);
      const outgoing = Math.hypot(b.x - p.x, b.y - p.y);
      // Local spacing, rather than terrain resolution, controls sparse shores.
      // A physical cap bounds displacement even when an outline is very coarse.
      const trim = Math.min(Math.min(incoming, outgoing) * 0.25, LAKE_CORNER_TRIM_MM);
      const start = { x: p.x + (a.x - p.x) * trim / incoming, y: p.y + (a.y - p.y) * trim / incoming };
      const end = { x: p.x + (b.x - p.x) * trim / outgoing, y: p.y + (b.y - p.y) * trim / outgoing };
      for (let step = 0; step <= 4; step += 1) {
        const t = step / 4, u = 1 - t;
        result.push({ x: u * u * start.x + 2 * u * t * p.x + t * t * end.x,
          y: u * u * start.y + 2 * u * t * p.y + t * t * end.y });
      }
    });
    return close(result);
  };
  const candidate = { outer: smooth(polygon.outer), holes: polygon.holes.map(smooth) };
  const rings = [candidate.outer, ...candidate.holes];
  // Degenerate input must fall back to the original outline rather than reach
  // polygon-clipping, which throws rather than returning an empty result.
  if (rings.some(ring => ring.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) return polygon;
  // Reject changes that collapse/split a lake or merge an island into its bank.
  // Comparing signed ring area with the normalized union also catches crossings.
  const normalized = polygonClipping.union([rings.map(r => r.map(p => [p.x, p.y] as Pair))]);
  if (normalized.length !== 1 || normalized[0]!.length !== rings.length) return polygon;
  const areas = rings.map(ring => Math.abs(signedArea(ring))).sort((a, b) => a - b);
  const normalizedAreas = normalized[0]!.map(ring => Math.abs(signedArea(ring.map(([x, y]) => ({ x, y }))))).sort((a, b) => a - b);
  if (areas.some((area, i) => Math.abs(normalizedAreas[i]! - area) > Math.max(1e-7, area * 1e-7))) return polygon;
  const originals = [polygon.outer, ...polygon.holes];
  if (rings.some((ring, i) => {
    const originalArea = Math.abs(signedArea(close(originals[i]!)));
    return Math.abs(Math.abs(signedArea(ring)) - originalArea) > originalArea * 0.05;
  })) return polygon;
  return candidate;
}

/** Work on a copy at generation time so repeated previews never accumulate smoothing. */
export function smoothLakeShorelines(source: SourceBundleV1, config: ProjectConfigV1): SourceBundleV1 {
  if (!config.smoothing) return source;
  const polygons = new Map<Polygon2D, Polygon2D>();
  const rings = new Map<Point2D[], Point2D[]>();
  const register = (polygon: Polygon2D) => {
    if (polygons.has(polygon)) return;
    const smoothed = smoothLakePolygon(polygon, config.minimumFeatureMm);
    const smoothedRings = [smoothed.outer, ...smoothed.holes];
    polygons.set(polygon, smoothed);
    [polygon.outer, ...polygon.holes].forEach((ring, i) => rings.set(ring, smoothedRings[i]!));
  };
  source.waterAreas?.filter(area => area.kind === "lake").forEach(area => register(area.polygon));
  source.inlandWaterAreas?.forEach(register);
  if (!polygons.size) return source;
  // Identity answers every lookup a real source needs: shoreline markings and
  // water-pattern areas are built from the very ring arrays the water areas
  // carry. A caller that hands us value-equal copies instead still matches, but
  // only then is anything stringified - keying every ring by JSON up front
  // hashed each lake's whole outline twice per generation.
  let polygonsByValue: Map<string, Polygon2D> | undefined;
  let ringsByValue: Map<string, Point2D[]> | undefined;
  const smoothedPolygon = (polygon: Polygon2D): Polygon2D | undefined => {
    if (polygons.has(polygon)) return polygons.get(polygon);
    polygonsByValue ??= new Map([...polygons].map(([original, smoothed]) => [JSON.stringify(original), smoothed]));
    return polygonsByValue.get(JSON.stringify(polygon));
  };
  const smoothedRing = (ring: Point2D[]): Point2D[] | undefined => {
    if (rings.has(ring)) return rings.get(ring);
    ringsByValue ??= new Map([...rings].map(([original, smoothed]) => [JSON.stringify(original), smoothed]));
    return ringsByValue.get(JSON.stringify(ring));
  };
  return {
    ...source,
    waterAreas: source.waterAreas?.map(area => area.kind === "lake" ? { ...area, polygon: smoothedPolygon(area.polygon)! } : area),
    waterPatternAreas: source.waterPatternAreas?.map(polygon => smoothedPolygon(polygon) ?? polygon),
    markings: source.markings.map(marking => {
      const smoothed = marking.kind === "water" ? smoothedRing(marking.points) : undefined;
      return smoothed ? { ...marking, points: smoothed } : marking;
    }),
  };
}
