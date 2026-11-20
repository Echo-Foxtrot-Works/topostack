import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, buildProjectPackage } from "@topostack/core";
import { loadTerrain } from "$lib/domain/data-provider";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { MAX_DATA_TILES, TILE_SIZE, worldXToLon, worldYToLat } from "$lib/domain/tile-math";

const terrainOnly = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 200, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false, showBoundaries: false, showElevationLabels: false };

afterEach(() => vi.unstubAllGlobals());

describe("West Point terrain loading", () => {
  it("decodes and repairs native terrain without canvas or image APIs", async () => {
    const zoom = 15, x = 9652, y = 12238;
    const png = readFileSync(new URL(`./fixtures/west-point-z${zoom}.png`, import.meta.url));
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(png, { headers: { "x-topostack-dataset": "west-point-fixture" } }));
    vi.stubGlobal("fetch", fetchMock);
    const blocked = vi.fn(() => { throw new Error("Canvas access blocked by browser privacy settings"); });
    vi.stubGlobal("OffscreenCanvas", blocked);
    vi.stubGlobal("createImageBitmap", blocked);
    const longitude = (tile: number) => tile / 2 ** zoom * 360 - 180;
    const latitude = (tile: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * tile / 2 ** zoom))) * 180 / Math.PI;
    const project = { ...terrainOnly, location: { lat: 41.3915, lon: -73.956, label: "West Point, NY", zoom, bounds: { west: longitude(x), east: longitude(x + 1), north: latitude(y), south: latitude(y + 1) } } };
    const stages: string[] = [];
    const result = await loadTerrain(project, undefined, (stage) => stages.push(stage));
    expect(stages).toEqual(["fetching", "preparing"]);
    expect(result.fallback).toBe(false);
    // The kilometre-deep spikes sit below sea level before repair, so the
    // ocean grid is also asked for; only one base tile is fetched.
    const tileCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/v1/terrain/"));
    expect(tileCalls).toHaveLength(1);
    expect(tileCalls[0]?.[1]?.cache).toBe("no-cache");
    expect(String(tileCalls[0]?.[0])).toContain(`/v1/terrain/${zoom}/${x}/${y}.png`);
    expect(blocked).not.toHaveBeenCalled();
    expect(result.source.elevationRepairCount).toBeGreaterThan(100);
    expect(result.source.elevation.min).toBeGreaterThan(-100);
    expect(result.source.elevation.max).toBeLessThan(450);
    const geometry = generateGeometry(project, result.source);
    expect(geometry.minElevationM).toBeGreaterThan(-100);
    expect(geometry.maxElevationM - geometry.minElevationM).toBeLessThan(550);
    expect(geometry.warnings).toContainEqual(expect.objectContaining({ code: "ELEVATION_REPAIRED" }));
    const manifest = buildProjectPackage(geometry, project).files.find((file) => file.filename.endsWith("-project.json"));
    expect(JSON.parse(await manifest!.blob.text()).result.warnings).toContainEqual(expect.objectContaining({ code: "ELEVATION_REPAIRED" }));
  });

  it("requires explicit dataset provenance before marking terrain as real", async () => {
    const png = readFileSync(new URL("./fixtures/west-point-z12.png", import.meta.url));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(png)));
    const stages: string[] = [];
    const result = await loadTerrain(terrainOnly, undefined, (stage) => stages.push(stage));
    expect(stages).toEqual(["fetching", "preparing"]);
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe("Terrain tile is missing its dataset version.");
    expect(result.source.sourceKind).toBe("synthetic");
  });

  it("does not mark malformed elevation data as real exportable terrain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not a terrain PNG")));
    const result = await loadTerrain(terrainOnly);
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toEqual(expect.any(String));
    expect(result.source.sourceKind).toBe("synthetic");
  });
});


describe("terrain source resolution", () => {
  const fineTile = { z: 15, x: 6753, y: 12388 };
  const fine = readFileSync(new URL("./fixtures/granby-z15.png", import.meta.url));
  const coarse = readFileSync(new URL("./fixtures/granby-z10.png", import.meta.url));
  const bounds = {
    west: worldXToLon(fineTile.x * TILE_SIZE, fineTile.z),
    east: worldXToLon((fineTile.x + 1) * TILE_SIZE, fineTile.z),
    north: worldYToLat(fineTile.y * TILE_SIZE, fineTile.z),
    south: worldYToLat((fineTile.y + 1) * TILE_SIZE, fineTile.z),
  };

  it.each([10, 15])("avoids the Granby shoreline spikes with camera zoom %s", async (zoom) => {
    // These spikes are in the original coarse source, not introduced by carving.
    const original = decodeTerrainPng(coarse);
    expect(original[34 * TILE_SIZE + 8]).toBe(-218);
    expect(original[35 * TILE_SIZE + 11]).toBe(3091);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      const png = path.endsWith("/10/211/387.png") ? coarse
        : path.endsWith("/15/6753/12388.png") ? fine : undefined;
      if (!png) throw new Error(`Unexpected terrain request: ${path}`);
      return new Response(png, { headers: { "x-topostack-dataset": "granby-fixture" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const config = { ...terrainOnly, widthMm: 200, heightMm: 200,
      location: { lat: 40.1427, lon: -105.8086, label: "Lake Granby shoreline", zoom, bounds } };
    const result = await loadTerrain(config);
    expect(result.fallback).toBe(false);
    expect(result.source.elevationRepairCount).toBe(0);
    expect(result.source.elevation.min).toBeGreaterThan(2500);
    expect(result.source.elevation.max).toBeLessThan(2800);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/15/6753/12388.png");
    const geometry = generateGeometry(config, result.source);
    expect(geometry.minElevationM).toBeGreaterThan(2500);
    expect(geometry.maxElevationM).toBeLessThan(2800);
    expect(geometry.warnings.some((warning) => warning.code === "ELEVATION_REPAIRED")).toBe(false);
  });

  it("uses finer tiles for the regional crop within the tile and grid budgets", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(fine, {
      headers: { "x-topostack-dataset": "terrain-budget-fixture" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadTerrain({ ...terrainOnly, widthMm: 539.338, heightMm: 354.844,
      location: { lat: 40.1764, lon: -105.8559, label: "Shadow Mountain area", zoom: 10,
        bounds: { west: -106.00009555664063, east: -105.71170444335938, north: 40.24884772783778, south: 40.1038748405545 } } });
    expect(result.fallback).toBe(false);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_DATA_TILES);
    for (const [input] of fetchMock.mock.calls) expect(String(input)).toMatch(/\/v1\/terrain\/12\/\d+\/\d+\.png$/);
    expect(result.source.elevation.width).toBe(768);
    expect(result.source.elevation.height).toBeLessThanOrEqual(768);
  });
});
