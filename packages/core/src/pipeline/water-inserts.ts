import { signedArea, ringBounds } from "../primitives/geometry2d.js";
import { clipPolygons, offsetPolygons } from "../primitives/offset.js";
import { removeTinyRing } from "./contours.js";
import { markingsWithin } from "./marking-clip.js";
import { waterInsertLakeKey, type GeometryWarning, type LayerIR, type Polygon2D, type ProjectConfigV1, type WaterInsertIR, type WaterInsertMaterialIR, type WaterSurfaceIR } from "../types.js";

/** Default gap left between an acrylic insert and its wood opening, per side. */
export const DEFAULT_WATER_INSERT_CLEARANCE_MM = 0.1;

/**
 * The wood rim added to the sheet below every opening. A steep basin leaves
 * that sheet almost no shelf inside the shoreline, and the insert needs
 * something to rest and be glued on; through the acrylic the rim reads as a
 * shallow shelf.
 */
export const WATER_INSERT_LEDGE_MM = 2;

/**
 * Narrowest arm of a lake that becomes acrylic. A thinner arm would be a
 * fragile sliver of plastic in a slot of wood, so it stays wood with its
 * depth steps, as the lake was before.
 */
export const WATER_INSERT_MIN_WIDTH_MM = 3;

/** Smallest insert worth cutting and placing by hand. */
export const WATER_INSERT_MIN_AREA_MM2 = 50;

/** The acrylic as the project resolves it, every optional value filled from the wood. */
export function waterInsertMaterial(config: ProjectConfigV1): WaterInsertMaterialIR | undefined {
  const settings = config.waterInserts;
  if (!settings) return undefined;
  return {
    thicknessMm: settings.thicknessMm ?? config.materialThicknessMm,
    kerfMm: settings.kerfMm ?? config.laserKerfMm,
    fitClearanceMm: settings.fitClearanceMm,
    ledgeMm: WATER_INSERT_LEDGE_MM,
  };
}

/** Rings wound as `Polygon2D` requires (Clipper's output follows its own convention), tiny rings dropped. */
export function tidy(polygons: Polygon2D[], minimumFeatureMm: number): Polygon2D[] {
  return polygons.flatMap((polygon) => {
    if (removeTinyRing(polygon.outer, minimumFeatureMm)) return [];
    const outer = signedArea(polygon.outer) < 0 ? [...polygon.outer].reverse() : polygon.outer;
    const holes = polygon.holes
      .filter((hole) => !removeTinyRing(hole, minimumFeatureMm))
      .map((hole) => (signedArea(hole) > 0 ? [...hole].reverse() : hole));
    return [{ outer, holes }];
  });
}

function area(polygon: Polygon2D): number {
  return Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
}

/**
 * Where acrylic replaces a lake on its surface sheet: the vector lake, plus
 * the rim of the sheet's own basin hole that reaches up to one grid cell past
 * it (the carved floor is contoured from cell samples, so that hole overshoots
 * the vector shoreline and would otherwise leave a crescent of open water
 * beside the acrylic), kept to the sheet's outline and to what the sheet
 * above leaves visible. Nothing rests on acrylic, and an island hill the DEM
 * has but the vector lake lacks stays wood.
 */
function lakeFootprint(surface: WaterSurfaceIR, layer: LayerIR, above: LayerIR | undefined, claimed: Polygon2D[], cellPitchMm: number): Polygon2D[] {
  const filled = layer.polygons.map((polygon) => ({ outer: polygon.outer, holes: [] }));
  const basin = clipPolygons(filled, layer.polygons, "difference");
  const rim = clipPolygons(basin, offsetPolygons(surface.polygons, cellPitchMm, "round"), "intersection");
  let footprint = clipPolygons(filled, clipPolygons(surface.polygons, rim, "union"), "intersection");
  if (above?.polygons.length) footprint = clipPolygons(footprint, above.polygons, "difference");
  if (claimed.length) footprint = clipPolygons(footprint, claimed, "difference");
  return footprint;
}

