import { signedArea, type Polygon2D } from "@topostack/core";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { multiPolygonToAreas } from "$lib/domain/vector-cleanup";

/**
 * Areas whose tile pieces are joined by an id (an airspace sector, a public
 * land unit): the pieces unioned and cut to the crop.
 */

export function cropRectangle(widthMm: number, heightMm: number): MultiPolygon {
  const x = widthMm / 2;
  const y = heightMm / 2;
  return [[[[-x, -y], [x, -y], [x, y], [-x, y], [-x, -y]]]];
}

const toMultiPolygon = (polygons: Polygon2D[]): MultiPolygon => polygons.map((polygon) =>
  [polygon.outer, ...polygon.holes].map((ring) => ring.map((point) => [point.x, point.y] as Pair)));

/** One area's tile pieces unioned and cut to the crop; the buffers tiles share overlap exactly. */
export function piecesInCrop(polygons: Polygon2D[], crop: MultiPolygon, minimumFeatureMm: number): { polygons: Polygon2D[]; partial: boolean } {
  const pieces = toMultiPolygon(polygons);
  try {
    return { polygons: multiPolygonToAreas(polygonClipping.intersection(polygonClipping.union(pieces[0]!, ...pieces.slice(1)), crop), minimumFeatureMm), partial: false };
  } catch {
    // polygon-clipping can refuse near-degenerate input; cut the pieces one by one instead of losing the area.
    return { partial: true, polygons: pieces.flatMap((piece) => {
      try {
        return multiPolygonToAreas(polygonClipping.intersection([piece], crop), minimumFeatureMm);
      } catch {
        return [];
      }
    }) };
  }
}

export function polygonArea(polygon: Polygon2D): number {
  return Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
}
