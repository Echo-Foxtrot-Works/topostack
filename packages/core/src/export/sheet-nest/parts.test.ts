import { describe, expect, it } from "vitest";
import { generateGeometry } from "../../pipeline/generate.js";
import { pointInRing, realSource } from "../../test-support/sources.js";
import { DEFAULT_PROJECT, type NestPartV1, type Point2D } from "../../types.js";
import { sheetNestJobKey } from "./job-key.js";
import { MAX_OUTLINE_VERTICES, clusterSmallParts, nestableParts, partOutline } from "./parts.js";
import { DEFAULT_SHEET_NESTING } from "./resolve.js";
import { signedArea } from "../../primitives/geometry2d.js";

const settings = { ...DEFAULT_SHEET_NESTING, sheetWidthMm: 600, sheetHeightMm: 400 };

describe("nestable parts", () => {
  const ir = generateGeometry(DEFAULT_PROJECT, realSource());
  const parts = nestableParts(ir);

  it("puts every polygon in exactly one part and keeps nest families rigid", () => {
    expect(ir.fabricationNests.length).toBeGreaterThan(0);
    const owner = new Map<string, string>();
    for (const part of parts) {
      for (const member of part.members) {
        for (const polygonIndex of member.polygonIndexes) {
          const key = `${member.layerIndex}:${polygonIndex}`;
          expect(owner.has(key)).toBe(false);
          owner.set(key, part.id);
        }
      }
    }
    const polygonCount = ir.layers.reduce((sum, layer) => sum + layer.polygons.filter((polygon) => polygon.outer.length >= 4).length, 0);
    expect(owner.size).toBe(polygonCount);
    for (const nest of ir.fabricationNests) {
      for (const cavity of nest.cavities) {
        // The child travels with the part its donor polygon belongs to.
        const donorPart = owner.get(`${nest.donorLayerIndex}:${cavity.donorPolygonIndex}`);
        expect(owner.get(`${nest.nestedLayerIndex}:${cavity.nestedPolygonIndex}`)).toBe(donorPart);
      }
    }
  });

  it("wraps every member's cut line in a counter-clockwise outline within the vertex budget", () => {
    for (const part of parts) {
      expect(part.outline.length - 1).toBeLessThanOrEqual(MAX_OUTLINE_VERTICES);
      expect(signedArea(part.outline)).toBeGreaterThan(0);
      expect(part.outline[0]).toEqual(part.outline.at(-1));
      for (const member of part.members) {
        for (const polygonIndex of member.polygonIndexes) {
          const outer = ir.layers[member.layerIndex]!.polygons[polygonIndex]!.outer;
          expect(outer.every((point) => pointInRing(point, part.outline))).toBe(true);
        }
      }
    }
  });

  it("labels parts by layer, or by piece id when the model is split", () => {
    expect(parts.some((part) => /^L\d{2}(-\d+)?$/.test(part.label))).toBe(true);
    const project = { ...DEFAULT_PROJECT, workAreaWidthMm: 160, workAreaHeightMm: 120 };
    const split = generateGeometry(project, realSource(project));
    expect(split.splitPlan).toBeDefined();
    const splitParts = nestableParts(split);
    const pieceIds = new Set(split.layers.flatMap((layer) => layer.pieces.map((piece) => piece.id)));
    expect(splitParts.every((part) => pieceIds.has(part.label) || /^L\d{2}/.test(part.label))).toBe(true);
    expect(splitParts.filter((part) => pieceIds.has(part.label)).length).toBeGreaterThan(0);
  });

  it("simplifies long outlines only outward", () => {
    const circle: Point2D[] = Array.from({ length: 2000 }, (_, index) => {
      const angle = (index / 2000) * Math.PI * 2;
      return { x: 50 * Math.cos(angle) + 0.3 * Math.sin(angle * 97), y: 50 * Math.sin(angle) };
    });
    const ring = [...circle, circle[0]!];
    const outline = partOutline(ring, 0.15, 200);
    expect(outline.length - 1).toBeLessThanOrEqual(200);
    expect(ring.every((point) => pointInRing(point, outline))).toBe(true);
  });

  it("keys a job by content: stable across regeneration, sensitive to layout settings, blind to effort", () => {
    const again = nestableParts(generateGeometry(DEFAULT_PROJECT, realSource()));
    const key = sheetNestJobKey(parts, settings);
    expect(key).toMatch(/^nest2-[0-9a-f]{16}$/);
    expect(sheetNestJobKey(again, settings)).toBe(key);
    expect(sheetNestJobKey(parts, { ...settings, timeBudgetS: 120 })).toBe(key);
    expect(sheetNestJobKey(parts, { ...settings, spacingMm: 3 })).not.toBe(key);
    expect(sheetNestJobKey(parts.slice(1), settings)).not.toBe(key);
  });
});

