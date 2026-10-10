import { describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, type AirspaceVolumeV1, type MarkingFeature, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1 } from "@topostack/core";
import { dataZoom } from "$lib/domain/tile-math";
import { markStaleSourceData, refreshRequiredMapData, resizeSource, SourcePreparationCache, type SourceRefreshDependencies } from "$lib/studio/source-refresh";

const loaded = (overrides: Partial<SourceBundleV1> = {}): SourceBundleV1 => ({ ...createSyntheticSource(DEFAULT_PROJECT, 8), sourceKind: "real", vectorStatus: "available", lakeDataStatus: "available", ...overrides });
const stale = (source: SourceBundleV1, patch: Partial<ProjectConfigV1>) => markStaleSourceData(source, patch, DEFAULT_PROJECT, { ...DEFAULT_PROJECT, ...patch });

describe("stale source data", () => {
  it("reloads vectors when a road, trail, or boundary layer is turned on", () => {
    for (const key of ["showRoads", "showTrails", "showBoundaries"] as const) {
      expect(stale(loaded(), { [key]: true }).vectorStatus).toBe("not-requested");
    }
  });

  it("keeps loaded vectors when a layer is turned off", () => {
    const source = loaded();
    for (const key of ["showRoads", "showTrails", "showBoundaries"] as const) {
      expect(stale(source, { [key]: false })).toBe(source);
    }
  });

  it("reloads a truncated load when a layer is turned off, since more features may now fit", () => {
    expect(stale(loaded({ vectorStatus: "partial" }), { showRoads: false }).vectorStatus).toBe("not-requested");
  });

  it("still reloads on water changes", () => {
    expect(stale(loaded(), { showWater: false }).vectorStatus).toBe("not-requested");
  });

  it("fetches water outlines when a paint stencil is the first thing to need them", () => {
    const dry: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false, showWaterDepth: false };
    const next = markStaleSourceData(loaded(), { paintTemplates: ["water"] }, dry, { ...dry, paintTemplates: ["water"] });
    expect(next.vectorStatus).toBe("not-requested");
    expect(next.lakeDataStatus).toBe("not-requested");
    // Outlines already loaded for drawing serve the stencil as they are.
    const source = loaded();
    expect(markStaleSourceData(source, { paintTemplates: ["water"] }, DEFAULT_PROJECT, { ...DEFAULT_PROJECT, paintTemplates: ["water"] })).toBe(source);
    expect(markStaleSourceData(source, { paintTemplates: [] }, { ...dry, paintTemplates: ["water"] }, dry)).toBe(source);
  });

  it("loads lake depths again when a depth chart is used or dropped", () => {
    const source = loaded({ bathymetryStatus: "available" });
    const reference = { id: "round-lake-chart-00000001", contentHash: "a".repeat(64) };
    expect(stale(source, { userDepthCharts: { "9092": reference } }).bathymetryStatus).toBeUndefined();
    expect(stale(source, { userDepthCharts: undefined }).bathymetryStatus).toBeUndefined();
    // Vectors and outlines are untouched: only which depths a lake carves changed.
    expect(stale(source, { userDepthCharts: { "9092": reference } }).lakeDataStatus).toBe("available");
  });
});

