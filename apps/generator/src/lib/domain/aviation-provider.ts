import rawAviationSources from "../../../../../scripts/data/faa-aviation-sources.json";
import { aviationClassEnabled, type AviationClass, type AviationStatus, type AviationSymbol, type AviationSymbolDetail, type GeoBounds, type MarkingFeature, type Point2D, type ProjectConfigV1, type SourceAttribution } from "@topostack/core";
import { aviationCovers, isAviationLayer, parseAviationArchiveMetadata, parseAviationProperties, validateAviationSources, type AviationLayer, type AviationPropertiesByLayer } from "@topostack/data-contracts/aviation-tiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { apiBase } from "$lib/domain/api-base";
import { createArchive } from "$lib/domain/archive";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { mapTiles } from "$lib/domain/tile-requests";
import { archiveTileWindow } from "$lib/domain/tile-math";
import { clipVectorTileLine, joinPaths } from "$lib/domain/vector-cleanup";

/**
 * FAA aviation detail from `/v1/aviation.pmtiles`. Loaded only when a project
 * turns some on, and imported lazily so the studio's first paint never pays
 * for it. Everything leaves here projected to crop-centered millimetres, as
 * `SourceBundleV1.aviationMarkings`; symbols, runway outlines and styling are
 * core's job.
 */

export const AVIATION_SOURCES = validateAviationSources(rawAviationSources);

/** Pieces of line decoded before stitching, and airports and navaids kept, per load. Beyond either the result is partial. */
const MAX_AVIATION_LINES = 6_000;
export const MAX_AVIATION_POINTS = 1_500;
/**
 * Obstacles kept per load, tallest first. A crop can hold ten thousand (tower
 * and wind farms), far more than a model can show, and the sectional itself
 * charts only selected obstacles where they crowd, so beyond this the shortest
 * are left out rather than the load counting as partial.
 */
export const MAX_AVIATION_OBSTACLES = 2_000;
/** Airspace altitude label candidates kept per load, roomiest first; core prints one per area. */
const MAX_AIRSPACE_LABELS = 600;
const FEET_TO_METERS = 0.3048;
/** Obstacles this tall get the larger sectional symbol. */
const TALL_OBSTACLE_FT = 1_000;
/** The sectional's runway thresholds: a hard runway this long fills the airport disc, and one longer than the next is charted as its layout. */
const HARD_SYMBOL_FT = 1_500;
const PATTERN_SYMBOL_FT = 8_069;
/** Lines keep a margin past the crop so dashes and outlines never end short of the edge. */
const LINE_MARGIN_MM = 8;

const airspaceClass = (properties: { class: AviationPropertiesByLayer["airspace"]["class"] }): AviationClass => properties.class === "B" ? "class-b" : properties.class === "C" ? "class-c" : "class-d";
const LAYER_CLASSES: Record<AviationLayer, (properties: never) => AviationClass> = {
  airspace: airspaceClass,
  airspace_labels: airspaceClass,
  sua: () => "special-use",
  runways: () => "runway",
  airports: () => "airport",
  navaids: () => "navaid",
  obstacles: () => "obstacle",
  // Volumes are never engraved; domain/airspace-volumes.ts reads them.
  airspace_volumes: airspaceClass,
  sua_volumes: () => "special-use",
};

const NAVAID_SYMBOLS: Record<AviationPropertiesByLayer["navaids"]["kind"], AviationSymbol> = {
  vor: "vor", vortac: "vortac", "vor-dme": "vor-dme", tacan: "tacan", ndb: "ndb", "ndb-dme": "ndb-dme", dme: "dme",
};

type Airport = AviationPropertiesByLayer["airports"];
type Obstacle = AviationPropertiesByLayer["obstacles"];
type AirspaceLabel = AviationPropertiesByLayer["airspace_labels"];

