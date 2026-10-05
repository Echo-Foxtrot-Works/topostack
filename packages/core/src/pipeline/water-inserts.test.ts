import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, parseProject, projectFingerprint, type GeometryWarning, type LayerIR, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type WaterSurfaceIR } from "../index.js";
import { bowlLake, circleRing, lakeArea as lake, scaledForLayers } from "../test-support/sources.js";

const LAKE_RADIUS_MM = 40;
import { pointInPolygon, signedArea } from "../primitives/geometry2d.js";
import { cutWaterInserts, WATER_INSERT_LEDGE_MM, waterInsertMaterial } from "./water-inserts.js";


function square(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
}

function area(polygons: Polygon2D[]): number {
  return polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((holes, hole) => holes + Math.abs(signedArea(hole)), 0), 0);
}

function inside(point: Point2D, polygons: Polygon2D[]): boolean {
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

function layer(index: number, polygons: Polygon2D[]): LayerIR {
  return { id: `layer-${String(index + 1).padStart(2, "0")}`, index, elevationM: index * 100, materialThicknessMm: 3, polygons, markings: [], pieces: [] };
}

function surface(overrides: Partial<WaterSurfaceIR> = {}): WaterSurfaceIR {
  return { id: "lake-1", kind: "lake", name: "Crater", hylakId: 7, polygons: [{ outer: circleRing(0, 0, 30), holes: [] }], surfaceElevationM: 150, bedElevationM: 0, layerIndex: 1, depthSource: "modeled", ...overrides };
}

const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, waterInserts: { fitClearanceMm: 0.1, excludedLakeIds: [] } };

/** Three sheets: a full base, a surface sheet with a basin hole a little wider than the lake, and land above. */
function stack(): LayerIR[] {
  return [
    layer(0, [{ outer: square(-100, -100, 100, 100), holes: [circleRing(0, 0, 10)] }]),
    layer(1, [{ outer: square(-100, -100, 100, 100), holes: [circleRing(0, 0, 31)] }]),
    layer(2, [{ outer: square(-100, -100, 100, 100), holes: [circleRing(0, 0, 33)] }]),
  ];
}