describe("refreshing map data", () => {
  it("loads at the same whole zoom as a full generation", async () => {
    const deps: SourceRefreshDependencies = {
      loadVectorMarkings: vi.fn(async () => ({ markings: [], inland: [], ocean: [], truncated: false })),
      loadLakeAreas: vi.fn(async () => []),
      loadSurveyedLakeDepths: vi.fn(async (_bounds, _elevation, _zoom, areas) => ({ areas, status: "not-covered" as const, datasetVersions: [], attribution: [] })),
      applySurveyProvenance: (source) => source,
      resolveLakeOutlines: (_providers, hydro) => hydro,
      assembleWater: (source) => source,
      loadAviation: vi.fn(async () => ({ aviationMarkings: [], aviationStatus: "not-covered" as const })),
      loadAirspace: vi.fn(async () => ({ airspaceVolumes: [], airspaceStatus: "not-covered" as const })),
      dataZoom,
    };
    const config: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: true, showWaterDepth: true, location: { ...DEFAULT_PROJECT.location, zoom: 11.6 } };
    await refreshRequiredMapData(loaded({ vectorStatus: "not-requested", lakeDataStatus: "not-requested" }), config, new AbortController().signal, deps);
    expect(vi.mocked(deps.loadVectorMarkings).mock.calls[0]![1]).toBe(12);
    expect(vi.mocked(deps.loadLakeAreas).mock.calls[0]![1]).toBe(12);
    expect(vi.mocked(deps.loadSurveyedLakeDepths).mock.calls[0]![2]).toBe(12);
    expect(deps.loadAviation).not.toHaveBeenCalled();
  });

  it("loads aviation only when the project asks for it and keeps it across road reloads", async () => {
    const airport = { id: "den", kind: "aviation" as const, operation: "engrave" as const, aviationClass: "airport" as const, aviationSymbol: "airport-pattern" as const, points: [{ x: 0, y: 0 }] };
    const deps: SourceRefreshDependencies = {
      loadVectorMarkings: vi.fn(async () => ({ markings: [], inland: [], ocean: [], truncated: false })),
      loadLakeAreas: vi.fn(async () => []),
      loadSurveyedLakeDepths: vi.fn(async (_bounds, _elevation, _zoom, areas) => ({ areas, status: "not-covered" as const, datasetVersions: [], attribution: [] })),
      applySurveyProvenance: (source) => source,
      resolveLakeOutlines: (_providers, hydro) => hydro,
      assembleWater: (source) => source,
      loadAviation: vi.fn(async () => ({ aviationMarkings: [airport], aviationStatus: "available" as const, aviationCycle: "2026-09-03" })),
      loadAirspace: vi.fn(async () => ({ airspaceVolumes: [], airspaceStatus: "not-covered" as const })),
      dataZoom,
    };
    const config: ProjectConfigV1 = { ...DEFAULT_PROJECT, aviation: { airspace: false, specialUse: false, runways: false, airports: true, navaids: false, obstacles: false, labels: false } };
    const refreshed = await refreshRequiredMapData(loaded({ vectorStatus: "not-requested" }), config, new AbortController().signal, deps);
    expect(refreshed).toMatchObject({ aviationStatus: "available", aviationCycle: "2026-09-03", aviationMarkings: [airport] });
    expect(deps.loadVectorMarkings).toHaveBeenCalledTimes(1);
    // A loaded aviation source is reused, not fetched again.
    await refreshRequiredMapData(refreshed, config, new AbortController().signal, deps);
    expect(deps.loadAviation).toHaveBeenCalledTimes(1);
  });
});

describe("stale aviation data", () => {
  const none = { airspace: false, specialUse: false, runways: false, airports: false, navaids: false, obstacles: false, labels: false };
  const withAirspace: ProjectConfigV1 = { ...DEFAULT_PROJECT, aviation: { ...none, airspace: true } };

  it("reloads when a new aviation group is turned on", () => {
    const source = loaded({ aviationStatus: "available", aviationMarkings: [] });
    const next = { ...withAirspace, aviation: { ...none, airspace: true, obstacles: true } };
    expect(markStaleSourceData(source, { aviation: next.aviation }, withAirspace, next).aviationStatus).toBe("not-requested");
    expect(markStaleSourceData(source, { aviation: withAirspace.aviation }, DEFAULT_PROJECT, withAirspace).aviationStatus).toBe("not-requested");
  });

  it("keeps loaded aviation when a group or the labels change without new data", () => {
    const source = loaded({ aviationStatus: "available", aviationMarkings: [] });
    expect(markStaleSourceData(source, { aviation: none }, withAirspace, { ...withAirspace, aviation: none })).toBe(source);
    const labelled = { ...withAirspace, aviation: { ...none, airspace: true, labels: true } };
    expect(markStaleSourceData(source, { aviation: labelled.aviation }, withAirspace, labelled)).toBe(source);
  });
});