/**
 * The sectional legend's airport symbol (FAA Chart Users' Guide, VFR Airports).
 * A hard-surfaced runway picks the symbol whoever uses the field: 1,500 ft fills
 * the disc, beyond 8,069 ft the runway layout is drawn. The legend's military
 * and civil-military rows have no filled disc, so there any hard runway of
 * 1,500 ft draws the layout. Otherwise a private field is the R circle, a
 * military one the double circle. Tower status is the chart's blue, which one
 * colour cannot show, so it does not change the shape.
 */
export function airportSymbol(airport: Airport): AviationSymbol | undefined {
  // Private helipads (hospitals, rooftops) are thousands of dots a sectional leaves off.
  if (airport.kind === "heliport") return airport.use === "private" ? undefined : "heliport";
  if (airport.kind === "seaplane-base") return airport.use === "private" ? "airport-private" : "seaplane-base";
  const hard = airport.hardRunwayFt ?? 0;
  if (hard > PATTERN_SYMBOL_FT && airport.runwayPattern) return "airport-pattern";
  if (hard >= HARD_SYMBOL_FT && airport.use === "military" && airport.runwayPattern) return "airport-pattern";
  if (hard >= HARD_SYMBOL_FT) return "airport-hard";
  if (airport.use === "private") return "airport-private";
  if (airport.use === "military") return airport.jointUse ? "airport-joint" : "airport-military";
  return "airport";
}

export function airportDetail(airport: Airport): AviationSymbolDetail {
  // Military fields chart no fuel: "refueling and repair facilities not indicated".
  const fuel = airport.fuel && (airport.use !== "military" || airport.jointUse);
  return {
    ...(fuel ? { fuel: true } : {}),
    ...(airport.beacon ? { beacon: true } : {}),
    ...(airport.towered ? { towered: true } : {}),
    // Meters east and north become x east, y south, as the model draws.
    ...(airport.runwayPattern ? { runways: airport.runwayPattern.map(([x1, y1, x2, y2]) => [{ x: x1, y: 0 - y1 }, { x: x2, y: 0 - y2 }]) } : {}),
  };
}

export function obstacleSymbol(obstacle: Obstacle): AviationSymbol {
  const group = (obstacle.quantity ?? 1) > 1;
  if (obstacle.windTurbine) return group ? "wind-turbine-group" : "wind-turbine";
  const tall = obstacle.aglFt >= TALL_OBSTACLE_FT;
  if (group) return tall ? "obstacle-group-tall" : "obstacle-group";
  return tall ? "obstacle-tall" : "obstacle";
}

export interface AviationData {
  markings: MarkingFeature[];
  status: Exclude<AviationStatus, "not-requested">;
  /** NASR cycle of the archive actually read, for exports and attribution. */
  cycle?: string;
  attribution: SourceAttribution[];
}

function aviationAttribution(cycle: string): SourceAttribution {
  return { name: `FAA Aeronautical Information Services, NASR cycle ${cycle}`, url: AVIATION_SOURCES.url, license: AVIATION_SOURCES.license };
}

/** The layers a project's enabled detail needs. */
function wantedLayers(config: Pick<ProjectConfigV1, "aviation">): Set<AviationLayer> {
  const layers = new Set<AviationLayer>();
  if (aviationClassEnabled("class-b", config)) {
    layers.add("airspace");
    // Read whether or not labels are on, so turning them on needs no reload.
    layers.add("airspace_labels");
  }
  if (aviationClassEnabled("special-use", config)) layers.add("sua");
  if (aviationClassEnabled("runway", config)) layers.add("runways");
  if (aviationClassEnabled("airport", config)) layers.add("airports");
  if (aviationClassEnabled("navaid", config)) layers.add("navaids");
  if (aviationClassEnabled("obstacle", config)) layers.add("obstacles");
  return layers;
}

