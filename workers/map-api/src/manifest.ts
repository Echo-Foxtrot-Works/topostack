import { PROTOMAPS_BASEMAP_VERSION, PROTOMAPS_SNAPSHOT, VECTOR_MAX_ZOOM } from "./dataset";
import type { SurveySource, TerrainSource } from "@topostack/data-contracts/source-catalog";
import type { ArchiveRelease } from "@topostack/data-contracts/archive-release";
import { aviationRegistration, aviationSources, currentAviationRelease, landsSources, servedBathymetryArchives, servedTerrainArchives } from "./routes/archive";
import type { LandsSources } from "@topostack/data-contracts/land-tiles";
import { MERCATOR_MAX_LATITUDE } from "@topostack/core/project";

interface ManifestSource {
  name: string;
  url: string;
  attribution?: string;
  license?: string;
  version?: string;
  id?: string;
  archive?: string;
  optional?: boolean;
  release?: Pick<ArchiveRelease, "sha256" | "bytes" | "etag" | "objectKey">;
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

function aviationEntry({ sha256, bytes, etag, objectKey }: ArchiveRelease): ManifestSource {
  const sources = aviationSources;
  return { release: { sha256, bytes, etag, objectKey }, id: sources.dataset, name: `${sources.name}, NASR cycle ${sources.nasrCycle}`, url: sources.url, license: sources.license, version: sources.nasrCycle, archive: "/v1/aviation.pmtiles", optional: true, maxZoom: sources.maxZoom };
}

function landsEntry(sources: LandsSources): ManifestSource {
  const canada = sources.canada;
  return { id: sources.dataset, name: canada ? `${sources.name}; ${canada.name}` : sources.name, url: sources.url, license: canada ? `${sources.license} ${canada.license}` : sources.license, version: sources.padusVersion, archive: "/v1/lands.pmtiles", optional: true, minZoom: sources.minZoom, maxZoom: sources.maxZoom };
}

export async function buildManifest(env: Env) {
  const aviation = await currentAviationRelease(env);
  const terrainSources = servedTerrainArchives(env.ENVIRONMENT);
  const bathymetrySources = servedBathymetryArchives(env.ENVIRONMENT);
  return {
    schemaVersion: 1,
    capabilities: { archiveReleases: 1, upstreamProbes: 1 },
    datasetVersion: env.DATASET_VERSION,
    registrations: { aviation: aviationRegistration(env) },
    coverage: { projection: "Web Mercator", minLatitude: -MERCATOR_MAX_LATITUDE, maxLatitude: MERCATOR_MAX_LATITUDE, landOnly: true, vectorMaxZoom: VECTOR_MAX_ZOOM },
    sources: [
      { name: "Mapzen Terrain Tiles", url: "https://registry.opendata.aws/terrain-tiles/", attribution: "See Mapzen source attribution" },
      { name: "HydroLAKES v1.0", url: "https://www.hydrosheds.org/products/hydrolakes", attribution: "CC BY 4.0 — Messager et al. (2016)" },
      ...terrainSources.map(({ source, path }) => terrainEntry(source, path)),
      ...bathymetrySources.map(({ source, path }) => bathymetryEntry(source, path)),
      { name: "GLOBathy", url: "https://doi.org/10.1038/s41597-022-01132-9", attribution: "CC0 1.0 — Khazaei et al. (2022)" },
      { name: `Protomaps Basemap ${PROTOMAPS_SNAPSHOT}`, url: `https://build.protomaps.com/${PROTOMAPS_SNAPSHOT}.pmtiles`, version: PROTOMAPS_BASEMAP_VERSION, license: "ODbL Produced Work" },
      { id: "openfreemap-buildings", name: "OpenFreeMap building footprints", url: "https://openfreemap.org/", license: "© OpenMapTiles (CC BY 4.0), OpenStreetMap contributors (ODbL)", optional: true, minZoom: 13, maxZoom: 14 },
      { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", license: "ODbL" },
      ...(aviation ? [aviationEntry(aviation)] : []),
      landsEntry(landsSources),
    ] satisfies ManifestSource[],
  };
}
