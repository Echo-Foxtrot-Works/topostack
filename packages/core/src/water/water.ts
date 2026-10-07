import { surveyShoreDepths } from "./survey-shore.js";
import { vectorShoreDistances } from "./shore-distance.js";
import { ringBounds } from "../primitives/geometry2d.js";
import { cellsTouchGridEdge, sampleOffset } from "../primitives/grid.js";
import { terrainBasinDistance } from "./terrain-basin.js";
import { BATHYMETRIC_RELIEF_M } from "../types.js";
import type { ElevationGrid, GeometryWarning, Point2D, Polygon2D, ProjectConfigV1, WaterAreaV1, WaterSurfaceIR } from "../types.js";

/**
 * Water depth is not a geometry kind of its own - it is a carve of the
 * elevation grid, applied before contouring. At any (x, y) inside a water body
 * the model should hold material up to the *bed*, not the surface, so writing
 * the bed elevation into the grid makes the whole existing pipeline produce the
 * recess: d3-contour cuts the rings, clipContours winds them as holes, and
 * every consumer downstream already honours holes.
 *
 * Survey grids take precedence where supplied. Otherwise dry terrain slopes
 * around the shore inform the basin shape, constrained by the GLOBathy maximum
 * depth and HydroLAKES mean depth. Cropped lakes or uninformative terrain retain
 * the distance-to-shore profile `D = Dmax * (l / L)^p`.
 */

/** Fraction of a cell the border samples move inward; see `cellPoint`. */
const EDGE_INSET = 1e-3;

const MIN_SHAPE_EXPONENT = 0.2;
const MAX_SHAPE_EXPONENT = 8;
const SHAPE_HISTOGRAM_BINS = 256;
const SHAPE_SOLVE_ITERATIONS = 40;

/**
 * Cell (i, j) at the same mm coordinate `sampleElevation` reads it from, with
 * the outermost row and column nudged a hair inward.
 *
 * Edge samples sit exactly on the crop boundary, and so does the edge of any
 * water polygon clipped to that crop. Ray casting cannot decide a point lying
 * on the ring, so an ocean running off the map would drop its border cells from
 * the mask - and those are the deepest cells, which would then be counted as
 * land and drag the whole stack back down to the sea floor.
 */
function cellPoint(column: number, row: number, grid: ElevationGrid, config: ProjectConfigV1): Point2D {
  const insetX = column === 0 ? EDGE_INSET : column === grid.width - 1 ? -EDGE_INSET : 0;
  const insetY = row === 0 ? EDGE_INSET : row === grid.height - 1 ? -EDGE_INSET : 0;
  return {
    x: sampleOffset(column + insetX, grid.width, config.widthMm),
    y: sampleOffset(row + insetY, grid.height, config.heightMm),
  };
}

/**
 * Row-major grid indexes whose `cellPoint` lies inside `polygon`, decided
 * exactly as `pointInPolygon` would decide each cell - the crossing abscissa
 * uses the same expression and the same `<` comparison - but one scanline at a
 * time and only across the rows the outline's bounding box spans. Testing every
 * cell against every vertex took tens of seconds on detailed lakes.
 */
function ringCrossings(ring: Point2D[], y: number, into: number[]): void {
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if (!a || !b) continue;
    if ((a.y > y) !== (b.y > y)) into.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
  }
}

function polygonCells(polygon: Polygon2D, grid: ElevationGrid, config: ProjectConfigV1): Int32Array {
  const result: number[] = [];
  const outer = ringBounds(polygon.outer);
  if (!(outer.minY <= outer.maxY)) return new Int32Array(0);
  const xs = new Float64Array(grid.width);
  for (let column = 0; column < grid.width; column += 1) xs[column] = cellPoint(column, 0, grid, config).x;
  const holeBounds = polygon.holes.map(ringBounds);
  const outerCrossings: number[] = [];
  const holeCrossings: number[][] = polygon.holes.map(() => []);
  for (let row = 0; row < grid.height; row += 1) {
    const y = cellPoint(0, row, grid, config).y;
    // Outside [minY, maxY) no edge straddles the scanline, so nothing is inside.
    if (!(y >= outer.minY && y < outer.maxY)) continue;
    outerCrossings.length = 0;
    ringCrossings(polygon.outer, y, outerCrossings);
    if (!outerCrossings.length) continue;
    outerCrossings.sort((left, right) => left - right);
    const activeHoles: number[][] = [];
    polygon.holes.forEach((hole, holeIndex) => {
      const bounds = holeBounds[holeIndex]!;
      if (!(y >= bounds.minY && y < bounds.maxY)) return;
      const crossings = holeCrossings[holeIndex]!;
      crossings.length = 0;
      ringCrossings(hole, y, crossings);
      if (crossings.length) activeHoles.push(crossings.sort((left, right) => left - right));
    });
    const rowOffset = row * grid.width;
    for (let column = 0; column < grid.width; column += 1) {
      if (!oddCrossingsRightOf(outerCrossings, xs[column]!)) continue;
      if (activeHoles.some((crossings) => oddCrossingsRightOf(crossings, xs[column]!))) continue;
      result.push(rowOffset + column);
    }
  }
  return Int32Array.from(result);
}

