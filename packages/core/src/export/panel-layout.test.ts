import { describe, expect, it } from "vitest";
import { generateGeometry } from "../pipeline/generate.js";
import { offsetClosedRing } from "../primitives/offset.js";
import { ringBounds } from "../primitives/geometry2d.js";
import { realSource } from "../test-support/sources.js";
import { DEFAULT_PROJECT, type FabricationNest, type GeometryIRV1, type LayerIR, type LayerPieceV1, type Polygon2D } from "../types.js";
import { fabricationPanels, nestFamilies, rootPolygonByPolygon } from "./panel-layout.js";

const template = generateGeometry(DEFAULT_PROJECT, realSource());

function rect(minX: number, minY: number, maxX: number, maxY: number): Polygon2D {
  return { outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] };
}

function layer(index: number, polygons: Polygon2D[], pieces: LayerPieceV1[] = []): LayerIR {
  return { id: `layer-${String(index + 1).padStart(2, "0")}`, index, elevationM: index * 100, materialThicknessMm: 3, polygons, markings: [], pieces };
}

function piece(polygonIndex: number, exempt = false, column = 0, row = 0): LayerPieceV1 {
  return { polygonIndex, id: `piece-${polygonIndex}`, column, row, exempt, widthMm: 0, heightMm: 0 };
}

function nest(donorLayerIndex: number, nestedLayerIndex: number, cavities: Array<[donor: number, nested: number]>): FabricationNest {
  return { id: `nest-${donorLayerIndex}-${nestedLayerIndex}`, donorLayerIndex, nestedLayerIndex, glueMarginMm: 8, cavities: cavities.map(([donorPolygonIndex, nestedPolygonIndex]) => ({ donorPolygonIndex, donorHoleIndex: 0, nestedPolygonIndex })) };
}

function irOf(layers: LayerIR[], fabricationNests: FabricationNest[] = [], overrides: Partial<GeometryIRV1> = {}): GeometryIRV1 {
  return { ...template, layers, fabricationNests, splitPlan: undefined, ...overrides };
}

/** Every `layer:polygon` a set of panels draws, with the number of panels drawing it. */
function drawCounts(panels: ReturnType<typeof fabricationPanels>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const panel of panels) {
    for (const [layerIndex, polygonIndexes] of panel.included ?? []) {
      for (const polygonIndex of polygonIndexes) counts.set(`${layerIndex}:${polygonIndex}`, (counts.get(`${layerIndex}:${polygonIndex}`) ?? 0) + 1);
    }
  }
  return counts;
}

describe("nest families", () => {
  const square = rect(0, 0, 10, 10);
  const ir = irOf([0, 1, 2, 3, 4].map((index) => layer(index, [square, square])), [nest(0, 2, [[1, 0], [0, 1]]), nest(2, 4, [[0, 0]])]);

  it("groups each root layer with everything cut out of it, transitively", () => {
    expect(nestFamilies(ir)).toEqual([
      { rootLayerIndex: 0, layerIndexes: [0, 2, 4] },
      { rootLayerIndex: 1, layerIndexes: [1] },
      { rootLayerIndex: 3, layerIndexes: [3] },
    ]);
  });

  it("walks each nested polygon back to the root polygon it is cut from", () => {
    const roots = rootPolygonByPolygon(ir, nestFamilies(ir)[0]!);
    expect([...roots.get(0)!]).toEqual([[0, 0], [1, 1]]);
    expect([...roots.get(2)!]).toEqual([[0, 1], [1, 0]]);
    // Layer 4 sits in layer 2's polygon 0, which sits in root polygon 1.
    expect([...roots.get(4)!]).toEqual([[0, 1]]);
    expect(rootPolygonByPolygon(ir, nestFamilies(ir)[1]!).get(2)).toBeUndefined();
  });
});