describe("airspace volumes", () => {
  const sector: AirspaceVolumeV1 = { id: "class-1", aviationClass: "class-b", name: "TEST CLASS B", floor: { ref: "msl", ft: 8_000 }, ceiling: { ref: "msl", ft: 12_000 }, polygons: [{ outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }], holes: [] }] };
  const stacked: ProjectConfigV1 = { ...DEFAULT_PROJECT, airspaceStack: DEFAULT_AIRSPACE_STACK };

  it("loads only when the project builds airspace, and keeps a loaded list, empty or not", async () => {
    const deps = dependencies({ loadAirspace: vi.fn(async () => ({ airspaceVolumes: [sector], airspaceStatus: "available" as const, airspaceCycle: "2026-10-01" })) });
    await refreshRequiredMapData(loaded(), DEFAULT_PROJECT, new AbortController().signal, deps);
    expect(deps.loadAirspace).not.toHaveBeenCalled();
    const refreshed = await refreshRequiredMapData(loaded(), stacked, new AbortController().signal, deps);
    expect(refreshed).toMatchObject({ airspaceVolumes: [sector], airspaceStatus: "available", airspaceCycle: "2026-10-01" });
    await refreshRequiredMapData(refreshed, stacked, new AbortController().signal, deps);
    await refreshRequiredMapData(loaded({ airspaceVolumes: [], airspaceStatus: "not-covered" }), stacked, new AbortController().signal, deps);
    expect(deps.loadAirspace).toHaveBeenCalledTimes(1);
  });

  it("reloads when a switch needs sectors the source was loaded without", () => {
    const source = loaded({ airspaceVolumes: [sector], airspaceStatus: "available" });
    const onlyClasses = { ...stacked, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, classes: { B: true, C: true, D: false, specialUse: false } } };
    const plusSpecialUse = { ...stacked, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, classes: { B: true, C: true, D: false, specialUse: true } } };
    expect(markStaleSourceData(source, { airspaceStack: plusSpecialUse.airspaceStack }, onlyClasses, plusSpecialUse).airspaceVolumes).toBeUndefined();
    // Turning a kind off, or changing the form, only filters what is loaded.
    expect(markStaleSourceData(source, { airspaceStack: onlyClasses.airspaceStack }, plusSpecialUse, onlyClasses)).toBe(source);
    const tiers = { ...plusSpecialUse, airspaceStack: { ...plusSpecialUse.airspaceStack!, form: "tiers" as const } };
    expect(markStaleSourceData(source, { airspaceStack: tiers.airspaceStack }, plusSpecialUse, tiers)).toBe(source);
    // Turning airspace on for a source that never loaded it.
    expect(markStaleSourceData(loaded(), { airspaceStack: stacked.airspaceStack }, DEFAULT_PROJECT, stacked).airspaceVolumes).toBeUndefined();
  });

  it("reloads a partial list when classes are disabled so the remaining data can fit", () => {
    const source = loaded({ airspaceVolumes: [sector], airspaceStatus: "partial", airspaceCycle: "old" });
    const next = { ...stacked, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, classes: { ...DEFAULT_AIRSPACE_STACK.classes, specialUse: false } } };
    const stale = markStaleSourceData(source, { airspaceStack: next.airspaceStack }, stacked, next);
    expect(stale.airspaceVolumes).toBeUndefined();
    expect(stale.airspaceStatus).toBeUndefined();
    expect(stale.airspaceCycle).toBeUndefined();
  });

  it("reloads when another controlled class is enabled", () => {
    const source = loaded({ airspaceVolumes: [sector], airspaceStatus: "available" });
    const next = { ...stacked, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, classes: { ...DEFAULT_AIRSPACE_STACK.classes, D: true } } };
    expect(markStaleSourceData(source, { airspaceStack: next.airspaceStack }, stacked, next).airspaceVolumes).toBeUndefined();
  });

  it("scales the volumes with the model", () => {
    const resized = resizeSource(loaded({ airspaceVolumes: [sector] }), DEFAULT_PROJECT, { ...DEFAULT_PROJECT, widthMm: DEFAULT_PROJECT.widthMm * 2 });
    expect(resized.airspaceVolumes![0]!.polygons[0]!.outer[1]).toEqual({ x: 20, y: 0 });
  });
});

const square = (x: number, y: number, size = 10): Polygon2D => ({ outer: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }, { x, y }], holes: [] });
const line = (id: string, kind: MarkingFeature["kind"]): MarkingFeature => ({ id, kind, operation: "engrave", points: [{ x: 0, y: 0 }, { x: 10, y: 5 }] });
const lake = (id: string, overrides: Partial<WaterAreaV1> = {}): WaterAreaV1 => ({ id, kind: "lake", polygon: square(0, 0), ...overrides });

