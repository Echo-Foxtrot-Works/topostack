import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, type AviationDetailsV1, type ProjectConfigV1 } from "@topostack/core";
import { AVIATION_SOURCES, MAX_AVIATION_OBSTACLES, MAX_AVIATION_POINTS, airportDetail, airportSymbol, loadAviationMarkings, obstacleSymbol } from "$lib/domain/aviation-provider";
import { clearArchiveCache } from "$lib/domain/archive";
import { fittingTileWindow } from "$lib/domain/tile-math";

/**
 * Tiles are JSON the mocked VectorTile decodes, so a fixture can say what each
 * tile of the window holds, including features repeated in tile buffers.
 */
interface FixtureFeature { type: 1 | 2; properties: Record<string, unknown>; geometry: Array<Array<{ x: number; y: number }>> }
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

const NONE: AviationDetailsV1 = { airspace: false, specialUse: false, runways: false, airports: false, navaids: false, obstacles: false, labels: false };
const denver = { west: -104.75, east: -104.55, south: 39.8, north: 39.92 };
const project = (details: Partial<AviationDetailsV1>): ProjectConfigV1 => ({ ...DEFAULT_PROJECT, aviation: { ...NONE, ...details } });
const across = (y: number): Array<Array<{ x: number; y: number }>> => [[{ x: -64, y }, { x: 4160, y }]];
const center = [[{ x: 2048, y: 2048 }]];

beforeEach(() => {
  clearArchiveCache();
  archive.header = { minZoom: 5, maxZoom: 12 };
  archive.metadata = { topostack_dataset: AVIATION_SOURCES.dataset, faa_nasr_cycle: AVIATION_SOURCES.nasrCycle, faa_obstacle_date: AVIATION_SOURCES.obstacleDate, faa_sua_date: AVIATION_SOURCES.suaDate };
  archive.tile = () => ({});
});