describe("small part groups", () => {
  const square = (id: string, x: number, y: number, size: number, rootLayerIndex = 2): NestPartV1 => {
    const outline = [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }, { x, y }];
    return { id, label: id.toUpperCase(), rootLayerIndex, members: [{ layerIndex: rootLayerIndex, polygonIndexes: [Number(id.slice(id.indexOf(":") + 1))] }], outline, areaMm2: size * size };
  };

  it("groups neighbouring islands of one layer and leaves the rest alone", () => {
    const parts = [
      square("layer-03:1", 0, 0, 10),
      square("layer-03:2", 14, 0, 10),
      square("layer-03:3", 0, 14, 10),
      square("layer-03:4", 200, 200, 10),
      square("layer-04:1", 16, 16, 10, 3),
      square("layer-03:5", 30, 0, 40),
    ];
    const result = clusterSmallParts(parts);
    const group = result.find((part) => part.id.includes("+"))!;
    expect(group.id).toBe("layer-03:1+layer-03:2+layer-03:3");
    expect(group.label).toBe("LAYER-03:1 LAYER-03:2 LAYER-03:3");
    expect(group.members).toEqual([{ layerIndex: 2, polygonIndexes: [1, 2, 3] }]);
    const corners = parts.slice(0, 3).flatMap((part) => part.outline);
    expect(corners.every((point) => pointInRing(point, group.outline) || group.outline.some((corner) => corner.x === point.x && corner.y === point.y))).toBe(true);
    expect(result.map((part) => part.id).sort()).toEqual(["layer-03:1+layer-03:2+layer-03:3", "layer-03:4", "layer-03:5", "layer-04:1"]);
  });

  it("requires clearance from every member, including a contained or intersecting outline", () => {
    const seed = square("layer-03:1", 0, 0, 10);
    const neighbour = square("layer-03:2", 14, 0, 10);
    // Clear of the seed, but inside the second piece.
    const inside = square("layer-03:3", 15, 1, 5);
    expect(clusterSmallParts([seed, neighbour, inside], 2).map((part) => part.id).sort())
      .toEqual(["layer-03:1+layer-03:2", "layer-03:3"]);
    const crossing = square("layer-03:4", 9, 9, 5);
    expect(clusterSmallParts([seed, crossing], 0)).toHaveLength(2);
  });

  it("refuses a group whose hull would mostly be empty", () => {
    // Two slivers at right angles: their hull is a large triangle.
    const along = { ...square("layer-03:1", 0, 0, 1), outline: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }], areaMm2: 18 };
    const up = { ...square("layer-03:2", 0, 0, 1), outline: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 21 }, { x: 0, y: 21 }, { x: 0, y: 3 }], areaMm2: 18 };
    expect(clusterSmallParts([along, up]).map((part) => part.id)).toEqual(["layer-03:1", "layer-03:2"]);
  });

  it("keeps every polygon in exactly one part after grouping", () => {
    const project = { ...DEFAULT_PROJECT, workAreaWidthMm: 160, workAreaHeightMm: 120 };
    const parts = nestableParts(generateGeometry(project, realSource(project)));
    const polygons = parts.flatMap((part) => part.members.flatMap((member) => member.polygonIndexes.map((index) => `${member.layerIndex}:${index}`)));
    expect(new Set(polygons).size).toBe(polygons.length);
  });
});
