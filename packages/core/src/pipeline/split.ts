import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import {
  type Bounds2D,
  boundsOverlap,
  normalizeMultiPolygon,
  ringBounds,
  toClipPolygon,
  toRing,
} from "../primitives/geometry2d.js";
import { MAX_SEAM_DIVISIONS, MAX_WORK_AREA_PIECES } from "../types.js";
import type { GeometryWarning, LayerIR, LayerPieceV1, Point2D, Polygon2D, ProjectConfigV1, SeamPlanV1 } from "../types.js";

/**
 * Millimeters the outermost cell edges reach past the material, so no
 * numerical crumb of terrain falls outside every cell. Interior seam
 * coordinates stay exact and are shared bit-for-bit by the two cells that
 * meet there, which is what keeps markings from fragmenting at a seam.
 */
const EDGE_OVERSHOOT_MM = 1;

/**
 * Signed shift of a layer's seams from the even-pitch grid. Even layers move
 * back and odd layers forward by half the offset, so every seam sits the full
 * offset away from the matching seam in the layers glued above and below it,
 * while each layer keeps the same number of cells. Splitting the offset
 * across both parities means a cell only ever grows by half of it.
 *
 * Parity rather than a longer period because only immediately adjacent layers
 * are glued to each other: layers N and N+2 sharing a grid is harmless, since
 * N+1 sits between them, solid across both seams.
 */
export function seamShift(layerIndex: number, offsetMm: number): number {
  return (layerIndex % 2 === 1 ? 0.5 : -0.5) * offsetMm;
}

/**
 * One axis of the seam grid: how many equal divisions, and the offset between
 * adjacent layers' seams.
 *
 * The end cells grow by half the offset, so the count is chosen against
 * `usable - offset / 2` rather than `usable`. The offset is held to half the
 * usable span, which keeps the shift under a quarter of the bed and therefore
 * under a pitch: no cell ever collapses or inverts.
 */
function planAxis(spanMm: number, usableMm: number, requestedOffsetMm: number): { count: number; offsetMm: number } {
  // The epsilon keeps a model that fits exactly at one division rather than
  // letting floating-point span/usable == 1.0000000000000002 split it.
  if (!Number.isFinite(usableMm) || spanMm / usableMm - 1e-9 <= 1) return { count: 1, offsetMm: 0 };
  const offsetMm = Math.min(Math.max(0, requestedOffsetMm), usableMm / 2);
  const count = Math.min(MAX_SEAM_DIVISIONS, Math.max(2, Math.ceil(spanMm / (usableMm - offsetMm / 2) - 1e-9)));
  return { count, offsetMm };
}

/**
 * The seam grid for a config, or undefined when the model already fits.
 *
 * Divisions are equal by construction (`pitch = span / count`), never full
 * tiles beside a sliver remainder. One kerf is subtracted from each axis
 * because a panel's cut envelope is `span + laserKerfMm`, matching how
 * `layerToSvg` already sizes its canvas.
 *
 * A flat engraving is never split: nothing is cut, it exports as one SVG, and
 * its contour lines are drawn from layer polygons, so every seam and key tab
 * would be engraved into the artwork as a stray contour.
 */
export function planSeamGrid(config: ProjectConfigV1): SeamPlanV1 | undefined {
  if (config.outputMode === "engraving") return undefined;
  const usableWidthMm = config.workAreaWidthMm > 0 ? config.workAreaWidthMm - config.laserKerfMm : Number.POSITIVE_INFINITY;
  const usableHeightMm = config.workAreaHeightMm > 0 ? config.workAreaHeightMm - config.laserKerfMm : Number.POSITIVE_INFINITY;
  const x = planAxis(config.widthMm, usableWidthMm, config.seamOffsetMm);
  const y = planAxis(config.heightMm, usableHeightMm, config.seamOffsetMm);
  if (x.count === 1 && y.count === 1) return undefined;
  return {
    columns: x.count,
    rows: y.count,
    pitchXMm: config.widthMm / x.count,
    pitchYMm: config.heightMm / y.count,
    seamOffsetXMm: x.offsetMm,
    seamOffsetYMm: y.offsetMm,
    usableWidthMm,
    usableHeightMm,
  };
}

/**
 * Cell boundaries along one axis: always `count` cells, with every interior
 * seam moved by `shiftMm`. The end cells absorb the shift, one growing and
 * the other shrinking by the same amount.
 */