/** Parity of `x < crossing` over ascending crossings, i.e. the ray-casting rule. */
function oddCrossingsRightOf(sorted: number[], x: number): boolean {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (x < sorted[middle]!) high = middle;
    else low = middle + 1;
  }
  return ((sorted.length - low) & 1) === 1;
}

function surfaceIndexes(polygons: readonly Polygon2D[], grid: ElevationGrid, config: ProjectConfigV1): Int32Array {
  if (polygons.length === 1) return polygonCells(polygons[0]!, grid, config);
  const mask = new Uint8Array(grid.width * grid.height);
  for (const polygon of polygons) for (const index of polygonCells(polygon, grid, config)) mask[index] = 1;
  const result: number[] = [];
  mask.forEach((value, index) => { if (value) result.push(index); });
  return Int32Array.from(result);
}

/**
 * Felzenszwalb & Huttenlocher's exact squared distance transform, one axis at a
 * time. `spacing` is the ground distance between neighbouring samples on this
 * axis, which is what turns the result from cells into meters - grid cells are
 * not square once the crop is not square.
 *
 * Cells beyond the array are simply absent rather than seeded, so a lake that
 * runs off the edge of the window is not given a false shoreline there.
 *
 * `origin` is the grid index of `f[0]`. Parabola intersections are computed in
 * grid coordinates, so a window reproduces the full-grid arithmetic exactly.
 */
function distanceTransform1D(f: Float64Array, n: number, spacing: number, origin = 0): Float64Array {
  const weight = spacing * spacing;
  const result = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const vertices = new Int32Array(n);
  const breaks = new Float64Array(n + 1);
  let count = -1;
  for (let local = 0; local < n; local += 1) {
    if (!Number.isFinite(f[local]!)) continue;
    const q = local + origin;
    if (count < 0) {
      count = 0;
      vertices[0] = q;
      breaks[0] = Number.NEGATIVE_INFINITY;
      breaks[1] = Number.POSITIVE_INFINITY;
      continue;
    }
    let separation = 0;
    while (count >= 0) {
      const v = vertices[count]!;
      separation = ((f[local]! + weight * q * q) - (f[v - origin]! + weight * v * v)) / (2 * weight * q - 2 * weight * v);
      if (separation > breaks[count]!) break;
      count -= 1;
    }
    if (count < 0) {
      count = 0;
      vertices[0] = q;
      breaks[0] = Number.NEGATIVE_INFINITY;
      breaks[1] = Number.POSITIVE_INFINITY;
    } else {
      count += 1;
      vertices[count] = q;
      breaks[count] = separation;
      breaks[count + 1] = Number.POSITIVE_INFINITY;
    }
  }
  if (count < 0) return result;
  let index = 0;
  for (let local = 0; local < n; local += 1) {
    const q = local + origin;
    while (breaks[index + 1]! < q) index += 1;
    const v = vertices[index]!;
    result[local] = weight * (q - v) * (q - v) + f[v - origin]!;
  }
  return result;
}

/** Grid cells spanned by some cells plus a one-cell margin, clamped to the grid. */
export interface CellWindow { minX: number; minY: number; maxX: number; maxY: number }

function cellWindow(cells: ArrayLike<number>, width: number, height: number): CellWindow {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    const x = cell % width, y = (cell - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX: Math.max(0, minX - 1), minY: Math.max(0, minY - 1), maxX: Math.min(width - 1, maxX + 1), maxY: Math.min(height - 1, maxY + 1) };
}

/**
 * Distance in meters from each masked cell to the nearest unmasked one. Cells
 * outside the mask seed the transform at zero; everything else starts unseeded,
 * so a mask that touches the window edge measures to real shoreline only.
 *
 * With a `window` enclosing every masked cell plus a one-cell margin, only that
 * window is transformed and written into `into`; entries outside it are left
 * untouched. The margin is unmasked, so it is always at least as near as any
 * shore beyond it, and the result inside the window matches the full grid.
 */
