import release from "../../../../../scripts/data/lake-outlines-release.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import polygonClipping from "polygon-clipping";
import { DEFAULT_PROJECT, type Polygon2D, type WaterAreaV1 } from "@topostack/core";
import { loadProviderOutlines, resolveLakeOutlines } from "$lib/domain/lake-outlines";
import petersPond from "$lib/domain/fixtures/peters-pond-z12.json";

const box = (lo: number, hi: number): Polygon2D => ({ outer: [{ x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }, { x: lo, y: lo }], holes: [] });
/** A square shore with `perSide` vertices along each side, so more of them traces it in more detail. */
const detailed = (lo: number, hi: number, perSide: number): Polygon2D => {
  const corners = box(lo, hi).outer, outer: Polygon2D["outer"] = [];
  for (let side = 0; side < 4; side += 1) for (let step = 0; step < perSide; step += 1) {
    const a = corners[side]!, b = corners[side + 1]!, t = step / perSide;
    outer.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return { outer: [...outer, outer[0]!], holes: [] };
};
const lake = (id: string, polygon = box(-10, 10)): WaterAreaV1 => ({ id, kind: "lake", polygon });
const provider = (polygon = box(-10, 10)): WaterAreaV1 => ({ ...lake("survey", polygon), outlineSource: "provider", outlineSourceId: "mn-dnr-lakes-v1", surveyId: "123" });
afterEach(() => vi.unstubAllGlobals());

describe("shoreline priority", () => {
  it("keeps surveyed lake outlines without HydroLAKES IDs or depth estimates", () => {
    expect(resolveLakeOutlines([provider()], [], [])).toEqual([provider()]);
    expect(resolveLakeOutlines([], [lake("hydro")], [])).toEqual([lake("hydro")]);
  });
  it("prefers provider geometry and retains HydroLAKES depth metadata without duplicate OSM shores", () => {
    const hydro = { ...lake("hydro"), hylakId: 123, maxDepthM: 40 };
    const result = resolveLakeOutlines([provider(box(-11, 11))], [hydro], [box(-12, 12)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "survey", hylakId: 123, maxDepthM: 40, polygon: box(-11, 11) });
  });
  it("keeps the complete lake when provider coverage is only a bay", () => {
    expect(resolveLakeOutlines([provider(box(-2, 2))], [lake("hydro")], [])).toEqual([lake("hydro")]);
    const result = resolveLakeOutlines([provider(box(-2, 2))], [], [box(-10, 10)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ outlineSource: "osm", polygon: box(-10, 10) });
  });
  it("leaves out map water the clipper cannot compare, and keeps the rest", () => {
    // polygon-clipping throws on some near-degenerate slivers; one must not cost the map its water.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const intersection = vi.spyOn(polygonClipping, "intersection").mockImplementationOnce(() => { throw new Error("Unable to find segment in SweepLine tree."); });
    // The first outline crosses the survey shore, so only the clipper can compare them.
    const result = resolveLakeOutlines([provider()], [], [box(-5, 15), box(20, 40)]);
    expect(result.map((item) => item.id)).toEqual(["survey", "osm-lake-1"]);
    intersection.mockRestore();
  });
  it("decides ponds clear of a lake's shoreline without polygon booleans", () => {
    const survey = provider({ ...box(-100, 100), holes: [box(-20, 20).outer] });
    const inIsland = box(-10, 10), inLake = box(60, 70), outside = box(200, 210);
    const intersection = vi.spyOn(polygonClipping, "intersection");
    const result = resolveLakeOutlines([survey], [], [inIsland, inLake, outside]);
    expect(result.map((item) => item.id)).toEqual(["survey", "osm-lake-0", "osm-lake-2"]);
    // Rebuilding shorelines resolves the result again with the same map water.
    expect(resolveLakeOutlines([], result, [inIsland, inLake, outside])).toEqual(result);
    expect(intersection).not.toHaveBeenCalled();
    intersection.mockRestore();
  });
  it("adds unmatched OSM water and preserves islands without inventing depths", () => {
    const shape = { ...box(20, 40), holes: [box(25, 30).outer] };
    const result = resolveLakeOutlines([provider()], [], [shape]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ outlineSource: "osm", polygon: shape });
    expect(result[1]?.maxDepthM).toBeUndefined();
  });
  it("does not expand a small HydroLAKES basin's estimated depth over a larger provider lake", () => {
    const result = resolveLakeOutlines([provider(box(-20, 20))], [{ ...lake("hydro"), hylakId: 1, maxDepthM: 100 }], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.maxDepthM).toBeUndefined();
    expect(result[0]?.hylakId).toBeUndefined();
  });
  it("carves the map's more detailed shore of a HydroLAKES lake and keeps its depth metadata", () => {
    const hydro = { ...lake("hydro"), hylakId: 7, maxDepthM: 9, meanDepthM: 4, lmaxM: 200, surfaceElevationM: 22, name: "Pond", clipped: false };
    const shore = detailed(-10.5, 9.5, 3);
    const result = resolveLakeOutlines([], [hydro], [shore]);
    expect(result).toEqual([{ ...hydro, polygon: shore }]);
    // Rebuilding shorelines resolves the result again with the same map water,
    // or with a copy of it, as a stored source holds.
    expect(resolveLakeOutlines([], result, [shore])).toEqual(result);
    expect(resolveLakeOutlines([], result, [structuredClone(shore)])).toEqual(result);
    // A map shore no more detailed than HydroLAKES' changes nothing.
    expect(resolveLakeOutlines([], [hydro], [box(-10.5, 9.5)])).toEqual([hydro]);
  });
  it("replaces a survey mask only with a clearly more detailed shore", () => {
    const survey = provider(detailed(-10, 10, 4));
    // 1.25x the mask's vertices along the same shore: not worth uncovering survey cells.
    expect(resolveLakeOutlines([], [survey], [detailed(-10.2, 9.8, 5)])).toEqual([survey]);
    const fine = detailed(-10.2, 9.8, 8);
    expect(resolveLakeOutlines([], [survey], [fine])).toEqual([{ ...survey, polygon: fine }]);
    // The same rule holds between a mask and HydroLAKES, whose depth metadata still joins the survey.
    const hydro = { ...lake("hydro", detailed(-10.2, 9.8, 8)), hylakId: 5, maxDepthM: 12 };
    expect(resolveLakeOutlines([survey], [hydro], [])).toEqual([{ ...survey, hylakId: 5, maxDepthM: 12, polygon: hydro.polygon }]);
    expect(resolveLakeOutlines([survey], [{ ...hydro, polygon: box(-10.2, 9.8) }], [])[0]?.polygon).toBe(survey.polygon);
  });
  it("keeps the HydroLAKES shore when map water is not the same waterbody", () => {
    const hydro = { ...lake("hydro"), hylakId: 7, maxDepthM: 9 };
    // A lake joined to its river in the map: the HydroLAKES lake is only part of it.
    const withRiver = { outer: [{ x: -10, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -10, y: 10 }, { x: -10, y: -10 }], holes: [] };
    expect(resolveLakeOutlines([], [hydro], [withRiver])).toEqual([hydro]);
    // Two HydroLAKES lakes the map draws as one water.
    const west = { ...hydro, id: "west", polygon: box(-10, -1) }, east = { ...hydro, id: "east", hylakId: 8, polygon: box(1, 10) };
    expect(resolveLakeOutlines([], [west, east], [box(-10, 10)])).toEqual([west, east]);
  });
  it("traces Peters Pond (Sandwich, MA) from the map instead of HydroLAKES' straight edges", () => {
    // Production z12 tiles: HydroLAKES draws this 0.5 km² pond with edges up to
    // ~690 m, which a maker reported as the shore's curves turning straight.
    const [lat, lon] = petersPond.location as [number, number];
    const metres = (rings: number[][][]): Polygon2D => {
      const [outer, ...holes] = rings.map((ring) => ring.map(([x, y]) => ({ x: (x! - lon) * 111_320 * Math.cos(lat * Math.PI / 180), y: (lat - y!) * 110_574 })));
      return { outer: outer!, holes };
    };
    const hydro: WaterAreaV1 = { ...lake("lake-1053303-0", metres(petersPond.hydrolakes)), hylakId: 1053303, maxDepthM: 8.4, meanDepthM: 5.2, lmaxM: 234.2, surfaceElevationM: 22 };
    const osm = metres(petersPond.osm);
    const [pond, ...rest] = resolveLakeOutlines([], [hydro], [osm]);
    expect(rest).toEqual([]);
    expect(pond).toEqual({ ...hydro, polygon: osm });
    const longestEdge = (ring: { x: number; y: number }[]) => Math.max(...ring.slice(1).map((p, i) => Math.hypot(p.x - ring[i]!.x, p.y - ring[i]!.y)));
    expect(longestEdge(hydro.polygon.outer)).toBeGreaterThan(600);
    expect(longestEdge(pond!.polygon.outer)).toBeLessThan(300);
  });
  it("does not give each survey basin the whole lake's estimated depth", () => {
    const left = { ...provider(), polygon: { outer: [{ x: -10, y: -10 }, { x: 0, y: -10 }, { x: 0, y: 10 }, { x: -10, y: 10 }, { x: -10, y: -10 }], holes: [] } };
    const right = { ...left, id: "right", polygon: { outer: left.polygon.outer.map((p) => ({ x: -p.x, y: p.y })), holes: [] } };
    const result = resolveLakeOutlines([left, right], [{ ...lake("hydro"), maxDepthM: 100 }], []);
    expect(result).toHaveLength(2);
    expect(result.every((area) => area.maxDepthM === undefined)).toBe(true);
  });
});

