import { beforeEach, describe, expect, it, vi } from "vitest";
import { terrainPng } from "../../../../../workers/map-api/test/terrain-fixture";
import { applyPreferredTerrain } from "$lib/domain/terrain-sources";

const mocks = vi.hoisted(() => ({ createArchive: vi.fn(), getHeader: vi.fn(), getMetadata: vi.fn(), getZxy: vi.fn() }));
vi.mock("$lib/domain/archive", async (importOriginal) => ({ ...await importOriginal<typeof import("$lib/domain/archive")>(), createArchive: mocks.createArchive }));
const bounds = { west: -78.94, east: -78.92, south: 46.46, north: 46.48 };
const dataset = "nrcan-hrdem-alexander-v1";
const tile = (x = 4599) => ({ z: 14, x, y: 5798, values: new Float32Array(65536).fill(100) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createArchive.mockReturnValue(mocks);
  mocks.getHeader.mockResolvedValue({ tileType: 2, minZoom: 0, maxZoom: 15, minLon: -78.97, minLat: 46.44, maxLon: -78.9, maxLat: 46.49 });
  mocks.getMetadata.mockResolvedValue({ topostack_dataset: dataset, topostack_encoding: "elevation-terrarium-v1", topostack_vertical_datum: "CGVD2013" });
  mocks.getZxy.mockResolvedValue({ data: terrainPng });
});

