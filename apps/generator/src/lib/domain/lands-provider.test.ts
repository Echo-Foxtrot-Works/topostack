import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, LAND_CLASSES as CORE_LAND_CLASSES } from "@topostack/core";
import { LAND_CLASSES } from "@topostack/data-contracts/land-tiles";
import { LANDS_SOURCES, MAX_LAND_UNITS, loadLandAreas } from "$lib/domain/lands-provider";
import { clearArchiveCache } from "$lib/domain/archive";
import polygonClipping from "polygon-clipping";
import { MAX_SOURCE_RINGS } from "$lib/domain/feature-budget";

/** Tiles are JSON the mocked VectorTile decodes; ring geometry is in tile units, y down, as the archive stores it. */
interface FixtureFeature { type: 3; properties: Record<string, unknown>; geometry: Array<Array<{ x: number; y: number }>> }

const archive = vi.hoisted(() => ({
  header: { minZoom: 4, maxZoom: 12 },
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
      const tile = JSON.parse(new TextDecoder().decode(pbf.buf)) as Record<string, FixtureFeature[]>;
      this.layers = Object.fromEntries(Object.entries(tile).map(([name, features]) => [name, {
        length: features.length,
        feature: (index: number) => ({ ...features[index]!, id: index, extent: 4096, loadGeometry: () => features[index]!.geometry }),
      }]));
    }
  },
}));

/** Rocky Mountain National Park and the forests around it: several tiles wide at zoom 12. */
const estesPark = { west: -105.75, east: -105.45, south: 40.25, north: 40.45 };
const config = { widthMm: DEFAULT_PROJECT.widthMm, heightMm: DEFAULT_PROJECT.heightMm, minimumFeatureMm: DEFAULT_PROJECT.minimumFeatureMm };
const square = (x0: number, y0: number, x1: number, y1: number) => [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]];
const wholeTile = square(-64, -64, 4160, 4160);
const park = { class: "national-park", unit: "national-park:Rocky Mountain National Park", name: "Rocky Mountain National Park", manager: "NPS", acres: 265_000 };
const forest = { class: "national-forest", unit: "national-forest:Roosevelt National Forest", name: "Roosevelt National Forest", manager: "USFS", acres: 813_000 };
const blm = { class: "blm", unit: "blm:CO", manager: "BLM", acres: 8_300_000 };

const area = (points: Array<{ x: number; y: number }>) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]!;
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;

beforeEach(() => {
  clearArchiveCache();
  archive.header = { minZoom: 4, maxZoom: 12 };
  archive.metadata = { topostack_dataset: LANDS_SOURCES.dataset, padus_version: LANDS_SOURCES.padusVersion, padus_date: LANDS_SOURCES.padusDate, vector_layers: [{ id: "lands" }] };
  archive.tile = () => ({});
});