describe("provider outline assets", () => {
  const file = "0123456789abcdef01234567.json";
  const bounds = { west: -1, east: 1, south: -1, north: 1 };
  const config = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100, minimumFeatureMm: 0.1 };
  const feature = { bbox: [-0.5, -0.5, 0.5, 0.5], properties: { sourceId: "mn-dnr-lakes-v1", surveyId: "123", name: "Survey lake" }, geometry: { type: "Polygon", coordinates: [[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5],[-0.5,-0.5]], [[-0.1,-0.1],[-0.1,0.1],[0.1,0.1],[0.1,-0.1],[-0.1,-0.1]]] } };
  function mockFetch() {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ schemaVersion: 1, shards: [
      { file, bounds: [-1,-1,1,1] }, { file: "ffffffffffffffffffffffff.json", bounds: [20,20,21,21] },
    ] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ features: [feature] }) });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  it("loads only intersecting shards, projects shores and preserves island holes", async () => {
    const fetch = mockFetch();
    const areas = await loadProviderOutlines("/app", bounds, config);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(`/app/v1/lake-outlines/${release.index.file}`);
    expect(fetch.mock.calls[1]?.[0]).toBe(`/app/v1/lake-outlines/${file}`);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ name: "Survey lake", surveyId: "123", outlineSource: "provider", clipped: false });
    expect(areas[0]?.polygon.holes).toHaveLength(1);
    expect(Math.max(...areas[0]!.polygon.outer.map((p) => p.x))).toBeCloseTo(25);
  });
  it("keeps the real shoreline beyond the crop instead of scoring the crop edge", async () => {
    mockFetch();
    const areas = await loadProviderOutlines("", { west: -0.2, east: 0.2, south: -0.2, north: 0.2 }, config);
    expect(areas[0]?.clipped).toBe(true);
    expect(Math.max(...areas[0]!.polygon.outer.map((p) => p.x))).toBeGreaterThan(config.widthMm / 2);
  });
  it("propagates asset failures and cancellation for retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(loadProviderOutlines("", bounds, config)).rejects.toThrow("could not be loaded");
    mockFetch();
    const controller = new AbortController(); controller.abort();
    await expect(loadProviderOutlines("", bounds, config, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects unsupported assets and excessive request windows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schemaVersion: 2, shards: [] }) }));
    await expect(loadProviderOutlines("", bounds, config)).rejects.toThrow("Unknown");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schemaVersion: 1, shards: Array.from({ length: 65 }, () => ({ bounds: [-1,-1,1,1], file })) }) }));
    await expect(loadProviderOutlines("", bounds, config)).rejects.toThrow("Narrow");
  });
});
