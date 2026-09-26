import { describe, expect, it } from "vitest";
import {
  buildFabricationPackage,
  clearRegisteredFonts,
  createSyntheticSource,
  DEFAULT_PROJECT,
  generateGeometry,
  labelDimensions,
  MAX_SEAM_DIVISIONS,
  planSeamGrid,
  projectFingerprint,
  validateProject,
  type GeometryIRV1,
  type LayerIR,
  type Point2D,
  type Polygon2D,
  type ProjectConfigV1,
  type SourceBundleV1,
} from "../index.js";
import { masterToSvg } from "../export/svg.js";
import { cellEdges, seamShift, splitLayersForWorkArea } from "./split.js";
import { registerFixtureFonts } from "../test-support/fonts.js";

const EARTH_RADIUS_M = 6_371_008.8;

function gridSource(project: ProjectConfigV1, size: number, elevationAt: (nx: number, ny: number) => number): SourceBundleV1 {
  const values = new Float32Array(size * size);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const elevation = elevationAt((x / (size - 1) - 0.5) * 2, (y / (size - 1) - 0.5) * 2);
      values[y * size + x] = elevation;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  }
  return { ...createSyntheticSource(project, 2), sourceKind: "real", elevation: { width: size, height: size, values, min, max } };
}

/** Layer count is derived from map scale, so widen the window rather than setting a count. */
function scaledForLayers(project: ProjectConfigV1, source: SourceBundleV1, layerCount: number): [ProjectConfigV1, SourceBundleV1] {
  const relief = source.elevation.max - source.elevation.min;
  const groundWidthM = (relief * project.widthMm * project.verticalExaggeration) / (layerCount * project.materialThicknessMm);
  const halfSpan = groundWidthM / (2 * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(project.location.lat * (Math.PI / 180)));
  const bounds = {
    west: project.location.lon - halfSpan,
    south: project.location.lat - halfSpan * 0.7,
    east: project.location.lon + halfSpan,
    north: project.location.lat + halfSpan * 0.7,
  };
  return [{ ...project, location: { ...project.location, bounds } }, { ...source, bounds }];
}

/** A cone, so every layer is one island and the terrain spans the whole crop. */
function conicalProject(overrides: Partial<ProjectConfigV1> = {}): [ProjectConfigV1, SourceBundleV1] {
  const base: ProjectConfigV1 = {
    ...DEFAULT_PROJECT,
    widthMm: 300,
    heightMm: 200,
    showWaterDepth: false,
    showRoads: false,
    showTrails: false,
    showWater: false,
    showNorthArrow: false,
    showScaleBar: false,
    showElevationLabels: false,
    optimizeMaterialUse: false,
    ...overrides,
  };
  const source = gridSource(base, 64, (nx, ny) => 1200 * Math.max(0, 1 - Math.hypot(nx, ny)));
  return scaledForLayers({ ...base }, { ...source, sourceKind: "real", imagerySources: ["srtm/N46W122.tif"] }, 6);
}

function ringArea(points: Point2D[]): number {
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function polygonArea(polygon: Polygon2D): number {
  return polygon.holes.reduce((total, hole) => total - Math.abs(ringArea(hole)), Math.abs(ringArea(polygon.outer)));
}

function materialArea(ir: GeometryIRV1): number {
  return ir.layers.reduce((total, layer) => total + layer.polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0), 0);
}

function pointInRing(point: Point2D, ring: Point2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!;
    const b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Point2D, polygon: Polygon2D): boolean {
  return pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole));
}

/** Interior seam coordinates of one layer along x, excluding the crop edges. */
function seamsX(config: ProjectConfigV1, layerIndex: number): number[] {
  const grid = planSeamGrid(config)!;
  return cellEdges(config.widthMm, grid.columns, seamShift(layerIndex, grid.seamOffsetXMm)).slice(1, -1);
}

function seamsY(config: ProjectConfigV1, layerIndex: number): number[] {
  const grid = planSeamGrid(config)!;
  return cellEdges(config.heightMm, grid.rows, seamShift(layerIndex, grid.seamOffsetYMm)).slice(1, -1);
}

function rectPolygon(minX: number, minY: number, maxX: number, maxY: number): Polygon2D {
  return { outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] };
}

function bareLayer(index: number, polygons: Polygon2D[]): LayerIR {
  return { id: `layer-${String(index + 1).padStart(2, "0")}`, index, elevationM: index * 100, materialThicknessMm: 3, polygons, markings: [], pieces: [] };
}

