import { loadProviderOutlines, resolveLakeOutlines } from "$lib/domain/lake-outlines";
import { mapTiles } from "$lib/domain/tile-requests";
import { apiBase } from "$lib/domain/api-base";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { boundsForProject, groundWidthMFor, OUTLINE_CHART_KEY_PREFIX, sourceRequirements, createSyntheticSource, type GeoBounds, type MarkingFeature, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type TransportationClass, type WaterAreaV1 } from "@topostack/core";
import { createArchive, networkSignal } from "$lib/domain/archive";
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { MAP_DATA_ATTRIBUTION } from "$lib/domain/map-attribution";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { loadLakeBathymetry, applySurveyProvenance, type SurveyResult } from "$lib/domain/bathymetry";
import { applyPreferredTerrain } from "$lib/domain/terrain-sources";
import { repairElevationSpikes } from "$lib/domain/elevation-cleanup";
import { dataZoom, fittingTileWindow, tilePointProjector, TILE_SIZE, type TileWindow } from "$lib/domain/tile-math";
import { cleanBoundaryMarkings, cleanWaterwayMarkings, clipVectorTileLine, dissolveWaterAreas, limitVectorMarkingGroups, MAX_VECTOR_MARKINGS, shorelineMarkings, stitchTransportationMarkings } from "$lib/domain/vector-cleanup";
import { assembleWater } from "$lib/domain/water-assembly";
import { isSupportedCoordinate } from "$lib/domain/coordinates";

// Pure geometry helpers moved to focused modules; re-exported for existing callers.
export { cleanBoundaryMarkings, cleanWaterwayMarkings, clipVectorTileLine, dissolveWaterAreas, dissolveWaterPolygons, joinPaths, limitVectorMarkingGroups, shorelineMarkings, stitchTransportationMarkings } from "$lib/domain/vector-cleanup";
export { applyLakeShorelines, assembleWater, combineWaterAreas } from "$lib/domain/water-assembly";

export interface PlaceResult { id: string; label: string; lat: number; lon: number; type?: string; bounds?: GeoBounds; zoom?: number; surveyedLake?: boolean }

const RAW_VECTOR_MARKING_BUDGET_MULTIPLIER = 4;
const MAJOR_ROAD_DETAILS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const LOCAL_ROAD_DETAILS = new Set(["tertiary", "tertiary_link", "residential", "service", "unclassified", "road", "raceway", "driveway", "parking_aisle", "alley", "drive-through", "emergency_access"]);
const TRAIL_DETAILS = new Set(["pedestrian", "track", "path", "cycleway", "bridleway", "steps", "corridor", "sidewalk", "crossing"]);
const EXCLUDED_TRANSPORT_KINDS = new Set(["rail", "aerialway", "ferry", "pier", "aeroway"]);

/** The crop is computed in core so the studio and the Worker agree on it. */
export { boundsForProject };

export function classifyTransportation(properties: Record<string, unknown>): TransportationClass | undefined {
  const kind = typeof properties.kind === "string" ? properties.kind : "";
  const detail = typeof properties.kind_detail === "string" ? properties.kind_detail : "";
  if (EXCLUDED_TRANSPORT_KINDS.has(kind)) return undefined;
  if (kind === "path" || TRAIL_DETAILS.has(detail)) return "trail";
  if (kind === "highway" || kind === "major_road" || MAJOR_ROAD_DETAILS.has(detail)) return "major-road";
  if (kind === "minor_road" || LOCAL_ROAD_DETAILS.has(detail)) return "local-road";
  return undefined;
}

