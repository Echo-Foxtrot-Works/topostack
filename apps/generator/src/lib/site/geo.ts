// Local ground distances for page layout. Node scripts (lock-lake-slugs,
// build-locator-data, capture-examples) import these site modules directly, so
// they cannot reach $lib/domain; $lib/domain/coordinates holds the same pair.
/** Kilometres per degree of latitude, near enough constant for sizing map windows. */
export const KM_PER_DEGREE_LAT = 110.574;

/** Kilometres per degree of longitude at a latitude in degrees. */
export function kmPerDegreeLon(lat: number): number {
  return 111.32 * Math.cos(lat * Math.PI / 180);
}
