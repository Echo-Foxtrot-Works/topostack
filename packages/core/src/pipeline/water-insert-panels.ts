import { ringBounds } from "../primitives/geometry2d.js";
import type { ProjectConfigV1, WaterInsertIR, WaterInsertMaterialIR } from "../types.js";

// How acrylic inserts fill the machine bed. Kept apart from the cutting so the
// studio can count acrylic files on startup without loading the clipper.

/** The machine bed, unlimited on an axis set to 0. */
function workArea(config: Pick<ProjectConfigV1, "workAreaWidthMm" | "workAreaHeightMm">): { widthMm: number; heightMm: number } {
  return {
    widthMm: config.workAreaWidthMm > 0 ? config.workAreaWidthMm : Number.POSITIVE_INFINITY,
    heightMm: config.workAreaHeightMm > 0 ? config.workAreaHeightMm : Number.POSITIVE_INFINITY,
  };
}

/** Whether a piece of this size fits the machine bed, turned either way. */
export function fitsWorkArea(size: { widthMm: number; heightMm: number }, config: Pick<ProjectConfigV1, "workAreaWidthMm" | "workAreaHeightMm">): boolean {
  const bed = workArea(config);
  const fits = (width: number, height: number) => width <= bed.widthMm + 1e-6 && height <= bed.heightMm + 1e-6;
  return fits(size.widthMm, size.heightMm) || fits(size.heightMm, size.widthMm);
}

/**
 * The size the laser cuts for these inserts together: their nominal box,
 * shrunk by the fit clearance and grown by the acrylic kerf on every side.
 */
export function acrylicCutBounds(inserts: Array<Pick<WaterInsertIR, "polygons">>, material: Pick<WaterInsertMaterialIR, "kerfMm" | "fitClearanceMm">): { widthMm: number; heightMm: number } {
  const bounds = ringBounds(inserts.flatMap((insert) => insert.polygons.flatMap((polygon) => polygon.outer)));
  const grow = material.kerfMm - 2 * material.fitClearanceMm;
  return { widthMm: Math.max(0, bounds.maxX - bounds.minX + grow), heightMm: Math.max(0, bounds.maxY - bounds.minY + grow) };
}

/**
 * Which inserts share each unnested acrylic panel: every insert of one wood
 * sheet together, or one panel each when together they outgrow the machine.
 * The export, the oversize warning and the studio's file count all read this,
 * so they agree on what a panel is.
 */
export function acrylicPanelGroups<T extends Pick<WaterInsertIR, "id" | "layerIndex" | "polygons">>(inserts: T[], material: Pick<WaterInsertMaterialIR, "kerfMm" | "fitClearanceMm">, config: Pick<ProjectConfigV1, "workAreaWidthMm" | "workAreaHeightMm">): T[][] {
  const sheets = new Map<number, T[]>();
  for (const insert of inserts) sheets.set(insert.layerIndex, [...(sheets.get(insert.layerIndex) ?? []), insert]);
  return [...sheets.entries()].sort(([left], [right]) => left - right).flatMap(([, onSheet]) => (
    onSheet.length === 1 || fitsWorkArea(acrylicCutBounds(onSheet, material), config) ? [onSheet] : onSheet.map((insert) => [insert])
  ));
}
