import { describe, expect, it } from "vitest";
import type { AirspacePieceIR, AirspaceStackIR, GeometryIRV1, LayerIR, Point2D } from "../types.js";
import { DEFAULT_AIRSPACE_STACK } from "./airspace-stack.js";
import { placeAirspaceSupports, rodFootprint } from "./airspace-supports.js";
import { hiddenMarkIssues } from "./hidden-marks.js";
import { pointInRing } from "../primitives/geometry2d.js";
import { build, core, inside, shelf, square, t, tower } from "../test-support/airspace.js";

const pieces = (stack: AirspaceStackIR) => new Map(stack.levels.flatMap((level) => level.pieces.map((piece) => [piece.id, { piece, zMm: level.zMm }] as const)));

function convexContains(points: Point2D[], target: Point2D): boolean {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point2D, a: Point2D, b: Point2D) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point2D[]) => list.reduce<Point2D[]>((hull, point) => {
    while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, point) <= 0) hull.pop();
    return [...hull, point];
  }, []);
  const hull = [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
  return hull.length >= 3 && pointInRing(target, [...hull, hull[0]!]);
}

function checkSupports(result: GeometryIRV1): void {
  const stack = result.airspaceStack!;
  const byId = pieces(stack);
  const segments = stack.columns.flatMap((column) => column.segments.map((segment) => ({ column, segment })));
  // Every piece is held, by rods or by lying glued on what is under it.
  for (const { piece } of byId.values()) {
    const held = segments.filter(({ segment }) => segment.headPieceId === piece.id);
    expect(piece.resting || held.length > 0, piece.id).toBe(true);
    if (held.length >= 3) expect(convexContains(held.map(({ column }) => column.point), centre(piece)), piece.id).toBe(true);
    expect(piece.locators?.length ?? 0).toBeGreaterThanOrEqual(held.length);
  }
  for (const { column, segment } of segments) {
    const head = byId.get(segment.headPieceId)!;
    expect(segment.topMm).toBeCloseTo(head.zMm, 9);
    expect(inside(column.point, head.piece.polygons)).toBe(true);
    expect(segment.lengthMm).toBe(Math.round((segment.topMm - segment.bottomMm) * 2) / 2);
    // Nothing between the seat and the head stands where the rod passes.
    for (const { piece, zMm } of byId.values()) {
      if (zMm + stack.thicknessMm > segment.bottomMm + 1e-6 && zMm < segment.topMm - 1e-6) expect(inside(column.point, piece.polygons), `${segment.id} through ${piece.id}`).toBe(false);
    }
    if (segment.seat.kind === "piece") {
      const seat = byId.get(segment.seat.pieceId)!;
      expect(inside(column.point, seat.piece.polygons)).toBe(true);
      expect(segment.bottomMm).toBeCloseTo(seat.zMm + stack.thicknessMm, 9);
    } else {
      // The socket is open in every sheet it is cut through, and the rod stands on the sheet below it.
      for (const index of segment.seat.socketLayerIndices) expect(inside(column.point, result.layers[index]!.polygons), `${segment.id} socket in ${index}`).toBe(false);
      if (segment.seat.floorLayerIndex >= 0) expect(inside(column.point, result.layers[segment.seat.floorLayerIndex]!.polygons)).toBe(true);
      else expect(stack.backingSheet).toBe(true);
      expect(segment.bottomMm).toBeCloseTo(Math.max(0, (segment.seat.floorLayerIndex + 1) * t), 9);
    }
  }
  // The cut list accounts for every segment, longest first.
  expect(stack.cutList.reduce((sum, rod) => sum + rod.count, 0)).toBe(segments.length);
  expect(stack.cutList.map((rod) => rod.lengthMm)).toEqual([...stack.cutList.map((rod) => rod.lengthMm)].sort((a, b) => b - a));
  expect(segments.every(({ segment }) => stack.cutList.some((rod) => rod.id === segment.rodId && rod.lengthMm === segment.lengthMm))).toBe(true);
}

function centre(piece: AirspacePieceIR): Point2D {
  const ring = piece.polygons[0]!.outer;
  let area = 0, x = 0, y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = ring[index]!, b = ring[index + 1]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}

