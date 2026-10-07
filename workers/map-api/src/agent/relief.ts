import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { TILE_SIZE, latToWorldY, lonToWorldX, type GeoBounds, type ReliefSample } from "@topostack/core/project";

/**
 * A coarse look at the ground inside a crop: at most four low-zoom Terrarium
 * tiles, so an agent can be told roughly how many sheets a design needs
 * without generating it. Sampling elevation is not contour generation; the
 * studio's count stays authoritative because coarse tiles smooth peaks.
 */
export const MAX_RELIEF_TILES = 4;
const MAX_RELIEF_ZOOM = 12;

export interface ReliefTile { z: number; x: number; y: number }

export interface ReliefEstimate extends ReliefSample {
  zoom: number;
  tiles: number;
  /** Samples at or below sea level were left out as open water. */
  coastal: boolean;
}

export class ReliefUnavailableError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ReliefUnavailableError"; }
}

interface Window { zoom: number; minX: number; maxX: number; minY: number; maxY: number }

/** The most detailed zoom at which the crop needs at most MAX_RELIEF_TILES tiles. */
export function reliefWindow(bounds: GeoBounds): Window {
  for (let zoom = MAX_RELIEF_ZOOM; zoom >= 0; zoom -= 1) {
    const minX = Math.floor(lonToWorldX(bounds.west, zoom) / TILE_SIZE);
    const maxX = Math.floor((lonToWorldX(bounds.east, zoom) - 1e-6) / TILE_SIZE);
    const minY = Math.floor(latToWorldY(bounds.north, zoom) / TILE_SIZE);
    const maxY = Math.floor((latToWorldY(bounds.south, zoom) - 1e-6) / TILE_SIZE);
    if ((maxX - minX + 1) * (maxY - minY + 1) <= MAX_RELIEF_TILES) return { zoom, minX, maxX, minY, maxY };
  }
  return { zoom: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

export function reliefTiles(bounds: GeoBounds): ReliefTile[] {
  const window = reliefWindow(bounds);
  const tiles: ReliefTile[] = [];
  for (let y = window.minY; y <= window.maxY; y += 1) {
    for (let x = window.minX; x <= window.maxX; x += 1) tiles.push({ z: window.zoom, x, y });
  }
  return tiles;
}

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6_378_137;
/** An artifact stands at least this far from its surroundings, and further than this slope over two pixels. */
const ARTIFACT_MIN_M = 400;
const ARTIFACT_SLOPE = 2.5;

/**
 * Low-zoom Terrarium tiles hold small clusters of bad samples: Lake Tahoe's
 * zoom-10 tile has 2×2 and 1×2 patches reading +5,492 m, 277 m and -4,079 m
 * beside 1,900 m ground, which its zoom-11 tiles do not. A sample is one of
 * them when it differs from the median of the ring two pixels out (which
 * clears such a patch) by more than `thresholdM`; real summits and pits at
 * these scales are gentler over that distance.
 */
function isArtifact(values: Float32Array, row: number, column: number, thresholdM: number): boolean {
  const ring: number[] = [];
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      const y = row + dy, x = column + dx;
      if (y < 0 || x < 0 || y >= TILE_SIZE || x >= TILE_SIZE) continue;
      const neighbour = values[y * TILE_SIZE + x]!;
      if (Number.isFinite(neighbour)) ring.push(neighbour);
    }
  }
  if (ring.length < 6) return false;
  ring.sort((a, b) => a - b);
  const median = (ring[Math.floor((ring.length - 1) / 2)]! + ring[Math.floor(ring.length / 2)]!) / 2;
  return Math.abs(values[row * TILE_SIZE + column]! - median) > thresholdM;
}

/**
 * The land's lowest and highest samples inside the crop (inside the inscribed
 * ellipse for a circular model), ignoring tile artifacts. As in
 * generation, the stack is sized from land alone: when the crop reaches the
 * sea, samples at or below 0 m are left out so the ocean floor does not
 * inflate the relief.
 */
export function sampleRelief(bounds: GeoBounds, circle: boolean, tiles: ReadonlyArray<{ tile: ReliefTile; png: Uint8Array }>): ReliefEstimate {
  const zoom = tiles[0]?.tile.z ?? 0;
  const west = lonToWorldX(bounds.west, zoom);
  const east = lonToWorldX(bounds.east, zoom);
  const north = latToWorldY(bounds.north, zoom);
  const south = latToWorldY(bounds.south, zoom);
  const centerX = (west + east) / 2, centerY = (north + south) / 2;
  const radiusX = (east - west) / 2, radiusY = (south - north) / 2;
  let min = Infinity, max = -Infinity, landMax = -Infinity;
  let nearest = { distance: Infinity, value: 0 };
  for (const { tile, png } of tiles) {
    const values = decodeTerrainPng(png, true);
    const latitude = Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 0.5)) / 2 ** tile.z)));
    const pixelM = EARTH_CIRCUMFERENCE_M * Math.cos(latitude) / (TILE_SIZE * 2 ** tile.z);
    const artifactM = Math.max(ARTIFACT_MIN_M, ARTIFACT_SLOPE * 2 * pixelM);
    for (let row = 0; row < TILE_SIZE; row += 1) {
      const worldY = tile.y * TILE_SIZE + row + 0.5;
      for (let column = 0; column < TILE_SIZE; column += 1) {
        const value = values[row * TILE_SIZE + column]!;
        if (!Number.isFinite(value)) continue;
        const worldX = tile.x * TILE_SIZE + column + 0.5;
        const dx = (worldX - centerX) / radiusX, dy = (worldY - centerY) / radiusY;
        const distance = dx * dx + dy * dy;
        if (distance < nearest.distance) nearest = { distance, value };
        const inside = circle ? distance <= 1 : Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        if (!inside) continue;
        // Only a sample that would move the range is worth checking for an artifact.
        if ((value < min || value > max) && isArtifact(values, row, column, artifactM)) continue;
        min = Math.min(min, value); max = Math.max(max, value);
        if (value > 0) landMax = Math.max(landMax, value);
      }
    }
  }
  // A crop narrower than one sample still has the ground under its center.
  if (!Number.isFinite(min)) min = max = nearest.value;
  const coastal = min <= 0 && Number.isFinite(landMax);
  return { minM: coastal ? 0 : min, maxM: coastal ? landMax : max, zoom, tiles: tiles.length, coastal };
}

/** Fetch the tiles through `loadTile` (the Worker's own cached terrain route) and sample them. */
export async function estimateRelief(bounds: GeoBounds, circle: boolean, loadTile: (tile: ReliefTile) => Promise<Uint8Array>): Promise<ReliefEstimate> {
  const tiles = reliefTiles(bounds);
  // A crop across the antimeridian has unwrapped longitudes, so its window
  // runs past the world's last column; those tiles are fetched from the far side.
  const wrap = (tile: ReliefTile) => ({ ...tile, x: ((tile.x % 2 ** tile.z) + 2 ** tile.z) % 2 ** tile.z });
  const loaded = await Promise.all(tiles.map(async (tile) => ({ tile, png: await loadTile(wrap(tile)) })));
  return sampleRelief(bounds, circle, loaded);
}
