import { signedArea, type AirspaceVolumeV1, type GeoBounds, type Polygon2D, type ProjectConfigV1 } from "@topostack/core";
import { AIRSPACE_VOLUME_MAX_ZOOM, aviationCovers, parseAviationArchiveMetadata, parseAviationProperties, type AviationPropertiesByLayer } from "@topostack/data-contracts/aviation-tiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { apiBase } from "$lib/domain/api-base";
import { createArchive } from "$lib/domain/archive";
import { AVIATION_SOURCES } from "$lib/domain/aviation-provider";
import { createFeatureBudget, yieldForCancellation } from "$lib/domain/feature-budget";
import { mapTiles } from "$lib/domain/tile-requests";
import { archiveTileWindow } from "$lib/domain/tile-math";
import { multiPolygonToAreas } from "$lib/domain/vector-cleanup";
import { projectedPolygons } from "$lib/domain/vector-loader";

/**
 * Airspace sectors as volumes from the `airspace_volumes` and `sua_volumes`
 * layers of `/v1/aviation.pmtiles`, for models that build airspace in three
 * dimensions. Tiles cut every sector, so each sector's pieces are unioned by
 * its `sector` number and clipped to the crop. Altitudes stay as charted;
 * resolving them against the terrain is core's job.
 */

/** Sectors kept per load, largest first; beyond this the load is partial. */
export const MAX_AIRSPACE_VOLUMES = 400;

type VolumeLayer = "airspace_volumes" | "sua_volumes";
type VolumeProperties = AviationPropertiesByLayer[VolumeLayer];

export interface AirspaceVolumeData {
  volumes: AirspaceVolumeV1[];
  status: "available" | "partial" | "not-covered";
  /** NASR cycle of the archive actually read. */
  cycle?: string;
}

/** Which sectors a load reads: Class B, C and D, special use airspace, or both. */
export interface AirspaceVolumeRequest { classes: boolean; specialUse: boolean }

/** @public Wired into the source loader with the airspace stack setting (plan phase 2). */
export async function loadAirspaceVolumes(
  bounds: GeoBounds,
  requestedZoom: number,
  config: Pick<ProjectConfigV1, "widthMm" | "heightMm" | "minimumFeatureMm">,
  request: AirspaceVolumeRequest,
  signal?: AbortSignal,
): Promise<AirspaceVolumeData> {
  signal?.throwIfAborted();
  const layers = new Set<VolumeLayer>([...(request.classes ? ["airspace_volumes" as const] : []), ...(request.specialUse ? ["sua_volumes" as const] : [])]);
  if (!layers.size || !aviationCovers(AVIATION_SOURCES, bounds)) return { volumes: [], status: "not-covered" };
  const archive = createArchive(`${apiBase()}/v1/aviation.pmtiles`, signal);
  const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
  const { nasrCycle } = parseAviationArchiveMetadata(metadata);
  signal?.throwIfAborted();
  // The layers stop at AIRSPACE_VOLUME_MAX_ZOOM; deeper tiles would hold none of them.
  const { window, projectPoint } = archiveTileWindow(header, bounds, Math.min(Math.round(requestedZoom) + 1, AIRSPACE_VOLUME_MAX_ZOOM), config);
  const consumeGeometry = createFeatureBudget();
  const perTile = await mapTiles(window.tiles, async (tile, signal) => {
    const pieces: Array<{ key: string; properties: VolumeProperties; polygons: Polygon2D[] }> = [];
    const response = await archive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return pieces;
    const vectorTile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
    for (const layerName of layers) {
      const layer = vectorTile.layers[layerName];
      if (!layer) continue;
      for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
        if (featureIndex % 64 === 0) await yieldForCancellation(signal);
        const feature = layer.feature(featureIndex);
        if (feature.type !== 3) continue;
        const properties = parseAviationProperties(layerName, feature.properties);
        if (!properties) continue;
        const geometry = feature.loadGeometry();
        consumeGeometry(geometry);
        const polygons = projectedPolygons(geometry, (point) => projectPoint(tile, feature.extent, point));
        if (polygons.length) pieces.push({ key: `${layerName === "airspace_volumes" ? "class" : "sua"}-${properties.sector}`, properties, polygons });
      }
    }
    return pieces;
  }, signal);
  await yieldForCancellation(signal);
  const sectors = new Map<string, { properties: VolumeProperties; polygons: Polygon2D[] }>();
  for (const piece of perTile.flat()) {
    const sector = sectors.get(piece.key);
    if (sector) sector.polygons.push(...piece.polygons);
    else sectors.set(piece.key, { properties: piece.properties, polygons: [...piece.polygons] });
  }
  const crop = cropRectangle(config.widthMm, config.heightMm);
  const volumes = [...sectors].flatMap(([id, { properties, polygons }]): AirspaceVolumeV1[] => {
    const inside = sectorInCrop(polygons, crop, config.minimumFeatureMm);
    return inside.length ? [volume(id, properties, inside)] : [];
  });
  const ranked = volumes
    .map((item) => ({ item, area: item.polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0) }))
    .sort((left, right) => right.area - left.area || left.item.id.localeCompare(right.item.id))
    .map(({ item }) => item);
  return {
    volumes: ranked.slice(0, MAX_AIRSPACE_VOLUMES),
    status: ranked.length > MAX_AIRSPACE_VOLUMES ? "partial" : "available",
    cycle: nasrCycle,
  };
}

function cropRectangle(widthMm: number, heightMm: number): MultiPolygon {
  const x = widthMm / 2;
  const y = heightMm / 2;
  return [[[[-x, -y], [x, -y], [x, y], [-x, y], [-x, -y]]]];
}

const toMultiPolygon = (polygons: Polygon2D[]): MultiPolygon => polygons.map((polygon) =>
  [polygon.outer, ...polygon.holes].map((ring) => ring.map((point) => [point.x, point.y] as Pair)));

/** One sector's tile pieces unioned and cut to the crop; the buffers tiles share overlap exactly. */
function sectorInCrop(polygons: Polygon2D[], crop: MultiPolygon, minimumFeatureMm: number): Polygon2D[] {
  const pieces = toMultiPolygon(polygons);
  try {
    return multiPolygonToAreas(polygonClipping.intersection(polygonClipping.union(pieces[0]!, ...pieces.slice(1)), crop), minimumFeatureMm);
  } catch {
    // polygon-clipping can refuse near-degenerate input; cut the pieces one by one instead of losing the sector.
    return pieces.flatMap((piece) => {
      try {
        return multiPolygonToAreas(polygonClipping.intersection([piece], crop), minimumFeatureMm);
      } catch {
        return [];
      }
    });
  }
}

function volume(id: string, properties: VolumeProperties, polygons: Polygon2D[]): AirspaceVolumeV1 {
  const special = "kind" in properties;
  return {
    id,
    aviationClass: special ? "special-use" : properties.class === "B" ? "class-b" : properties.class === "C" ? "class-c" : "class-d",
    ...(special ? { specialUseKind: properties.kind } : {}),
    name: properties.name,
    floor: properties.floorRef === "sfc" ? { ref: "sfc", ft: 0 } : { ref: properties.floorRef, ft: properties.floorFt },
    ceiling: properties.ceilingRef === "unlimited" ? { ref: "unlimited" } : { ref: properties.ceilingRef, ft: properties.ceilingFt! },
    ...(properties.ceilingBelow ? { ceilingBelow: true } : {}),
    ...(special && properties.exclusion ? { exclusion: true } : {}),
    polygons,
  };
}

function polygonArea(polygon: Polygon2D): number {
  return Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
}
