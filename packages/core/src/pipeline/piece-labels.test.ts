import { describe, expect, it } from "vitest";
import { indexLabelLayer } from "../annotate/label-placement.js";
import { labelDimensions } from "../annotate/labels.js";
import { preparePolygons } from "../primitives/geometry2d.js";
import { pointInRing } from "../test-support/sources.js";
import { DEFAULT_PROJECT, type OperationPath, type Point2D, type Polygon2D } from "../types.js";
import { coveredLabelPoint } from "./piece-labels.js";

const config = DEFAULT_PROJECT;
const label = "L03-B2";
const { width, height } = labelDimensions(label, config.textStyle);

function rect(minX: number, minY: number, maxX: number, maxY: number): Polygon2D {
  return { outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] };
}

/** The label box's corners for a placed origin. */
function corners(origin: Point2D): Point2D[] {
  return [origin, { x: origin.x + width, y: origin.y }, { x: origin.x, y: origin.y + height }, { x: origin.x + width, y: origin.y + height }];
}

const inside = (origin: Point2D, polygon: Polygon2D) => corners(origin).every((corner) => pointInRing(corner, polygon.outer));

describe("covered piece labels", () => {
  const piece = rect(-100, -60, 100, 60);
  const place = (covering: Polygon2D[], markings: OperationPath[] = []) =>
    coveredLabelPoint(label, config, indexLabelLayer([piece], markings), piece, preparePolygons(covering));

  it("places nothing on a piece with nothing stacked above it", () => {
    expect(place([])).toBeUndefined();
  });

  it("places nothing when the layer above is elsewhere or too narrow to hide the id", () => {
    expect(place([rect(150, 70, 200, 120)])).toBeUndefined();
    expect(place([rect(-1, -1, 1, 1)])).toBeUndefined();
  });

  it("hides the id under the part of the layer above that overlaps the piece", () => {
    // The upper layer overhangs the piece's corner; only the overlap is both material and hidden.
    const cover = rect(60, 20, 180, 140);
    const origin = place([cover])!;
    expect(origin).toBeDefined();
    expect(inside(origin, rect(60, 20, 100, 60))).toBe(true);
  });

  it("prefers the largest covered region over a smaller one that also fits", () => {
    const small = rect(-95, -55, -60, -35);
    const large = rect(20, -20, 90, 50);
    const origin = place([small, large])!;
    expect(inside(origin, large)).toBe(true);
  });

  it("finds room off-centre when markings occupy the middle of the covered region", () => {
    const cover = rect(-80, -40, 80, 40);
    const across: OperationPath = { id: "road", operation: "engrave", kind: "road", points: [{ x: -80, y: 0 }, { x: 80, y: 0 }] };
    const down: OperationPath = { id: "trail", operation: "engrave", kind: "trail", points: [{ x: 0, y: -40 }, { x: 0, y: 40 }] };
    const origin = place([cover], [across, down])!;
    expect(inside(origin, cover)).toBe(true);
    const box = { minX: origin.x, maxX: origin.x + width, minY: origin.y, maxY: origin.y + height };
    expect(box.minY > 0 || box.maxY < 0).toBe(true);
    expect(box.minX > 0 || box.maxX < 0).toBe(true);
  });

  it("returns nothing when the only covered room is fully blocked", () => {
    const cover = rect(-20, -6, 20, 6);
    const blocked: OperationPath = { id: "road", operation: "engrave", kind: "road", points: [{ x: -20, y: 0 }, { x: 20, y: 0 }] };
    expect(place([cover])).toBeDefined();
    expect(place([cover], [blocked])).toBeUndefined();
  });
});