export function distanceToShoreM(
  mask: Uint8Array, width: number, height: number, spacingXM: number, spacingYM: number,
  window: CellWindow = { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
  into = new Float64Array(width * height),
): Float64Array {
  const windowWidth = window.maxX - window.minX + 1;
  const windowHeight = window.maxY - window.minY + 1;
  if (windowWidth <= 0 || windowHeight <= 0) return into;
  const squared = new Float64Array(windowWidth * windowHeight);
  const column = new Float64Array(windowHeight);
  const row = new Float64Array(windowWidth);
  for (let y = 0; y < windowHeight; y += 1) {
    const offset = (y + window.minY) * width + window.minX;
    for (let x = 0; x < windowWidth; x += 1) row[x] = mask[offset + x] ? Number.POSITIVE_INFINITY : 0;
    const transformed = distanceTransform1D(row, windowWidth, spacingXM, window.minX);
    for (let x = 0; x < windowWidth; x += 1) squared[y * windowWidth + x] = transformed[x]!;
  }
  for (let x = 0; x < windowWidth; x += 1) {
    for (let y = 0; y < windowHeight; y += 1) column[y] = squared[y * windowWidth + x]!;
    const transformed = distanceTransform1D(column, windowHeight, spacingYM, window.minY);
    for (let y = 0; y < windowHeight; y += 1) squared[y * windowWidth + x] = transformed[y]!;
  }
  for (let y = 0; y < windowHeight; y += 1) {
    const offset = (y + window.minY) * width + window.minX;
    for (let x = 0; x < windowWidth; x += 1) into[offset + x] = Math.sqrt(squared[y * windowWidth + x]!);
  }
  return into;
}

/**
 * Choose the profile exponent so the modeled basin holds the mean depth
 * HydroLAKES reports.
 *
 * For modeled basins, this is where mean-depth information enters. GLOBathy's own
 * head-Area-Volume curves are fitted *from* its conical rasters, so they cannot
 * bend the profile; `Depth_avg` can, because it is `Vol_total / Lake_area` from
 * Messager et al.'s geostatistical model, which never saw the distance
 * transform. A straight cone always averages about a third of its maximum, and
 * the shipped ratios spread either side of it - Tahoe 0.56 (steep walls, p~0.45),
 * Superior 0.36 (near-conical, p~0.91), Crater Lake 0.25 (p~1.36) - a difference
 * that is plainly visible once the basin is cut into sheets.
 *
 * Treat the ratio as the best available estimate, not ground truth: HydroLAKES
 * derives it from a modeled volume, which is close for Tahoe but understates an
 * unusual caldera like Crater Lake by more than half. The per-lake maximum-depth
 * override exists for the cases a reader will notice.
 *
 * `mean(u^p)` falls monotonically with `p`, so bisection converges. It runs
 * against a histogram of `u` rather than the cells themselves, which keeps the
 * solve at a few thousand operations instead of tens of millions.
 */
export function solveShapeExponent(normalized: Float64Array, count: number, targetRatio: number): number {
  if (!(targetRatio > 0) || !(targetRatio < 1) || count === 0) return 1;
  const histogram = new Float64Array(SHAPE_HISTOGRAM_BINS);
  for (let index = 0; index < count; index += 1) {
    const bin = Math.min(SHAPE_HISTOGRAM_BINS - 1, Math.max(0, Math.round(normalized[index]! * (SHAPE_HISTOGRAM_BINS - 1))));
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  const meanPower = (exponent: number): number => {
    let total = 0;
    for (let bin = 0; bin < SHAPE_HISTOGRAM_BINS; bin += 1) {
      const weight = histogram[bin]!;
      if (weight === 0) continue;
      total += weight * (bin / (SHAPE_HISTOGRAM_BINS - 1)) ** exponent;
    }
    return total / count;
  };
  if (meanPower(MIN_SHAPE_EXPONENT) < targetRatio) return MIN_SHAPE_EXPONENT;
  if (meanPower(MAX_SHAPE_EXPONENT) > targetRatio) return MAX_SHAPE_EXPONENT;
  let low = MIN_SHAPE_EXPONENT;
  let high = MAX_SHAPE_EXPONENT;
  for (let iteration = 0; iteration < SHAPE_SOLVE_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2;
    if (meanPower(middle) > targetRatio) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function quantile(sorted: Float64Array, count: number, fraction: number): number {
  if (count === 0) return 0;
  return sorted[Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))))] ?? 0;
}

