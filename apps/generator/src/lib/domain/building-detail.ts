import { VectorTile, type VectorTileLayer } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { GeoBounds, ProjectConfigV1 } from "@topostack/core";
import { apiBase } from "./api-base";
import { networkSignal } from "./network";
import { fittingTileWindow, MAX_DATA_TILES, tilePointProjector, type DataTile } from "./tile-math";
import { mapTiles } from "./tile-requests";

export interface BuildingLevel {
  layers: { tile: DataTile; layer?: VectorTileLayer }[];
  projectPoint: ReturnType<typeof tilePointProjector>;
  zoom: number;
  release?: string;
}

/** Read one complete level from the same weekly snapshot. Only request a
 * second level when the caller needs a smaller engraving and the crop still
 * fits the overall download budget. A missing building layer is valid. */
export async function* buildingDetailLevels(bounds: GeoBounds, config: ProjectConfigV1, signal?: AbortSignal): AsyncGenerator<BuildingLevel> {
  let window = fittingTileWindow(bounds, 14);
  if (window.zoom < 13) return;
  const base = `${apiBase()}/v1/buildings`;
  const metadata = await fetch(base, { signal: networkSignal(signal) });
  if (!metadata.ok) throw new Error("Building detail unavailable.");
  const { release } = await metadata.json();
  if (typeof release !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(release)) throw new Error("Invalid building release.");
  let tilesRead = 0;
  while (tilesRead + window.tiles.length <= MAX_DATA_TILES) {
    const layers = await mapTiles(window.tiles, async (tile, operation) => {
      const response = await fetch(`${base}/${release}/${tile.z}/${tile.x}/${tile.y}.pbf`, { signal: networkSignal(operation) });
      if (!response.ok) throw new Error("Building tile unavailable.");
      const vector = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
      return { tile, layer: vector.layers.building };
    }, signal, 4);
    yield { release, zoom: window.zoom, layers, projectPoint: tilePointProjector(window, config.widthMm, config.heightMm) };
    if (window.zoom === 13) return;
    tilesRead += window.tiles.length;
    window = fittingTileWindow(bounds, 13);
  }
}
