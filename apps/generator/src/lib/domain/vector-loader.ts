import { mapTiles } from "$lib/domain/tile-requests";
import { apiBase } from "$lib/domain/api-base";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { buildingMarkings, readBuildingFragments, type BuildingFragment } from "$lib/domain/building-outlines";
import { classifyRail, railContextTiles, stationPassages, type RailContext } from "$lib/domain/covered-rail";
import { boundsOverlap, clipPolyline, cropBoundary, preparePolygons, groundWidthMFor, isRailClass, buildingOutlinesEnabled, ringBounds, sourceRequirements, type GeoBounds, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1, type TransportationClass } from "@topostack/core";
import { createArchive } from "$lib/domain/archive";
import { classifyRings, VectorTile, type VectorTileFeature, type VectorTileLayer } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { archiveTileWindow, type DataTile } from "$lib/domain/tile-math";
import { cleanBoundaryMarkings, cleanWaterwayMarkings, clipVectorTileLine, dissolveTilePolygons, limitVectorMarkingGroups, MAX_VECTOR_MARKINGS, shorelineMarkings, stitchTransportationMarkings } from "$lib/domain/vector-cleanup";

const RAW_VECTOR_MARKING_BUDGET_MULTIPLIER = 4;
const MAJOR_ROAD_DETAILS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const LOCAL_ROAD_DETAILS = new Set(["tertiary", "tertiary_link", "residential", "service", "unclassified", "road", "raceway", "driveway", "parking_aisle", "alley", "drive-through", "emergency_access"]);
const TRAIL_DETAILS = new Set(["pedestrian", "track", "path", "cycleway", "bridleway", "steps", "corridor", "sidewalk", "crossing"]);
const EXCLUDED_TRANSPORT_KINDS = new Set(["aerialway", "ferry", "pier", "aeroway"]);
/** Letters the engraving fonts can draw; names in other scripts fall back to a romanized name. */
const ENGRAVABLE_SCRIPT = /[\p{Script=Latin}\p{Script=Cyrillic}]/u;
const ROMANIZED_NAME_KEYS = ["name:en", "name:ja-Latn", "name:ja_rm", "name:zh-Latn-pinyin", "name:ko-Latn", "int_name"] as const;

export function classifyTransportation(properties: Record<string, unknown>): TransportationClass | "rail-tunnel" | undefined {
  const kind = typeof properties.kind === "string" ? properties.kind : "";
  const detail = typeof properties.kind_detail === "string" ? properties.kind_detail : "";
  if (EXCLUDED_TRANSPORT_KINDS.has(kind)) return undefined;
  if (kind === "rail") return classifyRail(properties);
  if (kind === "path" || TRAIL_DETAILS.has(detail)) return "trail";
  if (kind === "highway" || kind === "major_road" || MAJOR_ROAD_DETAILS.has(detail)) return "major-road";
  if (kind === "minor_road" || LOCAL_ROAD_DETAILS.has(detail)) return "local-road";
  return undefined;
}

