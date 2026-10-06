// Georeferencing places chart pixels on the ground as a 3x3 homography from
// pixels to [lon, lat, 1], the form UserChartBathymetryV1 stores. Fits run in
// a local metre frame so residuals are ground distances, then compose with the
// frame's affine map back to lon/lat.

import { frameFor, type LocalFrame, type Point2 } from "./local-frame.ts";
import { fillRings, type GridLayout } from "./raster-fill.ts";
import type { ChartControlPointV1 } from "@topostack/data-contracts/chart-bathymetry";

/** Row-major 3x3 matrix. */
export type Matrix3 = number[];

/** A chart image pixel (origin top-left, y down) and the ground position it marks. */
export type ControlPoint = ChartControlPointV1;

export interface Georeference {
  /** Pixel to [lon, lat, 1]. */
  matrix: Matrix3;
  /** Root-mean-square ground residual in metres. */
  rmsM: number;
}

export interface ControlPointFit extends Georeference {
  model: "affine" | "homography";
  residualsM: number[];
}

export interface SnapResult extends Georeference {
  /** Overlap between the snapped chart shoreline and the lake outline. */
  iou: number;
}

/** Below this overlap a snap is reported but should not be trusted without the maker's confirmation. */
export const SNAP_MIN_IOU = 0.9;

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row * 3 + column] = a[row * 3]! * b[column]! + a[row * 3 + 1]! * b[3 + column]! + a[row * 3 + 2]! * b[6 + column]!;
    }
  }
  return out;
}

export function invert(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const determinant = a * A + b * B + c * C;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-300) throw new Error("The transform cannot be inverted.");
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((value) => value / determinant);
}

export function apply(m: Matrix3, x: number, y: number): Point2 {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w];
}

/** Solves a small dense system by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    if (Math.abs(a[pivot]![column]!) < 1e-10) throw new Error("Control points must not all lie on one line.");
    [a[column], a[pivot]] = [a[pivot]!, a[column]!];
    for (let row = column + 1; row < n; row += 1) {
      const factor = a[row]![column]! / a[column]![column]!;
      for (let k = column; k <= n; k += 1) a[row]![k]! -= factor * a[column]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row]![n]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

/** Least squares through the normal equations; inputs are normalized first, so they stay well conditioned. */
function leastSquares(rows: number[][], rhs: number[]): number[] {
  const n = rows[0]!.length;
  const normal = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const target = new Array<number>(n).fill(0);
  rows.forEach((row, index) => {
    for (let i = 0; i < n; i += 1) {
      target[i]! += row[i]! * rhs[index]!;
      for (let j = 0; j < n; j += 1) normal[i]![j]! += row[i]! * row[j]!;
    }
  });
  return solve(normal, target);
}

/** Hartley normalization: centroid to the origin, mean distance sqrt(2). */
function normalizer(points: readonly Point2[]): Matrix3 {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  let spread = 0;
  for (const [x, y] of points) spread += Math.hypot(x - cx, y - cy);
  const scale = spread > 0 ? (Math.SQRT2 * points.length) / spread : 1;
  return [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1];
}

/** Fits `to ~ M(from)` by least squares. Affine needs 3 pairs; a homography needs 4. */
export function fitTransform(from: readonly Point2[], to: readonly Point2[], model: "affine" | "homography"): Matrix3 {
  const minimum = model === "affine" ? 3 : 4;
  if (from.length !== to.length || from.length < minimum) throw new Error(`An ${model} fit needs at least ${minimum} point pairs.`);
  const nFrom = normalizer(from);
  const nTo = normalizer(to);
  const rows: number[][] = [];
  const rhs: number[] = [];
  from.forEach((point, index) => {
    const [x, y] = apply(nFrom, point[0], point[1]);
    const [u, v] = apply(nTo, to[index]![0], to[index]![1]);
    if (model === "affine") {
      rows.push([x, y, 1, 0, 0, 0], [0, 0, 0, x, y, 1]);
    } else {
      rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u], [0, 0, 0, x, y, 1, -x * v, -y * v]);
    }
    rhs.push(u, v);
  });
  const h = leastSquares(rows, rhs);
  const normalized = model === "affine" ? [...h, 0, 0, 1] : [...h, 1];
  return multiply(invert(nTo), multiply(normalized, nFrom));
}

