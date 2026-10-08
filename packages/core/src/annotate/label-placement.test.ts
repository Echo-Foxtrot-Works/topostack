import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, labelDimensions, type LayerIR, type Point2D } from "../index.js";
import { placeLinearLabel } from "./label-placement.js";

const LABEL = "Rim Road";

function square(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
}

function sheet(markings: LayerIR["markings"] = []): LayerIR {
  return { id: "layer-0", index: 0, elevationM: 0, materialThicknessMm: 3, polygons: [{ outer: square(-150, -100, 150, 100), holes: [] }], markings, pieces: [] };
}

const road: Point2D[] = [{ x: -60, y: 0 }, { x: 60, y: 0 }];

describe("placeLinearLabel", () => {
  it("ignores runs too short to anchor a label", () => {
    expect(placeLinearLabel(LABEL, DEFAULT_PROJECT, sheet(), [[{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 0.5, y: 0 }]])).toBeUndefined();
  });

  it("keeps the text upright on a road drawn right to left", () => {
    const placement = placeLinearLabel(LABEL, DEFAULT_PROJECT, sheet(), [[...road].reverse()])!;
    expect(Math.abs(placement.rotationRad)).toBeLessThanOrEqual(Math.PI / 2);
    expect(placement.rotationRad).toBeCloseTo(0, 9);
  });

  it("refuses a hairpin whose ends fold back too close for straight text", () => {
    const { width } = labelDimensions(LABEL, DEFAULT_PROJECT.textStyle);
    const hairpin = [{ x: 0, y: 0 }, { x: width / 2 + 1, y: 0 }, { x: 0, y: 0.5 }];
    expect(placeLinearLabel(LABEL, DEFAULT_PROJECT, sheet(), [hairpin])).toBeUndefined();
  });

  it("moves to the other side of the road to clear an excluded area", () => {
    const free = placeLinearLabel(LABEL, DEFAULT_PROJECT, sheet(), [road])!;
    const side = Math.sign(free.point.y);
    const blocked = side > 0 ? square(-150, 0.2, 150, 100) : square(-150, -100, 150, -0.2);
    const moved = placeLinearLabel(LABEL, DEFAULT_PROJECT, sheet(), [road], [{ outer: blocked, holes: [] }])!;
    expect(Math.sign(moved.point.y)).toBe(-side);
  });

  it("does not stack a label onto one already engraved there", () => {
    const first = placeLinearLabel(LABEL, DEFAULT_PROJECT, sheet(), [road])!;
    const existing = { id: "earlier", operation: "engrave" as const, kind: "label" as const, points: [first.point], label: LABEL, labelRotationRad: first.rotationRad, textStyle: DEFAULT_PROJECT.textStyle };
    const second = placeLinearLabel(LABEL, DEFAULT_PROJECT, sheet([existing]), [road])!;
    expect(second).toBeDefined();
    expect(second.point).not.toEqual(first.point);
  });
});