describe("water insert geometry", () => {
  it("opens the surface sheet to the lake and its basin rim, and rings the opening with a ledge below", () => {
    const layers = stack();
    const warnings: GeometryWarning[] = [];
    const cut = cutWaterInserts(project, layers, [surface()], 1.5, warnings)!;
    expect(warnings).toEqual([]);
    expect(cut.material).toEqual({ thicknessMm: 3, kerfMm: 0.15, fitClearanceMm: 0.1, ledgeMm: WATER_INSERT_LEDGE_MM });
    expect(cut.inserts).toHaveLength(1);
    const insert = cut.inserts[0]!;
    expect(insert).toMatchObject({ id: "W1", lakeKey: "7", surfaceId: "lake-1", name: "Crater", layerIndex: 1 });
    // The basin hole reached a millimetre past the 30 mm shoreline; the acrylic fills it to the hole's edge.
    expect(area(insert.polygons)).toBeCloseTo(Math.PI * 31 ** 2, -1);
    // The surface sheet no longer has wood over the lake...
    expect(inside({ x: 30.5, y: 0 }, layers[1]!.polygons)).toBe(false);
    expect(inside({ x: 32, y: 0 }, layers[1]!.polygons)).toBe(true);
    // ...and the sheet below gains a rim just inside the opening, leaving its deep hole open.
    expect(inside({ x: 31 - WATER_INSERT_LEDGE_MM / 2, y: 0 }, layers[0]!.polygons)).toBe(true);
    expect(inside({ x: 31 - WATER_INSERT_LEDGE_MM - 1, y: 0 }, layers[0]!.polygons)).toBe(true);
    expect(inside({ x: 5, y: 0 }, layers[0]!.polygons)).toBe(false);
    // Outer rings keep the Polygon2D winding.
    for (const polygon of [...layers[0]!.polygons, ...layers[1]!.polygons, ...insert.polygons]) expect(signedArea(polygon.outer)).toBeGreaterThan(0);
  });

  it("keeps acrylic to the visible face and leaves islands as wood", () => {
    const layers = stack();
    // The sheet above overhangs the vector shoreline on one side, and the lake has an island.
    layers[2]!.polygons = [{ outer: square(-100, -100, 100, 100), holes: [circleRing(4, 0, 30)] }];
    // The surface sheet holds the island's material inside its basin hole.
    layers[1]!.polygons.push({ outer: circleRing(-10, 0, 5.5), holes: [] });
    const lake = surface({ polygons: [{ outer: circleRing(0, 0, 30), holes: [circleRing(-10, 0, 5)] }] });
    const cut = cutWaterInserts(project, layers, [lake], 1.5, [])!;
    const polygons = cut.inserts.flatMap((insert) => insert.polygons);
    expect(inside({ x: -29, y: 0 }, polygons)).toBe(false);
    expect(inside({ x: -10, y: 0 }, polygons)).toBe(false);
    expect(inside({ x: -10, y: 0 }, layers[1]!.polygons)).toBe(true);
    expect(inside({ x: 20, y: 0 }, polygons)).toBe(true);
  });

  it("leaves excluded lakes, lakes on the bottom sheet and slivers as wood", () => {
    const excluded = stack();
    const before = structuredClone(excluded);
    const off = { ...project, waterInserts: { fitClearanceMm: 0.1, excludedLakeIds: ["7"] } };
    expect(cutWaterInserts(off, excluded, [surface()], 1.5, [])!.inserts).toEqual([]);
    expect(excluded).toEqual(before);

    const warnings: GeometryWarning[] = [];
    const bottom = stack();
    expect(cutWaterInserts(project, bottom, [surface({ layerIndex: 0 })], 1.5, warnings)!.inserts).toEqual([]);
    expect(warnings.map((warning) => warning.code)).toEqual(["WATER_INSERT_SKIPPED"]);
    expect(warnings[0]!.message).toContain("Crater");

    const narrow = [layer(0, [{ outer: square(-100, -100, 100, 100), holes: [] }]), layer(1, [{ outer: square(-100, -100, 100, 100), holes: [] }])];
    const sliver = surface({ polygons: [{ outer: square(-40, -0.8, 40, 0.8), holes: [] }] });
    const sliverWarnings: GeometryWarning[] = [];
    expect(cutWaterInserts(project, narrow, [sliver], 1.5, sliverWarnings)!.inserts).toEqual([]);
    expect(sliverWarnings[0]!.message).toContain("too small or narrow");
    expect(cutWaterInserts(project, stack(), [surface({ kind: "ocean" })], 1.5, [])!.inserts).toEqual([]);
  });

  it("keeps a narrow arm wood while the open water becomes acrylic", () => {
    const layers = [layer(0, [{ outer: square(-100, -100, 100, 100), holes: [] }]), layer(1, [{ outer: square(-100, -100, 100, 100), holes: [] }])];
    const outline = polygonUnion(circleRing(0, 0, 20), square(19, -1, 60, 1));
    const cut = cutWaterInserts(project, layers, [surface({ polygons: [{ outer: outline, holes: [] }] })], 1.5, [])!;
    const polygons = cut.inserts.flatMap((insert) => insert.polygons);
    expect(inside({ x: 0, y: 0 }, polygons)).toBe(true);
    expect(inside({ x: 45, y: 0 }, polygons)).toBe(false);
    expect(inside({ x: 45, y: 0 }, layers[1]!.polygons)).toBe(true);
  });

  it("numbers pieces by sheet then size, and warns about proud and oversize acrylic", () => {
    const layers = [
      layer(0, [{ outer: square(-150, -100, 150, 100), holes: [] }]),
      layer(1, [{ outer: square(-150, -100, 150, 100), holes: [] }]),
      layer(2, [{ outer: square(-150, -100, 150, 100), holes: [circleRing(-80, 0, 12), circleRing(0, 0, 40)] }]),
    ];
    const lakes = [
      surface({ id: "small", hylakId: undefined, name: undefined, layerIndex: 1, polygons: [{ outer: circleRing(-80, 0, 12), holes: [] }] }),
      surface({ id: "big", hylakId: 9, name: "Big", layerIndex: 1, polygons: [{ outer: circleRing(0, 0, 40), holes: [] }] }),
      surface({ id: "upper", hylakId: 10, name: "Upper", layerIndex: 2, polygons: [{ outer: circleRing(100, 0, 20), holes: [] }] }),
    ];
    const warnings: GeometryWarning[] = [];
    const thick = { ...project, workAreaWidthMm: 60, workAreaHeightMm: 60, waterInserts: { thicknessMm: 4, fitClearanceMm: 0.1, excludedLakeIds: [] } };
    const cut = cutWaterInserts(thick, layers, lakes, 1, warnings)!;
    expect(cut.inserts.map((insert) => [insert.id, insert.surfaceId, insert.lakeKey])).toEqual([["W1", "big", "9"], ["W2", "small", "small"], ["W3", "upper", "10"]]);
    expect(warnings.map((warning) => warning.code)).toEqual(["WATER_INSERT_PROUD", "WATER_INSERT_OVERSIZE"]);
    expect(warnings[1]!.message).toContain("W1");
    expect(warnings[1]!.message).not.toContain("W2");
  });

  it("resolves the acrylic from the wood when thickness and kerf are left unset", () => {
    expect(waterInsertMaterial(DEFAULT_PROJECT)).toBeUndefined();
    expect(waterInsertMaterial({ ...DEFAULT_PROJECT, materialThicknessMm: 4, laserKerfMm: 0.2, waterInserts: { kerfMm: 0.08, fitClearanceMm: 0.2, excludedLakeIds: [] } }))
      .toEqual({ thicknessMm: 4, kerfMm: 0.08, fitClearanceMm: 0.2, ledgeMm: WATER_INSERT_LEDGE_MM });
  });
});

