import type { GeoBounds, SourceAttribution } from "@topostack/core";
import { sources } from "../../../../../scripts/data/terrain-sources.json";
import { validateTerrainCatalog, validateTerrainArchiveBounds, rankTerrainSources, type TerrainSource } from "@topostack/data-contracts/source-catalog";
import { createArchive } from "$lib/domain/archive";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { mapTiles } from "$lib/domain/tile-requests";
import { latToWorldY, lonToWorldX, TILE_SIZE, worldXToLon, worldYToLat } from "$lib/domain/tile-math";

const registeredTerrainSources = validateTerrainCatalog({ sources }).sources;
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
    const selected = tiles.filter((tile) => tile.z >= source.minZoom && tile.z <= source.maxZoom && owners[tiles.indexOf(tile)]!.some((owner) => owner === 0));
    if (!selected.length || bounds.east <= west || bounds.west >= east || bounds.north <= south || bounds.south >= north) continue;
    try {
      const archive = createArchive(`${apiBase}/v1/terrain-sources/${source.id}.pmtiles`, signal);
      const header = await archive.getHeader();
      if (header.tileType !== 2 || !Number.isInteger(header.minZoom) || header.minZoom < 0 || header.minZoom > source.minZoom || header.maxZoom !== source.maxZoom) throw new Error("Invalid terrain archive format.");
      validateTerrainArchiveBounds([header.minLon, header.minLat, header.maxLon, header.maxLat], source.bounds);
      const metadata = await archive.getMetadata() as Record<string, unknown>;
      if (metadata.topostack_dataset !== source.id || metadata.topostack_encoding !== source.encoding || metadata.topostack_vertical_datum !== source.verticalDatum) throw new Error("Invalid terrain archive metadata.");
      const preferred = await mapTiles(selected, async (tile, signal) => {
        const result = await archive.getZxy(tile.z, tile.x, tile.y, signal);
        signal.throwIfAborted();
        if (!result) return undefined;
        const values = decodeTerrainPng(new Uint8Array(result.data), true);
        for (const value of values) {
          if (!Number.isNaN(value) && (!Number.isFinite(value) || value < -500 || value > 9000)) throw new Error("Invalid terrain elevation.");
        }
        return values;
      }, signal);
      signal?.throwIfAborted();
      let applied = false;
      const ownerId = selectedSources.length + 1;
      selected.forEach((tile, index) => {
        const values = preferred[index];
        if (!values) return;
        const ownership = owners[tiles.indexOf(tile)]!;
        for (let i = 0; i < values.length; i += 1) {
          if (ownership[i] === 0 && Number.isFinite(values[i])) {
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