/** Loaders that succeed with nothing new, and pass-through water helpers. */
function dependencies(overrides: Partial<SourceRefreshDependencies> = {}): SourceRefreshDependencies {
  return {
    loadVectorMarkings: vi.fn(async () => ({ markings: [], inland: [], ocean: [], truncated: false })),
    loadLakeAreas: vi.fn(async () => []),
    loadSurveyedLakeDepths: vi.fn(async (_bounds, _elevation, _zoom, areas) => ({ areas, status: "available" as const, datasetVersions: [], attribution: [] })),
    applySurveyProvenance: vi.fn((source, result) => ({ ...source, bathymetryStatus: result.status })),
    resolveLakeOutlines: vi.fn((_providers, hydro) => hydro),
    assembleWater: vi.fn((source, lakes) => ({ ...source, waterAreas: lakes })),
    loadAviation: vi.fn(async () => ({ aviationMarkings: [], aviationStatus: "not-covered" as const })),
    loadAirspace: vi.fn(async () => ({ airspaceVolumes: [], airspaceStatus: "not-covered" as const })),
    dataZoom,
    ...overrides,
  };
}

describe("resizing a loaded source", () => {
  it("keeps the same source when the size is unchanged", () => {
    const source = loaded();
    expect(resizeSource(source, DEFAULT_PROJECT, { ...DEFAULT_PROJECT, name: "Renamed" })).toBe(source);
  });

  it("scales every drawn feature to the new material size", () => {
    const withHole: Polygon2D = { ...square(10, 10), holes: [square(12, 12, 2).outer] };
    const source = loaded({
      markings: [line("road-1", "road")],
      aviationMarkings: [line("aviation-1", "aviation")],
      waterAreas: [lake("lake-1", { polygon: withHole })],
      inlandWaterAreas: [square(10, 10)],
      waterPatternAreas: [square(-10, -10)],
    });
    const resized = resizeSource(source, DEFAULT_PROJECT, { ...DEFAULT_PROJECT, widthMm: 600, heightMm: 100 });
    expect(resized.markings[0]!.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 2.5 }]);
    expect(resized.aviationMarkings![0]!.points[1]).toEqual({ x: 20, y: 2.5 });
    expect(resized.waterAreas![0]!.polygon.outer[2]).toEqual({ x: 40, y: 10 });
    expect(resized.waterAreas![0]!.polygon.holes[0]![0]).toEqual({ x: 24, y: 6 });
    expect(resized.inlandWaterAreas![0]!.outer[0]).toEqual({ x: 20, y: 5 });
    expect(resized.waterPatternAreas![0]!.outer[0]).toEqual({ x: -20, y: -5 });
    // The source it came from is left as it was.
    expect(source.markings[0]!.points[1]).toEqual({ x: 10, y: 5 });
  });

  it("does not invent layers the source never loaded", () => {
    const resized = resizeSource(loaded({ markings: [] }), DEFAULT_PROJECT, { ...DEFAULT_PROJECT, widthMm: 150 });
    expect(resized).not.toHaveProperty("aviationMarkings");
    expect(resized).not.toHaveProperty("waterAreas");
    expect(resized).not.toHaveProperty("inlandWaterAreas");
    expect(resized).not.toHaveProperty("waterPatternAreas");
  });
});