describe("water insert settings", () => {
  it("round-trips through parseProject and rejects out-of-range values", () => {
    const parsed = parseProject(JSON.parse(JSON.stringify({ ...DEFAULT_PROJECT, waterInserts: { thicknessMm: 2, fitClearanceMm: 0.15, excludedLakeIds: ["7", "osm-lake-2"] } })));
    expect(parsed.waterInserts).toEqual({ thicknessMm: 2, fitClearanceMm: 0.15, excludedLakeIds: ["7", "osm-lake-2"] });
    expect(parseProject(JSON.parse(JSON.stringify(DEFAULT_PROJECT))).waterInserts).toBeUndefined();
    const invalid = (waterInserts: unknown) => () => parseProject({ ...DEFAULT_PROJECT, waterInserts });
    expect(invalid({ fitClearanceMm: 0.6, excludedLakeIds: [] })).toThrow("fit clearance");
    expect(invalid({ thicknessMm: 0.1, fitClearanceMm: 0.1, excludedLakeIds: [] })).toThrow("Acrylic thickness");
    expect(invalid({ kerfMm: 2, fitClearanceMm: 0.1, excludedLakeIds: [] })).toThrow("Acrylic kerf");
    expect(invalid({ fitClearanceMm: 0.1, excludedLakeIds: ["7", "7"] })).toThrow("exclusions");
    expect(invalid({ fitClearanceMm: 0.1, excludedLakeIds: ["bad id!"] })).toThrow("exclusions");
  });

  it("leaves existing fingerprints alone and ignores acrylic sheet layout and exclusion order", () => {
    const withInserts = { ...DEFAULT_PROJECT, waterInserts: { fitClearanceMm: 0.1, excludedLakeIds: ["a", "b"] } };
    expect(projectFingerprint(DEFAULT_PROJECT)).toBe(projectFingerprint({ ...DEFAULT_PROJECT, waterInserts: undefined }));
    expect(projectFingerprint(withInserts)).not.toBe(projectFingerprint(DEFAULT_PROJECT));
    expect(projectFingerprint(withInserts)).toBe(projectFingerprint({ ...withInserts, waterInserts: { ...withInserts.waterInserts, excludedLakeIds: ["b", "a"] } }));
    expect(projectFingerprint(withInserts)).toBe(projectFingerprint({ ...withInserts, waterInsertSheetNesting: { sheetWidthMm: 300, sheetHeightMm: 200, marginMm: 3, spacingMm: 2, rotation: "quarter", timeBudgetS: 5, seed: 1 } }));
  });
});