describe("land area loading", () => {
  it("names the same classes as core's paint kinds", () => {
    expect([...CORE_LAND_CLASSES]).toEqual([...LAND_CLASSES]);
  });

  it("reads no archive when no class is asked for, or when OpenStreetMap has none of the classes outside PAD-US", async () => {
    const tile = vi.fn(() => ({}));
    archive.tile = tile;
    expect(await loadLandAreas({ west: 7.4, east: 7.6, south: 46.5, north: 46.6 }, 11, config, ["wilderness", "blm"])).toEqual({ areas: [], status: "not-covered", attribution: [] });
    expect(await loadLandAreas(estesPark, 11, config, [])).toEqual({ areas: [], status: "not-covered", attribution: [] });
    expect(tile).not.toHaveBeenCalled();
  });

  it("falls back to OpenStreetMap's protected areas outside PAD-US, unnamed and joined by feature", async () => {
    archive.tile = () => {
      return { landuse: [
        { type: 3, properties: { kind: "national_park" }, geometry: wholeTile },
        { type: 3, properties: { kind: "nature_reserve" }, geometry: square(0, 0, 2000, 2000) },
        { type: 3, properties: { kind: "forest" }, geometry: wholeTile },
        { type: 3, properties: { kind: "military" }, geometry: square(2500, 2500, 3000, 3000) },
      ] };
    };
    const alps = { west: 10.0, east: 10.3, south: 46.55, north: 46.75 };
    const result = await loadLandAreas(alps, 11, config, ["national-park", "preserve", "wilderness"]);
    expect(result.source).toBe("openstreetmap");
    expect(result.status).toBe("available");
    expect(result.attribution).toEqual([]);
    expect(new Set(result.areas.map((area) => area.landClass))).toEqual(new Set(["national-park", "preserve"]));
    expect(result.areas.every((area) => area.unit.startsWith("osm:") && area.name === undefined)).toBe(true);
    // The park covers every tile: its pieces join into one unit, exactly the crop.
    const park = result.areas.filter((area) => area.landClass === "national-park");
    expect(park).toHaveLength(1);
    expect(area(park[0]!.polygons[0]!.outer)).toBeCloseTo(config.widthMm * config.heightMm, 0);
    // Nothing mapped of the asked-for kinds is the same as no coverage.
    archive.tile = () => ({ landuse: [{ type: 3, properties: { kind: "forest" }, geometry: wholeTile }] });
    expect(await loadLandAreas(alps, 11, config, ["national-park"])).toEqual({ areas: [], status: "not-covered", attribution: [] });
  });

  it("unions a unit's tile pieces into one area cut to the crop, and credits PAD-US", async () => {
    const zooms = new Set<number>();
    archive.tile = (z) => {
      zooms.add(z);
      return { lands: [{ type: 3, properties: park, geometry: wholeTile }] };
    };
    const result = await loadLandAreas(estesPark, 13, config, ["national-park"]);
    expect([...zooms]).toEqual([12]);
    expect(result.status).toBe("available");
    expect(result.source).toBe("padus");
    expect(result.version).toBe(LANDS_SOURCES.padusVersion);
    expect(result.attribution[0]!.name).toContain(`PAD-US) ${LANDS_SOURCES.padusVersion}`);
    expect(result.areas).toHaveLength(1);
    const [unit] = result.areas;
    expect(unit).toMatchObject({ unit: park.unit, landClass: "national-park", name: park.name });
    expect(unit!.polygons).toHaveLength(1);
    expect(area(unit!.polygons[0]!.outer)).toBeCloseTo(config.widthMm * config.heightMm, 0);
  });

  it("keeps only the classes asked for, names only named units, and drops features that break the contract", async () => {
    archive.tile = () => ({ lands: [
      { type: 3, properties: park, geometry: square(0, 0, 2000, 2000) },
      { type: 3, properties: forest, geometry: wholeTile },
      { type: 3, properties: blm, geometry: wholeTile },
      { type: 3, properties: { ...park, unit: "national-park:Broken", acres: -1 }, geometry: wholeTile },
    ] });
    const result = await loadLandAreas(estesPark, 11, config, ["national-forest", "blm"]);
    expect(result.areas.map((item) => item.unit).sort()).toEqual(["blm:CO", "national-forest:Roosevelt National Forest"]);
    expect(result.areas.find((item) => item.landClass === "blm")).not.toHaveProperty("name");
  });

  it("reports a load over the geometry budget as partial instead of failing", async () => {
    archive.tile = () => ({ lands: [{ type: 3, properties: park, geometry: Array.from({ length: MAX_SOURCE_RINGS + 1 }, () => wholeTile[0]!) }] });
    const result = await loadLandAreas(estesPark, 11, config, ["national-park"]);
    expect(result.status).toBe("partial");
  });

  it("marks fallback clipping partial so an unreliable unit cannot export silently", async () => {
    archive.tile = () => ({ lands: [{ type: 3, properties: park, geometry: wholeTile }] });
    const union = vi.spyOn(polygonClipping, "union").mockImplementationOnce(() => { throw new Error("Degenerate geometry"); });
    try {
      const result = await loadLandAreas(estesPark, 11, config, ["national-park"]);
      expect(result.status).toBe("partial");
      expect(result.areas).toHaveLength(1);
    } finally { union.mockRestore(); }
  });

  it("keeps the largest units when a crop holds too many", async () => {
    // A grid of small preserves in every tile, each its own unit.
    archive.tile = (_z, x, y) => ({ lands: Array.from({ length: 100 }, (_, index) => {
      const cx = (index % 10) * 400 + 100;
      const cy = Math.floor(index / 10) * 400 + 100;
      return { type: 3 as const, properties: { class: "preserve", unit: `preserve:${x}-${y}-${index}:CO`, acres: 40 }, geometry: square(cx, cy, cx + 120 + (index % 7), cy + 120 + (index % 7)) };
    }) });
    const result = await loadLandAreas(estesPark, 11, { ...config, minimumFeatureMm: 0 }, ["preserve"]);
    expect(result.status).toBe("partial");
    expect(result.areas).toHaveLength(MAX_LAND_UNITS);
  });

  it("rejects an archive from another dataset family", async () => {
    archive.metadata = { topostack_dataset: "faa-aviation-2026-10-01-v2" };
    await expect(loadLandAreas(estesPark, 11, config, ["national-park"])).rejects.toThrow(/dataset identity/);
  });
});
