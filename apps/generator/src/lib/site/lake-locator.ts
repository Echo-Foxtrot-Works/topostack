import type { LakeDirectoryEntry } from "./lake-directory.ts";
import { KM_PER_DEGREE_LAT, kmPerDegreeLon } from "./geo.ts";

/**
 * The small map on each /lake/<slug> page that shows where the lake is. It is
 * drawn at build time as inline SVG, so the page stays script-free. The data is
 * Natural Earth 1:50m land, lakes, country borders and state or province lines,
 * cut down to the area around the directory's lakes by
 * scripts/build/build-locator-data.mjs.
 *
 * Imported by load functions and Node scripts only; like lake-places.ts it must
 * not reach a browser bundle.
 */

/** Map geometry as flat [lon, lat, lon, lat, …] arrays, one per ring or line. */
export interface LocatorData {
  source: string;
  layers: { land: number[][]; lakes: number[][]; countries: number[][]; states: number[][] };
}
export interface LocatorMap {
  width: number;
  height: number;
  land: string;
  lakes: string;
  countries: string;
  states: string;
  /** Other surveyed lakes in view, as SVG coordinates. */
  dots: [number, number][];
  /** The lake's survey area; `marker` is set when that box is too small to see. */
  box: { x: number; y: number; width: number; height: number };
  marker?: { x: number; y: number };
  scale: { km: number; length: number };
  /** Width of the area shown, for the accessible description. */
  widthKm: number;
}
type Bounds = LakeDirectoryEntry["bounds"];

export const LOCATOR_WIDTH = 400;
export const LOCATOR_HEIGHT = 250;
/** The narrowest map: enough to show the surrounding county, state or canton. */
const MIN_WIDTH_KM = 400;
/** How much wider than the survey area the map is, so large lakes still sit in context. */
const CONTEXT = 3;
/** Dots are thinned to one per grid cell of this size (SVG units), so dense regions keep their shape without flooding the page. */
const DOT_CELL = 5;
const MAX_DOTS = 600;
/** A survey box narrower than this (SVG units) also gets a marker. */
const MIN_BOX = 8;


/** The map's extent in degrees around a lake: [west, south, east, north]. */
export function locatorWindow([west, south, east, north]: Bounds): Bounds {
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  const extentWidth = (east - west) * kmPerDegreeLon(lat);
  const extentHeight = (north - south) * KM_PER_DEGREE_LAT;
  const widthKm = Math.max(MIN_WIDTH_KM, CONTEXT * extentWidth, CONTEXT * extentHeight * LOCATOR_WIDTH / LOCATOR_HEIGHT);
  const halfLon = widthKm / 2 / kmPerDegreeLon(lat);
  const halfLat = widthKm * LOCATOR_HEIGHT / LOCATOR_WIDTH / 2 / KM_PER_DEGREE_LAT;
  return [lon - halfLon, lat - halfLat, lon + halfLon, lat + halfLat];
}

type Point = [number, number];
const round = (value: number): number => Math.round(value * 10) / 10;

/** Sutherland–Hodgman against the map rectangle; the clip region is convex, so non-convex rings clip correctly. */
function clipRing(points: Point[]): Point[] {
  const edges: [(p: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + (b[1] - a[1]) * (0 - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= LOCATOR_WIDTH, (a, b) => [LOCATOR_WIDTH, a[1] + (b[1] - a[1]) * (LOCATOR_WIDTH - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= LOCATOR_HEIGHT, (a, b) => [a[0] + (b[0] - a[0]) * (LOCATOR_HEIGHT - a[1]) / (b[1] - a[1]), LOCATOR_HEIGHT]],
  ];
  let output = points;
  for (const [inside, cross] of edges) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i]!;
      const previous = input[(i + input.length - 1) % input.length]!;
      if (inside(current)) {
        if (!inside(previous)) output.push(cross(previous, current));
        output.push(current);
      } else if (inside(previous)) output.push(cross(previous, current));
    }
    if (!output.length) break;
  }
  return output;
}

/** Liang–Barsky per segment; consecutive visible pieces join into one polyline. */
function clipLine(points: Point[]): Point[][] {
  const lines: Point[][] = [];
  let current: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let visible = true;
    for (const [p, q] of [[-dx, x0], [dx, LOCATOR_WIDTH - x0], [-dy, y0], [dy, LOCATOR_HEIGHT - y0]] as const) {
      if (p === 0) { if (q < 0) visible = false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) visible = false; else if (t > t0) t0 = t; } else if (t < t0) visible = false; else if (t < t1) t1 = t;
    }
    if (!visible) { if (current.length > 1) lines.push(current); current = []; continue; }
    const start: Point = [x0 + t0 * dx, y0 + t0 * dy];
    const end: Point = [x0 + t1 * dx, y0 + t1 * dy];
    // Re-entering the map after leaving it starts a new polyline.
    if (t0 > 0 && current.length) { if (current.length > 1) lines.push(current); current = []; }
    if (!current.length) current.push(start);
    current.push(end);
    if (t1 < 1) { lines.push(current); current = []; }
  }
  if (current.length > 1) lines.push(current);
  return lines;
}

