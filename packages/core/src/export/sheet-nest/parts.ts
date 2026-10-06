import { ringBounds, signedArea, simplifyClosedRing } from "../../primitives/geometry2d.js";
import { offsetClosedRing } from "../../primitives/offset.js";
import type { GeometryIRV1, NestPartV1, Point2D } from "../../types.js";
import { nestFamilies, rootPolygonByPolygon } from "../panel-layout.js";
import { convexHull } from "./transform.js";

/** Vertex budget per outline sent to the packer; more costs time without better layouts. */
export const MAX_OUTLINE_VERTICES = 400;

/** Outward error steps tried, in millimetres, until an outline fits the vertex budget. */
const SIMPLIFY_STEPS_MM = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6];

function counterClockwise(ring: Point2D[]): Point2D[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/**
 * A closed, counter-clockwise ring containing everything the laser cuts for
 * this outer boundary: the kerf envelope, simplified only outward. Douglas-
 * Peucker keeps every dropped point within the tolerance of the thinned ring,
 * so growing the thinned ring by the same tolerance contains the original.
 */
export function partOutline(outer: Point2D[], kerfMm: number, maxVertices = MAX_OUTLINE_VERTICES): Point2D[] {
  const envelope = counterClockwise(offsetClosedRing(outer, kerfMm / 2, "miter")[0] ?? outer);
  if (envelope.length - 1 <= maxVertices) return envelope;
  for (const tolerance of SIMPLIFY_STEPS_MM) {
    const grown = offsetClosedRing(simplifyClosedRing(envelope, tolerance), tolerance, "miter")[0];
    if (grown && grown.length - 1 <= maxVertices) return counterClockwise(grown);
  }
  return convexHull(envelope);
}

/**
 * The rigid parts a project is cut as. A polygon cut out of another (a
 * material nest) shares its cut line with its donor, so it travels with the
 * donor's root polygon; everything else is a part of its own. Seam-split
 * layers already hold one polygon per piece.
 */
export function nestableParts(ir: GeometryIRV1): NestPartV1[] {
  const parts: NestPartV1[] = [];
  for (const family of nestFamilies(ir)) {
    const roots = rootPolygonByPolygon(ir, family);
    const root = ir.layers[family.rootLayerIndex];
    if (!root) continue;
    // Key: root layer and polygon the member is cut from.
    const groups = new Map<string, { rootLayerIndex: number; rootPolygonIndex: number; members: Map<number, number[]> }>();
    for (const layerIndex of family.layerIndexes) {
      const layer = ir.layers[layerIndex];
      layer?.polygons.forEach((polygon, polygonIndex) => {
        if (polygon.outer.length < 4) return;
        const rootPolygonIndex = roots.get(layerIndex)?.get(polygonIndex);
        // A polygon with no traced donor stands alone rather than being dropped.
        const [rootLayerIndex, rootIndex] = rootPolygonIndex === undefined ? [layerIndex, polygonIndex] : [family.rootLayerIndex, rootPolygonIndex];
        const key = `${rootLayerIndex}:${rootIndex}`;
        const group = groups.get(key) ?? { rootLayerIndex, rootPolygonIndex: rootIndex, members: new Map<number, number[]>() };
        group.members.set(layerIndex, [...(group.members.get(layerIndex) ?? []), polygonIndex]);
        groups.set(key, group);
      });
    }
    for (const group of groups.values()) {
      const layer = ir.layers[group.rootLayerIndex]!;
      const polygon = layer.polygons[group.rootPolygonIndex]!;
      const outline = partOutline(polygon.outer, ir.laserKerfMm);
      parts.push({
        id: `${layer.id}:${group.rootPolygonIndex}`,
        label: polygonLabel(ir, group.rootLayerIndex, group.rootPolygonIndex),
        rootLayerIndex: group.rootLayerIndex,
        members: [...group.members.entries()].sort(([left], [right]) => left - right).map(([layerIndex, polygonIndexes]) => ({ layerIndex, polygonIndexes: polygonIndexes.sort((left, right) => left - right) })),
        outline,
        areaMm2: Math.abs(signedArea(outline)),
      });
    }
  }
  const polygonIndexOf = (part: NestPartV1) => Number.parseInt(part.id.slice(part.id.indexOf(":") + 1), 10);
  return clusterSmallParts(parts).sort((left, right) => left.rootLayerIndex - right.rootLayerIndex || polygonIndexOf(left) - polygonIndexOf(right));
}

/** Parts smaller than this (about 20 × 20 mm) may be grouped with their neighbours. */
const SMALL_PART_MM2 = 400;
/** Small parts closer than this travel together. */
const CLUSTER_GAP_MM = 10;
/** A group's hull may waste at most this multiple of its parts' own area. */
const CLUSTER_HULL_RATIO = 3;
const MAX_CLUSTER_PARTS = 12;

function boundsGap(left: Point2D[], right: Point2D[]): number {
  const a = ringBounds(left);
  const b = ringBounds(right);
  return Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY, 0);
}

