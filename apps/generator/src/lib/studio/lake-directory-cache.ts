import { base } from "$app/paths";
import { networkSignal } from "$lib/domain/network";
import { indexLakeDirectory, type IndexedLake, type LakeDirectory } from "$lib/site/lake-directory";
import { uniqueLocationLakes } from "$lib/site/location-results";

// The directory is large (~2 MB). The location dialog unmounts on close, so the
// fetched, parsed, and indexed list lives here for the whole page session.
let cached: Promise<IndexedLake[]> | undefined;

async function fetchLocationLakes(): Promise<IndexedLake[]> {
  // Bounded like every other data request: a stalled fetch or body read
  // rejects, which clears the cache so the next dialog open retries.
  const response = await fetch(`${base}/data/lake-depth-directory.json`, { signal: networkSignal() });
  if (!response.ok) throw new Error("Lake directory unavailable");
  const data = await response.json() as LakeDirectory;
  if (data.schemaVersion !== 1 || !Array.isArray(data.lakes) || !Array.isArray(data.sources)) throw new Error("Invalid lake directory");
  return uniqueLocationLakes(indexLakeDirectory(data));
}

/** Surveyed lakes for place search, loaded once. A failed load is forgotten so the next call retries. */
export function loadLocationLakes(): Promise<IndexedLake[]> {
  if (cached) return cached;
  const request = fetchLocationLakes();
  cached = request;
  request.catch(() => { if (cached === request) cached = undefined; });
  return request;
}

/** Test hook: forget the cached directory. */
export function resetLocationLakes(): void {
  cached = undefined;
}
