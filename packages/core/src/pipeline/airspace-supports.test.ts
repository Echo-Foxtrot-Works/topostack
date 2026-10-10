import { describe, expect, it } from "vitest";
import type { AirspacePieceIR, AirspaceStackIR, GeometryIRV1, LayerIR, Point2D } from "../types.js";
import { DEFAULT_AIRSPACE_STACK } from "./airspace-settings.js";
import { placeAirspaceSupports, rodFootprint } from "./airspace-supports.js";
import { hiddenMarkIssues } from "./hidden-marks.js";
import { pointInRing } from "../primitives/geometry2d.js";
import { build, cap, core, inside, shelf, square, stem, t, tower } from "../test-support/airspace.js";

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
    // A rod holds a piece by ending under it, or (through rods) by passing through it, glued.
    const ending = segments.filter(({ segment }) => segment.headPieceId === piece.id);
    const held = segments.filter(({ segment }) => segment.headPieceId === piece.id || segment.throughPieceIds?.includes(piece.id));
    expect(piece.resting || held.length > 0, piece.id).toBe(true);
    if (held.length >= 3) expect(convexContains(held.map(({ column }) => column.point), centre(piece)), piece.id).toBe(true);
    expect(piece.locators?.length ?? 0).toBeGreaterThanOrEqual(ending.length);
  }
  for (const { column, segment } of segments) {
    const head = byId.get(segment.headPieceId)!;
    expect(segment.topMm).toBeCloseTo(head.zMm, 9);
    expect(inside(column.point, head.piece.polygons)).toBe(true);
    expect(segment.lengthMm).toBe(Math.round((segment.topMm - segment.bottomMm) * 2) / 2);
    // Nothing between the seat and the head stands where the rod passes: a piece it goes through has a hole there.
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

  it("stands rods under the sheets that widen a floating volume past the rods under its base", () => {
    const result = build({ form: "volumes" }, [stem, cap]);
    const stack = result.airspaceStack!;
    checkSupports(result);
    const resting = new Set(stack.levels.flatMap((level) => level.pieces.filter((piece) => piece.resting).map((piece) => piece.id)));
    const under = stack.columns.filter((column) => column.segments.some((segment) => resting.has(segment.headPieceId)));
    expect(under.length).toBeGreaterThan(0);
    expect(under.every((column) => column.point.y > -10)).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).not.toContain("AIRSPACE_OVERHANG");
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

describe("through rods", () => {
  const throughRod = { ...DEFAULT_AIRSPACE_STACK.rod, joint: "through" as const };

  it.each(["tiers", "plates"] as const)("runs one %s rod per column from the terrain through every piece it passes", (form) => {
    const result = build({ form, rod: throughRod }, [core, shelf]);
    const stack = result.airspaceStack!;
    const byId = pieces(stack);
    checkSupports(result);
    expect(stack.columns.length).toBeGreaterThan(0);
    for (const column of stack.columns) {
      expect(column.segments).toHaveLength(1);
      const [rod] = column.segments;
      expect(rod!.seat.kind).toBe("terrain");
      const passed = new Set(rod!.throughPieceIds ?? []);
      for (const id of passed) {
        const { piece, zMm } = byId.get(id)!;
        expect(zMm).toBeGreaterThan(rod!.bottomMm);
        expect(zMm).toBeLessThan(rod!.topMm);
        // A hole for the rod, inside the piece's outline.
        expect(inside(column.point, piece.polygons)).toBe(false);
        expect(inside(column.point, piece.polygons.map((polygon) => ({ outer: polygon.outer, holes: [] })))).toBe(true);
      }
      // Every other piece the rod rises past keeps clear of it.
      for (const { piece, zMm } of byId.values()) {
        if (passed.has(piece.id) || piece.id === rod!.headPieceId || zMm >= rod!.topMm || zMm + stack.thicknessMm <= rod!.bottomMm) continue;
        expect(inside(column.point, piece.polygons.map((polygon) => ({ outer: polygon.outer, holes: [] }))), `${column.id} past ${piece.id}`).toBe(false);
      }
    }
    expect(stack.cutList.reduce((sum, rod) => sum + rod.count, 0)).toBe(stack.columns.length);
  });

  it("rises through a lower piece to hold the next rather than standing a new rod", () => {
    const stack = build({ form: "tiers", rod: throughRod }, [core, shelf]).airspaceStack!;
    expect(stack.columns.some((column) => (column.segments[0]!.throughPieceIds ?? []).length > 0)).toBe(true);
    const segmented = build({ form: "tiers" }, [core, shelf]).airspaceStack!;
    expect(stack.columns.length).toBeLessThan(segmented.columns.flatMap((column) => column.segments).length);
  });
});

describe("airspace supports on their own", () => {
  const sheet = (index: number, outer: Point2D[]): LayerIR => ({ id: `layer-${index}`, index, elevationM: index * 50, materialThicknessMm: 3, polygons: [{ outer, holes: [] }], markings: [], pieces: [] });
  const plate = (id: string, outer: Point2D[]): AirspacePieceIR => ({ id, tint: "clear", polygons: [{ outer, holes: [] }], sectorIds: [id] });
  const stack = (piece: AirspacePieceIR, zMm = 30): AirspaceStackIR => ({
    form: "plates", thicknessMm: 3, kerfMm: 0.1, ceilingCapFt: 10_000, mmPerMeter: 0.06, topMm: zMm + 3,
    levels: [{ index: 0, altitudeFt: 5_000, mergedFt: [], zMm, pieces: [piece] }], rod: { ...DEFAULT_AIRSPACE_STACK.rod }, columns: [], cutList: [], backingSheet: false,
  });

  it("preserves socket walls after adding the fit clearance", () => {
    const layers = [sheet(0, square(-100, -4.75, 100, 4.75)), sheet(1, square(-100, -4.75, 100, 4.75))];
    const result = stack(plate("A1-1", square(-40, -7, 40, 7)));
    result.rod.fitClearanceMm = 0.5;
    placeAirspaceSupports(result, layers, [], 3, 0.8, []);
    expect(result.columns).toHaveLength(0);
    expect(result.levels).toHaveLength(0);
  });

  it("keeps through rods spaced on a fine-grid fallback too", () => {
    const layers = [sheet(0, square(-5, -5, 5, 5)), sheet(1, square(-5, -5, 5, 5))];
    const result = stack(plate("A1-1", square(-35, -35, 35, 35)));
    result.rod = { ...result.rod, joint: "through", sizeMm: 2, socketDepthMm: 3 };
    placeAirspaceSupports(result, layers, [], 3, 0.8, []);
    // Three rods would fit only 5.8 mm apart, below the through grid's 8 mm.
    expect(result.columns).toHaveLength(0);
    expect(result.levels).toHaveLength(0);
  });

  it("warns when the rod limit leaves a large plate outside the supported reach", () => {
    const layers = [sheet(0, square(-350, -350, 350, 350)), sheet(1, square(-350, -350, 350, 350))];
    const result = stack(plate("A1-1", square(-300, -300, 300, 300)));
    const warnings: GeometryIRV1["warnings"] = [];
    placeAirspaceSupports(result, layers, [], 3, 0.8, warnings);
    expect(result.columns).toHaveLength(16);
    expect(warnings.map((warning) => warning.code)).toContain("AIRSPACE_OVERHANG");
  });

  it("keeps rods out of acrylic water inserts", () => {
    const layers = [sheet(0, square(-100, -100, 100, 100)), sheet(1, square(-100, -100, 100, 100)), sheet(2, square(-100, -100, 100, 100))];
    const lake = { id: "W1", lakeKey: "lake", surfaceId: "lake", layerIndex: 2, polygons: [{ outer: square(-60, -60, 60, 60), holes: [] }], markings: [] };
    const result = stack(plate("A1-1", square(-80, -80, 80, 80)));
    placeAirspaceSupports(result, layers, [lake], 3, 0.8, []);
    expect(result.columns.length).toBeGreaterThan(0);
    for (const column of result.columns) expect(inside(column.point, lake.polygons)).toBe(false);
  });

  it("holds a through-rod piece that falls between the shared grid's lines on its own finer grid", () => {
    // Rods fit only 13–15 mm up, between the shared grid's lines at 8 and 16.
    const layers = [sheet(0, square(-100, -100, 100, 100)), sheet(1, square(-100, -100, 100, 100))];
    const warnings: GeometryIRV1["warnings"] = [];
    const result = stack(plate("A1-1", square(-40, 9, 40, 19)));
    result.rod = { ...result.rod, joint: "through" };
    placeAirspaceSupports(result, layers, [], 3, 0.8, warnings);
    expect(warnings).toEqual([]);
    expect(result.columns.length).toBeGreaterThanOrEqual(2);
    for (const column of result.columns) expect(column.point.y % 8).not.toBe(0);
  });

  describe("glued stacks", () => {
    const levels = (...entries: Array<[number, AirspacePieceIR[]]>): AirspaceStackIR => ({
      ...stack(entries[0]![1][0]!), form: "volumes", topMm: entries.at(-1)![0] + 3,
      levels: entries.map(([zMm, pieces], index) => ({ index, altitudeFt: 5_000 + index * 500, mergedFt: [], zMm, pieces })),
    });
    const flat = () => [sheet(0, square(-100, -100, 100, 100)), sheet(1, square(-100, -100, 100, 100))];
    const heads = (result: AirspaceStackIR, id: string) => result.columns.filter((column) => column.segments.some((segment) => segment.headPieceId === id));

    it.each(["segments", "through"] as const)("stands %s rods under a sheet that leans its floating stack past the rods below", (joint) => {
      // The base hangs on rods at the west end; the sheet glued on it reaches 100 mm east.
      const result = levels([30, [plate("A1-1", square(-80, -30, -20, 30))]], [33, [plate("A2-1", square(-80, -30, 80, 30))]]);
      result.rod = { ...result.rod, joint };
      const warnings: GeometryIRV1["warnings"] = [];
      placeAirspaceSupports(result, flat(), [], 3, 0.8, warnings);
      expect(warnings).toEqual([]);
      const top = result.levels[1]!.pieces[0]!;
      expect(top.resting).toBe(true);
      const under = heads(result, "A2-1");
      expect(under.length).toBeGreaterThan(0);
      for (const column of under) {
        expect(column.point.x).toBeGreaterThan(-20);
        expect(column.segments.every((segment) => segment.seat.kind === "terrain")).toBe(true);
      }
      // The stack's centre of mass, 3,600 mm² at x -50 and 9,600 at 0, is inside every rod under it.
      expect(convexContains(result.columns.map((column) => column.point), { x: (-50 * 3_600) / 13_200, y: 0 })).toBe(true);
    });

    it("stands rods under a sheet glued to the terrain where it reaches too far from the glue", () => {
      // The terrain's top sheet ends at x -30: the plate lies glued on it there and reaches 110 mm past.
      const layers = [sheet(0, square(-100, -100, 100, 100)), sheet(1, square(-100, -100, -30, 100))];
      const warnings: GeometryIRV1["warnings"] = [];
      const result = levels([6, [plate("A1-1", square(-80, -30, 80, 30))]]);
      placeAirspaceSupports(result, layers, [], 3, 0.8, warnings);
      expect(warnings).toEqual([]);
      expect(result.levels[0]!.pieces[0]!.resting).toBe(true);
      const under = heads(result, "A1-1");
      expect(under.length).toBeGreaterThan(0);
      expect(under.every((column) => column.point.x > -30)).toBe(true);
      // Its far corners are within half a span of a rod.
      for (const corner of [{ x: 80, y: -30 }, { x: 80, y: 30 }]) expect(under.some((column) => Math.hypot(column.point.x - corner.x, column.point.y - corner.y) <= 75)).toBe(true);
    });

    it("never stands a rod of no length under a piece lying partly on another", () => {
      const result = levels([30, [plate("A1-1", square(-80, -30, -20, 30))]], [33, [plate("A2-1", square(-30, -30, 80, 30))]]);
      placeAirspaceSupports(result, flat(), [], 3, 0.8, []);
      expect(result.levels[1]!.pieces[0]!.resting).toBeFalsy();
      const segments = result.columns.flatMap((column) => column.segments);
      expect(segments.every((segment) => segment.topMm - segment.bottomMm > 1)).toBe(true);
      expect(heads(result, "A2-1").every((column) => column.point.x > -20)).toBe(true);
    });

    it("hangs a stack of small sheets on the two rods under its base", () => {
      const small = (id: string) => plate(id, square(0, 0, 40, 40));
      const warnings: GeometryIRV1["warnings"] = [];
      const result = levels([30, [small("A1-1")]], [33, [small("A2-1")]], [36, [small("A3-1")]]);
      placeAirspaceSupports(result, flat(), [], 3, 0.8, warnings);
      expect(warnings).toEqual([]);
      expect(result.columns).toHaveLength(2);
      expect(heads(result, "A1-1")).toHaveLength(2);
    });
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
