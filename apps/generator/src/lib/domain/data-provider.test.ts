import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, type ProjectConfigV1, type WaterAreaV1 } from "@topostack/core";
import { loadAirspace, loadAviation, loadSurveyedLakeDepths, loadTerrain } from "$lib/domain/data-provider";

const mocks = vi.hoisted(() => ({
  loadElevation: vi.fn(),
  loadVectorMarkings: vi.fn(),
  loadLakeAreas: vi.fn(),
  loadLakeBathymetry: vi.fn(),
  loadAviationMarkings: vi.fn(),
  loadAirspaceVolumes: vi.fn(),
  loadUserCharts: vi.fn(),
  applyUserCharts: vi.fn(),
}));
vi.mock("$lib/domain/elevation-loader", () => ({ loadElevation: mocks.loadElevation }));
vi.mock("$lib/domain/vector-loader", () => ({ loadVectorMarkings: mocks.loadVectorMarkings }));
vi.mock("$lib/domain/lake-area-loader", () => ({ loadLakeAreas: mocks.loadLakeAreas }));
vi.mock("$lib/domain/bathymetry", async (importOriginal) => ({ ...await importOriginal<typeof import("$lib/domain/bathymetry")>(), loadLakeBathymetry: mocks.loadLakeBathymetry }));
vi.mock("$lib/domain/aviation-provider", () => ({ loadAviationMarkings: mocks.loadAviationMarkings }));
vi.mock("$lib/domain/airspace-volumes", () => ({ loadAirspaceVolumes: mocks.loadAirspaceVolumes }));
vi.mock("$lib/storage/user-charts", () => ({ loadUserCharts: mocks.loadUserCharts }));
vi.mock("$lib/domain/user-bathymetry", () => ({ applyUserCharts: mocks.applyUserCharts }));

const { elevation } = createSyntheticSource(DEFAULT_PROJECT, 16);
const square = (size: number) => ({ outer: [{ x: -size, y: -size }, { x: size, y: -size }, { x: size, y: size }, { x: -size, y: size }], holes: [] });
const lake: WaterAreaV1 = { id: "lake-42-0", kind: "lake", hylakId: 42, name: "Crater Lake", polygon: square(20) };
const terrainOnly: ProjectConfigV1 = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showBoundaries: false, showWater: false, showWaterDepth: false, paintTemplates: [] };
const withAviation: ProjectConfigV1 = { ...terrainOnly, aviation: { airspace: false, specialUse: false, runways: false, airports: true, navaids: false, obstacles: false, labels: false } };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.loadElevation.mockResolvedValue({ elevation, elevationRepairCount: 0, imagerySources: ["mapzen/12/1/1"], datasetVersion: "mapzen-test", terrainAttribution: [], terrainSourceUnavailable: false });
  mocks.loadVectorMarkings.mockResolvedValue({ markings: [], inland: [square(20)], ocean: [], truncated: false });
  mocks.loadLakeAreas.mockResolvedValue([lake]);
  mocks.loadLakeBathymetry.mockImplementation(async (_api, _bounds, _grid, _zoom, areas: WaterAreaV1[]) => ({ areas, status: "not-covered", datasetVersions: [], attribution: [] }));
});

