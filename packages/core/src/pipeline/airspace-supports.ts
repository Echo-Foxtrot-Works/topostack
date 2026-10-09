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
/** Through rods sit on one grid for every piece, so a rod can rise through one piece to hold the next. */
const THROUGH_GRID_MM = 8;

interface Placed { piece: AirspacePieceIR; zMm: number; topMm: number; prepared: PreparedPolygons }
interface Candidate {
  point: Point2D;
  seat: AirspaceSeatIR;
  bottomMm: number;
  /** Through: the rod already standing here, which this piece would extend. */
  rod?: ThroughRod;
  /** Through: every lower piece the rod passes, lowest first. */
  passes?: string[];
}
/** The `through` joint: one rod per column, from its socket to the highest piece it holds. */
interface ThroughRod { point: Point2D; seat: AirspaceSeatIR; bottomMm: number; topMm: number; headPieceId: string; throughPieceIds: string[] }

const pointKey = (point: Point2D) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`;

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
  /** The `through` joint's rods by point; undefined with glued segments. */
  rods?: Map<string, ThroughRod>;
  /** Through: points where a glued segment stands on a piece, which no through rod may pass. */
  segmentPoints: Map<string, Point2D>;
  /** Through: how close two rods at different points may stand. */
  rodSpacingMm: number;
}

/** Through: a point too close to a rod or segment already standing at another point. */
function crowded(context: Context, point: Point2D): boolean {
  const key = pointKey(point);
  const near = (other: Point2D) => Math.hypot(other.x - point.x, other.y - point.y) < context.rodSpacingMm - 1e-6;
  for (const [otherKey, rod] of context.rods ?? []) if (otherKey !== key && near(rod.point)) return true;
  for (const [otherKey, other] of context.segmentPoints) if (otherKey !== key && near(other)) return true;
  return false;
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

/**
 * Where a rod at `point` under a piece at `zMm` stands, or undefined when no
 * rod can stand there. `terrainOnly` skips the pieces below, for a through rod
 * that has already checked them.
 */
function seatAt(context: Context, point: Point2D, zMm: number, terrainOnly = false): Candidate | undefined {
  const { rodRadius, woodMm } = context;
  const below = terrainOnly ? [] : context.placed.filter((entry) => entry.topMm <= zMm + 1e-6).sort((a, b) => b.topMm - a.topMm);
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

/**
 * The `through` joint: a rod at `point` rising from the terrain to a piece at
 * `zMm`, passing through lower pieces well inside them (each gets a hole) and
 * clear of every other piece. An existing rod at the point is extended.
 */
function throughAt(context: Context, point: Point2D, zMm: number): Candidate | undefined {
  const { rodRadius } = context;
  const passes: Array<{ id: string; zMm: number }> = [];
  for (const entry of context.placed) {
    if (entry.topMm > zMm + 1e-6) continue;
    const inside = pointInPreparedPolygons(point, entry.prepared);
    if (inside ? !clearOfEdges(point, entry.prepared, rodRadius + PIECE_EDGE_MM) : !clearOfEdges(point, entry.prepared, rodRadius + PASSING_CLEARANCE_MM)) return undefined;
    if (inside) passes.push({ id: entry.piece.id, zMm: entry.zMm });
  }
  const ordered = passes.sort((a, b) => a.zMm - b.zMm).map((entry) => entry.id);
  if (context.segmentPoints.has(pointKey(point))) return undefined;
  const rod = context.rods!.get(pointKey(point));
  if (rod) return rod.topMm <= zMm ? { point, seat: rod.seat, bottomMm: rod.bottomMm, rod, passes: ordered } : undefined;
  const fromTerrain = seatAt(context, point, zMm, true);
  return fromTerrain && { ...fromTerrain, passes: ordered };
}

/** Points inside a piece far enough from its edge for a rod, on a grid sized to the piece. */
function candidatePoints(piece: AirspacePieceIR, prepared: PreparedPolygons, margin: number, gridMm?: number): { valid: Point2D[]; samples: Point2D[] } {
  const bounds = ringBounds(piece.polygons.flatMap((polygon) => polygon.outer));
  const step = gridMm ?? Math.min(20, Math.max(4, Math.sqrt(area(piece.polygons)) / 12));
  // A shared grid lines up across pieces; otherwise the grid is sized to the piece.
  const startX = gridMm ? Math.ceil(bounds.minX / gridMm) * gridMm : bounds.minX + step / 2;
  const startY = gridMm ? Math.ceil(bounds.minY / gridMm) * gridMm : bounds.minY + step / 2;
  const valid: Point2D[] = [];
  const samples: Point2D[] = [];
  for (let x = startX; x < bounds.maxX; x += step) {
    for (let y = startY; y < bounds.maxY; y += step) {
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
  // An existing through rod is worth a little more distance than a new one: extending it saves a rod.
  const weight = (candidate: Candidate) => (candidate.rod ? 1.5 : 1);
  const chosen: Candidate[] = [candidates.reduce((far, candidate) => (distance(candidate.point, middle) * weight(candidate) > distance(far.point, middle) * weight(far) ? candidate : far))];
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
      if (nearest >= rod.sizeMm * 2 && nearest * weight(candidate) > bestDistance) { bestDistance = nearest * weight(candidate); best = candidate; }
    }
    if (!best) break;
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
    ...(rod.joint === "through" ? { rods: new Map<string, ThroughRod>() } : {}),
    segmentPoints: new Map(),
    rodSpacingMm: Math.max(THROUGH_GRID_MM, rod.sizeMm * 2),
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
      const through = context.rods;
      const margin = context.rodRadius + PIECE_EDGE_MM;
      const { valid, samples } = candidatePoints(piece, prepared, margin, through ? context.rodSpacingMm : undefined);
      let columns = chooseColumns(piece, valid.flatMap((point) => (through ? (crowded(context, point) ? undefined : throughAt(context, point, level.zMm)) : seatAt(context, point, level.zMm)) ?? []), samples, rod);
      let segmented = false;
      if (through && !columns) {
        // Off the shared grid, the piece's own finer grid finds room the shared one misses (a small
        // piece, rugged ground). Failing a through rod there, it stands on glued segments, clear of
        // every through rod, rather than being left out.
        const fine = candidatePoints(piece, prepared, margin).valid.filter((point) => !crowded(context, point));
        columns = chooseColumns(piece, fine.flatMap((point) => throughAt(context, point, level.zMm) ?? []), samples, rod);
        segmented = !columns;
        if (segmented) columns = chooseColumns(piece, [...valid, ...fine].filter((point) => !through.has(pointKey(point)) && !crowded(context, point)).flatMap((point) => seatAt(context, point, level.zMm) ?? []), samples, rod);
      }
      if (!columns) {
        unsupported.push(piece.id);
        return false;
      }
      for (const column of columns) {
        if (!through || segmented) {
          standing.push({ ...column, headPieceId: piece.id, topMm: level.zMm });
          context.segmentPoints.set(pointKey(column.point), column.point);
          continue;
        }
        if (column.rod) {
          // The rod rises on through the piece it held, which now hangs on it at its own height.
          column.rod.throughPieceIds = column.passes ?? [];
          column.rod.headPieceId = piece.id;
          column.rod.topMm = level.zMm;
        } else {
          through.set(pointKey(column.point), { point: column.point, seat: column.seat, bottomMm: column.bottomMm, topMm: level.zMm, headPieceId: piece.id, throughPieceIds: column.passes ?? [] });
        }
      }
      context.placed.push(placed);
      return true;
    });
  }
  stack.levels = stack.levels.filter((level) => level.pieces.length);
  if (unsupported.length) warnings.push({
    code: "AIRSPACE_PIECE_UNSUPPORTED",
    message: `${unsupported.length} airspace ${unsupported.length === 1 ? "piece was" : "pieces were"} left out because no rod could hold ${unsupported.length === 1 ? "it" : "them"} clear of the terrain and the pieces below. A thinner rod helps.`,
  });
  if (context.rods) {
    for (const entry of context.rods.values()) standing.push({ point: entry.point, seat: entry.seat, bottomMm: entry.bottomMm, headPieceId: entry.headPieceId, topMm: entry.topMm, ...(entry.throughPieceIds.length ? { throughPieceIds: entry.throughPieceIds } : {}) });
    cutRodHoles(stack, context.rods, rod, minimumFeatureMm);
  }
  stack.columns = buildColumns(standing);
  stack.backingSheet = standing.some((entry) => entry.seat.kind === "terrain" && entry.seat.floorLayerIndex < 0);
  stack.cutList = cutList(stack.columns);
  cutSockets(stack.columns, layers, rod, minimumFeatureMm);
  engraveLocators(stack, rod);
}

interface Standing extends Candidate { headPieceId: string; topMm: number; throughPieceIds?: string[] }

/** A hole, the rod's size plus its fit clearance, in every piece a through rod passes; frost stops at it too. */
function cutRodHoles(stack: AirspaceStackIR, rods: Map<string, ThroughRod>, rod: AirspaceRodSettingsV1, minimumFeatureMm: number): void {
  const holes = new Map<string, Polygon2D[]>();
  for (const entry of rods.values()) for (const id of entry.throughPieceIds) {
    holes.set(id, [...(holes.get(id) ?? []), { outer: rodFootprint(entry.point, rod, rod.fitClearanceMm), holes: [] }]);
  }
  for (const level of stack.levels) for (const piece of level.pieces) {
    const cut = holes.get(piece.id);
    if (!cut) continue;
    piece.polygons = normalizedPolygons(clipPolygons(piece.polygons, cut, "difference"), minimumFeatureMm);
    if (piece.frost) piece.frost = normalizedPolygons(clipPolygons(piece.frost, cut, "difference"), minimumFeatureMm);
  }
}

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
          ...(entry.throughPieceIds ? { throughPieceIds: entry.throughPieceIds } : {}),
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
