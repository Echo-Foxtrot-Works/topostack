import { describe, expect, it } from "vitest";
import { labelDimensions } from "../annotate/labels.js";
import { distanceToSegment, pointInRing } from "../test-support/sources.js";
import { DEFAULT_PROJECT, type LayerIR, type LayerPieceV1, type OperationPath, type Point2D, type Polygon2D } from "../types.js";
import { alignmentGuideMarkings } from "./alignment.js";

const config = { ...DEFAULT_PROJECT, laserKerfMm: 0.5 };

function rect(minX: number, minY: number, maxX: number, maxY: number): Polygon2D {
  return { outer: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }], holes: [] };
}

function layer(index: number, polygons: Polygon2D[], pieces: LayerPieceV1[] = []): LayerIR {
  return { id: `layer-${String(index + 1).padStart(2, "0")}`, index, elevationM: index * 100, materialThicknessMm: 3, polygons, markings: [], pieces };
}

function distanceToRing(point: Point2D, ring: Point2D[]): number {
  return Math.min(...ring.slice(0, -1).map((start, index) => distanceToSegment(point, start, ring[index + 1]!)));
}

const outlines = (markings: OperationPath[]) => markings.filter((marking) => !marking.label);
const labels = (markings: OperationPath[]) => markings.filter((marking) => marking.label);

/** The label's text box lies inside `ring`. */
function labelInside(marking: OperationPath, ring: Point2D[]): boolean {
  const { width, height } = labelDimensions(marking.label!, marking.textStyle);
  const origin = marking.points[0]!;
  return [origin, { x: origin.x + width, y: origin.y }, { x: origin.x, y: origin.y + height }, { x: origin.x + width, y: origin.y + height }].every((corner) => pointInRing(corner, ring));
}

describe("alignment guide markings", () => {
  const base = layer(0, [rect(-100, -80, 100, 80)]);

  it("draws nothing when the layer above is empty", () => {
    expect(alignmentGuideMarkings(config, base, layer(1, []))).toEqual([]);
  });

  it("traces the next layer's footprint one kerf inside its cut line and names it", () => {
    const next = layer(1, [rect(-40, -30, 40, 30)]);
    const markings = alignmentGuideMarkings(config, base, next);
    expect(markings.every((marking) => marking.operation === "engrave" && marking.kind === "guide")).toBe(true);
    expect(outlines(markings).length).toBeGreaterThan(0);
    for (const point of outlines(markings).flatMap((marking) => marking.points)) {
      expect(pointInRing(point, next.polygons[0]!.outer)).toBe(true);
      expect(distanceToRing(point, next.polygons[0]!.outer)).toBeCloseTo(config.laserKerfMm, 3);
    }
    const [label] = labels(markings);
    expect(label).toMatchObject({ label: "L02", id: "alignment-layer-01-to-02-0-label", textStyle: config.textStyle });
    expect(labelInside(label!, next.polygons[0]!.outer)).toBe(true);
    expect(new Set(markings.map((marking) => marking.id)).size).toBe(markings.length);
  });

  it("clips the guide to the material it is engraved on", () => {
    // The upper piece overhangs the right edge of this layer.
    const next = layer(1, [rect(40, -30, 160, 30)]);
    const points = outlines(alignmentGuideMarkings(config, base, next)).flatMap((marking) => marking.points);
    expect(points.length).toBeGreaterThan(0);
    expect(Math.max(...points.map((point) => point.x))).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("names split pieces by piece id and outlines the supplied piece outlines", () => {
    const pieces = [rect(-60, -30, 0, 30), rect(0, -30, 60, 30)];
    const next = layer(1, pieces, [
      { polygonIndex: 0, id: "L02-A1", column: 0, row: 0, exempt: false, widthMm: 60, heightMm: 60 },
      { polygonIndex: 1, id: "L02-B1", column: 1, row: 0, exempt: false, widthMm: 60, heightMm: 60 },
    ]);
    // One outline for the whole layer: the seam between the pieces is not traced.
    const whole = rect(-60, -30, 60, 30);
    const markings = alignmentGuideMarkings(config, base, next, [whole]);
    expect(labels(markings).map((marking) => marking.label).sort()).toEqual(["L02-A1", "L02-B1"]);
    labels(markings).forEach((marking) => expect(labelInside(marking, pieces[marking.label === "L02-A1" ? 0 : 1]!.outer)).toBe(true));
    const guidePoints = outlines(markings).flatMap((marking) => marking.points);
    expect(guidePoints.every((point) => distanceToRing(point, whole.outer) < config.laserKerfMm + 1e-3)).toBe(true);
    expect(guidePoints.some((point) => Math.abs(point.x) < 1)).toBe(false);
  });

  it("keeps the outline but drops the name when the piece cannot hold it", () => {
    const markings = alignmentGuideMarkings(config, base, layer(1, [rect(-2, -2, 2, 2)]));
    expect(outlines(markings).length).toBeGreaterThan(0);
    expect(labels(markings)).toEqual([]);
  });

  it("keeps names clear of the guide lines and of existing markings", () => {
    const next = layer(1, [rect(-40, -30, 40, 30)]);
    // A road straight through where the label would otherwise go.
    const road: OperationPath = { id: "road", operation: "engrave", kind: "road", points: [{ x: -40, y: 0 }, { x: 40, y: 0 }] };
    const [label] = labels(alignmentGuideMarkings(config, { ...base, markings: [road] }, next));
    const { height } = labelDimensions(label!.label!, label!.textStyle);
    const top = label!.points[0]!.y;
    expect(top > 0 || top + height < 0).toBe(true);
  });
});
