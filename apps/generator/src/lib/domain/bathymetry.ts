import { mapTiles } from "$lib/domain/tile-requests";
import { EARTH_RADIUS_M, type ElevationGrid, type GeoBounds, type ProjectConfigV1, type SourceAttribution, type SourceBundleV1, type WaterAreaV1 } from "@topostack/core";
import { createArchive } from "$lib/domain/archive";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { latToWorldY, lonToWorldX } from "$lib/domain/tile-math";
import rawSurveyCatalog from "../../../../../scripts/data/lake-bathymetry.json";
import { validateSurveyCatalog, type SurveySource } from "@topostack/data-contracts/source-catalog";
import catalog from "../../../../../scripts/data/noaa-great-lakes.json";

const registry = validateSurveyCatalog(rawSurveyCatalog);

export const NOAA_DATASET_VERSION = catalog.dataset;
export const NOAA_ATTRIBUTION = {
  name: "NOAA NCEI Great Lakes Bathymetry",
  url: catalog.sourceUrl,
  license: "NOAA/NCEI — Great Lakes bathymetric grids; Lake Superior is a draft. " + catalog.lakes.flatMap((lake) => lake.doi ? [lake.doi] : []).join("; "),
};
const names = new Set(catalog.lakes.flatMap((lake) => lake.names.map((name) => name.toLowerCase())));
const lakeIds = new Set(catalog.lakes.flatMap((lake) => lake.hylakIds));
export function hasNoaaCoverage(area: WaterAreaV1): boolean {
  return area.kind === "lake" && (area.outlineSource === "osm" || (area.hylakId === undefined
    ? names.has(area.name?.trim().toLowerCase() ?? "")
    : lakeIds.has(area.hylakId)));
}
const worldX = lonToWorldX;
const worldY = latToWorldY;

/**
 * Interpolate only covered samples; a transparent neighbor never becomes a
 * zero-depth shore. The corners are unrolled in place of the literal table the
 * loop used to allocate: this runs once per grid pixel, so five short-lived
 * arrays per call dominated the whole raster pass.
 */
export function sampleDepth(sample: (x: number, y: number) => number, x: number, y: number, min = 0, max = 1500): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let depth = 0;
  // Corner order and weight arithmetic match the original table exactly, so
  // summed depths stay bit-identical.
  for (let corner = 0; corner < 4; corner += 1) {
    const dx = corner & 1, dy = corner >> 1;
    const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    if (weight <= 1e-10) continue;
    const value = sample(x0 + dx, y0 + dy);
    if (!Number.isFinite(value) || value < min || value > max) return Number.NaN;
    depth += value * weight;
  }
  return depth;
}