function polygonUnion(...rings: Point2D[][]): Point2D[] {
  // A lake with an arm, as one outline: walk the circle and splice the arm in on the +x side.
  const [circle, arm] = rings as [Point2D[], Point2D[]];
  const radius = Math.hypot(circle[0]!.x, circle[0]!.y);
  const halfWidth = Math.abs(arm[2]!.y);
  const right = Math.max(...arm.map((point) => point.x));
  const joinX = Math.sqrt(radius ** 2 - halfWidth ** 2);
  const start = Math.asin(halfWidth / radius);
  const steps = 90;
  const arc = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + (index / steps) * (Math.PI * 2 - 2 * start);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  return [{ x: joinX, y: halfWidth }, ...arc.slice(1, -1), { x: joinX, y: -halfWidth }, { x: right, y: -halfWidth }, { x: right, y: halfWidth }, { x: joinX, y: halfWidth }];
}

const lakeArea = lake({ name: "Bowl", hylakId: 42, maxDepthM: 150, meanDepthM: 60 });
const shoreline: MarkingFeature = { id: "water-area-0-shore-0", kind: "water", operation: "score", points: lakeArea.polygon.outer };
const road: MarkingFeature = { id: "causeway", kind: "road", operation: "engrave", transportationClass: "local-road", points: [{ x: -90, y: 5 }, { x: 90, y: 5 }] };
const generated: ProjectConfigV1 = { ...DEFAULT_PROJECT, waterDepthLayerLimit: 6, showWater: true, showRoads: true, optimizeMaterialUse: false, showAlignmentGuides: true, showAssemblyLabels: true, waterInserts: { fitClearanceMm: 0.1, excludedLakeIds: [] } };

describe("water inserts in a generated stack", () => {
  const [config, scaled] = scaledForLayers(generated, bowlLake(generated), 8);
  const source: SourceBundleV1 = { ...scaled, waterAreas: [lakeArea], markings: [shoreline, road] };
  const result = generateGeometry(config, source);
  const insert = result.waterInserts?.[0];

  it("replaces the lake on its surface sheet and carries the map detail that crosses it", () => {
    expect(result.waterInserts).toHaveLength(1);
    expect(result.waterInsertMaterial?.ledgeMm).toBe(WATER_INSERT_LEDGE_MM);
    expect(insert!.layerIndex).toBe(result.waterSurfaces[0]!.layerIndex);
    expect(inside({ x: 0, y: -20 }, insert!.polygons)).toBe(true);
    expect(inside({ x: 0, y: -20 }, result.layers[insert!.layerIndex]!.polygons)).toBe(false);
    // The road over the water is engraved on the acrylic, and nowhere on the bed beneath it.
    const roadOnAcrylic = insert!.markings.filter((marking) => marking.kind === "road");
    expect(roadOnAcrylic.length).toBeGreaterThan(0);
    for (const marking of roadOnAcrylic) for (const point of marking.points) expect(Math.hypot(point.x, point.y)).toBeLessThan(LAKE_RADIUS_MM + 3);
    for (const layer of result.layers.slice(0, insert!.layerIndex)) {
      for (const marking of layer.markings.filter((entry) => entry.kind === "road")) {
        for (const point of marking.points) expect(inside(point, insert!.polygons)).toBe(false);
      }
    }
    // The shoreline score would run along the cut itself.
    expect(result.layers.flatMap((layer) => layer.markings).some((marking) => marking.id.startsWith("water-area-0-shore-0"))).toBe(false);
  });

  it("never engraves a hidden mark where it would show through the acrylic", () => {
    const shown = result.layers.flatMap((layer) => layer.markings
      .filter((entry) => entry.kind === "guide" || entry.id.startsWith("piece-"))
      // Under the acrylic and not under the next wood sheet: that would be seen through the water.
      .filter((marking) => marking.points.some((point) => inside(point, insert!.polygons) && !inside(point, result.layers[layer.index + 1]?.polygons ?? [])))
      .map((marking) => `${layer.index}/${insert!.layerIndex} ${marking.id} ${marking.label ?? ""} ${marking.points.length}`));
    expect(shown).toEqual([]);
    const ids = [...result.layers, ...result.waterInserts!].flatMap((entry) => entry.markings.map((marking) => marking.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves the stack exactly as before when inserts are off", () => {
    const off = generateGeometry({ ...config, waterInserts: undefined }, source);
    expect(off.waterInserts).toBeUndefined();
    expect(off.waterInsertMaterial).toBeUndefined();
    expect(off.layers.flatMap((layer) => layer.markings).some((marking) => marking.id.startsWith("water-area-0-shore-0"))).toBe(true);
  });
});
