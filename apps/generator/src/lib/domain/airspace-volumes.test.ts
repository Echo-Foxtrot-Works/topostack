import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
import { AIRSPACE_VOLUME_MAX_ZOOM } from "@topostack/data-contracts/aviation-tiles";
import { MAX_AIRSPACE_VOLUMES, loadAirspaceVolumes } from "$lib/domain/airspace-volumes";
import { AVIATION_SOURCES } from "$lib/domain/aviation-provider";
import { clearArchiveCache } from "$lib/domain/archive";
import polygonClipping from "polygon-clipping";
import { MAX_SOURCE_RINGS } from "$lib/domain/feature-budget";
import { fittingTileWindow } from "$lib/domain/tile-math";

/** Tiles are JSON the mocked VectorTile decodes; ring geometry is in tile units, y down, as the archive stores it. */
interface FixtureFeature { type: 3; properties: Record<string, unknown>; geometry: Array<Array<{ x: number; y: number }>> }
type FixtureTile = Record<string, FixtureFeature[]>;

const archive = vi.hoisted(() => ({
  header: { minZoom: 5, maxZoom: 12 },
  metadata: {} as Record<string, unknown>,
  tile: (() => ({})) as (z: number, x: number, y: number) => Record<string, unknown>,
}));
vi.mock("pmtiles", async (importOriginal) => ({
  ...await importOriginal<typeof import("pmtiles")>(),
  PMTiles: class {
    getHeader = vi.fn(async () => archive.header);
    getMetadata = vi.fn(async () => archive.metadata);
    getZxy = vi.fn(async (z: number, x: number, y: number) => ({ data: new TextEncoder().encode(JSON.stringify(archive.tile(z, x, y))).buffer }));
  },
}));
vi.mock("@mapbox/vector-tile", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mapbox/vector-tile")>(),
  VectorTile: class {
    layers: Record<string, { length: number; feature: (index: number) => unknown }>;
    constructor(pbf: { buf: Uint8Array }) {
      const tile = JSON.parse(new TextDecoder().decode(pbf.buf)) as FixtureTile;
      this.layers = Object.fromEntries(Object.entries(tile).map(([name, features]) => [name, {
        length: features.length,
        feature: (index: number) => ({ ...features[index]!, id: index, extent: 4096, loadGeometry: () => features[index]!.geometry }),
      }]));
    }
  },
}));

/** A whole Class B: several tiles wide even at the volume layers' deepest zoom. */
const denver = { west: -105.37, east: -103.97, south: 39.32, north: 40.4 };
const config = { widthMm: DEFAULT_PROJECT.widthMm, heightMm: DEFAULT_PROJECT.heightMm, minimumFeatureMm: DEFAULT_PROJECT.minimumFeatureMm };
const BOTH = { classes: true, specialUse: true };
/** A square in tile units, clockwise on screen (an exterior ring in a vector tile). */
const square = (x0: number, y0: number, x1: number, y1: number) => [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]];
/** The whole tile and its buffer, as tippecanoe writes a polygon that covers it. */
const wholeTile = square(-64, -64, 4160, 4160);
const shelf = { class: "B", name: "DENVER CLASS B", sector: 4, floor_ft: 8000, floor_ref: "msl", ceiling_ft: 12000, ceiling_ref: "msl" };
const moa = { kind: "moa", name: "DESERT MOA", sector: 7, floor_ft: 100, floor_ref: "agl", ceiling_ft: 18000, ceiling_ref: "fl", ceiling_below: true };
const range = { kind: "restricted", name: "R-4806W", sector: 8, floor_ft: 0, floor_ref: "sfc", ceiling_ref: "unlimited", exclusion: true };

const area = (points: Array<{ x: number; y: number }>) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]!;
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;

beforeEach(() => {
  clearArchiveCache();
  archive.header = { minZoom: 5, maxZoom: 12 };
  archive.metadata = { topostack_dataset: AVIATION_SOURCES.dataset, faa_nasr_cycle: AVIATION_SOURCES.nasrCycle, faa_obstacle_date: AVIATION_SOURCES.obstacleDate, faa_sua_date: AVIATION_SOURCES.suaDate, vector_layers: [{ id: "airspace_volumes" }, { id: "sua_volumes" }] };
  archive.tile = () => ({});
});