describe("airspace supports in a generated stack", () => {
  it.each(["plates", "tiers"] as const)("holds every %s piece on rods that stand clear of everything they pass", (form) => {
    const result = build({ form, classes: { ...DEFAULT_AIRSPACE_STACK.classes, D: true } }, [core, shelf, tower]);
    expect(result.airspaceStack!.columns.length).toBeGreaterThan(0);
    checkSupports(result);
  });

  it("stands tiers on the tiers below where it can", () => {
    const stack = build({ form: "tiers" }, [core, shelf]).airspaceStack!;
    const seats = stack.columns.flatMap((column) => column.segments.map((segment) => segment.seat.kind));
    expect(seats).toContain("piece");
    expect(seats).toContain("terrain");
  });

  it("glues volume sheets on the sheet below and holds only the floating ones on rods", () => {
    const result = build({ form: "volumes" }, [shelf]);
    const stack = result.airspaceStack!;
    const lowest = stack.levels[0]!;
    expect(lowest.pieces.every((piece) => !piece.resting)).toBe(true);
    expect(stack.levels.slice(1).every((level) => level.pieces.every((piece) => piece.resting))).toBe(true);
    expect(new Set(stack.columns.flatMap((column) => column.segments.map((segment) => segment.headPieceId)))).toEqual(new Set(lowest.pieces.map((piece) => piece.id)));
    checkSupports(result);
  });

  it("goes through the bottom sheet onto a backing sheet over ground at the land minimum", () => {
    const stack = build({ form: "plates" }, [core, shelf]).airspaceStack!;
    expect(stack.backingSheet).toBe(true);
    expect(stack.columns.some((column) => column.segments.some((segment) => segment.seat.kind === "terrain" && segment.seat.floorLayerIndex === -1))).toBe(true);
  });

  it("keeps the assembly marks hidden with sockets in the sheets", () => {
    const result = build({ form: "tiers" }, [core, shelf], { showAlignmentGuides: true, showAssemblyLabels: true });
    expect(result.airspaceStack!.columns.length).toBeGreaterThan(0);
    expect(hiddenMarkIssues(result)).toEqual([]);
  });

  it("cuts square sockets for square rods and fits them with the clearance", () => {
    const rod = { ...DEFAULT_AIRSPACE_STACK.rod, shape: "square" as const, sizeMm: 5, fitClearanceMm: 0.2 };
    const footprint = rodFootprint({ x: 0, y: 0 }, rod, rod.fitClearanceMm);
    expect(Math.max(...footprint.map((point) => point.x))).toBeCloseTo(2.7, 9);
    const result = build({ form: "plates", rod }, [core, shelf]);
    checkSupports(result);
  });
});

describe("airspace supports on their own", () => {
  const sheet = (index: number, outer: Point2D[]): LayerIR => ({ id: `layer-${index}`, index, elevationM: index * 50, materialThicknessMm: 3, polygons: [{ outer, holes: [] }], markings: [], pieces: [] });
  const plate = (id: string, outer: Point2D[]): AirspacePieceIR => ({ id, tint: "clear", polygons: [{ outer, holes: [] }], sectorIds: [id] });
  const stack = (piece: AirspacePieceIR, zMm = 30): AirspaceStackIR => ({
    form: "plates", thicknessMm: 3, kerfMm: 0.1, ceilingCapFt: 10_000, mmPerMeter: 0.06, topMm: zMm + 3,
    levels: [{ index: 0, altitudeFt: 5_000, mergedFt: [], zMm, pieces: [piece] }], rod: { ...DEFAULT_AIRSPACE_STACK.rod }, columns: [], cutList: [], backingSheet: false,
  });

  it("keeps rods out of acrylic water inserts", () => {
    const layers = [sheet(0, square(-100, -100, 100, 100)), sheet(1, square(-100, -100, 100, 100)), sheet(2, square(-100, -100, 100, 100))];
    const lake = { id: "W1", lakeKey: "lake", surfaceId: "lake", layerIndex: 2, polygons: [{ outer: square(-60, -60, 60, 60), holes: [] }], markings: [] };
    const result = stack(plate("A1-1", square(-80, -80, 80, 80)));
    placeAirspaceSupports(result, layers, [lake], 3, 0.8, []);
    expect(result.columns.length).toBeGreaterThan(0);
    for (const column of result.columns) expect(inside(column.point, lake.polygons)).toBe(false);
  });

  it("leaves out a piece too narrow for a rod, and says so", () => {
    const layers = [sheet(0, square(-100, -100, 100, 100)), sheet(1, square(-100, -100, 100, 100))];
    const warnings: GeometryIRV1["warnings"] = [];
    const result = stack(plate("A1-1", square(-80, -2, 80, 2)));
    placeAirspaceSupports(result, layers, [], 3, 0.8, warnings);
    expect(result.levels).toHaveLength(0);
    expect(warnings.map((warning) => warning.code)).toEqual(["AIRSPACE_PIECE_UNSUPPORTED"]);
  });
});
