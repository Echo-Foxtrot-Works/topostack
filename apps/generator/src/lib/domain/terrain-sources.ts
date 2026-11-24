import type { GeoBounds, SourceAttribution } from "@topostack/core";
import { sources } from "../../../../../scripts/data/terrain-sources.json";
import { validateTerrainCatalog, validateTerrainArchiveBounds, rankTerrainSources, terrainValueRange, type TerrainSource } from "@topostack/data-contracts/source-catalog";
import { servedSources } from "$lib/domain/data-environment";
import { createArchive } from "$lib/domain/archive";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { mapTiles } from "$lib/domain/tile-requests";
import { latToWorldY, lonToWorldX, TILE_SIZE, worldXToLon, worldYToLat } from "$lib/domain/tile-math";

const registeredTerrainSources = servedSources(validateTerrainCatalog({ sources }).sources);
interface TerrainTile { z: number; x: number; y: number; values: Float32Array }

/**
 * True when a pixel the failed source's extent covers (inside the request) is
 * still owned by the base terrain. A failure that a lower-ranked preferred
 * source fully covered is not a user-visible fallback.
 */
function failureFellBackToBase(bounds: GeoBounds, sourceBounds: readonly number[], tiles: TerrainTile[], owners: Uint16Array[], failedTiles: TerrainTile[]): boolean {
  const west = Math.max(bounds.west, sourceBounds[0]!), south = Math.max(bounds.south, sourceBounds[1]!);
  const east = Math.min(bounds.east, sourceBounds[2]!), north = Math.min(bounds.north, sourceBounds[3]!);
  if (east <= west || north <= south) return false;
  for (const tile of failedTiles) {
    const ownership = owners[tiles.indexOf(tile)]!;
    // Pixel-center coverage in the tile's own world coordinates. Longitudes are
    // compared unwrapped relative to the tile, matching how bounds are stored.
    const tileWest = worldXToLon(tile.x * TILE_SIZE, tile.z);
    const shift = Math.round((west - tileWest) / 360) * 360;
    const left = Math.max(0, Math.floor(lonToWorldX(west - shift, tile.z) - tile.x * TILE_SIZE));
    const right = Math.min(TILE_SIZE - 1, Math.ceil(lonToWorldX(east - shift, tile.z) - tile.x * TILE_SIZE) - 1);
    const top = Math.max(0, Math.floor(latToWorldY(north, tile.z) - tile.y * TILE_SIZE));
    const bottom = Math.min(TILE_SIZE - 1, Math.ceil(latToWorldY(south, tile.z) - tile.y * TILE_SIZE) - 1);
    for (let row = top; row <= bottom; row += 1) {
      const lat = worldYToLat(tile.y * TILE_SIZE + row + 0.5, tile.z);
      if (lat <= south || lat >= north) continue;
      for (let column = left; column <= right; column += 1) {
        if (ownership[row * TILE_SIZE + column] === 0) return true;
      }
    }
  }
  return false;
}

type TerrainArchive = ReturnType<typeof createArchive>;

function decodeSourceTile(data: ArrayBuffer | Uint8Array, lowest: number, highest: number): Float32Array {
  const values = decodeTerrainPng(new Uint8Array(data), true);
  for (const value of values) {
    if (!Number.isNaN(value) && (!Number.isFinite(value) || value < lowest || value > highest)) throw new Error("Invalid terrain elevation.");
  }
  return values;
}

/**
 * Samples for tiles finer than the archive's deepest zoom, bilinearly
 * upsampled from the ancestor tiles at that zoom (each fetched once, a
 * neighbour only when a target's edge pixels need it). A corner the archive
 * leaves transparent takes the target's own base value, so a coarse grid
 * feathers into the base terrain over one source cell instead of stepping.
 * Pixels with no valid corner stay NaN and keep the base terrain.
 */
