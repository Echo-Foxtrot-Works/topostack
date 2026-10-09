import { distanceToSegment, pointInPreparedPolygons, pointInRing, preparePolygons, ringBounds, signedArea, somePreparedEdge, type PreparedPolygons } from "../primitives/geometry2d.js";
import { clipPolygons } from "../primitives/offset.js";
import { normalizedPolygons } from "./water-inserts.js";
import type {
  AirspaceColumnIR, AirspacePieceIR, AirspaceRodCutIR, AirspaceRodSettingsV1, AirspaceSeatIR, AirspaceSegmentIR, AirspaceStackIR,
  GeometryWarning, LayerIR, Point2D, Polygon2D, WaterInsertIR,
} from "../types.js";

/**
 * Rods that hold airspace pieces at height (docs/plans/airspace-acrylic.md).
 *
 * Pieces are supported from the bottom up. For each piece the solver looks at
 * points inside it; straight down from a point a rod meets either a lower
 * piece, whose top face is its seat (tiers stack on tiers), or the terrain,
 * where a socket is cut down through the top sheets. A piece takes columns
 * spread by farthest-point choice until its centroid lies inside them and every
 * part of it is within half a span of one. A piece glued flat on the surface
 * right under it needs none. A piece that cannot be held is left out rather
 * than exported floating.
 */

/** Rod surface to a piece's edge. */
const PIECE_EDGE_MM = 2;
/** Material left around a socket in every sheet it is cut through. */
const SOCKET_WALL_MM = 1.5;
/** Rod surface to anything it passes on its way up. */
const PASSING_CLEARANCE_MM = 0.5;
/** Longest unsupported reach of 3 mm acrylic: every point of a piece lies within half of it of a column. */
const MAX_SPAN_MM = 150;
/** Below this a piece is held by two rods (one square rod, which also keeps it from turning). */
const SMALL_PIECE_MM2 = 3_000;
const MAX_COLUMNS_PER_PIECE = 16;
/** A piece lying on the surface under it over this share of its area is glued there instead of held on rods. */
const RESTING_SHARE = 0.25;
const CUT_STEP_MM = 0.5;

interface Placed { piece: AirspacePieceIR; zMm: number; topMm: number; prepared: PreparedPolygons }
interface Candidate { point: Point2D; seat: AirspaceSeatIR; bottomMm: number }

const area = (polygons: Polygon2D[]) => polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((holes, hole) => holes + Math.abs(signedArea(hole)), 0), 0);

/** No edge of `prepared` within `distanceMm` of the point. */
function clearOfEdges(point: Point2D, prepared: PreparedPolygons, distanceMm: number): boolean {
  const bounds = { minX: point.x - distanceMm, minY: point.y - distanceMm, maxX: point.x + distanceMm, maxY: point.y + distanceMm };
  return !somePreparedEdge(prepared, bounds, (start, end) => distanceToSegment(point, start, end) < distanceMm);
}

const outsideBy = (point: Point2D, prepared: PreparedPolygons, distanceMm: number) => !pointInPreparedPolygons(point, prepared) && clearOfEdges(point, prepared, distanceMm);

/** A rod's section at a point, grown by `growMm` on every side. */
export function rodFootprint(point: Point2D, rod: AirspaceRodSettingsV1, growMm = 0): Point2D[] {
  const half = rod.sizeMm / 2 + growMm;
  if (rod.shape === "square") {
    return [{ x: point.x - half, y: point.y - half }, { x: point.x + half, y: point.y - half }, { x: point.x + half, y: point.y + half }, { x: point.x - half, y: point.y + half }, { x: point.x - half, y: point.y - half }];
  }
  const segments = 32;
  const ring = Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: point.x + Math.cos(angle) * half, y: point.y + Math.sin(angle) * half };
  });
  return [...ring, { ...ring[0]! }];
}

function centroid(polygons: Polygon2D[]): Point2D {
  let sum = 0, x = 0, y = 0;
  for (const polygon of polygons) {
    for (const ring of [polygon.outer, ...polygon.holes]) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const a = ring[index]!, b = ring[index + 1]!;
        const cross = a.x * b.y - b.x * a.y;
        sum += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
      }
    }
  }
  return sum ? { x: x / (3 * sum), y: y / (3 * sum) } : polygons[0]!.outer[0]!;
}

function convexHull(points: Point2D[]): Point2D[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point2D, a: Point2D, b: Point2D) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point2D[]) => list.reduce<Point2D[]>((hull, point) => {
    while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, point) <= 0) hull.pop();
    return [...hull, point];
  }, []);
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length ? [...hull, hull[0]!] : [];
}

