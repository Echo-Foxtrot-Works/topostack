import { distanceToSegment, type Point2D, type Polygon2D } from "@topostack/core";

/** Two pieces meeting along a seam share their boundary to well under this. */
const SHARED_EDGE_TOLERANCE_MM = 1e-3;
const CELL_MM = 2;

type Segment = readonly [Point2D, Point2D];

function rings(polygon: Polygon2D): Point2D[][] {
  return [polygon.outer, ...polygon.holes];
}

/**
 * The cut lines between the pieces of one split layer: every boundary edge
 * that lies along another piece's boundary, tabs and sockets included. The
 * outline of the layer as a whole is left out - its extruded side walls
 * already draw it.
 *
 * Neighbouring pieces come out of the same seam cut, but separate boolean
 * operations can split a shared stretch at different vertices, so an edge
 * counts as shared when its midpoint sits on any other piece's edge rather
 * than when the two edges match vertex for vertex.
 */
export function sharedPieceEdges(polygons: Polygon2D[]): Segment[] {
  if (polygons.length < 2) return [];
  const grid = new Map<string, Array<{ owner: number; segment: Segment }>>();
  const cell = (value: number) => Math.floor(value / CELL_MM);
  polygons.forEach((polygon, owner) => {
    for (const ring of rings(polygon)) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const segment: Segment = [ring[index]!, ring[index + 1]!];
        const [start, end] = segment;
        for (let x = cell(Math.min(start.x, end.x) - SHARED_EDGE_TOLERANCE_MM); x <= cell(Math.max(start.x, end.x) + SHARED_EDGE_TOLERANCE_MM); x += 1) {
          for (let y = cell(Math.min(start.y, end.y) - SHARED_EDGE_TOLERANCE_MM); y <= cell(Math.max(start.y, end.y) + SHARED_EDGE_TOLERANCE_MM); y += 1) {
            const key = `${x},${y}`;
            const bucket = grid.get(key);
            if (bucket) bucket.push({ owner, segment });
            else grid.set(key, [{ owner, segment }]);
          }
        }
      }
    }
  });
  const shared: Segment[] = [];
  polygons.forEach((polygon, owner) => {
    for (const ring of rings(polygon)) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const start = ring[index]!;
        const end = ring[index + 1]!;
        const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        const bucket = grid.get(`${cell(middle.x)},${cell(middle.y)}`) ?? [];
        // Found from both sides of the seam; the two copies draw as one line.
        if (bucket.some((entry) => entry.owner !== owner && distanceToSegment(middle, ...entry.segment) <= SHARED_EDGE_TOLERANCE_MM)) shared.push([start, end]);
      }
    }
  });
  return shared;
}
