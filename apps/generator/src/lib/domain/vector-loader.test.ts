import { transportGrade } from "./transportation-classification";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, type MarkingFeature } from "@topostack/core";
import { boundsForProject } from "@topostack/core";
import type { PbfReader } from "pbf";
import { MAX_SOURCE_RINGS } from "$lib/domain/feature-budget";
import { cleanBoundaryMarkings, cleanWaterwayMarkings, clipVectorTileLine, dissolveTilePolygons, dissolveWaterPolygons, limitVectorMarkingGroups, MAX_VECTOR_MARKINGS, stitchTransportationMarkings } from "$lib/domain/vector-cleanup";
import { classifyTransportation, isStateProvinceBoundary, loadVectorMarkings, transportationLabel } from "$lib/domain/vector-loader";
import { applyLakeShorelines, combineWaterAreas } from "$lib/domain/water-assembly";
import { fittingTileWindow } from "$lib/domain/tile-math";


describe("vector feature budgets", () => {
  it("shares a hard limit across enabled categories and reports truncation", () => {
    const marking = (kind: MarkingFeature["kind"], index: number): MarkingFeature => ({ id: kind + "-" + index, kind, operation: "engrave", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    const groups = (["boundary", "road", "trail", "water"] as const).map((kind) => Array.from({ length: 5 }, (_, index) => marking(kind, index)));
    const limited = limitVectorMarkingGroups(groups, 8);
    expect(limited.markings).toHaveLength(8);
    expect(limited.truncated).toBe(true);
    expect(new Set(limited.markings.map((item) => item.kind))).toEqual(new Set(["boundary", "road", "trail", "water"]));
    expect(limitVectorMarkingGroups([groups[0] ?? []], 8)).toMatchObject({ truncated: false });
  });


});

describe("transportation metadata", () => {
  it("classifies supported roads and trails while excluding other transport", () => {
    expect(classifyTransportation({ kind: "major_road", kind_detail: "primary" })).toBe("major-road");
    expect(classifyTransportation({ kind: "minor_road", kind_detail: "residential" })).toBe("local-road");
    expect(classifyTransportation({ kind: "path", kind_detail: "track" })).toBe("trail");
    expect(classifyTransportation({ kind: "ferry", kind_detail: "path" })).toBeUndefined();
  });

  it("keeps running rail lines and drops underground subways, yards and sidings", () => {
    expect(classifyTransportation({ kind: "rail", kind_detail: "rail" })).toBe("rail");
    expect(classifyTransportation({ kind: "rail", kind_detail: "light_rail" })).toBe("rail");
    expect(classifyTransportation({ kind: "rail" })).toBe("rail");
    expect(classifyTransportation({ kind: "rail", kind_detail: "subway", is_tunnel: true })).toBeUndefined();
    expect(classifyTransportation({ kind: "rail", kind_detail: "rail", service: "yard" })).toBeUndefined();
    expect(classifyTransportation({ kind: "rail", kind_detail: "abandoned" })).toBeUndefined();
  });

  it("prefers names and falls back to route references", () => {
    expect(transportationLabel({ name: "Rim Drive", ref: "OR 62" })).toBe("Rim Drive");
    expect(transportationLabel({ ref: "OR 62", shield_text: "62" })).toBe("OR 62");
    expect(transportationLabel({ shield_text: "62" })).toBe("62");
  });

  it("uses a romanized name when the local one has no engravable letters", () => {
    // Shapes of the Protomaps properties on a Tokyo z12 tile.
    expect(transportationLabel({ name: "東海道本線", "name:ja": "東海道本線", "name:en": "Tokaido Main Line" })).toBe("Tokaido Main Line");
    expect(transportationLabel({ name: "中央線", "name:ja-Latn": "Chūō-sen" })).toBe("Chūō-sen");
    expect(transportationLabel({ name: "首都高速", ref: "C1" })).toBe("首都高速");
    expect(transportationLabel({ name: "Невский проспект", "name:en": "Nevsky Prospekt" })).toBe("Невский проспект");
    expect(transportationLabel({ name: "Rue de Rivoli", "name:en": "Rivoli Street" })).toBe("Rue de Rivoli");
  });

  it("removes vector-tile buffers before road geometry is projected", () => {
    expect(clipVectorTileLine([
      { x: -2, y: 4 },
      { x: 4, y: 4 },
      { x: 12, y: 4 },
    ], 10)).toEqual([[
      { x: 0, y: 4 },
      { x: 4, y: 4 },
      { x: 10, y: 4 },
    ]]);
  });

  it("retains mapped grades across tile cleanup and keeps bridge approaches separate", () => {
    const bridge = transportGrade({ is_bridge: true });
    expect(bridge).toEqual({ isBridge: true, transportLevel: 1 });
    expect(transportGrade({ bridge: "yes", layer: "2" }).transportLevel).toBe(2);
    expect(transportGrade({ is_tunnel: true }).transportLevel).toBe(-1);
    expect(transportGrade({ is_bridge: false })).toEqual({});
    const segment = (id: string, x: number) => ({ id, kind: "road" as const, transportationClass: "major-road" as const, operation: "engrave" as const, points: [{ x, y: 0 }, { x: x + 1, y: 0 }] });
    const parts = stitchTransportationMarkings([segment("approach", 0), { ...segment("deck", 1), ...bridge }, { ...segment("next tile", 2), ...bridge }]);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ isBridge: true, points: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] });
  });

  it("stitches road pieces across tile edges without joining forks", () => {
    const road = (id: string, points: Array<{ x: number; y: number }>) => ({ id, kind: "road" as const, operation: "engrave" as const, transportationClass: "major-road" as const, label: "Bend Road", points });
    const stitched = stitchTransportationMarkings([
      road("left", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      road("right", [{ x: 0, y: 0 }, { x: 5, y: 4 }, { x: 10, y: 5 }]),
    ]);
    expect(stitched).toHaveLength(1);
    expect(stitched[0]?.points).toEqual([{ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 4 }, { x: 10, y: 5 }]);

    const fork = stitchTransportationMarkings([
      road("west", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      road("east", [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      road("north", [{ x: 0, y: 0 }, { x: 0, y: 10 }]),
    ]);
    expect(fork).toHaveLength(3);
  });
});

describe("administrative boundaries", () => {
  it("selects normalized state and province boundaries without counties or countries", () => {
    expect(isStateProvinceBoundary({ kind: "region", kind_detail: 4 })).toBe(true);
    expect(isStateProvinceBoundary({ kind: "county", kind_detail: 6 })).toBe(false);
    expect(isStateProvinceBoundary({ kind: "country", kind_detail: 2 })).toBe(false);
  });

  it("deduplicates and joins boundary pieces across tile edges", () => {
    const boundary = (id: string, points: Array<{ x: number; y: number }>) => ({ id, kind: "boundary" as const, operation: "engrave" as const, points });
    const cleaned = cleanBoundaryMarkings([
      boundary("west", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      boundary("duplicate", [{ x: 0, y: 0 }, { x: -10, y: 0 }]),
      boundary("east", [{ x: 0, y: 0 }, { x: 10, y: 2 }]),
    ], 0.8);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).toMatchObject({ id: "boundary-0", kind: "boundary", operation: "engrave" });
    expect(cleaned[0]?.points.at(-1)).toEqual({ x: 10, y: 2 });
  });
});

function signedArea(points: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    total += (points[previous]!.x - points[index]!.x) * (points[previous]!.y + points[index]!.y);
  }
  return total / 2;
}

describe("water geometry cleanup", () => {
  const ring = (left: number, top: number, right: number, bottom: number) => [
    { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top },
  ];

  it("dissolves adjacent tile polygons without retaining their shared seam", () => {
    const markings = dissolveWaterPolygons([
      { outer: ring(0, 0, 10, 10), holes: [] },
      { outer: ring(10, 0, 20, 10), holes: [] },
    ], 0.8);
    expect(markings).toHaveLength(1);
    const points = markings[0]!.points;
    expect(points[0]).toEqual(points.at(-1));
    expect(points.some((point, index) => point.x === 10 && points[index + 1]?.x === 10)).toBe(false);
    expect(Math.min(...points.map((point) => point.x))).toBe(0);
    expect(Math.max(...points.map((point) => point.x))).toBe(20);
  });

  it("preserves island shorelines and filters undersized water rings", () => {
    const markings = dissolveWaterPolygons([
      { outer: ring(0, 0, 20, 20), holes: [ring(5, 5, 15, 15)] },
      { outer: ring(30, 30, 30.4, 30.4), holes: [] },
    ], 0.8);
    expect(markings).toHaveLength(2);
    expect(markings.every((marking) => marking.points[0]?.x === marking.points.at(-1)?.x && marking.points[0]?.y === marking.points.at(-1)?.y)).toBe(true);
  });

  it("keeps the filled shape, wound as the geometry engine expects", () => {
    const areas = dissolveTilePolygons([
      { outer: ring(0, 0, 20, 20), holes: [ring(5, 5, 15, 15)] },
    ], 0.8);
    expect(areas).toHaveLength(1);
    const area = areas[0]!;
    // Outer rings wind positively and holes negatively, per the Polygon2D contract.
    expect(signedArea(area.outer)).toBeGreaterThan(0);
    expect(area.holes).toHaveLength(1);
    expect(signedArea(area.holes[0]!)).toBeLessThan(0);
  });

  it("lets a lake win over the ocean polygon covering it", () => {
    const lake = {
      id: "lake-7",
      kind: "lake" as const,
      hylakId: 7,
      polygon: { outer: ring(4, 4, 8, 8), holes: [] },
    };
    const combined = combineWaterAreas([lake], [{ outer: ring(0, 0, 20, 20), holes: [] }], 0.8);
    // Both sources describe the same water, so the ocean is cut back to a ring
    // around the lake rather than being drawn over the carved recess.
    const ocean = combined.filter((area) => area.kind === "ocean");
    expect(ocean).toHaveLength(1);
    expect(ocean[0]?.polygon.holes).toHaveLength(1);
    expect(combined.filter((area) => area.kind === "lake")).toEqual([lake]);
  });

  it("deduplicates and stitches waterways while preserving forks", () => {
    const water = (id: string, points: Array<{ x: number; y: number }>) => ({ id, kind: "water" as const, operation: "score" as const, points });
    const continuous = cleanWaterwayMarkings([
      water("left", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      water("duplicate", [{ x: 0, y: 0 }, { x: -10, y: 0 }]),
      water("right", [{ x: 0, y: 0 }, { x: 10, y: 2 }]),
      water("tiny", [{ x: 30, y: 0 }, { x: 30.2, y: 0 }]),
    ], 0.8);
    expect(continuous).toHaveLength(1);
    expect(continuous[0]?.points[0]).toEqual({ x: -10, y: 0 });
    expect(continuous[0]?.points.at(-1)).toEqual({ x: 10, y: 2 });

    const fork = cleanWaterwayMarkings([
      water("west", [{ x: -10, y: 0 }, { x: 0, y: 0 }]),
      water("east", [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      water("north", [{ x: 0, y: 0 }, { x: 0, y: 10 }]),
    ], 0.8);
    expect(fork).toHaveLength(3);
  });
});

const getHeaderMock = vi.hoisted(() => vi.fn());
const getZxyMock = vi.hoisted(() => vi.fn());
const vectorFixture = vi.hoisted(() => ({ outsideRoads: 0, insideRoads: 1, uniqueNames: false, stationPoints: 1, cornerBuildings: 0, waterRings: 0 }));
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
    layers;

    constructor(reader: PbfReader) {
      const detailByte = reader.buf[0];
      const denseBuildings = detailByte === 24;
      const coarser = detailByte === 1;
      const roadY = coarser ? 3072 : 2048;
      const outsideRoads = coarser ? 0 : vectorFixture.outsideRoads;
      const insideRoads = coarser ? 1 : vectorFixture.insideRoads;
      const waterRings = coarser && vectorFixture.waterRings ? 1 : vectorFixture.waterRings;
      const shore = [
        { x: 0, y: roadY - 500 }, { x: 4096, y: roadY - 500 },
        { x: 4096, y: roadY + 500 }, { x: 0, y: roadY + 500 },
        { x: 0, y: roadY - 500 },
      ];
      this.layers = {
        ...(detailByte === 14 || denseBuildings ? { building: { name: "building", length: denseBuildings ? 500 : 2, feature: (index: number) => {
          const x = denseBuildings ? 1000 + (index % 25) * 60 : 1850, y = denseBuildings ? 1000 + Math.floor(index / 25) * 60 : 1850;
          const size = denseBuildings ? 40 : 390;
          return { id: index, type: 3, extent: 4096, properties: { render_min_height: denseBuildings ? 0 : index * 4 },
            loadGeometry: () => [[{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }, { x, y }]] };
        } } } : {}),
        pois: { length: 1, feature: () => ({ type: 1, extent: 4096, properties: { kind: "station" }, loadGeometry: () => [Array(vectorFixture.stationPoints).fill({ x: 2048, y: 2048 })] }) },
        transportation: { length: 3, feature: (index: number) => ({
          type: 2, extent: 4096, properties: { kind: "rail", kind_detail: "rail", is_tunnel: index === 1 },
          loadGeometry: () => {
            const x = [1850, 1998, 2098, 2200];
            return [[{ x: x[index], y: 2048 }, { x: x[index + 1], y: 2048 }]];
          },
        }) },
        buildings: { length: 2, feature: (index: number) => ({
          type: 3, extent: 4096, properties: { kind: index === 0 ? "building" : "building_part" },
          loadGeometry: () => {
            const square = (x: number, y: number, size: number) => [
              { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }, { x, y },
            ];
            if (index === 1) return [square(2150, 2020, 20)];
            if (vectorFixture.cornerBuildings) return [
              ...Array.from({ length: vectorFixture.cornerBuildings }, (_, i) => square(1005 + (i % 43) * 5, 1005 + Math.floor(i / 43) * 5, 3)), square(2000, 2000, 30),
            ];
            return [square(1950, 1950, 100), square(1980, 1980, 40).reverse(), square(2130, 2020, 1), square(100, 100, 50)];
          },
        }) },
        roads: {
          length: outsideRoads + insideRoads,
          feature: (index: number) => ({
            type: 2, extent: 4096,
            properties: { kind: "major_road", name: vectorFixture.uniqueNames ? `Road ${index}` : "Rim Drive" },
            loadGeometry: () => {
              const y = index < outsideRoads ? 0 : roadY;
              return [[{ x: 0, y }, { x: 4096, y }]];
            },
          }),
        },
        water: {
          length: waterRings ? 1 : 0,
          feature: () => ({
            type: 3, extent: 4096, properties: { kind: "ocean" },
            loadGeometry: () => Array.from({ length: waterRings }, () => shore),
          }),
        },
      };
    }
  },
}));

describe("geographic crop bounds", () => {
  it("centers finite bounds on the selected location", () => {
    const bounds = boundsForProject(DEFAULT_PROJECT);
    expect(bounds.west).toBeLessThan(DEFAULT_PROJECT.location.lon);
    expect(bounds.east).toBeGreaterThan(DEFAULT_PROJECT.location.lon);
    expect(bounds.south).toBeLessThan(DEFAULT_PROJECT.location.lat);
    expect(bounds.north).toBeGreaterThan(DEFAULT_PROJECT.location.lat);
  });

  it("keeps antimeridian crops continuous in an unwrapped longitude window", () => {
    const project = { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, lat: 0, lon: 179.99, zoom: 11 } };
    const bounds = boundsForProject(project);
    expect(bounds.west).toBeLessThan(180);
    expect(bounds.east).toBeGreaterThan(180);
    expect(bounds.east - bounds.west).toBeLessThan(1);
    expect(bounds.south).toBeLessThan(0);
    expect(bounds.north).toBeGreaterThan(0);
  });

  it("fits the map area to the cut aspect ratio while proportional resizing keeps the area", () => {
    const original = boundsForProject(DEFAULT_PROJECT);
    expect(boundsForProject({ ...DEFAULT_PROJECT, widthMm: DEFAULT_PROJECT.widthMm * 2, heightMm: DEFAULT_PROJECT.heightMm * 2 })).toEqual(original);
    for (const [widthMm, heightMm] of [[400, 100], [100, 400], [200, 200]] as const) {
      for (const location of [DEFAULT_PROJECT.location, { ...DEFAULT_PROJECT.location, bounds: original }]) {
        const bounds = boundsForProject({ ...DEFAULT_PROJECT, location, widthMm, heightMm });
        const radians = Math.PI / 180;
        const mapAspect = (bounds.east - bounds.west) * radians / (Math.asinh(Math.tan(bounds.north * radians)) - Math.asinh(Math.tan(bounds.south * radians)));
        expect(mapAspect).toBeCloseTo(widthMm / heightMm, 7);
        expect(bounds.west).toBeGreaterThanOrEqual(original.west - 1e-9);
        expect(bounds.east).toBeLessThanOrEqual(original.east + 1e-9);
        expect(bounds.north).toBeLessThanOrEqual(original.north + 1e-9);
        expect(bounds.south).toBeGreaterThanOrEqual(original.south - 1e-9);
        expect(boundsForProject({ ...DEFAULT_PROJECT, location: { ...location, bounds }, widthMm, heightMm })).toEqual(bounds);
      }
    }
  });
});

