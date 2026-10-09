import { index as outlineIndex } from "../../../../../scripts/data/lake-outlines-release.json";
import type { GeoBounds, Polygon2D, ProjectConfigV1, WaterAreaV1 } from "@topostack/core";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { networkSignal } from "$lib/domain/network";
import { mapTiles } from "$lib/domain/tile-requests";
import { createFeatureBudget } from "$lib/domain/feature-budget";

type Bounds = [number, number, number, number];
interface OutlineFeature {
  bbox: Bounds;
  properties: { sourceId: string; surveyId: string; name: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: Pair[][] | Pair[][][] };
}
interface OutlineIndex { schemaVersion: number; shards: { file: string; bounds: Bounds; sourceId: string; count: number }[] }
const intersects = (b: GeoBounds, a: Bounds) => b.east > a[0] && b.west < a[2] && b.north > a[1] && b.south < a[3];
const mercatorY = (lat: number) => Math.asinh(Math.tan(lat * Math.PI / 180));
const input = (p: Polygon2D): MultiPolygon => [[p.outer.map(({ x, y }) => [x, y] as Pair), ...p.holes.map((ring) => ring.map(({ x, y }) => [x, y] as Pair))]];
const ringArea = (ring: Pair[]) => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]!; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const area = (polygons: MultiPolygon) => polygons.reduce((sum, rings) => sum + ringArea(rings[0]!) - rings.slice(1).reduce((n, ring) => n + ringArea(ring), 0), 0);
const polygon = (rings: Pair[][]): Polygon2D => ({ outer: rings[0]!.map(([x, y]) => ({ x, y })), holes: rings.slice(1).map((ring) => ring.map(([x, y]) => ({ x, y }))) });

/** Assets are spatially sharded and fetched only for the selected map window. */
export async function loadProviderOutlines(base: string, bounds: GeoBounds, config: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "minimumFeatureMm">, signal?: AbortSignal): Promise<WaterAreaV1[]> {
  const read = async (file: string) => {
    const response = await fetch(`${base}/v1/lake-outlines/${file}`, { signal: networkSignal(signal) });
    if (!response.ok) throw new Error("Lake outlines could not be loaded.");
    return response.json();
  };
  signal?.throwIfAborted();
  const index = await read(outlineIndex.file) as OutlineIndex;
  if (index.schemaVersion !== 1 || !Array.isArray(index.shards)) throw new Error("Unknown lake outline index.");
  const shards = index.shards.filter((shard) => intersects(bounds, shard.bounds));
  if (shards.length > 64) throw new Error("Narrow the map area to load survey outlines.");
  const collections = await mapTiles(shards, async (shard) => {
    if (!/^[a-f0-9]{24}\.json$/.test(shard.file)) throw new Error("Invalid outline asset path.");
    return await read(shard.file) as { features: OutlineFeature[] };
  }, signal);
  const north = mercatorY(bounds.north), south = mercatorY(bounds.south);
  const project = ([lon, lat]: Pair): Pair => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) >= 85.1) throw new Error("Invalid shoreline coordinate.");
    return [((lon - bounds.west) / (bounds.east - bounds.west) - 0.5) * config.widthMm,
      ((north - mercatorY(lat)) / (north - south) - 0.5) * config.heightMm];
  };
  const clip: MultiPolygon = [[[[-config.widthMm / 2, -config.heightMm / 2], [config.widthMm / 2, -config.heightMm / 2], [config.widthMm / 2, config.heightMm / 2], [-config.widthMm / 2, config.heightMm / 2], [-config.widthMm / 2, -config.heightMm / 2]]]];
  const budget = createFeatureBudget();
  const result: WaterAreaV1[] = [];
  for (const collection of collections) for (const feature of collection.features) {
    signal?.throwIfAborted();
    if (!intersects(bounds, feature.bbox)) continue;
    if (!["Polygon", "MultiPolygon"].includes(feature.geometry.type)) throw new Error("Invalid shoreline geometry.");
    const parts = (feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates) as Pair[][][];
    const projected = parts.map((rings) => rings.map((ring) => ring.map(project)));
    projected.forEach((rings) => budget(rings.map((ring) => ring.map(([x, y]) => ({ x, y }))), true));
    projected.forEach((rings, i) => {
      if (area(polygonClipping.intersection([rings], clip)) < config.minimumFeatureMm ** 2) return;
      // Keep real shores beyond the crop; clipping a polygon here would invent
      // a scored shoreline along the crop edge. The geometry stage clips output.
      result.push({ id: `survey-${feature.properties.sourceId}-${feature.properties.surveyId}-${i}`, kind: "lake",
        name: feature.properties.name, outlineSource: "provider", outlineSourceId: feature.properties.sourceId, surveyId: feature.properties.surveyId,
        polygon: polygon(rings), clipped: feature.bbox[0] <= bounds.west || feature.bbox[1] <= bounds.south || feature.bbox[2] >= bounds.east || feature.bbox[3] >= bounds.north });
    });
  }
  return result;
}

