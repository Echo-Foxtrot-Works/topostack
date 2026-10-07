import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, type WaterAreaV1 } from "@topostack/core";
import { loadLakeAreas } from "$lib/domain/lake-area-loader";

type TileFeature = { type: number; properties: Record<string, unknown>; ring: Array<{ x: number; y: number }> };
const getHeaderMock = vi.hoisted(() => vi.fn());
const getZxyMock = vi.hoisted(() => vi.fn());
const providerOutlinesMock = vi.hoisted(() => vi.fn());
const tile = vi.hoisted(() => ({ features: [] as TileFeature[] }));

vi.mock("pmtiles", async (importOriginal) => ({
  ...await importOriginal<typeof import("pmtiles")>(),
  PMTiles: class {
    getHeader = getHeaderMock;
    getZxy = getZxyMock;
  },
}));
vi.mock("@mapbox/vector-tile", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mapbox/vector-tile")>(),
  VectorTile: class {
    layers = { lakes: { length: tile.features.length, feature: (index: number) => {
      const { type, properties, ring } = tile.features[index]!;
      return { type, extent: 4096, properties, loadGeometry: () => [ring.map(({ x, y }) => ({ x, y }))] };
    } } };
  },
}));
vi.mock("$lib/domain/lake-outlines", async (importOriginal) => ({
  ...await importOriginal<typeof import("$lib/domain/lake-outlines")>(),
  loadProviderOutlines: providerOutlinesMock,
}));

// The whole tile, wound as vector tiles wind outer rings.
const wholeTile = [{ x: 0, y: 0 }, { x: 4096, y: 0 }, { x: 4096, y: 4096 }, { x: 0, y: 4096 }, { x: 0, y: 0 }];
const lake = (properties: Record<string, unknown>, type = 3): TileFeature => ({ type, properties, ring: wholeTile });
const bounds = { west: 0.04, east: 0.05, south: 0.04, north: 0.05 };
const providerLake: WaterAreaV1 = { id: "provider-1", kind: "lake", polygon: { outer: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], holes: [] } };

beforeEach(() => {
  tile.features = [];
  getHeaderMock.mockReset().mockResolvedValue({ minZoom: 4, maxZoom: 12 });
  getZxyMock.mockReset().mockResolvedValue({ data: new ArrayBuffer(0) });
  providerOutlinesMock.mockReset().mockResolvedValue([]);
});

describe("HydroLAKES outlines", () => {
  it("joins a lake's pieces by id and carries its depth metadata", async () => {
    tile.features = [lake({ hylak_id: 42, name: "  Crater Lake ", dmax_m: "594", davg_m: 350, lmax_m: 9.6, elev_m: 1883, area_km2: 53 })];
    const areas = await loadLakeAreas(bounds, 12, DEFAULT_PROJECT);
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ id: "lake-42-0", kind: "lake", hylakId: 42, name: "Crater Lake", maxDepthM: 594, meanDepthM: 350, lmaxM: 9.6, surfaceElevationM: 1883 });
    // The tile reaches well past this small crop, so the basin is only partly in view.
    expect(areas[0]!.clipped).toBe(true);
  });

  it("leaves out lines, unidentified lakes, and lakes too small to cut", async () => {
    tile.features = [
      lake({ hylak_id: 1, area_km2: 50 }, 2),
      lake({ name: "No id", area_km2: 50 }),
      lake({ hylak_id: 2, area_km2: 0 }),
      lake({ hylak_id: 3, name: " ", dmax_m: "deep" }),
    ];
    const areas = await loadLakeAreas(bounds, 12, DEFAULT_PROJECT);
    expect(areas.map((area) => area.hylakId)).toEqual([3]);
    expect(areas[0]).not.toHaveProperty("name");
    expect(areas[0]!.maxDepthM).toBeUndefined();
  });

  it("skips tiles the archive does not hold", async () => {
    tile.features = [lake({ hylak_id: 7 })];
    getZxyMock.mockResolvedValue(undefined);
    expect(await loadLakeAreas(bounds, 12, DEFAULT_PROJECT)).toEqual([]);
  });
});

describe("lake outline sources", () => {
  it("uses provider outlines when the HydroLAKES archive fails", async () => {
    getHeaderMock.mockRejectedValue(new Error("archive offline"));
    providerOutlinesMock.mockResolvedValue([providerLake]);
    const areas = await loadLakeAreas(bounds, 12, DEFAULT_PROJECT);
    expect(areas.map((area) => area.id)).toEqual(["provider-1"]);
  });

  it("fails when neither source answers", async () => {
    getHeaderMock.mockRejectedValue(new Error("archive offline"));
    providerOutlinesMock.mockRejectedValue(new Error("provider offline"));
    await expect(loadLakeAreas(bounds, 12, DEFAULT_PROJECT)).rejects.toThrow("Lake outlines could not be loaded.");
  });

  it("does not report a lake-free crop when one source failed", async () => {
    providerOutlinesMock.mockRejectedValue(new Error("provider offline"));
    await expect(loadLakeAreas(bounds, 12, DEFAULT_PROJECT)).rejects.toThrow("Lake outline coverage could not be checked.");
  });

  it("stops when the request is cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Superseded", "AbortError"));
    await expect(loadLakeAreas(bounds, 12, DEFAULT_PROJECT, controller.signal)).rejects.toThrow("Superseded");
  });
});