export async function loadAviationMarkings(bounds: GeoBounds, requestedZoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<AviationData> {
  signal?.throwIfAborted();
  const layers = wantedLayers(config);
  if (!layers.size || !aviationCovers(AVIATION_SOURCES, bounds)) return { markings: [], status: "not-covered", attribution: [] };
  const archive = createArchive(`${apiBase()}/v1/aviation.pmtiles`, signal);
  const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
  const { nasrCycle } = parseAviationArchiveMetadata(metadata);
  signal?.throwIfAborted();
  const { window, projectPoint } = archiveTileWindow(header, bounds, Math.round(requestedZoom) + 1, config);
  const consumeGeometry = createFeatureBudget();
  const lineWidth = config.widthMm + LINE_MARGIN_MM;
  const lineHeight = config.heightMm + LINE_MARGIN_MM;
  let lineCount = 0;
  let truncated = false;
  const perTile = await mapTiles(window.tiles, async (tile, signal) => {
    const lines: MarkingFeature[] = [];
    const points: RankedPoint[] = [];
    const altitudes: MarkingFeature[] = [];
    const response = await archive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return { lines, points, altitudes };
    const vectorTile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
    for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
      if (!isAviationLayer(layerName) || !layers.has(layerName)) continue;
      for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
        if (featureIndex % 64 === 0) await yieldForCancellation(signal);
        const feature = layer.feature(featureIndex);
        const properties = parseAviationProperties(layerName, feature.properties);
        if (!properties) continue;
        const aviationClass = LAYER_CLASSES[layerName](properties as never);
        const geometry = feature.loadGeometry();
        consumeGeometry(geometry);
        if (feature.type === 1 && layerName === "airspace_labels") {
          const anchor = geometry[0]?.[0];
          if (!anchor) continue;
          const point = projectPoint(tile, feature.extent, anchor);
          if (Math.abs(point.x) > config.widthMm / 2 || Math.abs(point.y) > config.heightMm / 2) continue;
          const { area, ceilingFt, floorFt, ceilingBelow, clearanceM } = properties as AirspaceLabel;
          altitudes.push({
            id: `${layerName}-${area}-${Math.round(point.x * 100)}-${Math.round(point.y * 100)}`, kind: "aviation", operation: "engrave", aviationClass, points: [point],
            aviationAltitude: { area: String(area), ceilingFt, ...(floorFt !== undefined ? { floorFt } : {}), ...(ceilingBelow ? { ceilingBelow } : {}), clearanceM },
          });
          continue;
        }
        if (feature.type === 1) {
          const symbol = layerName === "airports" ? airportSymbol(properties as Airport)
            : layerName === "navaids" ? NAVAID_SYMBOLS[(properties as AviationPropertiesByLayer["navaids"]).kind]
            : layerName === "obstacles" ? obstacleSymbol(properties as Obstacle)
            : undefined;
          const anchor = geometry[0]?.[0];
          if (!symbol || !anchor) continue;
          const point = projectPoint(tile, feature.extent, anchor);
          if (Math.abs(point.x) > config.widthMm / 2 || Math.abs(point.y) > config.heightMm / 2) continue;
          const label = "ident" in properties ? properties.ident : undefined;
          // A navaid ident is unique per kind only: an NDB and a VOR-DME on one field can share it.
          const key = layerName === "navaids" ? `${(properties as AviationPropertiesByLayer["navaids"]).kind}-${label}` : label;
          const detail = layerName === "airports" ? airportDetail(properties as Airport)
            : layerName === "obstacles" && (properties as Obstacle).highIntensity ? { highIntensity: true } : {};
          points.push({
            feature: {
              id: `${layerName}-${key ?? `${Math.round(point.x * 100)}-${Math.round(point.y * 100)}`}`, kind: "aviation", operation: "engrave", aviationClass, aviationSymbol: symbol,
              ...(Object.keys(detail).length ? { aviationDetail: detail } : {}), ...(label ? { label } : {}), points: [point],
            },
            heightFt: layerName === "obstacles" ? (properties as Obstacle).aglFt : 0,
          });
          continue;
        }
        if (feature.type !== 2) continue;
        const name = "name" in properties ? properties.name : (properties as AviationPropertiesByLayer["runways"]).runway;
        const widthM = layerName === "runways" ? (properties as AviationPropertiesByLayer["runways"]).widthFt * FEET_TO_METERS : undefined;
        geometry.forEach((line, lineIndex) => clipVectorTileLine(line, feature.extent).forEach((clipped, clippedIndex) => {
          const normalized = clipped.map((point) => {
            const projected = projectPoint(tile, feature.extent, point);
            return { x: projected.x / lineWidth + 0.5, y: projected.y / lineHeight + 0.5 };
          });
          clipVectorTileLine(normalized, 1).forEach((cropped, cropIndex) => {
            if (lineCount >= MAX_AVIATION_LINES) { truncated = true; return; }
            lineCount += 1;
            lines.push({
              id: [layerName, tile.z, tile.worldX, tile.y, feature.id ?? featureIndex, lineIndex, clippedIndex, cropIndex].join("-"),
              kind: "aviation", operation: "engrave", aviationClass, label: name,
              ...(widthM ? { widthM } : {}),
              points: cropped.map((point) => ({ x: (point.x - 0.5) * lineWidth, y: (point.y - 0.5) * lineHeight })),
            });
          });
        }));
      }
    }
    return { lines, points, altitudes };
  }, signal);
  await yieldForCancellation(signal);
  // Tile buffers repeat points near tile edges; one symbol per feature. Core
  // keeps this order when symbols crowd, so the tallest obstacles come first.
  const ranked = [...new Map(perTile.flatMap((tile) => tile.points).map((point) => [point.feature.id, point])).values()]
    .sort((left, right) => pointPriority(left.feature) - pointPriority(right.feature) || right.heightFt - left.heightFt || left.feature.id.localeCompare(right.feature.id))
    .map(({ feature }) => feature);
  const fixed = ranked.filter((point) => point.aviationClass !== "obstacle");
  if (fixed.length > MAX_AVIATION_POINTS) truncated = true;
  const points = [...fixed.slice(0, MAX_AVIATION_POINTS), ...ranked.filter((point) => point.aviationClass === "obstacle").slice(0, MAX_AVIATION_OBSTACLES)];
  // Label places, like obstacles, are a choice among many: the roomiest are kept, and leaving others out is not a partial load.
  const altitudes = [...new Map(perTile.flatMap((tile) => tile.altitudes).map((altitude) => [altitude.id, altitude])).values()]
    .sort((left, right) => right.aviationAltitude!.clearanceM - left.aviationAltitude!.clearanceM || left.id.localeCompare(right.id))
    .slice(0, MAX_AIRSPACE_LABELS);
  const lines = joinPaths(perTile.flatMap((tile) => tile.lines), (line) => `${line.aviationClass}\u0000${line.label ?? ""}`)
    .map(({ feature, points }, index): MarkingFeature => ({
      ...feature, id: `aviation-${feature.aviationClass}-${index}`,
      // A runway is straight; a tile seam must not leave a vertex that stops core drawing its outline.
      points: feature.aviationClass === "runway" ? [points[0]!, points.at(-1)!] : dedupeConsecutive(points),
    }));
  return {
    markings: [...lines, ...points, ...altitudes],
    status: truncated ? "partial" : "available",
    cycle: nasrCycle,
    attribution: [aviationAttribution(nasrCycle)],
  };
}

interface RankedPoint { feature: MarkingFeature; heightFt: number }

/** Airports before navaids before obstacles, so a partial load keeps what matters most. */
function pointPriority(point: MarkingFeature): number {
  return point.aviationClass === "airport" ? 0 : point.aviationClass === "navaid" ? 1 : 2;
}

function dedupeConsecutive(points: Point2D[]): Point2D[] {
  return points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > 1e-9);
}
