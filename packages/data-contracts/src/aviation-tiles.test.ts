import { describe, expect, it } from "vitest";
import registration from "../../../scripts/data/faa-aviation-sources.json";
import { AVIATION_LAYERS, aviationArchiveMetadata, aviationCovers, aviationTileProperties, isAviationLayer, parseAviationArchiveMetadata, parseAviationProperties, validateAviationSources } from "./aviation-tiles";

describe("aviation tile properties", () => {
  it("round-trips every layer through the builder's snake_case form", () => {
    const airspace = { class: "B", name: "DENVER CLASS B", ident: "DEN", floorFt: 8000, ceilingFt: 12000 } as const;
    expect(aviationTileProperties("airspace", airspace)).toEqual({ class: "B", name: "DENVER CLASS B", ident: "DEN", floor_ft: 8000, ceiling_ft: 12000 });
    expect(parseAviationProperties("airspace", aviationTileProperties("airspace", airspace))).toEqual(airspace);
    const runway = { airport: "DEN", runway: "16R/34L", widthFt: 150, lengthFt: 16000 } as const;
    expect(parseAviationProperties("runways", aviationTileProperties("runways", runway))).toEqual(runway);
    const airport = { ident: "DEN", name: "DENVER INTL", kind: "airport", use: "public", towered: true, longestRunwayFt: 16000 } as const;
    expect(parseAviationProperties("airports", aviationTileProperties("airports", airport))).toEqual(airport);
    expect(parseAviationProperties("navaids", { ident: "DEN", name: "DENVER", kind: "vortac" })).toEqual({ ident: "DEN", name: "DENVER", kind: "vortac" });
    expect(parseAviationProperties("sua", { kind: "restricted", name: "R-2601" })).toEqual({ kind: "restricted", name: "R-2601" });
    expect(parseAviationProperties("obstacles", { agl_ft: 1049, lit: true })).toEqual({ aglFt: 1049, lit: true });
  });

  it("keeps optional airspace altitudes optional", () => {
    expect(parseAviationProperties("airspace", { class: "D", name: "BOULDER" })).toEqual({ class: "D", name: "BOULDER" });
  });

  it.each([
    ["airspace", { class: "E", name: "X" }],
    ["airspace", { class: "B", name: " " }],
    ["sua", { kind: "tfr", name: "X" }],
    ["runways", { airport: "DEN", runway: "8/26", width_ft: 0, length_ft: 1000 }],
    ["runways", { airport: "DEN", runway: " ", width_ft: 100, length_ft: 1000 }],
    ["airports", { ident: "DEN", name: "DENVER", kind: "airport", use: "public", towered: "yes" }],
    ["navaids", { ident: "DEN", name: "DENVER", kind: "vhf" }],
    ["obstacles", { agl_ft: -5, lit: false }],
    ["obstacles", { agl_ft: Number.NaN, lit: false }],
  ] as const)("drops %s features that break the contract: %j", (layer, raw) => {
    expect(parseAviationProperties(layer, raw)).toBeUndefined();
  });

  it("refuses to write a feature the browser would drop", () => {
    expect(() => aviationTileProperties("sua", { kind: "moa", name: "" })).toThrow("sua contract");
  });

  it("recognizes only the registered layer names", () => {
    expect(AVIATION_LAYERS.every(isAviationLayer)).toBe(true);
    expect(isAviationLayer("roads")).toBe(false);
  });
});

describe("aviation archive metadata", () => {
  const metadata = { dataset: "faa-aviation-2026-09-03-v1", nasrCycle: "2026-09-03", obstacleDate: "2026-09-27", suaDate: "2026-09-29" };

  it("round-trips the builder's metadata", () => {
    expect(parseAviationArchiveMetadata(aviationArchiveMetadata(metadata))).toEqual(metadata);
  });

  it.each([
    { topostack_dataset: "faa-aviation-v1" },
    { topostack_dataset: "faa-aviation-2026-10-01-v1" },
    { faa_nasr_cycle: "2026-9-3" },
    { faa_obstacle_date: undefined },
    { faa_sua_date: "2026-02-31x" },
  ])("rejects inconsistent metadata: %j", (patch) => {
    expect(() => parseAviationArchiveMetadata({ ...aviationArchiveMetadata(metadata), ...patch })).toThrow();
  });

  it("rejects missing metadata", () => {
    expect(() => parseAviationArchiveMetadata(null)).toThrow();
  });
});

describe("aviation source registration", () => {
  it("accepts the pinned build registration", () => {
    const sources = validateAviationSources(registration);
    expect(sources.dataset).toBe(registration.dataset);
    expect(sources.dataset.startsWith(`faa-aviation-${sources.nasrCycle}-`)).toBe(true);
    expect(sources.coverage.map((region) => region.id)).toContain("conus-west");
  });

  it.each([
    { url: "http://faa.gov" }, { maxZoom: 16 }, { coverage: [] },
    { coverage: [{ id: "x", bounds: [10, 0, 5, 1] }] },
    { coverage: [{ id: "x", bounds: [0, 0, 1, 1] }, { id: "x", bounds: [2, 0, 3, 1] }] },
    { dataset: "faa-aviation-2026-01-01-v1" }, { license: "" },
  ])("rejects an invalid registration: %j", (patch) => {
    expect(() => validateAviationSources({ ...registration, ...patch })).toThrow();
  });

  it("reports coverage by region intersection", () => {
    const sources = validateAviationSources(registration);
    expect(aviationCovers(sources, { west: -105.2, south: 39.6, east: -104.5, north: 40.0 })).toBe(true);
    expect(aviationCovers(sources, { west: -158.1, south: 21.2, east: -157.6, north: 21.5 })).toBe(true);
    expect(aviationCovers(sources, { west: -123.4, south: 50.0, east: -123.0, north: 50.3 })).toBe(false);
    expect(aviationCovers(sources, { west: 7.4, south: 46.4, east: 8.1, north: 46.8 })).toBe(false);
    // Algonquin Park, Ontario: north of the Great Lakes, between the US boxes.
    expect(aviationCovers(sources, { west: -78.96, south: 46.45, east: -78.92, north: 46.48 })).toBe(false);
    expect(aviationCovers(sources, { west: -71.1, south: 42.3, east: -70.9, north: 42.4 })).toBe(true);
  });
});
