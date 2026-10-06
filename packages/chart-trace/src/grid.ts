// Contours to a depth grid. Both methods work in a lake-centred metre frame
// whose grid is also aligned to lon/lat, and emit depths (NaN on land) for
// UserChartBathymetryV1.grid.
//
// "tin" reproduces scripts/data-build/survey_regions.py contour_grid, the
// interpolator behind the published contour surveys: linear on a Delaunay
// triangulation of the contour vertices, blank outside their hull. It is
// kept for parity with those archives.
//
// "harmonic" is the default for traced charts. A TIN between two vertices on
// the same contour makes flat terraces; solving Laplace's equation with the
// contours fixed and the shore at zero gives the smooth slope a chart implies,
// and covers the whole lake rather than only the hull of the lines.

import Delaunator from "delaunator";
import { frameFor, type Point2 } from "./local-frame.ts";
import { fillRings, type GridLayout } from "./raster-fill.ts";
import type { ChartGridMethod } from "@topostack/data-contracts/chart-bathymetry";

/** How depths are interpolated between contours; the stored record names the same choice. */
export type GridMethod = ChartGridMethod;

export interface GridContour {
  depthM: number;
  /** [lon, lat] vertices. */
  line: Point2[];
  /** A closed ring joins its last vertex back to its first. */
  closed?: boolean;
  /**
   * For a ring that alone encloses a flat pool: whether the pool is a hole
   * (deeper, the usual case) or a hump (shallower). Chart nesting decides it.
   */
  inside?: "deeper" | "shallower";
  /** Explicit interior target; equal to depthM holds a flat interior. */
  interiorDepthM?: number;
}

export interface GridSpot {
  lon: number;
  lat: number;
  depthM: number;
}

export interface GridRequest {
  /**
   * Lake water area in [lon, lat]: an outline with islands, or any set of
   * rings filled even-odd (a vector chart's water fill, drawn in tiles).
   */
  water: { outer: Point2[]; holes?: Point2[][] } | { rings: Point2[][] };
  contours: GridContour[];
  spots?: GridSpot[];
  resolutionM: number;
  method?: GridMethod;
  /** Contour interval; inferred from the contour depths when absent. */
  intervalM?: number;
  /** Largest grid side in cells; resolution coarsens to fit. */
  maxSide?: number;
}

export interface DepthGrid {
  method: GridMethod;
  bounds: { west: number; south: number; east: number; north: number };
  width: number;
  height: number;
  resolutionM: number;
  /** Row-major from the north-west corner; NaN on land and, for "tin", outside the contour hull. */
  depthsM: Float32Array;
}

export const DEFAULT_MAX_SIDE = 1024;
const MAX_DEPTH_M = 1500;

/** Python's grid layout: origin at the water bounds' top-left, sides rounded up. Holes lie inside the outline, so all rings give the same bounds. */
export function waterLayout(rings: readonly (readonly Point2[])[], resolution: number, maxCells = 30_000_000): GridLayout {
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      bottom = Math.min(bottom, y);
      top = Math.max(top, y);
    }
  }
  const width = Math.ceil((right - left) / resolution);
  const height = Math.ceil((top - bottom) / resolution);
  if (!(width > 0 && height > 0) || width * height > maxCells) throw new Error("Water mask has unsupported grid dimensions");
  return { left, top, resolution, width, height };
}

/**
 * Port of survey_regions.contour_grid on metre coordinates. Points are
 * [x, y, depth]; identical locations with conflicting depths are dropped,
 * matching values keep the lower one, and cells outside the hull stay NaN.
 */