interface EdgeBlock { box: Bounds; ring: Pair[]; start: number; end: number }
interface Measured { shape: MultiPolygon; size: number; box: Bounds; blocks?: EdgeBlock[]; detail?: number }
const measure = (p: Polygon2D): Measured => {
  const shape = input(p);
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of p.outer) {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  }
  return { shape, size: area(shape), box };
};
/**
 * Shore vertices per unit of perimeter. Two outlines of one lake share a shore,
 * so the denser one was simplified less. Across sampled lakes HydroLAKES was
 * the coarsest wherever another outline existed (median 2.7x fewer vertices
 * than the map); provider masks and the map were close to each other.
 */
function detail(measured: Measured): number {
  if (measured.detail !== undefined) return measured.detail;
  let vertices = 0, length = 0;
  for (const ring of measured.shape.flat()) {
    for (let i = 0; i < ring.length; i += 1) {
      const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
      const edge = Math.hypot(bx - ax, by - ay);
      if (edge > 0) { vertices += 1; length += edge; }
    }
  }
  return measured.detail = length > 0 ? vertices / length : 0;
}
/**
 * How much denser another shore must be to replace a provider mask. Survey
 * depths are masked to that mask, so a marginally finer shore is not worth
 * the uncovered rim it leaves; a HydroLAKES shore carries no survey.
 */
const PROVIDER_SHORE_MARGIN = 1.5;
const finerShore = (candidate: Measured, current: Measured, currentSource: WaterAreaV1["outlineSource"]) =>
  detail(candidate) > detail(current) * (currentSource === "provider" ? PROVIDER_SHORE_MARGIN : 1);

const boxOverlap = (a: Bounds, b: Bounds) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
// Closed comparison: an edge touching the box counts as entering it.
const boxesTouch = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const EDGE_BLOCK = 32;

/** Every edge, closing edges included, grouped in runs with their bounding boxes. */
function edgeBlocks(measured: Measured): EdgeBlock[] {
  if (measured.blocks) return measured.blocks;
  const blocks: EdgeBlock[] = [];
  for (const ring of measured.shape.flat()) {
    for (let start = 0; start < ring.length; start += EDGE_BLOCK) {
      const end = Math.min(ring.length, start + EDGE_BLOCK), box: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = start; i <= end; i += 1) {
        const [x, y] = ring[i % ring.length]!;
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      }
      blocks.push({ box, ring, start, end });
    }
  }
  return measured.blocks = blocks;
}

/** Whether any edge of `measured` may pass through `box`. */
function boundaryEnters(measured: Measured, box: Bounds): boolean {
  return edgeBlocks(measured).some(({ box: blockBox, ring, start, end }) => {
    if (!boxesTouch(blockBox, box)) return false;
    for (let i = start; i < end; i += 1) {
      const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
      if (boxesTouch([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)], box)) return true;
    }
    return false;
  });
}

