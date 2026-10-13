import polygonClipping from "polygon-clipping";
import { boundsOverlap, normalizeMultiPolygon, preparePolygons, ringBounds, signedArea, toMultiPolygon, type PreparedPolygons } from "../primitives/geometry2d.js";
import { clipPolygons, offsetPolygons } from "../primitives/offset.js";
import { LAND_CLASSES, type FabricationNest, type GeometryWarning, type LandAreaV1, type LandClass, type LayerIR, type PaintRegionIR, type PaintRegionKind, type Point2D, type Polygon2D, type ProjectConfigV1, type WaterSurfaceIR } from "../types.js";

/**
 * How far a paint window reaches under the layer stacked above it. A stencil
 * laid a hair off would otherwise leave bare material at the foot of the step;
 * the strip it paints is covered glue land, and the kerf already makes the
 * upper piece a touch larger than nominal, so the loss of bond is negligible.
 */
export const PAINT_BLEED_MM = 1.5;

/**
 * The narrowest strip of paper a stencil keeps. A window on a piece edge is
 * the vector shoreline against the DEM contour, and the two disagree by a
 * millimetre here and there, which leaves ribbons of "beach" paper along the
 * shore that tear or flap and let paint under them; that beach takes paint
 * instead. Fixed rather than the wood's minimum feature: a seam key tab has a
 * neck of at least 1.8 mm, and the stencil must keep every tab it registers on.
 */
export const PAINT_PAPER_MIN_MM = 1.5;

/**
 * How wide a loose sheet must be somewhere - a disc this size must fit in it -
 * for a stencil to keep it beside its main sheet. Where water runs along a
 * piece edge the dry land between them ends up as slivers of paper attached
 * to nothing; nobody can place a 1 mm scrap, so they go and that sliver of
 * land takes paint. An island in a lake stays its own sheet once it is this
 * big. The largest sheet is always kept: it is the stencil.
 */
export const PAINT_LOOSE_SHEET_MIN_MM = 10;

/** One layer's material and everything stacked above it, as `generateGeometry` indexes them. */
export interface PaintLayerClip {
  layer: LayerIR;
  covering: PreparedPolygons;
}

/** Water that never got a carved surface (depth off): flat in the DEM, so one layer owns its whole face. */
export interface FlatWaterArea {
  layerIndex: number;
  polygons: Polygon2D[];
}

export interface PaintRegionSources {
  waterSurfaces: WaterSurfaceIR[];
  flatWater: FlatWaterArea[];
  /**
   * One elevation-grid cell in model millimeters. A carved basin is contoured
   * from cell samples, so its rim interpolates up to one cell past the vector
   * shoreline; the bed steps below the surface reach that far too.
   */
  cellPitchMm: number;
  /** Public land units clipped to the crop; absent or empty when no land kind is painted. */
  landAreas?: LandAreaV1[];
}

/**
 * Which kind paints where two overlap, highest first. Each kind's windows
 * leave out every higher kind the project paints, so no spot gets two coats
 * and the stencils of one piece never overlap. Water outranks land, so a lake
 * in a park stays blue. Named units outrank wilderness, which covers most of
 * many parks; wilderness outranks the forest and BLM land it lies in.
 */
export const PAINT_PRIORITY: readonly PaintRegionKind[] = [
  "water", "national-park", "national-monument", "wildlife-refuge", "preserve", "state-park", "military", "tribal", "wilderness", "national-forest", "blm",
];

const landRegion = (landClass: LandClass) => (_layerIndex: number, { landAreas = [] }: PaintRegionSources): Polygon2D[] =>
  landAreas.filter((area) => area.landClass === landClass).flatMap((area) => area.polygons);

/** `a` less `b`; `a` unchanged when the clipper refuses a degenerate ring, since an overlapping coat beats a missing one. */
function without(a: Polygon2D[], b: Polygon2D[]): Polygon2D[] {
  if (!a.length || !b.length) return a;
  try {
    return normalizeMultiPolygon(polygonClipping.difference(toMultiPolygon(a), toMultiPolygon(b)));
  } catch {
    return a;
  }
}

/**
 * Region polygons per kind for one layer. A new kind adds a member to
 * `PAINT_REGION_KINDS`, one entry here and a place in `PAINT_PRIORITY`.
 *
 * Land belongs to every layer: the exposed face of each piece decides what
 * shows, so a park on a hillside is painted on every step it covers.
 *
 * Water belongs to every layer at or below its surface: the basin steps carved
 * under a lake are its bed, while material above the surface inside the
 * outline is an island and stays dry. On the surface layer itself the outline
 * is exact - the shelf inside it is at the waterline, the land beside it is
 * not. Below it, the outline grows by one cell so the contoured rim of the
 * basin is bed as well.
 */