/**
 * Where a water area's face sits when nothing carves it: the sea at datum, a
 * lake at the median of the DEM inside its outline (flat there, so the median
 * is the surface, in the same datum as the land around it). NaN with no cells.
 */
export function waterSurfaceLevelM(area: WaterAreaV1, grid: ElevationGrid, config: ProjectConfigV1): number {
  if (area.kind === "ocean") return 0;
  const cells = polygonCells(area.polygon, grid, config);
  if (!cells.length) return Number.NaN;
  const sorted = Float64Array.from(cells, (index) => grid.values[index]!).sort();
  return quantile(sorted, sorted.length, 0.5);
}

/** One lake's distance-to-shore field, with what the basin fit needs to know about how it was measured. */
interface LakeShore {
  /** Ground meters from each of the lake's cells to the nearest shore. */
  distance: Float64Array;
  /** Distances run to the vector outline between samples, rather than to dry cell centers. */
  vectorShore: boolean;
  /** The lake reaches the grid border, so no complete shoreline is in view. */
  touchesEdge: boolean;
}

export interface CarvedWater {
  grid: ElevationGrid;
  surfaces: WaterSurfaceIR[];
  warnings: GeometryWarning[];
  /**
   * Every cell covered by water, carved or surveyed. The stack budget is sized
   * from land alone, so it needs to know which cells to leave out of that.
   */
  waterMask: Uint8Array;
  /**
   * Grid indexes inside each surface's polygons, parallel to `surfaces`, so
   * later passes need not rasterize the outlines again. Optional for callers
   * that assemble a `CarvedWater` by hand; it is recomputed when absent.
   */
  surfaceCells?: readonly Int32Array[];
}

/**
 * One carve in progress: the grid copy being written, the buffers every lake
 * shares, and the lake currently being processed. Per-lake work is confined
 * to that lake's window, so the full-grid buffers are allocated once and only
 * the entries a lake touches are ever rewritten.
 */
interface CarveRun {
  grid: ElevationGrid;
  config: ProjectConfigV1;
  groundWidthM: number;
  groundHeightM: number;
  spacingXM: number;
  spacingYM: number;
  exaggeration: number;
  values: Float32Array<ArrayBuffer>;
  warnings: GeometryWarning[];
  waterMask: Uint8Array<ArrayBuffer>;
  /** The current lake's cells, as a mask over the grid and as a list, and the window around them. */
  mask: Uint8Array<ArrayBuffer>;
  cells: number[];
  lakeWindow: CellWindow;
  /** Each current-lake cell's place in its basin, 0 at the shore and 1 at the deepest point; parallel to `cells`. */
  normalized: Float64Array<ArrayBuffer>;
  shoreDistance: Float64Array<ArrayBuffer>;
  basinBuffers: { factors: Float64Array<ArrayBuffer>; result: Float64Array<ArrayBuffer> };
  /** Allocated on first use: most maps have no survey rim to bridge at all. */
  rimBuffer?: Float64Array<ArrayBuffer>;
  surfaces: WaterSurfaceIR[];
  surfaceCells: Int32Array[];
}

// Returned rather than stashed in a mutable: the basin fit and the survey-rim
// bridge both need to know how these distances were measured, and reading that
// back off a variable the measurement had set was only correct by call order.
function measureShore(run: CarveRun, area: WaterAreaV1): LakeShore {
  const { grid, config, cells } = run;
  const touchesEdge = cellsTouchGridEdge(cells, grid.width, grid.height);
  // The exact outline is only usable for a whole lake: a crop edge must never
  // be measured as if it were a bank.
  const vectorShore = config.smoothing > 0 && !area.clipped && !touchesEdge;
  return {
    distance: vectorShore
      ? vectorShoreDistances(area.polygon, cells, grid.width, grid.height, config.widthMm, config.heightMm, run.groundWidthM, run.groundHeightM, run.shoreDistance)
      : distanceToShoreM(run.mask, grid.width, grid.height, run.spacingXM, run.spacingYM, run.lakeWindow, run.shoreDistance),
    vectorShore,
    touchesEdge,
  };
}

