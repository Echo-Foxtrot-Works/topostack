import rawAviationSources from "../../../../../scripts/data/faa-aviation-sources.json";
import { aviationClassEnabled, type AviationClass, type AviationStatus, type AviationSymbol, type GeoBounds, type MarkingFeature, type Point2D, type ProjectConfigV1, type SourceAttribution } from "@topostack/core";
import { aviationCovers, isAviationLayer, parseAviationArchiveMetadata, parseAviationProperties, validateAviationSources, type AviationLayer, type AviationPropertiesByLayer } from "@topostack/data-contracts/aviation-tiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { apiBase } from "$lib/domain/api-base";
import { createArchive } from "$lib/domain/archive";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { mapTiles } from "$lib/domain/tile-requests";
import { fittingTileWindow, tilePointProjector } from "$lib/domain/tile-math";
import { clipVectorTileLine, joinPaths } from "$lib/domain/vector-cleanup";

/**
 * FAA aviation detail from `/v1/aviation.pmtiles`. Loaded only when a project
 * turns some on, and imported lazily so the studio's first paint never pays
 * for it. Everything leaves here projected to crop-centered millimetres, as
 * `SourceBundleV1.aviationMarkings`; symbols, runway outlines and styling are
 * core's job.
 */

export const AVIATION_SOURCES = validateAviationSources(rawAviationSources);

/** Pieces of line decoded before stitching, and points kept, per load. Beyond either the result is partial. */
export const MAX_AVIATION_LINES = 6_000;
export const MAX_AVIATION_POINTS = 1_500;
const FEET_TO_METERS = 0.3048;
/** Obstacles this tall get the larger sectional symbol. */
const TALL_OBSTACLE_FT = 1_000;
/** Lines keep a margin past the crop so dashes and outlines never end short of the edge. */
const LINE_MARGIN_MM = 8;

const LAYER_CLASSES: Record<AviationLayer, (properties: never) => AviationClass> = {
  airspace: (properties: AviationPropertiesByLayer["airspace"]) => properties.class === "B" ? "class-b" : properties.class === "C" ? "class-c" : "class-d",
  sua: () => "special-use",
  runways: () => "runway",
  airports: () => "airport",
  navaids: () => "navaid",
  obstacles: () => "obstacle",
};

const NAVAID_SYMBOLS: Record<AviationPropertiesByLayer["navaids"]["kind"], AviationSymbol> = {
  vor: "vor", vortac: "vortac", "vor-dme": "vor-dme", tacan: "tacan", ndb: "ndb", "ndb-dme": "ndb", dme: "dme",
};

function airportSymbol(airport: AviationPropertiesByLayer["airports"]): AviationSymbol | undefined {
  // Private helipads (hospitals, rooftops) are thousands of dots a sectional leaves off.
  if (airport.kind === "heliport") return airport.use === "private" ? undefined : "heliport";
  if (airport.use === "private") return "airport-private";
  return airport.towered ? "airport-towered" : "airport";
}

export interface AviationData {
  markings: MarkingFeature[];
  status: Exclude<AviationStatus, "not-requested">;
  /** NASR cycle of the archive actually read, for exports and attribution. */
  cycle?: string;
  attribution: SourceAttribution[];
}

export function aviationAttribution(cycle: string): SourceAttribution {
  return { name: `FAA Aeronautical Information Services, NASR cycle ${cycle}`, url: AVIATION_SOURCES.url, license: AVIATION_SOURCES.license };
}

/** The layers a project's enabled detail needs. */
function wantedLayers(config: Pick<ProjectConfigV1, "aviation">): Set<AviationLayer> {
  const layers = new Set<AviationLayer>();
  if (aviationClassEnabled("class-b", config)) layers.add("airspace");
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
  const window = fittingTileWindow(bounds, Math.max(header.minZoom, Math.min(header.maxZoom, Math.round(requestedZoom) + 1)), header.minZoom);
  const projectPoint = tilePointProjector(window, config.widthMm, config.heightMm);
  const consumeGeometry = createFeatureBudget();
  const lineWidth = config.widthMm + LINE_MARGIN_MM;
  const lineHeight = config.heightMm + LINE_MARGIN_MM;
  let lineCount = 0;
  let truncated = false;
  const perTile = await mapTiles(window.tiles, async (tile, signal) => {
    const lines: MarkingFeature[] = [];
    const points: MarkingFeature[] = [];
    const response = await archive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return { lines, points };
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
        if (feature.type === 1) {
          const symbol = layerName === "airports" ? airportSymbol(properties as AviationPropertiesByLayer["airports"])
            : layerName === "navaids" ? NAVAID_SYMBOLS[(properties as AviationPropertiesByLayer["navaids"]).kind]
            : layerName === "obstacles" ? ((properties as AviationPropertiesByLayer["obstacles"]).aglFt >= TALL_OBSTACLE_FT ? "obstacle-tall" : "obstacle")
            : undefined;
          const anchor = geometry[0]?.[0];
          if (!symbol || !anchor) continue;
          const point = projectPoint(tile, feature.extent, anchor);
          if (Math.abs(point.x) > config.widthMm / 2 || Math.abs(point.y) > config.heightMm / 2) continue;
          const label = "ident" in properties ? properties.ident : undefined;
          points.push({ id: `${layerName}-${label ?? `${Math.round(point.x * 100)}-${Math.round(point.y * 100)}`}`, kind: "aviation", operation: "engrave", aviationClass, aviationSymbol: symbol, ...(label ? { label } : {}), points: [point] });
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
    return { lines, points };
  }, signal);
  await yieldForCancellation(signal);
  // Tile buffers repeat points near tile edges; one symbol per feature.
  const points = [...new Map(perTile.flatMap((tile) => tile.points).map((point) => [point.id, point])).values()]
    .sort((left, right) => pointPriority(left) - pointPriority(right) || left.id.localeCompare(right.id));
  if (points.length > MAX_AVIATION_POINTS) truncated = true;
  const lines = joinPaths(perTile.flatMap((tile) => tile.lines), (line) => `${line.aviationClass}\u0000${line.label ?? ""}`)
    .map(({ feature, points }, index): MarkingFeature => ({
      ...feature, id: `aviation-${feature.aviationClass}-${index}`,
      // A runway is straight; a tile seam must not leave a vertex that stops core drawing its outline.
      points: feature.aviationClass === "runway" ? [points[0]!, points.at(-1)!] : dedupeConsecutive(points),
    }));
  return {
    markings: [...lines, ...points.slice(0, MAX_AVIATION_POINTS)],
    status: truncated ? "partial" : "available",
    cycle: nasrCycle,
    attribution: [aviationAttribution(nasrCycle)],
  };
}

/** Airports before navaids before obstacles, so a partial load keeps what matters most. */
function pointPriority(point: MarkingFeature): number {
  return point.aviationClass === "airport" ? 0 : point.aviationClass === "navaid" ? 1 : 2;
}

function dedupeConsecutive(points: Point2D[]): Point2D[] {
  return points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > 1e-9);
}