export async function upsampledFromAncestors(archive: Pick<TerrainArchive, "getZxy">, sourceZoom: number, targets: readonly TerrainTile[],
  lowest: number, highest: number, signal?: AbortSignal): Promise<Array<Float32Array | undefined>> {
  const ancestors = new Map<string, { z: number; x: number; y: number }>();
  const key = (x: number, y: number) => `${x}/${y}`;
  const span = 2 ** sourceZoom;
  const plans = targets.map((tile) => {
    const scale = 2 ** (tile.z - sourceZoom);
    // Pixel-center coordinates of the target's first and last pixels in source pixels.
    const first = (value: number) => (value * TILE_SIZE + 0.5) / scale - 0.5;
    const last = (value: number) => ((value + 1) * TILE_SIZE - 0.5) / scale - 0.5;
    const columns = [Math.floor(first(tile.x)), Math.ceil(last(tile.x))] as const;
    const rows = [Math.max(0, Math.floor(first(tile.y))), Math.min(span * TILE_SIZE - 1, Math.ceil(last(tile.y)))] as const;
    for (let y = Math.floor(rows[0] / TILE_SIZE); y <= Math.floor(rows[1] / TILE_SIZE); y += 1) {
      for (let x = Math.floor(columns[0] / TILE_SIZE); x <= Math.floor(columns[1] / TILE_SIZE); x += 1) {
        const wrapped = ((x % span) + span) % span;
        ancestors.set(key(wrapped, y), { z: sourceZoom, x: wrapped, y });
      }
    }
    return { tile, scale };
  });
  const list = [...ancestors.values()];
  const loaded = await mapTiles(list, async (ancestor, signal) => {
    const result = await archive.getZxy(ancestor.z, ancestor.x, ancestor.y, signal);
    signal.throwIfAborted();
    return result ? decodeSourceTile(result.data, lowest, highest) : undefined;
  }, signal);
  const byKey = new Map(list.map((ancestor, index) => [key(ancestor.x, ancestor.y), loaded[index]]));
  const sample = (column: number, row: number): number => {
    if (row < 0 || row >= span * TILE_SIZE) return Number.NaN;
    const x = Math.floor(column / TILE_SIZE), y = Math.floor(row / TILE_SIZE);
    const values = byKey.get(key(((x % span) + span) % span, y));
    if (!values) return Number.NaN;
    return values[(row - y * TILE_SIZE) * TILE_SIZE + (column - x * TILE_SIZE)]!;
  };
  return plans.map(({ tile, scale }) => {
    const out = new Float32Array(TILE_SIZE * TILE_SIZE).fill(Number.NaN);
    let any = false;
    for (let row = 0; row < TILE_SIZE; row += 1) {
      const sourceRow = (tile.y * TILE_SIZE + row + 0.5) / scale - 0.5;
      const top = Math.floor(sourceRow), fy = sourceRow - top;
      for (let column = 0; column < TILE_SIZE; column += 1) {
        const sourceColumn = (tile.x * TILE_SIZE + column + 0.5) / scale - 0.5;
        const left = Math.floor(sourceColumn), fx = sourceColumn - left;
        const base = tile.values[row * TILE_SIZE + column]!;
        const corners = [sample(left, top), sample(left + 1, top), sample(left, top + 1), sample(left + 1, top + 1)];
        if (!corners.some(Number.isFinite)) continue;
        const [a, b, c, d] = corners.map((value) => (Number.isFinite(value) ? value : base)) as [number, number, number, number];
        out[row * TILE_SIZE + column] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
        any = true;
      }
    }
    return any ? out : undefined;
  });
}

/**
 * True for a base pixel an ocean grid may replace: both the grid and the base
 * terrain put it below sea level. Land, lakes above sea level and the coast the
 * base terrain already draws are never moved by a coarse ocean grid.
 */
function oceanPixel(source: number, base: number): boolean {
  return source < 0 && base <= 0;
}