const REGION_SOURCES: Record<PaintRegionKind, (layerIndex: number, sources: PaintRegionSources, grow: (polygons: Polygon2D[]) => Polygon2D[]) => Polygon2D[]> = {
  water: (layerIndex, { waterSurfaces, flatWater }, grow) => [
    ...waterSurfaces.filter((surface) => surface.layerIndex === layerIndex).flatMap((surface) => surface.polygons),
    ...grow(waterSurfaces.filter((surface) => surface.layerIndex > layerIndex).flatMap((surface) => surface.polygons)),
    ...flatWater.filter((area) => area.layerIndex === layerIndex).flatMap((area) => area.polygons),
    ...grow(flatWater.filter((area) => area.layerIndex > layerIndex).flatMap((area) => area.polygons)),
  ],
  ...Object.fromEntries(LAND_CLASSES.map((landClass) => [landClass, landRegion(landClass)])) as Record<LandClass, ReturnType<typeof landRegion>>,
};

function tinyRing(points: Point2D[], minimumFeatureMm: number): boolean {
  if (points.length < 4) return true;
  const bounds = ringBounds(points);
  return bounds.maxX - bounds.minX < minimumFeatureMm || bounds.maxY - bounds.minY < minimumFeatureMm;
}

/** Nest cavities per donor piece: holes the paper stencil skips, since the cut sheet keeps the donor whole there. */
export function omittedNestHoles(nests: FabricationNest[], layerIndex: number): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  nests.filter((nest) => nest.donorLayerIndex === layerIndex).forEach((nest) => nest.cavities.forEach((cavity) => {
    result.set(cavity.donorPolygonIndex, new Set([...(result.get(cavity.donorPolygonIndex) ?? []), cavity.donorHoleIndex]));
  }));
  return result;
}

/**
 * The stencil as it is cut: the piece less its windows, as one polygon set.
 * A window that reaches the piece edge then simply reshapes that edge instead
 * of being a second cut along it, and paper narrower than
 * `PAINT_PAPER_MIN_MM` - a bridge between a window and the edge, a ribbon of
 * beach along the shore - is opened up, because it tears or flaps and lets
 * paint under it. The opening uses miter joins, so corners the piece keeps -
 * crop corners, key tabs - come back sharp; only spikes sharper than the
 * miter limit are trimmed. Rings under the minimum feature are dropped.
 * Loose sheets narrower than `PAINT_LOOSE_SHEET_MIN_MM` everywhere are
 * dropped, and a piece that keeps no sheet at all is simply painted whole.
 */
export function paintStencil(piece: Polygon2D, windows: Polygon2D[], minimumFeatureMm: number): Polygon2D[] {
  const keep = (polygons: Polygon2D[]) => polygons
    .filter((sheet) => !tinyRing(sheet.outer, minimumFeatureMm))
    .map((sheet) => ({ outer: sheet.outer, holes: sheet.holes.filter((hole) => !tinyRing(hole, minimumFeatureMm)) }));
  const paper = keep(windows.length ? clipPolygons([piece], windows, "difference") : [piece]);
  if (!paper.length || !(minimumFeatureMm > 0)) return paper;
  const eroded = offsetPolygons(paper, -PAINT_PAPER_MIN_MM / 2, "miter");
  const opened = eroded.length ? keep(offsetPolygons(eroded, PAINT_PAPER_MIN_MM / 2, "miter")) : [];
  if (opened.length < 2) return opened;
  const area = (ring: Point2D[]) => Math.abs(signedArea(ring));
  const largest = opened.reduce((best, sheet) => (area(sheet.outer) > area(best.outer) ? sheet : best));
  return opened.filter((sheet) => sheet === largest || offsetPolygons([sheet], -PAINT_LOOSE_SHEET_MIN_MM / 2, "miter").length > 0);
}

/**
 * Paint windows for every piece of every layer: the region that stays visible
 * after assembly, extended `PAINT_BLEED_MM` under the layer above but never
 * onto the same layer's dry exposed material.
 *
 * Runs after splitting and nesting, so a polygon here is one cut piece and
 * cavities are already holes in it. Each region also carries the stencil
 * `paper` those windows leave of the piece - see `paintStencil`. Boolean ops
 * throw on degenerate rings; one sliver of water must not cost the whole
 * generation, so each piece is its own attempt.
 */