export function transportationLabel(properties: Record<string, unknown>): string | undefined {
  for (const key of ["name", "ref", "shield_text"] as const) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Protomaps normalizes first-level administrative lines to kind=region. */
export function isStateProvinceBoundary(properties: Record<string, unknown>): boolean {
  return properties.kind === "region";
}

// Decode numeric PNG channels directly, then interpolate elevations at native
// pixel centers. Browser image/canvas APIs can alter the encoded heights.
async function loadElevation(window: TileWindow, bounds: GeoBounds, signal?: AbortSignal) {
  const responses = await mapTiles(window.tiles, async (tile, signal) => {
    // Public tile URLs survive dataset releases; revalidate before fabrication.
    const response = await fetch(`${apiBase()}/v1/terrain/${tile.z}/${tile.x}/${tile.y}.png`, { signal: networkSignal(signal), cache: "no-cache" });
    if (!response.ok) throw new Error(`Terrain service returned ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    return { tile, response, values: decodeTerrainPng(bytes) };
  }, signal);
  const preferred = await applyPreferredTerrain(apiBase(), bounds, responses.map(({ tile, values }) => ({ ...tile, values })), signal);
  const minTileX = Math.min(...window.tiles.map((tile) => tile.worldX));
  const minTileY = Math.min(...window.tiles.map((tile) => tile.y));
  const mosaicWidth = (Math.max(...window.tiles.map((tile) => tile.worldX)) - minTileX + 1) * TILE_SIZE;
  const mosaicHeight = (Math.max(...window.tiles.map((tile) => tile.y)) - minTileY + 1) * TILE_SIZE;
  const mosaic = new Float32Array(mosaicWidth * mosaicHeight);
  const terrainOwners = new Uint16Array(mosaic.length);
  const imagerySources = new Set<string>();
  const datasetVersions = new Set<string>();
  for (const [tileIndex, { tile, response, values }] of responses.entries()) {
    const datasetVersion = response.headers.get("x-topostack-dataset");
    if (!datasetVersion?.trim()) throw new Error("Terrain tile is missing its dataset version.");
    datasetVersions.add(datasetVersion);
    response.headers.get("x-topostack-imagery-sources")?.split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => imagerySources.add(value));
    const left = (tile.worldX - minTileX) * TILE_SIZE;
    const top = (tile.y - minTileY) * TILE_SIZE;
    for (let row = 0; row < TILE_SIZE; row += 1) {
      const offset = (top + row) * mosaicWidth + left;
      mosaic.set(values.subarray(row * TILE_SIZE, (row + 1) * TILE_SIZE), offset);
      terrainOwners.set(preferred.owners[tileIndex]!.subarray(row * TILE_SIZE, (row + 1) * TILE_SIZE), offset);
    }
  }
  if (datasetVersions.size > 1) throw new Error("Terrain tiles came from inconsistent dataset versions. Try again shortly.");

  // Use the stitched native raster so tile boundaries are ordinary neighbors.
  const elevationRepairCount = repairElevationSpikes(mosaic, mosaicWidth, mosaicHeight);

  // Output samples i in 0..width-1 span [westX, eastX] edge to edge, matching
  // the contourToMm/sampleElevation convention in core (grid.width - 1 spans
  // the full material width). Cap at the native pixel span so we never invent
  // resolution the tiles do not have.
  const spanX = window.eastX - window.westX;
  const spanY = window.southY - window.northY;
  const outputWidth = Math.max(64, Math.min(768, Math.round(spanX)));
  const outputHeight = Math.max(64, Math.min(768, Math.round(outputWidth * spanY / spanX)));
  const values = new Float32Array(outputWidth * outputHeight);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const contributions = new Float64Array(preferred.selectedSources.length + 1);
  const sampleMosaic = (x: number, y: number, weight: number): number => {
    const clampedX = Math.max(0, Math.min(mosaicWidth - 1, x));
    const clampedY = Math.max(0, Math.min(mosaicHeight - 1, y));
    const index = clampedY * mosaicWidth + clampedX;
    contributions[terrainOwners[index]!]! += weight;
    return mosaic[index] ?? 0;
  };
  for (let row = 0; row < outputHeight; row += 1) {
    // Native pixel centers sit at +0.5, so subtract it before interpolating.
    const worldY = window.northY + (spanY * row) / (outputHeight - 1) - minTileY * TILE_SIZE - 0.5;
    const y0 = Math.floor(worldY);
    const fy = worldY - y0;
    for (let column = 0; column < outputWidth; column += 1) {
      const worldX = window.westX + (spanX * column) / (outputWidth - 1) - minTileX * TILE_SIZE - 0.5;
      const x0 = Math.floor(worldX);
      const fx = worldX - x0;
      const top = sampleMosaic(x0, y0, (1 - fx) * (1 - fy)) * (1 - fx) + sampleMosaic(x0 + 1, y0, fx * (1 - fy)) * fx;
      const bottom = sampleMosaic(x0, y0 + 1, (1 - fx) * fy) * (1 - fx) + sampleMosaic(x0 + 1, y0 + 1, fx * fy) * fx;
      const elevation = top * (1 - fy) + bottom * fy;
      values[row * outputWidth + column] = elevation;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  }
  const terrainSelection: NonNullable<SourceBundleV1["terrainSelection"]> = {
    policy: "terrain-priority-v1", attempts: preferred.attempts,
    sources: [
      { id: "mapzen", name: "Mapzen composite terrain", verticalDatum: "Source-dependent", fraction: contributions[0]! / values.length },
      ...preferred.selectedSources.map((source, index) => ({ id: source.id, name: source.name, nativeResolutionM: source.nativeResolutionM, verticalDatum: source.verticalDatum, fraction: contributions[index + 1]! / values.length })),
    ].filter((source) => source.fraction > 0.000001),
  };
  return { terrainSelection, elevation: { width: outputWidth, height: outputHeight, values, min, max }, elevationRepairCount, imagerySources: [...imagerySources, ...preferred.imagerySources].sort(), datasetVersion: [[...datasetVersions][0]!, ...preferred.datasetVersions].join("+"), terrainAttribution: preferred.attribution, terrainSourceUnavailable: preferred.unavailable };
}

export interface VectorData {
  markings: MarkingFeature[];
  /** Dissolved inland water, kept so lakes without depth data still read as water. */
  inland: Polygon2D[];
  /** Dissolved ocean, whose depth the DEM already carries. */
  ocean: Polygon2D[];
  /** True when enabled linework exceeded the bounded decoding/export budget. */
  truncated: boolean;
}

export async function loadVectorMarkings(bounds: GeoBounds, requestedZoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<VectorData> {
  signal?.throwIfAborted();
  const vectorArchive = createArchive(`${apiBase()}/v1/osm.pmtiles`, signal);
  const header = await vectorArchive.getHeader();
  signal?.throwIfAborted();
  const window = fittingTileWindow(bounds, Math.max(header.minZoom, Math.min(header.maxZoom, Math.round(requestedZoom) + 1)), header.minZoom);
  const projectPoint = tilePointProjector(window, config.widthMm, config.heightMm);
  const { water: usesWaterAreas } = sourceRequirements(config);
  // Share cleanup headroom across the selection. Fixed per-tile/category
  // quotas can discard a dense tile while empty neighbors leave room unused.
  let rawMarkingCount = 0;
  type TileVectors = { markings: MarkingFeature[]; waterPolygons: Polygon2D[]; oceanPolygons: Polygon2D[]; truncated: boolean };
  const consumeGeometry = createFeatureBudget();
  const perTile = await mapTiles(window.tiles, async (tile, signal): Promise<TileVectors> => {
    const markings: MarkingFeature[] = [];
    const waterPolygons: Polygon2D[] = [];
    const oceanPolygons: Polygon2D[] = [];
    let truncated = false;
    const response = await vectorArchive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return { markings, waterPolygons, oceanPolygons, truncated };
    const vectorTile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
    for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
      const lowered = layerName.toLowerCase();
      const isRoad = lowered.includes("road") || lowered.includes("transportation");
      const isWater = lowered === "water" || lowered.includes("waterway");
      const isBoundary = lowered === "boundaries" || lowered.includes("boundary");
      if (!isRoad && !isWater && !isBoundary) continue;
      for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
        if (featureIndex % 64 === 0) await yieldForCancellation(signal);
        const feature = layer.feature(featureIndex);
        if (feature.type !== 2 && !(isWater && feature.type === 3)) continue;
        const properties = feature.properties as Record<string, unknown>;
        if (isWater && feature.type === 3) {
          if (!usesWaterAreas) continue;
          const isOcean = properties.kind === "ocean";
          const geometry = feature.loadGeometry();
          consumeGeometry(geometry, true);
          classifyRings(geometry).forEach((polygon) => {
            const [outer, ...holes] = polygon;
            if (!outer) return;
            const projected = { outer: outer.map((point) => projectPoint(tile, feature.extent, point)), holes: holes.map((ring) => ring.map((point) => projectPoint(tile, feature.extent, point))) };
            (isOcean ? oceanPolygons : waterPolygons).push(projected);
          });
          continue;
        }
        let kind: "boundary" | "road" | "trail" | "water";
        let transportationClass: TransportationClass | undefined;
        if (isBoundary) {
          if (!config.showBoundaries || !isStateProvinceBoundary(properties)) continue;
          kind = "boundary";
        } else if (isRoad) {
          transportationClass = classifyTransportation(properties);
          if (!transportationClass) continue;
          kind = transportationClass === "trail" ? "trail" : "road";
          if ((kind === "trail" && !config.showTrails) || (kind === "road" && !config.showRoads)) continue;
        } else {
          if (!config.showWater) continue;
          kind = "water";
        }
        // Retain names so enabling labels after generation needs no reload.
        const label = isRoad ? transportationLabel(properties) : undefined;
        const geometry = feature.loadGeometry();
        consumeGeometry(geometry);
        geometry.forEach((line, lineIndex) => {
          clipVectorTileLine(line, feature.extent).forEach((clippedLine, clippedIndex) => {
            if (clippedLine.length < 2) return;
            // Tile coverage exceeds the crop, especially at the archive's max
            // zoom. Off-crop roads must not consume the fabrication budget.
            // Keep a styling margin so road end caps stay outside the artwork.
            const width = config.widthMm + 8;
            const height = config.heightMm + 8;
            const normalized = clippedLine.map((point) => {
              const projected = projectPoint(tile, feature.extent, point);
              return { x: projected.x / width + 0.5, y: projected.y / height + 0.5 };
            });
            clipVectorTileLine(normalized, 1).forEach((line, cropIndex) => {
              if (rawMarkingCount >= MAX_VECTOR_MARKINGS * RAW_VECTOR_MARKING_BUDGET_MULTIPLIER) { truncated = true; return; }
              rawMarkingCount += 1;
              markings.push({
                id: [tile.z, tile.worldX, tile.y, layerName, feature.id ?? featureIndex, lineIndex, clippedIndex, cropIndex].join("-"),
                kind,
                operation: kind === "water" ? "score" : "engrave",
                ...(transportationClass ? { transportationClass } : {}),
                ...(label ? { label } : {}),
                points: line.map((point) => ({ x: (point.x - 0.5) * width, y: (point.y - 0.5) * height })),
              });
            });
          });
        });
      }
    }
    return { markings, waterPolygons, oceanPolygons, truncated };
  }, signal);
  await yieldForCancellation(signal);
  const rawMarkings = perTile.flatMap((tile) => tile.markings);
  const boundaries = cleanBoundaryMarkings(rawMarkings.filter((marking) => marking.kind === "boundary"), config.minimumFeatureMm);
  const transportation = stitchTransportationMarkings(rawMarkings.filter((marking) => marking.kind === "road" || marking.kind === "trail"));
  const roads = transportation.filter((marking) => marking.kind === "road");
  const trails = transportation.filter((marking) => marking.kind === "trail");
  const waterways = cleanWaterwayMarkings(rawMarkings.filter((marking) => marking.kind === "water"), config.minimumFeatureMm);
  const inland = dissolveWaterAreas(perTile.flatMap((tile) => tile.waterPolygons), config.minimumFeatureMm);
  const ocean = dissolveWaterAreas(perTile.flatMap((tile) => tile.oceanPolygons), config.minimumFeatureMm);
  const shorelines = config.showWater ? shorelineMarkings([...ocean, ...inland]) : [];
  const limited = limitVectorMarkingGroups([boundaries, roads, trails, shorelines, waterways]);
  return {
    markings: limited.markings,
    inland,
    ocean,
    truncated: limited.truncated || perTile.some((tile) => tile.truncated),
  };
}

/**
 * Lake outlines carrying the depth metadata a basin is modeled from.
 *
 * Tiles snap outward to whole-tile boundaries, so this returns lake geometry
 * from beyond the crop as well. That margin matters: the carve measures
 * distance to shore, and a lake truncated at the crop edge would otherwise be
 * handed a false shoreline running straight down the margin.
 */
export async function loadLakeAreas(bounds: GeoBounds, requestedZoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<WaterAreaV1[]> {
  const results = await Promise.allSettled([
    loadProviderOutlines(apiBase(), bounds, config, signal),
    loadHydroLakeAreas(bounds, requestedZoom, config, signal),
  ]);
  signal?.throwIfAborted();
  if (results.every((result) => result.status === "rejected")) throw new Error("Lake outlines could not be loaded.");
  const areas = resolveLakeOutlines(results[0].status === "fulfilled" ? results[0].value : [], results[1].status === "fulfilled" ? results[1].value : [], []);
  if (!areas.length && results.some((result) => result.status === "rejected")) throw new Error("Lake outline coverage could not be checked.");
  return areas;
}

async function loadHydroLakeAreas(bounds: GeoBounds, requestedZoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<WaterAreaV1[]> {
  signal?.throwIfAborted();
  const lakeArchive = createArchive(`${apiBase()}/v1/lakes.pmtiles`, signal);
  const header = await lakeArchive.getHeader();
  signal?.throwIfAborted();
  const window = fittingTileWindow(bounds, Math.max(header.minZoom, Math.min(header.maxZoom, Math.round(requestedZoom))), header.minZoom);
  const projectPoint = tilePointProjector(window, config.widthMm, config.heightMm);
  const numberProperty = (properties: Record<string, unknown>, key: string): number | undefined => {
    const value = Number(properties[key]);
    return Number.isFinite(value) ? value : undefined;
  };

  // A lake has to be wider than the smallest cuttable feature before a stepped
  // basin can mean anything, and a tile over Finland or northern Canada holds
  // thousands that are not. Filtering on the published area first keeps the
  // dissolve off geometry the model could never show.
  const mmPerMeter = config.widthMm / Math.max(1, groundWidthMFor(bounds));
  const minimumAreaKm2 = ((config.minimumFeatureMm * 2 / mmPerMeter) / 1000) ** 2;

  // One lake spans many tiles, so its pieces are gathered by id and unioned.
  const consumeGeometry = createFeatureBudget();
  const byLake = new Map<number, { properties: Record<string, unknown>; polygons: Polygon2D[] }>();
  await mapTiles(window.tiles, async (tile, signal) => {
    const response = await lakeArchive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return;
    const vectorTile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
    for (const layer of Object.values(vectorTile.layers)) {
      for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
        if (featureIndex % 64 === 0) await yieldForCancellation(signal);
        const feature = layer.feature(featureIndex);
        if (feature.type !== 3) continue;
        const properties = feature.properties as Record<string, unknown>;
        const hylakId = numberProperty(properties, "hylak_id");
        if (hylakId === undefined) continue;
        const areaKm2 = numberProperty(properties, "area_km2");
        if (areaKm2 !== undefined && areaKm2 < minimumAreaKm2) continue;
        const entry = byLake.get(hylakId) ?? { properties, polygons: [] };
        const geometry = feature.loadGeometry();
        consumeGeometry(geometry, true);
        classifyRings(geometry).forEach((polygon) => {
          const [outer, ...holes] = polygon;
          if (!outer) return;
          entry.polygons.push({
            outer: outer.map((point) => projectPoint(tile, feature.extent, point)),
            holes: holes.map((ring) => ring.map((point) => projectPoint(tile, feature.extent, point))),
          });
        });
        byLake.set(hylakId, entry);
      }
    }
  }, signal);

  const halfWidth = config.widthMm / 2;
  const halfHeight = config.heightMm / 2;
  const areas: WaterAreaV1[] = [];
  for (const [hylakId, entry] of byLake) {
    await yieldForCancellation(signal);
    for (const [index, polygon] of dissolveWaterAreas(entry.polygons, config.minimumFeatureMm).entries()) {
      const name = typeof entry.properties.name === "string" && entry.properties.name.trim() ? entry.properties.name.trim() : undefined;
      areas.push({
        id: `lake-${hylakId}-${index}`,
        kind: "lake",
        polygon,
        hylakId,
        ...(name ? { name } : {}),
        maxDepthM: numberProperty(entry.properties, "dmax_m"),
        meanDepthM: numberProperty(entry.properties, "davg_m"),
        lmaxM: numberProperty(entry.properties, "lmax_m"),
        surfaceElevationM: numberProperty(entry.properties, "elev_m"),
        // A lake reaching past the crop is only partly in view, so the cells
        // the carve can see are not a fair sample of the basin and the shape
        // exponent must not be fitted to them.
        clipped: polygon.outer.some((point) => Math.abs(point.x) > halfWidth || Math.abs(point.y) > halfHeight),
      });
    }
  }
  return areas;
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
    return { fallback: false, source: { ...fixture, sourceKind: "real", datasetVersion: "topostack-browser-e2e-v1", vectorStatus: "available" } };
  }
  const zoom = dataZoom(config.location.zoom);
  const userSignal = signal;
  const operation = new AbortController();
  signal = userSignal ? AbortSignal.any([userSignal, operation.signal]) : operation.signal;
  try {
    // Ocean polygons are how geometry separates bathymetry from land relief,
    // so depth modeling needs vectors even when shoreline scoring is hidden.
    const { lakes: usesWaterDepth, vectors: vectorRequested, water: usesWaterAreas } = sourceRequirements(config);
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
      ]);
    } catch (error) {
      if (userSignal?.aborted) throw error;
      // Elevation is the one input fabrication cannot do without. Keep the
      // editor usable with sample terrain, but say why real data is missing.
      onStage?.("preparing");
      const source = createSyntheticSource({ ...config, location: { ...config.location, bounds } });
      return {
        source: { ...source, vectorStatus: vectorRequested ? "unavailable" : "not-requested", lakeDataStatus: usesWaterDepth ? "unavailable" : "not-requested" },
        fallback: true,
        fallbackReason: errorMessage(error, "The terrain service could not be reached."),
      };
    }
    signal.throwIfAborted();
    onStage?.("preparing");
    const [{ elevation, elevationRepairCount, imagerySources, datasetVersion, terrainAttribution, terrainSourceUnavailable, terrainSelection }, vector, lakes] = loaded;
    const base: SourceBundleV1 = { schemaVersion: 1, elevation, elevationRepairCount, terrainSourceUnavailable, terrainSelection, markings: vector.markings, waterPatternAreas: [...vector.ocean, ...vector.inland], inlandWaterAreas: vector.inland, vectorStatus: vector.status, lakeDataStatus: lakes.status, datasetVersion, sourceKind: "real", bounds, imagerySources, resolutionM: groundWidthMFor(bounds) / elevation.width, attribution: [...MAP_DATA_ATTRIBUTION, ...terrainAttribution] };
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