export function cellEdges(spanMm: number, count: number, shiftMm: number): number[] {
  const pitch = spanMm / count;
  const half = spanMm / 2;
  const edges = [-half - EDGE_OVERSHOOT_MM];
  for (let step = 1; step < count; step += 1) edges.push(-half + step * pitch + shiftMm);
  edges.push(half + EDGE_OVERSHOOT_MM);
  return edges;
}

/**
 * How far a key tab reaches across its seam. Tabs only register and lock
 * pieces - glue carries the load - so they stay small: a 5 mm tab has a
 * 2.25 mm neck and a 3.75 mm head.
 */
const TAB_DEPTH_MM = 5;
/**
 * Tabs shrink toward this when the bed or the covered band is short of room;
 * below it the 1.8 mm neck is too frail to cut, so the seam stays straight.
 */
const MIN_TAB_DEPTH_MM = 4;
/** Each shrink step while searching for a tab that fits. */
const TAB_DEPTH_STEP_MM = 0.5;
/** Solid, covered material kept around every tab and socket. */
const TAB_CLEARANCE_MM = 1.5;
/** A covered stretch of seam at least this long carries two tabs. */
const TWO_TAB_STRETCH_MM = 90;
const TAB_HEAD_SEGMENTS = 24;
/** Neck width and head radius as fractions of tab depth: the head is 1.67x the neck, so it locks. */
const TAB_NECK_RATIO = 0.45;
const TAB_HEAD_RATIO = 0.375;

/** A straight seam in one layer: `u` runs across it, `v` along it. */
interface SeamAxis {
  /** Maps seam-local (u, v) back to model (x, y). */
  point: (u: number, v: number) => [number, number];
}

const VERTICAL_SEAM: SeamAxis = { point: (u, v) => [u, v] };
const HORIZONTAL_SEAM: SeamAxis = { point: (u, v) => [v, u] };

/** Ring orientation for polygon-clipping does not matter; it normalizes. */
function seamRect(axis: SeamAxis, u0: number, v0: number, u1: number, v1: number): Polygon {
  const ring = [axis.point(u0, v0), axis.point(u1, v0), axis.point(u1, v1), axis.point(u0, v1), axis.point(u0, v0)];
  return [ring];
}

/**
 * A jigsaw knob rooted on the seam at `u = seam`, centred at `v = centre`,
 * reaching `depth` toward `direction`. The head is wider than the neck, so
 * the two pieces lock in the plane as well as registering along the seam.
 * The neck starts half a millimeter behind the seam so the owner's union
 * never has to resolve a shared edge.
 */
function seamTab(axis: SeamAxis, seam: number, centre: number, direction: 1 | -1, depth: number): Polygon {
  const neck = depth * TAB_NECK_RATIO;
  const radius = depth * TAB_HEAD_RATIO;
  const headU = seam + direction * (depth - radius);
  const head = Array.from({ length: TAB_HEAD_SEGMENTS + 1 }, (_, index) => {
    const angle = (index % TAB_HEAD_SEGMENTS) / TAB_HEAD_SEGMENTS * Math.PI * 2;
    return axis.point(headU + Math.cos(angle) * radius, centre + Math.sin(angle) * radius);
  });
  const neckRect = seamRect(axis, seam - direction * 0.5, centre - neck / 2, headU, centre + neck / 2);
  return (polygonClipping.union(neckRect, [head]) as MultiPolygon)[0]!;
}

/**
 * Which neighbour owns each seam's tabs, and how deep they may reach. Tabs
 * point toward +x / +y whenever the lower cell has bed left for at least a
 * minimum tab, so every layer's keys face the same way; seam offsets swap
 * which cell is the narrow one on alternating layers, and letting the widest
 * slack win flipped the tabs layer to layer into mirror images that stacked
 * over each other. Only when the lower cell is out of room does the tab come
 * from the other side. The depth shrinks to fit, and a seam without room for
 * a sound neck on either side stays straight.
 */