interface Context {
  stack: AirspaceStackIR;
  layers: LayerIR[];
  preparedLayers: PreparedPolygons[];
  inserts: PreparedPolygons;
  woodMm: number;
  rodRadius: number;
  socketSheets: number;
  placed: Placed[];
}

/** The highest sheet holding the point, or -1. Sheets nest, so the search halves. */
function topSheet(context: Context, point: Point2D): number {
  let low = 0, high = context.layers.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (pointInPreparedPolygons(point, context.preparedLayers[middle]!)) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

/** Where a rod at `point` under a piece at `zMm` stands, or undefined when no rod can stand there. */
function seatAt(context: Context, point: Point2D, zMm: number): Candidate | undefined {
  const { rodRadius, woodMm } = context;
  const below = context.placed.filter((entry) => entry.topMm <= zMm + 1e-6).sort((a, b) => b.topMm - a.topMm);
  const seatPiece = below.find((entry) => pointInPreparedPolygons(point, entry.prepared));
  const bottomMm = seatPiece ? seatPiece.topMm : undefined;
  // Pieces between the seat and the head must keep clear of the rod.
  for (const entry of below) {
    if (entry === seatPiece) break;
    if (!outsideBy(point, entry.prepared, rodRadius + PASSING_CLEARANCE_MM)) return undefined;
  }
  if (seatPiece) {
    if (!clearOfEdges(point, seatPiece.prepared, rodRadius + PIECE_EDGE_MM)) return undefined;
    // Terrain rising beside the rod between the seat and the head.
    const rising = context.layers.findIndex((layer) => (layer.index + 1) * woodMm > bottomMm! + 1e-6);
    if (rising >= 0 && (rising + 1) * woodMm < zMm && !outsideBy(point, context.preparedLayers[rising]!, rodRadius + PASSING_CLEARANCE_MM)) return undefined;
    return { point, seat: { kind: "piece", pieceId: seatPiece.piece.id }, bottomMm: bottomMm! };
  }
  const top = topSheet(context, point);
  if (top < 0 || (top + 1) * woodMm > zMm) return undefined;
  // A socket deeper than the sheets at the point goes through the bottom sheet onto the backing sheet.
  const depth = Math.min(top + 1, context.socketSheets);
  const cut = Array.from({ length: depth }, (_, offset) => top - offset);
  if (!cut.every((index) => clearOfEdges(point, context.preparedLayers[index]!, rodRadius + SOCKET_WALL_MM))) return undefined;
  const next = context.preparedLayers[top + 1];
  if (next && !clearOfEdges(point, next, rodRadius + PASSING_CLEARANCE_MM)) return undefined;
  if (!outsideBy(point, context.inserts, rodRadius + PASSING_CLEARANCE_MM)) return undefined;
  const floor = top - depth;
  return { point, seat: { kind: "terrain", floorLayerIndex: floor, socketLayerIndices: cut.sort((a, b) => a - b) }, bottomMm: Math.max(0, (floor + 1) * woodMm) };
}

/** Points inside a piece far enough from its edge for a rod, on a grid sized to the piece. */
function candidatePoints(piece: AirspacePieceIR, prepared: PreparedPolygons, margin: number): { valid: Point2D[]; samples: Point2D[] } {
  const bounds = ringBounds(piece.polygons.flatMap((polygon) => polygon.outer));
  const step = Math.min(20, Math.max(4, Math.sqrt(area(piece.polygons)) / 12));
  const valid: Point2D[] = [];
  const samples: Point2D[] = [];
  for (let x = bounds.minX + step / 2; x < bounds.maxX; x += step) {
    for (let y = bounds.minY + step / 2; y < bounds.maxY; y += step) {
      const point = { x, y };
      if (!pointInPreparedPolygons(point, prepared)) continue;
      samples.push(point);
      if (clearOfEdges(point, prepared, margin)) valid.push(point);
    }
  }
  // The outline itself must be within reach too.
  for (const polygon of piece.polygons) {
    polygon.outer.forEach((point, index) => { if (index % 4 === 0) samples.push(point); });
  }
  return { valid, samples };
}

/** Columns for one piece by farthest-point choice, or undefined when it cannot be held. */
function chooseColumns(piece: AirspacePieceIR, candidates: Candidate[], samples: Point2D[], rod: AirspaceRodSettingsV1): Candidate[] | undefined {
  if (!candidates.length) return undefined;
  const pieceArea = area(piece.polygons);
  const required = pieceArea < SMALL_PIECE_MM2 ? (rod.shape === "square" ? 1 : 2) : 3;
  const middle = centroid(piece.polygons);
  const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
  const chosen: Candidate[] = [candidates.reduce((far, candidate) => (distance(candidate.point, middle) > distance(far.point, middle) ? candidate : far))];
  const reach = MAX_SPAN_MM / 2;
  const stable = () => {
    if (chosen.length < required) return false;
    if (required >= 3) {
      const hull = convexHull(chosen.map((candidate) => candidate.point));
      if (hull.length < 4 || !pointInRing(middle, hull)) return false;
    }
    return samples.every((sample) => chosen.some((candidate) => distance(candidate.point, sample) <= reach));
  };
  while (!stable() && chosen.length < MAX_COLUMNS_PER_PIECE) {
    let best: Candidate | undefined;
    let bestDistance = 0;
    for (const candidate of candidates) {
      const nearest = Math.min(...chosen.map((entry) => distance(entry.point, candidate.point)));
      if (nearest > bestDistance) { bestDistance = nearest; best = candidate; }
    }
    if (!best || bestDistance < rod.sizeMm * 2) break;
    chosen.push(best);
  }
  if (chosen.length < required) return undefined;
  if (required >= 3) {
    const hull = convexHull(chosen.map((candidate) => candidate.point));
    if (hull.length < 4 || !pointInRing(middle, hull)) return undefined;
  }
  // Reach is met as far as the column limit allows; a very large piece is held by the most rods it may have.
  return chosen;
}

/** True when the piece lies glued on the surface right under it over enough of its area: a lower piece's top, or a sheet's. */
function resting(context: Context, piece: AirspacePieceIR, zMm: number): boolean {
  const pieceArea = area(piece.polygons);
  const under = context.placed.filter((entry) => Math.abs(entry.topMm - zMm) < 1e-6).flatMap((entry) => entry.piece.polygons);
  const sheet = context.layers.findIndex((layer) => Math.abs((layer.index + 1) * context.woodMm - zMm) < 1e-6);
  const surface = sheet >= 0 ? clipPolygons(context.layers[sheet]!.polygons, context.layers[sheet + 1]?.polygons ?? [], "difference") : [];
  const contact = [...under, ...surface];
  return contact.length > 0 && area(clipPolygons(piece.polygons, contact, "intersection")) >= RESTING_SHARE * pieceArea;
}

/**
 * Hold every piece of the stack on rods, cut the sockets into the terrain
 * sheets, engrave locators and list the rods to cut. Pieces that cannot be held
 * are removed. Runs before the work-area split and the material nests, which
 * then treat each socket as an ordinary hole.
 */
export function placeAirspaceSupports(stack: AirspaceStackIR, layers: LayerIR[], inserts: WaterInsertIR[], woodMm: number, minimumFeatureMm: number, warnings: GeometryWarning[]): void {
  const rod = stack.rod;
  const context: Context = {
    stack, layers, woodMm,
    preparedLayers: layers.map((layer) => preparePolygons(layer.polygons)),
    inserts: preparePolygons(inserts.flatMap((insert) => insert.polygons)),
    // A square rod's corners reach half its diagonal.
    rodRadius: rod.shape === "square" ? (rod.sizeMm / 2) * Math.SQRT2 : rod.sizeMm / 2,
    socketSheets: Math.max(1, Math.round(rod.socketDepthMm / woodMm)),
    placed: [],
  };
  const standing: Standing[] = [];
  const unsupported: string[] = [];
  for (const level of [...stack.levels].sort((a, b) => a.zMm - b.zMm)) {
    level.pieces = level.pieces.filter((piece) => {
      const prepared = preparePolygons(piece.polygons);
      const placed: Placed = { piece, zMm: level.zMm, topMm: level.zMm + stack.thicknessMm, prepared };
      if (resting(context, piece, level.zMm)) {
        piece.resting = true;
        context.placed.push(placed);
        return true;
      }
      const { valid, samples } = candidatePoints(piece, prepared, context.rodRadius + PIECE_EDGE_MM);
      const candidates = valid.flatMap((point) => seatAt(context, point, level.zMm) ?? []);
      const columns = chooseColumns(piece, candidates, samples, rod);
      if (!columns) {
        unsupported.push(piece.id);
        return false;
      }
      for (const column of columns) standing.push({ ...column, headPieceId: piece.id, topMm: level.zMm });
      context.placed.push(placed);
      return true;
    });
  }
  stack.levels = stack.levels.filter((level) => level.pieces.length);
  if (unsupported.length) warnings.push({
    code: "AIRSPACE_PIECE_UNSUPPORTED",
    message: `${unsupported.length} airspace ${unsupported.length === 1 ? "piece was" : "pieces were"} left out because no rod could hold ${unsupported.length === 1 ? "it" : "them"} clear of the terrain and the pieces below. A thinner rod helps.`,
  });
  stack.columns = buildColumns(standing);
  stack.backingSheet = standing.some((entry) => entry.seat.kind === "terrain" && entry.seat.floorLayerIndex < 0);
  stack.cutList = cutList(stack.columns);
  cutSockets(stack.columns, layers, rod, minimumFeatureMm);
  engraveLocators(stack, rod);
}

interface Standing extends Candidate { headPieceId: string; topMm: number }

/** Segments at one point form a column, bottom to top; columns are numbered north-west first. */
function buildColumns(standing: Standing[]): AirspaceColumnIR[] {
  const byPoint = new Map<string, Standing[]>();
  for (const entry of standing) {
    const key = `${entry.point.x.toFixed(3)},${entry.point.y.toFixed(3)}`;
    byPoint.set(key, [...(byPoint.get(key) ?? []), entry]);
  }
  return [...byPoint.values()]
    .sort((a, b) => a[0]!.point.y - b[0]!.point.y || a[0]!.point.x - b[0]!.point.x)
    .map((entries, index): AirspaceColumnIR => {
      const id = `C${index + 1}`;
      return {
        id,
        point: entries[0]!.point,
        segments: entries.sort((a, b) => a.bottomMm - b.bottomMm).map((entry, position): AirspaceSegmentIR => ({
          id: `${id}.${position + 1}`,
          seat: entry.seat,
          headPieceId: entry.headPieceId,
          bottomMm: entry.bottomMm,
          topMm: entry.topMm,
          lengthMm: Math.round((entry.topMm - entry.bottomMm) / CUT_STEP_MM) * CUT_STEP_MM,
          rodId: "",
        })),
      };
    });
}

/** One line per length, longest first, and each segment told which line it is cut as. */
function cutList(columns: AirspaceColumnIR[]): AirspaceRodCutIR[] {
  const segments = columns.flatMap((column) => column.segments);
  const lengths = [...new Set(segments.map((segment) => segment.lengthMm))].sort((a, b) => b - a);
  return lengths.map((lengthMm, index) => {
    const id = `R${index + 1}`;
    const matching = segments.filter((segment) => segment.lengthMm === lengthMm);
    for (const segment of matching) segment.rodId = id;
    return { id, lengthMm, count: matching.length };
  });
}

/** Each terrain seat's socket, cut through its sheets with the rod's fit clearance; one boolean per sheet. */
function cutSockets(columns: AirspaceColumnIR[], layers: LayerIR[], rod: AirspaceRodSettingsV1, minimumFeatureMm: number): void {
  const holes = new Map<number, Polygon2D[]>();
  for (const column of columns) for (const segment of column.segments) {
    if (segment.seat.kind !== "terrain") continue;
    for (const index of segment.seat.socketLayerIndices) {
      holes.set(index, [...(holes.get(index) ?? []), { outer: rodFootprint(column.point, rod, rod.fitClearanceMm), holes: [] }]);
    }
  }
  for (const [index, footprints] of holes) {
    const layer = layers.find((entry) => entry.index === index);
    if (layer) layer.polygons = normalizedPolygons(clipPolygons(layer.polygons, footprints, "difference"), minimumFeatureMm);
  }
}

/** A rod's outline on the top face of every piece a segment stands on or holds; on clear acrylic the mark shows through to the underside. */
function engraveLocators(stack: AirspaceStackIR, rod: AirspaceRodSettingsV1): void {
  const pieces = new Map(stack.levels.flatMap((level) => level.pieces.map((piece) => [piece.id, piece] as const)));
  const add = (pieceId: string, point: Point2D) => {
    const piece = pieces.get(pieceId);
    if (piece) piece.locators = [...(piece.locators ?? []), rodFootprint(point, rod)];
  };
  for (const column of stack.columns) for (const segment of column.segments) {
    add(segment.headPieceId, column.point);
    if (segment.seat.kind === "piece") add(segment.seat.pieceId, column.point);
  }
}