describe("loadTerrain", () => {
  it("loads only what the project uses and reports each source's status", async () => {
    const stages: string[] = [];
    const { source, fallback } = await loadTerrain(terrainOnly, undefined, (stage) => stages.push(stage));
    expect(fallback).toBe(false);
    expect(stages).toEqual(["fetching", "preparing"]);
    expect(mocks.loadVectorMarkings).not.toHaveBeenCalled();
    expect(mocks.loadLakeAreas).not.toHaveBeenCalled();
    expect(mocks.loadAviationMarkings).not.toHaveBeenCalled();
    expect(source).toMatchObject({ sourceKind: "real", datasetVersion: "mapzen-test", vectorStatus: "not-requested", lakeDataStatus: "not-requested" });
  });

  it("models lakes from their outlines and surveys when water depth is on", async () => {
    const { source, fallback } = await loadTerrain(DEFAULT_PROJECT);
    expect(fallback).toBe(false);
    expect(mocks.loadLakeBathymetry).toHaveBeenCalledOnce();
    expect(source.vectorStatus).toBe("available");
    expect(source.lakeDataStatus).toBe("available");
    expect(source.waterAreas?.some((area) => area.hylakId === 42)).toBe(true);
  });

  it("marks map detail partial when the vector budget ran out", async () => {
    mocks.loadVectorMarkings.mockResolvedValue({ markings: [], inland: [], ocean: [], truncated: true });
    expect((await loadTerrain(DEFAULT_PROJECT)).source.vectorStatus).toBe("partial");
  });

  it("keeps real terrain when map detail or lake outlines fail", async () => {
    mocks.loadVectorMarkings.mockRejectedValue(new Error("vector archive offline"));
    mocks.loadLakeAreas.mockRejectedValue(new Error("lake archive offline"));
    const { source, fallback } = await loadTerrain(DEFAULT_PROJECT);
    expect(fallback).toBe(false);
    expect(source.sourceKind).toBe("real");
    expect(source.vectorStatus).toBe("unavailable");
    expect(source.lakeDataStatus).toBe("unavailable");
  });

  it("substitutes sample terrain, and says why, when elevation fails", async () => {
    mocks.loadElevation.mockRejectedValue(new Error("Terrain tile 12/1/1 returned 503."));
    const stages: string[] = [];
    const result = await loadTerrain(withAviation, undefined, (stage) => stages.push(stage));
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe("Terrain tile 12/1/1 returned 503.");
    expect(result.source.sourceKind).not.toBe("real");
    expect(result.source).toMatchObject({ vectorStatus: "not-requested", lakeDataStatus: "not-requested", aviationStatus: "unavailable" });
    expect(stages.at(-1)).toBe("preparing");
  });

  it("falls back with a generic reason when the failure has no message", async () => {
    mocks.loadElevation.mockRejectedValue(new Error("  "));
    expect((await loadTerrain(terrainOnly)).fallbackReason).toBe("The terrain service could not be reached.");
  });

  it("keeps real terrain without lake depths when water assembly fails", async () => {
    mocks.loadLakeBathymetry.mockRejectedValue(new Error("Survey mask failed."));
    mocks.loadVectorMarkings.mockResolvedValue({ markings: [], inland: [], ocean: [square(30)], truncated: false });
    const result = await loadTerrain(DEFAULT_PROJECT);
    expect(result.fallback).toBe(false);
    expect(result.waterWarning).toBe("Survey mask failed.");
    expect(result.source.lakeDataStatus).toBe("unavailable");
    expect(result.source.waterAreas).toEqual([{ id: "ocean-0", kind: "ocean", polygon: square(30) }]);
  });

  it("rethrows when the caller cancels instead of substituting terrain", async () => {
    const controller = new AbortController();
    mocks.loadElevation.mockImplementation(async () => { controller.abort(new DOMException("Superseded", "AbortError")); throw new DOMException("Superseded", "AbortError"); });
    await expect(loadTerrain(terrainOnly, controller.signal)).rejects.toThrow("Superseded");
  });

  it("refuses to start once cancelled", async () => {
    await expect(loadTerrain(terrainOnly, AbortSignal.abort(new DOMException("Closed", "AbortError")))).rejects.toThrow("Closed");
    expect(mocks.loadElevation).not.toHaveBeenCalled();
  });
});

describe("loadAviation", () => {
  const bounds = { west: -122.2, east: -122.0, south: 42.9, north: 43.0 };

  it("returns the FAA detail with its cycle and attribution", async () => {
    mocks.loadAviationMarkings.mockResolvedValue({ markings: [], status: "available", cycle: "2026-10-01", attribution: [{ name: "FAA" }] });
    expect(await loadAviation(bounds, 11, withAviation)).toEqual({ aviationMarkings: [], aviationStatus: "available", aviationCycle: "2026-10-01", aviationAttribution: [{ name: "FAA" }] });
  });

  it("reports aviation unavailable rather than failing the load", async () => {
    mocks.loadAviationMarkings.mockRejectedValue(new Error("aviation archive offline"));
    expect(await loadAviation(bounds, 11, withAviation)).toEqual({ aviationMarkings: [], aviationStatus: "unavailable", aviationAttribution: [] });
  });

  it("rethrows a cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.loadAviationMarkings.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(loadAviation(bounds, 11, withAviation, controller.signal)).rejects.toThrow("Aborted");
  });
});