/** Fills `run.normalized` for the current lake and returns the basin radius it is measured against (0 when there is none). */
function normalizeBasin(run: CarveRun, area: WaterAreaV1, shore: LakeShore, surfaceM: number): number {
  const { grid, cells, normalized } = run;
  const { distance } = shore;
  let visibleRadiusM = 0;
  for (const cell of cells) if (Number.isFinite(distance[cell])) visibleRadiusM = Math.max(visibleRadiusM, distance[cell]!);
  const radiusM = area.lmaxM && area.lmaxM > 0 ? area.lmaxM : visibleRadiusM;
  if (!(radiusM > 0)) return 0;
  const shape = terrainBasinDistance(grid, run.mask, run.waterMask, cells, distance, run.spacingXM, run.spacingYM,
    surfaceM, (area.maxDepthM ?? 0) / radiusM, area.clipped ?? false, run.basinBuffers, shore.vectorShore, shore.touchesEdge);
  let shapeRadiusM = 0;
  if (shape !== distance) for (const cell of cells) shapeRadiusM = Math.max(shapeRadiusM, shape[cell]!);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    normalized[index] = shape === distance
      ? Math.min(1, distance[cell]! / radiusM)
      : shape[cell]! / shapeRadiusM * Math.min(1, visibleRadiusM / radiusM);
  }
  return radiusM;
}

function pushSurface(run: CarveRun, surface: WaterSurfaceIR, indexes: Int32Array): void {
  run.surfaces.push(surface);
  run.surfaceCells.push(indexes);
}

/** The current lake's waterline and how much its DEM interior already varies. */
interface LakeLevels {
  /** The lake's DEM samples, ascending. */
  sorted: Float64Array;
  surfaceLevelM: number;
  interiorSpreadM: number;
}

/**
 * Writes the current lake's floor from its survey or traced chart. Returns
 * false when no survey cell lands inside the lake, so the lake falls through
 * to the other carves.
 */
function carveSurveyedLake(run: CarveRun, area: WaterAreaV1, areaIndexes: Int32Array, { surfaceLevelM, interiorSpreadM }: LakeLevels): boolean {
  const { grid, values, cells, warnings, normalized } = run;
  const survey = area.bathymetry!;
  const chart = area.bathymetryOrigin === "chart";
  const surveyNoun = chart ? "depth chart" : "survey";
  // A misaligned survey cannot be placed, but it is one lake's data, not the
  // map's: model this lake instead of failing the whole generation.
  const aligned = survey.width === grid.width && survey.height === grid.height && survey.depthsM.length === values.length;
  if (!aligned) warnings.push({
    code: "BATHYMETRY_FALLBACK",
    message: `${area.name ?? "A lake"} has ${surveyNoun} data that does not match the terrain grid, so its floor uses existing terrain or a modeled basin instead.`,
  });
  let surveyedCount = 0;
  if (aligned) for (const index of cells) {
    const depth = survey.depthsM[index]!;
    if (Number.isNaN(depth)) continue;
    if (!Number.isFinite(depth) || depth < 0 || depth > 1500) throw new Error("Lake bathymetry contains an invalid depth.");
    surveyedCount += 1;
  }
  if (surveyedCount === 0) return false;
  // Depths are relative to their dataset waterline, not absolute elevations. Anchor
  // them to the flat terrain waterline. If the DEM already has a basin,
  // use the lake's published surface elevation instead of its bed median.
  const surfaceElevationM = interiorSpreadM > BATHYMETRIC_RELIEF_M && Number.isFinite(area.surfaceElevationM)
    ? area.surfaceElevationM!
    : surfaceLevelM;
  const missing = surveyedCount < cells.length;
  const shore = missing ? measureShore(run, area) : undefined;
  const radiusM = shore && interiorSpreadM <= BATHYMETRIC_RELIEF_M ? normalizeBasin(run, area, shore, surfaceElevationM) : 0;
  const exponent = !shore || radiusM <= 0 || area.clipped || !(area.meanDepthM && area.maxDepthM)
    ? 1 : solveShapeExponent(normalized, cells.length, area.meanDepthM / area.maxDepthM);
  // Coarse survey masks leave a ragged uncovered rim after resampling.
  // Where no depth model exists, bridge only that narrow rim to the real
  // shoreline instead of dropping abruptly from survey depth to zero.
  const rimDepths = shore?.vectorShore && !area.maxDepthM && interiorSpreadM <= BATHYMETRIC_RELIEF_M
    ? surveyShoreDepths(survey.depthsM, run.mask, cells, shore.distance, grid.width, grid.height, run.spacingXM, run.spacingYM, survey.sampleSpacingM,
      run.rimBuffer ??= new Float64Array(grid.width * grid.height))
    : undefined;
  let bedElevationM = surfaceElevationM;
  let fallbackCount = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    // Preserve banks and islands caught by a slightly different shoreline.
    if (values[cell]! > surfaceElevationM + BATHYMETRIC_RELIEF_M) continue;
    let depth = survey.depthsM[cell]!;
    if (Number.isNaN(depth)) {
      fallbackCount += 1;
      if (interiorSpreadM > BATHYMETRIC_RELIEF_M) depth = Math.max(0, surfaceElevationM - values[cell]!);
      else if (shore && radiusM > 0 && Number.isFinite(shore.distance[cell]!) && area.maxDepthM) depth = area.maxDepthM * normalized[index]! ** exponent;
      else depth = rimDepths && Number.isFinite(rimDepths[cell]) ? rimDepths[cell]! : 0;
    }
    const bed = surfaceElevationM - depth * run.exaggeration;
    values[cell] = bed;
    bedElevationM = Math.min(bedElevationM, bed);
  }
  pushSurface(run, {
    id: area.id, kind: area.kind, name: area.name, hylakId: area.hylakId, ...(area.lakeKey ? { lakeKey: area.lakeKey } : {}),
    polygons: [area.polygon], surfaceElevationM, bedElevationM,
    ...(fallbackCount && area.maxDepthM ? { maxDepthM: area.maxDepthM } : {}),
    // A traced chart is the maker's own depth source, gaps or not.
    layerIndex: 0, depthSource: chart ? "user" : fallbackCount ? "mixed" : "surveyed",
    ...(chart ? { bathymetryOrigin: "chart" as const } : {}),
  }, areaIndexes);
  if (fallbackCount) warnings.push({
    code: "BATHYMETRY_FALLBACK",
    message: `${area.name ?? "A lake"} has incomplete ${surveyNoun} coverage. Uncovered cells use existing terrain, modeled depths, or estimates near surveyed shores; cells without enough information remain at the waterline.`,
  });
  return true;
}