export function tinGridMetres(points: readonly (readonly [number, number, number])[], water: readonly (readonly Point2[])[], resolution: number): { layout: GridLayout; values: Float32Array } {
  if (points.length < 3) throw new Error("Insufficient contour samples");
  if (points.some(([x, y, depth]) => !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(depth) || depth < 0 || depth > MAX_DEPTH_M)) throw new Error("Invalid contour depths");
  const byLocation = new Map<string, { x: number; y: number; lower: number; upper: number }>();
  for (const [x, y, depth] of points) {
    const key = `${x},${y}`;
    const seen = byLocation.get(key);
    if (seen) {
      seen.lower = Math.min(seen.lower, depth);
      seen.upper = Math.max(seen.upper, depth);
    } else byLocation.set(key, { x, y, lower: depth, upper: depth });
  }
  // Contradictory values at identical locations must not depend on input order.
  const samples = [...byLocation.values()].filter((sample) => sample.upper - sample.lower < 0.01);
  if (samples.length < 3 || !samples.some((sample) => sample.lower > 0)) throw new Error("Insufficient unambiguous underwater contours");
  const coords = new Float64Array(samples.length * 2);
  samples.forEach((sample, index) => {
    coords[index * 2] = sample.x;
    coords[index * 2 + 1] = sample.y;
  });
  const triangulation = new Delaunator(coords);
  if (!triangulation.triangles.length) throw new Error("Degenerate contour geometry");
  const layout = waterLayout(water, resolution);
  const mask = fillRings(water, layout);
  const values = new Float32Array(layout.width * layout.height).fill(Number.NaN);
  const { triangles } = triangulation;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = samples[triangles[t]!]!;
    const b = samples[triangles[t + 1]!]!;
    const c = samples[triangles[t + 2]!]!;
    const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (determinant === 0) continue;
    // Tolerate cells exactly on a shared or hull edge, as Qhull's point location does.
    const epsilon = 1e-9;
    const first = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - layout.left) / resolution - 0.5));
    const last = Math.min(layout.width - 1, Math.ceil((Math.max(a.x, b.x, c.x) - layout.left) / resolution - 0.5));
    const top = Math.max(0, Math.floor((layout.top - Math.max(a.y, b.y, c.y)) / resolution - 0.5));
    const bottom = Math.min(layout.height - 1, Math.ceil((layout.top - Math.min(a.y, b.y, c.y)) / resolution - 0.5));
    for (let row = top; row <= bottom; row += 1) {
      const y = layout.top - (row + 0.5) * resolution;
      for (let column = first; column <= last; column += 1) {
        const cell = row * layout.width + column;
        if (!mask[cell] || !Number.isNaN(values[cell]!)) continue;
        const x = layout.left + (column + 0.5) * resolution;
        const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / determinant;
        const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / determinant;
        const l3 = 1 - l1 - l2;
        if (l1 < -epsilon || l2 < -epsilon || l3 < -epsilon) continue;
        values[cell] = l1 * a.lower + l2 * b.lower + l3 * c.lower;
      }
    }
  }
  let deepest = -Infinity;
  for (const value of values) if (value > deepest) deepest = value;
  if (!(deepest > 0)) throw new Error("No gridded underwater coverage");
  return { layout, values };
}

/** The smallest common step between distinct contour depths, the chart's contour interval. */
export function inferIntervalM(depths: readonly number[]): number | undefined {
  const levels = [...new Set(depths.map((depth) => Math.round(depth * 1000) / 1000))].sort((a, b) => a - b);
  const steps = new Map<number, number>();
  for (let index = 1; index < levels.length; index += 1) {
    const step = Math.round((levels[index]! - levels[index - 1]!) * 1000) / 1000;
    steps.set(step, (steps.get(step) ?? 0) + 1);
  }
  let best: [number, number] | undefined;
  for (const entry of steps) if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
  return best?.[0];
}

const FREE = -1;
const LAND = -2;

interface Problem {
  width: number;
  height: number;
  /** Fixed depth, FREE for an unknown water cell, LAND outside the water. */
  fixed: Float64Array;
}

/**
 * Red-black successive over-relaxation of the discrete Laplacian, with land
 * and the grid edge held at zero depth. Stops when a sweep moves no cell by
 * more than `tolerance` metres.
 */
