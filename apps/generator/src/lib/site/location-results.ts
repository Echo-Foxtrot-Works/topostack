import type { PlaceResult } from "$lib/domain/geocode";
import type { IndexedLake } from "$lib/site/lake-directory";

const normalizeName = (name: string): string => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Keep separate same-named lakes; only identical survey/location records collapse. */
export function uniqueLocationLakes(lakes: IndexedLake[]): IndexedLake[] {
  const seen = new Set<string>();
  return lakes.filter((lake) => {
    const keys = [lake.id, `${lake.sourceId}:${lake.surveyId}`, `${normalizeName(lake.name)}:${lake.bounds.join(",")}`];
    const duplicate = keys.some((key) => seen.has(key));
    keys.forEach((key) => seen.add(key));
    return !duplicate;
  });
}

/** Prefer the surveyed choice when geocoding returns the same named lake. */
export function uniqueOtherPlaces(places: PlaceResult[], lakes: IndexedLake[]): PlaceResult[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const name = normalizeName(place.label.split(",")[0]!);
    const key = `${name}:${place.lat}:${place.lon}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !lakes.some((lake) => {
      const [west, south, east, north] = lake.bounds;
      return place.lon >= west && place.lon <= east && place.lat >= south && place.lat <= north
        && [lake.name, ...(lake.aliases ?? [])].some((alias) => normalizeName(alias) === name);
    });
  });
}