const inRing = ([x, y]: Pair, ring: Pair[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[j]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};
const inShape = (point: Pair, shape: MultiPolygon) => shape.some(([outer, ...holes]) => inRing(point, outer!) && !holes.some((hole) => inRing(point, hole)));

/**
 * When one outline's boundary never enters the other's bounding box, the other
 * lies wholly inside or wholly outside it, so a single point decides the
 * intersection exactly: all of the enclosed outline, or nothing.
 */
function containment(a: Measured, b: Measured): { shared: MultiPolygon | undefined } | undefined {
  for (const [outer, inner] of [[a, b], [b, a]] as const) {
    const point = inner.shape[0]?.[0]?.[0];
    if (!point || boundaryEnters(outer, inner.box)) continue;
    return { shared: inShape(point, outer.shape) ? inner.shape : undefined };
  }
  return undefined;
}

/** Prefer provider shores, but retain a complete lake over a partial survey mask.
 * Lower-priority copies of the same waterbody are suppressed, not cut into
 * strips that would create artificial shorelines and duplicate modeled basins.
 * Where two sources outline the same lake, the lake keeps its identity and
 * depth metadata but takes the more detailed shore (see `finerShore`).
 */
export function resolveLakeOutlines(providers: WaterAreaV1[], hydro: WaterAreaV1[], inland: Polygon2D[]): WaterAreaV1[] {
  // Lake-country crops compare hundreds of outlines pairwise, and a polygon
  // boolean per pair took seconds. An intersection never exceeds the overlap of
  // the two bounding boxes, so pairs whose boxes cannot reach the match
  // threshold are decided without one.
  const measured = new Map<Polygon2D, Measured>();
  const measureOnce = (p: Polygon2D) => {
    let entry = measured.get(p);
    if (!entry) measured.set(p, entry = measure(p));
    return entry;
  };
  /** The intersection when the two overlap by more than half the smaller one. */
  const majorOverlap = (a: Measured, b: Measured): MultiPolygon | undefined => {
    const threshold = Math.min(a.size, b.size) * 0.5;
    if (boxOverlap(a.box, b.box) <= threshold) return undefined;
    // A pond clear of a large lake's shore need not sweep that whole shoreline.
    const known = containment(a, b);
    const shared = known ? known.shared : polygonClipping.intersection(a.shape, b.shape);
    if (!shared) return undefined;
    return area(shared) > threshold ? shared : undefined;
  };
  let resolved = providers.length ? [...providers] : [...hydro];
  for (const lake of providers.length ? hydro : []) {
    const candidate = measureOnce(lake.polygon), size = candidate.size;
    const matches: WaterAreaV1[] = [], intersections: MultiPolygon[] = [];
    for (const p of resolved) {
      const shared = majorOverlap(candidate, measureOnce(p.polygon));
      if (shared) { matches.push(p); intersections.push(shared); }
    }
    if (!matches.length) { resolved.push(lake); continue; }
    const covered = area(polygonClipping.union(intersections[0]!, ...intersections.slice(1)));
    if (covered < size * 0.8) {
      resolved = resolved.filter((p) => !matches.includes(p));
      resolved.push(lake);
    } else {
      // Whole-lake estimates must not be assigned to individual survey basins.
      if (matches.length === 1 && covered >= measureOnce(matches[0]!.polygon).size * 0.8) resolved = resolved.map((p) => p === matches[0] ? {
        ...lake, ...p, hylakId: lake.hylakId, surfaceElevationM: lake.surfaceElevationM,
        polygon: finerShore(candidate, measureOnce(p.polygon), p.outlineSource) ? lake.polygon : p.polygon,
      } : p);
    }
  }
  inland.forEach((p, i) => {
    // polygon-clipping can fail on near-degenerate map water (a sliver shared
    // by two rivers, say). One such polygon is skipped rather than costing the
    // whole map its water: it is map-only water, which carves nothing anyway.
    try {
    const candidate = measureOnce(p), size = candidate.size;
    if (!(size > 0)) return;
    // Rebuilding shorelines resolves again with the map lakes already added;
    // a lake made from this very outline is a non-provider match, so it stays out.
    if (resolved.some((lake) => lake.polygon === p && lake.outlineSource !== "provider")) return;
    const matches: WaterAreaV1[] = [], overlaps: MultiPolygon[] = [];
    for (const lake of resolved) {
      const shared = majorOverlap(candidate, measureOnce(lake.polygon));
      if (shared) { matches.push(lake); overlaps.push(shared); }
    }
    if (matches.length) {
      // The same waterbody: carve whichever shore is more detailed, keeping
      // the lake's identity and depths. Map water that also holds a river or
      // a neighbouring lake is a different shape and replaces nothing.
      const [lake] = matches, current = measureOnce(lake!.polygon);
      const shared = matches.length === 1 && lake!.outlineSource !== "osm" ? area(overlaps[0]!) : 0;
      if (shared >= size * 0.8 && shared >= current.size * 0.8) {
        if (finerShore(candidate, current, lake!.outlineSource)) resolved = resolved.map((item) => item === lake ? { ...lake, polygon: p } : item);
        return;
      }
      // A provider depth-area mask may cover only one bay of the OSM lake.
      // Keep the complete shore and let the raster mask limit surveyed depths.
      if (matches.every((lake) => lake.outlineSource === "provider")) {
        if (area(polygonClipping.union(overlaps[0]!, ...overlaps.slice(1))) < size * 0.8) {
          resolved = resolved.filter((lake) => !matches.includes(lake));
        } else return;
      } else return;
    }
    resolved.push({ id: `osm-lake-${i}`, kind: "lake", polygon: p, outlineSource: "osm" });
    } catch (error) {
      console.warn("TopoStack: a map water outline could not be compared with the lake data and was left out.", error);
    }
  });
  return resolved;
}
