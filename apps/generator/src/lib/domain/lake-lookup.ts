import { ringIou } from "@topostack/chart-trace/georef";
import { DEFAULT_PROJECT, type GeoBounds, type Polygon2D, type WaterAreaV1 } from "@topostack/core";
import { KM_PER_DEGREE_LAT, kmPerDegreeLon } from "$lib/domain/coordinates";
import { loadLakeAreas } from "$lib/domain/lake-area-loader";
import { loadVectorMarkings } from "$lib/domain/vector-loader";
import type { PlaceResult } from "$lib/domain/geocode";
import { resolveLakeOutlines } from "$lib/domain/lake-outlines";
import { artworkToLonLat } from "$lib/domain/tile-math";

/**
 * Finding a lake to chart, by name, without generating anything.
 *
 * Tracing a depth chart is its own job: a maker may do it long before they
 * frame a map or press Generate. So a lake is found the same way a place is —
 * search, then pick — and its outline comes straight from the water data the
 * studio already loads, not from a generated project.
 */

export interface ChartableLake {
  id: string;
  name: string;
  /**
   * The HydroLAKES id a project keys the lake by. Absent for a lake drawn only
   * on the map (OpenStreetMap), whose chart is then keyed by its own outline.
   */
  hylakId?: number;
  /** The shore in [lon, lat], which is what a chart is snapped onto. */
  outline: [number, number][];
  /** Rough footprint in square degrees, so the biggest lake sorts first. */
  footprint: number;
  /** How far across the lake runs, west to east and south to north, in kilometres. */
  spanKm: [number, number];
  /** How far the lake's middle lies from the searched place, in kilometres. */
  distanceKm: number;
  /**
   * The lake runs past the searched window, so `outline` is cut off there.
   * `wholeLake` loads the rest before a chart is snapped onto it.
   */
  clipped: boolean;
}

/** What a search around a place found. */
export interface LakeSearch {
  /** Lakes a chart can be traced for, largest first. */
  lakes: ChartableLake[];
  /**
   * Small lakes only the map draws, nearest first. There are often hundreds
   * in a search window and none would rank among the biggest, so they are
   * listed apart, by how near they are to the place searched.
   */
  ponds: ChartableLake[];
  /**
   * Lakes known only from a published survey, with no HydroLAKES id to key a
   * chart by. They already carve from the survey, so they are named rather
   * than silently left out.
   */
  surveyed: string[];
}

type LakeLoader = (bounds: GeoBounds, zoom: number, config: typeof DEFAULT_PROJECT, signal?: AbortSignal) => Promise<WaterAreaV1[]>;
type MapWaterLoader = (bounds: GeoBounds, zoom: number, config: typeof DEFAULT_PROJECT, signal?: AbortSignal) => Promise<Polygon2D[]>;

/** Lakes on the map that no lake dataset lists, mostly small ones. Only water is read. */
const loadMapWater: MapWaterLoader = async (bounds, zoom, config, signal) =>
  (await loadVectorMarkings(bounds, zoom, { ...config, showWater: true, showRoads: false, showTrails: false, showBoundaries: false }, signal)).inland;

/**
 * Map water HydroLAKES does not list is dissolved: a river and its oxbows come
 * out as one polygon, often tens of kilometres long. A lake HydroLAKES misses
 * is small (it lists everything from ten hectares), whole, and roughly round,
 * so only map water like that is offered.
 */
const MAP_LAKE_MAX_SPAN_KM = 3;
/** 4πA/P²: 1 for a circle, about 0.6 for a square, near 0 for a river. */
const MAP_LAKE_MIN_ROUNDNESS = 0.1;

function roundness(outline: readonly [number, number][]): number {
  if (outline.length < 3) return 0;
  const midLat = outline.reduce((sum, [, lat]) => sum + lat, 0) / outline.length;
  const kmX = kmPerDegreeLon(midLat);
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const [x1, y1] = outline[index]!;
    const [x2, y2] = outline[(index + 1) % outline.length]!;
    twiceArea += x1 * kmX * y2 * KM_PER_DEGREE_LAT - x2 * kmX * y1 * KM_PER_DEGREE_LAT;
    perimeter += Math.hypot((x2 - x1) * kmX, (y2 - y1) * KM_PER_DEGREE_LAT);
  }
  return perimeter > 0 ? (4 * Math.PI * Math.abs(twiceArea / 2)) / (perimeter * perimeter) : 0;
}