function tabOwnership(edges: number[], spanMm: number, usableMm: number, nominalDepth: number, minimumDepth: number): Array<{ direction: 1 | -1; depth: number }> {
  const half = spanMm / 2;
  const widths = edges.slice(0, -1).map((edge, index) => Math.min(half, edges[index + 1]!) - Math.max(-half, edge));
  const growth = widths.map(() => 0);
  const seams: Array<{ direction: 1 | -1; depth: number }> = [];
  for (let seam = 1; seam < widths.length; seam += 1) {
    const slackBefore = usableMm - widths[seam - 1]! - growth[seam - 1]!;
    const slackAfter = usableMm - widths[seam]! - growth[seam]!;
    const ownerIndex = slackBefore - 1e-6 >= minimumDepth || slackBefore >= slackAfter ? seam - 1 : seam;
    const depth = Math.min(nominalDepth, (ownerIndex === seam - 1 ? slackBefore : slackAfter) - 1e-6);
    if (depth < minimumDepth) {
      seams.push({ direction: 1, depth: 0 });
      continue;
    }
    growth[ownerIndex] = growth[ownerIndex]! + depth;
    seams.push({ direction: ownerIndex === seam - 1 ? 1 : -1, depth });
  }
  return seams;
}

/**
 * Tab centres along one stretch of seam: every place where a band reaching
 * a full tab depth plus clearance to both sides lies entirely in `solid`
 * (the layer's own material under the next layer's). Any point of the band
 * missing from `solid` rules out its whole `v` span - a connected polygon's
 * projection is an interval, and the band spans the full `u` range - so the
 * free stretches are just the gaps between those spans.
 */
function tabCentres(axis: SeamAxis, seam: number, low: number, high: number, depth: number, solid: MultiPolygon, onFailure: () => void): number[] {
  const margin = depth * TAB_HEAD_RATIO + TAB_CLEARANCE_MM;
  if (high - low < 2 * margin) return [];
  const reach = depth + TAB_CLEARANCE_MM;
  let missing: MultiPolygon;
  try {
    missing = polygonClipping.difference(seamRect(axis, seam - reach, low, seam + reach, high), solid) as MultiPolygon;
  } catch {
    onFailure();
    return [];
  }
  const blocked = missing.map((polygon) => {
    const values = polygon[0]!.map((pair) => (axis === VERTICAL_SEAM ? pair[1] : pair[0]));
    return [Math.min(...values), Math.max(...values)] as const;
  }).sort((left, right) => left[0] - right[0]);
  const centres: number[] = [];
  let start = low;
  for (const [from, to] of [...blocked, [high, high] as const]) {
    const first = start + margin;
    const last = from - margin;
    if (last >= first) {
      const stretch = from - start;
      const twoFit = last - first >= 2 * margin;
      if (stretch >= TWO_TAB_STRETCH_MM && twoFit) centres.push(first + (last - first) / 4, last - (last - first) / 4);
      else centres.push((first + last) / 2);
    }
    start = Math.max(start, to);
  }
  return centres;
}

function cellIndexAt(edges: number[], value: number): number {
  for (let index = 0; index < edges.length - 1; index += 1) {
    if (value < edges[index + 1]!) return index;
  }
  return Math.max(0, edges.length - 2);
}

function columnLetter(column: number): string {
  return String.fromCharCode(65 + column);
}

function closedRect(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY },
  ];
}

function polygonBounds(polygon: Polygon2D): Bounds2D {
  return ringBounds(polygon.outer);
}

function unionBounds(list: Bounds2D[]): Bounds2D | undefined {
  return list.reduce<Bounds2D | undefined>((total, bounds) => total ? {
    minX: Math.min(total.minX, bounds.minX),
    minY: Math.min(total.minY, bounds.minY),
    maxX: Math.max(total.maxX, bounds.maxX),
    maxY: Math.max(total.maxY, bounds.maxY),
  } : { ...bounds }, undefined);
}

interface CellPiece {
  polygon: Polygon2D;
  bounds: Bounds2D;
  column: number;
  row: number;
  /** Kept whole because its own bounds already fit the work area. */
  exempt: boolean;
}

function fitsWorkArea(bounds: Bounds2D, grid: SeamPlanV1): boolean {
  return bounds.maxX - bounds.minX <= grid.usableWidthMm + 1e-9
    && bounds.maxY - bounds.minY <= grid.usableHeightMm + 1e-9;
}

/**
 * How much edge two boxes share. Adjacent seam cells touch along one axis and
 * overlap along the other, so the longer span is the joint; boxes that miss
 * each other on either axis share nothing.
 */
function sharedEdgeLength(left: Bounds2D, right: Bounds2D): number {
  const x = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX);
  const y = Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY);
  if (x < -1e-6 || y < -1e-6) return 0;
  return Math.max(x, y);
}

