import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, depthChartLakeKey, validateProject, type ProjectConfigV1 } from "../index.js";

describe("project validation", () => {
  it("bounds project metadata, dimensions, and custom-data complexity", () => {
    const marker = { id: "marker", lat: DEFAULT_PROJECT.location.lat, lon: DEFAULT_PROJECT.location.lon, symbol: "pin" as const };
    const point = { lat: DEFAULT_PROJECT.location.lat, lon: DEFAULT_PROJECT.location.lon };
    expect(() => validateProject({ ...DEFAULT_PROJECT, name: "x".repeat(121) })).toThrow(/project name/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, widthMm: 10_001 })).toThrow(/dimensions/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: Array.from({ length: 251 }, (_, index) => ({ ...marker, id: "marker-" + index })) })).toThrow(/250 markers/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, customLines: [{ id: "long", kind: "trail", points: Array.from({ length: 2_001 }, () => point) }] })).toThrow(/2000 points/i);
  });

  it("checks the same switches the project reader does", () => {
    for (const key of ["seamTabs", "showAssemblyLabels"] as const) {
      expect(() => validateProject({ ...DEFAULT_PROJECT, [key]: "yes" } as unknown as ProjectConfigV1), key).toThrow(`${key} must be true or false.`);
    }
  });

  it("takes a name on a marker or a path, or none at all", () => {
    const marker = { id: "marker", lat: DEFAULT_PROJECT.location.lat, lon: DEFAULT_PROJECT.location.lon, symbol: "pin" as const };
    const point = { lat: DEFAULT_PROJECT.location.lat, lon: DEFAULT_PROJECT.location.lon };
    const path = { id: "path", kind: "trail" as const, points: [point, point] };
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, name: "Trailhead" }] })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, customLines: [{ ...path, name: "North boundary" }] })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, name: "x".repeat(61) }] })).toThrow(/marker name/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, customLines: [{ ...path, name: "x".repeat(61) }] })).toThrow(/custom line name/i);
    // A stored empty name would be a name that says nothing; there is no such thing.
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, name: "  " }] })).toThrow(/marker name/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, name: 7 as never }] })).toThrow(/marker name/i);
  });

  it("ties custom markers to the project's own well-formed icons", () => {
    const icon = { id: "icon-0001", name: "Cabin", shapes: [{ outer: [-500, 500, 500, 500, 0, -500] }] };
    const marker = { id: "marker", lat: DEFAULT_PROJECT.location.lat, lon: DEFAULT_PROJECT.location.lon, symbol: "custom" as const, iconId: icon.id };
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [icon], markers: [marker] })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, anchor: "bottom" }], markers: [marker] })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [marker] })).toThrow(/custom marker/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [icon], markers: [{ ...marker, iconId: "icon-0002" }] })).toThrow(/custom marker/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [icon], markers: [{ ...marker, symbol: "pin" }] })).toThrow(/only custom markers/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [icon, icon] })).toThrow(/unique/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, id: "Short" }] })).toThrow(/icon id/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, name: " " }] })).toThrow(/icon name/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, anchor: "top" as never }] })).toThrow(/anchor/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, shapes: [] }] })).toThrow(/at least one shape/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, shapes: [{ outer: [0, 0, 1, 1.5, 2, 0] }] }] })).toThrow(/whole-number/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, shapes: [{ outer: [0, 0, 501, 0, 0, 1] }] }] })).toThrow(/whole-number/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, shapes: [{ outer: Array.from({ length: 1602 }, (_, index) => index % 400) }] }] })).toThrow(/800 points/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markerIcons: Array.from({ length: 25 }, (_, index) => ({ ...icon, id: `icon-${String(index).padStart(4, "0")}` })) })).toThrow(/24 marker icons/i);
  });

  it("accepts bounded positive fabrication sizes", () => {
    expect(() => validateProject({ ...DEFAULT_PROJECT, widthMm: 2_400, heightMm: 1_200 })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, widthMm: 0 })).toThrow(/greater than zero/i);
  });

  it("validates physical line widths and trail patterns", () => {
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, contourMm: 0.04 } })).toThrow(/line widths/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, majorRoadMm: 1.51 } })).toThrow(/line widths/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, trailPattern: "railroad" as never } })).toThrow(/trail pattern/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, boundaryMm: 0.01 } })).toThrow(/line widths/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, coordinateGridMm: 0.01 } })).toThrow(/line widths/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, majorRoadSpacingMm: 4.1 } })).toThrow(/road spacing/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, roadStyle: "bordered" as never } })).toThrow(/road style/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, roadCap: "butt" as never } })).toThrow(/road cap/i);
  });

  it("rejects out-of-range exaggeration and unknown crop shapes", () => {
    expect(() => validateProject({ ...DEFAULT_PROJECT, verticalExaggeration: 10 })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, verticalExaggeration: 1.1, waterDepthExaggeration: 1.05 })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, verticalExaggeration: 0.5 })).toThrow(/vertical exaggeration/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, verticalExaggeration: 10.01 })).toThrow(/vertical exaggeration/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, cropShape: "hexagon" as ProjectConfigV1["cropShape"] })).toThrow(/rectangle or circle/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, textStyle: { font: "serif" as ProjectConfigV1["textStyle"]["font"], sizeMm: 3 } })).toThrow(/text font/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, textStyle: { font: "technical", sizeMm: 10.1 } })).toThrow(/text size/i);
  });

  it("rejects depth chart references that name no lake, chart, or content", () => {
    const reference = { id: "round-lake-chart", contentHash: "a".repeat(64) };
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: { "9092": reference } })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: undefined })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: { lake: reference } })).toThrow(/HydroLAKES id/i);
    // A lake HydroLAKES does not know is named by the chart itself.
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: { "outline:round-lake-chart": reference } })).not.toThrow();
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: { "outline:other-lake-chart": reference } }), "an outline key names its own chart").toThrow(/outline:/);
    expect(depthChartLakeKey({ id: "round-lake-chart", hylakId: 9092 })).toBe("9092");
    expect(depthChartLakeKey({ id: "round-lake-chart" })).toBe("outline:round-lake-chart");
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: { "1": { ...reference, id: "Round Lake" } } })).toThrow(/depth chart id/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: { "1": { ...reference, contentHash: "short" } } })).toThrow(/content hash/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: { "1": "round-lake-chart" } as never })).toThrow(/must be an object/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, userDepthCharts: [] as never })).toThrow(/must be an object/i);
  });
});