/** Fetch a bounded tile window and align positive-down depths to the DEM's sample locations. */
async function loadRaster(apiBase: string, bounds: GeoBounds, width: number, height: number, requestedZoom: number, areas: WaterAreaV1[], dataset: SurveySource, signal?: AbortSignal): Promise<{ areas: WaterAreaV1[]; status: "available" | "unavailable" | "not-covered" }> {
  signal?.throwIfAborted();
  if (!areas.length) return { areas, status: "not-covered" };
  try {
    const archive = createArchive(`${apiBase}/v1/bathymetry/${dataset.id}.pmtiles`, signal);
    const header = await archive.getHeader();
    if (header.tileType !== 2 || (!Number.isInteger(header.minZoom) || header.minZoom < 0 || header.minZoom > dataset.maxZoom) || header.maxZoom !== dataset.maxZoom) throw new Error("Unexpected survey archive format.");
    const metadata = await archive.getMetadata() as Record<string, unknown>;
    if (metadata.topostack_encoding !== dataset.encoding || metadata.topostack_dataset !== dataset.id) throw new Error("Unexpected survey depth encoding.");
    let z = Math.max(0, Math.min(dataset.maxZoom, Math.round(requestedZoom)));
    // Include the neighboring pixel at the crop boundary for bilinear sampling.
    const tileBounds = () => ({
      left: Math.max(0, Math.floor((worldX(bounds.west, z) - 0.5) / 256)),
      right: Math.min(2 ** z - 1, Math.floor((worldX(bounds.east, z) + 0.5) / 256)),
      top: Math.max(0, Math.floor((worldY(bounds.north, z) - 0.5) / 256)),
      bottom: Math.min(2 ** z - 1, Math.floor((worldY(bounds.south, z) + 0.5) / 256)),
    });
    let window = tileBounds();
    while ((window.right - window.left + 1) * (window.bottom - window.top + 1) > 24 && z > 0) { z -= 1; window = tileBounds(); }
    const tiles = new Map<string, Float32Array>();
    const coordinates: Array<{ x: number; y: number }> = [];
    for (let y = window.top; y <= window.bottom; y += 1) {
      for (let x = window.left; x <= window.right; x += 1) coordinates.push({ x, y });
    }
    await mapTiles(coordinates, async ({ x, y }, signal) => {
      const tile = await archive.getZxy(z, x, y, signal);
      signal?.throwIfAborted();
      if (tile) {
        const values = decodeTerrainPng(new Uint8Array(tile.data), true);
        for (let i = 0; i < values.length; i += 1) {
          const value = values[i]!;
          if (Number.isNaN(value)) continue;
          if (!Number.isFinite(value) || (dataset.encoding === "elevation-terrarium-v1" ? value < -500 || value > 9000 : value < 0 || value > 1500)) throw new Error("Invalid survey sample.");
        }
        tiles.set(`${x}/${y}`, values);
      }
    }, signal);
    const sample = (x: number, y: number) => tiles.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`)?.[(y % 256) * 256 + x % 256] ?? Number.NaN;
    const depthsM = new Float32Array(width * height);
    let covered = false;
    const west = worldX(bounds.west, z), north = worldY(bounds.north, z);
    const spanX = worldX(bounds.east, z) - west, spanY = worldY(bounds.south, z) - north;
    for (let row = 0; row < height; row += 1) {
      signal?.throwIfAborted();
      for (let column = 0; column < width; column += 1) {
        const depth = sampleDepth(sample, west + spanX * column / (width - 1) - 0.5, north + spanY * row / (height - 1) - 0.5, dataset.encoding === "elevation-terrarium-v1" ? -500 : 0, dataset.encoding === "elevation-terrarium-v1" ? 9000 : 1500);
        depthsM[row * width + column] = depth;
        if (Number.isFinite(depth)) covered = true;
      }
    }
    if (!covered) return { areas, status: "not-covered" };
    const sampleSpacingM = 2 * Math.PI * EARTH_RADIUS_M * Math.cos((bounds.north + bounds.south) / 2 * Math.PI / 180) / (256 * 2 ** z);
    const bathymetry = { width, height, depthsM, sampleSpacingM };
    return { areas: areas.map((area) => ({ ...area, bathymetry })), status: "available" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { areas, status: "unavailable" };
  }
}

const intersects = (bounds: GeoBounds, extent: number[]) => bounds.east > extent[0]! && bounds.west < extent[2]! && bounds.north > extent[1]! && bounds.south < extent[3]!;

/**
 * Cells a scanline pass may visit before it hands the main thread back. A whole
 * 768² grid against a shoreline of thousands of vertices runs far longer than a
 * frame, and `throwIfAborted` can never observe a Cancel that has not been
 * dispatched yet, so the pass has to return to the event loop to be cancellable
 * at all. Exported so tests can size a grid that is guaranteed to yield.
 */
export const MASK_YIELD_CELLS = 200_000;

/** Per-row abort check plus a macrotask yield once `MASK_YIELD_CELLS` cells have been visited. */
function createYielder(signal?: AbortSignal): (cells: number) => Promise<void> {
  let visited = 0;
  return async (cells: number) => {
    signal?.throwIfAborted();
    visited += cells;
    if (visited < MASK_YIELD_CELLS) return;
    visited = 0;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  };
}

/**
 * Where each edge spanning row `y` crosses it, ascending. The expression is the
 * one the per-pixel crossing test used, so a pixel sees exactly the same
 * comparison (`x < crossing`) against exactly the same values.
 */
function rowCrossings(ring: WaterAreaV1["polygon"]["outer"], y: number, out: number[]): number[] {
  out.length = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > y) !== (b.y > y)) out.push((b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x);
  }
  return out.sort((left, right) => left - right);
}

/** A lake's grid pixels, stored for the pixel box only rather than the whole grid. */
export interface PixelMask {
  rowStart: number; rowEnd: number; colStart: number; colEnd: number;
  /** One byte per pixel of the box, row-major from (`rowStart`, `colStart`). */
  inside: Uint8Array;
}

/**
 * Mark every grid pixel inside `polygon`, one scanline per row instead of one
 * point-in-polygon per pixel: the old loop re-walked the whole ring for each of
 * up to 768² pixels, per lake and per survey provider, and froze the tab.
 *
 * A pixel was inside when an odd number of ring crossings lay to its right, so
 * counting down a sorted row of crossings answers every pixel in that row in
 * one sweep — identical results, because each pixel still resolves the same
 * comparison against the same crossing values.
 */
export async function buildPixelMask(polygon: WaterAreaV1["polygon"], grid: Pick<ElevationGrid, "width" | "height">, dimensions: Pick<ProjectConfigV1, "widthMm" | "heightMm">, signal?: AbortSignal): Promise<PixelMask> {
  const box = pixelBox(polygon.outer, grid, dimensions);
  const width = Math.max(0, box.colEnd - box.colStart + 1);
  const inside = new Uint8Array(Math.max(0, box.rowEnd - box.rowStart + 1) * width);
  // The outer ring marks candidates; every hole (an island, a neighboring lake)
  // clears them again, matching the old `insideRing && !holes.some(insideRing)`.
  const rings = [polygon.outer, ...polygon.holes];
  const crossings: number[] = [];
  const yieldWork = createYielder(signal);
  for (let row = box.rowStart; row <= box.rowEnd; row += 1) {
    await yieldWork(width * rings.length);
    const y = (row / (grid.height - 1) - 0.5) * dimensions.heightMm;
    const offset = (row - box.rowStart) * width;
    for (let ring = 0; ring < rings.length; ring += 1) {
      rowCrossings(rings[ring]!, y, crossings);
      // No crossing on this row means the outer ring misses it entirely.
      if (!crossings.length) { if (ring === 0) break; continue; }
      let cursor = 0;
      for (let col = box.colStart; col <= box.colEnd; col += 1) {
        const x = (col / (grid.width - 1) - 0.5) * dimensions.widthMm;
        while (cursor < crossings.length && crossings[cursor]! <= x) cursor += 1;
        if ((crossings.length - cursor) % 2 === 0) continue;
        inside[offset + col - box.colStart] = ring === 0 ? 1 : 0;
      }
    }
  }
  return { ...box, inside };
}

/**
 * Grid rows and columns that can fall inside a ring, from its bounding box in
 * the same millimetre space as the per-pixel test. The range is widened by one
 * pixel and a small epsilon, so every pixel that `insideRing` would accept is
 * still visited and tested exactly.
 */
export function pixelBox(ring: WaterAreaV1["polygon"]["outer"], grid: Pick<ElevationGrid, "width" | "height">, dimensions: Pick<ProjectConfigV1, "widthMm" | "heightMm">): { rowStart: number; rowEnd: number; colStart: number; colEnd: number } {
  const full = { rowStart: 0, rowEnd: grid.height - 1, colStart: 0, colEnd: grid.width - 1 };
  if (!ring.length) return { rowStart: 0, rowEnd: -1, colStart: 0, colEnd: -1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const toIndex = (value: number, sizeMm: number, count: number) => (value / sizeMm + 0.5) * (count - 1);
  const pad = 1e-6 * Math.max(1, Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY));
  const colStart = Math.floor(toIndex(minX - pad, dimensions.widthMm, grid.width)) - 1;
  const colEnd = Math.ceil(toIndex(maxX + pad, dimensions.widthMm, grid.width)) + 1;
  const rowStart = Math.floor(toIndex(minY - pad, dimensions.heightMm, grid.height)) - 1;
  const rowEnd = Math.ceil(toIndex(maxY + pad, dimensions.heightMm, grid.height)) + 1;
  if (![colStart, colEnd, rowStart, rowEnd].every(Number.isFinite) || dimensions.widthMm <= 0 || dimensions.heightMm <= 0) return full;
  return { rowStart: Math.max(0, rowStart), rowEnd: Math.min(full.rowEnd, rowEnd), colStart: Math.max(0, colStart), colEnd: Math.min(full.colEnd, colEnd) };
}

export interface SurveyResult {
  areas: WaterAreaV1[];
  status: "available" | "partial" | "unavailable" | "not-covered";
  datasetVersions: string[];
  attribution: SourceAttribution[];
}

/** Load only intersecting providers. A failed provider cannot erase another provider's data. */
export async function loadLakeBathymetry(apiBase: string, bounds: GeoBounds, grid: ElevationGrid, zoom: number, areas: WaterAreaV1[], signal?: AbortSignal, dimensions?: Pick<ProjectConfigV1, "widthMm" | "heightMm">): Promise<SurveyResult> {
  signal?.throwIfAborted();
  let merged = areas.map((area) => { const copy = { ...area }; delete copy.bathymetry; return copy; });
  const datasetVersions: string[] = [], attribution: SourceAttribution[] = [];
  // One mask per lake for the whole call: which pixels a ring covers does not
  // depend on the survey provider, so overlapping providers reuse the pass.
  const masks = new Map<string, PixelMask>();
  const yieldWork = createYielder(signal);
  let failed = false;
  for (const dataset of registry.sources) {
    if (!intersects(bounds, dataset.bounds)) continue;
    const matching = merged.filter((area) => area.kind === "lake" && (dataset.id !== NOAA_DATASET_VERSION || hasNoaaCoverage(area)));
    if (!matching.length) continue;
    let used = false;
    {
      const result = await loadRaster(apiBase, bounds, grid.width, grid.height, zoom, matching, dataset, signal);
      if (result.status === "unavailable") { failed = true; continue; }
      if (result.status !== "available") continue;
      for (const area of result.areas) {
        if (dataset.encoding === "elevation-terrarium-v1" && !Number.isFinite(area.surfaceElevationM)) { failed = true; continue; }
        const values = area.bathymetry!.depthsM;
        const previous = merged.find((item) => item.id === area.id)!;
        // `merged` dropped every incoming bathymetry above, so an existing grid
        // was allocated by an earlier provider in this call and can be filled in
        // place. A grid-sized array is only allocated once a lake has a sample:
        // most lakes in a wide selection have no survey coverage at all.
        let samples = previous.bathymetry?.depthsM;
        let count = 0;
        let mask = masks.get(area.id);
        if (dimensions && !mask) { mask = await buildPixelMask(area.polygon, grid, dimensions, signal); masks.set(area.id, mask); }
        const box = mask ?? { rowStart: 0, rowEnd: grid.height - 1, colStart: 0, colEnd: grid.width - 1 };
        const maskWidth = box.colEnd - box.colStart + 1;
        for (let row = box.rowStart; row <= box.rowEnd; row += 1) {
          await yieldWork(maskWidth);
          for (let col = box.colStart; col <= box.colEnd; col += 1) {
            const index = row * grid.width + col;
            if (!Number.isFinite(values[index])) continue;
            // Samples outside this lake, including islands and neighboring lakes.
            if (mask && !mask.inside[(row - box.rowStart) * maskWidth + col - box.colStart]) continue;
            const depth = dataset.encoding === "elevation-terrarium-v1" ? area.surfaceElevationM! - values[index]! : values[index]!;
            if (depth < 0 || depth > 1500) continue;
            // First provider wins; later providers only fill gaps.
            samples ??= new Float32Array(values.length).fill(Number.NaN);
            if (!Number.isFinite(samples[index])) { samples[index] = depth; count += 1; }
          }
        }
        if (count && samples) {
          used = true;
          merged = merged.map((item) => item.id === area.id ? { ...item, bathymetry: { width: grid.width, height: grid.height, depthsM: samples, sampleSpacingM: Math.max(previous.bathymetry?.sampleSpacingM ?? 0, area.bathymetry!.sampleSpacingM ?? 0) } } : item);
        }
      }
    }
    if (used) {
      datasetVersions.push(dataset.id);
      attribution.push(dataset.id === NOAA_DATASET_VERSION ? NOAA_ATTRIBUTION : { name: dataset.name, url: dataset.url, license: dataset.license });
    }
  }
  return { areas: merged, status: datasetVersions.length ? failed ? "partial" : "available" : failed ? "unavailable" : "not-covered", datasetVersions, attribution };
}

/** Replace previous survey provenance on retries so failed loads cannot retain stale claims. */
export function applySurveyProvenance(source: SourceBundleV1, result: SurveyResult): SourceBundleV1 {
  const ids = new Set(registry.sources.map((item) => item.id));
  const names = new Set(registry.sources.flatMap((item) => [item.name, `${item.name} — water outlines`]));
  const outlineSources = new Set(result.areas.map((area) => area.outlineSourceId));
  const outlineAttribution = registry.sources.filter((item) => outlineSources.has(item.id)).map((item) => ({ name: `${item.name} — water outlines`, url: item.url, license: item.license }));
  return { ...source, bathymetryStatus: result.status,
    datasetVersion: [...source.datasetVersion.split("+").filter((id) => !ids.has(id)), ...result.datasetVersions].join("+"),
    attribution: [...source.attribution.filter((item) => !names.has(item.name)), ...outlineAttribution, ...result.attribution] };
}
