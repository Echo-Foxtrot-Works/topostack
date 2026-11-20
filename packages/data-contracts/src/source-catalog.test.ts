import { describe, expect, it } from "vitest";
import terrainCatalog from "../../../scripts/data/terrain-sources.json";
import { rankTerrainSources, sourceAvailableIn, terrainValueRange, validateSurveyCatalog, validateTerrainArchiveBounds, validateTerrainCatalog } from "./source-catalog";

const source = { id: "survey-v1", name: "Survey", url: "https://example.test/source", license: "CC BY 4.0", bounds: [-10, 40, 10, 50], encoding: "depth-terrarium-v1", maxZoom: 12 };

describe("survey catalog contract", () => {
  it("preserves provider precedence and accepts both supported encodings", () => {
    const sources = [source, { ...source, id: "second-v2", encoding: "elevation-terrarium-v1" }];
    expect(validateSurveyCatalog({ sources }).sources).toEqual(sources.map((item) => ({ ...item, availability: "all" })));
  });
  it("keeps development-only sources and their approval state", () => {
    const pending = { ...source, availability: "development", approval: { required: true } };
    const granted = { ...source, id: "granted-v1", availability: "all", approval: { required: true, reference: "国地公第123号" } };
    expect(validateSurveyCatalog({ sources: [pending, granted] }).sources).toEqual([pending, granted]);
    expect(sourceAvailableIn(validateSurveyCatalog({ sources: [pending] }).sources[0]!, "production")).toBe(false);
    expect(sourceAvailableIn(validateSurveyCatalog({ sources: [pending] }).sources[0]!, "development")).toBe(true);
    expect(sourceAvailableIn(validateSurveyCatalog({ sources: [pending] }).sources[0]!, undefined)).toBe(false);
    expect(sourceAvailableIn(validateSurveyCatalog({ sources: [granted] }).sources[0]!, undefined)).toBe(true);
  });
  it.each([
    { availability: "staging" }, { approval: { required: false } }, { approval: { required: true, reference: " " } },
    // Approval required but not yet granted: never available to all.
    { approval: { required: true } }, { availability: "all", approval: { required: true } },
  ])("rejects an unsafe availability: %j", (patch) => {
    expect(() => validateSurveyCatalog({ sources: [{ ...source, ...patch }] })).toThrow();
  });
  it.each([
    { id: "../survey-v1" }, { id: "unversioned" }, { name: " " }, { license: "" },
    { url: "http://example.test" }, { url: "https://user:password@example.test" },
    { bounds: [1, 2, 1, 3] }, { bounds: [-181, 0, 0, 1] }, { bounds: [0, 0, 1, 90] },
    { bounds: [0, 0, NaN, 1] }, { bounds: [0, 1, 2] }, { encoding: "unknown" },
    { maxZoom: 16 }, { maxZoom: 1.5 },
  ])("rejects an unsafe or unsupported registration: %j", (patch) => {
    expect(() => validateSurveyCatalog({ sources: [{ ...source, ...patch }] })).toThrow();
  });
  it("rejects duplicate routes and malformed catalogs", () => {
    expect(() => validateSurveyCatalog({ sources: [source, source] })).toThrow("duplicate");
    for (const value of [null, {}, { sources: [null] }]) expect(() => validateSurveyCatalog(value)).toThrow();
  });
});

describe("terrain catalog contract", () => {
  it("accepts registered bare-earth terrain sources", () => {
    expect(validateTerrainCatalog(terrainCatalog).sources).toEqual(terrainCatalog.sources.map((item) => ({ ...item, availability: "all" })));
  });
  it("accepts Japanese heights and ocean grids with their own value ranges", () => {
    const base = terrainCatalog.sources[0]!;
    const [japan, ocean] = validateTerrainCatalog({ sources: [
      { ...base, id: "gsi-test-v1", verticalDatum: "JP-TP", availability: "development", approval: { required: true } },
      { ...base, id: "gebco-test-v1", verticalDatum: "MSL", kind: "bathymetry-grid", minZoom: 0, maxZoom: 9 },
    ] }).sources;
    expect(japan).toMatchObject({ verticalDatum: "JP-TP", availability: "development" });
    expect(terrainValueRange(ocean!.kind)).toEqual([-11000, 10]);
    expect(terrainValueRange(japan!.kind)).toEqual([-500, 9000]);
  });
  it.each([{ priority: 0 }, { priority: 1.5 }, { nativeResolutionM: 0 }, { nativeResolutionM: NaN }, { acquisitionYear: "2020" }, { kind: "dsm" }, { minZoom: -1 }, { minZoom: 16 }, { minZoom: 1.5 }, { verticalDatum: "unknown" }, { encoding: "depth-terrarium-v1" }])("rejects unsafe terrain metadata: %j", (patch) => {
    expect(() => validateTerrainCatalog({ sources: [{ ...terrainCatalog.sources[0], ...patch }] })).toThrow();
  });
});

it("ranks quality before resolution, then survey year, with stable ID ties", () => {
  const base = validateTerrainCatalog(terrainCatalog).sources[0]!;
  const sources = [
    { ...base, id: "low-v1", priority: 100, nativeResolutionM: 0.5 },
    { ...base, id: "coarse-v1", priority: 300, nativeResolutionM: 2 },
    { ...base, id: "older-v1", priority: 300, nativeResolutionM: 1, acquisitionYear: 2010 },
    { ...base, id: "b-v1", priority: 300, nativeResolutionM: 1, acquisitionYear: 2020 },
    { ...base, id: "a-v1", priority: 300, nativeResolutionM: 1, acquisitionYear: 2020 },
  ];
  expect(rankTerrainSources(sources).map((source) => source.id)).toEqual(["a-v1", "b-v1", "older-v1", "coarse-v1", "low-v1"]);
  expect(rankTerrainSources([...sources].reverse())).toEqual(rankTerrainSources(sources));
});

it("accepts archive bounds that only differ by PMTiles rounding", () => {
  const expected = [-80.5, 44.25, -79.75, 44.9];
  expect(() => validateTerrainArchiveBounds([-80.5000004, 44.25, -79.75, 44.9000003], expected)).not.toThrow();
});

it("rejects archive bounds that are malformed or extend registered coverage", () => {
  const expected = [-80.5, 44.25, -79.75, 44.9];
  for (const actual of [null, [-80.5, 44.25, -79.75], [-80.5, 44.25, -79.75, "44.9"], [-80.5, 44.25, -79.75, Number.NaN], [-80.5, 44.25, -79.75, 44.91]]) {
    expect(() => validateTerrainArchiveBounds(actual, expected)).toThrow("Terrain archive extent does not match registration.");
  }
});
