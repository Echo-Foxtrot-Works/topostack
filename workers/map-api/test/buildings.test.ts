import { afterEach, expect, it, vi } from "vitest";
import { PbfWriter } from "pbf";
import { env } from "cloudflare:workers";
import worker from "../src/index";

const origin = "https://tiles.openfreemap.org/planet";
const release = "20261115_080022_pt";
const get = (path: string) => worker.fetch(new Request(`https://example.test/v1/buildings${path}`), env, {} as ExecutionContext);
const template = `${origin}/${release}/{z}/{x}/{y}.pbf`;
const layer = (name: string) => {
  const tile = new PbfWriter();
  tile.writeMessage(3, (_, pbf) => { pbf.writeVarintField(15, 2); pbf.writeStringField(1, name); }, null);
  return tile.finish();
};
afterEach(() => vi.unstubAllGlobals());

it("resolves a release and serves only the original encoded building layer", async () => {
  const fetchOrigin = vi.fn(async () => Response.json({ tiles: [template], vector_layers: [{ id: "building", minzoom: 13, maxzoom: 14 }] }));
  vi.stubGlobal("fetch", fetchOrigin);
  expect(await (await get("")).json()).toEqual({ release });
  const buildings = layer("building"), roads = layer("transportation");
  fetchOrigin.mockImplementation(async () => new Response(Uint8Array.from([...roads, ...buildings]), { headers: { "content-type": "application/vnd.mapbox-vector-tile" } }));
  const tilePath = `/${release}/14/14549/6450.pbf`;
  const tile = await get(tilePath);
  expect(tile.status).toBe(200);
  expect(new Uint8Array(await tile.arrayBuffer())).toEqual(buildings);
  expect(fetchOrigin).toHaveBeenLastCalledWith(origin + tilePath, expect.objectContaining({ headers: { "user-agent": expect.stringContaining("TopoStack/") } }));
  fetchOrigin.mockImplementation(async () => new Response(new Uint8Array(roads), { headers: { "content-type": "application/x-protobuf" } }));
  expect((await (await get(tilePath)).arrayBuffer()).byteLength).toBe(0);
});

it("distinguishes unavailable data from an empty building layer", async () => {
  const fetchOrigin = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchOrigin);
  expect((await get(`/${release}/14/0/16384.pbf`)).status).toBe(400);
  expect(fetchOrigin).not.toHaveBeenCalled();
  expect((await get(`/${release}/14/0/0.pbf`)).status).toBe(502);
  fetchOrigin.mockImplementation(async () => Response.json({ tiles: [template.replace("tiles.openfreemap.org", "example.test")] }));
  expect((await get("")).status).toBe(502);
});
