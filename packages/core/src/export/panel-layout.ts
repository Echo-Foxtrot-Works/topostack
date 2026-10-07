import { ringBounds } from "../primitives/geometry2d.js";
import { offsetClosedRing } from "../primitives/offset.js";
import type { FabricationPanelV1, GeometryIRV1 } from "../types.js";


export interface FabricationPanel extends FabricationPanelV1 {
  /** Polygon indexes to emit per layer index; absent when the project is cut whole. */
  included?: Map<number, Set<number>>;
  /** Set on a stock sheet of a nested export: the panel is in sheet coordinates and holds placed parts. */
  sheetIndex?: number;
}

/** A nest family: the root layer plus everything cut out of it, transitively. */
export function nestFamilies(ir: GeometryIRV1): Array<{ rootLayerIndex: number; layerIndexes: number[] }> {
  const parentByLayer = new Map(ir.fabricationNests.map((nest) => [nest.nestedLayerIndex, nest.donorLayerIndex]));
  const childrenByLayer = new Map<number, number[]>();
  ir.fabricationNests.forEach((nest) => childrenByLayer.set(nest.donorLayerIndex, [...(childrenByLayer.get(nest.donorLayerIndex) ?? []), nest.nestedLayerIndex]));
  const collect = (layerIndex: number): number[] => [layerIndex, ...(childrenByLayer.get(layerIndex) ?? []).flatMap(collect)];
  return ir.layers.filter((layer) => !parentByLayer.has(layer.index)).map((layer) => ({
    rootLayerIndex: layer.index,
    layerIndexes: collect(layer.index),
  }));
}

/**
 * A nested piece is cut out of its donor, so it ships on the donor's sheet
 * whatever its own layer's seam grid says. Walks each cavity back to the
 * family root and answers with that root polygon's index.
 */
export function rootPolygonByPolygon(ir: GeometryIRV1, family: { rootLayerIndex: number; layerIndexes: number[] }): Map<number, Map<number, number>> {
  const roots = new Map<number, Map<number, number>>();
  const root = ir.layers[family.rootLayerIndex];
  roots.set(family.rootLayerIndex, new Map(root?.polygons.map((_, index) => [index, index] as const) ?? []));
  // Donors always precede the layers nested in them, so one ascending pass
  // resolves every chain.
  for (const nest of ir.fabricationNests) {
    if (!family.layerIndexes.includes(nest.nestedLayerIndex)) continue;
    const donorRoots = roots.get(nest.donorLayerIndex);
    const nestedRoots = roots.get(nest.nestedLayerIndex) ?? new Map<number, number>();
    for (const cavity of nest.cavities) {
      const rootIndex = donorRoots?.get(cavity.donorPolygonIndex);
      if (rootIndex !== undefined) nestedRoots.set(cavity.nestedPolygonIndex, rootIndex);
    }
    roots.set(nest.nestedLayerIndex, nestedRoots);
  }
  return roots;
}

