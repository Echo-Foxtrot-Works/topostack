import type { GeoBounds } from "@topostack/core";
import { apiBase } from "$lib/domain/api-base";
import { isSupportedCoordinate } from "$lib/domain/coordinates";
import { networkSignal } from "$lib/domain/network";

// Place search on its own: the studio offers it from first paint, while the
// terrain and map-data loaders are only needed once something is generated.

export interface PlaceResult { id: string; label: string; lat: number; lon: number; type?: string; bounds?: GeoBounds; zoom?: number; surveyedLake?: boolean }

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  if (query.trim().length < 2) return [];
  const response = await fetch(`${apiBase()}/v1/geocode?q=${encodeURIComponent(query.trim())}&limit=5`, { signal: networkSignal(signal) });
  if (!response.ok) throw new Error("Place search is temporarily unavailable.");
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error("Place search returned an unexpected response.");
  return value.flatMap((item): PlaceResult[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const lat = record.lat;
    const lon = record.lon;
    const label = typeof record.display_name === "string" ? record.display_name.trim() : "";
    if (typeof lat !== "number" || typeof lon !== "number" || !isSupportedCoordinate(lat, lon) || !label) return [];
    return [{ id: String(record.place_id ?? (String(lat) + "," + String(lon))), label, lat, lon, type: typeof record.type === "string" ? record.type : undefined }];
  });
}