export function paintRegions(config: ProjectConfigV1, clips: PaintLayerClip[], sources: PaintRegionSources, nests: FabricationNest[] = [], warnings: GeometryWarning[] = []): PaintRegionIR[] {
  if (config.outputMode !== "stack" || !config.paintTemplates.length) return [];
  const regions: PaintRegionIR[] = [];
  const skippedLayers = new Set<number>();
  const refine = (ring: Point2D[]) => (tinyRing(ring, config.minimumFeatureMm) ? undefined : ring);
  // Outlines grow the same way for every layer below their surface, so grow each set once.
  const grown = new Map<string, Polygon2D[]>();
  const grow = (polygons: Polygon2D[]): Polygon2D[] => {
    if (!polygons.length || !(sources.cellPitchMm > 0)) return polygons;
    const key = polygons.map((polygon) => `${polygon.outer.length}:${polygon.outer[0]?.x}:${polygon.outer[0]?.y}`).join("|");
    let result = grown.get(key);
    if (!result) {
      try {
        result = offsetPolygons(polygons, sources.cellPitchMm, "round");
      } catch {
        result = polygons;
      }
      grown.set(key, result);
    }
    return result;
  };
  // Land is the same on every layer, so each land kind gives way to the higher land kinds once.
  const painted = PAINT_PRIORITY.filter((kind) => config.paintTemplates.includes(kind));
  const land = new Map<PaintRegionKind, Polygon2D[]>();
  let claimed: Polygon2D[] = [];
  for (const kind of painted) {
    if (kind === "water") continue;
    const raw = REGION_SOURCES[kind](0, sources, grow);
    land.set(kind, without(raw, claimed));
    claimed = [...claimed, ...raw];
  }
  // Water varies by layer, and outranks every land kind.
  const water = new Map<number, Polygon2D[]>();
  const waterOn = (layerIndex: number): Polygon2D[] => {
    if (!painted.includes("water")) return [];
    let region = water.get(layerIndex);
    if (!region) water.set(layerIndex, region = REGION_SOURCES.water(layerIndex, sources, grow));
    return region;
  };
  for (const kind of config.paintTemplates) {
    for (const { layer, covering } of clips) {
      const landWindows = land.get(kind);
      const region = landWindows ? without(landWindows, waterOn(layer.index)) : REGION_SOURCES[kind](layer.index, sources, grow);
      if (!region.length) continue;
      const regionPrepared = preparePolygons(region);
      const regionMulti = toMultiPolygon(region);
      const omitted = omittedNestHoles(nests, layer.index);
      layer.polygons.forEach((polygon, polygonIndex) => {
        const box = ringBounds(polygon.outer);
        if (!boundsOverlap(box, regionPrepared.bounds)) return;
        const near = covering.polygons.filter((_, index) => boundsOverlap(box, covering.outerBounds[index]!));
        try {
          const piece = toMultiPolygon([polygon]);
          const nearMulti = toMultiPolygon(near);
          const exposed = near.length ? polygonClipping.difference(piece, nearMulti) : piece;
          if (!exposed.length) return;
          const exact = polygonClipping.intersection(exposed, regionMulti);
          if (!exact.length) return;
          const covered = near.length ? polygonClipping.intersection(piece, nearMulti) : [];
          const allowed = covered.length ? polygonClipping.union(exact, covered) : exact;
          const dilated = offsetPolygons(normalizeMultiPolygon(exact), PAINT_BLEED_MM, "round");
          const window = dilated.length ? polygonClipping.intersection(toMultiPolygon(dilated), allowed) : exact;
          const polygons = normalizeMultiPolygon(window, refine);
          if (!polygons.length) return;
          const omittedHoles = omitted.get(polygonIndex) ?? new Set<number>();
          const sheet = omittedHoles.size ? { outer: polygon.outer, holes: polygon.holes.filter((_, holeIndex) => !omittedHoles.has(holeIndex)) } : polygon;
          regions.push({ kind, layerIndex: layer.index, polygonIndex, polygons, paper: paintStencil(sheet, polygons, config.minimumFeatureMm) });
        } catch {
          // A degenerate ring the clipper refuses: skip this piece's windows, and say so.
          skippedLayers.add(layer.index);
        }
      });
    }
  }
  if (skippedLayers.size) {
    const numbers = [...skippedLayers].sort((a, b) => a - b).map((index) => index + 1);
    warnings.push({
      code: "PAINT_WINDOWS_OMITTED",
      message: `Some paint windows on layer${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")} could not be cut, so those areas are left off the stencils. Paint them by hand, or nudge the design and generate again.`,
    });
  }
  return regions;
}
