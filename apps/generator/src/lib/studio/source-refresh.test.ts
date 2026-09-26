import { describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";
import { dataZoom } from "$lib/domain/tile-math";
import { markStaleSourceData, refreshRequiredMapData, type SourceRefreshDependencies } from "$lib/studio/source-refresh";

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
      dataZoom,
    };
    const config: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: true, showWaterDepth: true, location: { ...DEFAULT_PROJECT.location, zoom: 11.6 } };
    await refreshRequiredMapData(loaded({ vectorStatus: "not-requested", lakeDataStatus: "not-requested" }), config, new AbortController().signal, deps);
    expect(vi.mocked(deps.loadVectorMarkings).mock.calls[0]![1]).toBe(12);
    expect(vi.mocked(deps.loadLakeAreas).mock.calls[0]![1]).toBe(12);
    expect(vi.mocked(deps.loadSurveyedLakeDepths).mock.calls[0]![2]).toBe(12);
  });
});
