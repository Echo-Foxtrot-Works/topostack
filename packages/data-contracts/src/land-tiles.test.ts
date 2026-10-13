import { describe, expect, it } from "vitest";
import registration from "../../../scripts/data/public-lands-sources.json";
import { LAND_CLASSES, isLandClass, landTileProperties, landsArchiveMetadata, landsCovers, parseLandProperties, parseLandsArchiveMetadata, validateLandsSources } from "./land-tiles";

describe("land tile properties", () => {
  it("round-trips a named unit and an unnamed one", () => {
    const park = { class: "national-park", unit: "national-park:Rocky Mountain National Park", name: "Rocky Mountain National Park", manager: "NPS", acres: 265_000 } as const;
    expect(parseLandProperties(landTileProperties(park))).toEqual(park);
    const blm = { class: "blm", unit: "blm:UT", manager: "BLM", acres: 22_768_662 } as const;
    expect(landTileProperties(blm)).toEqual(blm);
    expect(parseLandProperties(landTileProperties(blm))).toEqual(blm);
  });

  it("keeps a feature but drops a malformed optional detail", () => {
    const base = { class: "preserve", unit: "preserve:Walden Woods:MA", acres: 12 };
    expect(parseLandProperties({ ...base, name: " " })).toEqual(base);
    expect(parseLandProperties({ ...base, manager: "TOO-LONG-CODE" })).toEqual(base);
    expect(parseLandProperties({ ...base, name: 7 })).toEqual(base);
    expect(() => landTileProperties({ ...base, class: "preserve", name: "" })).toThrow("lands contract");
  });

  it.each([
    [{ class: "city-park", unit: "x", acres: 1 }, "an unknown class"],
    [{ class: "blm", unit: " ", acres: 1 }, "a blank unit"],
    [{ class: "blm", unit: "blm:NV", acres: -1 }, "negative acres"],
    [{ class: "blm", unit: "blm:NV", acres: 1.5 }, "fractional acres"],
    [{ class: "blm", unit: "blm:NV", acres: 900_000_000 }, "acres beyond any unit"],
    [{ class: "blm", unit: "blm:NV" }, "no acres"],
    [null, "no properties"],
  ])("drops %j (%s)", (raw, _reason) => {
    expect(parseLandProperties(raw)).toBeUndefined();
  });

  it("recognizes only the registered classes", () => {
    expect(LAND_CLASSES.every(isLandClass)).toBe(true);
    expect(isLandClass("water")).toBe(false);
  });
});

describe("lands archive metadata", () => {
  const metadata = { dataset: "public-lands-2025-03-31-v1", padusVersion: "4.1", padusDate: "2025-03-31" };

  it("round-trips the builder's metadata", () => {
    expect(parseLandsArchiveMetadata(landsArchiveMetadata(metadata))).toEqual(metadata);
  });

  it.each([
    { topostack_dataset: "public-lands-v1" },
    { topostack_dataset: "public-lands-2024-04-01-v1" },
    { padus_version: "4" },
    { padus_date: "2025-3-31" },
    { padus_date: undefined },
  ])("rejects inconsistent metadata: %j", (patch) => {
    expect(() => parseLandsArchiveMetadata({ ...landsArchiveMetadata(metadata), ...patch })).toThrow();
  });

  it("rejects missing metadata", () => {
    expect(() => parseLandsArchiveMetadata(undefined)).toThrow();
  });
});

describe("lands source registration", () => {
  it("accepts the pinned build registration", () => {
    const sources = validateLandsSources(registration);
    expect(sources.dataset).toBe(registration.dataset);
    expect(sources.dataset.startsWith(`public-lands-${sources.padusDate}-`)).toBe(true);
    expect(sources.refugeOwnedShare).toBe(0.25);
    expect(sources.minZoom).toBeLessThan(sources.maxZoom);
  });

  it.each([
    { url: "http://doi.org/x" }, { maxZoom: 16 }, { minZoom: 13 }, { minZoom: 1.5 }, { coverage: [] }, { coverage: "conus" },
    { coverage: [{ id: "x", bounds: [10, 0, 5, 1] }] },
    { coverage: [{ id: "x", bounds: [0, 0, 1, 1] }, { id: "x", bounds: [2, 0, 3, 1] }] },
    { coverage: [null] },
    { refugeOwnedShare: 0 }, { refugeOwnedShare: 1.5 }, { refugeOwnedShare: "0.25" },
    { dataset: "public-lands-2024-04-01-v1" }, { license: "" },
  ])("rejects an invalid registration: %j", (patch) => {
    expect(() => validateLandsSources({ ...registration, ...patch })).toThrow();
  });

  it("rejects a registration that is not an object", () => {
    expect(() => validateLandsSources("public-lands")).toThrow();
  });

  it.each([
    ["Rocky Mountain National Park", -105.68, 40.34], ["Moab, UT", -109.55, 38.57], ["Shreveport, LA", -93.75, 32.45],
    ["Northwest Angle, MN", -95.1, 49.35], ["Key West, FL", -81.78, 24.55], ["Denali", -151.0, 63.1], ["Haleakala", -156.17, 20.71],
    ["El Yunque", -65.78, 18.3], ["Midway Atoll", -177.38, 28.2],
  ])("covers %s", (_name, lon, lat) => {
    expect(landsCovers(validateLandsSources(registration), { west: lon - 0.01, south: lat - 0.01, east: lon + 0.01, north: lat + 0.01 })).toBe(true);
  });

  it.each([
    ["Algonquin Park, Ontario", -78.94, 46.46], ["Banff", -115.57, 51.18], ["the Alps", 7.8, 46.6],
  ])("does not cover %s", (_name, lon, lat) => {
    expect(landsCovers(validateLandsSources(registration), { west: lon - 0.01, south: lat - 0.01, east: lon + 0.01, north: lat + 0.01 })).toBe(false);
  });
});