describe("stale water data", () => {
  it("never marks sample terrain stale", () => {
    const sample = { ...loaded(), sourceKind: "synthetic" as const };
    expect(stale(sample, { showRoads: true, showWaterDepth: true })).toBe(sample);
  });

  it("loads outlines and lake data when depth is turned on without water drawn", () => {
    const dry: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false, showWaterDepth: false };
    const next = markStaleSourceData(loaded(), { showWaterDepth: true }, dry, { ...dry, showWaterDepth: true });
    expect(next).toMatchObject({ vectorStatus: "not-requested", lakeDataStatus: "not-requested" });
    // With water already drawn, only the lake data is missing.
    expect(stale(loaded(), { showWaterDepth: true })).toMatchObject({ vectorStatus: "available", lakeDataStatus: "not-requested" });
  });

  it("loads lake data when switching an engraving with depth on to a layered stack", () => {
    const engraving: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving" };
    expect(markStaleSourceData(loaded(), { outputMode: "stack" }, engraving, DEFAULT_PROJECT)).toMatchObject({ vectorStatus: "available", lakeDataStatus: "not-requested" });
    const dry = { ...engraving, showWater: false };
    expect(markStaleSourceData(loaded(), { outputMode: "stack" }, dry, { ...dry, outputMode: "stack" })).toMatchObject({ vectorStatus: "not-requested", lakeDataStatus: "not-requested" });
  });

  it("reloads a truncated aviation load even for a group that was already on", () => {
    const airspace = { airspace: true, specialUse: false, runways: false, airports: false, navaids: false, obstacles: false, labels: false };
    const project = { ...DEFAULT_PROJECT, aviation: airspace };
    const source = loaded({ aviationStatus: "partial", aviationMarkings: [] });
    expect(markStaleSourceData(source, { aviation: { ...airspace, labels: true } }, project, { ...project, aviation: { ...airspace, labels: true } }).aviationStatus).toBe("not-requested");
  });
});