describe("preferred terrain archives", () => {
  it("replaces base elevations and records attribution only when data is applied", async () => {
    const tiles = [tile()];
    const result = await applyPreferredTerrain("https://example.test", bounds, tiles);
    expect(mocks.createArchive).toHaveBeenCalledWith(`https://example.test/v1/terrain-sources/${dataset}.pmtiles`, undefined);
    expect(tiles[0]!.values[0]).not.toBe(100);
    expect(result.datasetVersions).toEqual([dataset]);
    expect(result.attribution[0]?.license).toContain("CGVD2013");
    expect(result.unavailable).toBe(false);
  });

  it("keeps missing tiles on the base source without claiming lidar coverage", async () => {
    mocks.getZxy.mockResolvedValue(undefined);
    const tiles = [tile()];
    const result = await applyPreferredTerrain("", bounds, tiles);
    expect(tiles[0]!.values.every((v) => v === 100)).toBe(true);
    expect(result).toMatchObject({ datasetVersions: [], attribution: [], imagerySources: [], unavailable: false });
  });

  it("does not fetch outside the registered region or supported zooms", async () => {
    await applyPreferredTerrain("", { west: 0, east: 1, south: 0, north: 1 }, [tile()]);
    await applyPreferredTerrain("", bounds, [{ ...tile(), z: 9 }]);
    expect(mocks.createArchive).not.toHaveBeenCalled();
  });

  it.each([
    { topostack_encoding: "depth-terrarium-v1" },
    { topostack_vertical_datum: "unknown" },
    { topostack_dataset: "other-v1" },
  ])("rejects wrong metadata and retains the original terrain: %j", async (patch) => {
    mocks.getMetadata.mockResolvedValue({ topostack_dataset: dataset, topostack_encoding: "elevation-terrarium-v1", topostack_vertical_datum: "CGVD2013", ...patch });
    const original = tile();
    expect((await applyPreferredTerrain("", bounds, [original])).unavailable).toBe(true);
    expect(original.values[0]).toBe(100);
    expect(mocks.getZxy).not.toHaveBeenCalled();
  });

  it("discards the whole overlay when any tile is malformed or its release changes", async () => {
    for (const failure of [() => Promise.resolve({ data: new Uint8Array([1, 2]) }), () => Promise.reject(new Error("Archive changed"))]) {
      mocks.getZxy.mockReset().mockResolvedValueOnce({ data: terrainPng }).mockImplementationOnce(failure);
      const tiles = [tile(), tile(4600)];
      expect((await applyPreferredTerrain("", bounds, tiles)).unavailable).toBe(true);
      expect(tiles.every((t) => t.values.every((v) => v === 100))).toBe(true);
    }
  });

  it("propagates cancellation without applying a partial overlay", async () => {
    const controller = new AbortController();
    mocks.getZxy.mockImplementation(async () => { controller.abort(); return { data: terrainPng }; });
    const original = tile();
    await expect(applyPreferredTerrain("", bounds, [original], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(original.values[0]).toBe(100);
  });
});

import { readFileSync } from "node:fs";
import { DEFAULT_PROJECT, generateGeometry } from "@topostack/core";
import { loadTerrain } from "$lib/domain/data-provider";
import fixture from "$lib/domain/fixtures/hrdem-alexander-z14.json";
import edgeFixture from "$lib/domain/fixtures/hrdem-alexander-edge-z14.json";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { afterEach } from "vitest";
afterEach(() => vi.unstubAllGlobals());

it("preserves real HRDEM elevations and retains Mapzen at transparent coverage edges", async () => {
  for (const [name, info] of [["hrdem-alexander-z14", fixture], ["hrdem-alexander-edge-z14", edgeFixture]] as const) {
    const bytes = readFileSync(new URL(`./fixtures/${name}.png`, import.meta.url));
    mocks.getZxy.mockResolvedValue({ data: bytes });
    const original = { ...info.tile, values: new Float32Array(65536).fill(100) };
    await applyPreferredTerrain("", bounds, [original]);
    const decoded = decodeTerrainPng(bytes, true);
    for (const sample of info.samples) expect(original.values[sample.index]).toBe(sample.elevationM);
    const expected = decoded.map((v) => Number.isFinite(v) ? v : 100);
    expect(original.values).toEqual(expected);
  }
});

it("loads HRDEM through the complete terrain pipeline and exports its provenance", async () => {
  mocks.getZxy.mockResolvedValue({ data: readFileSync(new URL("./fixtures/hrdem-alexander-z14.png", import.meta.url)) });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(terrainPng, { headers: { "x-topostack-dataset": "base-fixture" } })));
  const longitude = (x: number) => x / 2 ** 14 * 360 - 180;
  const latitude = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** 14))) * 180 / Math.PI;
  const project = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false, showBoundaries: false,
    location: { lat: 46.468, lon: -78.932, label: "Alexander Lake", zoom: 14, bounds: { west: longitude(4599), east: longitude(4600), north: latitude(5798), south: latitude(5799) } } };
  const result = await loadTerrain(project);
  expect(result.fallback).toBe(false);
  expect(result.source.elevation.min).toBeGreaterThan(200);
  expect(result.source.elevation.max).toBeLessThan(500);
  expect(result.source.datasetVersion).toContain(dataset);
  expect(result.source.attribution).toContainEqual(expect.objectContaining({ name: expect.stringContaining("HRDEM") }));
  const geometry = generateGeometry(project, result.source);
  expect(geometry.imagerySources).toContain(`${dataset}/CGVD2013`);
  expect(geometry.terrainSelection).toEqual(result.source.terrainSelection);
  expect(geometry.terrainSelection!.sources.reduce((sum, source) => sum + source.fraction, 0)).toBeCloseTo(1);
  expect(geometry.terrainSelection!.sources).toContainEqual(expect.objectContaining({ id: dataset, nativeResolutionM: 1 }));
  expect(geometry.warnings.some((w) => w.code === "TERRAIN_SOURCE_FALLBACK")).toBe(false);
  mocks.getHeader.mockRejectedValue(new Error("Archive unavailable"));
  const fallback = await loadTerrain(project);
  expect(fallback.fallback).toBe(false);
  expect(fallback.source.elevation.min).toBe(1);
  expect(fallback.source.datasetVersion).toBe("base-fixture");
  expect(generateGeometry(project, fallback.source).warnings).toContainEqual(expect.objectContaining({ code: "TERRAIN_SOURCE_FALLBACK" }));
  // Two full 1 m geometry generations: ~5 s locally, ~10 s on CI runners under coverage.
}, 30_000);

import terrainCatalog from "../../../../../scripts/data/terrain-sources.json";
import { validateTerrainCatalog } from "@topostack/data-contracts/source-catalog";

it("selects by priority regardless of registration order and fills only uncovered pixels", async () => {
  const template = validateTerrainCatalog(terrainCatalog).sources[0]!;
  const high = { ...template, id: "high-v1", priority: 300 };
  const low = { ...template, id: "low-v1", priority: 200 };
  const edge = readFileSync(new URL("./fixtures/hrdem-alexander-edge-z14.png", import.meta.url));
  const decoded = decodeTerrainPng(edge, true);
  mocks.createArchive.mockImplementation((url: string) => {
    const source = url.includes("high-v1") ? high : low;
    return {
      getHeader: mocks.getHeader,
      getMetadata: async () => ({ topostack_dataset: source.id, topostack_encoding: source.encoding, topostack_vertical_datum: source.verticalDatum }),
      getZxy: async () => ({ data: source === high ? edge : terrainPng }),
    };
  });
  for (const sources of [[low, high], [high, low]]) {
    const target = tile();
    const result = await applyPreferredTerrain("", bounds, [target], undefined, sources);
    expect(result.datasetVersions).toEqual([high.id, low.id]);
    for (let index = 0; index < decoded.length; index += 1) {
      expect(target.values[index]).toBe(Number.isFinite(decoded[index]) ? decoded[index] : 1);
      expect(result.owners[0]![index]).toBe(Number.isFinite(decoded[index]) ? 1 : 2);
    }
  }
});