describe("FAA aviation loading", () => {
  it("reports areas outside FAA coverage without reading the archive", async () => {
    const tile = vi.fn(() => ({}));
    archive.tile = tile;
    const result = await loadAviationMarkings({ west: 7.4, east: 7.6, south: 46.5, north: 46.6 }, 11, project({ airspace: true }));
    expect(result).toEqual({ markings: [], status: "not-covered", attribution: [] });
    expect(tile).not.toHaveBeenCalled();
  });

  it("joins a boundary across tile seams and keeps one symbol per buffered point", async () => {
    // A window several tiles wide, each holding the same boundary edge to edge and the same airport.
    const window = fittingTileWindow(denver, 12, 5);
    expect(new Set(window.tiles.map((tile) => tile.worldX)).size).toBeGreaterThan(1);
    archive.tile = () => ({
      airspace: [{ type: 2, properties: { class: "B", name: "DENVER CLASS B", floor_ft: 8000, ceiling_ft: 12000 }, geometry: across(2048) }],
      airports: [{ type: 1, properties: { ident: "DEN", name: "DENVER INTL", kind: "airport", use: "public", towered: true, hard_runway_ft: 16000, fuel: true, beacon: true, runway_pattern: "0,2000,0,-2000;-1500,0,1500,0" }, geometry: center }],
    });
    const result = await loadAviationMarkings(denver, 11, project({ airspace: true, airports: true }));
    expect(result.status).toBe("available");
    expect(result.cycle).toBe(AVIATION_SOURCES.nasrCycle);
    expect(result.attribution[0]?.name).toContain(AVIATION_SOURCES.nasrCycle);
    // Each tile row inside the crop is one line from margin to margin: the tile pieces were joined.
    const airspace = result.markings.filter((marking) => marking.aviationClass === "class-b");
    expect(airspace.length).toBeGreaterThan(0);
    expect(airspace.length).toBeLessThanOrEqual(new Set(window.tiles.map((tile) => tile.y)).size);
    const halfWidth = (DEFAULT_PROJECT.widthMm + 8) / 2;
    for (const line of airspace) {
      expect(line.label).toBe("DENVER CLASS B");
      expect(Math.min(...line.points.map((point) => point.x))).toBeCloseTo(-halfWidth, 3);
      expect(Math.max(...line.points.map((point) => point.x))).toBeCloseTo(halfWidth, 3);
    }
    expect(result.markings.filter((marking) => marking.aviationClass === "airport")).toEqual([
      expect.objectContaining({
        aviationSymbol: "airport-pattern", label: "DEN", points: [expect.any(Object)],
        aviationDetail: { fuel: true, beacon: true, towered: true, runways: [[{ x: 0, y: -2000 }, { x: 0, y: 2000 }], [{ x: -1500, y: 0 }, { x: 1500, y: 0 }]] },
      }),
    ]);
  });

  it("keeps a runway that crosses a tile seam as one straight segment", async () => {
    const window = fittingTileWindow(denver, 12, 5);
    const westColumn = Math.min(...window.tiles.map((tile) => tile.x));
    archive.tile = (_z, x) => ({
      runways: [{ type: 2, properties: { airport: "DEN", runway: "8/26", width_ft: 150, length_ft: 12000 }, geometry: x === westColumn ? [[{ x: 3000, y: 2048 }, { x: 4160, y: 2048 }]] : x === westColumn + 1 ? [[{ x: -64, y: 2048 }, { x: 1000, y: 2048 }]] : [] }],
    });
    const runways = (await loadAviationMarkings(denver, 11, project({ runways: true }))).markings;
    expect(runways.length).toBeGreaterThan(0);
    expect(runways.every((runway) => runway.points.length === 2)).toBe(true);
  });

  it("reads only the layers the project draws and drops features that break the contract", async () => {
    archive.tile = () => ({
      airspace: [
        { type: 2, properties: { class: "E", name: "SURFACE E" }, geometry: across(1000) },
        { type: 2, properties: { class: "D", name: "BOULDER CLASS D" }, geometry: across(3000) },
      ],
      runways: [{ type: 2, properties: { airport: "DEN", runway: "16R/34L", width_ft: 200, length_ft: 16000 }, geometry: [[{ x: 1000, y: 1000 }, { x: 1000, y: 3000 }]] }],
      obstacles: [{ type: 1, properties: { agl_ft: 400, lit: true }, geometry: center }],
      airports: [{ type: 1, properties: { ident: "8CO1", name: "HOSPITAL", kind: "heliport", use: "private", towered: false }, geometry: center }],
    });
    const result = await loadAviationMarkings(denver, 11, project({ airspace: true, runways: true, airports: true }));
    expect(new Set(result.markings.map((marking) => marking.aviationClass))).toEqual(new Set(["class-d", "runway"]));
    expect(result.markings.find((marking) => marking.aviationClass === "runway")?.widthM).toBeCloseTo(60.96);
  });

  const grid = (index: number) => [[{ x: 40 + (index % 60) * 64, y: 40 + Math.floor(index / 60) * 64 }]];

  it("reports a partial load when airports and navaids exceed the budget, keeping airports first", async () => {
    let tileIndex = 0;
    archive.tile = () => {
      tileIndex += 1;
      return {
        airports: [{ type: 1, properties: { ident: `A${tileIndex}`, name: "FIELD", kind: "airport", use: "public", towered: false }, geometry: [[{ x: 100, y: 100 }]] }],
        navaids: Array.from({ length: MAX_AVIATION_POINTS }, (_, index) => ({ type: 1 as const, properties: { ident: `N${tileIndex}-${index}`, name: "AID", kind: "ndb" }, geometry: grid(index) })),
      };
    };
    const result = await loadAviationMarkings(denver, 11, project({ airports: true, navaids: true }));
    expect(result.status).toBe("partial");
    const points = result.markings.filter((marking) => marking.aviationSymbol);
    expect(points).toHaveLength(MAX_AVIATION_POINTS);
    expect(points[0]?.aviationClass).toBe("airport");
  });

  it("keeps the tallest obstacles where they crowd, without a partial load", async () => {
    const tall = Array.from({ length: 5 }, (_, index) => ({ type: 1 as const, properties: { agl_ft: 1500, lit: false }, geometry: [[{ x: 2000 + index * 20, y: 2050 }]] }));
    const short = Array.from({ length: 2100 }, (_, index) => ({ type: 1 as const, properties: { agl_ft: 300, lit: false }, geometry: grid(index) }));
    const tallSymbols = (markings: Array<{ aviationSymbol?: string }>) => markings.filter((marking) => marking.aviationSymbol === "obstacle-tall").length;
    archive.tile = () => ({ obstacles: tall });
    const tallInCrop = tallSymbols((await loadAviationMarkings(denver, 11, project({ obstacles: true }))).markings);
    expect(tallInCrop).toBeGreaterThan(0);
    // Short obstacles listed first in every tile must not crowd out the tall ones.
    clearArchiveCache();
    archive.tile = () => ({ obstacles: [...short, ...tall] });
    const result = await loadAviationMarkings(denver, 11, project({ obstacles: true }));
    expect(result.status).toBe("available");
    expect(result.markings).toHaveLength(MAX_AVIATION_OBSTACLES);
    expect(tallSymbols(result.markings)).toBe(tallInCrop);
    expect(result.markings.slice(0, tallInCrop).every((marking) => marking.aviationSymbol === "obstacle-tall")).toBe(true);
  });

  it("reads airspace altitude label places with the airspace, whether or not labels are on", async () => {
    archive.tile = () => ({
      airspace_labels: [
        { type: 1, properties: { class: "B", area: 7, ceiling_ft: 12000, floor_ft: 8000, clearance_m: 4200 }, geometry: center },
        { type: 1, properties: { class: "D", area: 8, ceiling_ft: 2500, ceiling_below: true, clearance_m: 0 }, geometry: center },
      ],
    });
    const result = await loadAviationMarkings(denver, 11, project({ airspace: true }));
    expect(result.status).toBe("available");
    const places = result.markings.filter((marking) => marking.aviationAltitude);
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((marking) => marking.aviationClass === "class-b" && !marking.aviationSymbol)).toBe(true);
    expect(places[0]!.aviationAltitude).toEqual({ area: "7", ceilingFt: 12000, floorFt: 8000, clearanceM: 4200 });
    expect((await loadAviationMarkings(denver, 11, project({ airports: true }))).markings).toEqual([]);
  });

  it("keeps navaids that share an identifier but not a kind", async () => {
    archive.tile = () => ({
      navaids: [
        { type: 1, properties: { ident: "MAZ", name: "MAYAGUEZ", kind: "ndb" }, geometry: center },
        { type: 1, properties: { ident: "MAZ", name: "MAYAGUEZ", kind: "vor-dme" }, geometry: center },
      ],
    });
    const navaids = (await loadAviationMarkings(denver, 11, project({ navaids: true }))).markings;
    expect(navaids.map((marking) => marking.aviationSymbol).sort()).toEqual(["ndb", "vor-dme"]);
  });

  it("refuses an archive whose metadata does not name its cycle", async () => {
    archive.metadata = { topostack_dataset: "faa-aviation-v1" };
    await expect(loadAviationMarkings(denver, 11, project({ airspace: true }))).rejects.toThrow(/dataset identity/);
  });
});