/** Local metres to lon/lat as a matrix. */
function frameToLonLat(frame: LocalFrame): Matrix3 {
  return [1 / frame.scaleX, 0, frame.origin[0], 0, 1 / frame.scaleY, frame.origin[1], 0, 0, 1];
}

/**
 * Fits pixel -> ground from clicked control points. Three points give an
 * affine map (a flat scan); four or more default to a homography, which also
 * absorbs the perspective of a phone photo of a paper chart.
 */
export function fitControlPoints(points: readonly ControlPoint[], model: "affine" | "homography" = points.length >= 4 ? "homography" : "affine"): ControlPointFit {
  if (points.length < 3) throw new Error("Georeferencing needs at least three control points.");
  const frame = frameFor(points.map((point) => [point.lon, point.lat]));
  const pixels = points.map((point): Point2 => [point.x, point.y]);
  const ground = points.map((point) => frame.toLocal(point.lon, point.lat));
  const toMetres = fitTransform(pixels, ground, model);
  const residualsM = pixels.map(([x, y], index) => {
    const [u, v] = apply(toMetres, x, y);
    return Math.hypot(u - ground[index]![0], v - ground[index]![1]);
  });
  return { model, matrix: multiply(frameToLonLat(frame), toMetres), rmsM: rms(residualsM), residualsM };
}

function rms(values: readonly number[]): number {
  return values.length ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) : 0;
}

interface Moments {
  area: number;
  centroid: Point2;
  /** Orientation of the principal axis in radians. */
  angle: number;
  /** Ratio of the minor to the major principal second moment; 1 is rotationally ambiguous. */
  isotropy: number;
}

/** Area moments of a simple ring by Green's theorem. */
function moments(ring: readonly Point2[]): Moments {
  let area = 0;
  let cx = 0;
  let cy = 0;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  const [ox, oy] = ring[0]!;
  for (let index = 0; index < ring.length; index += 1) {
    const x1 = ring[index]![0] - ox;
    const y1 = ring[index]![1] - oy;
    const x2 = ring[(index + 1) % ring.length]![0] - ox;
    const y2 = ring[(index + 1) % ring.length]![1] - oy;
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
    xx += (x1 * x1 + x1 * x2 + x2 * x2) * cross;
    yy += (y1 * y1 + y1 * y2 + y2 * y2) * cross;
    xy += (x1 * y2 + 2 * x1 * y1 + 2 * x2 * y2 + x2 * y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-12) throw new Error("A shoreline must enclose an area.");
  cx /= 6 * area;
  cy /= 6 * area;
  const ixx = xx / (12 * area) - cx * cx;
  const iyy = yy / (12 * area) - cy * cy;
  const ixy = xy / (24 * area) - cx * cy;
  const spread = Math.hypot((ixx - iyy) / 2, ixy);
  const mean = (ixx + iyy) / 2;
  return {
    area: Math.abs(area),
    centroid: [cx + ox, cy + oy],
    angle: 0.5 * Math.atan2(2 * ixy, ixx - iyy),
    isotropy: mean + spread > 0 ? (mean - spread) / (mean + spread) : 1,
  };
}

/** Evenly spaced points along a closed ring. */
export function resampleRing(ring: readonly Point2[], count: number): Point2[] {
  const lengths = [0];
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    lengths.push(lengths[index]! + Math.hypot(x2 - x1, y2 - y1));
  }
  const total = lengths[ring.length]!;
  const out: Point2[] = [];
  let segment = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const distance = (sample / count) * total;
    while (lengths[segment + 1]! < distance) segment += 1;
    const span = lengths[segment + 1]! - lengths[segment]!;
    const t = span > 0 ? (distance - lengths[segment]!) / span : 0;
    const [x1, y1] = ring[segment]!;
    const [x2, y2] = ring[(segment + 1) % ring.length]!;
    out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
  }
  return out;
}