it("tries the next ranked provider when the preferred archive is unavailable", async () => {
  const template = validateTerrainCatalog(terrainCatalog).sources[0]!;
  mocks.createArchive.mockImplementation((url: string) => {
    if (url.includes("unavailable-v1")) throw new Error("Unavailable");
    return mocks;
  });
  const target = tile();
  const result = await applyPreferredTerrain("", bounds, [target], undefined, [{ ...template, id: "unavailable-v1", priority: 400 }, template]);
  expect(target.values[0]).toBe(1);
  expect(result.attempts.map((attempt) => attempt.status)).toEqual(["unavailable", "selected"]);
  // A lower-ranked archive covered every pixel, so nothing fell back to the base terrain.
  expect(result.unavailable).toBe(false);
});

it("reports a fallback when pixels a failed provider covers stay on the base terrain", async () => {
  const template = validateTerrainCatalog(terrainCatalog).sources[0]!;
  mocks.createArchive.mockImplementation((url: string) => {
    if (url.includes("unavailable-v1")) throw new Error("Unavailable");
    return { ...mocks, getZxy: async () => undefined };
  });
  const target = tile();
  const result = await applyPreferredTerrain("", bounds, [target], undefined, [{ ...template, id: "unavailable-v1", priority: 400 }, template]);
  expect(target.values[0]).toBe(100);
  expect(result.attempts.map((attempt) => attempt.status)).toEqual(["unavailable", "no-coverage"]);
  expect(result.unavailable).toBe(true);
});



it("rejects changed archive extent before reading any elevation tiles", async () => {
  mocks.getHeader.mockResolvedValue({ tileType: 2, minZoom: 0, maxZoom: 15, minLon: -80, minLat: 46.44, maxLon: -78.9, maxLat: 46.49 });
  const original = tile();
  const result = await applyPreferredTerrain("", bounds, [original]);
  expect(result.unavailable).toBe(true);
  expect(original.values[0]).toBe(100);
  expect(mocks.getZxy).not.toHaveBeenCalled();
});

it("accepts trench depths only from ocean grids", async () => {
  const { elevationPng } = await import("../../../../../workers/map-api/test/terrain-fixture");
  const land = validateTerrainCatalog(terrainCatalog).sources[0]!;
  const ocean = { ...land, id: "ocean-test-v1", kind: "bathymetry-grid" as const, verticalDatum: "MSL" as const };
  const trench = elevationPng(() => -8000);
  mocks.getZxy.mockResolvedValue({ data: trench });
  for (const [source, applied] of [[land, false], [ocean, true]] as const) {
    mocks.getMetadata.mockResolvedValue({ topostack_dataset: source.id, topostack_encoding: source.encoding, topostack_vertical_datum: source.verticalDatum });
    const target = { ...tile(), values: new Float32Array(65536).fill(-50) };
    const result = await applyPreferredTerrain("", bounds, [target], undefined, [source]);
    expect(result.unavailable).toBe(!applied);
    expect(target.values[0]).toBe(applied ? -8000 : -50);
  }
});