/**
 * Tiny islands of one layer (peaks, seam slivers) cost the packer as much as
 * a whole layer each. Neighbouring ones are grouped into one rigid part
 * outlined by their convex hull, so they keep their places relative to each
 * other on the sheet and are found together. A group is only formed while
 * its hull stays compact, so it never wastes more than a small area.
 */
export function clusterSmallParts(parts: NestPartV1[]): NestPartV1[] {
  const small = parts.filter((part) => part.areaMm2 < SMALL_PART_MM2).sort((left, right) => right.areaMm2 - left.areaMm2 || left.id.localeCompare(right.id));
  const taken = new Set<string>();
  const merged: NestPartV1[] = [];
  for (const seed of small) {
    if (taken.has(seed.id)) continue;
    taken.add(seed.id);
    const group = [seed];
    let hull = seed.outline;
    let grown = true;
    while (grown && group.length < MAX_CLUSTER_PARTS) {
      grown = false;
      for (const candidate of small) {
        if (taken.has(candidate.id) || candidate.rootLayerIndex !== seed.rootLayerIndex || boundsGap(hull, candidate.outline) > CLUSTER_GAP_MM) continue;
        const next = convexHull([...hull, ...candidate.outline]);
        const ownArea = [...group, candidate].reduce((sum, part) => sum + part.areaMm2, 0);
        if (Math.abs(signedArea(next)) > CLUSTER_HULL_RATIO * ownArea) continue;
        group.push(candidate);
        taken.add(candidate.id);
        hull = next;
        grown = true;
        if (group.length >= MAX_CLUSTER_PARTS) break;
      }
    }
    if (group.length > 1) merged.push(mergeParts(group, hull));
  }
  const grouped = new Set(merged.flatMap((part) => part.id.split("+")));
  return [...parts.filter((part) => !grouped.has(part.id)), ...merged];
}

function mergeParts(group: NestPartV1[], hull: Point2D[]): NestPartV1 {
  const ordered = [...group].sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  const members = new Map<number, number[]>();
  for (const part of ordered) for (const { layerIndex, polygonIndexes } of part.members) members.set(layerIndex, [...(members.get(layerIndex) ?? []), ...polygonIndexes]);
  const labels = ordered.map((part) => part.label);
  return {
    id: ordered.map((part) => part.id).join("+"),
    label: labels.length <= 3 ? labels.join(" ") : `${labels[0]} +${labels.length - 1}`,
    rootLayerIndex: ordered[0]!.rootLayerIndex,
    members: [...members.entries()].sort(([left], [right]) => left - right).map(([layerIndex, polygonIndexes]) => ({ layerIndex, polygonIndexes: polygonIndexes.sort((left, right) => left - right) })),
    outline: hull,
    areaMm2: Math.abs(signedArea(hull)),
  };
}

/** The seam piece id when the layer was split, otherwise `L03`, or `L03-2` for a layer's second island. */
export function polygonLabel(ir: GeometryIRV1, layerIndex: number, polygonIndex: number): string {
  const layer = ir.layers[layerIndex]!;
  const piece = layer.pieces.find((candidate) => candidate.polygonIndex === polygonIndex);
  if (piece) return piece.id;
  const base = `L${String(layerIndex + 1).padStart(2, "0")}`;
  return layer.polygons.length > 1 ? `${base}-${polygonIndex + 1}` : base;
}