describe("airspace volume loading", () => {
  it("reports areas outside FAA coverage without reading the archive", async () => {
    const tile = vi.fn(() => ({}));
    archive.tile = tile;
    expect(await loadAirspaceVolumes({ west: 7.4, east: 7.6, south: 46.5, north: 46.6 }, 11, config, BOTH)).toEqual({ volumes: [], status: "not-covered" });
    expect(await loadAirspaceVolumes(denver, 11, config, { classes: false, specialUse: false })).toEqual({ volumes: [], status: "not-covered" });
    expect(tile).not.toHaveBeenCalled();
  });

  it("rejects an archive that does not publish the requested volume layers", async () => {
    delete archive.metadata.vector_layers;
    await expect(loadAirspaceVolumes(denver, 11, config, BOTH)).rejects.toThrow(/volume layers/i);
    archive.metadata.vector_layers = [{ id: "airspace_volumes" }];
    await expect(loadAirspaceVolumes(denver, 11, config, BOTH)).rejects.toThrow(/volume layers/i);
    expect((await loadAirspaceVolumes(denver, 11, config, { classes: true, specialUse: false })).status).toBe("available");
  });

  it("unions a sector's tile pieces into one area cut to the crop", async () => {
    const zooms: number[] = [];
    archive.tile = (z) => {
      zooms.push(z);
      return { airspace_volumes: [{ type: 3, properties: shelf, geometry: wholeTile }] };
    };
    const result = await loadAirspaceVolumes(denver, 11, config, BOTH);
    // Requested deeper than the layers go, the load reads no deeper than they are written; still several tiles.
    expect(zooms.length).toBeGreaterThan(1);
    expect(Math.max(...zooms)).toBeLessThanOrEqual(AIRSPACE_VOLUME_MAX_ZOOM);
    expect(result.status).toBe("available");
    expect(result.cycle).toBe(AVIATION_SOURCES.nasrCycle);
    expect(result.volumes).toHaveLength(1);
    const [volume] = result.volumes;
    expect(volume).toMatchObject({ id: "class-4", aviationClass: "class-b", name: "DENVER CLASS B", floor: { ref: "msl", ft: 8000 }, ceiling: { ref: "msl", ft: 12000 } });
    // Every tile carries the sector edge to edge: one polygon, exactly the crop.
    expect(volume!.polygons).toHaveLength(1);
    expect(area(volume!.polygons[0]!.outer)).toBeCloseTo(config.widthMm * config.heightMm, 0);
    for (const point of volume!.polygons[0]!.outer) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(config.widthMm / 2 + 1e-6);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(config.heightMm / 2 + 1e-6);
    }
  });

  it("reads a small crop at the volume layers' deepest zoom", async () => {
    const zooms = new Set<number>();
    archive.tile = (z) => {
      zooms.add(z);
      return { airspace_volumes: [{ type: 3, properties: shelf, geometry: wholeTile }] };
    };
    const result = await loadAirspaceVolumes({ west: -105.3, east: -105.2, south: 40.0, north: 40.06 }, 13, config, BOTH);
    expect([...zooms]).toEqual([AIRSPACE_VOLUME_MAX_ZOOM]);
    expect(result.volumes).toHaveLength(1);
  });

  it("keeps special use records apart with their limits as charted", async () => {
    archive.tile = () => ({
      sua_volumes: [{ type: 3, properties: moa, geometry: wholeTile }, { type: 3, properties: range, geometry: square(1000, 1000, 3000, 3000) }],
      airspace_volumes: [{ type: 3, properties: shelf, geometry: wholeTile }],
    });
    const result = await loadAirspaceVolumes(denver, 11, config, { classes: false, specialUse: true });
    const byId = Object.fromEntries(result.volumes.map((volume) => [volume.id, volume]));
    expect(Object.keys(byId).sort()).toEqual(["sua-7", "sua-8"]);
    expect(byId["sua-7"]).toMatchObject({ aviationClass: "special-use", specialUseKind: "moa", floor: { ref: "agl", ft: 100 }, ceiling: { ref: "fl", ft: 18000 }, ceilingBelow: true });
    expect(byId["sua-7"]).not.toHaveProperty("exclusion");
    expect(byId["sua-8"]).toMatchObject({ specialUseKind: "restricted", floor: { ref: "sfc", ft: 0 }, ceiling: { ref: "unlimited" }, exclusion: true });
    // Largest first.
    expect(result.volumes[0]!.id).toBe("sua-7");
  });

  it("drops sectors outside the crop and features that break the contract", async () => {
    archive.tile = () => ({ airspace_volumes: [
      { type: 3, properties: { ...shelf, sector: 1 }, geometry: square(-60000, -60000, -59900, -59900) },
      { type: 3, properties: { ...shelf, sector: 2, floor_ref: "unlimited" }, geometry: wholeTile },
      { type: 3, properties: { ...shelf, sector: 3 }, geometry: wholeTile },
    ] });
    const result = await loadAirspaceVolumes(denver, 11, config, BOTH);
    expect(result.volumes.map((volume) => volume.id)).toEqual(["class-3"]);
  });

  it("filters disabled classes before the sector limit", async () => {
    archive.tile = () => ({ airspace_volumes: [
      ...Array.from({ length: MAX_AIRSPACE_VOLUMES + 1 }, (_, sector) => ({ type: 3 as const, properties: { ...shelf, sector }, geometry: wholeTile })),
      { type: 3, properties: { ...shelf, sector: 900, class: "C" }, geometry: wholeTile },
    ] });
    const result = await loadAirspaceVolumes(denver, 11, config, { classes: true, specialUse: false, classFilter: { B: false, C: true, D: false } });
    expect(result.status).toBe("available");
    expect(result.volumes.map((volume) => volume.id)).toEqual(["class-900"]);
  });

  it("enforces the ring budget before retaining geometry", async () => {
    archive.tile = () => ({ airspace_volumes: [{ type: 3, properties: shelf, geometry: Array.from({ length: MAX_SOURCE_RINGS + 1 }, () => wholeTile[0]!) }] });
    await expect(loadAirspaceVolumes(denver, 11, config, BOTH)).rejects.toThrow(/complexity limit/);
  });

  it("marks fallback clipping partial so an unreliable sector cannot export silently", async () => {
    archive.tile = () => ({ airspace_volumes: [{ type: 3, properties: shelf, geometry: wholeTile }] });
    const union = vi.spyOn(polygonClipping, "union").mockImplementationOnce(() => { throw new Error("Degenerate geometry"); });
    try {
      const result = await loadAirspaceVolumes(denver, 11, config, BOTH);
      expect(result.status).toBe("partial");
      expect(result.volumes).toHaveLength(1);
    } finally { union.mockRestore(); }
  });

  it("does not return geometry when cancellation arrives during sector union", async () => {
    const controller = new AbortController();
    archive.tile = () => ({ airspace_volumes: [{ type: 3, properties: shelf, geometry: wholeTile }] });
    const original = polygonClipping.union;
    const union = vi.spyOn(polygonClipping, "union").mockImplementationOnce((...args) => { controller.abort(); return original(...args); });
    try {
      await expect(loadAirspaceVolumes(denver, 11, config, BOTH, controller.signal)).rejects.toThrow();
    } finally { union.mockRestore(); }
  });

  it("keeps the largest sectors when a crop holds too many", async () => {
    const count = MAX_AIRSPACE_VOLUMES + 5;
    const cells = Array.from({ length: count }, (_, index) => {
      const x = (index % 30) * 120 + 100;
      const y = Math.floor(index / 30) * 120 + 100;
      return { type: 3 as const, properties: { ...shelf, sector: index }, geometry: square(x, y, x + 60 + (index % 7), y + 60 + (index % 7)) };
    });
    const tiles = fittingTileWindow(denver, AIRSPACE_VOLUME_MAX_ZOOM, 5).tiles;
    const center = tiles[Math.floor(tiles.length / 2)]!;
    archive.tile = (_z, x, y) => (x === center.x && y === center.y ? { airspace_volumes: cells } : {});
    const result = await loadAirspaceVolumes(denver, 11, config, BOTH);
    if (result.volumes.length < MAX_AIRSPACE_VOLUMES) return expect.fail(`only ${result.volumes.length} sectors fell inside the crop`);
    expect(result.status).toBe("partial");
    expect(result.volumes).toHaveLength(MAX_AIRSPACE_VOLUMES);
  });
});