/** The name a lake with none is listed by: where its outline came from says what it is. */
const unnamed = (area: WaterAreaV1): string => (area.outlineSource === "osm" ? "Lake from the map" : "Unnamed lake");

/**
 * How wide a window around a searched place is scanned for lakes. Wide enough
 * that naming the town beside a lake finds it: a place result lands on the town
 * centre, and a lake ten kilometres out is still the one that was meant.
 */
const LAKE_WINDOW_DEG = 0.3;
const LAKE_WINDOW_ZOOM = 11;
/** The closest zoom a lake is loaded at: a pond picked from the map is loaded again this close. */
const DETAIL_ZOOM = 15;
/** The scratch canvas lake outlines arrive on; only its aspect matters. */
const WINDOW_MM = 200;
const MAX_LAKES = 12;
const MAX_PONDS = 8;
/** Ponds further than this from the place searched are not what was meant. */
const MAX_POND_DISTANCE_KM = 5;
/** A clipped lake is reloaded over its own extent at most this many times, and never wider than this. */
const WHOLE_LAKE_ATTEMPTS = 3;
const WHOLE_LAKE_MAX_SPAN_DEG = 2.4;

/** A square window around a place, wide enough to hold the lake it names. */
export function lakeWindow(lat: number, lon: number, spanDeg = LAKE_WINDOW_DEG): GeoBounds {
  const half = spanDeg / 2;
  // Longitude degrees shrink towards the poles; keep the window square on the ground.
  const lonHalf = half / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return { west: lon - lonHalf, east: lon + lonHalf, south: lat - half, north: lat + half };
}

/**
 * How big the lake is, in degrees and on the ground. HydroLAKES names only
 * some of its lakes, so size is often the only way to tell two apart in a list.
 */
function sizeOf(outline: readonly [number, number][]): { footprint: number; spanKm: [number, number] } {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lon, lat] of outline) {
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return {
    footprint: (east - west) * (north - south),
    spanKm: [(east - west) * kmPerDegreeLon((south + north) / 2), (north - south) * KM_PER_DEGREE_LAT],
  };
}

function boundsOf(outline: readonly [number, number][]): GeoBounds {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lon, lat] of outline) {
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return { west, east, south, north };
}