describe("vector marking zoom", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    vectorFixture.stationPoints = 1;
    vectorFixture.cornerBuildings = 0;
    vectorFixture.outsideRoads = 0;
    vectorFixture.insideRoads = 1;
    vectorFixture.uniqueNames = false;
    vectorFixture.waterRings = 0;
    getHeaderMock.mockReset();
    getZxyMock.mockReset();
    getZxyMock.mockResolvedValue(undefined);
  });

  it("recognizes a station passage even when both portals are outside the crop and crops the real geometry", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    const bounds = { west: 0.0437, east: 0.0442, south: 0.0437, north: 0.0442 };
    const config = { ...DEFAULT_PROJECT, showRail: true, showRoads: false, widthMm: 100, heightMm: 100 };
    const data = await loadVectorMarkings(bounds, 15, config);
    expect(data.markings).toHaveLength(1);
    expect(data.markings[0]).toMatchObject({ kind: "road", transportationClass: "covered-rail", operation: "engrave" });
    expect(data.markings[0]!.points[0]!.x).toBeCloseTo(-54);
    expect(data.markings[0]!.points.at(-1)!.x).toBeCloseTo(54);
    expect((await loadVectorMarkings(bounds, 15, { ...config, showRail: false })).markings).toEqual([]);
  });

  it("flags failed auxiliary reads and exhausted evidence budgets while retaining selected roads", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    const bounds = { west: 0.042, east: 0.0877, south: 0.042, north: 0.046 };
    const config = { ...DEFAULT_PROJECT, showRail: true, showRoads: true };
    getZxyMock.mockImplementation(async (_z, x) => {
      if (x !== 2048) throw new Error("neighbor is unavailable");
      return { data: new ArrayBuffer(0) };
    });
    const missing = await loadVectorMarkings(bounds, 15, config);
    expect(missing.railContextIncomplete).toBe(true);
    expect(missing.markings.some(line => line.transportationClass === "major-road")).toBe(true);
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    vectorFixture.stationPoints = 200_001;
    const dense = await loadVectorMarkings(bounds, 15, config);
    expect(dense.railContextIncomplete).toBe(true);
    expect(dense.markings.some(line => line.transportationClass === "rail")).toBe(true);
  });

  it("reserves the circular crop's marking budget for visible footprints", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    vectorFixture.cornerBuildings = 1849;
    const unit = 360 / 4096 / 4096;
    const bounds = { west: 1000 * unit, east: 3000 * unit, south: (4096 - 3000) * unit, north: (4096 - 1000) * unit };
    const config = { ...DEFAULT_PROJECT, showBuildings: true, showRoads: false, cropShape: "circle" as const,
      widthMm: 200, heightMm: 200, minimumFeatureMm: 0.2, location: { ...DEFAULT_PROJECT.location, zoom: 13 } };
    const { markings, truncated } = await loadVectorMarkings(bounds, 13, config);
    expect(truncated).toBe(false);
    expect(markings.filter(mark => mark.kind === "building")).toHaveLength(1);
  });

  it("loads printable footprints and courtyards at display zoom 13 even when the archive ends at 12", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    const load = (zoom: number, showBuildings: boolean) => loadVectorMarkings(
      { west: 0.04, east: 0.05, south: 0.04, north: 0.05 }, 13,
      { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, zoom }, showBuildings, showRoads: false, minimumFeatureMm: 1 },
    );
    expect((await load(13, false)).markings).toEqual([]);
    expect((await load(12.99, true)).markings).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    const { markings, truncated, buildingDetail } = await load(13, true);
    expect(buildingDetail).toMatchObject({ zoom: 12 });
    expect(truncated).toBe(false);
    expect(markings.map(({ id, kind, operation }) => [id, kind, operation])).toEqual([
      ["building-0-0", "building", "engrave"], ["building-0-1", "building", "engrave"],
    ]);
    expect(markings.every(({ points }) => points.length === 5 && points[0]!.x === points[4]!.x && points[0]!.y === points[4]!.y)).toBe(true);
  });

  it("uses one detailed release for the crop, including successful empty tiles", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    const bounds = { west: 0.040, east: 0.070, south: 0.040, north: 0.070 };
    const project = { ...DEFAULT_PROJECT, showBuildings: true, location: { ...DEFAULT_PROJECT.location, zoom: 13 } };
    const fetchDetail = vi.fn(async (url: string) => url.endsWith("/v1/buildings") ? Response.json({ release: "test-build" }) :
      new Response(Uint8Array.of(14)));
    vi.stubGlobal("fetch", fetchDetail);
    const detailed = await loadVectorMarkings(bounds, 13, project);
    expect(detailed.buildingDetail).toEqual({ zoom: 14, release: "test-build" });
    // Only the center z14 tile has its square inside the crop.
    const outlines = detailed.markings.filter(mark => mark.kind === "building");
    expect(outlines).toHaveLength(1);
    const westWallLon = (8194 + 1850 / 4096) * 360 / 2 ** 14 - 180;
    expect(outlines[0]!.points[0]!.x).toBeCloseTo(((westWallLon - bounds.west) / (bounds.east - bounds.west) - 0.5) * project.widthMm);
    expect(fetchDetail.mock.calls.slice(1).every(([url]) => url.includes("/buildings/test-build/14/"))).toBe(true);
    fetchDetail.mockImplementation(async url => url.endsWith("/v1/buildings") ? Response.json({ release: "test-build" }) : new Response(new Uint8Array()));
    const empty = await loadVectorMarkings(bounds, 13, project);
    expect(empty.buildingDetail).toEqual(detailed.buildingDetail);
    expect(empty.markings.filter(mark => mark.kind === "building")).toHaveLength(0);
    expect(empty.markings.filter(mark => mark.kind === "road")).toEqual(detailed.markings.filter(mark => mark.kind === "road"));

    fetchDetail.mockImplementation(async url => url.endsWith("/v1/buildings") ? Response.json({ release: "test-build" }) :
      url.includes("/8194/") ? new Response(null, { status: 503 }) : new Response(Uint8Array.of(14)));
    const fallback = await loadVectorMarkings(bounds, 13, project);
    expect(fallback.buildingDetail).toMatchObject({ zoom: 12 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    expect(fallback.markings).toEqual((await loadVectorMarkings(bounds, 13, project)).markings);
  });

  it("fits a crowded neighborhood using complete footprints from the same release at z13", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    const fetchDetail = vi.fn(async (url: string) => url.endsWith("/v1/buildings") ? Response.json({ release: "city" }) :
      new Response(Uint8Array.of(url.includes("/city/14/") ? 24 : 14)));
    vi.stubGlobal("fetch", fetchDetail);
    const bounds = { west: 0.0001, east: 0.0438, south: 0.0001, north: 0.0438 };
    const project = { ...DEFAULT_PROJECT, showBuildings: true, minimumFeatureMm: 0.2, location: { ...DEFAULT_PROJECT.location, zoom: 13 } };
    const result = await loadVectorMarkings(bounds, 13, project);
    expect(result).toMatchObject({ buildingDetail: { zoom: 13, release: "city" }, truncated: false });
    expect(result.markings.filter(mark => mark.kind === "building")).toHaveLength(1);
    expect(fetchDetail.mock.calls.filter(([url]) => url.includes("/city/14/"))).toHaveLength(4);
    expect(getZxyMock.mock.calls.every(([zoom]) => zoom === 12)).toBe(true);
  });

  it("does not let off-crop roads exhaust the feature budget", async () => {
    vectorFixture.outsideRoads = 3000;
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    const result = await loadVectorMarkings({ west: 0.04, east: 0.05, south: 0.04, north: 0.05 }, 15, DEFAULT_PROJECT);
    expect(result.truncated).toBe(false);
    expect(result.markings).toHaveLength(1);
    expect(result.markings[0]?.label).toBe("Rim Drive");
  });

  it("shares cleanup headroom with a dense tile when neighboring tiles are empty", async () => {
    vectorFixture.insideRoads = 1500;
    vectorFixture.uniqueNames = true;
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValueOnce({ data: new ArrayBuffer(0) });
    const result = await loadVectorMarkings({ west: 0.001, east: 0.17, south: 0.001, north: 0.08 }, 12, DEFAULT_PROJECT);
    expect(getZxyMock).toHaveBeenCalledTimes(2);
    expect(result.truncated).toBe(false);
    expect(result.markings).toHaveLength(1500);
  });

  it("bounds raw linework even when repeated fragments collapse during cleanup", async () => {
    vectorFixture.insideRoads = 7400;
    getHeaderMock.mockResolvedValue({ minZoom: 12, maxZoom: 12 });
    getZxyMock.mockResolvedValueOnce({ data: new ArrayBuffer(0) });
    const result = await loadVectorMarkings({ west: 0.001, east: 0.17, south: 0.001, north: 0.08 }, 12, DEFAULT_PROJECT);
    expect(result.markings).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it.each([
    { limit: "export marks", roads: MAX_VECTOR_MARKINGS, rings: 1 },
    { limit: "source rings", roads: 1, rings: MAX_SOURCE_RINGS + 1 },
  ])("uses the next tile level when adding water exceeds the $limit limit", async ({ roads, rings }) => {
    vectorFixture.insideRoads = roads;
    vectorFixture.uniqueNames = true;
    vectorFixture.waterRings = rings;
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockImplementation(async (zoom: number) => ({ data: Uint8Array.of(zoom === 11 ? 1 : 0).buffer }));
    const bounds = { west: 0.04, east: 0.05, south: 0.04, north: 0.05 };
    const config = { ...DEFAULT_PROJECT, outputMode: "engraving" as const };

    const withWater = await loadVectorMarkings(bounds, 11, config);
    expect(getZxyMock.mock.calls.map(([zoom]) => zoom)).toEqual([12, 11]);
    expect(withWater.truncated).toBe(false);
    expect(withWater.ocean).toHaveLength(1);
    expect(withWater.markings.map((marking) => marking.kind)).toEqual(["road", "water"]);

    getZxyMock.mockClear();
    const withoutWater = await loadVectorMarkings(bounds, 11, { ...config, showWater: false });
    expect(getZxyMock.mock.calls.map(([zoom]) => zoom)).toEqual([12]);
    expect(withoutWater.markings).toHaveLength(roads);
  });

  it("keeps requested neighborhood footprints at their resolved archive zoom on a crowded map", async () => {
    vectorFixture.insideRoads = MAX_VECTOR_MARKINGS;
    vectorFixture.uniqueNames = true;
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    const bounds = { west: 0.04, east: 0.05, south: 0.04, north: 0.05 };
    const config = { ...DEFAULT_PROJECT, showBuildings: true, location: { ...DEFAULT_PROJECT.location, zoom: 13 } };
    const data = await loadVectorMarkings(bounds, 13, config);
    expect(getZxyMock.mock.calls.map(([zoom]) => zoom)).toEqual([12]);
    expect(data.truncated).toBe(true);
    expect(data.markings.some(mark => mark.kind === "building")).toBe(true);
  });

  it("propagates tile failures without retrying at a different zoom", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    const failure = new Error("Archive changed during generation. Try generating again.");
    getZxyMock.mockRejectedValue(failure);
    await expect(loadVectorMarkings({ west: 0.04, east: 0.05, south: 0.04, north: 0.05 }, 11, DEFAULT_PROJECT)).rejects.toBe(failure);
    expect(getZxyMock).toHaveBeenCalledTimes(1);
  });

  it("retains transportation names when their display is initially disabled", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 15 });
    getZxyMock.mockResolvedValue({ data: new ArrayBuffer(0) });
    const result = await loadVectorMarkings(boundsForProject(DEFAULT_PROJECT), 11, { ...DEFAULT_PROJECT, showTransportationLabels: false });
    expect(result.markings.length).toBeGreaterThan(0);
    expect(result.markings.every((marking) => marking.label === "Rim Drive")).toBe(true);
  });

  it("requests one extra vector zoom for local roads and trails", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 15 });
    const bounds = boundsForProject(DEFAULT_PROJECT);
    await loadVectorMarkings(bounds, 11.43, DEFAULT_PROJECT);
    expect(getZxyMock).toHaveBeenCalled();
    for (const call of getZxyMock.mock.calls) {
      expect(call[0]).toBe(12);
      expect(Number.isInteger(call[1])).toBe(true);
      expect(Number.isInteger(call[2])).toBe(true);
    }
  });

  it("wraps archive requests while preserving continuous dateline geometry", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    const project = { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, lat: 0, lon: 179.99, zoom: 11 } };
    await loadVectorMarkings(boundsForProject(project), 11, project);
    const requestedX = getZxyMock.mock.calls.map((call) => call[1] as number);
    expect(requestedX.length).toBeGreaterThan(0);
    expect(requestedX.every((x) => Number.isInteger(x) && x >= 0 && x < 2 ** 12)).toBe(true);
    expect(requestedX).toContain(0);
    expect(requestedX).toContain(2 ** 12 - 1);
  });

  it("clamps the rounded zoom to the archive range", async () => {
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 11 });
    const bounds = boundsForProject(DEFAULT_PROJECT);
    await loadVectorMarkings(bounds, 11.6, DEFAULT_PROJECT);
    expect(getZxyMock).toHaveBeenCalled();
    for (const call of getZxyMock.mock.calls) expect(call[0]).toBe(11);
  });

  it("bounds work for a near-world selection imported at maximum zoom", () => {
    expect(fittingTileWindow({ west: -180, east: 180, south: -85, north: 85 }, 15).zoom).toBeLessThanOrEqual(2);
  });

  it("reduces oversized statewide requests to a bounded tile window", () => {
    const colorado = { west: -109.06, east: -102.04, south: 36.99, north: 41.01 };
    expect(fittingTileWindow(colorado, 11).zoom).toBeLessThan(11);
    expect(fittingTileWindow(boundsForProject(DEFAULT_PROJECT), 11).zoom).toBe(11);
  });
});


describe("canonical lake shorelines", () => {
  const polygon = { outer: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }, { x: -10, y: -10 }], holes: [] };
  it("keeps inland shorelines when engraving a selection that also includes the ocean", () => {
    const source = { ...createSyntheticSource(DEFAULT_PROJECT), waterAreas: [{ id: "ocean", kind: "ocean" as const, polygon }], inlandWaterAreas: [polygon] };
    const result = applyLakeShorelines(source, { ...DEFAULT_PROJECT, outputMode: "engraving", showWater: true });
    expect(result.waterPatternAreas).toHaveLength(2);
    expect(result.markings.filter((m) => m.id.startsWith("water-area-"))).toHaveLength(2);
  });
  it("shows a provider shore even without a modeled or surveyed floor", () => {
    const source = { ...createSyntheticSource(DEFAULT_PROJECT), waterAreas: [{ id: "survey", kind: "lake" as const, polygon }], markings: [] };
    const result = applyLakeShorelines(source, { ...DEFAULT_PROJECT, showWater: true });
    expect(result.markings[0]?.points).toEqual(polygon.outer);
    expect(result.waterPatternAreas).toEqual([polygon]);
  });
});