describe("ocean grids", () => {
  const land = validateTerrainCatalog(terrainCatalog).sources[0]!;
  const ocean = { ...land, id: "ocean-test-v1", kind: "bathymetry-grid" as const, verticalDatum: "MSL" as const, minZoom: 0, maxZoom: 14 };
  beforeEach(() => {
    mocks.getMetadata.mockResolvedValue({ topostack_dataset: ocean.id, topostack_encoding: ocean.encoding, topostack_vertical_datum: ocean.verticalDatum });
    mocks.getHeader.mockResolvedValue({ tileType: 2, minZoom: 0, maxZoom: 14, minLon: -78.97, minLat: 46.44, maxLon: -78.9, maxLat: 46.49 });
  });

  it("never fetches for tiles that are all land and never lifts the coast", async () => {
    const { elevationPng } = await import("../../../../../workers/map-api/test/terrain-fixture");
    const inland = tile();
    await applyPreferredTerrain("", bounds, [inland], undefined, [ocean]);
    expect(mocks.createArchive).not.toHaveBeenCalled();
    // Left half land in the base terrain, right half sea; the grid says sea everywhere.
    const coast = { ...tile(), values: Float32Array.from({ length: 65536 }, (_, i) => (i % 256 < 128 ? 12 : -5)) };
    mocks.getZxy.mockResolvedValue({ data: elevationPng(() => -300) });
    const result = await applyPreferredTerrain("", bounds, [coast], undefined, [ocean]);
    expect(coast.values[10]).toBe(12);
    expect(coast.values[200]).toBe(-300);
    expect(result.owners[0]![10]).toBe(0);
    expect(result.owners[0]![200]).toBe(1);
  });
});

describe("ancestor upsampling", () => {
  it("interpolates a coarser archive bilinearly and fetches each ancestor once", async () => {
    const { elevationPng } = await import("../../../../../workers/map-api/test/terrain-fixture");
    const { upsampledFromAncestors } = await import("$lib/domain/terrain-sources");
    // A ramp of one metre per source column across the z13 ancestor of two z14 tiles.
    const getZxy = vi.fn(async () => ({ data: elevationPng((column) => column) }));
    const left = { z: 14, x: 4598, y: 5798, values: new Float32Array(65536) };
    const right = { z: 14, x: 4599, y: 5798, values: new Float32Array(65536) };
    const [a, b] = await upsampledFromAncestors({ getZxy } as never, 13, [left, right], -500, 9000);
    // Both targets share ancestor 2299/2899. Target pixel centres sit a quarter
    // source pixel inside, so the edge pixels also reach the neighbouring
    // ancestors; each is still fetched once.
    expect(new Set(getZxy.mock.calls.map((call: unknown[]) => `${call[0]}/${call[1]}/${call[2]}`))).toEqual(new Set(
      ["13/2298/2898", "13/2299/2898", "13/2300/2898", "13/2298/2899", "13/2299/2899", "13/2300/2899"]));
    expect(getZxy).toHaveBeenCalledTimes(6);
    // Target pixel 1 of the left tile sits a quarter source pixel past column 0.
    expect(a![1]).toBeCloseTo(0.25, 5);
    expect(a![255]).toBeCloseTo(127.25, 5);
    expect(b![0]).toBeCloseTo(127.75, 5);
  });

  it("feathers into the base where the archive has no data and leaves empty areas alone", async () => {
    const { upsampledFromAncestors } = await import("$lib/domain/terrain-sources");
    const { elevationPng } = await import("../../../../../workers/map-api/test/terrain-fixture");
    const getZxy = vi.fn(async (_z: number, x: number) => (x === 2299 ? { data: elevationPng(() => -100) } : undefined));
    const base = (value: number) => ({ z: 14, x: 4600, y: 5798, values: new Float32Array(65536).fill(value) });
    const [beyond] = await upsampledFromAncestors({ getZxy } as never, 13, [base(-20)], -11000, 10);
    // Target 4600 lies in ancestor 2300 (no data); its first column sits three
    // quarters of a source pixel past 2299's last column, so -100 there blends
    // with the base value standing in for the missing corner.
    expect(beyond![0]).toBeCloseTo(-100 * 0.25 + -20 * 0.75, 4);
    expect(Number.isNaN(beyond![10])).toBe(true);
    const [none] = await upsampledFromAncestors({ getZxy: async () => undefined } as never, 13, [base(-20)], -11000, 10);
    expect(none).toBeUndefined();
  });

  it("wraps neighbours across the antimeridian", async () => {
    const { upsampledFromAncestors } = await import("$lib/domain/terrain-sources");
    const { elevationPng } = await import("../../../../../workers/map-api/test/terrain-fixture");
    const getZxy = vi.fn(async (_z: number, x: number) => ({ data: elevationPng(() => (x === 0 ? -10 : -30)) }));
    const [east] = await upsampledFromAncestors({ getZxy } as never, 2, [{ z: 3, x: 7, y: 3, values: new Float32Array(65536) }], -11000, 10);
    expect(getZxy.mock.calls.some((call: unknown[]) => call[1] === 0)).toBe(true);
    expect(east![255]).toBeCloseTo(-30 * 0.75 + -10 * 0.25, 4);
  });
});
