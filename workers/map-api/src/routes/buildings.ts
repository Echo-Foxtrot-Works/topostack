import { PbfReader } from "pbf";
import packageJson from "../../package.json";
import { readBounded } from "../body";
import { json, upstreamErrorResponse, upstreamFailure, upstreamSignal } from "../http";

const PLANET = "https://tiles.openfreemap.org/planet";
const TILE_TEMPLATE = /^https:\/\/tiles\.openfreemap\.org\/planet\/([a-zA-Z0-9_-]{1,64})\/\{z\}\/\{x\}\/\{y\}\.pbf$/;
export const BUILDING_TILE_PATH = /^\/v1\/buildings\/([a-zA-Z0-9_-]{1,64})\/(13|14)\/(0|[1-9]\d{0,4})\/(0|[1-9]\d{0,4})\.pbf$/;

/** Copy the encoded MVT layer including its field header. Other layers can
 * be much larger than the footprints and the browser never uses them. */
function buildingLayer(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const tile = new PbfReader(bytes);
  while (tile.pos < tile.length) {
    const start = tile.pos;
    const tag = tile.readVarint();
    if (tag !== 26) throw new Error("Invalid vector tile layer.");
    const layer = new PbfReader(tile.readBytes());
    if (tile.pos > tile.length) throw new Error("Incomplete vector tile.");
    while (layer.pos < layer.length) {
      const field = layer.readVarint();
      if (field === 10) {
        if (layer.readString() === "building") return bytes.subarray(start, tile.pos);
        break;
      }
      layer.skip(field);
    }
  }
  return new Uint8Array();
}

/** Resolve the weekly OpenFreeMap release once per crop so every tile comes
 * from the same build. Only neighborhood building layers are exposed. */
export async function buildingResponse(request: Request, path: string): Promise<Response> {
  const tile = BUILDING_TILE_PATH.exec(path);
  if (tile && (Number(tile[3]) >= 2 ** Number(tile[2]) || Number(tile[4]) >= 2 ** Number(tile[2]))) return json({ error: "Invalid building tile coordinates." }, { status: 400 });
  const url = tile ? `${PLANET}/${tile[1]}/${tile[2]}/${tile[3]}/${tile[4]}.pbf` : PLANET;
  const ttl = tile ? 86400 : 3600;
  try {
    const upstream = await fetch(url, {
      headers: { "user-agent": `TopoStack/${packageJson.version} (+https://topostack.app)` },
      redirect: "manual", signal: upstreamSignal(request),
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": ttl, "400-599": 0 } },
    });
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return json({ error: "Building detail unavailable." }, { status: 502 });
    }
    const bytes = await readBounded(upstream.body, tile ? 2_000_000 : 256_000);
    const headers = { "cache-control": `public, max-age=${ttl}` };
    if (tile) {
      if (!/protobuf|mapbox-vector-tile|octet-stream/.test(upstream.headers.get("content-type") ?? "")) return json({ error: "Invalid building tile." }, { status: 502 });
      return new Response(buildingLayer(bytes), { headers: { ...headers, "content-type": "application/vnd.mapbox-vector-tile" } });
    }
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const release = TILE_TEMPLATE.exec(metadata.tiles?.[0])?.[1];
    if (!release || !metadata.vector_layers?.some((layer: { id: string; minzoom: number; maxzoom: number }) =>
      layer.id === "building" && layer.minzoom <= 13 && layer.maxzoom >= 14)) return json({ error: "Invalid building tileset." }, { status: 502 });
    return json({ release }, { headers });
  } catch (error) {
    return upstreamErrorResponse(upstreamFailure(error, "Building detail"));
  }
}