/**
 * Absorb pieces too narrow to cut into the neighbour they share the most seam
 * with. Never drops one: a deleted ring is deleted material, and a hole in the
 * model is worse than a fragile crumb the user can discard.
 */
function mergeSlivers(pieces: CellPiece[], minimumFeatureMm: number, grid: SeamPlanV1): { pieces: CellPiece[]; slivers: number } {
  const isSliver = (piece: CellPiece) => !piece.exempt &&
    (piece.bounds.maxX - piece.bounds.minX < minimumFeatureMm || piece.bounds.maxY - piece.bounds.minY < minimumFeatureMm);
  let remaining = [...pieces];
  const ordered = remaining.filter(isSliver)
    .sort((left, right) => (left.bounds.maxX - left.bounds.minX) * (left.bounds.maxY - left.bounds.minY)
      - (right.bounds.maxX - right.bounds.minX) * (right.bounds.maxY - right.bounds.minY));
  for (const sliver of ordered) {
    if (!remaining.includes(sliver)) continue;
    // Bounding boxes only say which pieces might touch; the union below is
    // what proves it, so walk the candidates in order of shared edge and take
    // the first that yields one piece still fitting the bed.
    const candidates = remaining
      .filter((piece) => piece !== sliver && !piece.exempt && Math.abs(piece.column - sliver.column) + Math.abs(piece.row - sliver.row) <= 1)
      .map((piece) => ({ piece, shared: sharedEdgeLength(piece.bounds, sliver.bounds) }))
      .filter(({ shared }) => shared > 0)
      .sort((left, right) => right.shared - left.shared);
    for (const { piece: target } of candidates) {
      const merged = normalizeMultiPolygon(
        polygonClipping.union(toClipPolygon(sliver.polygon), toClipPolygon(target.polygon)) as MultiPolygon,
      );
      // Corner-touching pieces union into two polygons: that is not one piece.
      if (merged.length !== 1) continue;
      const bounds = polygonBounds(merged[0]!);
      if (!fitsWorkArea(bounds, grid)) continue;
      const replacement: CellPiece = { polygon: merged[0]!, bounds, column: target.column, row: target.row, exempt: false };
      remaining = remaining.map((piece) => piece === target ? replacement : piece).filter((piece) => piece !== sliver);
      break;
    }
  }
  return { pieces: remaining, slivers: remaining.filter(isSliver).length };
}

function toLayerPieces(layerIndex: number, pieces: CellPiece[]): LayerPieceV1[] {
  const used = new Map<string, number>();
  return pieces.map((piece, polygonIndex) => {
    const base = `L${String(layerIndex + 1).padStart(2, "0")}-${columnLetter(piece.column)}${piece.row + 1}`;
    const occurrence = (used.get(base) ?? 0) + 1;
    used.set(base, occurrence);
    return {
      polygonIndex,
      id: occurrence === 1 ? base : `${base}-${occurrence}`,
      column: piece.column,
      row: piece.row,
      exempt: piece.exempt,
      widthMm: piece.bounds.maxX - piece.bounds.minX,
      heightMm: piece.bounds.maxY - piece.bounds.minY,
    };
  });
}

/**
 * Each cell's cutting region: its rectangle, plus the tabs it owns, less the
 * tabs its neighbours push into it. Owner and receiver use the very same tab
 * polygon, so the regions still partition the plane exactly.
 */