/**
 * The DEM already knows this basin (an ocean, or a lake whose interior varies),
 * so its shape is left alone - but its depth is still scaled, so surveyed and
 * modeled water answer to the same control. At 1x nothing is written and the
 * survey passes through exactly.
 */
function keepDemBasin(run: CarveRun, area: WaterAreaV1, areaIndexes: Int32Array, { sorted, surfaceLevelM }: LakeLevels): void {
  const { values, cells, exaggeration } = run;
  const surveyedSurfaceM = area.kind === "ocean" ? 0 : surfaceLevelM;
  let surveyedBedM = quantile(sorted, sorted.length, 0);
  if (exaggeration !== 1) {
    surveyedBedM = surveyedSurfaceM;
    for (const index of cells) {
      const depth = surveyedSurfaceM - values[index]!;
      if (depth <= 0) continue;
      const scaled = surveyedSurfaceM - depth * exaggeration;
      values[index] = scaled;
      if (scaled < surveyedBedM) surveyedBedM = scaled;
    }
  }
  pushSurface(run, {
    id: area.id,
    kind: area.kind,
    ...(area.name ? { name: area.name } : {}),
    ...(area.hylakId === undefined ? {} : { hylakId: area.hylakId }),
    ...(area.lakeKey ? { lakeKey: area.lakeKey } : {}),
    polygons: [area.polygon],
    surfaceElevationM: surveyedSurfaceM,
    bedElevationM: surveyedBedM,
    layerIndex: 0,
    depthSource: "surveyed",
  }, areaIndexes);
}