function cellName(column: number, row: number): string {
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

export function panelBounds(ir: GeometryIRV1, layerIndexes: number[], included?: Map<number, Set<number>>): Pick<FabricationPanelV1, "minX" | "minY" | "maxX" | "maxY"> {
  if (!included) {
    // Unsplit panels keep the whole-crop canvas they have always had.
    return { minX: -(ir.widthMm + ir.laserKerfMm) / 2, minY: -(ir.heightMm + ir.laserKerfMm) / 2, maxX: (ir.widthMm + ir.laserKerfMm) / 2, maxY: (ir.heightMm + ir.laserKerfMm) / 2 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const layerIndex of layerIndexes) {
    const layer = ir.layers[layerIndex];
    const indexes = included.get(layerIndex);
    if (!layer || !indexes) continue;
    for (const polygonIndex of indexes) {
      const polygon = layer.polygons[polygonIndex];
      if (!polygon) continue;
      // Measure the kerf-compensated ring the panel actually draws, not the
      // terrain ring: a miter join on a sharp corner reaches much further out
      // than half a kerf, and the canvas has to contain it.
      for (const ring of offsetClosedRing(polygon.outer, ir.laserKerfMm / 2, "miter")) {
        const bounds = ringBounds(ring);
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  // Path coordinates are written to three decimals, so round the canvas
  // outward to the same precision or a rounded-up vertex lands outside it.
  const floor = (value: number) => Math.floor(value * 1000) / 1000;
  const ceil = (value: number) => Math.ceil(value * 1000) / 1000;
  return { minX: floor(minX), minY: floor(minY), maxX: ceil(maxX), maxY: ceil(maxY) };
}

export function fabricationPanels(ir: GeometryIRV1): FabricationPanel[] {
  const families = nestFamilies(ir);
  const plan = ir.splitPlan;
  if (!plan) {
    return families.map((family) => ({ ...family, ...panelBounds(ir, family.layerIndexes) }));
  }
  // The largest canvas the machine holds: usable span plus the kerf the cut
  // envelope adds, which is how `planSeamGrid` sized the cells.
  const fits = (bounds: Pick<FabricationPanelV1, "minX" | "minY" | "maxX" | "maxY">) =>
    bounds.maxX - bounds.minX <= plan.usableWidthMm + ir.laserKerfMm + 1e-6 &&
    bounds.maxY - bounds.minY <= plan.usableHeightMm + ir.laserKerfMm + 1e-6;
  return families.flatMap((family) => {
    const roots = rootPolygonByPolygon(ir, family);
    const root = ir.layers[family.rootLayerIndex];
    if (!root) return [];
    // Sheet per root polygon, initially its seam cell. Nested polygons follow
    // the root polygon they are cut from.
    const sheetOf = new Map(root.pieces.map((piece) => [piece.polygonIndex, cellName(piece.column, piece.row)] as const));
    const exempt = new Set(root.pieces.filter((piece) => piece.exempt).map((piece) => piece.polygonIndex));
    const group = (): Map<string, Map<number, Set<number>>> => {
      const bySheet = new Map<string, Map<number, Set<number>>>();
      for (const layerIndex of family.layerIndexes) {
        const layer = ir.layers[layerIndex];
        if (!layer) continue;
        layer.polygons.forEach((_, polygonIndex) => {
          const rootIndex = roots.get(layerIndex)?.get(polygonIndex);
          const sheet = rootIndex === undefined ? undefined : sheetOf.get(rootIndex);
          if (!sheet) return;
          const included = bySheet.get(sheet) ?? new Map<number, Set<number>>();
          included.set(layerIndex, new Set([...(included.get(layerIndex) ?? []), polygonIndex]));
          bySheet.set(sheet, included);
        });
      }
      return bySheet;
    };
    const sheetFits = (sheets: Map<string, Map<number, Set<number>>>, name: string) => {
      const included = sheets.get(name);
      return !included || fits(panelBounds(ir, family.layerIndexes, included));
    };
    // An exempt piece is assigned to a cell by its centre and may reach past
    // that cell, so a cell's clipped pieces plus the straddler can outgrow the
    // bed. Peel straddlers onto extra sheets, widest first, until the cell fits;
    // a cell with no exempt piece left is already reported as oversize.
    let sheets = group();
    for (const cell of new Set(sheetOf.values())) {
      let extra = 0;
      while (!sheetFits(sheets, cell)) {
        const straddler = [...sheetOf.entries()]
          .filter(([polygonIndex, sheet]) => sheet === cell && exempt.has(polygonIndex))
          .map(([polygonIndex]) => ({ polygonIndex, bounds: ringBounds(root.polygons[polygonIndex]!.outer) }))
          .sort((left, right) => (right.bounds.maxX - right.bounds.minX) * (right.bounds.maxY - right.bounds.minY)
            - (left.bounds.maxX - left.bounds.minX) * (left.bounds.maxY - left.bounds.minY))[0];
        if (!straddler) break;
        let placed = false;
        for (let sheet = 1; sheet <= extra && !placed; sheet += 1) {
          sheetOf.set(straddler.polygonIndex, `${cell}-${sheet}`);
          const trial = group();
          if (sheetFits(trial, `${cell}-${sheet}`)) {
            sheets = trial;
            placed = true;
          }
        }
        if (!placed) {
          extra += 1;
          sheetOf.set(straddler.polygonIndex, `${cell}-${extra}`);
          sheets = group();
        }
      }
    }
    return [...sheets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sheetName, included]) => ({
        ...family,
        cellName: sheetName,
        included,
        ...panelBounds(ir, family.layerIndexes, included),
      }));
  });
}
