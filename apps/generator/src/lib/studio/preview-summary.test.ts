import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type GeometryIRV1, type LayerIR, type WaterSurfaceIR } from "@topostack/core";
import { acrylicPanelCount, activeDetailCount, activeLinePreset, countDetailMarkings, featuredLayerIndex, insertLakes, layerForEnabledDetail, modeledLakes, sectionSummary, visibleWarnings } from "$lib/studio/preview-summary";
import { LINE_PRESETS } from "$lib/studio/options";

const marking = (id: string, kind: string) => ({ id, kind, points: [] });
const layer = (index: number, markings: Array<ReturnType<typeof marking>>) => ({ index, markings }) as unknown as LayerIR;
const geometry = (layers: LayerIR[], waterSurfaces: Array<Partial<WaterSurfaceIR>> = []) => ({ layers, waterSurfaces, warnings: [] }) as unknown as GeometryIRV1;

describe("preview summaries", () => {
  const layers = [
    layer(0, [marking("north-arrow", "engrave"), marking("scale-bar", "engrave")]),
    layer(1, [marking("road-1", "road"), marking("contour-1", "contour")]),
    layer(2, [marking("trail-1", "trail"), marking("transport-label-1", "engrave"), marking("custom-data-line-1", "trail"), marking("map-marker-1", "engrave")]),
  ];

  it("features the layer with the most informative markings and finds newly enabled details", () => {
    expect(featuredLayerIndex(geometry(layers))).toBe(2);
    expect(layerForEnabledDetail(geometry(layers), { showRoads: true })).toBe(1);
    expect(layerForEnabledDetail(geometry(layers), { showNorthArrow: true })).toBe(0);
    expect(layerForEnabledDetail(geometry(layers), { showWaterDepth: true })).toBeUndefined();
    expect(layerForEnabledDetail(geometry(layers, [{ layerIndex: 3 }]), { showWaterDepth: true })).toBe(3);
    expect(layerForEnabledDetail(geometry(layers), { name: "Renamed" })).toBeUndefined();
  });

  it("counts markings per detail, adding implicit contours for engravings", () => {
    expect(countDetailMarkings(layers, "stack")).toMatchObject({ road: 1, trail: 2, contour: 1, north: 1, scale: 1, transportationLabel: 1, customLine: 1, marker: 1 });
    expect(countDetailMarkings(layers, "engraving").contour).toBe(3);
  });

  it("lists modeled lakes deepest first, skipping surveyed basins", () => {
    const lakes = modeledLakes([
      { id: "a", kind: "lake", hylakId: 1, maxDepthM: 10, depthSource: "predicted" },
      { id: "b", kind: "lake", hylakId: 2, maxDepthM: 40, depthSource: "predicted", name: "Deep" },
      { id: "c", kind: "lake", hylakId: 3, maxDepthM: 90, depthSource: "surveyed" },
      { id: "d", kind: "river", hylakId: 4, maxDepthM: 90 },
    ] as unknown as WaterSurfaceIR[]);
    expect(lakes.map((lake) => [lake.id, lake.name])).toEqual([["b", "Deep"], ["a", "Lake 1"]]);
    expect(modeledLakes(undefined)).toEqual([]);
  });

  it("lists every lake an acrylic insert could replace, one row per lake, largest first", () => {
    const square = (size: number) => [{ outer: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }, { x: 0, y: 0 }], holes: [] }];
    const waterSurfaces = [
      { id: "lake-7-0", kind: "lake", hylakId: 7, name: "Split", polygons: square(10) },
      { id: "lake-7-1", kind: "lake", hylakId: 7, name: "Split", polygons: square(10) },
      { id: "osm-lake-2", kind: "lake", polygons: square(30) },
      { id: "sea", kind: "ocean", polygons: square(99) },
      { id: "lake-9-0", kind: "lake", hylakId: 9, name: "Off", polygons: square(5) },
    ] as unknown as WaterSurfaceIR[];
    const waterInserts = [{ id: "W1", lakeKey: "osm-lake-2" }, { id: "W2", lakeKey: "7" }, { id: "W3", lakeKey: "7" }] as GeometryIRV1["waterInserts"];
    expect(insertLakes({ waterSurfaces, waterInserts }, { waterInserts: { fitClearanceMm: 0.1, excludedLakeIds: ["9"] } })).toEqual([
      { key: "osm-lake-2", name: "Lake 1", insertIds: ["W1"], excluded: false },
      { key: "7", name: "Split", insertIds: ["W2", "W3"], excluded: false },
      { key: "9", name: "Off", insertIds: [], excluded: true },
    ]);
    const insert = (id: string, layerIndex: number, x: number) => ({ id, layerIndex, polygons: square(40).map((polygon) => ({ ...polygon, outer: polygon.outer.map((point) => ({ x: point.x + x, y: point.y })) })) });
    const inserts = { waterInserts: [insert("W1", 3, 0), insert("W2", 3, 100), insert("W3", 5, 0)] as unknown as GeometryIRV1["waterInserts"], waterInsertMaterial: { thicknessMm: 3, kerfMm: 0, fitClearanceMm: 0, ledgeMm: 2 } };
    // One panel per sheet holding inserts, until a sheet's inserts together outgrow the bed.
    expect(acrylicPanelCount(inserts, { workAreaWidthMm: 0, workAreaHeightMm: 0 })).toBe(2);
    expect(acrylicPanelCount(inserts, { workAreaWidthMm: 100, workAreaHeightMm: 100 })).toBe(3);
    expect(acrylicPanelCount({}, DEFAULT_PROJECT)).toBe(0);
    expect(sectionSummary("advanced", { ...DEFAULT_PROJECT, waterInserts: { fitClearanceMm: 0.1, excludedLakeIds: [] } }, 8)).toContain("Acrylic water");
  });

  it("deduplicates, filters dismissed, prioritizes depth actions, and limits warnings", () => {
    const warnings = [
      { code: "LABEL_OMITTED", message: "Labels" },
      { code: "BATHYMETRY_FALLBACK", message: "Gap" },
      { code: "BATHYMETRY_FALLBACK", message: "Gap" },
      { code: "LAKE_DEPTH_PREDICTED", message: "Predicted" },
      { code: "WATER_DEPTH_CLAMPED", message: "Too deep", action: "fit-lake-depth" },
    ] as GeometryIRV1["warnings"];
    expect(visibleWarnings(warnings, []).map((warning) => warning.message)).toEqual(["Too deep", "Predicted"]);
    expect(visibleWarnings(warnings, ["WATER_DEPTH_CLAMPED-Too deep", "LAKE_DEPTH_PREDICTED-Predicted"]).map((warning) => warning.message)).toEqual(["Labels", "Gap"]);
  });

  it("summarizes sidebar sections for the output mode", () => {
    const engraving = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, showWaterDepth: true, showEngravingBorder: true };
    expect(activeDetailCount(engraving)).toBe(activeDetailCount({ ...engraving, showWaterDepth: false }));
    expect(sectionSummary("details", engraving, 0)).toMatch(/^\d+ details? enabled$/);
    expect(sectionSummary("terrain", DEFAULT_PROJECT, 12)).toBe(`12 layers · ${DEFAULT_PROJECT.materialThicknessMm} mm material`);
    expect(sectionSummary("customData", { ...DEFAULT_PROJECT, markers: [], customLines: [] }, 0)).toBe("0 markers · 0 paths");
    expect(sectionSummary("advanced", { ...DEFAULT_PROJECT, paintTemplates: ["water"] }, 0)).toMatch(/· Paint templates$/);
    expect(sectionSummary("advanced", { ...DEFAULT_PROJECT, paintTemplates: ["water"], outputMode: "engraving" }, 0)).not.toMatch(/Paint templates/);
    const bold = LINE_PRESETS.find((preset) => preset.value === "bold")!;
    expect(activeLinePreset(bold.style)).toBe("bold");
    expect(sectionSummary("linework", { ...DEFAULT_PROJECT, lineStyle: bold.style }, 0)).toBe("Bold preset");
    expect(sectionSummary("linework", { ...DEFAULT_PROJECT, lineStyle: { ...bold.style, contourMm: 0.99 } }, 0)).toBe("Custom stroke widths");
  });
});