/** Loads the lakes in a window, in ground coordinates, one entry per lake. */
async function loadWindow(bounds: GeoBounds, place: Pick<PlaceResult, "lat" | "lon">, load: LakeLoader, loadWater: MapWaterLoader, signal?: AbortSignal): Promise<{ lakes: ChartableLake[]; surveyed: { name: string; footprint: number }[] }> {
  // Wider windows load coarser tiles, so a big lake costs about what a small one does.
  const span = Math.max(bounds.north - bounds.south, bounds.east - bounds.west);
  const zoom = Math.max(7, Math.min(DETAIL_ZOOM, Math.round(LAKE_WINDOW_ZOOM - Math.log2(span / LAKE_WINDOW_DEG))));
  const middle = { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 };
  const config = { ...DEFAULT_PROJECT, widthMm: WINDOW_MM, heightMm: WINDOW_MM, showWater: true, location: { ...DEFAULT_PROJECT.location, ...middle, zoom, bounds } };
  // The map's own water is a bonus: without it the lake datasets still answer.
  const [datasets, mapWater] = await Promise.all([load(bounds, zoom, config, signal), loadWater(bounds, zoom, config, signal).catch(() => [] as Polygon2D[])]);
  // Resolved the way generation resolves them, so a lake listed here is the
  // lake the project will carve, and map-only lakes come out as their own.
  const areas = resolveLakeOutlines([], datasets.filter((area) => area.outlineSource !== "osm"), mapWater);
  const toLonLat = artworkToLonLat(bounds, WINDOW_MM, WINDOW_MM);
  const halfMm = WINDOW_MM / 2 - 1e-6;
  const byLake = new Map<string, ChartableLake>();
  const surveyed: { name: string; footprint: number }[] = [];
  for (const area of areas) {
    if (area.kind !== "lake" || area.polygon.outer.length < 3) continue;
    const outline = area.polygon.outer.map(toLonLat);
    const size = sizeOf(outline);
    if (area.hylakId === undefined && area.outlineSource !== "osm") {
      // A survey outline with no HydroLAKES match: carved from its survey already.
      if (area.id.startsWith("survey-") && area.name) surveyed.push({ name: area.name, footprint: size.footprint });
      continue;
    }
    // Many lakes are unnamed in the water data, so how big it is and how far
    // off it lies are what let a maker pick the one they meant.
    const centre = outline.reduce(([sx, sy], [lon, lat]) => [sx + lon / outline.length, sy + lat / outline.length], [0, 0]);
    const distanceKm = Math.hypot((centre[0]! - place.lon) * kmPerDegreeLon(place.lat), (centre[1]! - place.lat) * KM_PER_DEGREE_LAT);
    // Map water carries no clipped flag; an outline running along the window's edge was cut there.
    const clipped = area.clipped === true || area.polygon.outer.some((point) => Math.abs(point.x) >= halfMm || Math.abs(point.y) >= halfMm);
    if (area.hylakId === undefined && (clipped || Math.max(...size.spanKm) > MAP_LAKE_MAX_SPAN_KM || roundness(outline) < MAP_LAKE_MIN_ROUNDNESS)) continue;
    const candidate: ChartableLake = { id: area.id, name: area.name ?? unnamed(area), ...(area.hylakId === undefined ? {} : { hylakId: area.hylakId }), outline, ...size, distanceKm, clipped };
    // A lake split into parts (by an island chain or a causeway) is listed
    // once, by its largest part, which is the shore a chart is snapped onto.
    const key = area.hylakId === undefined ? area.id : `hylak-${area.hylakId}`;
    const known = byLake.get(key);
    if (!known) byLake.set(key, candidate);
    else {
      const name = known.name === "Unnamed lake" ? candidate.name : known.name;
      byLake.set(key, { ...(candidate.footprint > known.footprint ? candidate : known), name, clipped: known.clipped || candidate.clipped });
    }
  }
  return { lakes: [...byLake.values()], surveyed };
}

/**
 * The lakes around a searched place, largest first. Only lakes with a
 * HydroLAKES id are offered, because that is how a project names the lake a
 * chart belongs to.
 */
export async function lakesNear(place: Pick<PlaceResult, "lat" | "lon">, signal?: AbortSignal, load: LakeLoader = loadLakeAreas, loadWater: MapWaterLoader = loadMapWater): Promise<LakeSearch> {
  const { lakes: found, surveyed } = await loadWindow(lakeWindow(place.lat, place.lon), place, load, loadWater, signal);
  return {
    lakes: found.filter((lake) => lake.hylakId !== undefined).sort((left, right) => right.footprint - left.footprint).slice(0, MAX_LAKES),
    ponds: found.filter((lake) => lake.hylakId === undefined && lake.distanceKm <= MAX_POND_DISTANCE_KM).sort((left, right) => left.distanceKm - right.distanceKm).slice(0, MAX_PONDS),
    surveyed: [...new Set(surveyed.sort((left, right) => right.footprint - left.footprint).map((lake) => lake.name))].slice(0, 4),
  };
}

/**
 * The same lake in a wider load: by HydroLAKES id, or for a map-only lake,
 * which has no lasting id, the lake the part already seen overlaps most.
 */
function findAgain(seen: ChartableLake, lakes: readonly ChartableLake[]): ChartableLake | undefined {
  if (seen.hylakId !== undefined) return lakes.find((candidate) => candidate.hylakId === seen.hylakId);
  let best: { lake: ChartableLake; iou: number } | undefined;
  for (const candidate of lakes) {
    if (candidate.hylakId !== undefined) continue;
    const iou = ringIou(seen.outline, candidate.outline);
    if (iou > 0.2 && (!best || iou > best.iou)) best = { lake: candidate, iou };
  }
  return best?.lake;
}

