import { offsetPolygons } from "../primitives/offset.js";
import { ringBounds } from "../primitives/geometry2d.js";
import { markingsWithin } from "../pipeline/marking-clip.js";
import { normalizedPolygons } from "../pipeline/water-inserts.js";
import { acrylicPanelGroups } from "../pipeline/water-insert-panels.js";
import { panelBounds, type FabricationPanel } from "./panel-layout.js";
import { nestableParts } from "./sheet-nest/parts.js";
import { resolveSheetNestSettings, type SheetNestSettingsResult } from "./sheet-nest/resolve.js";
import type { GeometryIRV1, LayerIR, LayerPieceV1, NestPartV1, ProjectConfigV1 } from "../types.js";

/**
 * The inserts as a geometry of their own, so the panel, SVG, master and
 * sheet-nesting writers cut acrylic exactly as they cut wood. One layer per
 * wood sheet that holds inserts, named `acrylic-NN` after it; each polygon is
 * an insert shrunk by the fit clearance and keeps its `W` id as its piece id.
 * The acrylic kerf replaces the wood's, so the outline moves out by half of
 * it and island holes move in. Undefined when there is nothing to cut.
 *
 * `markings: false` leaves the engraving out, for callers that need only the
 * outlines (the sheet nesting parts) and would otherwise pay to clip it.
 */
export function acrylicGeometry(ir: GeometryIRV1, { markings: withMarkings = true }: { markings?: boolean } = {}): GeometryIRV1 | undefined {
  const inserts = ir.waterInserts ?? [];
  const material = ir.waterInsertMaterial;
  if (!inserts.length || !material) return undefined;
  const woodLayers = [...new Set(inserts.map((insert) => insert.layerIndex))].sort((left, right) => left - right);
  const layers: LayerIR[] = woodLayers.map((woodLayerIndex, index) => {
    const wood = ir.layers[woodLayerIndex];
    const polygons: LayerIR["polygons"] = [];
    const pieces: LayerPieceV1[] = [];
    const markings: LayerIR["markings"] = [];
    for (const insert of inserts.filter((entry) => entry.layerIndex === woodLayerIndex)) {
      const fitted = normalizedPolygons(offsetPolygons(insert.polygons, -material.fitClearanceMm, "miter"), 0);
      fitted.forEach((polygon, part) => {
        const bounds = ringBounds(polygon.outer);
        pieces.push({ polygonIndex: polygons.length, id: fitted.length > 1 ? `${insert.id}-${part + 1}` : insert.id, column: 0, row: 0, exempt: false, widthMm: bounds.maxX - bounds.minX, heightMm: bounds.maxY - bounds.minY });
        polygons.push(polygon);
      });
      if (withMarkings) markings.push(...markingsWithin(insert.markings, fitted, "inside", { keepKnockouts: true }));
    }
    return {
      id: `acrylic-${String(woodLayerIndex + 1).padStart(2, "0")}`,
      index,
      elevationM: wood?.elevationM ?? 0,
      materialThicknessMm: material.thicknessMm,
      polygons,
      markings,
      pieces,
    };
  });
  return {
    ...ir,
    projectName: `${ir.projectName} acrylic`,
    laserKerfMm: material.kerfMm,
    layers,
    waterSurfaces: [],
    fabricationNests: [],
    paintRegions: [],
    waterInserts: undefined,
    waterInsertMaterial: undefined,
    splitPlan: undefined,
  };
}

/** Which wood layer each acrylic layer replaces, by acrylic layer index. */
export function acrylicWoodLayers(ir: GeometryIRV1): number[] {
  return [...new Set((ir.waterInserts ?? []).map((insert) => insert.layerIndex))].sort((left, right) => left - right);
}

/**
 * Unnested acrylic panels, grouped as `acrylicPanelGroups` says: every insert
 * of one wood layer on one canvas just large enough for them, or each insert
 * on its own panel when together they outgrow the machine. Acrylic is never
 * seam-split, since a seam would show in the water.
 */
export function acrylicPanels(generated: GeometryIRV1, acrylic: GeometryIRV1, config: ProjectConfigV1): FabricationPanel[] {
  const material = generated.waterInsertMaterial;
  if (!material) return [];
  const woodLayers = acrylicWoodLayers(generated);
  return acrylicPanelGroups(generated.waterInserts ?? [], material, config).map((group) => {
    const layerIndex = woodLayers.indexOf(group[0]!.layerIndex);
    const layer = acrylic.layers[layerIndex]!;
    // An insert the clearance split into parts keeps them together, as `W1-1`, `W1-2`.
    const ids = new Set(group.map((insert) => insert.id));
    const polygonIndexes = layer.pieces.filter((piece) => ids.has(piece.id.replace(/-\d+$/, ""))).map((piece) => piece.polygonIndex);
    const included = new Map([[layerIndex, new Set(polygonIndexes)]]);
    const whole = polygonIndexes.length === layer.polygons.length;
    return { rootLayerIndex: layerIndex, layerIndexes: [layerIndex], ...(whole ? {} : { cellName: group[0]!.id }), included, ...panelBounds(acrylic, [layerIndex], included) };
  });
}

/** The acrylic stock sheets: the project's acrylic sheet setting, falling back to the machine work area like wood. */
export function resolveAcrylicNestSettings(config: ProjectConfigV1): SheetNestSettingsResult {
  return resolveSheetNestSettings({ sheetNesting: config.waterInsertSheetNesting, workAreaWidthMm: config.workAreaWidthMm, workAreaHeightMm: config.workAreaHeightMm });
}

/** Acrylic parts to nest: one per insert, named by its `W` id. Empty without inserts. */
export function acrylicNestableParts(ir: GeometryIRV1): NestPartV1[] {
  const acrylic = acrylicGeometry(ir, { markings: false });
  return acrylic ? nestableParts(acrylic) : [];
}
