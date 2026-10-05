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

  it("round-trips the sectional legend details", () => {
    const airport = {
      ident: "DEN", name: "DENVER INTL", kind: "airport", use: "public", towered: true, longestRunwayFt: 16000, hardRunwayFt: 16000,
      fuel: true, beacon: true, jointUse: false, runwayPattern: [[0, 2000, 0, -2000], [-1500, 30, 1500, -30]] as Array<[number, number, number, number]>,
    } as const;
    const written = aviationTileProperties("airports", airport);
    expect(written.runway_pattern).toBe("0,2000,0,-2000;-1500,30,1500,-30");
    expect(parseAviationProperties("airports", written)).toEqual(airport);
    const obstacle = { aglFt: 480, lit: true, highIntensity: true, windTurbine: true, quantity: 12 };
    expect(parseAviationProperties("obstacles", aviationTileProperties("obstacles", obstacle))).toEqual(obstacle);
  });

  it("keeps a feature but drops a malformed optional detail", () => {
    const base = { ident: "X", name: "X", kind: "airport", use: "public", towered: false };
    for (const runway_pattern of ["1,2,3", "1,2,3,x", "1.5,2,3,4", "0,0,0,99999", ""]) {
      expect(parseAviationProperties("airports", { ...base, runway_pattern })).toEqual(base);
    }
    expect(parseAviationProperties("airports", { ...base, fuel: "Y" })).toEqual(base);
    expect(parseAviationProperties("obstacles", { agl_ft: 300, lit: false, quantity: 1 })).toEqual({ aglFt: 300, lit: false });
    expect(() => aviationTileProperties("obstacles", { aglFt: 300, lit: false, quantity: 1 })).toThrow("obstacles contract");
  });

  it("round-trips airspace label candidates", () => {
    const shelf = { class: "B", area: 3, ceilingFt: 12000, floorFt: 8000, clearanceM: 4200 } as const;
    expect(aviationTileProperties("airspace_labels", shelf)).toEqual({ class: "B", area: 3, ceiling_ft: 12000, floor_ft: 8000, clearance_m: 4200 });
    expect(parseAviationProperties("airspace_labels", aviationTileProperties("airspace_labels", shelf))).toEqual(shelf);
    const tower = { class: "D", area: 9, ceilingFt: 2500, ceilingBelow: true, clearanceM: 7000 } as const;
    expect(parseAviationProperties("airspace_labels", aviationTileProperties("airspace_labels", tower))).toEqual(tower);
  });

  it("keeps optional airspace altitudes optional", () => {
    expect(parseAviationProperties("airspace", { class: "D", name: "BOULDER" })).toEqual({ class: "D", name: "BOULDER" });
  });

  it.each([
    ["airspace", { class: "E", name: "X" }],
    ["airspace", { class: "B", name: " " }],
    ["sua", { kind: "tfr", name: "X" }],
    ["airspace_labels", { class: "C", area: 1, ceiling_ft: 4800, clearance_m: 900 }],
    ["airspace_labels", { class: "D", area: -1, ceiling_ft: 2500, clearance_m: 900 }],
    ["airspace_labels", { class: "D", area: 1, ceiling_ft: 2500, clearance_m: 0 }],
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

  // Places where the boxes meet: each lies inside one box, not merely touching two.
  it.each([
    ["Shreveport, LA", -93.75, 32.45], ["Longview, TX", -94.74, 32.5], ["Fayetteville, AR", -94.16, 36.07], ["Fort Smith, AR", -94.37, 35.34],
    ["Hogansburg, NY", -74.67, 45.01], ["Northwest Angle, MN", -95.1, 49.35], ["Key West, FL", -81.78, 24.55], ["Brownsville, TX", -97.43, 25.9],
    ["Midway Atoll", -177.38, 28.2], ["Wake Island", 166.64, 19.28],
  ])("covers %s", (_name, lon, lat) => {
    const sources = validateAviationSources(registration);
    expect(aviationCovers(sources, { west: lon - 0.01, south: lat - 0.01, east: lon + 0.01, north: lat + 0.01 })).toBe(true);
  });
});
