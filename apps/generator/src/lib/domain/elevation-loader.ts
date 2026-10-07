import { mapTiles } from "$lib/domain/tile-requests";
import { apiBase } from "$lib/domain/api-base";
import type { GeoBounds, SourceBundleV1 } from "@topostack/core";
import { networkSignal } from "$lib/domain/network";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { applyPreferredTerrain } from "$lib/domain/terrain-sources";
import { repairElevationSpikes } from "$lib/domain/elevation-cleanup";
import { TILE_SIZE, type TileWindow } from "$lib/domain/tile-math";

// Decode numeric PNG channels directly, then interpolate elevations at native
// pixel centers. Browser image/canvas APIs can alter the encoded heights.
export async function loadElevation(window: TileWindow, bounds: GeoBounds, signal?: AbortSignal) {
  const responses = await mapTiles(window.tiles, async (tile, signal) => {
    // Public tile URLs survive dataset releases; revalidate before fabrication.
    const response = await fetch(`${apiBase()}/v1/terrain/${tile.z}/${tile.x}/${tile.y}.png`, { signal: networkSignal(signal), cache: "no-cache" });
    if (!response.ok) throw new Error(`Terrain service returned ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    return { tile, response, values: decodeTerrainPng(bytes) };
  }, signal);
  const preferred = await applyPreferredTerrain(apiBase(), bounds, responses.map(({ tile, values }) => ({ ...tile, values })), signal);
  const minTileX = Math.min(...window.tiles.map((tile) => tile.worldX));
  const minTileY = Math.min(...window.tiles.map((tile) => tile.y));
  const mosaicWidth = (Math.max(...window.tiles.map((tile) => tile.worldX)) - minTileX + 1) * TILE_SIZE;
  const mosaicHeight = (Math.max(...window.tiles.map((tile) => tile.y)) - minTileY + 1) * TILE_SIZE;
  const mosaic = new Float32Array(mosaicWidth * mosaicHeight);
  const terrainOwners = new Uint16Array(mosaic.length);
  const imagerySources = new Set<string>();
  const datasetVersions = new Set<string>();
  for (const [tileIndex, { tile, response, values }] of responses.entries()) {
    const datasetVersion = response.headers.get("x-topostack-dataset");
    if (!datasetVersion?.trim()) throw new Error("Terrain tile is missing its dataset version.");
    datasetVersions.add(datasetVersion);
    response.headers.get("x-topostack-imagery-sources")?.split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => imagerySources.add(value));
    const left = (tile.worldX - minTileX) * TILE_SIZE;
    const top = (tile.y - minTileY) * TILE_SIZE;
    for (let row = 0; row < TILE_SIZE; row += 1) {
      const offset = (top + row) * mosaicWidth + left;
      mosaic.set(values.subarray(row * TILE_SIZE, (row + 1) * TILE_SIZE), offset);
      terrainOwners.set(preferred.owners[tileIndex]!.subarray(row * TILE_SIZE, (row + 1) * TILE_SIZE), offset);
    }
  }
  if (datasetVersions.size > 1) throw new Error("Terrain tiles came from inconsistent dataset versions. Try again shortly.");

  // Use the stitched native raster so tile boundaries are ordinary neighbors.
  const elevationRepairCount = repairElevationSpikes(mosaic, mosaicWidth, mosaicHeight);

  // Output samples i in 0..width-1 span [westX, eastX] edge to edge, matching
  // the contourToMm/sampleElevation convention in core (grid.width - 1 spans
  // the full material width). Cap at the native pixel span so we never invent
  // resolution the tiles do not have.
  const spanX = window.eastX - window.westX;
  const spanY = window.southY - window.northY;
  const outputWidth = Math.max(64, Math.min(768, Math.round(spanX)));
  const outputHeight = Math.max(64, Math.min(768, Math.round(outputWidth * spanY / spanX)));
  const values = new Float32Array(outputWidth * outputHeight);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const contributions = new Float64Array(preferred.selectedSources.length + 1);
  const sampleMosaic = (x: number, y: number, weight: number): number => {
    const clampedX = Math.max(0, Math.min(mosaicWidth - 1, x));
    const clampedY = Math.max(0, Math.min(mosaicHeight - 1, y));
    const index = clampedY * mosaicWidth + clampedX;
    contributions[terrainOwners[index]!]! += weight;
    return mosaic[index] ?? 0;
  };
  for (let row = 0; row < outputHeight; row += 1) {
    // Native pixel centers sit at +0.5, so subtract it before interpolating.
    const worldY = window.northY + (spanY * row) / (outputHeight - 1) - minTileY * TILE_SIZE - 0.5;
    const y0 = Math.floor(worldY);
    const fy = worldY - y0;
    for (let column = 0; column < outputWidth; column += 1) {
      const worldX = window.westX + (spanX * column) / (outputWidth - 1) - minTileX * TILE_SIZE - 0.5;
      const x0 = Math.floor(worldX);
      const fx = worldX - x0;
      const top = sampleMosaic(x0, y0, (1 - fx) * (1 - fy)) * (1 - fx) + sampleMosaic(x0 + 1, y0, fx * (1 - fy)) * fx;
      const bottom = sampleMosaic(x0, y0 + 1, (1 - fx) * fy) * (1 - fx) + sampleMosaic(x0 + 1, y0 + 1, fx * fy) * fx;
      const elevation = top * (1 - fy) + bottom * fy;
      values[row * outputWidth + column] = elevation;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  }
  const terrainSelection: NonNullable<SourceBundleV1["terrainSelection"]> = {
    policy: "terrain-priority-v1", attempts: preferred.attempts,
    sources: [
      { id: "mapzen", name: "Mapzen composite terrain", verticalDatum: "Source-dependent", fraction: contributions[0]! / values.length },
      ...preferred.selectedSources.map((source, index) => ({ id: source.id, name: source.name, nativeResolutionM: source.nativeResolutionM, verticalDatum: source.verticalDatum, fraction: contributions[index + 1]! / values.length })),
    ].filter((source) => source.fraction > 0.000001),
  };
  return { terrainSelection, elevation: { width: outputWidth, height: outputHeight, values, min, max }, elevationRepairCount, imagerySources: [...imagerySources, ...preferred.imagerySources].sort(), datasetVersion: [[...datasetVersions][0]!, ...preferred.datasetVersions].join("+"), terrainAttribution: preferred.attribution, terrainSourceUnavailable: preferred.unavailable };
}