function cellRegions(
  config: ProjectConfigV1,
  grid: SeamPlanV1,
  xEdges: number[],
  yEdges: number[],
  solid: MultiPolygon | undefined,
  onTabFailure: () => void,
): Map<string, { adds: Polygon[]; subtracts: Polygon[] }> {
  const regions = new Map<string, { adds: Polygon[]; subtracts: Polygon[] }>();
  if (!solid?.length) return regions;
  const region = (column: number, row: number) => {
    const key = `${column},${row}`;
    if (!regions.has(key)) regions.set(key, { adds: [], subtracts: [] });
    return regions.get(key)!;
  };
  // The neck is the narrowest part a tab has, so it sets the floor.
  const nominal = Math.max(TAB_DEPTH_MM, config.minimumFeatureMm / TAB_NECK_RATIO);
  const minimum = Math.max(MIN_TAB_DEPTH_MM, config.minimumFeatureMm / TAB_NECK_RATIO);
  // Stay clear of the crossing seams, whose own tabs reach this far into the cell.
  const crossingClearance = nominal + TAB_CLEARANCE_MM;
  const halfWidth = config.widthMm / 2;
  const halfHeight = config.heightMm / 2;

  const place = (axis: SeamAxis, edges: number[], crossEdges: number[], usable: number, span: number, crossHalf: number) => {
    const owners = tabOwnership(edges, span, usable, nominal, minimum);
    owners.forEach(({ direction, depth }, seamIndex) => {
      if (!depth) return;
      const seam = edges[seamIndex + 1]!;
      for (let cross = 0; cross < crossEdges.length - 1; cross += 1) {
        const low = Math.max(-crossHalf, crossEdges[cross]!) + (cross > 0 ? crossingClearance : 0);
        const high = Math.min(crossHalf, crossEdges[cross + 1]!) - (cross < crossEdges.length - 2 ? crossingClearance : 0);
        // The bed allows `depth`; a narrow covered band may only take less.
        let fitted = depth;
        let centres = tabCentres(axis, seam, low, high, fitted, solid, onTabFailure);
        while (!centres.length && fitted - TAB_DEPTH_STEP_MM >= minimum - 1e-9) {
          fitted -= TAB_DEPTH_STEP_MM;
          centres = tabCentres(axis, seam, low, high, fitted, solid, onTabFailure);
        }
        for (const centre of centres) {
          const tab = seamTab(axis, seam, centre, direction, fitted);
          const owner = direction === 1 ? seamIndex : seamIndex + 1;
          const receiver = direction === 1 ? seamIndex + 1 : seamIndex;
          if (axis === VERTICAL_SEAM) {
            region(owner, cross).adds.push(tab);
            region(receiver, cross).subtracts.push(tab);
          } else {
            region(cross, owner).adds.push(tab);
            region(cross, receiver).subtracts.push(tab);
          }
        }
      }
    });
  };
  place(VERTICAL_SEAM, xEdges, yEdges, grid.usableWidthMm, config.widthMm, halfHeight);
  place(HORIZONTAL_SEAM, yEdges, xEdges, grid.usableHeightMm, config.heightMm, halfWidth);
  return regions;
}

/** `onTabFailure` hears of seams the clipper could not place tabs along, so the maker is told. */
function splitLayer(config: ProjectConfigV1, layer: LayerIR, grid: SeamPlanV1, covering: Polygon2D[], onTabFailure: () => void): CellPiece[] {
  const xEdges = cellEdges(config.widthMm, grid.columns, seamShift(layer.index, grid.seamOffsetXMm));
  const yEdges = cellEdges(config.heightMm, grid.rows, seamShift(layer.index, grid.seamOffsetYMm));

  // Partition the input rather than subtracting exempt pieces from the output.
  // Layer polygons are pairwise disjoint (clipContours emits one per connected
  // component), so an exempt island cannot overlap anything else in its layer -
  // the union is preserved exactly, no boolean op runs along the exempt
  // boundary, and the exempt ring stays bit-identical to the unsplit run.
  const exempt: Polygon2D[] = [];
  const splittable: Polygon2D[] = [];
  for (const polygon of layer.polygons) {
    (fitsWorkArea(polygonBounds(polygon), grid) ? exempt : splittable).push(polygon);
  }

  const pieces: CellPiece[] = [];
  const splittableBounds = unionBounds(splittable.map(polygonBounds));
  if (splittableBounds) {
    const splittableRings = splittable.map(toClipPolygon) as MultiPolygon;
    // Tabs only go where the next layer hides them. An island kept whole is
    // never crossed by a seam, so only splittable material can carry one.
    let solid: MultiPolygon | undefined;
    if (config.seamTabs && covering.length) {
      try {
        solid = polygonClipping.intersection(splittableRings, covering.map(toClipPolygon) as MultiPolygon) as MultiPolygon;
      } catch {
        solid = undefined;
        onTabFailure();
      }
    }
    const regions = cellRegions(config, grid, xEdges, yEdges, solid, onTabFailure);
    for (let row = 0; row < yEdges.length - 1; row += 1) {
      for (let column = 0; column < xEdges.length - 1; column += 1) {
        const rect = closedRect(xEdges[column]!, yEdges[row]!, xEdges[column + 1]!, yEdges[row + 1]!);
        if (!boundsOverlap(ringBounds(rect), splittableBounds)) continue;
        const keyed = regions.get(`${column},${row}`);
        let cell: MultiPolygon = [[toRing(rect)]];
        if (keyed?.adds.length) cell = polygonClipping.union(cell, ...keyed.adds.map((tab) => [tab] as MultiPolygon)) as MultiPolygon;
        if (keyed?.subtracts.length) cell = polygonClipping.difference(cell, ...keyed.subtracts.map((tab) => [tab] as MultiPolygon)) as MultiPolygon;
        const parts = normalizeMultiPolygon(polygonClipping.intersection(splittableRings, cell) as MultiPolygon);
        for (const polygon of parts) pieces.push({ polygon, bounds: polygonBounds(polygon), column, row, exempt: false });
      }
    }
  }
  for (const polygon of exempt) {
    const bounds = polygonBounds(polygon);
    pieces.push({
      polygon,
      bounds,
      column: cellIndexAt(xEdges, (bounds.minX + bounds.maxX) / 2),
      row: cellIndexAt(yEdges, (bounds.minY + bounds.maxY) / 2),
      exempt: true,
    });
  }
  return pieces;
}

