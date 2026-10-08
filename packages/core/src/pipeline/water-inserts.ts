import { boundsContainBounds, boundsOverlap, signedArea, ringBounds, type Bounds2D } from "../primitives/geometry2d.js";
import { clipPolygons, offsetPolygons, windowPolygons } from "../primitives/offset.js";
import { removeTinyRing } from "./contours.js";
import { markingsWithin } from "./marking-clip.js";
import { acrylicCutBounds, fitsWorkArea } from "./water-insert-panels.js";
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
const WATER_INSERT_MIN_AREA_MM2 = 50;

/**
 * How far past an insert's edge an inserted lake's shoreline score is left
 * out: enough that a ring running along the cut never survives as a stray
 * scrap beside it.
 */
export const WATER_INSERT_SHORE_BAND_MM = 0.25;

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
export function normalizedPolygons(polygons: Polygon2D[], minimumFeatureMm: number): Polygon2D[] {
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

function boundsOf(polygons: Polygon2D[]): Bounds2D {
  return ringBounds(polygons.flatMap((polygon) => polygon.outer));
}

/** The polygons whose outline box reaches `bounds`: the only ones a local boolean needs. */
function near(polygons: Array<{ polygon: Polygon2D; bounds: Bounds2D }>, bounds: Bounds2D): Polygon2D[] {
  return polygons.filter((entry) => boundsOverlap(entry.bounds, bounds)).map((entry) => entry.polygon);
}

function indexed(polygons: Polygon2D[]): Array<{ polygon: Polygon2D; bounds: Bounds2D }> {
  return polygons.map((polygon) => ({ polygon, bounds: ringBounds(polygon.outer) }));
}

/** A sheet's holes and pieces, indexed by box, so a lake finds its own basin without a sheet-wide boolean. */
interface SheetHoles {
  holes: Array<{ polygon: Polygon2D; bounds: Bounds2D }>;
  pieces: Array<{ polygon: Polygon2D; bounds: Bounds2D }>;
}

function sheetHoles(layer: LayerIR): SheetHoles {
  return {
    holes: indexed(layer.polygons.flatMap((polygon) => polygon.holes.map((hole) => ({ outer: hole, holes: [] })))),
    pieces: indexed(layer.polygons),
  };
}

/**
 * Where acrylic could replace a lake before the sheet's outline and the sheet
 * above trim it: the vector lake, plus the rim of the sheet's own basin hole
 * that reaches up to one grid cell past it. The carved floor is contoured from
 * cell samples, so that hole overshoots the vector shoreline and would
 * otherwise leave a crescent of open water beside the acrylic. Only holes the
 * lake itself reaches into count, so a neighbouring pit or a placed graphic's
 * cutout a cell away stays wood, and islands standing in the hole stay out.
 */
function lakeReach(surface: WaterSurfaceIR, sheet: SheetHoles, cellPitchMm: number): Polygon2D[] {
  const lakeBounds = boundsOf(surface.polygons);
  const own = sheet.holes.filter((hole) => boundsOverlap(hole.bounds, lakeBounds) && clipPolygons([hole.polygon], surface.polygons, "intersection").length > 0);
  if (!own.length) return surface.polygons;
  const islands = sheet.pieces.filter((piece) => own.some((hole) => boundsContainBounds(hole.bounds, piece.bounds))).map((piece) => piece.polygon);
  const basin = islands.length ? clipPolygons(own.map((hole) => hole.polygon), islands, "difference") : own.map((hole) => hole.polygon);
  const rim = clipPolygons(basin, offsetPolygons(surface.polygons, cellPitchMm, "round"), "intersection");
  return rim.length ? clipPolygons(surface.polygons, rim, "union") : surface.polygons;
}

/** A little room around a footprint's box, so the window never cuts along its edge. */
function windowAround(polygons: Polygon2D[]): Bounds2D {
  const bounds = boundsOf(polygons);
  return { minX: bounds.minX - 1, minY: bounds.minY - 1, maxX: bounds.maxX + 1, maxY: bounds.maxY + 1 };
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

interface LakeCandidate {
  surface: WaterSurfaceIR;
  lakeKey: string;
  name: string;
}

type InsertPiece = Omit<WaterInsertIR, "id"> & { areaMm2: number };

/** Why lakes stayed wood, by name, for the warnings. */
interface Skipped {
  onBottom: string[];
  tooSmall: string[];
  failed: string[];
  wholeSheet: string[];
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
 *
 * Inserted lakes gain `openPolygons` on their surface: the water still open
 * after the acrylic, which the previews draw instead of the whole lake.
 */
export function cutWaterInserts(config: ProjectConfigV1, layers: LayerIR[], waterSurfaces: WaterSurfaceIR[], cellPitchMm: number, warnings: GeometryWarning[]): WaterInsertCut | undefined {
  const material = waterInsertMaterial(config);
  if (!material) return undefined;
  const excluded = new Set(config.waterInserts!.excludedLakeIds);
  const skipped: Skipped = { onBottom: [], tooSmall: [], failed: [], wholeSheet: [] };
  const bySheet = new Map<number, LakeCandidate[]>();
  for (const surface of waterSurfaces) {
    if (surface.kind !== "lake") continue;
    const lakeKey = waterInsertLakeKey(surface);
    if (excluded.has(lakeKey) || !layers[surface.layerIndex]) continue;
    const name = surface.name ?? lakeKey;
    if (!layers[surface.layerIndex - 1]) skipped.onBottom.push(name);
    else bySheet.set(surface.layerIndex, [...(bySheet.get(surface.layerIndex) ?? []), { surface, lakeKey, name }]);
  }
  const pieces: InsertPiece[] = [];
  for (const [layerIndex, lakes] of bySheet) {
    try {
      pieces.push(...cutSheet(config, material, layers, layerIndex, lakes, cellPitchMm, skipped));
    } catch {
      // A degenerate outline the clipper refuses keeps its sheet's lakes wood, never the whole model.
      skipped.failed.push(...lakes.map((lake) => lake.name));
    }
  }

  const inserts = pieces
    .sort((left, right) => left.layerIndex - right.layerIndex || right.areaMm2 - left.areaMm2)
    .map(({ areaMm2: _area, ...piece }, index) => ({ id: `W${index + 1}`, ...piece }));

  const listed = (names: string[]) => `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
  const stay = (names: string[], reason: string) => {
    if (names.length) warnings.push({ code: "WATER_INSERT_SKIPPED", message: `${listed(names)} stay${names.length === 1 ? "s" : ""} wood: ${reason}` });
  };
  stay(skipped.onBottom, "the waterline sits on the bottom sheet, so nothing would hold an acrylic insert.");
  stay(skipped.tooSmall, `too small or narrow for an acrylic insert (under ${WATER_INSERT_MIN_WIDTH_MM} mm across).`);
  stay(skipped.wholeSheet, "the water covers its whole sheet, which would leave no wood to hold the acrylic.");
  stay(skipped.failed, "the shoreline could not be cut cleanly.");
  if (inserts.length && material.thicknessMm > config.materialThicknessMm + 1e-6) warnings.push({
    code: "WATER_INSERT_PROUD",
    message: `The acrylic is ${(material.thicknessMm - config.materialThicknessMm).toFixed(1)} mm thicker than the wood, so the water will stand proud of its shore. Use acrylic no thicker than ${config.materialThicknessMm} mm for a flush surface.`,
  });
  const oversize = inserts.filter((insert) => !fitsWorkArea(acrylicCutBounds([insert], material), config));
  if (oversize.length) warnings.push({
    code: "WATER_INSERT_OVERSIZE",
    message: `Acrylic insert${oversize.length === 1 ? "" : "s"} ${oversize.map((insert) => insert.id).join(", ")} ${oversize.length === 1 ? "is" : "are"} larger than the machine work area. Acrylic is never split, since a seam would show in the water; exclude the lake or use a larger machine.`,
  });
  return { inserts, material };
}

/**
 * One sheet's openings. Each lake works only with the sheet near it: its own
 * basin holes and the sheet's outline and the sheet above cut to a window
 * round it. Only the cut itself and the ledges below touch whole sheets, once
 * per sheet, so a map full of lakes costs little more than one with a single
 * lake, however detailed its contours.
 */
function cutSheet(config: ProjectConfigV1, material: WaterInsertMaterialIR, layers: LayerIR[], layerIndex: number, lakes: LakeCandidate[], cellPitchMm: number, skipped: Skipped): InsertPiece[] {
  const layer = layers[layerIndex]!;
  const below = layers[layerIndex - 1]!;
  const above = layers[layerIndex + 1];
  const outline = layer.polygons.map((polygon) => ({ outer: polygon.outer, holes: [] }));
  const holes = sheetHoles(layer);
  const claimed: Array<{ polygon: Polygon2D; bounds: Bounds2D }> = [];
  const found: Array<{ lake: LakeCandidate; footprint: Polygon2D[] }> = [];
  for (const lake of lakes) {
    try {
      const reach = lakeReach(lake.surface, holes, cellPitchMm);
      const window = windowAround(reach);
      // Kept to the sheet's outline and to what the sheet above leaves
      // visible: nothing rests on acrylic, and an island hill the DEM has but
      // the vector lake lacks stays wood.
      let footprint = clipPolygons(reach, windowPolygons(outline, window), "intersection");
      const over = above ? windowPolygons(above.polygons, window) : [];
      if (over.length) footprint = clipPolygons(footprint, over, "difference");
      const taken = near(claimed, window);
      if (taken.length) footprint = clipPolygons(footprint, taken, "difference");
      footprint = normalizedPolygons(openNarrowArms(footprint, config), config.minimumFeatureMm).filter((polygon) => area(polygon) >= WATER_INSERT_MIN_AREA_MM2);
      if (!footprint.length) {
        skipped.tooSmall.push(lake.name);
        continue;
      }
      claimed.push(...indexed(footprint));
      found.push({ lake, footprint });
    } catch {
      skipped.failed.push(lake.name);
    }
  }
  if (!found.length) return [];

  const openings = found.flatMap(({ footprint }) => footprint);
  const remaining = normalizedPolygons(clipPolygons(layer.polygons, openings, "difference"), config.minimumFeatureMm);
  // Crumbs at the corners of an opening are no sheet to hold acrylic in.
  if (remaining.reduce((total, polygon) => total + area(polygon), 0) < WATER_INSERT_MIN_AREA_MM2) {
    skipped.wholeSheet.push(...found.map(({ lake }) => lake.name));
    return [];
  }
  const ledges = insertLedges(openings, material.ledgeMm);
  layer.polygons = remaining;
  below.polygons = normalizedPolygons(clipPolygons(below.polygons, ledges, "union"), config.minimumFeatureMm);

  // Grown by the shore band, so the open water left beside an insert is real
  // water and not slivers between two tracings of the same shoreline.
  const openingIndex = indexed(offsetPolygons(openings, WATER_INSERT_SHORE_BAND_MM, "round"));
  return found.flatMap(({ lake: { surface, lakeKey }, footprint }) => {
    const covered = near(openingIndex, boundsOf(surface.polygons));
    surface.openPolygons = normalizedPolygons(clipPolygons(surface.polygons, covered, "difference"), config.minimumFeatureMm)
      .filter((polygon) => area(polygon) >= config.minimumFeatureMm ** 2);
    return footprint.map((polygon) => ({
      lakeKey, surfaceId: surface.id, ...(surface.name ? { name: surface.name } : {}), layerIndex, polygons: [polygon], markings: [], areaMm2: area(polygon),
    }));
  });
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

/** The rim just inside each opening that its insert rests and is glued on, part of the sheet below. */
function insertLedges(openings: Polygon2D[], ledgeMm: number): Polygon2D[] {
  return openings.flatMap((polygon) => clipPolygons([polygon], offsetPolygons([polygon], -ledgeMm, "miter"), "difference"));
}

/**
 * What lies over each layer's face, for text that must stay visible: the wood
 * sheet above, and on the sheet an insert rests on, its ledge. The bed seen
 * through the acrylic may carry labels; the ledge is glued under the insert's
 * edge, so a label there would be smeared and half covered.
 */
export function labelCoverings(layers: LayerIR[], inserts: WaterInsertIR[], material: WaterInsertMaterialIR | undefined): Array<Pick<LayerIR, "polygons"> | undefined> {
  return layers.map((_, index) => {
    const next = layers[index + 1];
    const resting = material ? inserts.filter((insert) => insert.layerIndex === index + 1).flatMap((insert) => insert.polygons) : [];
    return next && resting.length ? { polygons: [...next.polygons, ...insertLedges(resting, material!.ledgeMm)] } : next;
  });
}

/** Moves the share of each surface sheet's markings that lies over an insert onto that insert. */
export function takeInsertMarkings(layers: LayerIR[], inserts: WaterInsertIR[]): void {
  for (const layer of layers) {
    const onLayer = inserts.filter((insert) => insert.layerIndex === layer.index);
    if (!onLayer.length) continue;
    const markings = layer.markings;
    layer.markings = markingsWithin(markings, onLayer.flatMap((insert) => insert.polygons), "outside", { keepKnockouts: true });
    // Copies: a halo kept on both sides must not be one object renamed twice by the id pass.
    for (const insert of onLayer) insert.markings = markingsWithin(markings, insert.polygons, "inside", { keepKnockouts: true }).map((mark) => ({ ...mark }));
  }
}