/** Overlay only valid bare-earth samples, atomically per archive, before resampling. */
export async function applyPreferredTerrain(apiBase: string, bounds: GeoBounds, tiles: TerrainTile[], signal?: AbortSignal, sources: readonly TerrainSource[] = registeredTerrainSources) {
  const datasetVersions: string[] = [];
  const attribution: SourceAttribution[] = [];
  const imagerySources: string[] = [];
  const owners = tiles.map(() => new Uint16Array(256 * 256));
  const selectedSources: TerrainSource[] = [];
  const attempts: Array<{ id: string; name: string; status: "selected" | "no-coverage" | "unavailable" }> = [];
  const failures: Array<{ source: TerrainSource; tiles: TerrainTile[] }> = [];
  for (const source of rankTerrainSources(sources)) {
    signal?.throwIfAborted();
    const [west, south, east, north] = source.bounds;
    const ocean = source.kind === "bathymetry-grid";
    // Zooms past the archive's deepest level are upsampled from its ancestors.
    // Ocean grids skip tiles whose base terrain never reaches sea level.
    const selected = tiles.filter((tile) => tile.z >= source.minZoom && owners[tiles.indexOf(tile)]!.some((owner) => owner === 0) &&
      (!ocean || tile.values.some((value) => value <= 0)));
    if (!selected.length || bounds.east <= west || bounds.west >= east || bounds.north <= south || bounds.south >= north) continue;
    try {
      const archive = createArchive(`${apiBase}/v1/terrain-sources/${source.id}.pmtiles`, signal);
      const header = await archive.getHeader();
      if (header.tileType !== 2 || !Number.isInteger(header.minZoom) || header.minZoom < 0 || header.minZoom > source.minZoom || header.maxZoom !== source.maxZoom) throw new Error("Invalid terrain archive format.");
      validateTerrainArchiveBounds([header.minLon, header.minLat, header.maxLon, header.maxLat], source.bounds);
      const metadata = await archive.getMetadata() as Record<string, unknown>;
      if (metadata.topostack_dataset !== source.id || metadata.topostack_encoding !== source.encoding || metadata.topostack_vertical_datum !== source.verticalDatum) throw new Error("Invalid terrain archive metadata.");
      const [lowest, highest] = terrainValueRange(source.kind);
      const native = selected.filter((tile) => tile.z <= source.maxZoom);
      const finer = selected.filter((tile) => tile.z > source.maxZoom);
      const [direct, upsampled] = await Promise.all([
        mapTiles(native, async (tile, signal) => {
          const result = await archive.getZxy(tile.z, tile.x, tile.y, signal);
          signal.throwIfAborted();
          return result ? decodeSourceTile(result.data, lowest, highest) : undefined;
        }, signal),
        finer.length ? upsampledFromAncestors(archive, source.maxZoom, finer, lowest, highest, signal) : Promise.resolve([]),
      ]);
      const preferred = selected.map((tile) => tile.z <= source.maxZoom ? direct[native.indexOf(tile)] : upsampled[finer.indexOf(tile)]);
      signal?.throwIfAborted();
      let applied = false;
      const ownerId = selectedSources.length + 1;
      selected.forEach((tile, index) => {
        const values = preferred[index];
        if (!values) return;
        const ownership = owners[tiles.indexOf(tile)]!;
        for (let i = 0; i < values.length; i += 1) {
          if (ownership[i] === 0 && Number.isFinite(values[i]) && (!ocean || oceanPixel(values[i]!, tile.values[i]!))) {
            tile.values[i] = values[i]!; ownership[i] = ownerId; applied = true;
          }
        }
      });
      attempts.push({ id: source.id, name: source.name, status: applied ? "selected" : "no-coverage" });
      if (applied) {
        selectedSources.push(source);
        datasetVersions.push(source.id);
        attribution.push({ name: source.name, url: source.url, license: source.license });
        imagerySources.push(`${source.id}/${source.verticalDatum}`);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push({ source, tiles: selected });
      attempts.push({ id: source.id, name: source.name, status: "unavailable" });
    }
  }
  // Decide only after every ranked source had its chance to fill the gaps.
  const unavailable = failures.some((failure) => failureFellBackToBase(bounds, failure.source.bounds, tiles, owners, failure.tiles));
  return { datasetVersions, attribution, imagerySources, unavailable, owners, selectedSources, attempts };
}