/**
 * Cut every layer into pieces that fit the machine work area, in place.
 *
 * Must run before `addMaterialNests`: nest cavities record indices into
 * `LayerIR.polygons` and into a donor polygon's `holes`, which splitting
 * renumbers, and a seam crossing a cavity would leave an open arc where a
 * closed hole belongs. Splitting first also makes `containingPolygonIndexes`
 * reject a cross-seam nest on its own, before any hole is pushed.
 */
export function splitLayersForWorkArea(config: ProjectConfigV1, layers: LayerIR[], warnings: GeometryWarning[]): SeamPlanV1 | undefined {
  for (const layer of layers) layer.pieces = [];
  const grid = planSeamGrid(config);
  if (!grid) return undefined;

  // Every layer has the same cell count, so this is the worst case before any
  // clipping. All or nothing: a half-split model is worse than an unsplit one.
  const worstCells = grid.columns * grid.rows;
  if (worstCells * layers.length > MAX_WORK_AREA_PIECES) {
    warnings.push({
      code: "WORK_AREA_UNSPLIT",
      message: `This work area would cut the model into about ${worstCells * layers.length} pieces, more than the ${MAX_WORK_AREA_PIECES} this tool emits. Use a larger work area or a smaller model.`,
    });
    return undefined;
  }

  let slivers = 0;
  const oversize: string[] = [];
  const tablessLayers = new Set<number>();
  // Covering is read before any layer is cut; splitting keeps each layer's
  // union, but not its polygon list.
  const coverings = layers.map((layer) => layers.find((other) => other.index === layer.index + 1)?.polygons ?? []);
  for (const [layerPosition, layer] of layers.entries()) {
    const merged = mergeSlivers(splitLayer(config, layer, grid, coverings[layerPosition]!, () => tablessLayers.add(layer.index)), config.minimumFeatureMm, grid);
    slivers += merged.slivers;
    const ordered = merged.pieces.sort((left, right) =>
      left.row - right.row || left.column - right.column || left.bounds.minY - right.bounds.minY || left.bounds.minX - right.bounds.minX);
    layer.polygons = ordered.map((piece) => piece.polygon);
    layer.pieces = toLayerPieces(layer.index, ordered);
    ordered.forEach((piece, index) => {
      if (!fitsWorkArea(piece.bounds, grid)) oversize.push(layer.pieces[index]!.id);
    });
  }
  if (slivers) warnings.push({
    code: "SMALL_FEATURES",
    message: `${slivers} cut piece${slivers === 1 ? " is" : "s are"} narrower than the minimum feature size. Glue the offcut in place with its neighbour, or raise the work area so the seam misses it.`,
  });
  if (tablessLayers.size) {
    const numbers = [...tablessLayers].sort((a, b) => a - b).map((index) => index + 1);
    warnings.push({
      code: "SEAM_TABS_OMITTED",
      message: `Alignment tabs could not be placed along some seams on layer${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")}; those pieces meet edge to edge. Glue them against a straight edge.`,
    });
  }
  if (oversize.length) warnings.push({
    code: "WORK_AREA_OVERSIZE",
    message: `${oversize.length} piece${oversize.length === 1 ? "" : "s"} (${oversize.slice(0, 4).join(", ")}) remain larger than the work area. The seam grid stops at ${MAX_SEAM_DIVISIONS} divisions per axis; use a larger work area or a smaller model.`,
  });
  return grid;
}
