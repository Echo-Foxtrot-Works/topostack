import { ringBounds } from "../primitives/geometry2d.js";
import { fitsWorkArea } from "./water-insert-panels.js";
import type { AirspacePieceIR, AirspaceStackIR, AirspaceTint, ProjectConfigV1 } from "../types.js";

/**
 * How airspace pieces are grouped onto panels: every piece of a level and tint
 * on one panel, or each on its own when together they outgrow the machine.
 * Light enough for the studio to count files without the clipper; the export
 * groups by the same rule, so the count always matches the package.
 */
export function airspacePanelGroups(stack: Pick<AirspaceStackIR, "levels" | "kerfMm">, config: Pick<ProjectConfigV1, "workAreaWidthMm" | "workAreaHeightMm">): Array<{ levelIndex: number; tint: AirspaceTint; pieces: AirspacePieceIR[] }> {
  const groups: Array<{ levelIndex: number; tint: AirspaceTint; pieces: AirspacePieceIR[] }> = [];
  for (const level of stack.levels) {
    for (const tint of ["clear", "blue", "magenta"] as const) {
      const pieces = level.pieces.filter((piece) => piece.tint === tint);
      if (!pieces.length) continue;
      const bounds = ringBounds(pieces.flatMap((piece) => piece.polygons.flatMap((polygon) => polygon.outer)));
      const size = { widthMm: bounds.maxX - bounds.minX + stack.kerfMm, heightMm: bounds.maxY - bounds.minY + stack.kerfMm };
      if (pieces.length === 1 || fitsWorkArea(size, config)) groups.push({ levelIndex: level.index, tint, pieces });
      else for (const piece of pieces) groups.push({ levelIndex: level.index, tint, pieces: [piece] });
    }
  }
  return groups;
}
