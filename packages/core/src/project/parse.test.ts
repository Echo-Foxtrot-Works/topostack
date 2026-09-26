import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type ProjectConfigV1 } from "../types.js";
import { parseProject } from "./parse.js";

describe("project import validation", () => {
  it("accepts a valid v1 project", () => expect(parseProject(DEFAULT_PROJECT)).toMatchObject({ schemaVersion: 1, widthMm: 300 }));
  it("restores markers and defaults legacy projects to an empty marker list", () => {
    const markers = [
      { id: "one", lat: 42.9, lon: -122.1, symbol: "triangle" as const },
      { id: "two", lat: 43, lon: -122, symbol: "cross" as const },
    ];
    expect(parseProject({ ...DEFAULT_PROJECT, markers }).markers).toEqual(markers.map(marker => ({ ...marker, sizeMm: 8 })));
    const { markers: _legacyMarkers, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).markers).toEqual([]);
    expect(() => parseProject({ ...DEFAULT_PROJECT, markers: [{ ...markers[0], symbol: "flag" }] })).toThrow(/marker symbol/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, markers: [{ ...markers[0], lon: 200 }] })).toThrow(/marker longitude/i);
  });
  it("restores uploaded marker icons, drops malformed ones, and turns their orphaned markers into pins", () => {
    const icon = { id: "icon-0001", name: "Cabin", anchor: "bottom" as const, shapes: [{ outer: [-500, 500, 500, 500, 0, -500], holes: [[-100, 300, 100, 300, 0, 0]] }] };
    const marker = { id: "cabin", lat: 43, lon: -122, symbol: "custom" as const, sizeMm: 8, iconId: icon.id };
    const project = parseProject({ ...DEFAULT_PROJECT, markerIcons: [icon], markers: [marker] });
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toMatchObject({ markerIcons: [icon], markers: [marker] });
    // Projects without icons keep no field, and so keep their fingerprints.
    expect(parseProject(DEFAULT_PROJECT)).not.toHaveProperty("markerIcons");
    for (const broken of [{ ...icon, id: "BAD" }, { ...icon, shapes: [{ outer: [0, 0, 1.5, 1, 2, 0] }] }, { ...icon, shapes: [{ outer: [0, 0, 1, 1, 2, 0], holes: [[0]] }] }, { ...icon, shapes: [] }, "icon"]) {
      const loaded = parseProject({ ...DEFAULT_PROJECT, markerIcons: [broken], markers: [marker] });
      expect(loaded).not.toHaveProperty("markerIcons");
      expect(loaded.markers).toEqual([{ id: "cabin", lat: 43, lon: -122, symbol: "pin", sizeMm: 8 }]);
    }
    // A blank or overlong name is replaced rather than losing the icon.
    expect(parseProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, name: " " }] }).markerIcons?.[0]!.name).toBe("Icon");
    expect(parseProject({ ...DEFAULT_PROJECT, markerIcons: [{ ...icon, anchor: "top" }] }).markerIcons?.[0]).not.toHaveProperty("anchor");
    expect(parseProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, symbol: "star" }] }).markers[0]).not.toHaveProperty("iconId");
  });
  it("round-trips marker size and rejects malformed sizes", () => {
    const marker = { id: "sized", lat: 43, lon: -122, symbol: "star", sizeMm: 12.5 };
    const project = parseProject({ ...DEFAULT_PROJECT, markers: [marker] });
    expect(parseProject(JSON.parse(JSON.stringify(project))).markers).toEqual([marker]);
    for (const sizeMm of [null, "12", 0, -1, 201, NaN, Infinity]) {
      expect(() => parseProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, sizeMm }] })).toThrow(/marker size/i);
    }
  });
  it("keeps marker and path names through a save and load, and drops unusable ones", () => {
    const marker = { id: "named", lat: 43, lon: -122, symbol: "pin", sizeMm: 8, name: "Trailhead" };
    const line = { id: "loop", kind: "trail" as const, points: [{ lat: 42.9, lon: -122.1 }, { lat: 43, lon: -122 }], name: "Rim loop" };
    const project = parseProject({ ...DEFAULT_PROJECT, markers: [marker], customLines: [line] });
    const reloaded = parseProject(JSON.parse(JSON.stringify(project)));
    expect(reloaded.markers).toEqual([marker]);
    expect(reloaded.customLines).toEqual([line]);
    // A name is only bookkeeping, so a bad one is dropped rather than refusing the project.
    for (const name of ["   ", 42, "x".repeat(61)]) {
      expect(parseProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, name }] }).markers[0]).not.toHaveProperty("name");
    }
    expect(parseProject({ ...DEFAULT_PROJECT, markers: [{ ...marker, name: "  Dock  " }] }).markers[0]!.name).toBe("Dock");
  });
  it("restores custom trails and boundaries and defaults legacy projects to no paths", () => {
    const customLines = [
      { id: "trail-1", kind: "trail" as const, points: [{ lat: 42.9, lon: -122.1 }, { lat: 43, lon: -122 }] },
      { id: "boundary-1", kind: "boundary" as const, points: [{ lat: 42.8, lon: -122.2 }, { lat: 43.1, lon: -121.9 }] },
    ];
    expect(parseProject({ ...DEFAULT_PROJECT, customLines }).customLines).toEqual(customLines);
    const { customLines: _legacyCustomLines, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).customLines).toEqual([]);
    expect(() => parseProject({ ...DEFAULT_PROJECT, customLines: [{ ...customLines[0], kind: "river" }] })).toThrow(/trail or boundary/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, customLines: [{ ...customLines[0], points: [customLines[0]!.points[0]] }] })).toThrow(/at least two points/i);
  });
  it("validates and restores flat engraving settings", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, outputMode: "engraving", engravingContourCount: 24, engravingIndexInterval: 6, showEngravingBorder: false, waterFillPattern: "ripples" })).toMatchObject({
      outputMode: "engraving",
      engravingContourCount: 24,
      engravingIndexInterval: 6,
      showEngravingBorder: false,
      waterFillPattern: "ripples",
    });
    expect(() => parseProject({ ...DEFAULT_PROJECT, outputMode: "print" })).toThrow(/output mode/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, engravingContourCount: 41 })).toThrow(/contour count/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, engravingIndexInterval: 1 })).toThrow(/index interval/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, waterFillPattern: "checkerboard" })).toThrow(/water fill pattern/i);
    const { waterFillPattern: _legacyWaterFillPattern, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).waterFillPattern).toBe("none");
  });
  it("validates, restores, and defaults shared linework settings", () => {
    const lineStyle = { ...DEFAULT_PROJECT.lineStyle, contourMm: 0.14, majorRoadMm: 0.5, trailPattern: "dotted" as const };
    expect(parseProject({ ...DEFAULT_PROJECT, lineStyle }).lineStyle).toEqual(lineStyle);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...lineStyle, waterMm: 2 } })).toThrow(/line widths/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...lineStyle, trailPattern: "zigzag" } })).toThrow(/trail pattern/i);
    const { lineStyle: _legacyLineStyle, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).lineStyle).toEqual(DEFAULT_PROJECT.lineStyle);
    const { boundaryMm: _legacyBoundaryWidth, coordinateGridMm: _legacyCoordinateGridWidth, ...legacyStyle } = DEFAULT_PROJECT.lineStyle;
    expect(parseProject({ ...DEFAULT_PROJECT, lineStyle: legacyStyle }).lineStyle).toMatchObject({
      boundaryMm: DEFAULT_PROJECT.lineStyle.boundaryMm,
      coordinateGridMm: DEFAULT_PROJECT.lineStyle.coordinateGridMm,
    });
    const { roadStyle: _legacyRoadStyle, majorRoadSpacingMm: _legacyRoadSpacing, roadCap: _legacyRoadCap, ...legacyRoadStyle } = DEFAULT_PROJECT.lineStyle;
    expect(parseProject({ ...DEFAULT_PROJECT, lineStyle: legacyRoadStyle }).lineStyle).toMatchObject({
      roadStyle: "centerline",
      majorRoadSpacingMm: 0.8,
      roadCap: "round",
    });
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...lineStyle, majorRoadSpacingMm: 5 } })).toThrow(/road spacing/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...lineStyle, roadStyle: "bordered" } })).toThrow(/road style/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...lineStyle, roadCap: "butt" } })).toThrow(/road cap/i);
  });
  it("restores lake depth fitting and keeps older projects at manual depth", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, fitLakeDepth: true }).fitLakeDepth).toBe(true);
    expect(parseProject({ ...DEFAULT_PROJECT, fitLakeDepth: undefined }).fitLakeDepth).toBe(false);
    expect(() => parseProject({ ...DEFAULT_PROJECT, fitLakeDepth: "true" })).toThrow(/fitLakeDepth/i);
  });
  it("restores an explicit depth allowance and defaults older projects to automatic coverage", () => {
    expect(parseProject(DEFAULT_PROJECT).waterDepthLayerLimit).toBeUndefined();
    expect(parseProject({ ...DEFAULT_PROJECT, waterDepthLayerLimit: 40 }).waterDepthLayerLimit).toBe(40);
    for (const waterDepthLayerLimit of [0, -1, 1.5, Infinity, NaN, "6", null]) {
      expect(() => parseProject({ ...DEFAULT_PROJECT, waterDepthLayerLimit })).toThrow(/depth layers/i);
    }
  });
  it("rejects non-finite and out-of-range values", () => {
    expect(() => parseProject({ ...DEFAULT_PROJECT, widthMm: "not-a-number" })).toThrow(/finite/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, lat: 90 } })).toThrow(/Mercator/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, elevationLabelPosition: { x: 1, y: 0 } })).toThrow(/label position/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showAlignmentGuides: "yes" })).toThrow(/showAlignmentGuides/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, optimizeMaterialUse: "yes" })).toThrow(/optimizeMaterialUse/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, glueMarginMm: 30 })).toThrow(/glue margin/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, laserKerfMm: 1.1 })).toThrow(/laser kerf/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, units: "yards" })).toThrow(/units/i);
  });
  it("adds new fabrication defaults to projects saved before those fields existed", () => {
    const {
      elevationLabelPosition: _legacyLabelPosition,
      showAlignmentGuides: _legacyAlignmentGuides,
      optimizeMaterialUse: _legacyOptimizeMaterialUse,
      glueMarginMm: _legacyGlueMarginMm,
      laserKerfMm: _legacyLaserKerfMm,
      units: _legacyUnits,
      textStyle: _legacyTextStyle,
      northArrowStyle: _legacyNorthArrowStyle,
      northArrowSizeMm: _legacyNorthArrowSize,
      northArrowPlacement: _legacyNorthArrowPlacement,
      showTrails: _legacyTrails,
      showTransportationLabels: _legacyTransportationLabels,
      showBoundaries: _legacyBoundaries,
      showCoordinateGrid: _legacyCoordinateGrid,
      ...legacyProject
    } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({
      elevationLabelPosition: DEFAULT_PROJECT.elevationLabelPosition,
      showAlignmentGuides: true,
      optimizeMaterialUse: true,
      glueMarginMm: 8,
      laserKerfMm: 0.15,
      units: "metric",
      textStyle: DEFAULT_PROJECT.textStyle,
      northArrowStyle: "classic",
      northArrowSizeMm: 24,
      northArrowPlacement: { anchor: "bottom-right", offset: { x: 0, y: 0 } },
      showTrails: DEFAULT_PROJECT.showRoads,
      showTransportationLabels: false,
      showBoundaries: false,
      showCoordinateGrid: false,
    });
  });
  it("loads former terrain exaggerations at the new maximum without losing other settings", () => {
    const original = { ...DEFAULT_PROJECT, name: "Saved terrain", waterDepthExaggeration: 1.05, waterDepthLayerLimit: 40 };
    for (const verticalExaggeration of [10.1, 12.5, 20]) {
      expect(parseProject({ ...original, verticalExaggeration })).toMatchObject({ ...original, verticalExaggeration: 10 });
    }
    expect(parseProject({ ...original, verticalExaggeration: 1.1 }).verticalExaggeration).toBe(1.1);
    expect(() => parseProject({ ...original, verticalExaggeration: 21 })).toThrow(/vertical exaggeration/i);
  });
  it("opens a project saved before machine work areas existed, cut in one piece", () => {
    const { workAreaWidthMm: _width, workAreaHeightMm: _height, showAssemblyLabels: _labels, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({ workAreaWidthMm: 0, workAreaHeightMm: 0, showAssemblyLabels: true });
  });
  it("restores a machine work area and rejects one too small to use", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, workAreaWidthMm: 300, workAreaHeightMm: 200 }))
      .toMatchObject({ workAreaWidthMm: 300, workAreaHeightMm: 200 });
    expect(() => parseProject({ ...DEFAULT_PROJECT, workAreaWidthMm: 5 })).toThrow(/0 \(unlimited\)/);
    expect(() => parseProject({ ...DEFAULT_PROJECT, workAreaHeightMm: -1 })).toThrow(/zero or a positive/);
  });
  it("loads a project saved with an explicit layer count at the derived default", () => {
    // Layer count used to be a stored setting; it is now derived from map
    // scale, so an old save keeps everything else and adopts the default
    // exaggeration rather than failing to load.
    const { verticalExaggeration: _derivedNow, ...saved } = DEFAULT_PROJECT;
    const legacyProject = { ...saved, layerCount: 18 };
    const parsed = parseProject(legacyProject);
    expect(parsed.verticalExaggeration).toBe(DEFAULT_PROJECT.verticalExaggeration);
    expect(parsed).not.toHaveProperty("layerCount");
    expect(parsed.widthMm).toBe(DEFAULT_PROJECT.widthMm);
  });
  it("validates and restores transportation, boundary, and coordinate grid controls", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, showRoads: false, showTrails: true, showTransportationLabels: true, showBoundaries: true, showCoordinateGrid: true })).toMatchObject({ showRoads: false, showTrails: true, showTransportationLabels: true, showBoundaries: true, showCoordinateGrid: true });
    expect(() => parseProject({ ...DEFAULT_PROJECT, showTrails: "yes" })).toThrow(/showTrails/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showTransportationLabels: "yes" })).toThrow(/showTransportationLabels/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showBoundaries: "yes" })).toThrow(/showBoundaries/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, showCoordinateGrid: "yes" })).toThrow(/showCoordinateGrid/i);
  });
  it("restores paint templates, defaulting a saved project without them to none", () => {
    const { paintTemplates: _paint, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject).paintTemplates).toEqual([]);
    const templates: ProjectConfigV1["paintTemplates"] = ["water"];
    const parsed = parseProject({ ...DEFAULT_PROJECT, paintTemplates: templates });
    expect(parsed.paintTemplates).toEqual(["water"]);
    expect(parsed.paintTemplates).not.toBe(templates);
    expect(() => parseProject({ ...DEFAULT_PROJECT, paintTemplates: ["lava"] })).toThrow(/paint templates/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, paintTemplates: ["water", "water"] })).toThrow(/paint templates/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, paintTemplates: "water" })).toThrow(/paint templates/i);
  });
  it("restores sheet nesting settings only when a project has them", () => {
    expect("sheetNesting" in parseProject(DEFAULT_PROJECT)).toBe(false);
    const sheetNesting = { sheetWidthMm: 600, sheetHeightMm: 400, marginMm: 3, spacingMm: 2, rotation: "free" as const, timeBudgetS: 30, seed: 4 };
    expect(parseProject({ ...DEFAULT_PROJECT, sheetNesting }).sheetNesting).toEqual(sheetNesting);
    expect(() => parseProject({ ...DEFAULT_PROJECT, sheetNesting: { ...sheetNesting, rotation: "diagonal" } })).toThrow(/rotation/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, sheetNesting: { ...sheetNesting, spacingMm: "2" } })).toThrow(/numbers/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, sheetNesting: "wide" })).toThrow(/sheet nesting/i);
  });
  it("validates and restores fabrication typography", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, textStyle: { font: "stencil", sizeMm: 5 } }).textStyle).toEqual({ font: "stencil", sizeMm: 5 });
    expect(parseProject({ ...DEFAULT_PROJECT, textStyle: { font: "relief", sizeMm: 5 } }).textStyle).toEqual({ font: "relief", sizeMm: 5 });
    expect(() => parseProject({ ...DEFAULT_PROJECT, textStyle: { font: "serif", sizeMm: 5 } })).toThrow(/text font/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, textStyle: { font: "technical", sizeMm: 1 } })).toThrow(/text size/i);
  });
  it("validates and restores north-arrow customization", () => {
    const project = parseProject({ ...DEFAULT_PROJECT, northArrowStyle: "mariner", northArrowSizeMm: 32, northArrowPlacement: { anchor: "top-left", offset: { x: 0.2, y: -0.3 } } });
    expect(project).toMatchObject({ northArrowStyle: "mariner", northArrowSizeMm: 32, northArrowPlacement: { anchor: "top-left", offset: { x: 0.2, y: -0.3 } } });
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowStyle: "ornate" })).toThrow(/north arrow style/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowSizeMm: 4 })).toThrow(/north arrow size/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowPlacement: { anchor: "outside", offset: { x: 0, y: 0 } } })).toThrow(/north arrow anchor/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, northArrowPlacement: { anchor: "center", offset: { x: 1.1, y: 0 } } })).toThrow(/north arrow offsets/i);
  });
  it("restores a title plaque and leaves projects without one untouched", () => {
    const plaque = { enabled: false, text: "Mount Rainier\n2026", sizeMm: 8, placement: { anchor: "top" as const, offset: { x: 0.1, y: 0 } } };
    expect(parseProject({ ...DEFAULT_PROJECT, plaque }).plaque).toEqual(plaque);
    expect("plaque" in parseProject(DEFAULT_PROJECT)).toBe(false);
    expect(() => parseProject({ ...DEFAULT_PROJECT, plaque: { ...plaque, text: 5 } })).toThrow(/title text/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, plaque: { ...plaque, placement: { anchor: "outside", offset: { x: 0, y: 0 } } } })).toThrow(/title anchor/i);
    expect(() => parseProject({ ...DEFAULT_PROJECT, plaque: { ...plaque, sizeMm: 50 } })).toThrow(/title size/i);
    // A title font is kept; without one the title follows the label font and stays keyless.
    expect(parseProject({ ...DEFAULT_PROJECT, plaque: { ...plaque, font: "lora" } }).plaque).toEqual({ ...plaque, font: "lora" });
    expect("font" in parseProject({ ...DEFAULT_PROJECT, plaque }).plaque!).toBe(false);
    expect(() => parseProject({ ...DEFAULT_PROJECT, plaque: { ...plaque, font: "comic" } })).toThrow(/text font/i);
  });
  it("defaults smoothing, minimum feature, and exploded preview for legacy projects", () => {
    const {
      smoothing: _legacySmoothing,
      minimumFeatureMm: _legacyMinimumFeature,
      explodedPreview: _legacyExplodedPreview,
      ...legacyProject
    } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({
      smoothing: DEFAULT_PROJECT.smoothing,
      minimumFeatureMm: DEFAULT_PROJECT.minimumFeatureMm,
      explodedPreview: DEFAULT_PROJECT.explodedPreview,
    });
  });

  it("loads projects saved before water depth existed", () => {
    const { showWaterDepth: _legacyShowWaterDepth, waterDepthOverrides: _legacyOverrides, waterDepthExaggeration: _legacyExaggeration, ...legacyProject } = DEFAULT_PROJECT;
    expect(parseProject(legacyProject)).toMatchObject({
      showWaterDepth: DEFAULT_PROJECT.showWaterDepth,
      waterDepthOverrides: {},
      waterDepthExaggeration: DEFAULT_PROJECT.waterDepthExaggeration,
    });
  });

  it("keeps usable depth chart references and drops the rest", () => {
    const reference = { id: "round-lake-chart", contentHash: "a".repeat(64) };
    const parsed = parseProject({ ...DEFAULT_PROJECT, userDepthCharts: {
      "9092": reference,
      "1": { id: "Round Lake", contentHash: "a".repeat(64) },
      "2": { id: "round-lake-chart", contentHash: "short" },
      "3": "round-lake-chart",
      lake: reference,
      "outline:round-lake-chart": reference,
      "outline:someone-elses-chart": reference,
    } });
    expect(parsed.userDepthCharts).toEqual({ "9092": reference, "outline:round-lake-chart": reference });
    // Absent stays absent, so projects saved before charts keep their fingerprint.
    expect("userDepthCharts" in parseProject({ ...DEFAULT_PROJECT })).toBe(false);
    expect("userDepthCharts" in parseProject({ ...DEFAULT_PROJECT, userDepthCharts: { "1": { id: "bad", contentHash: "" } } })).toBe(false);
  });

  it("drops depth overrides that are not usable depths", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, waterDepthOverrides: { "9092": 594, "1": -5, "2": "deep", "3": 99999, lake: 20 } })).toMatchObject({
      waterDepthOverrides: { "9092": 594 },
    });
  });
  it("restores custom graphics and their placements, dropping what is malformed", () => {
    const graphic = { id: "graphic-0001", name: "Logo", shapes: [{ outer: [-500, -500, 500, -500, 0, 500] }] };
    const placed = { id: "placed-0001", graphicId: graphic.id, placement: { anchor: "top-left" as const, offset: { x: 0.25, y: 0 } }, sizeMm: 30, rotationDeg: 45, operation: "cut" as const };
    const project = parseProject({ ...DEFAULT_PROJECT, customGraphics: [graphic], placedGraphics: [placed] });
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toMatchObject({ customGraphics: [graphic], placedGraphics: [placed] });
    expect(parseProject(DEFAULT_PROJECT)).not.toHaveProperty("customGraphics");
    expect(parseProject(DEFAULT_PROJECT)).not.toHaveProperty("placedGraphics");
    // A broken graphic takes its placements with it.
    const orphaned = parseProject({ ...DEFAULT_PROJECT, customGraphics: [{ ...graphic, shapes: [] }], placedGraphics: [placed] });
    expect(orphaned).not.toHaveProperty("customGraphics");
    expect(orphaned).not.toHaveProperty("placedGraphics");
    for (const broken of [{ ...placed, graphicId: "graphic-9999" }, { ...placed, sizeMm: 1 }, { ...placed, placement: { anchor: "middle", offset: { x: 0, y: 0 } } }, { ...placed, placement: { anchor: "top", offset: { x: 3, y: 0 } } }, { ...placed, id: "X" }]) {
      expect(parseProject({ ...DEFAULT_PROJECT, customGraphics: [graphic], placedGraphics: [broken] })).not.toHaveProperty("placedGraphics");
    }
    // Rotation wraps into range and an unknown operation engraves.
    expect(parseProject({ ...DEFAULT_PROJECT, customGraphics: [graphic], placedGraphics: [{ ...placed, rotationDeg: -90, operation: "etch" }] }).placedGraphics?.[0]).toMatchObject({ rotationDeg: 270, operation: "engrave" });
    expect(parseProject({ ...DEFAULT_PROJECT, customGraphics: [{ ...graphic, name: "" }] }).customGraphics?.[0]!.name).toBe("Graphic");
  });
});

