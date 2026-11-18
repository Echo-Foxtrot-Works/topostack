import { readFile } from "node:fs/promises";
import { expandProjectRequest, parseProjectRequest } from "@topostack/core/project";

// The projects the Atomm listing media is rendered from. Each one goes through
// the same request contract the agent API and MCP server use, so a card shows
// what anyone asking for that place would get. Build @topostack/core first.
const SIZE = { widthMm: 406.4, heightMm: 270.933, materialThicknessMm: 3.175 };

function project(id, request) {
  const parsed = parseProjectRequest({ requestVersion: 1, ...SIZE, ...request });
  if (!parsed.ok) throw new Error(`${id}: ${parsed.errors.map(e => `${e.path} ${e.message}`).join("; ")}`);
  return { ...expandProjectRequest(parsed.value), id: `topostack-listing-${id}` };
}

/** Crater Lake keeps the reviewed v6 media project the earlier listings used. */
export async function craterLake() {
  const base = JSON.parse(await readFile(new URL("../../atomm/media-project-v6.json", import.meta.url), "utf8"));
  return { ...base, name: "Crater Lake" };
}

/** "Any place on Earth": the hero and five more, in card order. */
export async function listingPlaces() {
  return [
    { id: "crater-lake", label: "Crater Lake", where: "Oregon, USA", project: await craterLake() },
    { id: "grand-canyon", label: "Grand Canyon", where: "Arizona, USA", project: project("grand-canyon", { name: "Grand Canyon", placeLabel: "Grand Canyon, Arizona, USA", area: { center: { lat: 36.1069, lon: -112.1129 }, widthKm: 18 }, verticalExaggeration: 2.6 }) },
    { id: "rainier", label: "Mount Rainier", where: "Washington, USA", project: project("rainier", { name: "Mount Rainier", placeLabel: "Mount Rainier, Washington, USA", area: { center: { lat: 46.8523, lon: -121.7603 }, widthKm: 16 }, verticalExaggeration: 2.6 }) },
    { id: "grand-teton", label: "Grand Teton", where: "Wyoming, USA", project: project("grand-teton", { name: "Grand Teton", placeLabel: "Grand Teton and Jenny Lake, Wyoming, USA", area: { center: { lat: 43.76, lon: -110.73 }, widthKm: 16 }, verticalExaggeration: 2.2 }) },
    { id: "fuji", label: "Mount Fuji", where: "Japan", project: project("fuji", { name: "Mount Fuji", placeLabel: "Mount Fuji, Japan", area: { center: { lat: 35.3606, lon: 138.7274 }, widthKm: 18 }, verticalExaggeration: 3 }) },
    { id: "matterhorn", label: "Matterhorn", where: "Switzerland", project: project("matterhorn", { name: "Matterhorn", placeLabel: "Matterhorn, Switzerland", area: { center: { lat: 45.9763, lon: 7.6586 }, widthKm: 10 }, verticalExaggeration: 2 }) },
  ];
}

/** One project per feature card. */
export async function featureProjects() {
  const crater = await craterLake();
  return {
    acrylic: { ...crater, waterInserts: { fitClearanceMm: 0.1, excludedLakeIds: [] } },
    lands: project("lands", { name: "Grand Teton", placeLabel: "Grand Teton National Park, Wyoming, USA", area: { center: { lat: 43.79, lon: -110.68 }, widthKm: 40 }, verticalExaggeration: 1.5, paintTemplates: ["water", "national-park", "national-forest", "wilderness"], publicLands: { boundaries: ["national-park", "national-forest"], names: false, hatched: false } }),
    airspace: project("airspace", { name: "Colorado Springs airspace", placeLabel: "Colorado Springs, Colorado, USA", area: { center: { lat: 38.8058, lon: -104.7008 }, widthKm: 40 }, verticalExaggeration: 2, aviation: { airspace: true, airports: true, runways: true }, airspaceStack: { form: "tiers" } }),
  };
}
