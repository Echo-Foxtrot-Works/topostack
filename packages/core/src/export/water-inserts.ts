import { offsetPolygons } from "../primitives/offset.js";
import { ringBounds } from "../primitives/geometry2d.js";
import { markingsWithin } from "../pipeline/marking-clip.js";
import { tidy } from "../pipeline/water-inserts.js";
import { panelBounds, type FabricationPanel } from "./panel-layout.js";
import { nestableParts } from "./sheet-nest/parts.js";
import { resolveSheetNestSettings, type SheetNestSettingsResult } from "./sheet-nest/resolve.js";
import type { GeometryIRV1, LayerIR, LayerPieceV1, NestPartV1, ProjectConfigV1, WaterInsertIR } from "../types.js";

/** One acrylic sheet's worth of inserts: every insert that sits in wood layer `layerIndex`. */
export interface AcrylicLayer {
  /** The wood layer the inserts replace; the acrylic layer is named after it. */
  woodLayerIndex: number;
  inserts: WaterInsertIR[];
}

/**
 * The inserts as a geometry of their own, so the panel, SVG, master and
 * sheet-nesting writers cut acrylic exactly as they cut wood. One layer per
 * wood sheet that holds inserts, named `acrylic-NN` after it; each polygon is
 * an insert shrunk by the fit clearance and keeps its `W` id as its piece id.
 * The acrylic kerf replaces the wood's, so the outline moves out by half of
 * it and island holes move in. Undefined when there is nothing to cut.
 */
export function acrylicGeometry(ir: GeometryIRV1): GeometryIRV1 | undefined {
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
      const fitted = tidy(offsetPolygons(insert.polygons, -material.fitClearanceMm, "miter"), 0);
      fitted.forEach((polygon, part) => {
        const bounds = ringBounds(polygon.outer);
        pieces.push({ polygonIndex: polygons.length, id: fitted.length > 1 ? `${insert.id}-${part + 1}` : insert.id, column: 0, row: 0, exempt: false, widthMm: bounds.maxX - bounds.minX, heightMm: bounds.maxY - bounds.minY });
        polygons.push(polygon);
      });
      markings.push(...markingsWithin(insert.markings, fitted, "inside", { keepKnockouts: true }));
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
 * Unnested acrylic panels: every insert of one wood layer on one canvas just
 * large enough for them. Acrylic is never seam-split, since a seam would show
 * in the water; when a layer's inserts together outgrow the machine, each
 * goes on its own panel instead.
 */
export function acrylicPanels(acrylic: GeometryIRV1, config: ProjectConfigV1): FabricationPanel[] {
  const bedWidth = config.workAreaWidthMm > 0 ? config.workAreaWidthMm : Number.POSITIVE_INFINITY;
  const bedHeight = config.workAreaHeightMm > 0 ? config.workAreaHeightMm : Number.POSITIVE_INFINITY;
  const fits = (bounds: Pick<FabricationPanel, "minX" | "minY" | "maxX" | "maxY">) => bounds.maxX - bounds.minX <= bedWidth + 1e-6 && bounds.maxY - bounds.minY <= bedHeight + 1e-6;
  return acrylic.layers.flatMap((layer) => {
    const all = new Map([[layer.index, new Set(layer.polygons.map((_, index) => index))]]);
    const whole = panelBounds(acrylic, [layer.index], all);
    if (layer.polygons.length === 1 || fits(whole)) return [{ rootLayerIndex: layer.index, layerIndexes: [layer.index], included: all, ...whole }];
    return layer.polygons.map((_, polygonIndex) => {
      const included = new Map([[layer.index, new Set([polygonIndex])]]);
      return { rootLayerIndex: layer.index, layerIndexes: [layer.index], cellName: layer.pieces[polygonIndex]!.id, included, ...panelBounds(acrylic, [layer.index], included) };
    });
  });
}

/** The acrylic stock sheets: the project's acrylic sheet setting, falling back to the machine work area like wood. */
export function resolveAcrylicNestSettings(config: ProjectConfigV1): SheetNestSettingsResult {
  return resolveSheetNestSettings({ sheetNesting: config.waterInsertSheetNesting, workAreaWidthMm: config.workAreaWidthMm, workAreaHeightMm: config.workAreaHeightMm });
}

/** Acrylic parts to nest: one per insert, named by its `W` id. Empty without inserts. */
export function acrylicNestableParts(ir: GeometryIRV1): NestPartV1[] {
  const acrylic = acrylicGeometry(ir);
  return acrylic ? nestableParts(acrylic) : [];
}
