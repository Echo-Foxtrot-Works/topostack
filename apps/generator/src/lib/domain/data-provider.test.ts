import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, type MarkingFeature } from "@topostack/core";
import { applyLakeShorelines, boundsForProject, classifyTransportation, cleanBoundaryMarkings, cleanWaterwayMarkings, clipVectorTileLine, combineWaterAreas, dissolveWaterAreas, dissolveWaterPolygons, isStateProvinceBoundary, limitVectorMarkingGroups, loadVectorMarkings, stitchTransportationMarkings, transportationLabel } from "$lib/domain/data-provider";
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
    expect(classifyTransportation({ kind: "rail", kind_detail: "light_rail" })).toBeUndefined();
    expect(classifyTransportation({ kind: "ferry", kind_detail: "path" })).toBeUndefined();
  });

  it("prefers names and falls back to route references", () => {
    expect(transportationLabel({ name: "Rim Drive", ref: "OR 62" })).toBe("Rim Drive");
    expect(transportationLabel({ ref: "OR 62", shield_text: "62" })).toBe("OR 62");
    expect(transportationLabel({ shield_text: "62" })).toBe("62");
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
    const areas = dissolveWaterAreas([
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
const vectorFixture = vi.hoisted(() => ({ outsideRoads: 0, insideRoads: 1, uniqueNames: false }));
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
    layers = { roads: { length: vectorFixture.outsideRoads + vectorFixture.insideRoads, feature: (index: number) => ({ type: 2, extent: 4096, properties: { kind: "major_road", name: vectorFixture.uniqueNames ? `Road ${index}` : "Rim Drive" }, loadGeometry: () => [[{ x: 0, y: index < vectorFixture.outsideRoads ? 0 : 2048 }, { x: 4096, y: index < vectorFixture.outsideRoads ? 0 : 2048 }]] }) } };
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
  beforeEach(() => {
    vectorFixture.outsideRoads = 0;
    vectorFixture.insideRoads = 1;
    vectorFixture.uniqueNames = false;
    getHeaderMock.mockReset();
    getZxyMock.mockReset();
    getZxyMock.mockResolvedValue(undefined);
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
    getHeaderMock.mockResolvedValue({ minZoom: 4, maxZoom: 12 });
    getZxyMock.mockResolvedValueOnce({ data: new ArrayBuffer(0) });
    const result = await loadVectorMarkings({ west: 0.001, east: 0.17, south: 0.001, north: 0.08 }, 12, DEFAULT_PROJECT);
    expect(result.markings).toHaveLength(1);
    expect(result.truncated).toBe(true);
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