describe("sectional legend symbols", () => {
  const field = { ident: "TST", name: "TEST", kind: "airport", use: "public", towered: false } as const;
  const pattern: Array<[number, number, number, number]> = [[0, 1500, 0, -1500]];

  it.each([
    [{}, "airport"],
    [{ hardRunwayFt: 1400 }, "airport"],
    [{ hardRunwayFt: 1500 }, "airport-hard"],
    [{ hardRunwayFt: 8069, runwayPattern: pattern }, "airport-hard"],
    [{ hardRunwayFt: 8070, runwayPattern: pattern }, "airport-pattern"],
    [{ hardRunwayFt: 9000 }, "airport-hard"],
    [{ use: "private" }, "airport-private"],
    [{ use: "private", hardRunwayFt: 3000 }, "airport-hard"],
    [{ use: "military" }, "airport-military"],
    [{ use: "military", jointUse: true }, "airport-joint"],
    // The legend's military rows have no filled disc: a hard runway draws the layout.
    [{ use: "military", hardRunwayFt: 5000, runwayPattern: pattern }, "airport-pattern"],
    [{ use: "military", jointUse: true, hardRunwayFt: 1500, runwayPattern: pattern }, "airport-pattern"],
    [{ use: "military", hardRunwayFt: 1400, runwayPattern: pattern }, "airport-military"],
    [{ kind: "seaplane-base" }, "seaplane-base"],
    [{ kind: "heliport" }, "heliport"],
    [{ kind: "heliport", use: "private" }, undefined],
    [{ towered: true }, "airport"],
  ] as const)("charts %j as %s", (patch, symbol) => {
    expect(airportSymbol({ ...field, ...patch })).toBe(symbol);
  });

  it("draws fuel ticks only where the sectional does", () => {
    expect(airportDetail({ ...field, fuel: true })).toEqual({ fuel: true });
    expect(airportDetail({ ...field, use: "military", fuel: true })).toEqual({});
    expect(airportDetail({ ...field, use: "military", jointUse: true, fuel: true })).toEqual({ fuel: true });
  });

  it.each([
    [{ aglFt: 400 }, "obstacle"],
    [{ aglFt: 1000 }, "obstacle-tall"],
    [{ aglFt: 400, quantity: 3 }, "obstacle-group"],
    [{ aglFt: 1200, quantity: 2 }, "obstacle-group-tall"],
    [{ aglFt: 450, windTurbine: true }, "wind-turbine"],
    [{ aglFt: 450, windTurbine: true, quantity: 4 }, "wind-turbine-group"],
  ] as const)("charts obstacle %j as %s", (patch, symbol) => {
    expect(obstacleSymbol({ lit: false, ...patch })).toBe(symbol);
  });
});
