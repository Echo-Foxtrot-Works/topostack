import { clipPolyline, polylineLength, type PreparedPolygons } from "../primitives/geometry2d.js";
import { isBitmapFont, missingGlyphs } from "../annotate/font-data.js";
import type { MarkingFeature, Point2D, ProjectConfigV1, TextFont, TransportationClass } from "../types.js";


function offsetPolyline(points: Point2D[], distanceMm: number): Point2D[] {
  // A zero-length leg has no direction, and a {0, 0} normal averaged in cancels
  // a real neighbour out: three identical consecutive points used to collapse
  // the offset back onto the centerline. Drop them before taking normals.
  const path = points.filter((point, index) => index === 0 ||
    Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > 1e-9);
  if (path.length < 2) return [];
  // A road drawn as a closed loop has to join at its seam. Treated as open, the
  // shared endpoint takes a single segment's normal instead of the average of
  // the two meeting there, which notches the outline where the ends meet.
  const closed = path.length > 3 && Math.hypot(path.at(-1)!.x - path[0]!.x, path.at(-1)!.y - path[0]!.y) <= 1e-9;
  // The closing copy is the first point again, so the loop's own vertices are
  // the path without it, and its last segment wraps around to index 0.
  const vertices = closed ? path.slice(0, -1) : path;
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  const segmentNormals = Array.from({ length: segmentCount }, (_, index) => {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    return { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  });
  const offset = vertices.map((point, index) => {
    // An open path's endpoints keep their one segment's normal; a loop's seam
    // averages the segments on either side of it like any other vertex.
    const previous = segmentNormals[closed ? (index + segmentCount - 1) % segmentCount : Math.max(0, index - 1)]!;
    const next = segmentNormals[closed ? index : Math.min(segmentCount - 1, index)]!;
    const sum = { x: previous.x + next.x, y: previous.y + next.y };
    const length = Math.hypot(sum.x, sum.y);
    const normal = length > 1e-6 ? { x: sum.x / length, y: sum.y / length } : next;
    const dot = Math.max(0.5, Math.abs(normal.x * next.x + normal.y * next.y));
    const miter = Math.min(Math.abs(distanceMm) / dot, Math.abs(distanceMm) * 2) * Math.sign(distanceMm || 1);
    return { x: point.x + normal.x * miter, y: point.y + normal.y * miter };
  });
  return closed ? [...offset, { ...offset[0]! }] : offset;
}

/** Unclipped outline paths for a feature drawn as an outlined major road; undefined when it is drawn as its centerline. */
export function transportationOutlines(points: Point2D[], transportationClass: TransportationClass, config: ProjectConfigV1): Point2D[][] | undefined {
  if (transportationClass !== "major-road" || config.lineStyle.roadStyle !== "outlined") return undefined;
  const offsetMm = config.lineStyle.majorRoadSpacingMm / 2;
  return [offsetPolyline(points, -offsetMm), offsetPolyline(points, offsetMm)];
}

/** `centerline` is the already-clipped source path, reused whenever the style draws it as-is. */
export function styledTransportationPaths(outlines: Point2D[][] | undefined, centerline: Point2D[][], polygons: PreparedPolygons, excludedPolygons?: PreparedPolygons): Point2D[][] {
  return outlines ? outlines.flatMap((outline) => clipPolyline(outline, polygons, excludedPolygons)) : centerline;
}

/**
 * A road name as it engraves. The built-in fonts get plain capitals; a
 * typeface keeps the name's case and accents and drops only what it cannot draw.
 */
export function fabricationLabel(value: string, font: TextFont = "technical"): string | undefined {
  const normalized = isBitmapFont(font)
    ? value.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9 .:/_+·-]/g, " ")
    : withoutMissingGlyphs(value.normalize("NFC"), font);
  return normalized.replace(/\s+/g, " ").trim().slice(0, 48) || undefined;
}

function withoutMissingGlyphs(value: string, font: TextFont): string {
  const missing = new Set(missingGlyphs(value, font));
  return [...value].map((character) => (missing.has(character) ? " " : character)).join("");
}


export function longestPath(paths: Point2D[][]): number {
  let longest = Number.NEGATIVE_INFINITY;
  for (const path of paths) longest = Math.max(longest, polylineLength(path));
  return longest;
}

interface TransportationJunction { point: Point2D; arms: number; hasMajorRoad: boolean }

export function transportationJunctions(features: MarkingFeature[]): TransportationJunction[] {
  const junctions = new Map<string, TransportationJunction>();
  for (const feature of features) {
    const transportationClass = feature.transportationClass ?? (feature.kind === "road" ? "local-road" : undefined);
    if (!transportationClass || transportationClass === "trail" || feature.points.length < 2) continue;
    // One road contributes at most one arm per place. Vector tiles quantize
    // coordinates, so a doubled vertex - or a loop returning to its own seam -
    // would otherwise reach three arms by itself and engrave a junction ring
    // where no roads cross.
    const counted = new Set<string>();
    feature.points.forEach((point, index) => {
      const key = `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;
      if (counted.has(key)) return;
      counted.add(key);
      const current = junctions.get(key) ?? { point, arms: 0, hasMajorRoad: false };
      current.arms += index === 0 || index === feature.points.length - 1 ? 1 : 2;
      current.hasMajorRoad ||= transportationClass === "major-road";
      junctions.set(key, current);
    });
  }
  return [...junctions.values()].filter((junction) => junction.arms >= 3 && junction.hasMajorRoad)
    .sort((left, right) => left.point.y - right.point.y || left.point.x - right.point.x);
}

export function junctionRing(center: Point2D, radiusMm: number): Point2D[] {
  const points = Array.from({ length: 20 }, (_, index) => {
    const angle = index / 20 * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radiusMm, y: center.y + Math.sin(angle) * radiusMm };
  });
  return [...points, { ...points[0]! }];
}
