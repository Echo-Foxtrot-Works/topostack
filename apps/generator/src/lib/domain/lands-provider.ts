import rawLandsSources from "../../../../../scripts/data/public-lands-sources.json";
import type { GeoBounds, LandAreaV1, LandClass, LandsSource, LandsStatus, Polygon2D, ProjectConfigV1, SourceAttribution } from "@topostack/core";
import { LANDS_LAYER, landsCovers, parseLandProperties, parseLandsArchiveMetadata, validateLandsSources } from "@topostack/data-contracts/land-tiles";
import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { apiBase } from "$lib/domain/api-base";
import { cropRectangle, piecesInCrop, polygonArea } from "$lib/domain/area-pieces";
import { createArchive } from "$lib/domain/archive";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { mapTiles } from "$lib/domain/tile-requests";
import { archiveTileWindow } from "$lib/domain/tile-math";
import { projectedPolygons } from "$lib/domain/vector-loader";

/**
 * Public land units for paint stencils and engraved boundaries: from
 * `/v1/lands.pmtiles` (PAD-US) inside its coverage, and outside it from the
 * protected areas in the OpenStreetMap basemap, where they are mapped. Tiles
 * cut every unit, so each unit's pieces are unioned by its id and clipped to
 * the crop. Which class paints where two overlap is core's job.
 */

export const LANDS_SOURCES = validateLandsSources(rawLandsSources);

/** Units kept per load, largest first; beyond this the load is partial. */
export const MAX_LAND_UNITS = 600;

export interface LandAreaData {
  areas: LandAreaV1[];
  status: LandsStatus;
  /** Where the loaded units came from: PAD-US or CPCAD inside the archive's coverage, OpenStreetMap outside it. */
  sources?: LandsSource[];
  /** PAD-US version of the archive actually read. */
  version?: string;
  attribution: SourceAttribution[];
}

/** Credit for each archive source a load actually used. */
function landsAttribution(sources: LandsSource[], version: string): SourceAttribution[] {
  return sources.flatMap((source): SourceAttribution[] => {
    if (source === "padus") return [{ name: `USGS Protected Areas Database of the United States (PAD-US) ${version}`, url: LANDS_SOURCES.url, license: LANDS_SOURCES.license }];
    if (source === "cpcad" && LANDS_SOURCES.canada) return [{ name: LANDS_SOURCES.canada.name, url: LANDS_SOURCES.canada.url, license: LANDS_SOURCES.canada.license }];
    return [];
  });
}

/** The sources of the units loaded, PAD-US first. */
const sourcesOf = (areas: LandAreaV1[]): LandsSource[] => (["padus", "cpcad"] as const).filter((source) => areas.some((area) => (area.source ?? "padus") === source));

/**
 * The land classes OpenStreetMap can stand in for outside PAD-US, by the
 * Protomaps `landuse` kind. OSM gives these polygons no names or managers, so
 * the rest of the classes (forests as public land, BLM, refuges) have no
 * counterpart, and the units are never labelled.
 */
const OSM_LAND_KINDS: Readonly<Record<string, LandClass>> = {
  national_park: "national-park",
  nature_reserve: "preserve",
  protected_area: "preserve",
  military: "military",
};

const BUDGET_EXCEEDED = /safe complexity limit/;

interface UnitPiece { unit: string; landClass: LandClass; name?: string; source?: LandsSource }