/** Points closer than this (SVG units) to the last one drawn are dropped; it is well under a pixel at the page's width. */
const MIN_STEP = 0.6;

function pathOf(parts: Point[][], closed: boolean): string {
  let d = "";
  for (const part of parts) {
    let segment = "";
    let lastX = NaN;
    let lastY = NaN;
    for (let i = 0; i < part.length; i++) {
      const [x, y] = part[i]!;
      const end = i === part.length - 1;
      if (!end && Math.hypot(x - lastX, y - lastY) < MIN_STEP) continue;
      segment += `${segment ? "L" : "M"}${round(x)} ${round(y)}`;
      lastX = x;
      lastY = y;
    }
    if (segment.includes("L")) d += segment + (closed ? "Z" : "");
  }
  return d;
}

/** Scale-bar length: 1, 2 or 5 × a power of ten, about a fifth of the map. */
function niceKm(target: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return [5, 2, 1].map((step) => step * magnitude).find((value) => value <= target) ?? magnitude;
}

/**
 * The locator for one lake. `others` are the centres of the directory's other
 * lakes (lon, lat); the nearest ones inside the map are drawn as dots.
 */
export function buildLocator(bounds: Bounds, data: LocatorData, others: Point[]): LocatorMap {
  const [west, south, east, north] = locatorWindow(bounds);
  const lat0 = (south + north) / 2;
  const lon0 = (west + east) / 2;
  const kmX = kmPerDegreeLon(lat0);
  const widthKm = (east - west) * kmX;
  const unitsPerKm = LOCATOR_WIDTH / widthKm;
  const project = (lon: number, lat: number): Point => [
    LOCATOR_WIDTH / 2 + (lon - lon0) * kmX * unitsPerKm,
    LOCATOR_HEIGHT / 2 - (lat - lat0) * KM_PER_DEGREE_LAT * unitsPerKm,
  ];
  // Cheap reject before projecting: a feature whose degree box misses the window is skipped.
  const margin = 0.5;
  const nearby = (flat: number[]): boolean => {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (let i = 0; i < flat.length; i += 2) {
      minLon = Math.min(minLon, flat[i]!); maxLon = Math.max(maxLon, flat[i]!);
      minLat = Math.min(minLat, flat[i + 1]!); maxLat = Math.max(maxLat, flat[i + 1]!);
    }
    return maxLon >= west - margin && minLon <= east + margin && maxLat >= south - margin && minLat <= north + margin;
  };
  const projectAll = (flat: number[]): Point[] => {
    const points: Point[] = [];
    for (let i = 0; i < flat.length; i += 2) points.push(project(flat[i]!, flat[i + 1]!));
    return points;
  };
  const polygons = (rings: number[][]): string => pathOf(rings.filter(nearby).map((ring) => clipRing(projectAll(ring))).filter((ring) => ring.length > 2), true);
  const lines = (list: number[][]): string => pathOf(list.filter(nearby).flatMap((line) => clipLine(projectAll(line))), false);

  const [bx0, by1] = project(bounds[0], bounds[1]);
  const [bx1, by0] = project(bounds[2], bounds[3]);
  const box = { x: round(bx0), y: round(by0), width: round(bx1 - bx0), height: round(by1 - by0) };
  const center = project(lon0, lat0);
  const cells = new Set<number>();
  const dots = others
    .map(([lon, lat]) => project(lon, lat))
    .filter(([x, y]) => x >= 2 && x <= LOCATOR_WIDTH - 2 && y >= 2 && y <= LOCATOR_HEIGHT - 2)
    .filter(([x, y]) => x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height)
    .sort((a, b) => Math.hypot(a[0] - center[0], a[1] - center[1]) - Math.hypot(b[0] - center[0], b[1] - center[1]))
    .filter(([x, y]) => {
      const cell = Math.floor(x / DOT_CELL) * 1000 + Math.floor(y / DOT_CELL);
      if (cells.has(cell)) return false;
      cells.add(cell);
      return true;
    })
    .slice(0, MAX_DOTS)
    .map(([x, y]) => [round(x), round(y)] as [number, number]);
  const km = niceKm(widthKm / 5);
  return {
    width: LOCATOR_WIDTH,
    height: LOCATOR_HEIGHT,
    land: polygons(data.layers.land),
    lakes: polygons(data.layers.lakes),
    countries: lines(data.layers.countries),
    states: lines(data.layers.states),
    dots,
    box,
    ...(box.width < MIN_BOX || box.height < MIN_BOX ? { marker: { x: round(box.x + box.width / 2), y: round(box.y + box.height / 2) } } : {}),
    scale: { km, length: round(km * unitsPerKm) },
    widthKm: Math.round(widthKm),
  };
}