/** A flat lake with a known maximum depth: model its basin from the distance to shore. */
function carveModeledLake(run: CarveRun, area: WaterAreaV1, areaIndexes: Int32Array, { surfaceLevelM }: LakeLevels): void {
  const { values, cells, warnings, normalized } = run;
  const sourceMaxDepthM = area.maxDepthM;
  const maxDepthM = sourceMaxDepthM === undefined ? undefined : sourceMaxDepthM * run.exaggeration;
  if (!(maxDepthM && maxDepthM > 0) || sourceMaxDepthM === undefined) return;

  // Take the surface from our own DEM rather than HydroLAKES' `Elevation`.
  // The lake is flat here, so the median *is* the surface, and it is stated in
  // the same datum as the surrounding land - borrowing EarthEnv-DEM90's figure
  // instead would leave a step at the shoreline wherever the two disagree.
  const surfaceElevationM = surfaceLevelM;

  const shore = measureShore(run, area);
  // No shoreline in view means no way to place these cells within the basin.
  if (cells.some((index) => !Number.isFinite(shore.distance[index]!))) {
    warnings.push({
      code: "WATER_DEPTH_CLAMPED",
      message: `${area.name ?? "A lake"} extends past the edge of this map, so its depth could not be modeled. Zoom out to include its shoreline.`,
    });
    return;
  }

  const lmaxM = normalizeBasin(run, area, shore, surfaceElevationM);
  if (!(lmaxM > 0)) return;

  // A clipped lake's visible cells are not a fair sample of the whole basin,
  // so fitting an exponent to them would bend the profile to the crop rather
  // than to the lake. Fall back to GLOBathy's straight line there.
  const exponent = area.clipped || !(area.meanDepthM && area.meanDepthM > 0)
    ? 1
    // Exaggeration scales both the maximum and mean depth, so it must not
    // change their ratio (and therefore the basin shape). The source maximum
    // may include a user override; retaining the published mean then bends
    // the overridden profile while the display multiplier remains uniform.
    : solveShapeExponent(normalized, cells.length, area.meanDepthM / sourceMaxDepthM);

  let bedElevationM = surfaceElevationM;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    // Only ever cut downward from the waterline. Where a lake outline spills a
    // little past the shore, those cells are land standing above the surface,
    // and gouging them would carve a moat into the bank.
    if (values[cell]! > surfaceElevationM + BATHYMETRIC_RELIEF_M) continue;
    const bed = surfaceElevationM - maxDepthM * normalized[index]! ** exponent;
    values[cell] = bed;
    if (bed < bedElevationM) bedElevationM = bed;
  }

  pushSurface(run, {
    id: area.id,
    kind: area.kind,
    ...(area.name ? { name: area.name } : {}),
    ...(area.hylakId === undefined ? {} : { hylakId: area.hylakId }),
    ...(area.lakeKey ? { lakeKey: area.lakeKey } : {}),
    polygons: [area.polygon],
    surfaceElevationM,
    bedElevationM,
    maxDepthM: sourceMaxDepthM,
    layerIndex: 0,
    depthSource: area.depthSource ?? "modeled",
  }, areaIndexes);
}

/**
 * Write surveyed or modeled lake beds into a copy of the elevation grid.
 *
 * Oceans are never carved: Terrarium already carries real soundings for them,
 * and the `BATHYMETRIC_RELIEF_M` guard extends that courtesy to any water body
 * whose DEM interior already varies - so a better DEM arriving later is
 * respected automatically rather than being flattened back to a model.
 */
