import { resolveLakeOutlines } from "$lib/domain/lake-outlines";
import { apiBase } from "$lib/domain/api-base";
import { boundsForProject, groundWidthMFor, OUTLINE_CHART_KEY_PREFIX, sourceRequirements, createSyntheticSource, type AirspaceVolumeV1, type AviationStatus, type GeoBounds, type MarkingFeature, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1 } from "@topostack/core";
import { MAP_DATA_ATTRIBUTION } from "$lib/domain/map-attribution";
import { loadLakeBathymetry, applySurveyProvenance, type SurveyResult } from "$lib/domain/bathymetry";
import { dataZoom, fittingTileWindow } from "$lib/domain/tile-math";
import { assembleWater } from "$lib/domain/water-assembly";
import { loadElevation } from "$lib/domain/elevation-loader";
import { loadLakeAreas } from "$lib/domain/lake-area-loader";
import { loadVectorMarkings } from "$lib/domain/vector-loader";

/**
 * FAA aviation detail for the crop. The loader is imported only here, on
 * demand, so projects without aviation never download it.
 */
export async function loadAviation(bounds: GeoBounds, zoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<Pick<SourceBundleV1, "aviationMarkings" | "aviationCycle" | "aviationAttribution"> & { aviationStatus: AviationStatus }> {
  try {
    const { loadAviationMarkings } = await import("$lib/domain/aviation-provider");
    const { markings, status, cycle, attribution } = await loadAviationMarkings(bounds, zoom, config, signal);
    return { aviationMarkings: markings, aviationStatus: status, ...(cycle ? { aviationCycle: cycle } : {}), aviationAttribution: attribution };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { aviationMarkings: [], aviationStatus: "unavailable", aviationAttribution: [] };
  }
}

/**
 * Airspace sectors as volumes, for models that build airspace in acrylic.
 * Imported on demand like aviation. Outside FAA coverage the volumes are empty;
 * when loading fails they stay absent, so generation can tell "not loaded"
 * from "no airspace here".
 */
export async function loadAirspace(bounds: GeoBounds, zoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<Pick<SourceBundleV1, "airspaceVolumes" | "airspaceStatus" | "airspaceCycle">> {
  const settings = config.airspaceStack;
  if (!settings) return {};
  try {
    const { loadAirspaceVolumes } = await import("$lib/domain/airspace-volumes");
    const { classes } = settings;
    const { volumes, status, cycle } = await loadAirspaceVolumes(bounds, zoom, config, { classes: classes.B || classes.C || classes.D, specialUse: classes.specialUse }, signal);
    return { airspaceVolumes: volumes, airspaceStatus: status, ...(cycle ? { airspaceCycle: cycle } : {}) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { airspaceStatus: "unavailable" };
  }
}

/**
 * Survey providers first, then the maker's own charts on top: a chart is chosen
 * for one lake, so it answers a provider that is missing or wrong there. Charts
 * come from this browser only, so a project opened elsewhere keeps the survey.
 */
export async function loadSurveyedLakeDepths(bounds: GeoBounds, elevation: SourceBundleV1["elevation"], zoom: number, areas: WaterAreaV1[], signal?: AbortSignal, config?: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "userDepthCharts">): Promise<SurveyResult & { missingCharts?: string[] }> {
  const result = await loadLakeBathymetry(apiBase(), bounds, elevation, zoom, areas, signal, config);
  if (!config?.userDepthCharts || !Object.keys(config.userDepthCharts).length) return result;
  const { loadUserCharts } = await import("$lib/storage/user-charts");
  const { applyUserCharts } = await import("$lib/domain/user-bathymetry");
  const charts = await loadUserCharts(config.userDepthCharts);
  // A chart the project uses but this browser does not hold (a shared link, a
  // project opened on another machine) must be said, not silently replaced.
  const missing = areas.filter((area) => area.hylakId !== undefined && config.userDepthCharts![String(area.hylakId)] && !charts.has(String(area.hylakId))).map((area) => area.name ?? "a lake in this map");
  // A chart keyed by outline names no lake, so while it is missing there is no
  // telling which lake it was for; say so when this map has such lakes at all.
  const outlineMissing = Object.keys(config.userDepthCharts).some((key) => key.startsWith(OUTLINE_CHART_KEY_PREFIX) && !charts.has(key));
  if (outlineMissing && areas.some((area) => area.kind === "lake" && area.hylakId === undefined)) missing.push("a lake HydroLAKES does not list");
  const applied = await applyUserCharts(result, charts, bounds, elevation, signal, config);
  return missing.length ? { ...applied, missingCharts: [...new Set(missing)] } : applied;
}

export interface TerrainLoadResult {
  source: SourceBundleV1;
  /** True when elevation could not be loaded and deterministic sample terrain was substituted. */
  fallback: boolean;
  /** The underlying elevation failure behind a fallback, for the status line and warning. */
  fallbackReason?: string;
  /** Lake/ocean assembly failed after real elevation loaded; the terrain is kept without water adjustment. */
  waterWarning?: string;
  /** Lakes whose depth chart the project uses but this browser does not hold. */
  missingCharts?: string[];
}

const errorMessage = (error: unknown, fallback: string) => error instanceof Error && error.message.trim() ? error.message : fallback;

export type TerrainLoadStage = "fetching" | "preparing";

export async function loadTerrain(config: ProjectConfigV1, signal?: AbortSignal, onStage?: (stage: TerrainLoadStage) => void): Promise<TerrainLoadResult> {
  signal?.throwIfAborted();
  onStage?.("fetching");
  const bounds = boundsForProject(config);
  // Compiled only into the Playwright build (vite build --mode e2e) so browser
  // generation/export stays deterministic and cannot accidentally depend on an
  // external map service. The mode guard keeps a leaked VITE_E2E env var from
  // defeating the fabrication export policy in a production build.
  if (import.meta.env.VITE_E2E === "1" && (import.meta.env.DEV || import.meta.env.MODE !== "production")) {
    signal?.throwIfAborted();
    onStage?.("preparing");
    const fixture = createSyntheticSource({ ...config, location: { ...config.location, bounds } }, 32);
    const aviation = sourceRequirements(config).aviation ? { aviationMarkings: e2eAviationFixture(config), aviationStatus: "available" as const, aviationCycle: "2026-01-01" } : {};
    const airspace = sourceRequirements(config).airspace ? { airspaceVolumes: e2eAirspaceFixture(fixture), airspaceStatus: "available" as const, airspaceCycle: "2026-01-01" } : {};
    return { fallback: false, source: { ...fixture, sourceKind: "real", datasetVersion: "topostack-browser-e2e-v1", vectorStatus: "available", ...aviation, ...airspace } };
  }
  const zoom = dataZoom(config.location.zoom);
  const userSignal = signal;
  const operation = new AbortController();
  signal = userSignal ? AbortSignal.any([userSignal, operation.signal]) : operation.signal;
  try {
    // Ocean polygons are how geometry separates bathymetry from land relief,
    // so depth modeling needs vectors even when shoreline scoring is hidden.
    const { lakes: usesWaterDepth, vectors: vectorRequested, water: usesWaterAreas, aviation: aviationRequested, airspace: airspaceRequested } = sourceRequirements(config);
    let loaded;
    try {
      // Choose elevation detail from the crop, independently of the camera zoom.
      // Coarse upstream tiles can contain shoreline spikes absent from finer
      // levels (for example Lake Granby at z10). Start at the service maximum,
      // downshift to the tile budget, then resample to the bounded project grid.
      const window = fittingTileWindow(bounds, 15);
      loaded = await Promise.all([
        loadElevation(window, bounds, signal),
        vectorRequested
          ? loadVectorMarkings(bounds, zoom, config, signal)
            .then((vectorData) => ({ ...vectorData, status: vectorData.truncated ? "partial" as const : "available" as const }))
            .catch((error) => {
              if (signal?.aborted) throw error;
              return { markings: [], inland: [], ocean: [], truncated: false, status: "unavailable" as const };
            })
          : Promise.resolve({ markings: [], inland: [], ocean: [], truncated: false, status: "not-requested" as const }),
        usesWaterAreas
          ? loadLakeAreas(bounds, zoom, config, signal)
            .then((areas) => ({ areas, status: "available" as const }))
            .catch((error) => {
              if (signal?.aborted) throw error;
              return { areas: [] as WaterAreaV1[], status: "unavailable" as const };
            })
          : Promise.resolve({ areas: [] as WaterAreaV1[], status: "not-requested" as const }),
        aviationRequested ? loadAviation(bounds, zoom, config, signal) : Promise.resolve(undefined),
        airspaceRequested ? loadAirspace(bounds, zoom, config, signal) : Promise.resolve(undefined),
      ]);
    } catch (error) {
      if (userSignal?.aborted) throw error;
      // Elevation is the one input fabrication cannot do without. Keep the
      // editor usable with sample terrain, but say why real data is missing.
      onStage?.("preparing");
      const source = createSyntheticSource({ ...config, location: { ...config.location, bounds } });
      return {
        source: { ...source, vectorStatus: vectorRequested ? "unavailable" : "not-requested", lakeDataStatus: usesWaterDepth ? "unavailable" : "not-requested", ...(aviationRequested ? { aviationMarkings: [], aviationStatus: "unavailable" as const } : {}), ...(airspaceRequested ? { airspaceStatus: "unavailable" as const } : {}) },
        fallback: true,
        fallbackReason: errorMessage(error, "The terrain service could not be reached."),
      };
    }
    signal.throwIfAborted();
    onStage?.("preparing");
    const [{ elevation, elevationRepairCount, imagerySources, datasetVersion, terrainAttribution, terrainSourceUnavailable, terrainSelection }, vector, lakes, aviation, airspace] = loaded;
    const base: SourceBundleV1 = { schemaVersion: 1, elevation, elevationRepairCount, terrainSourceUnavailable, terrainSelection, markings: vector.markings, waterPatternAreas: [...vector.ocean, ...vector.inland], inlandWaterAreas: vector.inland, vectorStatus: vector.status, lakeDataStatus: lakes.status, ...aviation, ...airspace, datasetVersion, sourceKind: "real", bounds, imagerySources, resolutionM: groundWidthMFor(bounds) / elevation.width, attribution: [...MAP_DATA_ATTRIBUTION, ...terrainAttribution] };
    try {
      const areas = resolveLakeOutlines([], lakes.areas, usesWaterAreas ? vector.inland : []);
      const bathymetry = usesWaterDepth
        ? await loadSurveyedLakeDepths(bounds, elevation, zoom, areas, signal, config)
        : { areas, status: "not-covered" as const, datasetVersions: [], attribution: [] };
      const source = applySurveyProvenance({ ...base, lakeDataStatus: bathymetry.areas.length ? "available" : lakes.status }, bathymetry);
      return { fallback: false, source: assembleWater(source, bathymetry.areas, vector.ocean, config), ...("missingCharts" in bathymetry && bathymetry.missingCharts ? { missingCharts: bathymetry.missingCharts } : {}) };
    } catch (error) {
      if (userSignal?.aborted) throw error;
      // Water assembly is an enhancement over good elevation; never trade real
      // terrain for sample terrain because a lake outline failed to clip.
      const requested = usesWaterAreas;
      return {
        fallback: false,
        waterWarning: errorMessage(error, "Water outlines could not be assembled."),
        source: { ...base, waterAreas: vector.ocean.map((polygon, index) => ({ id: `ocean-${index}`, kind: "ocean" as const, polygon })), lakeDataStatus: requested ? "unavailable" : lakes.status, ...(usesWaterDepth ? { bathymetryStatus: "unavailable" as const } : {}) },
      };
    }
  } finally {
    operation.abort();
  }
}

/** A Class B ring, a runway and an airport for the Playwright build, which never reaches the map API. */
/** A small Class B over the e2e terrain: a core from the surface and a shelf around it, both clear of the ground. */
function e2eAirspaceFixture(source: SourceBundleV1): AirspaceVolumeV1[] {
  const topFt = Math.round(source.elevation.max / 0.3048);
  const square = (half: number) => [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }, { x: -half, y: -half }];
  return [
    { id: "e2e-core", aviationClass: "class-b", name: "E2E CLASS B", floor: { ref: "sfc", ft: 0 }, ceiling: { ref: "msl", ft: topFt + 4_000 }, polygons: [{ outer: square(30), holes: [] }] },
    { id: "e2e-shelf", aviationClass: "class-b", name: "E2E CLASS B", floor: { ref: "msl", ft: topFt + 1_500 }, ceiling: { ref: "msl", ft: topFt + 4_000 }, polygons: [{ outer: square(70), holes: [[...square(30)].reverse()] }] },
  ];
}

function e2eAviationFixture(config: ProjectConfigV1): MarkingFeature[] {
  const half = Math.min(config.widthMm, config.heightMm) * 0.3;
  return [
    { id: "e2e-class-b", kind: "aviation", operation: "engrave", aviationClass: "class-b", label: "E2E CLASS B", points: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }, { x: -half, y: -half }] },
    { id: "e2e-runway", kind: "aviation", operation: "engrave", aviationClass: "runway", label: "9/27", widthM: 45, points: [{ x: -half / 2, y: 0 }, { x: half / 2, y: 0 }] },
    { id: "e2e-airport", kind: "aviation", operation: "engrave", aviationClass: "airport", aviationSymbol: "airport-pattern", aviationDetail: { towered: true, beacon: true, runways: [[{ x: -1, y: 0 }, { x: 1, y: 0 }], [{ x: -0.6, y: -0.6 }, { x: 0.6, y: 0.6 }]] }, label: "E2E", points: [{ x: 0, y: half / 2 }] },
  ];
}