export function transportationLabel(properties: Record<string, unknown>): string | undefined {
  const text = (key: string) => {
    const value = properties[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const name = text("name");
  if (name && !ENGRAVABLE_SCRIPT.test(name)) {
    // 東海道本線 has no glyphs to engrave; "Tokaido Main Line" does.
    for (const key of ROMANIZED_NAME_KEYS) {
      const romanized = text(key);
      if (romanized && ENGRAVABLE_SCRIPT.test(romanized)) return romanized;
    }
  }
  return name ?? text("ref") ?? text("shield_text");
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
  railContextIncomplete?: boolean;
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
  const usesBuildings = buildingOutlinesEnabled(config);
  const crop = { minX: -config.widthMm / 2, maxX: config.widthMm / 2, minY: -config.heightMm / 2, maxY: config.heightMm / 2 };
  // Share cleanup headroom across the selection. Fixed per-tile/category
  // quotas can discard a dense tile while empty neighbors leave room unused.
  let rawMarkingCount = 0;
  let truncated = false;
  type TileVectors = { rail: RailContext; markings: MarkingFeature[]; waterPolygons: Polygon2D[]; oceanPolygons: Polygon2D[]; buildings?: { layer: VectorTileLayer; tile: DataTile } };
  const consumeGeometry = createFeatureBudget();
  // Auxiliary tunnel/station geometry must not exhaust the budget for requested map detail.
  const consumeContext = createFeatureBudget();
  let contextComplete = true;
  function keepContext(geometry: Point2D[][]): boolean {
    if (!contextComplete) return false;
    try { consumeContext(geometry); } catch { contextComplete = false; }
    return contextComplete;
  }
  let hasVisibleTunnel = false;
  let railCrop: ReturnType<typeof preparePolygons> | undefined;
  // A margin keeps styled road caps outside the finished piece.
  const width = config.widthMm + 8;
  const height = config.heightMm + 8;
  function addCropped(marking: MarkingFeature, output: MarkingFeature[]): void {
    const points = marking.points;
    const unit = points.map(point => ({ x: point.x / width + 0.5, y: point.y / height + 0.5 }));
    clipVectorTileLine(unit, 1).forEach((line, index) => {
      if (rawMarkingCount >= MAX_VECTOR_MARKINGS * RAW_VECTOR_MARKING_BUDGET_MULTIPLIER) { truncated = true; return; }
      rawMarkingCount++;
      output.push({ ...marking, id: `${marking.id}-${index}`, points: line.map(point => ({ x: (point.x - 0.5) * width, y: (point.y - 0.5) * height })) });
    });
  }

  async function readTile(tile: DataTile, signal: AbortSignal, contextOnly = false): Promise<TileVectors> {
    const markings: MarkingFeature[] = [];
    const waterPolygons: Polygon2D[] = [];
    const oceanPolygons: Polygon2D[] = [];
    let buildings: TileVectors["buildings"];
    const rail: RailContext = { stations: [], surface: [], tunnels: [] };
    const response = await vectorArchive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return { rail, markings, waterPolygons, oceanPolygons, buildings };
    const vectorTile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
    for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
      const lowered = layerName.toLowerCase();
      const isRoad = lowered.includes("road") || lowered.includes("transportation");
      const isWater = lowered === "water" || lowered.includes("waterway");
      const isBoundary = lowered === "boundaries" || lowered.includes("boundary");
      if (!contextOnly && usesBuildings && lowered === "buildings") { buildings = { tile, layer }; continue; }
      const isPoi = config.showRail && lowered === "pois";
      if (contextOnly && !isRoad && !isPoi) continue;
      if (!isRoad && !isWater && !isBoundary && !isPoi) continue;
      for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
        if (featureIndex % 64 === 0) await yieldForCancellation(signal);
        const feature = layer.feature(featureIndex);
        const properties = feature.properties as Record<string, unknown>;
        if (isPoi) {
          if (contextComplete && feature.type === 1 && (properties.kind === "station" || properties.kind === "halt")) {
            const geometry = feature.loadGeometry();
            if (!keepContext(geometry)) continue;
            for (const points of geometry) for (const point of points) rail.stations.push(projectPoint(tile, feature.extent, point));
          }
          continue;
        }
        if (contextOnly && properties.kind !== "rail") continue;
        if (feature.type !== 2 && !(isWater && feature.type === 3)) continue;
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
        let tunnelCandidate = false;
        if (isBoundary) {
          if (!config.showBoundaries || !isStateProvinceBoundary(properties)) continue;
          kind = "boundary";
        } else if (isRoad) {
          const classified = classifyTransportation(properties);
          if (!classified) continue;
          tunnelCandidate = classified === "rail-tunnel";
          transportationClass = classified === "rail-tunnel" ? "covered-rail" : classified;
          kind = transportationClass === "trail" ? "trail" : "road";
          if (transportationClass === "trail" ? !config.showTrails : isRailClass(transportationClass) ? !config.showRail : !config.showRoads) continue;
        } else {
          if (!config.showWater) continue;
          kind = "water";
        }
        // Retain names so enabling labels after generation needs no reload.
        const label = isRoad ? transportationLabel(properties) : undefined;
        const auxiliary = contextOnly || tunnelCandidate;
        if (auxiliary && !contextComplete && (contextOnly || hasVisibleTunnel)) continue;
        const geometry = feature.loadGeometry();
        const hasEvidenceBudget = !auxiliary || keepContext(geometry);
        if (tunnelCandidate && !contextOnly && !hasVisibleTunnel) {
          hasVisibleTunnel = geometry.some(line => {
            const box = ringBounds(line);
            const min = projectPoint(tile, feature.extent, { x: box.minX, y: box.minY });
            const max = projectPoint(tile, feature.extent, { x: box.maxX, y: box.maxY });
            if (!boundsOverlap(crop, { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y })) return false;
            if (!hasEvidenceBudget) return true;
            railCrop ??= preparePolygons([{ outer: cropBoundary(config), holes: [] }]);
            return clipVectorTileLine(line, feature.extent).some(part =>
              clipPolyline(part.map(point => projectPoint(tile, feature.extent, point)), railCrop!).length > 0);
          });
        }
        if (!hasEvidenceBudget) continue;
        if (!auxiliary) consumeGeometry(geometry);
        geometry.forEach((line, lineIndex) => {
          const project = (point: Point2D) => projectPoint(tile, feature.extent, point);
          if (transportationClass === "rail") {
            // Only source vertices supply evidence of a rail connection.
            rail.surface.push({ label, points: line.map(project) });
          }
          if (contextOnly && !tunnelCandidate) return;
          clipVectorTileLine(line, feature.extent).forEach((clippedLine, clippedIndex) => {
            const id = [tile.z, tile.worldX, tile.y, layerName, feature.id ?? featureIndex, lineIndex, clippedIndex].join("-");
            const marking: MarkingFeature = {
              id, kind, operation: kind === "water" ? "score" : "engrave",
              ...(transportationClass ? { transportationClass } : {}), ...(label ? { label } : {}),
              points: clippedLine.map(project),
            };
            if (tunnelCandidate) { rail.tunnels.push(marking); return; }
            addCropped(marking, markings);
          });
        });
      }
    }
    return { rail, markings, waterPolygons, oceanPolygons, buildings };
  }
  const perTile = await mapTiles(window.tiles, (tile, signal) => readTile(tile, signal), signal);
  if (hasVisibleTunnel && contextComplete) {
    const context = railContextTiles(window, bounds);
    contextComplete = context.complete;
    const selected = new Set(window.tiles.map(tile => `${tile.worldX}/${tile.y}`));
    const adjacent = context.tiles.filter(tile => !selected.has(`${tile.worldX}/${tile.y}`));
    const neighbors = await mapTiles(adjacent, async (tile, signal) => {
      if (!contextComplete) return;
      try { return await readTile(tile, signal, true); }
      catch (error) {
        if (signal.aborted) throw error;
        contextComplete = false;
      }
    }, signal);
    for (const tile of neighbors) if (tile) perTile.push(tile);
  }
  await yieldForCancellation(signal);
  const rawMarkings = perTile.flatMap((tile) => tile.markings);
  const passages = hasVisibleTunnel && contextComplete ? stationPassages(perTile.map(tile => tile.rail), config.widthMm / groundWidthMFor(bounds)) : [];
  for (const passage of passages) {
    addCropped(passage, rawMarkings);
  }
  const boundaries = cleanBoundaryMarkings(rawMarkings.filter((marking) => marking.kind === "boundary"), config.minimumFeatureMm);
  const transportation = stitchTransportationMarkings(rawMarkings.filter((marking) => marking.kind === "road" || marking.kind === "trail"));
  const roads = transportation.filter((marking) => marking.kind === "road" && !isRailClass(marking.transportationClass));
  const rails = transportation.filter((marking) => isRailClass(marking.transportationClass));
  const trails = transportation.filter((marking) => marking.kind === "trail");
  const waterways = cleanWaterwayMarkings(rawMarkings.filter((marking) => marking.kind === "water"), config.minimumFeatureMm);
  const inland = dissolveTilePolygons(perTile.flatMap((tile) => tile.waterPolygons), config.minimumFeatureMm);
  const ocean = dissolveTilePolygons(perTile.flatMap((tile) => tile.oceanPolygons), config.minimumFeatureMm);
  const shorelines = config.showWater ? shorelineMarkings([...ocean, ...inland]) : [];
  // Decode footprints last so a dense city cannot consume the point/ring budget
  // for surface rail, streets or water already requested on the same map.
  const fragments: BuildingFragment[] = [];
  for (const { buildings } of perTile) {
    if (!buildings) continue;
    const { layer, tile } = buildings;
    const complete = await readBuildingFragments(layer, tile, (extent, p) => projectPoint(tile, extent, p), config, consumeGeometry, fragments, signal);
    if (!complete) { truncated = true; break; }
  }
  const buildings = await buildingMarkings(fragments, config, signal);
  const limited = limitVectorMarkingGroups([boundaries, roads, rails, trails, shorelines, waterways, buildings]);
  return {
    markings: limited.markings,
    inland,
    ocean,
    truncated: limited.truncated || truncated,
    ...(hasVisibleTunnel && !contextComplete ? { railContextIncomplete: true } : {}),
  };
}