/** Opens the footprint by the minimum width: arms narrower than it fall away and stay wood. */
function openNarrowArms(footprint: Polygon2D[], config: ProjectConfigV1): Polygon2D[] {
  const width = Math.max(WATER_INSERT_MIN_WIDTH_MM, 2 * config.minimumFeatureMm);
  const opened = offsetPolygons(offsetPolygons(footprint, -width / 2, "round"), width / 2, "round");
  // Rounding the grow back can poke a hair past the original edge.
  return clipPolygons(opened, footprint, "intersection");
}

export interface WaterInsertCut {
  inserts: WaterInsertIR[];
  material: WaterInsertMaterialIR;
}

/**
 * Cuts every lake's opening out of the sheet that carries its waterline and
 * returns the acrylic pieces that fill them. Runs before the work-area split
 * and material nesting, so seams, nests and alignment guides all see the
 * openings, and the ledges are part of the sheet below before either runs.
 *
 * Only lakes with a carved surface take part: their surface sheet is known.
 * A lake on the bottom sheet has nothing under it to hold an insert and stays
 * wood, as do lakes left after the narrow arms and slivers are removed.
 */
export function cutWaterInserts(config: ProjectConfigV1, layers: LayerIR[], waterSurfaces: WaterSurfaceIR[], cellPitchMm: number, warnings: GeometryWarning[]): WaterInsertCut | undefined {
  const material = waterInsertMaterial(config);
  if (!material) return undefined;
  const excluded = new Set(config.waterInserts!.excludedLakeIds);
  const claimed = new Map<number, Polygon2D[]>();
  const pieces: Array<Omit<WaterInsertIR, "id"> & { areaMm2: number }> = [];
  const onBottom: string[] = [];
  const tooSmall: string[] = [];
  const failed: string[] = [];
  for (const surface of waterSurfaces) {
    if (surface.kind !== "lake") continue;
    const lakeKey = waterInsertLakeKey(surface);
    if (excluded.has(lakeKey)) continue;
    const name = surface.name ?? lakeKey;
    const layerIndex = surface.layerIndex;
    const layer = layers[layerIndex];
    const below = layers[layerIndex - 1];
    if (!layer) continue;
    if (!below) {
      onBottom.push(name);
      continue;
    }
    try {
      const layerClaimed = claimed.get(layerIndex) ?? [];
      const footprint = tidy(openNarrowArms(lakeFootprint(surface, layer, layers[layerIndex + 1], layerClaimed, cellPitchMm), config), config.minimumFeatureMm)
        .filter((polygon) => area(polygon) >= WATER_INSERT_MIN_AREA_MM2);
      if (!footprint.length) {
        tooSmall.push(name);
        continue;
      }
      layer.polygons = tidy(clipPolygons(layer.polygons, footprint, "difference"), config.minimumFeatureMm);
      const ledge = clipPolygons(footprint, offsetPolygons(footprint, -material.ledgeMm, "miter"), "difference");
      below.polygons = tidy(clipPolygons(below.polygons, ledge, "union"), config.minimumFeatureMm);
      claimed.set(layerIndex, [...layerClaimed, ...footprint]);
      for (const polygon of footprint) {
        pieces.push({ lakeKey, surfaceId: surface.id, ...(surface.name ? { name: surface.name } : {}), layerIndex, polygons: [polygon], markings: [], areaMm2: area(polygon) });
      }
    } catch {
      // A degenerate outline the clipper refuses keeps its lake wood, never the whole model.
      failed.push(name);
    }
  }

  const inserts = pieces
    .sort((left, right) => left.layerIndex - right.layerIndex || right.areaMm2 - left.areaMm2)
    .map(({ areaMm2: _area, ...piece }, index) => ({ id: `W${index + 1}`, ...piece }));

  const listed = (names: string[]) => `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
  if (onBottom.length) warnings.push({ code: "WATER_INSERT_SKIPPED", message: `${listed(onBottom)} stay${onBottom.length === 1 ? "s" : ""} wood: the waterline sits on the bottom sheet, so nothing would hold an acrylic insert.` });
  if (tooSmall.length) warnings.push({ code: "WATER_INSERT_SKIPPED", message: `${listed(tooSmall)} stay${tooSmall.length === 1 ? "s" : ""} wood: too small or narrow for an acrylic insert (under ${WATER_INSERT_MIN_WIDTH_MM} mm across).` });
  if (failed.length) warnings.push({ code: "WATER_INSERT_SKIPPED", message: `${listed(failed)} stay${failed.length === 1 ? "s" : ""} wood: the shoreline could not be cut cleanly.` });
  if (inserts.length && material.thicknessMm > config.materialThicknessMm + 1e-6) warnings.push({
    code: "WATER_INSERT_PROUD",
    message: `The acrylic is ${(material.thicknessMm - config.materialThicknessMm).toFixed(1)} mm thicker than the wood, so the water will stand proud of its shore. Use acrylic no thicker than ${config.materialThicknessMm} mm for a flush surface.`,
  });
  const oversize = inserts.filter((insert) => !fitsBed(insert.polygons, config, material.kerfMm));
  if (oversize.length) warnings.push({
    code: "WATER_INSERT_OVERSIZE",
    message: `Acrylic insert${oversize.length === 1 ? "" : "s"} ${oversize.map((insert) => insert.id).join(", ")} ${oversize.length === 1 ? "is" : "are"} larger than the machine work area. Acrylic is never split, since a seam would show in the water; exclude the lake or use a larger machine.`,
  });
  return { inserts, material };
}

function fitsBed(polygons: Polygon2D[], config: ProjectConfigV1, kerfMm: number): boolean {
  if (!(config.workAreaWidthMm > 0) && !(config.workAreaHeightMm > 0)) return true;
  const bounds = ringBounds(polygons.flatMap((polygon) => polygon.outer));
  const width = bounds.maxX - bounds.minX + kerfMm;
  const height = bounds.maxY - bounds.minY + kerfMm;
  const bedWidth = config.workAreaWidthMm > 0 ? config.workAreaWidthMm : Number.POSITIVE_INFINITY;
  const bedHeight = config.workAreaHeightMm > 0 ? config.workAreaHeightMm : Number.POSITIVE_INFINITY;
  return (width <= bedWidth && height <= bedHeight) || (height <= bedWidth && width <= bedHeight);
}

/**
 * Layers as routing sees them: the sheet each insert sits in carries the
 * acrylic as material, so map detail over the water lands on that sheet (to
 * be moved onto the acrylic by `takeInsertMarkings`) and nothing is engraved
 * on the lake bed underneath, where the acrylic hides it.
 *
 * The returned layers share their `markings` and `pieces` with the real ones,
 * and keep the wood polygons first so piece indexes stay valid. Only routing
 * may use them: anything placed where the stack above hides it (alignment
 * guides, assembly ids, paint windows) must keep reading the wood, or it
 * would be engraved under clear acrylic.
 */
export function withInsertSurfaces(layers: LayerIR[], inserts: WaterInsertIR[]): LayerIR[] {
  if (!inserts.length) return layers;
  return layers.map((layer) => {
    const acrylic = inserts.filter((insert) => insert.layerIndex === layer.index).flatMap((insert) => insert.polygons);
    return acrylic.length ? { ...layer, polygons: [...layer.polygons, ...acrylic] } : layer;
  });
}

/** Moves the share of each surface sheet's markings that lies over an insert onto that insert. */
export function takeInsertMarkings(layers: LayerIR[], inserts: WaterInsertIR[]): void {
  for (const layer of layers) {
    const onLayer = inserts.filter((insert) => insert.layerIndex === layer.index);
    if (!onLayer.length) continue;
    const acrylic = onLayer.flatMap((insert) => insert.polygons);
    const markings = layer.markings;
    layer.markings = markingsWithin(markings, acrylic, "outside", { keepKnockouts: true });
    // Copies: a halo kept on both sides must not be one object renamed twice by the id pass.
    for (const insert of onLayer) insert.markings = markingsWithin(markings, insert.polygons, "inside", { keepKnockouts: true }).map((mark) => ({ ...mark }));
  }
}