describe("fabrication panels", () => {
  it("gives an unsplit project one whole-crop panel per nest family", () => {
    const panels = fabricationPanels(template);
    expect(panels).toHaveLength(template.layers.length - template.fabricationNests.length);
    expect(panels.flatMap((panel) => panel.layerIndexes).sort((a, b) => a - b)).toEqual(template.layers.map((layer) => layer.index));
    const half = (DEFAULT_PROJECT.widthMm + DEFAULT_PROJECT.laserKerfMm) / 2;
    for (const panel of panels) {
      expect(panel.included).toBeUndefined();
      expect(panel.cellName).toBeUndefined();
      expect(panel).toMatchObject({ minX: -half, maxX: half, minY: -(DEFAULT_PROJECT.heightMm + DEFAULT_PROJECT.laserKerfMm) / 2 });
    }
  });

  describe("on a split model", () => {
    const project = { ...DEFAULT_PROJECT, workAreaWidthMm: 160, workAreaHeightMm: 120 };
    const ir = generateGeometry(project, realSource(project));
    const panels = fabricationPanels(ir);

    it("draws every polygon on exactly one panel, nested pieces with their donor", () => {
      expect(ir.splitPlan).toBeDefined();
      const counts = drawCounts(panels);
      expect(counts.size).toBe(ir.layers.reduce((sum, item) => sum + item.polygons.length, 0));
      expect([...counts.values()].every((count) => count === 1)).toBe(true);
      const panelOf = (layerIndex: number, polygonIndex: number) => panels.findIndex((panel) => panel.included?.get(layerIndex)?.has(polygonIndex));
      for (const fabricationNest of ir.fabricationNests) {
        for (const cavity of fabricationNest.cavities) {
          expect(panelOf(fabricationNest.nestedLayerIndex, cavity.nestedPolygonIndex)).toBe(panelOf(fabricationNest.donorLayerIndex, cavity.donorPolygonIndex));
        }
      }
    });

    it("sizes each panel to the bed and contains the kerf-offset cut lines at written precision", () => {
      const plan = ir.splitPlan!;
      // Seam cuts land within a micrometre of the cell edge and the canvas is
      // then rounded outward to the 0.001 mm the paths are written at.
      const slack = 0.002;
      for (const panel of panels) {
        expect(panel.maxX - panel.minX).toBeLessThanOrEqual(plan.usableWidthMm + ir.laserKerfMm + slack);
        expect(panel.maxY - panel.minY).toBeLessThanOrEqual(plan.usableHeightMm + ir.laserKerfMm + slack);
        for (const value of [panel.minX, panel.minY, panel.maxX, panel.maxY]) expect(Math.abs(value * 1000 - Math.round(value * 1000))).toBeLessThan(1e-6);
        for (const [layerIndex, polygonIndexes] of panel.included!) {
          for (const polygonIndex of polygonIndexes) {
            for (const ring of offsetClosedRing(ir.layers[layerIndex]!.polygons[polygonIndex]!.outer, ir.laserKerfMm / 2)) {
              const bounds = ringBounds(ring);
              expect(bounds.minX).toBeGreaterThanOrEqual(panel.minX);
              expect(bounds.minY).toBeGreaterThanOrEqual(panel.minY);
              expect(bounds.maxX).toBeLessThanOrEqual(panel.maxX);
              expect(bounds.maxY).toBeLessThanOrEqual(panel.maxY);
            }
          }
        }
      }
    });

    it("names each family's panels after distinct seam cells, in order", () => {
      for (const family of nestFamilies(ir)) {
        const names = panels.filter((panel) => panel.rootLayerIndex === family.rootLayerIndex).map((panel) => panel.cellName!);
        expect(names.every((name) => /^[A-Z]\d+(-\d+)?$/.test(name))).toBe(true);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
      }
    });
  });

  describe("with exempt pieces that straddle their cell", () => {
    const splitPlan = { columns: 2, rows: 2, pitchXMm: 100, pitchYMm: 100, seamOffsetXMm: 0, seamOffsetYMm: 0, usableWidthMm: 100, usableHeightMm: 100 };
    const root = layer(0, [rect(0, 0, 90, 90), rect(-50, 0, 40, 90), rect(-50, -5, 30, -1), rect(100, 0, 150, 50)], [piece(0), piece(1, true), piece(2, true), piece(3, false, 1)]);
    // Layer 2 is cut out of the largest straddler and must travel with it.
    const ir = irOf([root, layer(1, [rect(0, 0, 5, 5)], [piece(0)]), layer(2, [rect(-40, 10, -30, 20)])], [nest(0, 2, [[1, 0]])], { laserKerfMm: 0, splitPlan });
    const panels = fabricationPanels(ir).filter((panel) => panel.rootLayerIndex === 0);
    const holding = (name: string) => panels.find((panel) => panel.cellName === name)?.included;

    it("peels straddlers onto extra sheets until the cell fits the bed", () => {
      expect(panels.map((panel) => panel.cellName)).toEqual(["A1", "A1-1", "B1"]);
      expect([...holding("A1")!.get(0)!]).toEqual([0]);
      for (const panel of panels) {
        expect(panel.maxX - panel.minX).toBeLessThanOrEqual(100);
        expect(panel.maxY - panel.minY).toBeLessThanOrEqual(100);
      }
    });

    it("reuses an extra sheet for a later straddler that fits beside the first", () => {
      expect([...holding("A1-1")!.get(0)!].sort()).toEqual([1, 2]);
      expect([...holding("A1-1")!.get(2)!]).toEqual([0]);
      expect(holding("A1")!.has(2)).toBe(false);
    });

    it("leaves an oversize cell without straddlers as it is", () => {
      const oversize = irOf([layer(0, [rect(0, 0, 150, 50)], [piece(0)])], [], { laserKerfMm: 0, splitPlan });
      const [only, ...rest] = fabricationPanels(oversize);
      expect(rest).toEqual([]);
      expect(only).toMatchObject({ cellName: "A1", minX: 0, maxX: 150 });
    });
  });
});
