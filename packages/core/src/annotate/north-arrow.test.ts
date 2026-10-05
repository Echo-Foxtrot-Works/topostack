import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, labelLineSegments, layerToSvg, northArrowMarkings } from "../index.js";
import { masterToSvg } from "../export/svg.js";
import { pointInPreparedPolygons, preparePolygons } from "../primitives/geometry2d.js";
import { distanceToSegment, gridSource, realSource, scaledForLayers } from "../test-support/sources.js";

describe("north arrow", () => {
  it("generates three distinct, scalable north-arrow engraving styles", () => {
    const expectedLabels = {
      minimal: ["N"],
      classic: ["E", "N", "S", "W"],
      mariner: [],
    } as const;
    const maximumRadius = (sizeMm: number, style: keyof typeof expectedLabels): number => {
      const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, northArrowStyle: style, northArrowSizeMm: sizeMm, northArrowPlacement: { anchor: "center" as const, offset: { x: 0, y: 0 } } };
      const result = generateGeometry(project, realSource(project));
      const markings = result.layers[0]!.markings.filter((marking) => marking.id.startsWith("north-"));
      expect(new Set(markings.map((marking) => marking.id)).size).toBe(markings.length);
      expect(markings.filter((marking) => marking.label).map((marking) => marking.label).sort()).toEqual([...expectedLabels[style]]);
      expect(result.layers.slice(1).every((layer) => layer.markings.every((marking) => !marking.id.startsWith("north-")))).toBe(true);
      expect(layerToSvg(result, result.layers[0]!)).toContain(markings[0]!.id);
      expect(masterToSvg(result)).toContain(markings[0]!.id);
      const points = markings.flatMap((marking) => marking.label && marking.points[0]
        ? labelLineSegments(marking.label, marking.points[0], 0, 0, marking.labelRotationRad, marking.textStyle).flatMap((segment) => [segment.start, segment.end])
        : marking.points);
      return Math.max(...points.map((point) => Math.hypot(point.x, point.y)));
    };

    for (const style of Object.keys(expectedLabels) as Array<keyof typeof expectedLabels>) {
      const small = maximumRadius(24, style);
      const large = maximumRadius(48, style);
      expect(large / small).toBeCloseTo(2, 6);
    }
  });

  it("keeps anchored north arrows inside rectangular and circular crops", () => {
    for (const cropShape of ["rectangle", "circle"] as const) {
      const project = {
        ...DEFAULT_PROJECT,
        cropShape,
        outputMode: "engraving" as const,
        widthMm: 200,
        heightMm: 200,
        northArrowStyle: "mariner" as const,
        northArrowSizeMm: 60,
        northArrowPlacement: { anchor: "top-left" as const, offset: { x: -1, y: -1 } },
      };
      const markings = generateGeometry(project, realSource(project)).layers[0]!.markings.filter((marking) => marking.id.startsWith("north-"));
      const points = markings.flatMap((marking) => marking.points);
      if (cropShape === "circle") expect(points.every((point) => Math.hypot(point.x, point.y) <= 97.001)).toBe(true);
      else expect(points.every((point) => Math.abs(point.x) <= 97.001 && Math.abs(point.y) <= 97.001)).toBe(true);
    }
  });

  it.each(["minimal", "classic", "mariner"] as const)("carries the %s north arrow and its letters across exposed terrain into SVG exports", (northArrowStyle) => {
    for (const cropShape of ["rectangle", "circle"] as const) {
      const base = {
        ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, cropShape,
        northArrowStyle, northArrowSizeMm: 80, optimizeMaterialUse: false,
        showWaterDepth: false, markers: [],
        northArrowPlacement: { anchor: "center" as const, offset: { x: 0, y: 0 } },
      };
      const [project, source] = scaledForLayers(base, gridSource(base, 64, (nx, ny) => 1000 + nx * 500 + ny * 100), 10);
      const result = generateGeometry(project, { ...source, markings: [] });
      const expectedSegments = northArrowMarkings(project).flatMap((marking) => marking.label
        ? labelLineSegments(marking.label, marking.points[0]!, 0, 0, marking.labelRotationRad, marking.textStyle)
        : marking.points.slice(1).map((end, index) => ({ start: marking.points[index]!, end })));
      const expectedLength = expectedSegments.reduce((sum, { start, end }) => sum + Math.hypot(end.x - start.x, end.y - start.y), 0);
      const master = masterToSvg(result);
      let actualLength = 0;
      let markedLayers = 0;
      for (const layer of result.layers) {
        const markings = layer.markings.filter((marking) => marking.id.startsWith("north-"));
        if (markings.length) markedLayers += 1;
        const material = preparePolygons(layer.polygons);
        const covering = preparePolygons(result.layers.slice(layer.index + 1).flatMap((upper) => upper.polygons));
        const svg = layerToSvg(result, layer);
        for (const marking of markings) {
          expect(svg).toContain(`id="${marking.id}"`);
          expect(master.split(`id="${marking.id}"`)).toHaveLength(2);
          for (let index = 1; index < marking.points.length; index += 1) {
            const start = marking.points[index - 1]!;
            const end = marking.points[index]!;
            actualLength += Math.hypot(end.x - start.x, end.y - start.y);
            const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
            expect(pointInPreparedPolygons(midpoint, material)).toBe(true);
            expect(pointInPreparedPolygons(midpoint, covering)).toBe(false);
            expect(expectedSegments.some((segment) => distanceToSegment(midpoint, segment.start, segment.end) < 1e-6)).toBe(true);
          }
        }
      }
      expect(markedLayers).toBeGreaterThan(1);
      expect(actualLength).toBeCloseTo(expectedLength, 5);
    }
  });
});
