import { searchPlaces, type PlaceResult } from "$lib/domain/geocode";
import { lakesNear, lakesInView, wholeLake, lakeAt, lakeContains, type ChartableLake } from "$lib/domain/lake-lookup";
import type { GeoBounds } from "@topostack/core";
import { draft, resetDraft } from "$lib/studio/customdata/chart-draft.svelte";
import { resetSession } from "$lib/studio/customdata/chart-tracing.svelte";

export const picker = $state({ query: "", places: [] as PlaceResult[], lakes: [] as ChartableLake[], ponds: [] as ChartableLake[], surveyed: [] as string[], chosenPlace: undefined as PlaceResult | undefined, searching: false, error: "", status: "", bounds: undefined as GeoBounds | undefined, activeId: undefined as string | undefined });
export const mapLakes = $state({ lakes: [] as ChartableLake[], loading: false, note: "" });
let viewRequest = 0;
let viewController: AbortController | undefined;

/** Viewport requests never change the selection, search results, or camera. */
export async function loadVisibleLakes(bounds: GeoBounds): Promise<void> {
  const mine = ++viewRequest;
  viewController?.abort(); viewController = new AbortController();
  mapLakes.note = "";
  if (bounds.north - bounds.south > 2.4 || bounds.east - bounds.west > 4.8) {
    mapLakes.lakes = []; mapLakes.loading = false;
    mapLakes.note = "Zoom in to see selectable lake outlines.";
    return;
  }
  mapLakes.loading = true;
  try {
    const lakes = await lakesInView(bounds, viewController.signal);
    if (mine !== viewRequest) return;
    mapLakes.lakes = lakes;
    if (!lakes.length) mapLakes.note = "No selectable lake outlines in this view. Pan, zoom, or search nearby.";
  } catch (error) {
    if (mine === viewRequest) {
      mapLakes.note = "Lake outlines could not load. Pan or zoom to retry, or search for a lake.";
      if (error instanceof DOMException && error.name === "AbortError") mapLakes.note = "";
    }
  } finally { if (mine === viewRequest) mapLakes.loading = false; }
}

export function lakeMapTargets(): ChartableLake[] {
  const byId = new Map([...mapLakes.lakes, ...picker.lakes, ...picker.ponds, ...(draft.lake ? [draft.lake] : [])].map(lake => [lake.id, lake]));
  return [...byId.values()];
}
let request = 0;
let controller: AbortController | undefined;
export function cancelLakePicker(): void {
  viewRequest++; viewController?.abort(); mapLakes.loading = false;
  request++; controller?.abort(); picker.searching = false; picker.status = "";
}
function begin(status: string): number {
  controller?.abort(); controller = new AbortController();
  picker.searching = true; picker.error = ""; picker.status = status;
  return ++request;
}
function failed(mine: number, error: unknown): void {
  if (mine !== request) return;
  picker.error = error instanceof Error ? error.message : "Lake outlines could not be loaded. Try again.";
}
function finish(mine: number): void { if (mine === request) { picker.searching = false; picker.status = ""; } }

export async function searchLakes(): Promise<void> {
  if (picker.query.trim().length < 2) return;
  const mine = begin("Searching places…");
  picker.places = []; picker.lakes = []; picker.ponds = []; picker.surveyed = []; picker.chosenPlace = undefined;
  try {
    const found = await searchPlaces(picker.query, controller!.signal);
    if (mine !== request) return;
    picker.places = found;
    if (!found.length) picker.error = "No place found by that name. Try the lake's name, or a town beside it.";
    else await choosePlace(found[0]!);
  } catch (error) { failed(mine, error); }
  finally { finish(mine); }
}

export async function choosePlace(place: PlaceResult): Promise<void> {
  const mine = begin(`Finding lakes near ${place.label.split(",")[0]}…`);
  // Selection and camera update immediately, before the outline request finishes.
  picker.chosenPlace = place; picker.lakes = []; picker.ponds = []; picker.surveyed = []; picker.activeId = undefined;
  const dx = 0.15 / Math.max(0.2, Math.cos(place.lat * Math.PI / 180));
  picker.bounds = { west: place.lon - dx, east: place.lon + dx, south: place.lat - 0.15, north: place.lat + 0.15 };
  try {
    const found = await lakesNear(place, controller!.signal);
    if (mine !== request) return;
    picker.lakes = found.lakes; picker.ponds = found.ponds; picker.surveyed = found.surveyed;
    const bounds = { ...picker.bounds! };
    for (const lake of [...found.lakes, ...found.ponds]) for (const [lon, lat] of lake.outline) {
      bounds.west = Math.min(bounds.west, lon); bounds.east = Math.max(bounds.east, lon);
      bounds.south = Math.min(bounds.south, lat); bounds.north = Math.max(bounds.north, lat);
    }
    picker.bounds = bounds;
    if (!found.lakes.length && !found.ponds.length) picker.error = `No selectable lake found near ${place.label.split(",")[0]}. This search result is a place, not a lake outline. Try another place or click a lake on the map.`;
  } catch (error) { failed(mine, error); }
  finally { finish(mine); }
}

function previewLake(lake: ChartableLake): void {
  picker.activeId = lake.id;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lon, lat] of lake.outline) { west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat); }
  picker.bounds = { west, east, south, north };
}

async function acceptLake(lake: ChartableLake, mine: number): Promise<void> {
  previewLake(lake);
  const whole = await wholeLake(lake, controller!.signal);
  if (mine !== request) return;
  resetDraft(); resetSession(); draft.lake = whole; draft.title = `${whole.name} depth chart`;
  previewLake(whole);
}
export async function chooseLake(lake: ChartableLake): Promise<void> {
  const mine = begin(`Loading ${lake.name}'s outline…`);
  try { await acceptLake(lake, mine); }
  catch (error) { failed(mine, error); }
  finally { finish(mine); }
}
export async function pickLakeOnMap(lat: number, lon: number, lakeId?: string): Promise<void> {
  const mine = begin("Finding the lake at this point…");
  try {
    const candidates = lakeMapTargets();
    const nearby = (lakeId ? candidates.find(lake => lake.id === lakeId) : undefined) ?? candidates.find(lake => lakeContains(lake, lat, lon));
    const lake = nearby ?? await lakeAt(lat, lon, controller!.signal);
    if (mine !== request) return;
    if (!lake) { picker.error = "No selectable lake outline at that point. Click inside the lake, or search for a nearby place."; return; }
    await acceptLake(lake, mine);
  } catch (error) { failed(mine, error); }
  finally { finish(mine); }
}
