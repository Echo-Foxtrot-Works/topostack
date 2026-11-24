import { describe, expect, it } from "vitest";
import directoryJson from "../../../static/data/lake-depth-directory.json";
import surveyCatalog from "../../../../../scripts/data/lake-bathymetry.json";
import builds from "../../../../../scripts/data/lake-survey-builds.json";
import { indexLakeDirectory, lakeStudioLink, searchLakes, type LakeDirectory } from "$lib/site/lake-directory";
import { lakeLocationFromSearch } from "$lib/site/lake-location";

const directory = directoryJson as LakeDirectory;
const lakes = indexLakeDirectory(directory);

describe("surveyed lake directory", () => {
  it("lists each integrated survey grid, excludes skipped basins, and includes all six NOAA lakes", () => {
    expect(directory.sources.map((source) => source.id)).toEqual(surveyCatalog.sources.map((source) => source.id));
    for (const archive of builds.archives) {
      expect(directory.sources.find(source => source.id === archive.dataset)?.archiveSha256).toBe(archive.sha256);
      expect(lakes.filter((lake) => lake.sourceId === archive.dataset)).toHaveLength(archive.processedGrids);
    }
    expect(lakes.filter((lake) => lake.sourceId === "noaa-great-lakes-v1")).toHaveLength(6);
    expect(new Set(lakes.map((lake) => lake.id)).size).toBe(lakes.length);
    for (const [region, dataset] of [["minnesota", "mn-dnr-lakes-v1"], ["finland", "syke-finland-lakes-v1"], ["norway", "nve-norway-lakes-v1"], ["ontario", "ontario-lakes-v1"]] as const) {
      for (const skipped of builds.skipped[region]) expect(lakes.some((lake) => lake.sourceId === dataset && lake.surveyId === skipped.id)).toBe(false);
    }
    for (const lake of lakes) {
      expect(lake.name.trim()).not.toBe("");
      expect(lake.source.url).toMatch(/^https:\/\//);
      const location = lakeLocationFromSearch(new URL(lakeStudioLink("", lake), "https://example.test").search);
      expect(location, lake.id).toBeDefined();
    }
  });

  it("finds every integrated lake by its name and survey identifier", () => {
    for (const lake of lakes) {
      expect(searchLakes(lakes, `${lake.name} ${lake.surveyId}`).some((result) => result.id === lake.id), lake.id).toBe(true);
    }
  }, 30000);

  it("finds common aliases, accents, source names, county names, and survey IDs", () => {
    expect(searchLakes(lakes, "lake geneva").some((lake) => lake.name === "Lac Léman")).toBe(true);
    expect(searchLakes(lakes, "zurich").some((lake) => lake.name === "Zürichsee")).toBe(true);
    expect(searchLakes(lakes, "kauniinjarvi").length).toBeGreaterThan(0);
    expect(searchLakes(lakes, "Pine Aitkin").length).toBeGreaterThan(0);
    expect(searchLakes(lakes, "01000100")[0]?.name).toBe("Pine");
    expect(searchLakes(lakes, "crater USGS")).toHaveLength(1);
    expect(searchLakes(lakes, "Tinnsja NVE").some((lake) => lake.name === "Tinnsjå")).toBe(true);
    expect(searchLakes(lakes, "Alan Henry Texas")).toHaveLength(1);
    expect(searchLakes(lakes, "Kawagama Ontario")).toHaveLength(1);
    expect(searchLakes(lakes, "Pinewood Reclamation")).toHaveLength(1);
    expect(searchLakes(lakes, "missing lake xxxxxxxxx")).toEqual([]);
  });

  it("combines search, region, and survey type without treating modeled depths as measured coverage", () => {
    expect(searchLakes(lakes, "", "Finland", "contours")).toHaveLength(1821);
    expect(searchLakes(lakes, "", "Finland", "grid")).toHaveLength(0);
    expect(searchLakes(lakes, "Crater", "United States", "grid")).toHaveLength(1);
    expect(searchLakes(lakes, "GLOBathy")).toHaveLength(0);
    expect(searchLakes(lakes, "", "Great Lakes", "grid")).toHaveLength(6);
  });

  it("frames the selected lake and encodes its name safely in studio links", () => {
    const lake = lakes.find((lake) => lake.name === "Crater Lake")!;
    const link = lakeStudioLink("/tools", { ...lake, name: "Lake & Ridge?" });
    const url = new URL(link, "https://example.test");
    expect(url.pathname).toBe("/tools/studio");
    const location = lakeLocationFromSearch(url.search)!;
    expect(location.label).toBe("Lake & Ridge?");
    expect(location.bounds!.west).toBeLessThan(lake.bounds[0]);
    expect(location.bounds!.east).toBeGreaterThan(lake.bounds[2]);
    expect(location.lat).toBeCloseTo(42.94, 1);
  });

  it("fits long lakes inside the existing physical cut without losing either end", () => {
    const location = lakeLocationFromSearch("?lake=Long%20lake&bounds=8,46,8.02,47", 300, 200)!;
    expect(location.bounds!.west).toBeLessThan(8);
    expect(location.bounds!.east).toBeGreaterThan(8.02);
    expect(location.bounds!.south).toBeCloseTo(46);
    expect(location.bounds!.north).toBeCloseTo(47);
  });

  it("rejects malformed or out-of-range place links", () => {
    for (const search of ["", "?lake=Foo", "?lake=&bounds=1,2,3,4", "?lake=Foo&bounds=1,,3,4", "?lake=Foo&bounds=1,2,3", "?lake=Foo&bounds=5,2,3,4", "?lake=Foo&bounds=1,2,3,90", "?lake=Foo&bounds=NaN,2,3,4", "?lake=Foo&bounds=-181,2,3,4", `?lake=${"x".repeat(181)}&bounds=1,2,3,4`]) {
      expect(lakeLocationFromSearch(search)).toBeUndefined();
    }
  });
});