export async function loadLandAreas(
  bounds: GeoBounds,
  requestedZoom: number,
  config: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "minimumFeatureMm">,
  classes: readonly LandClass[],
  signal?: AbortSignal,
): Promise<LandAreaData> {
  signal?.throwIfAborted();
  const wanted = new Set<string>(classes);
  if (!wanted.size) return { areas: [], status: "not-covered", attribution: [] };
  if (landsCovers(LANDS_SOURCES, bounds)) {
    let version = "";
    const result = await loadUnits(`${apiBase()}/v1/lands.pmtiles`, LANDS_LAYER, bounds, requestedZoom, config, (metadata) => { version = parseLandsArchiveMetadata(metadata).padusVersion; }, (feature) => {
      if (!wanted.has(String(feature.properties.class))) return undefined;
      const properties = parseLandProperties(feature.properties);
      return properties ? { unit: properties.unit, landClass: properties.class, ...(properties.name ? { name: properties.name } : {}), ...(properties.source ? { source: properties.source } : {}) } : undefined;
    }, signal);
    const sources = sourcesOf(result.areas);
    return { ...result, sources, version, attribution: landsAttribution(sources, version) };
  }
  // Outside PAD-US, the basemap's protected areas where they are mapped; OSM is credited with every map already.
  const osmClasses = Object.values(OSM_LAND_KINDS).filter((landClass) => wanted.has(landClass));
  if (!osmClasses.length) return { areas: [], status: "not-covered", attribution: [] };
  const result = await loadUnits(`${apiBase()}/v1/osm.pmtiles`, "landuse", bounds, requestedZoom, config, () => {}, (feature, featureIndex, tileKey) => {
    const landClass = OSM_LAND_KINDS[String(feature.properties.kind)];
    if (!landClass || !wanted.has(landClass)) return undefined;
    // A feature id joins one area's tile pieces; without one, each tile's piece stands alone.
    return { unit: `osm:${landClass}:${feature.id ?? `${tileKey}-${featureIndex}`}`, landClass, source: "openstreetmap" };
  }, signal);
  return result.areas.length || result.status === "partial" ? { ...result, sources: ["openstreetmap"], attribution: [] } : { areas: [], status: "not-covered", attribution: [] };
}

/** Units from one archive layer: each kept feature's tile pieces joined by unit, cut to the crop, largest first. */
async function loadUnits(
  url: string,
  layerName: string,
  bounds: GeoBounds,
  requestedZoom: number,
  config: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "minimumFeatureMm">,
  readMetadata: (metadata: unknown) => void,
  classify: (feature: VectorTileFeature, featureIndex: number, tileKey: string) => UnitPiece | undefined,
  signal?: AbortSignal,
): Promise<{ areas: LandAreaV1[]; status: "available" | "partial" }> {
  const archive = createArchive(url, signal);
  const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
  readMetadata(metadata);
  signal?.throwIfAborted();
  const { window, projectPoint } = archiveTileWindow(header, bounds, Math.min(Math.round(requestedZoom) + 1, header.maxZoom), config);
  const consumeGeometry = createFeatureBudget();
  let truncated = false;
  const perTile = await mapTiles(window.tiles, async (tile, signal) => {
    const pieces: Array<{ unit: UnitPiece; polygons: Polygon2D[] }> = [];
    if (truncated) return pieces;
    const response = await archive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return pieces;
    const layer = new VectorTile(new PbfReader(new Uint8Array(response.data))).layers[layerName];
    if (!layer) return pieces;
    for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
      if (featureIndex % 64 === 0) await yieldForCancellation(signal);
      const feature = layer.feature(featureIndex);
      if (feature.type !== 3) continue;
      const unit = classify(feature, featureIndex, `${tile.z}/${tile.x}/${tile.y}`);
      if (!unit) continue;
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
      if (polygons.length) pieces.push({ unit, polygons });
    }
    return pieces;
  }, signal);
  await yieldForCancellation(signal);
  const units = new Map<string, { unit: UnitPiece; polygons: Polygon2D[] }>();
  for (const piece of perTile.flat()) {
    const entry = units.get(piece.unit.unit);
    if (entry) entry.polygons.push(...piece.polygons);
    else units.set(piece.unit.unit, { unit: piece.unit, polygons: [...piece.polygons] });
  }
  const crop = cropRectangle(config.widthMm, config.heightMm);
  const areas: LandAreaV1[] = [];
  let unitIndex = 0;
  for (const { unit, polygons } of units.values()) {
    if (unitIndex++ % 16 === 0) await yieldForCancellation(signal);
    const result = piecesInCrop(polygons, crop, config.minimumFeatureMm);
    truncated ||= result.partial;
    if (result.polygons.length) areas.push({ ...unit, polygons: result.polygons });
  }
  signal?.throwIfAborted();
  const ranked = areas
    .map((item) => ({ item, area: item.polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0) }))
    .sort((left, right) => right.area - left.area || left.item.unit.localeCompare(right.item.unit))
    .map(({ item }) => item);
  return { areas: ranked.slice(0, MAX_LAND_UNITS), status: truncated || ranked.length > MAX_LAND_UNITS ? "partial" : "available" };
}
