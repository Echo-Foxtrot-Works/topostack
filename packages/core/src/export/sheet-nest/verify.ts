import { ringBounds, signedArea, type Bounds2D } from "../../primitives/geometry2d.js";
import { clipPolygons, offsetClosedRing } from "../../primitives/offset.js";
import type { NestPartV1, NestPlacementV1, Point2D, ResolvedSheetNestSettings, SheetNestPlanV1 } from "../../types.js";
import { transformPoints } from "./transform.js";

/**
 * How far a placed outline may cross the usable sheet edge, or fall short of
 * the spacing. The engine works in single precision and may cross the edge by
 * its 0.01 mm fit tolerance; both are far under a laser kerf.
 */
export const PLACEMENT_TOLERANCE_MM = 0.02;

export interface PlacedOutline {
  partId: string;
  label: string;
  points: Point2D[];
  bounds: Bounds2D;
}

function placeOutlines(partsById: Map<string, NestPartV1>, placements: NestPlacementV1[]): PlacedOutline[] {
  return placements.flatMap((placement) => {
    const part = partsById.get(placement.partId);
    if (!part) return [];
    const points = transformPoints(part.outline, { rotationDeg: placement.rotationDeg, x: placement.xMm, y: placement.yMm });
    return [{ partId: part.id, label: part.label, points, bounds: ringBounds(points) }];
  });
}

/** Problems with one sheet: parts past the margin, or closer together than the spacing. */
export function verifySheet(partsById: Map<string, NestPartV1>, placements: NestPlacementV1[], settings: ResolvedSheetNestSettings): string[] {
  const problems: string[] = [];
  for (const placement of placements) {
    if (!partsById.has(placement.partId)) problems.push(`Unknown part ${placement.partId}.`);
  }
  const placed = placeOutlines(partsById, placements);
  const low = settings.marginMm - PLACEMENT_TOLERANCE_MM;
  const highX = settings.sheetWidthMm - settings.marginMm + PLACEMENT_TOLERANCE_MM;
  const highY = settings.sheetHeightMm - settings.marginMm + PLACEMENT_TOLERANCE_MM;
  for (const outline of placed) {
    const { bounds } = outline;
    if (bounds.minX < low || bounds.minY < low || bounds.maxX > highX || bounds.maxY > highY) problems.push(`${outline.label} reaches past the sheet margin.`);
  }
  // Grow each outline by half the spacing, less the tolerance: two grown
  // outlines only overlap when the parts are closer than the spacing allows.
  const grow = settings.spacingMm / 2 - PLACEMENT_TOLERANCE_MM / 2;
  const grown = new Map<number, Point2D[][]>();
  const grownOf = (index: number) => {
    // Round joins measure true distance; a miter overshoots sharp corners by up to twice the offset.
    if (!grown.has(index)) grown.set(index, offsetClosedRing(placed[index]!.points, grow, "round"));
    return grown.get(index)!;
  };
  for (let first = 0; first < placed.length; first += 1) {
    for (let second = first + 1; second < placed.length; second += 1) {
      const a = placed[first]!.bounds;
      const b = placed[second]!.bounds;
      const reach = settings.spacingMm;
      if (a.maxX + reach < b.minX || b.maxX + reach < a.minX || a.maxY + reach < b.minY || b.maxY + reach < a.minY) continue;
      const overlap = clipPolygons(
        grownOf(first).map((outer) => ({ outer, holes: [] })),
        grownOf(second).map((outer) => ({ outer, holes: [] })),
        "intersection",
      ).reduce((sum, polygon) => sum + Math.abs(signedArea(polygon.outer)), 0);
      if (overlap > 1e-3) problems.push(`${placed[first]!.label} and ${placed[second]!.label} are closer than the spacing.`);
    }
  }
  return problems;
}

/** Problems with a whole plan: every part placed exactly once, and every sheet valid. */
export function verifySheetPlan(parts: NestPartV1[], plan: Pick<SheetNestPlanV1, "sheets" | "settings">): string[] {
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const counts = new Map<string, number>();
  plan.sheets.forEach((sheet) => sheet.placements.forEach((placement) => counts.set(placement.partId, (counts.get(placement.partId) ?? 0) + 1)));
  const problems = parts.flatMap((part) => {
    const count = counts.get(part.id) ?? 0;
    return count === 1 ? [] : [count === 0 ? `${part.label} is not on any sheet.` : `${part.label} is placed ${count} times.`];
  });
  plan.sheets.forEach((sheet, index) => {
    for (const problem of verifySheet(partsById, sheet.placements, plan.settings)) problems.push(`Sheet ${index + 1}: ${problem}`);
  });
  return problems;
}
