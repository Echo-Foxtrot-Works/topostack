import { latToWorldY, lonToWorldX, TILE_SIZE, worldXToLon, worldYToLat, type GeoBounds, type Point2D } from "@topostack/core";

/** Web-mercator tile arithmetic shared by terrain, vector, lake, and survey loaders. The projection itself lives in core. */
export { latToWorldY, lonToWorldX, TILE_SIZE, worldSize, worldXToLon, worldYToLat } from "@topostack/core";
export const MAX_DATA_TILES = 24;

/** The whole zoom the data loaders work at: the map's zoom is fractional, the tile pyramids stop at 15. */
export function dataZoom(zoom: number): number {
  return Math.max(0, Math.min(15, Math.round(zoom)));
}

/**
 * The inverse of `tilePointProjector`: artwork millimetres back to [lon, lat].
 * Water areas are carried in millimetres from the artwork's centre, but a depth
 * chart is placed against a lake outline on the ground, so one has to become
 * the other. Both axes are linear in Web Mercator, as the projector makes them.
 */
export function artworkToLonLat(bounds: GeoBounds, widthMm: number, heightMm: number): (point: Point2D) => [number, number] {
  const zoom = 0;
  const westX = lonToWorldX(bounds.west, zoom);
  const eastX = lonToWorldX(bounds.east, zoom);
  const northY = latToWorldY(bounds.north, zoom);
  const southY = latToWorldY(bounds.south, zoom);
  return (point) => [
    worldXToLon(westX + (point.x / widthMm + 0.5) * (eastX - westX), zoom),
    worldYToLat(northY + (point.y / heightMm + 0.5) * (southY - northY), zoom),
  ];
}

export interface DataTile { x: number; worldX: number; y: number; z: number }
export interface TileWindow { zoom: number; westX: number; eastX: number; northY: number; southY: number; tiles: DataTile[] }

export function tileWindow(bounds: GeoBounds, zoom: number): TileWindow {
  const westX = lonToWorldX(bounds.west, zoom);
  const eastX = lonToWorldX(bounds.east, zoom);
  const northY = latToWorldY(bounds.north, zoom);
  const southY = latToWorldY(bounds.south, zoom);
  const scale = 2 ** zoom;
  const minWorldX = Math.floor(westX / TILE_SIZE);
  const maxWorldX = Math.floor((eastX - 1e-6) / TILE_SIZE);
  const minY = Math.max(0, Math.floor(northY / TILE_SIZE));
  const maxY = Math.min(scale - 1, Math.floor((southY - 1e-6) / TILE_SIZE));
  const count = (maxWorldX - minWorldX + 1) * (maxY - minY + 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DATA_TILES) throw new Error("The selected area is too large at this zoom. Zoom in and try again.");
  const tiles: TileWindow["tiles"] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let worldX = minWorldX; worldX <= maxWorldX; worldX += 1) {
      const x = ((worldX % scale) + scale) % scale;
      tiles.push({ x, worldX, y, z: zoom });
    }
  }
  return { zoom, westX, eastX, northY, southY, tiles };
}

/** Downshift from the requested zoom until the window fits the bounded tile budget. */
export function fittingTileWindow(bounds: GeoBounds, requestedZoom: number, minimumZoom = 0): TileWindow {
  let zoom = Math.max(minimumZoom, requestedZoom);
  while (true) {
    try { return tileWindow(bounds, zoom); }
    catch (error) {
      if (zoom <= minimumZoom || !(error instanceof Error) || !error.message.includes("too large")) throw error;
      zoom -= 1;
    }
  }
}

/** Project a vector-tile coordinate into crop-centered millimetres. */
export function tilePointProjector(window: TileWindow, widthMm: number, heightMm: number): (tile: DataTile, extent: number, point: Point2D) => Point2D {
  return (tile, extent, point) => ({
    x: (((tile.worldX + point.x / extent) * TILE_SIZE - window.westX) / (window.eastX - window.westX) - 0.5) * widthMm,
    y: (((tile.y + point.y / extent) * TILE_SIZE - window.northY) / (window.southY - window.northY) - 0.5) * heightMm,
  });
}
