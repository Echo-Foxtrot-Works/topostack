import { PROTOMAPS_BASEMAP_VERSION, PROTOMAPS_SNAPSHOT, VECTOR_MAX_ZOOM } from "./dataset";
import type { SurveySource, TerrainSource } from "@topostack/data-contracts/source-catalog";

interface ManifestSource {
  name: string;
  url: string;
  attribution?: string;
  license?: string;
  version?: string;
  id?: string;
  archive?: string;
  optional?: boolean;
  verticalDatum?: string;
  minZoom?: number;
  maxZoom?: number;
  nativeResolutionM?: number;
}

function terrainEntry(source: TerrainSource, archive: string): ManifestSource {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    attribution: source.license,
    archive,
    optional: true,
    verticalDatum: source.verticalDatum,
    minZoom: source.minZoom,
    maxZoom: source.maxZoom,
    nativeResolutionM: source.nativeResolutionM,
  };
}

function bathymetryEntry(source: SurveySource, archive: string): ManifestSource {
  return { name: source.name, url: source.url, attribution: source.license, archive };
}

export function buildManifest(datasetVersion: string, terrainSources: ReadonlyArray<{ source: TerrainSource; path: string }>, bathymetrySources: ReadonlyArray<{ source: SurveySource; path: string }>) {
  return {
    schemaVersion: 1,
    capabilities: { archiveReleases: 1, upstreamProbes: 1 },
    datasetVersion,
    coverage: { projection: "Web Mercator", minLatitude: -85.0511, maxLatitude: 85.0511, landOnly: true, vectorMaxZoom: VECTOR_MAX_ZOOM },
    sources: [
      { name: "Mapzen Terrain Tiles", url: "https://registry.opendata.aws/terrain-tiles/", attribution: "See Mapzen source attribution" },
      { name: "HydroLAKES v1.0", url: "https://www.hydrosheds.org/products/hydrolakes", attribution: "CC BY 4.0 — Messager et al. (2016)" },
      ...terrainSources.map(({ source, path }) => terrainEntry(source, path)),
      ...bathymetrySources.map(({ source, path }) => bathymetryEntry(source, path)),
      { name: "GLOBathy", url: "https://doi.org/10.1038/s41597-022-01132-9", attribution: "CC0 1.0 — Khazaei et al. (2022)" },
      { name: `Protomaps Basemap ${PROTOMAPS_SNAPSHOT}`, url: `https://build.protomaps.com/${PROTOMAPS_SNAPSHOT}.pmtiles`, version: PROTOMAPS_BASEMAP_VERSION, license: "ODbL Produced Work" },
      { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", license: "ODbL" },
    ] satisfies ManifestSource[],
  };
}
