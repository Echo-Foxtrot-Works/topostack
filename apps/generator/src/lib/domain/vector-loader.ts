import { mapTiles } from "$lib/domain/tile-requests";
import { apiBase } from "$lib/domain/api-base";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { sourceRequirements, type GeoBounds, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1, type TransportationClass } from "@topostack/core";
import { createArchive } from "$lib/domain/archive";
import { classifyRings, VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { archiveTileWindow } from "$lib/domain/tile-math";
import { cleanBoundaryMarkings, cleanWaterwayMarkings, clipVectorTileLine, dissolveWaterAreas, limitVectorMarkingGroups, MAX_VECTOR_MARKINGS, shorelineMarkings, stitchTransportationMarkings } from "$lib/domain/vector-cleanup";

const RAW_VECTOR_MARKING_BUDGET_MULTIPLIER = 4;
const MAJOR_ROAD_DETAILS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const LOCAL_ROAD_DETAILS = new Set(["tertiary", "tertiary_link", "residential", "service", "unclassified", "road", "raceway", "driveway", "parking_aisle", "alley", "drive-through", "emergency_access"]);
const TRAIL_DETAILS = new Set(["pedestrian", "track", "path", "cycleway", "bridleway", "steps", "corridor", "sidewalk", "crossing"]);
const EXCLUDED_TRANSPORT_KINDS = new Set(["rail", "aerialway", "ferry", "pier", "aeroway"]);

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

export interface VectorData {
  markings: MarkingFeature[];
  /** Dissolved inland water, kept so lakes without depth data still read as water. */
  inland: Polygon2D[];
  /** Dissolved ocean, whose depth the DEM already carries. */
  ocean: Polygon2D[];
  /** True when enabled linework exceeded the bounded decoding/export budget. */
  truncated: boolean;
}

/** A vector-tile polygon feature's rings, grouped into polygons and projected. */
export function projectedPolygons(geometry: ReturnType<VectorTileFeature["loadGeometry"]>, project: (point: Point2D) => Point2D): Polygon2D[] {
  const polygons: Polygon2D[] = [];
  for (const [outer, ...holes] of classifyRings(geometry)) {
    if (outer) polygons.push({ outer: outer.map(project), holes: holes.map((ring) => ring.map(project)) });
  }
  return polygons;
}

export async function loadVectorMarkings(bounds: GeoBounds, requestedZoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<VectorData> {
  signal?.throwIfAborted();
  const vectorArchive = createArchive(`${apiBase()}/v1/osm.pmtiles`, signal);
  const header = await vectorArchive.getHeader();
  signal?.throwIfAborted();
  const { window, projectPoint } = archiveTileWindow(header, bounds, Math.round(requestedZoom) + 1, config);
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
          (isOcean ? oceanPolygons : waterPolygons).push(...projectedPolygons(geometry, (point) => projectPoint(tile, feature.extent, point)));
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
