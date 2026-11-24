import type { GeoBounds } from "@topostack/core/project";
import type { SurveySource, TerrainSource } from "@topostack/data-contracts/source-catalog";
import { aviationCovers, type AviationSources } from "@topostack/data-contracts/aviation-tiles";
import { landSourcesCovering, type LandsSources } from "@topostack/data-contracts/land-tiles";
import { aviationSources, landsSources, servedBathymetryArchives, servedTerrainArchives } from "../routes/archive";

/** Candidate sources for a crop. This lookup compares registered extents without reading tiles. */
export interface AreaCoverage {
  terrain: {
    /** Base elevation service for Web Mercator land. */
    base: string;
    highResolution: Array<{ id: string; name: string; resolutionM: number; license: string }>;
    /** Ocean depth grids, used where the area reaches the sea. */
    ocean: Array<{ id: string; name: string; resolutionM: number; license: string }>;
  };
  lakeSurveys: Array<{ id: string; name: string; license: string }>;
  roadsAndWater: string;
  /** FAA release candidate when the crop touches a registered search region. */
  aviation: { name: string; nasrCycle: string; license: string } | null;
  /** PAD-US and CPCAD candidates selected by their registered search regions. */
  publicLands: Array<{ name: string; version: string; license: string }>;
  notes: string[];
}

const intersects = (source: Pick<SurveySource, "bounds">, bounds: GeoBounds) => {
  const [west, south, east, north] = source.bounds;
  return west < bounds.east && east > bounds.west && south < bounds.north && north > bounds.south;
};

/**
 * A crop across the antimeridian keeps unwrapped longitudes (one edge past
 * ±180°); its copies a world east and west reach the sources on the other side.
 */
const worldCopies = (bounds: GeoBounds): GeoBounds[] =>
  [0, -360, 360].map((shift) => ({ ...bounds, west: bounds.west + shift, east: bounds.east + shift }));

/** Whether a lake survey's box holds this point, to flag search results with surveyed depths nearby. */
export function surveyedLakeAt(lat: number, lon: number, surveys: ReadonlyArray<{ source: Pick<SurveySource, "bounds"> }> = servedBathymetryArchives()): boolean {
  return surveys.some(({ source }) => {
    const [west, south, east, north] = source.bounds;
    return lon >= west && lon <= east && lat >= south && lat <= north;
  });
}

export function areaCoverage(bounds: GeoBounds, sources: {
  terrain?: ReadonlyArray<{ source: TerrainSource }>;
  surveys?: ReadonlyArray<{ source: SurveySource }>;
  aviation?: AviationSources;
  lands?: LandsSources;
} = {}): AreaCoverage {
  const copies = worldCopies(bounds);
  const touching = (sources.terrain ?? servedTerrainArchives()).filter(({ source }) => copies.some((copy) => intersects(source, copy)))
    .map(({ source }) => ({ kind: source.kind, entry: { id: source.id, name: source.name, resolutionM: source.nativeResolutionM, license: source.license } }));
  const terrain = touching.filter(({ kind }) => kind !== "bathymetry-grid").map(({ entry }) => entry);
  const ocean = touching.filter(({ kind }) => kind === "bathymetry-grid").map(({ entry }) => entry);
  const surveys = (sources.surveys ?? servedBathymetryArchives()).filter(({ source }) => copies.some((copy) => intersects(source, copy)))
    .map(({ source }) => ({ id: source.id, name: source.name, license: source.license }));
  const faa = sources.aviation ?? aviationSources;
  const aviation = aviationCovers(faa, bounds) ? { name: faa.name, nasrCycle: faa.nasrCycle, license: faa.license } : null;
  const registration = sources.lands ?? landsSources;
  const touched = new Set(copies.flatMap((copy) => landSourcesCovering(registration, copy)));
  const publicLands = [
    ...(touched.has("padus") ? [{ name: registration.name, version: registration.padusVersion, license: registration.license }] : []),
    ...(touched.has("cpcad") && registration.canada ? [{ name: registration.canada.name, version: registration.canada.date, license: registration.canada.license }] : []),
  ];
  const notes = [
    ocean.length
      ? `${ocean.map(({ name }) => name).join(" and ")} can supply sea floor elevations where it has valid samples. Lakes use survey or modeled depths.`
      : "Offshore elevations come from the base terrain and can be flat. Lakes use survey or modeled depths.",
    ...(terrain.length ? ["Valid regional elevation samples replace the base terrain."] : []),
    ...(aviation || publicLands.length ? ["Aviation and land search regions can include empty crops across a border."] : []),
    ...(surveys.length ? ["Surveyed lake floors here can add sheets below the shoreline when water depth is on; the studio counts them."] : []),
  ];
  return {
    terrain: { base: "Mapzen Terrain Tiles (source and ground resolution vary by location)", highResolution: terrain, ocean },
    lakeSurveys: surveys,
    roadsAndWater: "OpenStreetMap via Protomaps, up to zoom 12. Local mapping and generalization affect detail.",
    aviation,
    publicLands,
    notes,
  };
}
