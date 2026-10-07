import { afterEach, describe, expect, it, vi } from "vitest";
import { groundWidthMFor, type GeoBounds, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1 } from "@topostack/core";
import { loadTerrain } from "$lib/domain/data-provider";
import { preparePreview, previewBounds, type PreviewLake } from "$lib/site/lake-preview/prepare";

vi.mock("$lib/domain/data-provider", () => ({ loadTerrain: vi.fn() }));

afterEach(() => { vi.mocked(loadTerrain).mockReset(); });

const SIZE = 81;
const lake: PreviewLake = { name: "Round Lake", sourceId: "round", surveyId: "noaa-1", bounds: [10, 45, 10.1, 45.07] };

/** A rectangle in artwork millimeters, as fractions of the material's half width and height. */
const rect = (config: ProjectConfigV1, [x0, y0, x1, y1]: [number, number, number, number]): Polygon2D => {
  const [w, h] = [config.widthMm / 2, config.heightMm / 2];
  return { outer: [{ x: x0 * w, y: y0 * h }, { x: x1 * w, y: y0 * h }, { x: x1 * w, y: y1 * h }, { x: x0 * w, y: y1 * h }, { x: x0 * w, y: y0 * h }], holes: [] };
};
/** The grid cell under a point given as fractions of the half width and height, row 0 at the north edge. */
const cell = (x: number, y: number) => Math.round((y + 1) / 2 * (SIZE - 1)) * SIZE + Math.round((x + 1) / 2 * (SIZE - 1));
const inside = (index: number, [x0, y0, x1, y1]: [number, number, number, number]) => {
  const x = (index % SIZE) / (SIZE - 1) * 2 - 1;
  const y = Math.floor(index / SIZE) / (SIZE - 1) * 2 - 1;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
};

const CENTRAL: [number, number, number, number] = [-0.3, -0.3, 0.3, 0.3];
// A quarry in the frame's south-east margin, outside the lake's survey box.
const QUARRY: [number, number, number, number] = [0.88, 0.88, 0.97, 0.97];

/** Flat land at 300 m holding a surveyed lake (12 m everywhere surveyed) and a deep modeled quarry. */
function terrain(config: ProjectConfigV1, overrides: { areas?: (config: ProjectConfigV1) => WaterAreaV1[]; source?: Partial<SourceBundleV1> } = {}): SourceBundleV1 {
  const values = new Float32Array(SIZE * SIZE).fill(300);
  const depthsM = new Float32Array(SIZE * SIZE).map((_, index) => inside(index, CENTRAL) ? 12 : Number.NaN);
  const areas = overrides.areas?.(config) ?? [
    { id: "round", kind: "lake", name: "Round Lake", polygon: rect(config, CENTRAL), bathymetry: { width: SIZE, height: SIZE, depthsM } },
    { id: "quarry", kind: "lake", name: "Quarry", polygon: rect(config, QUARRY), maxDepthM: 40 },
  ];
  return {
    schemaVersion: 1,
    elevation: { width: SIZE, height: SIZE, values, min: 300, max: 300 },
    markings: [],
    waterAreas: areas,
    vectorStatus: "available",
    lakeDataStatus: "available",
    bathymetryStatus: "available",
    datasetVersion: "terrain-2026-09",
    sourceKind: "real",
    bounds: config.location.bounds as GeoBounds,
    imagerySources: [],
    attribution: [],
    ...overrides.source,
  };
}

const serve = (overrides: Parameters<typeof terrain>[1] = {}, fallback = false) =>
  vi.mocked(loadTerrain).mockImplementation(async (config) => ({ fallback, source: terrain(config, overrides) }));

