import { MERCATOR_MAX_LATITUDE } from "@topostack/core";

/** Web Mercator's latitude limit, shared by every coordinate the generator accepts. */
export const MAX_LATITUDE = MERCATOR_MAX_LATITUDE;
export const MAX_LONGITUDE = 180;

/** True for a finite latitude/longitude pair inside the supported map area. */
export function isSupportedCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Math.abs(lat) <= MAX_LATITUDE && Number.isFinite(lon) && Math.abs(lon) <= MAX_LONGITUDE;
}

export const clampLatitude = (lat: number): number => Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
export const clampLongitude = (lon: number): number => Math.max(-MAX_LONGITUDE, Math.min(MAX_LONGITUDE, lon));

/** Kilometres per degree of latitude, near enough constant for sizing map windows. */
export const KM_PER_DEGREE_LAT = 110.574;

/** Kilometres per degree of longitude at a latitude in degrees. */
export function kmPerDegreeLon(lat: number): number {
  return 111.32 * Math.cos(lat * Math.PI / 180);
}
