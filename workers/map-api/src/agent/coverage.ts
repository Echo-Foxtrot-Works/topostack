import type { GeoBounds } from "@topostack/core/project";
import type { SurveySource, TerrainSource } from "@topostack/data-contracts/source-catalog";
import { bathymetryArchives, terrainArchives } from "../routes/archive";

/** Which of TopoStack's data sources reach a crop, so an agent can say what detail to expect. */
export interface AreaCoverage {
  terrain: {
    /** The global base terrain always covers Web Mercator land. */
    base: string;
    highResolution: Array<{ id: string; name: string; resolutionM: number; license: string }>;
  };
  lakeSurveys: Array<{ id: string; name: string; license: string }>;
  roadsAndWater: string;
  notes: string[];
}

const intersects = (source: Pick<SurveySource, "bounds">, bounds: GeoBounds) => {
  const [west, south, east, north] = source.bounds;
  return west < bounds.east && east > bounds.west && south < bounds.north && north > bounds.south;
};

/** Whether a lake survey's box holds this point, to flag search results with surveyed depths nearby. */
export function surveyedLakeAt(lat: number, lon: number, surveys: ReadonlyArray<{ source: Pick<SurveySource, "bounds"> }> = bathymetryArchives): boolean {
  return surveys.some(({ source }) => {
    const [west, south, east, north] = source.bounds;
    return lon >= west && lon <= east && lat >= south && lat <= north;
  });
}

export function areaCoverage(bounds: GeoBounds, sources: {
  terrain?: ReadonlyArray<{ source: TerrainSource }>;
  surveys?: ReadonlyArray<{ source: SurveySource }>;
} = {}): AreaCoverage {
  const terrain = (sources.terrain ?? terrainArchives).filter(({ source }) => intersects(source, bounds))
    .map(({ source }) => ({ id: source.id, name: source.name, resolutionM: source.nativeResolutionM, license: source.license }));
  const surveys = (sources.surveys ?? bathymetryArchives).filter(({ source }) => intersects(source, bounds))
    .map(({ source }) => ({ id: source.id, name: source.name, license: source.license }));
  const notes = [
    "Terrain is land elevation; open sea is flat at sea level and lakes use survey or modeled depths.",
    ...(terrain.length ? ["High-resolution terrain is used where it covers the area."] : []),
    ...(surveys.length ? ["Surveyed lake floors here can add sheets below the shoreline when water depth is on; the studio counts them."] : []),
  ];
  return {
    terrain: { base: "Mapzen Terrain Tiles (global, about 30 m or coarser)", highResolution: terrain },
    lakeSurveys: surveys,
    roadsAndWater: "OpenStreetMap via Protomaps, worldwide",
    notes,
  };
}