describe("lake page preview data", () => {
  it("loads the studio link's framing as a true-scale stack with only water drawn", async () => {
    serve();
    const signal = new AbortController().signal;
    const prepared = await preparePreview(lake, signal);
    const [config, passedSignal] = vi.mocked(loadTerrain).mock.calls[0]!;
    expect(passedSignal).toBe(signal);
    const bounds = previewBounds(lake.bounds);
    expect(config).toMatchObject({
      name: "Round Lake",
      location: { label: "Round Lake", bounds, lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2, zoom: 13 },
      widthMm: 400, outputMode: "stack", showWaterDepth: true, waterDepthExaggeration: 1,
      showRoads: false, showTrails: false, showBoundaries: false, showCoordinateGrid: false,
    });
    // The material keeps the frame's Mercator shape.
    expect(config.heightMm / config.widthMm).toBeCloseTo(0.98, 1);
    expect(prepared).toMatchObject({ bounds, datasetVersion: "terrain-2026-09", bathymetryStatus: "available" });
    expect(prepared.input).toMatchObject({ width: SIZE, height: SIZE, groundWidthM: groundWidthMFor(bounds) });
  });

  it("frames the map in about three tiles, within the zooms the studio offers", async () => {
    serve();
    const zoomFor = async (bounds: PreviewLake["bounds"]) => {
      vi.mocked(loadTerrain).mockClear();
      await preparePreview({ ...lake, bounds });
      return vi.mocked(loadTerrain).mock.calls[0]![0].location.zoom;
    };
    // 0.116 degrees across: 3 × 360 / 0.116 is about 2^13.
    expect(await zoomFor(lake.bounds)).toBe(13);
    expect(await zoomFor([-90, 40, -30, 50])).toBe(4);
    expect(await zoomFor([-150, 10, 150, 60])).toBe(3);
    expect(await zoomFor([10, 45, 10.001, 45.001])).toBe(14);
  });

  it("measures depth below each lake's waterline and marks only surveyed water", async () => {
    serve();
    const { input } = await preparePreview(lake);
    const lakeCenter = cell(0, 0), quarry = cell(0.93, 0.93), land = cell(-0.8, 0.6);
    expect(input.water[lakeCenter]).toBe(1);
    expect(input.depth[lakeCenter]).toBeCloseTo(12, 4);
    expect(input.surveyed[lakeCenter]).toBe(1);
    expect(input.elevation[lakeCenter]).toBeCloseTo(288, 4);
    expect(input.water[quarry]).toBe(1);
    expect(input.depth[quarry]).toBeGreaterThan(0);
    expect(input.surveyed[quarry]).toBe(0);
    expect(input.water[land]).toBe(0);
    expect(input.depth[land]).toBeNaN();
  });

  it("picks the lake out by its survey box, so other water cannot set the depth scale", async () => {
    serve();
    const { input } = await preparePreview(lake);
    expect(input.target[cell(0, 0)]).toBe(1);
    expect(input.target[cell(0.93, 0.93)]).toBe(0);
    expect(input.target[cell(-0.8, 0.6)]).toBe(0);
  });

  it("prefers the surface whose survey outline names the lake", async () => {
    // The named outline is the small one; the large lake in the box is someone else's.
    serve({ areas: (config) => [
      { id: "other", kind: "lake", polygon: rect(config, CENTRAL), maxDepthM: 10 },
      { id: "round", kind: "lake", polygon: rect(config, QUARRY), maxDepthM: 10, surveyId: "noaa-1", outlineSourceId: "round" },
    ] });
    const { input } = await preparePreview(lake);
    expect(input.target[cell(0, 0)]).toBe(0);
    expect(input.target[cell(0.93, 0.93)]).toBe(1);
  });

  it("refuses to render sample terrain, a frame without the lake, or a lake without its survey", async () => {
    serve({}, true);
    await expect(preparePreview(lake)).rejects.toThrow("Round Lake: real terrain unavailable");
    serve({ areas: () => [], source: { lakeDataStatus: "unavailable", vectorStatus: "partial" } });
    await expect(preparePreview(lake)).rejects.toThrow("no lake outline in frame (lake data unavailable, map data partial)");
    serve({ areas: (config) => [{ id: "pond", kind: "lake", polygon: rect(config, QUARRY), maxDepthM: 5 }] });
    await expect(preparePreview(lake)).rejects.toThrow(/^no lake outline in frame/);
    for (const status of ["unavailable", "not-covered"] as const) {
      serve({ source: { bathymetryStatus: status } });
      await expect(preparePreview(lake)).rejects.toThrow(`survey depths ${status}`);
    }
  });

  it("leaves the survey status out when the source reports none", async () => {
    serve({ source: { bathymetryStatus: undefined } });
    expect(await preparePreview(lake)).not.toHaveProperty("bathymetryStatus");
  });
});