function relax(problem: Problem, values: Float64Array, tolerance: number, maxSweeps: number): void {
  const { width, height, fixed } = problem;
  const omega = Math.min(1.95, 2 / (1 + Math.sin(Math.PI / Math.max(width, height, 2))));
  const at = (row: number, column: number) => {
    if (row < 0 || column < 0 || row >= height || column >= width) return 0;
    const cell = row * width + column;
    return fixed[cell] === LAND ? 0 : values[cell]!;
  };
  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let change = 0;
    for (let colour = 0; colour < 2; colour += 1) {
      for (let row = 0; row < height; row += 1) {
        for (let column = (row + colour) % 2; column < width; column += 2) {
          const cell = row * width + column;
          if (fixed[cell] !== FREE) continue;
          const average = (at(row - 1, column) + at(row + 1, column) + at(row, column - 1) + at(row, column + 1)) / 4;
          const delta = omega * (average - values[cell]!);
          values[cell] = values[cell]! + delta;
          change = Math.max(change, Math.abs(delta));
        }
      }
    }
    if (change < tolerance) return;
  }
}

/**
 * Cascadic multigrid: solve a half-resolution copy first and start the fine
 * relaxation from it, so smooth error that plain relaxation removes slowly is
 * already gone.
 */
function solveLaplace(problem: Problem, tolerance = 1e-4): Float64Array {
  const { width, height, fixed } = problem;
  const values = new Float64Array(width * height);
  for (let cell = 0; cell < values.length; cell += 1) values[cell] = fixed[cell]! >= 0 ? fixed[cell]! : 0;
  if (Math.min(width, height) > 16) {
    const coarseWidth = Math.ceil(width / 2);
    const coarseHeight = Math.ceil(height / 2);
    const coarse = new Float64Array(coarseWidth * coarseHeight).fill(LAND);
    for (let row = 0; row < coarseHeight; row += 1) {
      for (let column = 0; column < coarseWidth; column += 1) {
        let water = false;
        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const fineRow = row * 2 + dy;
            const fineColumn = column * 2 + dx;
            if (fineRow >= height || fineColumn >= width) continue;
            const value = fixed[fineRow * width + fineColumn]!;
            if (value === LAND) continue;
            water = true;
            if (value >= 0) {
              sum += value;
              count += 1;
            }
          }
        }
        if (water) coarse[row * coarseWidth + column] = count ? sum / count : FREE;
      }
    }
    const guess = solveLaplace({ width: coarseWidth, height: coarseHeight, fixed: coarse }, tolerance);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const cell = row * width + column;
        if (fixed[cell] === FREE) values[cell] = guess[(row >> 1) * coarseWidth + (column >> 1)]!;
      }
    }
  }
  relax(problem, values, tolerance, 20_000);
  return values;
}

/**
 * Distance in cells from each region cell to the nearest cell outside the
 * region, by a two-pass 3-4 chamfer over the region's bounding box. Close
 * enough to Euclidean that a round pool gets a round dome.
 */
function distanceInRegion(cells: readonly number[], inRegion: Uint8Array, width: number): Map<number, number> {
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const cell of cells) {
    const row = Math.floor(cell / width);
    const column = cell % width;
    top = Math.min(top, row);
    bottom = Math.max(bottom, row);
    left = Math.min(left, column);
    right = Math.max(right, column);
  }
  // A one-cell margin of non-region cells seeds distance zero around the edge.
  const boxWidth = right - left + 3;
  const boxHeight = bottom - top + 3;
  const distance = new Float64Array(boxWidth * boxHeight).fill(0);
  for (const cell of cells) distance[(Math.floor(cell / width) - top + 1) * boxWidth + (cell % width) - left + 1] = Infinity;
  const pass = (rowStart: number, rowEnd: number, step: number) => {
    for (let row = rowStart; row !== rowEnd; row += step) {
      for (let column = step > 0 ? 1 : boxWidth - 2; column > 0 && column < boxWidth - 1; column += step) {
        const index = row * boxWidth + column;
        if (distance[index] === 0) continue;
        const back = index - step * boxWidth;
        distance[index] = Math.min(distance[index]!, distance[index - step]! + 3, distance[back]! + 3, distance[back - 1]! + 4, distance[back + 1]! + 4);
      }
    }
  };
  pass(1, boxHeight - 1, 1);
  pass(boxHeight - 2, 0, -1);
  const out = new Map<number, number>();
  for (const cell of cells) {
    if (!inRegion[cell]) continue;
    out.set(cell, distance[(Math.floor(cell / width) - top + 1) * boxWidth + (cell % width) - left + 1]! / 3);
  }
  return out;
}