/** Nearest point on a closed ring, with the index of its segment and the position along it. */
function nearestOnRing(ring: readonly Point2[], x: number, y: number): { point: Point2; segment: number; t: number; distance: number } {
  let best = { point: ring[0]!, segment: 0, t: 0, distance: Infinity };
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length)) : 0;
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const distance = Math.hypot(x - px, y - py);
    if (distance < best.distance) best = { point: [px, py], segment: index, t, distance };
  }
  return best;
}

/** Intersection over union of two rings, measured on a raster over their joint extent. */
export function ringIou(a: readonly Point2[], b: readonly Point2[], cells = 256): number {
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const [x, y] of [...a, ...b]) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    bottom = Math.min(bottom, y);
    top = Math.max(top, y);
  }
  const resolution = Math.max(right - left, top - bottom) / cells;
  if (!(resolution > 0)) return 0;
  const layout: GridLayout = { left, top, resolution, width: Math.ceil((right - left) / resolution), height: Math.ceil((top - bottom) / resolution) };
  const first = fillRings([a], layout);
  const second = fillRings([b], layout);
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] && second[index]) intersection += 1;
    if (first[index] || second[index]) union += 1;
  }
  return union ? intersection / union : 0;
}

const ICP_SAMPLES = 200;
const ICP_ITERATIONS = 40;

/**
 * Refines an initial affine guess by symmetric iterative closest point:
 * chart samples pull towards the outline and outline samples pull towards the
 * chart, which stops an affine fit from shrinking onto one bay.
 */
function refine(source: readonly Point2[], target: readonly Point2[], initial: Matrix3): { transform: Matrix3; rmsM: number } {
  let transform = initial;
  let previous = Infinity;
  for (let iteration = 0; iteration < ICP_ITERATIONS; iteration += 1) {
    const mapped = source.map(([x, y]) => apply(transform, x, y));
    const from: Point2[] = [];
    const to: Point2[] = [];
    const distances: number[] = [];
    for (let index = 0; index < source.length; index += 1) {
      const nearest = nearestOnRing(target, mapped[index]![0], mapped[index]![1]);
      from.push(source[index]!);
      to.push(nearest.point);
      distances.push(nearest.distance);
    }
    for (const [x, y] of target) {
      const nearest = nearestOnRing(mapped, x, y);
      const a = source[nearest.segment]!;
      const b = source[(nearest.segment + 1) % source.length]!;
      from.push([a[0] + nearest.t * (b[0] - a[0]), a[1] + nearest.t * (b[1] - a[1])]);
      to.push([x, y]);
      distances.push(nearest.distance);
    }
    const error = rms(distances);
    transform = fitTransform(from, to, "affine");
    if (Math.abs(previous - error) <= 1e-6 * Math.max(1, error)) break;
    previous = error;
  }
  const mapped = source.map(([x, y]) => apply(transform, x, y));
  const final = [
    ...mapped.map(([x, y]) => nearestOnRing(target, x, y).distance),
    ...target.map(([x, y]) => nearestOnRing(mapped, x, y).distance),
  ];
  return { transform, rmsM: rms(final) };
}

function similarity(from: Moments, to: Moments, angle: number, mirror: boolean): Matrix3 {
  const scale = Math.sqrt(to.area / from.area);
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  const flip = mirror ? -1 : 1;
  // Translate the source centroid to the origin, mirror y if asked, rotate and scale, move to the target centroid.
  const linear: Matrix3 = [cos, -sin * flip, 0, sin, cos * flip, 0, 0, 0, 1];
  const centre: Matrix3 = [1, 0, -from.centroid[0], 0, 1, -from.centroid[1], 0, 0, 1];
  const place: Matrix3 = [1, 0, to.centroid[0], 0, 1, to.centroid[1], 0, 0, 1];
  return multiply(place, multiply(linear, centre));
}

/**
 * A reflected fit is taken only when it overlaps the lake this much better than
 * the best fit read the right way round. A chart printed mirror-imaged is rare;
 * a nearly symmetric lake that overlaps just as well either way is not.
 */
