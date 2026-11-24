import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boundsForProject, DEFAULT_PROJECT, generateGeometry, buildProjectPackage } from "@topostack/core";
import { loadTerrain } from "$lib/domain/data-provider";
import { loadElevation } from "$lib/domain/elevation-loader";
import { decodeTerrainPng, TERRAIN_NO_DATA, TERRAIN_STATUS_HEADER } from "@topostack/data-contracts/terrain-png";
import { fittingTileWindow, MAX_DATA_TILES, TILE_SIZE, worldXToLon, worldYToLat } from "$lib/domain/tile-math";
import { setLocale } from "$lib/i18n/i18n.svelte";
import { warningText } from "$lib/i18n/warnings";

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
    const project = { ...terrainOnly, location: { lat: 41.3915, lon: -73.956, label: "West Point, NY", zoom, bounds: { west: longitude(x + 1 / 256), east: longitude(x + 255 / 256), north: latitude(y + 1 / 256), south: latitude(y + 255 / 256) } } };
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
    west: worldXToLon(fineTile.x * TILE_SIZE + 1, fineTile.z),
    east: worldXToLon((fineTile.x + 1) * TILE_SIZE - 1, fineTile.z),
    north: worldYToLat(fineTile.y * TILE_SIZE + 1, fineTile.z),
    south: worldYToLat((fineTile.y + 1) * TILE_SIZE - 1, fineTile.z),
  };

  it("interpolates the same shared edge from either panel", async () => {
    const { elevationPng } = await import("../../../../../workers/map-api/test/terrain-fixture");
    const tiles = [elevationPng(() => 200), elevationPng(() => 100)];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const x = Number(String(input).split("/").at(-2));
      return new Response(tiles[x - 17999], { headers: { "x-topostack-dataset": "two-panels" } });
    });
    const seam = 18000 * TILE_SIZE, top = 12000 * TILE_SIZE + 128.5, z = 15;
    const panel = (west: number, east: number) => loadElevation({
      west: worldXToLon(west, z), east: worldXToLon(east, z),
      north: worldYToLat(top, z), south: worldYToLat(top + 63, z),
    }, z);
    const left = await panel(seam - 63, seam);
    const right = await panel(seam, seam + 63);
    expect(left.elevation.values[left.elevation.width - 1]).toBe(150);
    expect(right.elevation.values[0]).toBe(150);
  });

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

  const gapResponse = () => new Response(null, { status: 404, headers: { [TERRAIN_STATUS_HEADER]: TERRAIN_NO_DATA } });
  const terrainResponse = () => new Response(fine, { headers: { "x-topostack-dataset": "native-terrain-fixture", "x-topostack-imagery-sources": "mapzen/coarse-source" } });
  const requestZoom = (input: RequestInfo | URL) => Number(String(input).match(/\/v1\/terrain\/(\d+)\//)?.[1]);
  const zooms = (requests: ReadonlyArray<readonly [RequestInfo | URL, ...unknown[]]>) => [...new Set(requests.map(([input]) => requestZoom(input)))];

  it("exports the unchanged crop on original coarser tiles when detailed terrain is empty", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => requestZoom(input) === 13 ? terrainResponse() : gapResponse());
    vi.stubGlobal("fetch", fetchMock);
    const config = { ...terrainOnly, location: { lat: 40.1427, lon: -105.8086, label: "Native fallback fixture", zoom: 15, bounds } };
    const result = await loadTerrain(config);
    expect(zooms(fetchMock.mock.calls)).toEqual([15, 14, 13]);
    expect(result.fallback).toBe(false);
    expect(result.source.bounds).toEqual(boundsForProject(config));
    expect(result.source.imagerySources).toEqual(["mapzen/coarse-source"]);
    expect(result.source.terrainSelection?.mapzenZoom).toEqual({ requested: 15, used: 13 });
    const geometry = generateGeometry(config, result.source);
    expect(geometry.warnings).toContainEqual(expect.objectContaining({ code: "TERRAIN_COARSER_ZOOM", params: { zoom: 13 } }));
    const manifest = buildProjectPackage(geometry, config).files.find((file) => file.filename.endsWith("-project.json"));
    expect(JSON.parse(await manifest!.blob.text()).result.terrainSelection.mapzenZoom).toEqual({ requested: 15, used: 13 });
  });

  it.each([404, 502, 504])("does not request coarser tiles on an unrelated HTTP %s response", async (status) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadTerrain({ ...terrainOnly, location: { ...terrainOnly.location, zoom: 15, bounds } });
    expect(zooms(fetchMock.mock.calls)).toEqual([15]);
    expect(result.fallback).toBe(true);
  });

  it("cancels unfinished fine requests before loading the coarser crop", async () => {
    const twoTileBounds = {
      west: worldXToLon((fineTile.x + 0.75) * TILE_SIZE, fineTile.z),
      east: worldXToLon((fineTile.x + 1.25) * TILE_SIZE, fineTile.z),
      north: worldYToLat((fineTile.y + 0.25) * TILE_SIZE, fineTile.z),
      south: worldYToLat((fineTile.y + 0.75) * TILE_SIZE, fineTile.z),
    };
    const window = fittingTileWindow(twoTileBounds, fineTile.z);
    expect(window.tiles).toHaveLength(2);
    let fineSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, options) => {
      if (requestZoom(input) !== fineTile.z) {
        expect(fineSignal?.aborted).toBe(true);
        return terrainResponse();
      }
      if (!String(input).includes(`/${fineTile.x}/`)) return gapResponse();
      fineSignal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => fineSignal?.addEventListener("abort", () => reject(fineSignal?.reason), { once: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadElevation(twoTileBounds, fineTile.z);
    expect(zooms(fetchMock.mock.calls)).toEqual([15, 14]);
    expect(result.terrainSelection.mapzenZoom?.used).toBe(14);
  });

  it("stops after two coarser levels also report empty native terrain", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => gapResponse());
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadTerrain({ ...terrainOnly, location: { ...terrainOnly.location, zoom: 15, bounds } });
    expect(zooms(fetchMock.mock.calls)).toEqual([15, 14, 13]);
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toContain("no elevation samples");
    await setLocale("de");
    try {
      const warning = warningText({ message: "", messageKey: "mapServiceFallbackBecause", params: { reason: result.fallbackReason! } });
      expect(warning).toContain("Die Geländekachel enthält keine Höhendaten.");
      expect(warning).not.toContain(result.fallbackReason!);
    } finally {
      await setLocale("en");
    }
  });
});
