/** The Web Mercator latitude limit; terrain and vector tiles end here. Core keeps the same value as MERCATOR_MAX_LATITUDE. */
const MERCATOR_MAX_LATITUDE = 85.0511;

/** A `[west, south, east, north]` box inside the mapped world, with west < east and south < north. */
export function isMercatorBoundsTuple(bounds: unknown): bounds is [number, number, number, number] {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) return false;
  const [west, south, east, north] = bounds as [number, number, number, number];
  return west >= -180 && east <= 180 && south >= -MERCATOR_MAX_LATITUDE && north <= MERCATOR_MAX_LATITUDE && west < east && south < north;
}
