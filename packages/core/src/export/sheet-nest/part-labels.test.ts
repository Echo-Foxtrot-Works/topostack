import { describe, expect, it } from "vitest";
import { labelDimensions } from "../../annotate/labels.js";
import { generateGeometry } from "../../pipeline/generate.js";
import { pointInRing, realSource } from "../../test-support/sources.js";
import { DEFAULT_PROJECT, type GeometryIRV1, type LayerIR, type NestPartV1, type OperationPath, type Polygon2D } from "../../types.js";
import { withPartLabels } from "./part-labels.js";
import { nestableParts, polygonLabel } from "./parts.js";

const config = DEFAULT_PROJECT;
const template = generateGeometry(config, realSource(config));

function rect(minX: number, minY: number, maxX: number, maxY: number): Polygon2D {
  return { outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] };
}

function layer(index: number, polygons: Polygon2D[], pieces: LayerIR["pieces"] = []): LayerIR {
  return { id: `layer-${String(index + 1).padStart(2, "0")}`, index, elevationM: index * 100, materialThicknessMm: 3, polygons, markings: [], pieces };
}

function part(layerIndex: number, polygonIndexes: number[]): NestPartV1 {
  return { id: `layer-${layerIndex}:${polygonIndexes[0]}`, label: "", rootLayerIndex: layerIndex, members: [{ layerIndex, polygonIndexes }], outline: [], areaMm2: 0 };
}

/** The placed label's text box lies inside `ring`. */
function labelInside(marking: OperationPath, ring: Polygon2D["outer"]): boolean {
  const { width, height } = labelDimensions(marking.label!, marking.textStyle);
  const origin = marking.points[0]!;
  return [origin, { x: origin.x + width, y: origin.y }, { x: origin.x, y: origin.y + height }, { x: origin.x + width, y: origin.y + height }].every((corner) => pointInRing(corner, ring));
}

describe("nested part labels", () => {
  // Two islands on the base, one wide sheet over both, and a small top piece.
  const ir: GeometryIRV1 = {
    ...template,
    fabricationNests: [],
    layers: [
      layer(0, [rect(-140, -90, -10, 90), rect(10, -90, 140, 90)]),
      layer(1, [rect(-120, -60, 120, 60)]),
      layer(2, [rect(-30, -20, 30, 20)]),
    ],
  };
  const parts = [part(0, [0]), part(0, [1]), part(1, [0]), part(2, [0])];

  it("leaves the geometry alone when assembly labels are off", () => {
    const result = withPartLabels(ir, { ...config, showAssemblyLabels: false }, parts);
    expect(result.ir).toBe(ir);
    expect(result.omitted).toEqual([]);
  });

  it("engraves each covered piece's id where the layers above hide it", () => {
    const { ir: labelled } = withPartLabels(ir, config, parts);
    const added = labelled.layers.slice(0, 2).map((item) => item.markings);
    expect(added[0]!.map((marking) => marking.label)).toEqual(["L01-1", "L01-2"]);
    expect(added[1]!.map((marking) => marking.label)).toEqual(["L02"]);
    for (const [layerIndex, markings] of added.entries()) {
      for (const marking of markings) {
        expect(marking).toMatchObject({ id: `piece-${marking.label}-label`, operation: "engrave", kind: "guide", textStyle: config.textStyle });
        const polygonIndex = marking.label === "L01-2" ? 1 : 0;
        expect(labelInside(marking, ir.layers[layerIndex]!.polygons[polygonIndex]!.outer)).toBe(true);
        expect(labelInside(marking, ir.layers[layerIndex + 1]!.polygons[0]!.outer)).toBe(true);
      }
    }
  });

  it("reports pieces with no covered room, the top layer above all, instead of engraving them", () => {
    const { ir: labelled, omitted } = withPartLabels(ir, config, parts);
    expect(omitted).toEqual(["L03"]);
    expect(labelled.layers[2]!.markings).toEqual([]);
  });

  it("copies the layers it labels and never changes the input", () => {
    const { ir: labelled } = withPartLabels(ir, config, [part(0, [0])]);
    expect(ir.layers.every((item) => item.markings.length === 0)).toBe(true);
    expect(labelled.layers[0]).not.toBe(ir.layers[0]);
    expect(labelled.layers[1]).toBe(ir.layers[1]);
    expect(labelled).not.toBe(ir);
  });

  it("skips seam pieces, which carry their id from generation", () => {
    const seamed = { ...ir, layers: [layer(0, ir.layers[0]!.polygons, [{ polygonIndex: 0, id: "L01-A1", column: 0, row: 0, exempt: false, widthMm: 130, heightMm: 180 }]), ...ir.layers.slice(1)] };
    const { ir: labelled, omitted } = withPartLabels(seamed, config, [part(0, [0, 1])]);
    expect(labelled.layers[0]!.markings.map((marking) => marking.label)).toEqual(["L01-2"]);
    expect(omitted).toEqual([]);
  });

  it("keeps every engraved id on its own piece and under the stack on generated terrain", () => {
    const project = { ...config, optimizeMaterialUse: false };
    const generated = generateGeometry(project, realSource(project));
    const { ir: labelled, omitted } = withPartLabels(generated, project, nestableParts(generated));
    const top = generated.layers.length - 1;
    expect(omitted).toContain(polygonLabel(generated, top, 0));
    let placed = 0;
    labelled.layers.forEach((item, layerIndex) => {
      for (const marking of item.markings.slice(generated.layers[layerIndex]!.markings.length)) {
        placed += 1;
        expect(item.polygons.some((polygon) => labelInside(marking, polygon.outer))).toBe(true);
        expect(generated.layers.slice(layerIndex + 1).some((above) => above.polygons.some((polygon) => labelInside(marking, polygon.outer)))).toBe(true);
      }
    });
    expect(placed).toBeGreaterThan(0);
  });
});
