import { ringBounds, signedArea, type Bounds2D } from "../primitives/geometry2d.js";
import { clipPolygons } from "../primitives/offset.js";
import { normalizedPolygons } from "./water-inserts.js";
import type { AirspaceLevelIR, AirspacePieceIR, AirspaceSectorIR, Polygon2D } from "../types.js";

/** Smallest acrylic fragment worth supporting and assembling: 10 cm². */
export const AIRSPACE_MIN_PIECE_MM2 = 1_000;

const area = (polygons: Polygon2D[]) => polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((holes, ring) => holes + Math.abs(signedArea(ring)), 0), 0);
const overlaps = (a: Bounds2D, b: Bounds2D) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * Class D lids keep their charted height. Otherwise blue owns shared acrylic
 * before magenta, with source IDs breaking ties. Losing pieces are carved,
 * never raised or lowered; the owner records every sector in the shared area.
 * Bounds and vertical intervals avoid booleans for disjoint sheets.
 */
export function partitionAirspace(levels: AirspaceLevelIR[], sectors: AirspaceSectorIR[], thicknessMm: number, minimumFeatureMm: number): { levels: AirspaceLevelIR[]; dropped: number; ownershipChanged: AirspacePieceIR[] } {
  const lids = new Set(sectors.filter((sector) => sector.aviationClass === "class-d").map((sector) => sector.id));
  const entries = levels.flatMap((level) => level.pieces.map((piece) => ({ level, piece, bounds: ringBounds(piece.polygons.flatMap((polygon) => polygon.outer)), rank: piece.sectorIds.some((id) => lids.has(id)) ? 0 : piece.tint === "magenta" ? 2 : 1, key: [...piece.sectorIds].sort().join("\0") })));
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  entries.sort((a, b) => a.rank - b.rank || a.level.zMm - b.level.zMm || compare(a.key, b.key) || compare(a.piece.id, b.piece.id));
  const priority = new Map(entries.map((entry, index) => [entry, index]));
  const byHeight = [...entries].sort((a, b) => a.level.zMm - b.level.zMm);
  const lowerBound = (zMm: number) => {
    let low = 0, high = byHeight.length;
    while (low < high) { const middle = (low + high) >>> 1; if (byHeight[middle]!.level.zMm < zMm) low = middle + 1; else high = middle; }
    return low;
  };
  let dropped = 0;
  const changed = new Set<AirspacePieceIR>();
  for (let index = 0; index < entries.length; index += 1) {
    const owner = entries[index]!;
    if (!owner.piece.polygons.length) continue;
    for (let next = lowerBound(owner.level.zMm - thicknessMm + 1e-6); next < byHeight.length; next += 1) {
      const other = byHeight[next]!;
      if (other.level.zMm >= owner.level.zMm + thicknessMm - 1e-6) break;
      if (priority.get(other)! <= index) continue;
      if (!other.piece.polygons.length || Math.abs(owner.level.zMm - other.level.zMm) >= thicknessMm - 1e-6 || !overlaps(owner.bounds, other.bounds)) continue;
      const shared = clipPolygons(owner.piece.polygons, other.piece.polygons, "intersection");
      if (area(shared) <= 0.01) continue;
      changed.add(owner.piece); changed.add(other.piece);
      owner.piece.sectorIds = [...new Set([...owner.piece.sectorIds, ...other.piece.sectorIds])].sort();
      const remainder = normalizedPolygons(clipPolygons(other.piece.polygons, owner.piece.polygons, "difference"), minimumFeatureMm);
      other.piece.polygons = remainder.filter((polygon) => area([polygon]) >= AIRSPACE_MIN_PIECE_MM2);
      dropped += remainder.length - other.piece.polygons.length;
      if (other.piece.frost) other.piece.frost = clipPolygons(other.piece.frost, other.piece.polygons, "intersection");
    }
  }
  const ownershipChanged: AirspacePieceIR[] = [];
  const partitioned = levels.map((level) => ({ ...level, pieces: level.pieces.flatMap((piece) => piece.polygons.map((polygon) => {
    const result = { ...piece, polygons: [polygon] };
    if (changed.has(piece)) ownershipChanged.push(result);
    return result;
  })) })).filter((level) => level.pieces.length);
  for (const [index, level] of partitioned.entries()) {
    level.index = index;
    level.pieces.forEach((piece, n) => { piece.id = `A${index + 1}-${n + 1}`; });
  }
  return { levels: partitioned, dropped, ownershipChanged };
}