describe("refreshing map data after a failed or partial load", () => {
  const signal = () => new AbortController().signal;

  it("returns sample terrain untouched", async () => {
    const deps = dependencies();
    const sample = { ...loaded({ vectorStatus: "not-requested" }), sourceKind: "preview" as const };
    expect(await refreshRequiredMapData(sample, DEFAULT_PROJECT, signal(), deps)).toBe(sample);
    expect(deps.loadVectorMarkings).not.toHaveBeenCalled();
  });

  it("marks a truncated vector load partial and keeps both water layers as pattern areas", async () => {
    const ocean = square(-50, -50), inland = square(20, 20);
    const deps = dependencies({ loadVectorMarkings: vi.fn(async () => ({ markings: [line("road-1", "road")], inland: [inland], ocean: [ocean], truncated: true })) });
    const refreshed = await refreshRequiredMapData(loaded({ vectorStatus: "not-requested" }), DEFAULT_PROJECT, signal(), deps);
    expect(refreshed).toMatchObject({ vectorStatus: "partial", markings: [line("road-1", "road")], inlandWaterAreas: [inland], waterPatternAreas: [ocean, inland] });
    expect(vi.mocked(deps.assembleWater).mock.calls[0]![2]).toEqual([ocean]);
    expect(vi.mocked(deps.resolveLakeOutlines).mock.calls[0]![2]).toEqual([inland]);
  });

  it("drops stale linework but keeps other markings when map details fail to load", async () => {
    const deps = dependencies({ loadVectorMarkings: vi.fn(async () => { throw new Error("503"); }) });
    const source = loaded({
      vectorStatus: "not-requested",
      markings: ["road", "trail", "water", "boundary", "grid", "label"].map((kind) => line(`${kind}-1`, kind as MarkingFeature["kind"])),
      waterAreas: [{ id: "sea", kind: "ocean", polygon: square(-50, -50) }],
      inlandWaterAreas: [square(20, 20)],
      waterPatternAreas: [square(20, 20)],
    });
    const refreshed = await refreshRequiredMapData(source, DEFAULT_PROJECT, signal(), deps);
    expect(refreshed.vectorStatus).toBe("unavailable");
    expect(refreshed.markings.map((marking) => marking.kind)).toEqual(["grid", "label"]);
    expect(refreshed).toMatchObject({ inlandWaterAreas: [], waterPatternAreas: [] });
    // Neither the old ocean nor old inland water survive into assembly.
    expect(vi.mocked(deps.assembleWater).mock.calls[0]![2]).toEqual([]);
    expect(vi.mocked(deps.resolveLakeOutlines).mock.calls[0]![2]).toEqual([]);
  });

  it("propagates a cancelled load instead of reporting the data unavailable", async () => {
    const controller = new AbortController();
    const cancelled = new DOMException("Aborted", "AbortError");
    const failVectors = dependencies({ loadVectorMarkings: vi.fn(async () => { controller.abort(); throw cancelled; }) });
    await expect(refreshRequiredMapData(loaded({ vectorStatus: "not-requested" }), DEFAULT_PROJECT, controller.signal, failVectors)).rejects.toBe(cancelled);
    const lakesController = new AbortController();
    const failLakes = dependencies({ loadLakeAreas: vi.fn(async () => { lakesController.abort(); throw cancelled; }) });
    await expect(refreshRequiredMapData(loaded({ lakeDataStatus: "not-requested" }), DEFAULT_PROJECT, lakesController.signal, failLakes)).rejects.toBe(cancelled);
    const aviationController = new AbortController();
    const aviation = dependencies({ loadAviation: vi.fn(async () => { aviationController.abort(); return { aviationStatus: "unavailable" as const }; }) });
    const withAirports = { ...DEFAULT_PROJECT, aviation: { airspace: false, specialUse: false, runways: false, airports: true, navaids: false, obstacles: false, labels: false } };
    await expect(refreshRequiredMapData(loaded({ aviationStatus: "unavailable" }), withAirports, aviationController.signal, aviation)).rejects.toThrow();
    expect(aviation.assembleWater).not.toHaveBeenCalled();
  });

  it("keeps generating without lakes when the lake archive fails", async () => {
    const deps = dependencies({ loadLakeAreas: vi.fn(async () => { throw new Error("archive offline"); }) });
    const source = loaded({ lakeDataStatus: "not-requested", waterAreas: [lake("lake-old")] });
    const refreshed = await refreshRequiredMapData(source, DEFAULT_PROJECT, signal(), deps);
    expect(refreshed.lakeDataStatus).toBe("unavailable");
    expect(refreshed.waterAreas).toEqual([]);
    expect(vi.mocked(deps.loadSurveyedLakeDepths).mock.calls[0]![3]).toEqual([]);
  });

  it("rebuilds OSM outlines, carries each lake's survey over, and reloads depths when the lake set changes", async () => {
    const survey = { width: 2, height: 2, depthsM: new Float32Array(4) };
    const source = loaded({ bathymetryStatus: "available", waterAreas: [lake("hylak-1", { bathymetry: survey }), lake("osm-1", { outlineSource: "osm" })] });
    // The OSM outline is resolved again from inland water, under a new id.
    const deps = dependencies({ resolveLakeOutlines: vi.fn((_providers, hydro) => [...hydro, lake("osm-2", { outlineSource: "osm" })]) });
    await refreshRequiredMapData(source, DEFAULT_PROJECT, signal(), deps);
    expect(vi.mocked(deps.resolveLakeOutlines).mock.calls[0]![1].map((area) => area.id)).toEqual(["hylak-1"]);
    const surveyed = vi.mocked(deps.loadSurveyedLakeDepths).mock.calls[0]![3];
    expect(surveyed.map((area) => [area.id, area.bathymetry])).toEqual([["hylak-1", survey], ["osm-2", undefined]]);
  });

  it("reuses loaded depths while the lakes are unchanged, and retries a partial survey", async () => {
    const source = loaded({ bathymetryStatus: "available", waterAreas: [lake("hylak-1")] });
    const deps = dependencies();
    await refreshRequiredMapData(source, DEFAULT_PROJECT, signal(), deps);
    expect(deps.loadSurveyedLakeDepths).not.toHaveBeenCalled();
    await refreshRequiredMapData({ ...source, bathymetryStatus: "partial" }, DEFAULT_PROJECT, signal(), deps);
    expect(deps.loadSurveyedLakeDepths).toHaveBeenCalledTimes(1);
  });

  it("loads depths again when a lake takes the map's shore under the same id", async () => {
    const source = loaded({ bathymetryStatus: "available", waterAreas: [lake("hylak-1")] });
    // A stored source loses identity between its lakes and its map water; equal shores are unchanged.
    const copied = dependencies({ resolveLakeOutlines: vi.fn((_providers, hydro) => hydro.map((area: WaterAreaV1) => ({ ...area, polygon: structuredClone(area.polygon) }))) });
    await refreshRequiredMapData(source, DEFAULT_PROJECT, signal(), copied);
    expect(copied.loadSurveyedLakeDepths).not.toHaveBeenCalled();
    const reshaped = dependencies({ resolveLakeOutlines: vi.fn((_providers, hydro) => hydro.map((area: WaterAreaV1) => ({ ...area, polygon: square(0, 0, 11) }))) });
    await refreshRequiredMapData(source, DEFAULT_PROJECT, signal(), reshaped);
    expect(reshaped.loadSurveyedLakeDepths).toHaveBeenCalledTimes(1);
  });

  it("counts resolved outlines as lake data even when the archive was unavailable", async () => {
    const deps = dependencies({
      loadLakeAreas: vi.fn(async () => { throw new Error("offline"); }),
      resolveLakeOutlines: vi.fn(() => [lake("osm-1", { outlineSource: "osm" })]),
    });
    const refreshed = await refreshRequiredMapData(loaded({ lakeDataStatus: "unavailable", bathymetryStatus: "available" }), DEFAULT_PROJECT, signal(), deps);
    expect(refreshed.lakeDataStatus).toBe("available");
    // A new lake set has no survey yet.
    expect(deps.loadSurveyedLakeDepths).toHaveBeenCalledTimes(1);
  });

  it("records no survey when the project does not carve water depth", async () => {
    const deps = dependencies();
    const flat: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWaterDepth: false };
    const refreshed = await refreshRequiredMapData(loaded({ waterAreas: [lake("hylak-1")] }), flat, signal(), deps);
    expect(deps.loadSurveyedLakeDepths).not.toHaveBeenCalled();
    expect(vi.mocked(deps.applySurveyProvenance).mock.calls[0]![1]).toEqual({ areas: [expect.objectContaining({ id: "hylak-1" })], status: "not-covered", datasetVersions: [], attribution: [] });
    expect(refreshed.bathymetryStatus).toBe("not-covered");
  });
});