/**
 * The whole of a lake the search window cut off. A chart snapped onto part of
 * a shore would be placed wrongly with nothing to show for it, so the lake is
 * loaded again over its own extent until none of it is cut, or it is refused.
 */
export async function wholeLake(lake: ChartableLake, signal?: AbortSignal, load: LakeLoader = loadLakeAreas, loadWater: MapWaterLoader = loadMapWater): Promise<ChartableLake> {
  if (lake.hylakId === undefined && !lake.clipped) {
    // A pond from the map arrives as the few points the search's zoom kept.
    // It is loaded again close up, so the chart snaps onto its real shore.
    const seen = boundsOf(lake.outline);
    const padLat = Math.max(0.003, (seen.north - seen.south) * 0.5);
    const padLon = Math.max(0.003, (seen.east - seen.west) * 0.5);
    const bounds = { west: seen.west - padLon, east: seen.east + padLon, south: seen.south - padLat, north: seen.north + padLat };
    const { lakes } = await loadWindow(bounds, { lat: lake.outline[0]![1], lon: lake.outline[0]![0] }, load, loadWater, signal);
    const found = findAgain(lake, lakes);
    return found ? { ...found, name: lake.name, distanceKm: lake.distanceKm } : lake;
  }
  let current = lake;
  for (let attempt = 0; current.clipped && attempt < WHOLE_LAKE_ATTEMPTS; attempt += 1) {
    const seen = boundsOf(current.outline);
    // Grow past what was seen: the cut edge is where the rest of the lake is.
    const padLat = Math.max(0.05, (seen.north - seen.south) * 0.75);
    const padLon = Math.max(0.05, (seen.east - seen.west) * 0.75);
    const bounds = { west: seen.west - padLon, east: seen.east + padLon, south: Math.max(-85, seen.south - padLat), north: Math.min(85, seen.north + padLat) };
    if (bounds.north - bounds.south > WHOLE_LAKE_MAX_SPAN_DEG || bounds.east - bounds.west > WHOLE_LAKE_MAX_SPAN_DEG * 2) break;
    const { lakes } = await loadWindow(bounds, { lat: lake.outline[0]![1], lon: lake.outline[0]![0] }, load, loadWater, signal);
    const found = findAgain(current, lakes);
    if (!found) break;
    current = { ...found, name: lake.name, distanceKm: lake.distanceKm };
  }
  if (current.clipped) throw new Error(`${lake.name} is too large to place a chart on from here.`);
  return current;
}

/** Whether a map click falls inside a lake outline. */
export function lakeContains(lake: ChartableLake, lat: number, lon: number): boolean {
  let inside = false;
  const ring = lake.outline;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i]!, [px, py] = ring[j]!;
    if ((y > lat) !== (py > lat) && lon < (px - x) * (lat - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

/** Resolve the clicked water body, including lakes outside a search's shortlist. */
export async function lakeAt(lat: number, lon: number, signal?: AbortSignal, load: LakeLoader = loadLakeAreas, loadWater: MapWaterLoader = loadMapWater): Promise<ChartableLake | undefined> {
  // A close-up tile window can miss a lake represented at a coarser zoom or
  // retain only a disconnected part. Retry the same wider window as search;
  // still require containment so nearby land never selects an arbitrary lake.
  for (const span of [0.08, LAKE_WINDOW_DEG]) {
    signal?.throwIfAborted();
    const { lakes } = await loadWindow(lakeWindow(lat, lon, span), { lat, lon }, load, loadWater, signal);
    signal?.throwIfAborted();
    const found = lakes.filter(lake => lakeContains(lake, lat, lon)).sort((a, b) => a.footprint - b.footprint)[0];
    if (found) return found;
  }
  return undefined;
}

/** All chartable lakes in the visible map, without the search shortlist limits. */
export async function lakesInView(bounds: GeoBounds, signal?: AbortSignal): Promise<ChartableLake[]> {
  const place = { lat: (bounds.north + bounds.south) / 2, lon: (bounds.west + bounds.east) / 2 };
  return (await loadWindow(bounds, place, loadLakeAreas, loadMapWater, signal)).lakes;
}