export function carveWaterDepth(
  grid: ElevationGrid,
  config: ProjectConfigV1,
  areas: readonly WaterAreaV1[],
  groundWidthM: number,
  groundHeightM = groundWidthM * (grid.height - 1) / (grid.width - 1),
): CarvedWater {
  // Applies to surveyed water as much as modeled: a reader raising the control
  // expects the sea floor to deepen alongside the lakes, and the ocean's depth
  // lives in the DEM rather than in anything this function writes.
  const exaggeration = Number.isFinite(config.waterDepthExaggeration) && config.waterDepthExaggeration >= 0
    ? config.waterDepthExaggeration
    : 1;
  const values = Float32Array.from(grid.values);
  const waterMask = new Uint8Array(grid.width * grid.height);
  if (!areas.length) return { grid: { ...grid, values }, surfaces: [], warnings: [], waterMask };

  const cellCount = grid.width * grid.height;
  const run: CarveRun = {
    grid, config, groundWidthM, groundHeightM, exaggeration, values, waterMask,
    // The geographic footprint is independent of physical output stretching.
    spacingXM: groundWidthM / Math.max(1, grid.width - 1),
    spacingYM: groundHeightM / Math.max(1, grid.height - 1),
    warnings: [],
    mask: new Uint8Array(cellCount),
    cells: [],
    lakeWindow: { minX: 0, minY: 0, maxX: -1, maxY: -1 },
    normalized: new Float64Array(cellCount),
    shoreDistance: new Float64Array(cellCount),
    basinBuffers: { factors: new Float64Array(cellCount), result: new Float64Array(cellCount) },
    surfaces: [],
    surfaceCells: [],
  };
  const interior = new Float64Array(cellCount);

  // Build the complete mask before carving so neighboring lakes never become
  // land samples for the terrain prior, regardless of their processing order.
  // Each lake's cells are rasterized once and reused by the carve below and by
  // `fitLakesToLadder`.
  const areaCells = areas.map((area) => polygonCells(area.polygon, grid, config));
  for (const indexes of areaCells) for (const index of indexes) waterMask[index] = 1;

  for (const [areaIndex, area] of areas.entries()) {
    const { mask, cells } = run;
    for (const index of cells) mask[index] = 0;
    cells.length = 0;
    let count = 0;
    const areaIndexes = areaCells[areaIndex]!;
    run.lakeWindow = cellWindow(areaIndexes, grid.width, grid.height);
    for (const index of areaIndexes) {
      mask[index] = 1;
      cells.push(index);
      // The DEM as supplied, not the working copy: an overlapping lake carved
      // earlier must not drag this one's waterline or spread down with it.
      interior[count] = grid.values[index]!;
      count += 1;
    }
    if (count === 0) continue;

    const sorted = interior.slice(0, count).sort();
    const levels: LakeLevels = {
      sorted,
      surfaceLevelM: quantile(sorted, count, 0.5),
      // Judge "does the DEM already know this basin?" on the middle of the
      // distribution, not its extremes. A lake outline traced by HydroLAKES never
      // lands exactly on Terrarium's rendering of the same shoreline, and a
      // handful of steep rim cells caught inside the polygon would otherwise
      // condemn the whole lake to being read as surveyed and left flat.
      interiorSpreadM: quantile(sorted, count, 0.9) - quantile(sorted, count, 0.1),
    };

    if (area.bathymetry && area.kind === "lake" && carveSurveyedLake(run, area, areaIndexes, levels)) continue;
    // A fallback shoreline is not evidence that DEM relief is a surveyed bed.
    // Keep unknown-depth lakes as outlines unless actual depths are available.
    if (area.outlineSource && !area.maxDepthM) continue;
    if (area.kind === "ocean" || levels.interiorSpreadM > BATHYMETRIC_RELIEF_M) keepDemBasin(run, area, areaIndexes, levels);
    else carveModeledLake(run, area, areaIndexes, levels);
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { grid: { ...grid, values, min, max }, surfaces: run.surfaces, warnings: run.warnings, waterMask, surfaceCells: run.surfaceCells };
}

/** Compress over-budget lakes uniformly around their own waterlines before contouring. */
export function fitLakesToLadder(carved: CarvedWater, config: ProjectConfigV1, floorM: number): CarvedWater {
  const values = Float32Array.from(carved.grid.values);
  const surfaces = carved.surfaces.map((surface, surfaceIndex) => {
    const depth = surface.surfaceElevationM - surface.bedElevationM;
    const available = surface.surfaceElevationM - floorM;
    // No usable depth cannot be fixed by scaling. Keep the clipping warning in that case.
    if (surface.kind !== "lake" || !(depth > available && available > 0)) return surface;
    const factor = available / depth;
    const indexes = carved.surfaceCells?.[surfaceIndex] ?? surfaceIndexes(surface.polygons, carved.grid, config);
    for (const index of indexes) {
      const original = carved.grid.values[index]!;
      if (original >= surface.surfaceElevationM) continue;
      // Round upward to a representable Float32 floor to avoid a spurious clipping warning.
      values[index] = surface.surfaceElevationM - (surface.surfaceElevationM - original) * factor;
      if (values[index]! < floorM) values[index] = floorM + Math.max(1, Math.abs(floorM)) * 2 ** -23;
    }
    return {
      ...surface,
      bedElevationM: floorM,
      unfittedBedElevationM: surface.bedElevationM,
      depthFitScale: factor,
      appliedDepthExaggeration: config.waterDepthExaggeration * factor,
    };
  });
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  return { ...carved, grid: { ...carved.grid, values, min, max }, surfaces };
}

/**
 * Raise cells below the chosen layer allowance. Automatic depth coverage
 * normally reaches every visible bed; a user-selected limit can clip it, and
 * the caller reports that clipping or offers proportional lake-depth fitting.
 */
export function clampCarveToLadder(grid: ElevationGrid, floorM: number): { grid: ElevationGrid; clamped: boolean } {
  if (!(grid.min < floorM)) return { grid, clamped: false };
  const values = Float32Array.from(grid.values);
  let min = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]! < floorM) values[index] = floorM;
    if (values[index]! < min) min = values[index]!;
  }
  return { grid: { ...grid, values, min }, clamped: true };
}