export interface HarmonicInput {
  layout: GridLayout;
  mask: Uint8Array;
  /** Contours and spots in metre coordinates. */
  contours: { depthM: number; line: Point2[]; closed?: boolean; inside?: "deeper" | "shallower"; interiorDepthM?: number }[];
  spots: { x: number; y: number; depthM: number }[];
  intervalM?: number;
}

export function harmonicGridMetres(input: HarmonicInput): Float32Array {
  const { layout, mask, contours, spots } = input;
  const { width, height, left, top, resolution } = layout;
  const cells = width * height;
  const sum = new Float64Array(cells);
  const count = new Uint16Array(cells);
  /** Index of a contour that burned into the cell, for classifying flat pools. */
  const owner = new Int32Array(cells).fill(-1);
  const cellAt = (x: number, y: number) => {
    const column = Math.floor((x - left) / resolution);
    const row = Math.floor((top - y) / resolution);
    return row >= 0 && column >= 0 && row < height && column < width ? row * width + column : -1;
  };
  contours.forEach((contour, index) => {
    const depth = contour.depthM;
    if (!Number.isFinite(depth) || depth < 0 || depth > MAX_DEPTH_M) throw new Error("Invalid contour depths");
    const burned = new Set<number>();
    const { line } = contour;
    const segments = line.length < 2 ? line.length : contour.closed ? line.length : line.length - 1;
    for (let vertex = 0; vertex < segments; vertex += 1) {
      const [x1, y1] = line[vertex]!;
      const [x2, y2] = line[(vertex + 1) % line.length]!;
      const steps = Math.max(1, Math.ceil((Math.hypot(x2 - x1, y2 - y1) / resolution) * 4));
      for (let step = 0; step <= steps; step += 1) {
        const cell = cellAt(x1 + ((x2 - x1) * step) / steps, y1 + ((y2 - y1) * step) / steps);
        if (cell < 0 || !mask[cell] || burned.has(cell)) continue;
        burned.add(cell);
        sum[cell] = sum[cell]! + depth;
        count[cell] = count[cell]! + 1;
        if (owner[cell]! < 0) owner[cell] = index;
      }
    }
  });
  const fixed = new Float64Array(cells);
  for (let cell = 0; cell < cells; cell += 1) fixed[cell] = !mask[cell] ? LAND : count[cell] ? sum[cell]! / count[cell]! : FREE;
  const spotCells = new Set<number>();
  for (const spot of spots) {
    if (!Number.isFinite(spot.depthM) || spot.depthM < 0 || spot.depthM > MAX_DEPTH_M) throw new Error("Invalid spot depth");
    const cell = cellAt(spot.x, spot.y);
    if (cell < 0 || !mask[cell]) continue;
    fixed[cell] = spot.depthM;
    owner[cell] = -1;
    spotCells.add(cell);
  }

  // A free region bounded only by one ring's depth would solve perfectly flat,
  // and pinning a single cell would only make a spike. Fill it instead with a
  // smooth dome that leaves the ring at the ring's slope and levels off half
  // an interval past it (or at the deepest sounding inside it).
  const interval = input.intervalM ?? inferIntervalM(contours.map((contour) => contour.depthM));
  const region = new Int32Array(cells).fill(-1);
  const inRegion = new Uint8Array(cells);
  let regionIndex = 0;
  for (let start = 0; start < cells; start += 1) {
    if (fixed[start] !== FREE || region[start]! >= 0) continue;
    const members: number[] = [];
    const depths = new Set<number>();
    const owners = new Set<number>();
    const soundings = new Set<number>();
    let shore = false;
    const stack = [start];
    region[start] = regionIndex;
    while (stack.length) {
      const cell = stack.pop()!;
      members.push(cell);
      const row = Math.floor(cell / width);
      const column = cell % width;
      for (const [nextRow, nextColumn] of [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]] as const) {
        if (nextRow < 0 || nextColumn < 0 || nextRow >= height || nextColumn >= width) {
          shore = true;
          continue;
        }
        const next = nextRow * width + nextColumn;
        const value = fixed[next]!;
        if (value === LAND) shore = true;
        else if (value === FREE) {
          if (region[next]! < 0) {
            region[next] = regionIndex;
            stack.push(next);
          }
        } else if (spotCells.has(next)) {
          soundings.add(next);
        } else {
          depths.add(Math.round(value * 1e6) / 1e6);
          if (owner[next]! >= 0) owners.add(owner[next]!);
        }
      }
    }
    regionIndex += 1;
    if (shore || depths.size !== 1) continue;
    const ringDepth = [...depths][0]!;
    if (!(ringDepth > 0)) continue;
    const hump = owners.size > 0 && [...owners].every((index) => contours[index]!.inside === "shallower");
    const soundingDepths = [...soundings].map((cell) => fixed[cell]!);
    const extreme = soundingDepths.length ? (hump ? Math.min(...soundingDepths) : Math.max(...soundingDepths)) : undefined;
    const step = (interval ?? ringDepth) / 2;
    const targets = [...owners].map(index => contours[index]!.interiorDepthM);
    const explicit = targets.length && targets.every(value => value !== undefined) ? (hump ? Math.min(...targets as number[]) : Math.max(...targets as number[])) : undefined;
    const target = Math.max(0, Math.min(MAX_DEPTH_M, explicit ?? extreme ?? (hump ? ringDepth - step : ringDepth + step)));
    // Soundings sit inside the dome rather than being edges it slopes to.
    const domain = [...members, ...soundings];
    for (const cell of domain) inRegion[cell] = 1;
    const distance = distanceInRegion(domain, inRegion, width);
    for (const cell of domain) inRegion[cell] = 0;
    let farthest = 0;
    for (const value of distance.values()) farthest = Math.max(farthest, value);
    for (const cell of members) {
      const t = farthest > 0 ? distance.get(cell)! / farthest : 1;
      fixed[cell] = ringDepth + (target - ringDepth) * (2 * t - t * t);
    }
  }

  const solved = solveLaplace({ width, height, fixed });
  const depths = new Float32Array(cells);
  for (let cell = 0; cell < cells; cell += 1) depths[cell] = mask[cell] ? solved[cell]! : Number.NaN;
  return depths;
}

