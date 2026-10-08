import { loadProviderOutlines, resolveLakeOutlines } from "$lib/domain/lake-outlines";
import { mapTiles } from "$lib/domain/tile-requests";
import { apiBase } from "$lib/domain/api-base";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { groundWidthMFor, type GeoBounds, type Polygon2D, type ProjectConfigV1, type WaterAreaV1 } from "@topostack/core";
import { createArchive } from "$lib/domain/archive";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { archiveTileWindow } from "$lib/domain/tile-math";
import { dissolveWaterAreas } from "$lib/domain/vector-cleanup";
import { projectedPolygons } from "$lib/domain/vector-loader";

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
  const { window, projectPoint } = archiveTileWindow(header, bounds, Math.round(requestedZoom), config);
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
        entry.polygons.push(...projectedPolygons(geometry, (point) => projectPoint(tile, feature.extent, point)));
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