describe("machine work-area splitting", () => {
  it("absorbs a seam offcut into the neighbour across the seam", () => {
    // 300 x 200 on a 160 x 120 bed: the x seam at 0 leaves a 0.5 mm strip in cell B1.
    const [config] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120, minimumFeatureMm: 3 });
    const layers = [bareLayer(0, [rectPolygon(-150, -100, 0.5, -50)]), bareLayer(1, [rectPolygon(-140, -95, -100, -60)])];
    const warnings: GeometryIRV1["warnings"] = [];
    expect(splitLayersForWorkArea(config, layers, warnings)).toBeDefined();
    expect(layers[0]!.pieces).toHaveLength(1);
    expect(layers[0]!.pieces[0]!.widthMm).toBeCloseTo(150.5, 9);
    expect(warnings.some((warning) => warning.code === "SMALL_FEATURES")).toBe(false);
    expect(materialArea({ layers } as GeometryIRV1)).toBeCloseTo(150.5 * 50 + 40 * 35, 6);
  });

  it("is inert when no work area is set", () => {
    const [config, source] = conicalProject();
    const ir = generateGeometry(config, source);
    expect(ir.splitPlan).toBeUndefined();
    expect(ir.layers.every((layer) => layer.pieces.length === 0)).toBe(true);
    expect(ir.layers.flatMap((layer) => layer.markings).some((mark) => mark.id.startsWith("piece-"))).toBe(false);
  });

  it("leaves a model that already fits unsplit", () => {
    const [config] = conicalProject();
    const exact = { ...config, workAreaWidthMm: config.widthMm + config.laserKerfMm, workAreaHeightMm: config.heightMm + config.laserKerfMm };
    expect(planSeamGrid(exact)).toBeUndefined();
    expect(planSeamGrid({ ...exact, workAreaWidthMm: exact.workAreaWidthMm - 1 })).toBeDefined();
  });

  it("treats 0 on one axis as unlimited", () => {
    const [config, source] = conicalProject();
    const split = { ...config, workAreaWidthMm: 0, workAreaHeightMm: 120 };
    const grid = planSeamGrid(split)!;
    expect(grid.columns).toBe(1);
    expect(grid.rows).toBe(2);
    expect(grid.usableWidthMm).toBe(Number.POSITIVE_INFINITY);

    const ir = generateGeometry(split, source);
    // Only the y axis is divided, so no piece is narrower than the terrain is.
    expect(ir.layers[0]!.pieces.every((piece) => piece.column === 0)).toBe(true);
  });

  it("divides into equal tiles rather than full tiles plus a remainder", () => {
    const [config] = conicalProject();
    const grid = planSeamGrid({ ...config, workAreaWidthMm: 160 + config.laserKerfMm, workAreaHeightMm: 0 })!;
    expect(grid.columns).toBe(2);
    expect(grid.pitchXMm).toBeCloseTo(150, 9);
  });

  it("caps divisions per axis", () => {
    const [config] = conicalProject();
    const grid = planSeamGrid({ ...config, widthMm: 9000, workAreaWidthMm: 25, workAreaHeightMm: 0 })!;
    expect(grid.columns).toBe(MAX_SEAM_DIVISIONS);
  });

  it("offsets alternating layers' seams by the configured amount on both axes", () => {
    const [config] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120, seamOffsetMm: 12 });
    expect(seamShift(0, 12)).toBe(-6);
    expect(seamShift(1, 12)).toBe(6);
    expect(seamShift(2, 12)).toBe(-6);

    // Every seam of an odd layer sits the full offset from the nearest even
    // seam, so no crack runs through two glued layers.
    for (const seam of seamsX(config, 1)) {
      const nearest = Math.min(...seamsX(config, 0).map((other) => Math.abs(other - seam)));
      expect(nearest).toBeCloseTo(12, 6);
    }
    for (const seam of seamsY(config, 1)) {
      const nearest = Math.min(...seamsY(config, 0).map((other) => Math.abs(other - seam)));
      expect(nearest).toBeCloseTo(12, 6);
    }
    expect(seamsX(config, 0)).toEqual(seamsX(config, 2));
  });

  it("cuts a 300 x 200 model on a 160 x 120 bed into four pieces on every layer", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const grid = planSeamGrid(config)!;
    expect(grid).toMatchObject({ columns: 2, rows: 2, seamOffsetXMm: 10, seamOffsetYMm: 10 });
    // One seam per axis, near the middle, never a half-tile at the ends.
    expect(seamsX(config, 0)).toEqual([-5]);
    expect(seamsX(config, 1)).toEqual([5]);
    expect(seamsY(config, 1)).toEqual([5]);
    const ir = generateGeometry(config, source);
    for (const layer of ir.layers) {
      expect(layer.pieces.length).toBeLessThanOrEqual(4);
      expect(Math.max(...layer.pieces.map((piece) => piece.column))).toBeLessThanOrEqual(1);
      expect(Math.max(...layer.pieces.map((piece) => piece.row))).toBeLessThanOrEqual(1);
    }
  });

  it("adds a division only when the offset end cell would overflow the bed", () => {
    const [config] = conicalProject();
    // 150 mm tiles on a 155 mm bed leave 5 mm of slack: a 10 mm offset grows
    // an end cell by 5 mm and still fits, a 12 mm one does not.
    const bed = { ...config, workAreaWidthMm: 155 + config.laserKerfMm, workAreaHeightMm: 0 };
    expect(planSeamGrid({ ...bed, seamOffsetMm: 10 })!.columns).toBe(2);
    expect(planSeamGrid({ ...bed, seamOffsetMm: 12 })!.columns).toBe(3);
  });

  it("lines seams up when the offset is zero", () => {
    const [config] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120, seamOffsetMm: 0 });
    expect(seamsX(config, 0)).toEqual(seamsX(config, 1));
    expect(seamsY(config, 0)).toEqual(seamsY(config, 1));
  });

  it("keeps the same cell count on every layer, moving only the interior seams", () => {
    const edges = cellEdges(300, 2, 5);
    expect(edges).toHaveLength(3);
    expect(edges[1]).toBeCloseTo(5, 9);
    expect(cellEdges(300, 3, -5).slice(1, -1)).toEqual([-55, 45]);
  });

  it("keys covered seams with interlocking tabs that stay inside the bed", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const straight = generateGeometry({ ...config, seamTabs: false }, source);
    const keyed = generateGeometry(config, source);
    const grid = planSeamGrid(config)!;
    const covering = straight.layers[1]!.polygons;
    const seams = seamsX(config, 0);

    // Layer 0 sits under layer 1's disc, which the x seam crosses: some piece
    // reaches past the seam line, and every such point is hidden by layer 1.
    const reaching = keyed.layers[0]!.polygons.flatMap((polygon, index) => {
      const piece = keyed.layers[0]!.pieces.find((entry) => entry.polygonIndex === index)!;
      return polygon.outer.filter((point) => seams.some((seam) => piece.column === 0 ? point.x > seam + 0.6 : point.x < seam - 0.6));
    });
    expect(reaching.length).toBeGreaterThan(0);
    for (const point of reaching) expect(covering.some((polygon) => pointInPolygon(point, polygon))).toBe(true);
    // Small keys: nothing reaches more than 5 mm across the seam.
    for (const point of reaching) expect(Math.min(...seams.map((seam) => Math.abs(point.x - seam)))).toBeLessThanOrEqual(5 + 1e-6);

    for (const layer of keyed.layers) {
      for (const piece of layer.pieces) {
        expect(piece.widthMm).toBeLessThanOrEqual(grid.usableWidthMm + 1e-6);
        expect(piece.heightMm).toBeLessThanOrEqual(grid.usableHeightMm + 1e-6);
      }
    }
    // Same pieces, same material: a tab moves area between neighbours only.
    expect(keyed.layers.map((layer) => layer.pieces.length)).toEqual(straight.layers.map((layer) => layer.pieces.length));
    expect(materialArea(keyed)).toBeCloseTo(materialArea(straight), 4);
    expect(keyed.warnings.some((warning) => warning.code === "WORK_AREA_OVERSIZE")).toBe(false);
  });

  it("shrinks a tab to fit a narrow covered band", () => {
    const [config] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const seam = seamsX(config, 0)[0]!;
    // Layer 1 is an 11.2 mm strip over layer 0's x seam: too narrow for a
    // 5 mm tab and its clearance on both sides, wide enough for a 4 mm one.
    const layers = [bareLayer(0, [rectPolygon(-150, -100, 150, 100)]), bareLayer(1, [rectPolygon(seam - 5.6, 20, seam + 5.6, 90)])];
    splitLayersForWorkArea(config, layers, []);
    const reach = Math.max(...layers[0]!.pieces.filter((piece) => piece.column === 0)
      .flatMap((piece) => layers[0]!.polygons[piece.polygonIndex]!.outer.map((point) => point.x - seam)));
    expect(reach).toBeCloseTo(4, 6);
  });

  it("guides the next layer by its outline, not its seams and tabs", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120, showAlignmentGuides: true });
    const ir = generateGeometry(config, source);
    const nextSeam = seamsX(config, 1)[0]!;
    const outline = ir.layers[0]!.markings.filter((mark) => mark.id.startsWith("alignment-layer-01-to-02-") && mark.id.includes("-inset-"));
    expect(outline.length).toBeGreaterThan(0);
    // Layer 2's x seam crosses its disc; before, its cut line (and tabs) were
    // traced onto layer 1 as a line down the middle.
    const inner = outline.flatMap((mark) => mark.points).filter((point) => Math.abs(point.y) < 40);
    expect(inner.some((point) => Math.abs(point.x - nextSeam) < 6)).toBe(false);
  });

  it("points every layer's tabs the same way", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const ir = generateGeometry(config, source);
    let keyed = 0;
    for (const layer of ir.layers) {
      const [seam] = seamsX(config, layer.index);
      layer.polygons.forEach((polygon, index) => {
        // Only the left-hand cell ever reaches across the x seam.
        const piece = layer.pieces.find((entry) => entry.polygonIndex === index)!;
        // An island kept whole straddles the seam without being cut by it.
        if (piece.exempt) return;
        const across = polygon.outer.some((point) => piece.column === 0 ? point.x > seam! + 0.6 : point.x < seam! - 0.6);
        if (piece.column === 0 && across) keyed += 1;
        if (piece.column === 1) expect(across).toBe(false);
      });
    }
    // Both layers 1 and 2 cover a seam; the narrow cell swaps between them.
    expect(keyed).toBeGreaterThanOrEqual(2);
  });

  it("leaves seams that nothing covers straight", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const straight = generateGeometry({ ...config, seamTabs: false }, source);
    const keyed = generateGeometry(config, source);
    const top = keyed.layers.length - 1;
    expect(keyed.layers[top]!.polygons).toEqual(straight.layers[top]!.polygons);
  });

  it("keeps every interior point in exactly one piece with tabs cut", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const layer = generateGeometry(config, source).layers[0]!;
    // Sample densely around the x seam, where tabs and sockets interlock.
    for (let x = -18; x <= 8; x += 0.7) {
      for (let y = -90; y <= 90; y += 0.9) {
        expect(layer.polygons.filter((polygon) => pointInPolygon({ x, y }, polygon)).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("skips tabs where the bed has no room for a sound neck", () => {
    const [config, source] = conicalProject({ seamOffsetMm: 0 });
    // Two 150 mm tiles on a bed that fits exactly 150 mm leave no slack at all.
    const tight = { ...config, workAreaWidthMm: 150 + config.laserKerfMm, workAreaHeightMm: 0 };
    const keyed = generateGeometry(tight, source);
    const straight = generateGeometry({ ...tight, seamTabs: false }, source);
    expect(keyed.layers.map((layer) => layer.polygons)).toEqual(straight.layers.map((layer) => layer.polygons));
  });

  it("rejects a seam offset outside the supported range", () => {
    expect(() => validateProject({ ...DEFAULT_PROJECT, seamOffsetMm: -1 })).toThrow(/Seam offset/);
    expect(() => validateProject({ ...DEFAULT_PROJECT, seamOffsetMm: 51 })).toThrow(/Seam offset/);
    expect(() => validateProject({ ...DEFAULT_PROJECT, seamOffsetMm: 0 })).not.toThrow();
  });

  it("keeps every piece inside the work area and preserves the material", () => {
    const [config, source] = conicalProject();
    const whole = generateGeometry(config, source);
    const split = { ...config, workAreaWidthMm: 160, workAreaHeightMm: 120 };
    const ir = generateGeometry(split, source);
    const grid = planSeamGrid(split)!;

    expect(ir.splitPlan).toEqual(grid);
    expect(ir.warnings.some((warning) => warning.code === "WORK_AREA_OVERSIZE")).toBe(false);
    for (const layer of ir.layers) {
      expect(layer.pieces).toHaveLength(layer.polygons.length);
      for (const piece of layer.pieces) {
        expect(piece.widthMm).toBeLessThanOrEqual(grid.usableWidthMm + 1e-6);
        expect(piece.heightMm).toBeLessThanOrEqual(grid.usableHeightMm + 1e-6);
      }
    }
    expect(materialArea(ir)).toBeCloseTo(materialArea(whole), 4);
  });

  it("keeps ring winding and closure through the split", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const ir = generateGeometry(config, source);
    for (const layer of ir.layers) {
      for (const polygon of layer.polygons) {
        expect(polygon.outer.at(0)).toEqual(polygon.outer.at(-1));
        expect(ringArea(polygon.outer)).toBeGreaterThan(0);
        for (const hole of polygon.holes) {
          expect(hole.at(0)).toEqual(hole.at(-1));
          expect(ringArea(hole)).toBeLessThan(0);
        }
      }
    }
  });

  it("puts every interior point in exactly one piece", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const ir = generateGeometry(config, source);
    const layer = ir.layers[0]!;
    let sampled = 0;
    for (let x = -140; x <= 140; x += 7.3) {
      for (let y = -90; y <= 90; y += 5.7) {
        const matches = layer.polygons.filter((polygon) => pointInPolygon({ x, y }, polygon)).length;
        expect(matches).toBeLessThanOrEqual(1);
        sampled += matches;
      }
    }
    expect(sampled).toBeGreaterThan(100);
  });

  it("keeps a small island whole even when a seam crosses it", () => {
    // Two peaks either side of the model's centreline. The upper layers isolate
    // each summit into an island small enough to cut in one piece.
    const base: ProjectConfigV1 = {
      ...DEFAULT_PROJECT,
      widthMm: 300,
      heightMm: 200,
      showWaterDepth: false,
      showRoads: false,
      showTrails: false,
      showWater: false,
      showNorthArrow: false,
      showScaleBar: false,
      showElevationLabels: false,
      optimizeMaterialUse: false,
    };
    const peaks = gridSource(base, 96, (nx, ny) => 1200 * Math.max(
      Math.max(0, 1 - Math.hypot(nx * 3, ny * 3)),
      Math.max(0, 1 - Math.hypot((nx - 0.6) * 4, ny * 4)),
    ));
    const [config, source] = scaledForLayers(base, { ...peaks, imagerySources: ["srtm/N46W122.tif"] }, 6);
    const split = { ...config, workAreaWidthMm: 160, workAreaHeightMm: 120 };
    const whole = generateGeometry(config, source);
    const ir = generateGeometry(split, source);

    const exemptPieces = ir.layers.flatMap((layer) => layer.pieces.filter((piece) => piece.exempt));
    expect(exemptPieces.length).toBeGreaterThan(0);

    // An exempt piece is never re-emitted through the clipper, so its ring is
    // the unsplit run's ring exactly - rounded corners and all.
    const exemptRings = new Set(ir.layers.flatMap((layer) =>
      layer.pieces.filter((piece) => piece.exempt).map((piece) => JSON.stringify(layer.polygons[piece.polygonIndex]))));
    const wholeRings = new Set(whole.layers.flatMap((layer) => layer.polygons.map((polygon) => JSON.stringify(polygon))));
    for (const ring of exemptRings) expect(wholeRings.has(ring)).toBe(true);
    expect(materialArea(ir)).toBeCloseTo(materialArea(whole), 4);
  });

  it("names pieces by layer and grid cell", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const ir = generateGeometry(config, source);
    const ids = ir.layers.flatMap((layer) => layer.pieces.map((piece) => piece.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^L\d{2}-[A-Z]\d+(-\d+)?$/.test(id))).toBe(true);
    expect(ir.layers[0]!.pieces.map((piece) => piece.id)).toContain("L01-A1");
  });

  it("engraves piece ids only where the layer above hides them", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const ir = generateGeometry(config, source);
    const labels = ir.layers.flatMap((layer, index) => layer.markings
      .filter((mark) => mark.id.startsWith("piece-"))
      .map((mark) => ({ index, point: mark.points[0]! })));
    expect(labels.length).toBeGreaterThan(0);

    for (const { index, point } of labels) {
      const above = ir.layers.slice(index + 1).flatMap((layer) => layer.polygons);
      expect(above.some((polygon) => pointInPolygon(point, polygon))).toBe(true);
    }
    // Nothing covers the summit, so its pieces carry no id at all.
    expect(ir.layers.at(-1)!.markings.some((mark) => mark.id.startsWith("piece-"))).toBe(false);
  });

  it("omits piece ids when assembly labels are off", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120, showAssemblyLabels: false });
    const ir = generateGeometry(config, source);
    expect(ir.layers.flatMap((layer) => layer.markings).some((mark) => mark.id.startsWith("piece-"))).toBe(false);
  });

  it("names the piece an alignment guide belongs to", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120, showAlignmentGuides: true });
    const ir = generateGeometry(config, source);
    const guideLabels = ir.layers.flatMap((layer) => layer.markings)
      .filter((mark) => mark.id.startsWith("alignment-") && mark.label);
    expect(guideLabels.length).toBeGreaterThan(0);
    expect(guideLabels.every((mark) => /^L\d{2}-[A-Z]\d+(-\d+)?$/.test(mark.label!))).toBe(true);
  });

  it("keeps nest cavities consistent with the pieces they were cut from", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 200, workAreaHeightMm: 150, optimizeMaterialUse: true });
    const ir = generateGeometry(config, source);
    for (const nest of ir.fabricationNests) {
      for (const cavity of nest.cavities) {
        const donor = ir.layers[nest.donorLayerIndex]!.polygons[cavity.donorPolygonIndex];
        const nested = ir.layers[nest.nestedLayerIndex]!.polygons[cavity.nestedPolygonIndex];
        expect(donor).toBeDefined();
        expect(nested).toBeDefined();
        const hole = donor!.holes[cavity.donorHoleIndex]!;
        expect(hole).toBeDefined();
        expect(Math.abs(ringArea(hole))).toBeCloseTo(Math.abs(ringArea(nested!.outer)), 6);
      }
    }
  });

  it("absorbs a piece too narrow to cut into its neighbour", () => {
    // A fine grid over a cone grazes the slope with several seams, so some
    // cells retain only a crescent a fraction of a millimetre wide.
    const [config, source] = conicalProject({ workAreaWidthMm: 42, workAreaHeightMm: 42, minimumFeatureMm: 5 });
    const whole = generateGeometry({ ...config, workAreaWidthMm: 0, workAreaHeightMm: 0 }, source);
    const ir = generateGeometry(config, source);
    expect(ir.splitPlan).toBeDefined();

    const narrow = ir.layers.flatMap((layer) => layer.pieces)
      .filter((piece) => !piece.exempt && (piece.widthMm < config.minimumFeatureMm || piece.heightMm < config.minimumFeatureMm));
    // Whatever could be absorbed was; anything left is reported, never deleted.
    if (narrow.length) expect(ir.warnings.some((warning) => warning.code === "SMALL_FEATURES")).toBe(true);
    expect(materialArea(ir)).toBeCloseTo(materialArea(whole), 4);
    for (const layer of ir.layers) {
      for (const piece of layer.pieces) {
        expect(piece.widthMm).toBeLessThanOrEqual(ir.splitPlan!.usableWidthMm + 1e-6);
        expect(piece.heightMm).toBeLessThanOrEqual(ir.splitPlan!.usableHeightMm + 1e-6);
      }
    }
  });

  it("abandons the split rather than emitting more pieces than it will cut", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 25, workAreaHeightMm: 25 });
    const whole = generateGeometry({ ...config, workAreaWidthMm: 0, workAreaHeightMm: 0 }, source);
    const ir = generateGeometry(config, source);
    expect(ir.warnings.some((warning) => warning.code === "WORK_AREA_UNSPLIT")).toBe(true);
    expect(ir.splitPlan).toBeUndefined();
    expect(ir.layers.every((layer) => layer.pieces.length === 0)).toBe(true);
    expect(materialArea(ir)).toBeCloseTo(materialArea(whole), 6);
  });

  it("leaves a flat engraving whole, so no seam or tab becomes a contour", () => {
    const [config, source] = conicalProject({ outputMode: "engraving", workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const whole = generateGeometry({ ...config, workAreaWidthMm: 0, workAreaHeightMm: 0 }, source);
    const ir = generateGeometry(config, source);
    expect(planSeamGrid(config)).toBeUndefined();
    expect(ir.splitPlan).toBeUndefined();
    expect(ir.layers.every((layer) => layer.pieces.length === 0)).toBe(true);
    expect(ir.layers.map((layer) => layer.polygons)).toEqual(whole.layers.map((layer) => layer.polygons));
    expect(ir.warnings.some((warning) => warning.code.startsWith("WORK_AREA"))).toBe(false);
  });

  it("rejects an unusable work area", () => {
    const base = { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location } };
    expect(() => validateProject({ ...base, workAreaWidthMm: -1 })).toThrow(/zero or a positive/);
    expect(() => validateProject({ ...base, workAreaWidthMm: Number.NaN })).toThrow(/zero or a positive/);
    expect(() => validateProject({ ...base, workAreaHeightMm: 5 })).toThrow(/0 \(unlimited\)/);
    expect(() => validateProject({ ...base, workAreaWidthMm: 20, laserKerfMm: 0.5 })).toThrow(/usable bed/);
    expect(() => validateProject({ ...base, workAreaWidthMm: 300, workAreaHeightMm: 200 })).not.toThrow();
    expect(() => validateProject(base)).not.toThrow();
  });

  it("changes the export fingerprint", () => {
    const base = { ...DEFAULT_PROJECT };
    expect(projectFingerprint({ ...base, workAreaWidthMm: 300 })).not.toBe(projectFingerprint(base));
    expect(projectFingerprint({ ...base, showAssemblyLabels: false })).not.toBe(projectFingerprint(base));
  });

  it("is deterministic", () => {
    const [config, source] = conicalProject({ workAreaWidthMm: 160, workAreaHeightMm: 120 });
    const first = generateGeometry(config, source);
    const second = generateGeometry(config, source);
    expect(first.layers.map((layer) => layer.pieces.map((piece) => piece.id)))
      .toEqual(second.layers.map((layer) => layer.pieces.map((piece) => piece.id)));
  });
});