const MIRROR_MARGIN = 0.05;

/**
 * Two placements are the same one when the shore lands within this share of
 * the lake's size of itself. Refinement from different first guesses often
 * converges on one fit; those are not alternatives.
 */
const SAME_PLACEMENT = 0.05;

/**
 * Every distinct way the chart's traced shoreline (pixels) lays onto the
 * lake's known outline (lon/lat), best first. Charts can be rotated or not
 * north-up, so every principal-axis orientation is tried; a nearly round lake
 * gets a full turn of guesses. Pixel rows run down while northings run up, so
 * a chart read the right way round needs exactly one flip; fits without one
 * lay the lake bed down mirror-imaged and rank below by MIRROR_MARGIN.
 *
 * A lake that looks the same turned half round fits equally well both ways,
 * and nothing in the outline can say which is right. The rest of the list is
 * for that: the maker compares the lake bed with the chart and steps on.
 */
export function snapCandidates(shoreline: readonly Point2[], outline: readonly Point2[]): SnapResult[] {
  if (shoreline.length < 3 || outline.length < 3) throw new Error("Snapping needs a traced shoreline and a lake outline.");
  const frame = frameFor(outline);
  const target = outline.map(([lon, lat]) => frame.toLocal(lon, lat));
  const targetMoments = moments(target);
  const targetSamples = resampleRing(target, ICP_SAMPLES);
  const sourceSamples = resampleRing(shoreline, ICP_SAMPLES);
  const fits: { transform: Matrix3; rmsM: number; iou: number; score: number }[] = [];
  for (const mirror of [true, false]) {
    const mirrored = shoreline.map(([x, y]): Point2 => [x, mirror ? -y : y]);
    const source = moments(mirrored);
    const sourceMoments = { ...source, centroid: [source.centroid[0], mirror ? -source.centroid[1] : source.centroid[1]] as Point2 };
    const ambiguous = Math.min(source.isotropy, targetMoments.isotropy) > 0.8;
    const turns = ambiguous ? 12 : 4;
    for (let turn = 0; turn < turns; turn += 1) {
      const angle = targetMoments.angle - source.angle + (turn * 2 * Math.PI) / turns;
      const guess = similarity(sourceMoments, targetMoments, angle, mirror);
      const { transform, rmsM } = refine(sourceSamples, targetSamples, guess);
      const iou = ringIou(shoreline.map(([x, y]) => apply(transform, x, y)), target);
      // Classified by the fitted map, not the guess: the affine refinement may flip.
      const readRightWayRound = transform[0]! * transform[4]! - transform[1]! * transform[3]! < 0;
      fits.push({ transform, rmsM, iou, score: readRightWayRound ? iou : iou - MIRROR_MARGIN });
    }
  }
  fits.sort((left, right) => right.score - left.score);
  const size = Math.sqrt(Math.abs(targetMoments.area));
  const probes = resampleRing(shoreline, 24);
  const distinct: typeof fits = [];
  for (const fit of fits) {
    const same = distinct.some((kept) => {
      let total = 0;
      for (const [x, y] of probes) {
        const [ax, ay] = apply(fit.transform, x, y);
        const [bx, by] = apply(kept.transform, x, y);
        total += Math.hypot(ax - bx, ay - by);
      }
      return total / probes.length < size * SAME_PLACEMENT;
    });
    if (!same) distinct.push(fit);
  }
  const toLonLat = frameToLonLat(frame);
  return distinct.map((fit) => ({ matrix: multiply(toLonLat, fit.transform), rmsM: fit.rmsM, iou: fit.iou }));
}

/**
 * Places a chart by matching its traced shoreline to the lake's known outline:
 * the best of `snapCandidates`. The best guess by overlap is returned whatever
 * its score, so the caller can compare `iou` to SNAP_MIN_IOU and fall back to
 * control points.
 */
export function snapToOutline(shoreline: readonly Point2[], outline: readonly Point2[]): SnapResult {
  return snapCandidates(shoreline, outline)[0]!;
}