/** Interpolates traced contours (and spot soundings) into a lake depth grid. */
export function gridDepths(request: GridRequest): DepthGrid {
  const method = request.method ?? "harmonic";
  if (!(request.resolutionM > 0)) throw new Error("Grid resolution must be positive.");
  const lonLatRings = ("rings" in request.water ? request.water.rings : [request.water.outer, ...(request.water.holes ?? [])]).filter((ring) => ring.length >= 3);
  if (!lonLatRings.length) throw new Error("The water area needs an outline.");
  const frame = frameFor(lonLatRings.flat());
  const rings = lonLatRings.map((ring) => ring.map(([lon, lat]) => frame.toLocal(lon, lat)));
  const maxSide = request.maxSide ?? DEFAULT_MAX_SIDE;
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const resolution = Math.max(request.resolutionM, spanX / maxSide, spanY / maxSide) * (1 + 1e-9);
  const contours = request.contours.map((contour) => ({ ...contour, line: contour.line.map(([lon, lat]) => frame.toLocal(lon, lat)) }));
  const spots = (request.spots ?? []).map((spot) => {
    const [x, y] = frame.toLocal(spot.lon, spot.lat);
    return { x, y, depthM: spot.depthM };
  });
  let layout: GridLayout;
  let depthsM: Float32Array;
  if (method === "tin") {
    const points = [
      ...contours.flatMap((contour) => contour.line.map(([x, y]) => [x, y, contour.depthM] as const)),
      ...spots.map((spot) => [spot.x, spot.y, spot.depthM] as const),
    ];
    ({ layout, values: depthsM } = tinGridMetres(points, rings, resolution));
  } else {
    layout = waterLayout(rings, resolution);
    depthsM = harmonicGridMetres({ layout, mask: fillRings(rings, layout), contours, spots, ...(request.intervalM === undefined ? {} : { intervalM: request.intervalM }) });
  }
  const [west, north] = frame.toLonLat(layout.left, layout.top);
  const [east, south] = frame.toLonLat(layout.left + layout.width * layout.resolution, layout.top - layout.height * layout.resolution);
  return { method, bounds: { west, south, east, north }, width: layout.width, height: layout.height, resolutionM: layout.resolution, depthsM };
}
