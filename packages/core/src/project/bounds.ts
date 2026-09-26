import { EARTH_RADIUS_M } from "../primitives/units.js";
import type { GeoBounds, GeoPoint, ProjectConfigV1 } from "../types.js";

/**
 * Web Mercator arithmetic for a project's crop. The studio, the map-api Worker,
 * and agent requests all compute a project's geographic bounds here, so a
 * design reopened anywhere covers the same ground.
 */
export const TILE_SIZE = 256;
/** The Web Mercator latitude limit; terrain and vector tiles end here. */
export const MERCATOR_MAX_LATITUDE = 85.0511;

const RADIANS = Math.PI / 180;

export const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;
export const lonToWorldX = (lon: number, zoom: number) => ((lon + 180) / 360) * worldSize(zoom);
export function latToWorldY(lat: number, zoom: number): number {
  // Written as the studio always computed it: the crop must stay bit-identical.
  const radians = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat)) * Math.PI / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * worldSize(zoom);
}
export const worldXToLon = (x: number, zoom: number) => (x / worldSize(zoom)) * 360 - 180;
export function worldYToLat(y: number, zoom: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldSize(zoom)))) * 180 / Math.PI;
}

const mercatorY = (lat: number) => Math.asinh(Math.tan(lat * RADIANS));
const latitudeAt = (y: number) => Math.atan(Math.sinh(y)) / RADIANS;

/** Center the physical cut inside the selected area in the map's Mercator plane. */
export function fitCutBounds(bounds: GeoBounds, widthMm: number, heightMm: number): GeoBounds {
  const north = mercatorY(bounds.north);
  const south = mercatorY(bounds.south);
  const width = (bounds.east - bounds.west) * RADIANS;
  const height = north - south;
  const aspect = widthMm / heightMm;
  // Preserve already fitted bounds exactly across reloads and camera updates.
  if (Math.abs(width / height / aspect - 1) < 1e-7) return bounds;
  const fittedWidth = Math.min(width, height * aspect);
  const fittedHeight = fittedWidth / aspect;
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerY = (north + south) / 2;
  return {
    west: centerLon - fittedWidth / RADIANS / 2,
    east: centerLon + fittedWidth / RADIANS / 2,
    north: latitudeAt(centerY + fittedHeight / 2),
    south: latitudeAt(centerY - fittedHeight / 2),
  };
}

/**
 * The smallest bounds at the cut's aspect ratio that contain all of `bounds`,
 * so a long, narrow area stays whole where `fitCutBounds` would inscribe it.
 */
export function coverBounds(bounds: GeoBounds, widthMm: number, heightMm: number): GeoBounds {
  const northY = mercatorY(bounds.north);
  const southY = mercatorY(bounds.south);
  const centerY = (northY + southY) / 2;
  const spanX = Math.max((bounds.east - bounds.west) * RADIANS, (northY - southY) * widthMm / heightMm);
  const spanY = spanX * heightMm / widthMm;
  const lon = (bounds.west + bounds.east) / 2;
  return {
    west: lon - spanX / RADIANS / 2, east: lon + spanX / RADIANS / 2,
    south: latitudeAt(centerY - spanY / 2), north: latitudeAt(centerY + spanY / 2),
  };
}

/** Bounds centered on `center` spanning `widthKm` of ground east to west, at the cut's aspect ratio. */
export function boundsAround(center: GeoPoint, widthKm: number, widthMm: number, heightMm: number): GeoBounds {
  const spanX = widthKm * 1000 / (EARTH_RADIUS_M * Math.cos(center.lat * RADIANS));
  const spanY = spanX * heightMm / widthMm;
  const centerY = mercatorY(center.lat);
  return {
    west: center.lon - spanX / RADIANS / 2, east: center.lon + spanX / RADIANS / 2,
    south: latitudeAt(centerY - spanY / 2), north: latitudeAt(centerY + spanY / 2),
  };
}

/** Whether `bounds` is ordered and lies inside the Web Mercator world without crossing the antimeridian. */
export function isMercatorBounds(bounds: GeoBounds): boolean {
  const { west, south, east, north } = bounds;
  return [west, south, east, north].every(Number.isFinite) && west >= -180 && east <= 180 && west < east
    && south >= -MERCATOR_MAX_LATITUDE && north <= MERCATOR_MAX_LATITUDE && south < north;
}

/** The reference-map zoom that frames `bounds`, as the studio's map camera would. */
export function zoomForBounds(bounds: GeoBounds): number {
  return Math.max(3, Math.min(14, Math.floor(Math.log2(360 / (bounds.east - bounds.west)))));
}

/** The authoritative geographic crop of a project: its stored bounds fitted to the cut, or a default window around its point. */
export function boundsForProject(config: ProjectConfigV1): GeoBounds {
  if (config.location.bounds) return fitCutBounds(config.location.bounds, config.widthMm, config.heightMm);
  const zoom = Math.max(0, Math.min(15, Math.round(config.location.zoom)));
  const size = worldSize(zoom);
  const centerX = lonToWorldX(config.location.lon, zoom);
  const centerY = latToWorldY(config.location.lat, zoom);
  const widthPx = Math.min(420, size);
  const heightPx = Math.min(280, size);
  const northY = Math.max(0, Math.min(size - heightPx, centerY - heightPx / 2));
  return fitCutBounds({ west: worldXToLon(centerX - widthPx / 2, zoom), east: worldXToLon(centerX + widthPx / 2, zoom), north: worldYToLat(northY, zoom), south: worldYToLat(northY + heightPx, zoom) }, config.widthMm, config.heightMm);
}