describe("loadSurveyedLakeDepths", () => {
  const bounds = { west: -122.2, east: -122.0, south: 42.9, north: 43.0 };
  const survey = { areas: [lake], status: "not-covered" as const, datasetVersions: [], attribution: [] };

  beforeEach(() => {
    mocks.loadLakeBathymetry.mockResolvedValue(survey);
    mocks.applyUserCharts.mockImplementation(async (result: typeof survey) => result);
  });

  it("returns the surveys alone when the project uses no charts of its own", async () => {
    expect(await loadSurveyedLakeDepths(bounds, elevation, 11, [lake], undefined, { widthMm: 200, heightMm: 200 })).toBe(survey);
    expect(mocks.loadUserCharts).not.toHaveBeenCalled();
  });

  it("applies the maker's charts and names lakes whose chart this browser lacks", async () => {
    const ownerless: WaterAreaV1 = { id: "osm-1", kind: "lake", polygon: square(5) };
    mocks.loadUserCharts.mockResolvedValue(new Map());
    const result = await loadSurveyedLakeDepths(bounds, elevation, 11, [lake, ownerless], undefined, {
      widthMm: 200, heightMm: 200,
      userDepthCharts: { "42": { id: "c1", contentHash: "a".repeat(64) }, "outline:abc": { id: "c2", contentHash: "b".repeat(64) } },
    });
    expect(mocks.applyUserCharts).toHaveBeenCalledOnce();
    expect(result.missingCharts).toEqual(["Crater Lake", "a lake HydroLAKES does not list"]);
  });

  it("reports nothing missing when every chart is here", async () => {
    mocks.loadUserCharts.mockResolvedValue(new Map([["42", {}]]));
    const result = await loadSurveyedLakeDepths(bounds, elevation, 11, [lake], undefined, { widthMm: 200, heightMm: 200, userDepthCharts: { "42": { id: "c1", contentHash: "a".repeat(64) } } });
    expect(result).not.toHaveProperty("missingCharts");
  });
});

describe("airspace loading", () => {
  const withAirspace: ProjectConfigV1 = { ...terrainOnly, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, classes: { B: false, C: false, D: false, specialUse: true } } };
  const bounds = { west: -105, south: 39, east: -104, north: 40 };

  it("loads the volumes a layered project asks for, with their kinds and cycle", async () => {
    mocks.loadAirspaceVolumes.mockResolvedValue({ volumes: [], status: "available", cycle: "2026-10-01" });
    expect(await loadAirspace(bounds, 9, withAirspace)).toEqual({ airspaceVolumes: [], airspaceStatus: "available", airspaceCycle: "2026-10-01" });
    expect(mocks.loadAirspaceVolumes.mock.calls[0]![3]).toEqual({ classes: false, specialUse: true, classFilter: { B: false, C: false, D: false } });
    const { source } = await loadTerrain(withAirspace);
    expect(source).toMatchObject({ airspaceVolumes: [], airspaceStatus: "available" });
    await loadTerrain(terrainOnly);
    expect(mocks.loadAirspaceVolumes).toHaveBeenCalledTimes(2);
  });

  it("leaves the volumes absent when the archive cannot be read, so generation can say so", async () => {
    mocks.loadAirspaceVolumes.mockRejectedValue(new Error("offline"));
    expect(await loadAirspace(bounds, 9, withAirspace)).toEqual({ airspaceStatus: "unavailable" });
    expect(await loadAirspace(bounds, 9, terrainOnly)).toEqual({});
  });
});
