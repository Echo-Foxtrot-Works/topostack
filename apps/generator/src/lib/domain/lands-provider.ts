import rawLandsSources from "../../../../../scripts/data/public-lands-sources.json";
import type { GeoBounds, LandAreaV1, LandClass, LandsStatus, Polygon2D, ProjectConfigV1, SourceAttribution } from "@topostack/core";
import { LANDS_LAYER, landsCovers, parseLandProperties, parseLandsArchiveMetadata, validateLandsSources, type LandProperties } from "@topostack/data-contracts/land-tiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { apiBase } from "$lib/domain/api-base";
import { cropRectangle, piecesInCrop, polygonArea } from "$lib/domain/area-pieces";
import { createArchive } from "$lib/domain/archive";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { mapTiles } from "$lib/domain/tile-requests";
import { archiveTileWindow } from "$lib/domain/tile-math";
import { projectedPolygons } from "$lib/domain/vector-loader";

/**
 * Public land units from `/v1/lands.pmtiles` for paint stencils: national
 * parks, forests, wilderness, BLM land and the other classes the project
 * paints. Tiles cut every unit, so each unit's pieces are unioned by its
 * `unit` id and clipped to the crop. Which class paints where two overlap is
 * core's job, not the loader's.
 */

export const LANDS_SOURCES = validateLandsSources(rawLandsSources);

/** Units kept per load, largest first; beyond this the load is partial. */
export const MAX_LAND_UNITS = 600;

export interface LandAreaData {
  areas: LandAreaV1[];
  status: LandsStatus;
  /** PAD-US version of the archive actually read. */
  version?: string;
  attribution: SourceAttribution[];
}

function landsAttribution(version: string): SourceAttribution {
  return { name: `USGS Protected Areas Database of the United States (PAD-US) ${version}`, url: LANDS_SOURCES.url, license: LANDS_SOURCES.license };
}

const BUDGET_EXCEEDED = /safe complexity limit/;

export async function loadLandAreas(
  bounds: GeoBounds,
  requestedZoom: number,
  config: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "minimumFeatureMm">,
  classes: readonly LandClass[],
  signal?: AbortSignal,
): Promise<LandAreaData> {
  signal?.throwIfAborted();
  const wanted = new Set<string>(classes);
  if (!wanted.size || !landsCovers(LANDS_SOURCES, bounds)) return { areas: [], status: "not-covered", attribution: [] };
  const archive = createArchive(`${apiBase()}/v1/lands.pmtiles`, signal);
  const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
  const { padusVersion } = parseLandsArchiveMetadata(metadata);
  signal?.throwIfAborted();
  const { window, projectPoint } = archiveTileWindow(header, bounds, Math.min(Math.round(requestedZoom) + 1, header.maxZoom), config);
  const consumeGeometry = createFeatureBudget();
  let truncated = false;
  const perTile = await mapTiles(window.tiles, async (tile, signal) => {
    const pieces: Array<{ properties: LandProperties; polygons: Polygon2D[] }> = [];
    if (truncated) return pieces;
    const response = await archive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return pieces;
    const layer = new VectorTile(new PbfReader(new Uint8Array(response.data))).layers[LANDS_LAYER];
    if (!layer) return pieces;
    for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
      if (featureIndex % 64 === 0) await yieldForCancellation(signal);
      const feature = layer.feature(featureIndex);
      if (feature.type !== 3 || !wanted.has(String(feature.properties.class))) continue;
      const properties = parseLandProperties(feature.properties);
      if (!properties) continue;
      const geometry = feature.loadGeometry();
      try {
        consumeGeometry(geometry, true);
      } catch (error) {
        // Too much land to union safely: keep what fits and report the load as partial, which blocks export.
        if (!(error instanceof Error && BUDGET_EXCEEDED.test(error.message))) throw error;
        truncated = true;
        return pieces;
      }
      const polygons = projectedPolygons(geometry, (point) => projectPoint(tile, feature.extent, point));
      if (polygons.length) pieces.push({ properties, polygons });
    }
    return pieces;
  }, signal);
  await yieldForCancellation(signal);
  const units = new Map<string, { properties: LandProperties; polygons: Polygon2D[] }>();
  for (const piece of perTile.flat()) {
    const unit = units.get(piece.properties.unit);
    if (unit) unit.polygons.push(...piece.polygons);
    else units.set(piece.properties.unit, { properties: piece.properties, polygons: [...piece.polygons] });
  }
  const crop = cropRectangle(config.widthMm, config.heightMm);
  const areas: LandAreaV1[] = [];
  let unitIndex = 0;
  for (const { properties, polygons } of units.values()) {
    if (unitIndex++ % 16 === 0) await yieldForCancellation(signal);
    const result = piecesInCrop(polygons, crop, config.minimumFeatureMm);
    truncated ||= result.partial;
    if (result.polygons.length) areas.push({ unit: properties.unit, landClass: properties.class, ...(properties.name ? { name: properties.name } : {}), polygons: result.polygons });
  }
  signal?.throwIfAborted();
  const ranked = areas
    .map((item) => ({ item, area: item.polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0) }))
    .sort((left, right) => right.area - left.area || left.item.unit.localeCompare(right.item.unit))
    .map(({ item }) => item);
  return {
    areas: ranked.slice(0, MAX_LAND_UNITS),
    status: truncated || ranked.length > MAX_LAND_UNITS ? "partial" : "available",
    version: padusVersion,
    attribution: [landsAttribution(padusVersion)],
  };
}