describe("source preparation cache", () => {
  const signal = () => new AbortController().signal;
  const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWaterDepth: false };

  it("reuses the prepared source for edits that do not change what is loaded", async () => {
    const deps = dependencies();
    const cache = new SourcePreparationCache(deps);
    const active = loaded();
    const first = await cache.prepare(active, project, project, project, signal());
    const thicker = { ...project, materialThicknessMm: 6 };
    expect(await cache.prepare(active, project, thicker, thicker, signal())).toBe(first);
    expect(deps.assembleWater).toHaveBeenCalledTimes(1);
    // The committed output, handed back as the next active source, is its own fixed point.
    expect(await cache.prepare(first, thicker, thicker, thicker, signal())).toBe(first);
    expect(deps.assembleWater).toHaveBeenCalledTimes(1);
  });

  it("prepares again when the edit changes the data, the input, or the cache is cleared", async () => {
    const deps = dependencies();
    const cache = new SourcePreparationCache(deps);
    const active = loaded();
    const first = await cache.prepare(active, project, project, project, signal());
    const zoomed = { ...project, location: { ...project.location, zoom: 13 } };
    expect(await cache.prepare(active, project, zoomed, zoomed, signal())).not.toBe(first);
    expect(deps.assembleWater).toHaveBeenCalledTimes(2);
    const other = loaded();
    await cache.prepare(other, project, project, project, signal());
    expect(deps.assembleWater).toHaveBeenCalledTimes(3);
    cache.clear();
    await cache.prepare(other, project, project, project, signal());
    expect(deps.assembleWater).toHaveBeenCalledTimes(4);
  });

  it("does not treat the committed output as fixed when the edit asks for data it lacks", async () => {
    const deps = dependencies();
    const cache = new SourcePreparationCache(deps);
    const first = await cache.prepare(loaded(), project, project, project, signal());
    // Turning water off and on again keeps the key, but water changes reload map details.
    const dry = { ...project, showWater: false };
    await cache.prepare(first, dry, project, project, signal());
    expect(deps.loadVectorMarkings).toHaveBeenCalledTimes(1);
  });

  it("resizes the source to the previewed size before preparing it", async () => {
    const deps = dependencies();
    const cache = new SourcePreparationCache(deps);
    const wider = { ...project, widthMm: 600 };
    const prepared = await cache.prepare(loaded({ markings: [line("road-1", "road")] }), project, wider, wider, signal());
    expect(prepared.markings[0]!.points[1]).toEqual({ x: 20, y: 5 });
  });

  it("does not remember a preparation that was cancelled", async () => {
    const deps = dependencies();
    const cache = new SourcePreparationCache(deps);
    const controller = new AbortController();
    controller.abort();
    const active = loaded();
    await cache.prepare(active, project, project, project, controller.signal);
    await cache.prepare(active, project, project, project, signal());
    expect(deps.assembleWater).toHaveBeenCalledTimes(2);
  });
});