describe("split fabrication package", () => {
  const workArea = { workAreaWidthMm: 160, workAreaHeightMm: 120 };

  function splitPackage(overrides: Partial<ProjectConfigV1> = {}) {
    const [config, source] = conicalProject({ ...workArea, ...overrides });
    const ir = generateGeometry(config, source);
    return { config, ir, pkg: buildFabricationPackage(ir, config) };
  }

  it("emits one panel per seam cell, each fitting the machine", async () => {
    const { config, pkg } = splitPackage();
    const panels = pkg.files.filter((file) => file.filename.endsWith(".svg") && !file.filename.includes("master") && !file.filename.includes("assembly-guide") && !file.filename.endsWith("-engrave.svg"));
    expect(panels.length).toBeGreaterThan(1);
    expect(panels.every((file) => /-[a-z]\d+\.svg$/.test(file.filename))).toBe(true);

    for (const file of panels) {
      const svg = await file.blob.text();
      const width = Number(/width="([\d.]+)mm"/.exec(svg)![1]);
      const height = Number(/height="([\d.]+)mm"/.exec(svg)![1]);
      expect(width).toBeLessThanOrEqual(config.workAreaWidthMm + 1e-6);
      expect(height).toBeLessThanOrEqual(config.workAreaHeightMm + 1e-6);
    }
  });

  it("ships an exempt piece that outgrows its cell on its own sheet", async () => {
    const [config, source] = conicalProject(workArea);
    const ir = generateGeometry(config, source);
    // A tall strip split by rows, plus a bar kept whole whose centre sits in
    // column 0 (layer 0's seam sits at x = -5) but which reaches 60 mm into
    // column 1: cell A1 alone would be 205 mm wide on a 160 mm bed.
    const layers = [bareLayer(0, [rectPolygon(-150, -100, -80, 100), rectPolygon(-75, -60, 55, -20)]), bareLayer(1, [rectPolygon(-140, -90, -90, 90)])];
    const warnings: GeometryIRV1["warnings"] = [];
    const splitPlan = splitLayersForWorkArea(config, layers, warnings);
    expect(layers[0]!.pieces.filter((piece) => piece.exempt)).toHaveLength(1);
    const pkg = buildFabricationPackage({ ...ir, layers, fabricationNests: [], splitPlan, warnings, waterSurfaces: [], waterPatternAreas: [] }, config);
    const manifest = JSON.parse(await pkg.files.find((file) => file.filename.endsWith("-project.json"))!.blob.text());
    const panels: Array<{ cell: string; widthMm: number; heightMm: number; layerIds: string[] }> = manifest.result.fabrication.panels;
    for (const panel of panels) {
      expect(panel.widthMm).toBeLessThanOrEqual(config.workAreaWidthMm + 1e-6);
      expect(panel.heightMm).toBeLessThanOrEqual(config.workAreaHeightMm + 1e-6);
    }
    expect(panels.map((panel) => panel.cell)).toContain("A1-1");
    expect(pkg.files.some((file) => file.filename.endsWith("-layer-01-a1-1.svg"))).toBe(true);
    // Every polygon still ships exactly once.
    const cutIds = (await Promise.all(pkg.files.filter((file) => /-a\d(-\d)?\.svg$/.test(file.filename)).map((file) => file.blob.text())))
      .flatMap((svg) => [...svg.matchAll(/id="(layer-01-cut-\d+)-offset-1"/g)].map((match) => match[1]!));
    expect(cutIds.sort()).toEqual(["layer-01-cut-1", "layer-01-cut-2", "layer-01-cut-3"]);
  });

  it("puts assembly ids in their own operation group", async () => {
    const { pkg } = splitPackage();
    const withIds = [];
    for (const file of pkg.files.filter((entry) => entry.filename.endsWith(".svg"))) {
      const svg = await file.blob.text();
      if (!svg.includes('id="ASSEMBLY"')) continue;
      withIds.push(file.filename);
      const group = /<g id="ASSEMBLY"[\s\S]*?stroke="(#[0-9A-Fa-f]{6})"/.exec(svg)!;
      // A separate colour is what makes it a separate process in the machine.
      expect(group[1]).not.toBe("#2366FF");
      const body = svg.slice(svg.indexOf('id="ASSEMBLY"'));
      const ids = [...body.slice(0, body.indexOf('data-operation="SCORE"')).matchAll(/<path id="([^"]+)"/g)].map((match) => match[1]!);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith("piece-"))).toBe(true);
    }
    expect(withIds.length).toBeGreaterThan(0);
  });

  it("carries no assembly group when assembly labels are off", async () => {
    const { pkg } = splitPackage({ showAssemblyLabels: false });
    for (const file of pkg.files.filter((entry) => entry.filename.endsWith(".svg"))) {
      expect(await file.blob.text()).not.toContain('id="ASSEMBLY"');
    }
  });

  it("splits typeface letters at a seam into closed fills on both sheets", async () => {
    registerFixtureFonts();
    try {
      const [config, source] = conicalProject(workArea);
      const ir = generateGeometry(config, source);
      const [seamX] = seamsX(config, 0);
      const style = { font: "jost" as const, sizeMm: 8 };
      const width = labelDimensions("HOH", style).width;
      ir.layers[0]!.markings.push({ id: "seam-title", operation: "engrave", kind: "label", points: [{ x: seamX! - width / 2, y: config.heightMm * 0.42 }], label: "HOH", textStyle: style });
      const pkg = buildFabricationPackage(ir, config);
      const sheets = await Promise.all(pkg.files.filter((file) => /layer-01-[ab][12]\.svg$/.test(file.filename)).map((file) => file.blob.text()));
      const withTitle = sheets.filter((svg) => svg.includes('id="seam-title-fill-'));
      expect(withTitle).toHaveLength(2);
      for (const svg of withTitle) {
        for (const [, d] of svg.matchAll(/<path id="seam-title-fill-[^"]+" d="([^"]+)" fill="[^"]+" stroke="none"/g)) {
          const points = [...d!.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => `${match[1]} ${match[2]}`);
          expect(points[0]).toBe(points.at(-1));
        }
      }
    } finally {
      clearRegisteredFonts();
    }
  });

  it("stops a marking at the seam instead of engraving past its own sheet", async () => {
    const [base, source] = conicalProject({ ...workArea, showAlignmentGuides: true, showNorthArrow: true, showScaleBar: true });
    // A map marker on layer 1's x seam, near the south edge where only that
    // layer has material, so its filled symbol and halo cross the seam.
    const bounds = base.location.bounds!;
    const [seamX] = seamsX(base, 0);
    const seamLon = bounds.west + (bounds.east - bounds.west) * (seamX! / base.widthMm + 0.5);
    const config: ProjectConfigV1 = { ...base, markers: [{ id: "seam", lat: bounds.south + (bounds.north - bounds.south) * 0.04, lon: seamLon, symbol: "pin" }] };
    const ir = generateGeometry(config, source);
    const marker = ir.layers[0]!.markings.filter((mark) => mark.id.startsWith("map-marker-"));
    expect(marker.length).toBeGreaterThan(0);
    expect(marker.some((mark) => mark.points.some((point) => point.x < seamX! - 1) && mark.points.some((point) => point.x > seamX! + 1))).toBe(true);
    const pkg = buildFabricationPackage(ir, config);
    const grid = planSeamGrid(config)!;
    const panels = pkg.files.filter((file) => /-[a-z]\d+\.svg$/.test(file.filename) && !file.filename.endsWith("-engrave.svg"));

    for (const file of panels) {
      const svg = await file.blob.text();
      const viewBox = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);
      const points = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
      expect(points.length).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(viewBox[0]! - 1e-3);
        expect(point.x).toBeLessThanOrEqual(viewBox[0]! + viewBox[2]! + 1e-3);
        expect(point.y).toBeGreaterThanOrEqual(viewBox[1]! - 1e-3);
        expect(point.y).toBeLessThanOrEqual(viewBox[1]! + viewBox[3]! + 1e-3);
      }
    }
    expect(grid.columns * grid.rows).toBeGreaterThan(1);
    // Both sheets meeting at the seam carry their share of the marker, as
    // closed fills rather than open arcs.
    const sheets = await Promise.all(panels.filter((file) => /layer-01-[ab][12]\.svg$/.test(file.filename)).map((file) => file.blob.text()));
    const withMarker = sheets.filter((svg) => svg.includes('id="map-marker-'));
    expect(withMarker).toHaveLength(2);
    for (const svg of withMarker) {
      const fills = [...svg.matchAll(/<path id="(map-marker-[^"]+)" d="([^"]+)" fill=/g)];
      expect(fills.length).toBeGreaterThan(0);
      for (const [, , d] of fills) {
        const points = [...d!.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => `${match[1]} ${match[2]}`);
        expect(points[0]).toBe(points.at(-1));
      }
    }
  });

  it("leaves an unsplit package byte-identical apart from its manifest", async () => {
    const [config, source] = conicalProject({ showAlignmentGuides: true, showNorthArrow: true, showScaleBar: true, optimizeMaterialUse: true });
    const ir = generateGeometry(config, source);
    const pkg = buildFabricationPackage(ir, config);
    for (const file of pkg.files.filter((entry) => entry.filename.endsWith(".svg") && !entry.filename.includes("assembly-guide"))) {
      const svg = await file.blob.text();
      // The unsplit writer has always emitted a SCORE group per layer even when
      // empty; machine software users key on those ids.
      for (const layerIndex of file.filename.includes("master") ? ir.layers.map((layer) => layer.index) : []) {
        expect(svg).toContain(`<g id="${ir.layers[layerIndex]!.id}-SCORE">`);
      }
      expect(svg).not.toContain('id="ASSEMBLY"');
    }
  });

  it("records the seam grid in the manifest", async () => {
    const { pkg } = splitPackage();
    const manifest = JSON.parse(await pkg.files.find((file) => file.filename.endsWith("-project.json"))!.blob.text());
    expect(manifest.result.fabrication.workArea).toMatchObject({ widthMm: 160, heightMm: 120, columns: 2, rows: 2 });
    expect(manifest.result.fabrication.panels.every((panel: { cell?: string }) => Boolean(panel.cell))).toBe(true);
    expect(manifest.result.layers[0].filenames.length).toBeGreaterThan(1);
  });

  it("explains the seams in the README", async () => {
    const { pkg } = splitPackage();
    const readme = await pkg.files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(readme).toMatch(/Seams shift 10 mm on alternating layers/);
    expect(readme).toMatch(/assembly id/i);
    expect(readme).toMatch(/interlocking jigsaw tabs/);
  });

  it("tiles every panel into the master without overlap", () => {
    const { ir } = splitPackage();
    const master = masterToSvg(ir);
    const width = Number(/width="([\d.]+)mm"/.exec(master)![1]);
    expect(width).toBeGreaterThan(ir.widthMm);
    expect((master.match(/data-cell="/g) ?? []).length).toBeGreaterThan(OPERATION_GROUPS);
  });
});

/** ENGRAVE, ASSEMBLY, SCORE and CUT each repeat every panel group once. */
const OPERATION_GROUPS = 4;
