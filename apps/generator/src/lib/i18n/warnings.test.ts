import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSyntheticSource, DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, exportBlockMessage, exportBlockReason, generateGeometry, registerAirspaceStage, type AirspaceVolumeV1, type GeometryIRV1, type GeometryWarning, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";
import { buildAirspaceStack } from "@topostack/core/airspace";
import { formatMessage } from "$lib/i18n/format";
import { en, type MessageKey } from "$lib/i18n/messages/en/index";
import { exportBlockText, warningText } from "$lib/i18n/warnings";

// The English catalog must say exactly what core says: agents, the API and
// many tests read core's `message`, and the studio shows `warningText`.

registerAirspaceStage(buildAirspaceStack);

const message = (key: string) => en[`warnings.${key}` as MessageKey];
const quiet: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false, showWaterDepth: false, showRoads: false, showTrails: false, showElevationLabels: false, showAlignmentGuides: false, showAssemblyLabels: false, showNorthArrow: false, showScaleBar: false };

function gridSource(project: ProjectConfigV1, size: number, elevationAt: (nx: number, ny: number) => number): SourceBundleV1 {
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) values[y * size + x] = elevationAt((x / (size - 1) - 0.5) * 2, (y / (size - 1) - 0.5) * 2);
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  return { ...createSyntheticSource(project, 2), sourceKind: "real", elevation: { width: size, height: size, values, min, max } };
}

const square = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
function volume(id: string, aviationClass: AirspaceVolumeV1["aviationClass"], ceilingFt: number, outer = square(20, -30, 80, 30)): AirspaceVolumeV1 {
  return { id, name: `${id.toUpperCase()} AIRSPACE`, aviationClass, polygons: [{ outer, holes: [] }], floor: { ref: "sfc", ft: 0 }, ceiling: { ref: "msl", ft: ceilingFt } } as AirspaceVolumeV1;
}

/** Generated warnings from real core runs, each mutating the inputs toward a different warning. */
function generatedWarnings(): GeometryWarning[] {
  const real = { ...createSyntheticSource(DEFAULT_PROJECT, 48), sourceKind: "real" as const };
  const aviation = { ...DEFAULT_PROJECT, aviation: { airspace: true, specialUse: true, runways: true, airports: true, navaids: true, obstacles: true, labels: false } };
  const lands: ProjectConfigV1 = { ...DEFAULT_PROJECT, paintTemplates: ["national-park"] };
  const flat = gridSource(quiet, 32, () => 1000);
  const hill = gridSource(quiet, 48, (nx, ny) => 1000 + Math.max(0, 600 - Math.hypot(nx * 150, ny * 150) * 20));
  const runs: GeometryIRV1[] = [
    generateGeometry(DEFAULT_PROJECT, { ...real, terrainSourceUnavailable: true, elevationRepairCount: 3, vectorStatus: "partial", lakeDataStatus: "unavailable", bathymetryStatus: "partial" }),
    generateGeometry(DEFAULT_PROJECT, { ...real, vectorStatus: "unavailable" }),
    ...(["partial", "unavailable", "not-covered"] as const).map((aviationStatus) => generateGeometry(aviation, { ...real, aviationStatus })),
    ...(["partial", "unavailable", "not-covered"] as const).map((landsStatus) => generateGeometry(lands, { ...real, landsStatus })),
    generateGeometry(lands, { ...real, landsStatus: "available", landsSources: ["openstreetmap"] }),
    generateGeometry(quiet, flat),
    generateGeometry({ ...quiet, outputMode: "engraving", showEngravingContours: true }, flat),
    generateGeometry({ ...quiet, airspaceStack: DEFAULT_AIRSPACE_STACK }, hill),
    generateGeometry({ ...quiet, airspaceStack: DEFAULT_AIRSPACE_STACK }, { ...hill, airspaceVolumes: [], airspaceStatus: "partial" }),
    generateGeometry({ ...quiet, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form: "plates" } }, { ...hill, airspaceVolumes: [volume("tower", "class-d", 3000), volume("moa", "special-use", 3000)] }),
    generateGeometry({ ...quiet, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form: "volumes", thicknessMm: 1, ceilingCapFt: 60_000 } }, { ...hill, airspaceVolumes: [volume("high", "class-b", 60_000)] }),
  ];
  return runs.flatMap((run) => run.warnings);
}

describe("generation warnings in English", () => {
  const warnings = generatedWarnings();

  it("reproduce core's message for every generated warning", () => {
    expect(warnings.length).toBeGreaterThan(15);
    const keys = new Set(warnings.map((warning) => warning.messageKey));
    for (const key of ["terrainSourceFallback", "elevationRepaired", "vectorDataPartial", "vectorDataUnavailable", "aviationDataPartial", "aviationDataUnavailable", "aviationNotCovered", "landsDataPartial", "landsDataUnavailable", "landsNotCovered", "landsFromOpenStreetMap", "lakeDataUnavailable", "lowReliefLayers", "lowReliefContours", "airspaceDataPartial", "airspaceEmpty", "airspaceEmptyClassesOff", "airspaceTooComplex"]) expect(keys).toContain(key);
    for (const warning of warnings) {
      expect(warning.messageKey, warning.message).toBeTruthy();
      expect(warningText(warning)).toBe(warning.message);
    }
  });

  it("keeps every static message word for word", () => {
    // Messages without values are compared with core's source directly.
    const core = new URL("../../../../../packages/core/src/", import.meta.url).pathname;
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [join(dir, entry.name)] : []);
    let compared = 0;
    for (const file of files(core)) {
      const text = readFileSync(file, "utf8");
      for (const [, english, key] of text.matchAll(/message: "([^"]*)",\s*messageKey: "(\w+)"/g)) { expect(message(key!), key).toBe(english); compared += 1; }
      for (const [, english, key] of text.matchAll(/block\("([^"]*)", "(\w+)"\)/g)) { expect(message(key!), key).toBe(english); compared += 1; }
    }
    expect(compared).toBeGreaterThan(30);
  });

  // Interpolated messages, with the values core passes and the English it writes for them.
  const cases: Array<[key: string, params: GeometryWarning["params"], english: string]> = [
    ["terrainCoarserZoom", { zoom: 13 }, "Higher-detail elevation tiles were empty. This map uses original elevation tiles at zoom 13."],
    ["airspacePieceUnsupported", { count: 1 }, "1 airspace piece was left out because no rod could hold it clear of the terrain and the pieces below. A thinner rod helps."],
    ["airspacePieceUnsupported", { count: 3 }, "3 airspace pieces were left out because no rod could hold them clear of the terrain and the pieces below. A thinner rod helps."],
    ["airspaceOverhang", { count: 1 }, "1 airspace sheet reaches past the rods that could stand under it. Reduce the model size or add supports under it before assembly."],
    ["airspaceOverhang", { count: 2 }, "2 airspace sheets reach past the rods that could stand under them. Reduce the model size or add supports under them before assembly."],
    ["airspaceLabelsOmitted", { count: 1 }, "1 airspace sector label did not fit beside the rods and other labels. Full names and charted limits remain in the export manifest."],
    ["airspaceLabelsOmitted", { count: 4 }, "4 airspace sector labels did not fit beside the rods and other labels. Full names and charted limits remain in the export manifest."],
    ["waterInsertOnBottom", { names: ["Jackson Lake"], more: 0, count: 1 }, "Jackson Lake stays wood: the waterline sits on the bottom sheet, so nothing would hold an acrylic insert."],
    ["waterInsertTooSmall", { names: ["A", "B"], more: 0, count: 2, minWidth: 3 }, "A, B stay wood: too small or narrow for an acrylic insert (under 3 mm across)."],
    ["waterInsertWholeSheet", { names: ["A", "B", "C"], more: 2, count: 5 }, "A, B, C and 2 more stay wood: the water covers its whole sheet, which would leave no wood to hold the acrylic."],
    ["waterInsertFailed", { names: ["A", "B", "C"], more: 0, count: 3 }, "A, B, C stay wood: the shoreline could not be cut cleanly."],
    ["waterInsertProud", { excess: 4 - 3, wood: 3 }, "The acrylic is 1.0 mm thicker than the wood, so the water will stand proud of its shore. Use acrylic no thicker than 3 mm for a flush surface."],
    ["waterInsertProud", { excess: 3.175 - 3, wood: 3 }, `The acrylic is ${(3.175 - 3).toFixed(1)} mm thicker than the wood, so the water will stand proud of its shore. Use acrylic no thicker than 3 mm for a flush surface.`],
    ["waterInsertOversize", { count: 1, ids: ["W1"] }, "Acrylic insert W1 is larger than the machine work area. Acrylic is never split, since a seam would show in the water; exclude the lake or use a larger machine."],
    ["waterInsertOversize", { count: 2, ids: ["W1", "W3"] }, "Acrylic inserts W1, W3 are larger than the machine work area. Acrylic is never split, since a seam would show in the water; exclude the lake or use a larger machine."],
    ["annotationOmitted", { item: "northArrow" }, "North arrow was omitted because it does not fit the material. Increase the output size or reduce the annotation size."],
    ["annotationOmitted", { item: "scaleBar" }, "Scale bar was omitted because it does not fit the material. Increase the output size or reduce the annotation size."],
    ["annotationOmitted", { item: "title" }, "Title was omitted because it does not fit the material. Increase the output size or reduce the annotation size."],
    ["elevationLabelsOmitted", { count: 1, layers: ["4"] }, "Elevation labels were omitted from layer 4 because no collision-free position fit the exposed face."],
    ["elevationLabelsOmitted", { count: 3, layers: ["2", "5", "9"] }, "Elevation labels were omitted from layers 2, 5, 9 because no collision-free position fit the exposed face."],
    ["graphicOmitted", { number: 2 }, "Graphic 2 was omitted because it does not fit the material. Make it smaller or move it inward."],
    ["airspaceEmptyClassesOff", { airspaceClasses: ["class-b", "class-d", "special-use"] }, "No airspace pieces were made over this map area. Class B and Class D and Special use airspace nearby is switched off: turn it on under Airspace in acrylic to build it."],
    ["airspaceTooComplex", { sheets: 5432, limit: 256 }, "Solid airspace would require 5432 acrylic sheets, exceeding the 256-sheet limit. Use plates or tiers, thicker acrylic, or a lower ceiling cap, then regenerate."],
    ["airspaceTall", { height: 1250 }, "The airspace stands 1250 mm tall. Lower the airspace ceiling cap or Vertical exaggeration for a model that is easier to build and display."],
    ["airspaceAcrylicHeavy", { footprints: 5 }, "Solid airspace takes acrylic covering the model 5.0 times over. Plates or tiers use far less."],
    ["airspaceAcrylicHeavy", { footprints: 4.26 }, "Solid airspace takes acrylic covering the model 4.3 times over. Plates or tiers use far less."],
    ["airspaceLevelsMerged", { count: 1, gap: 6 }, "1 airspace level was merged into the level below, because no rod fits between pieces closer than 6.0 mm. Raise Vertical exaggeration to separate them."],
    ["airspaceLevelsMerged", { count: 2, gap: 4.75 }, `2 airspace levels were merged into the level below, because no rod fits between pieces closer than ${(4.75).toFixed(1)} mm. Raise Vertical exaggeration to separate them.`],
    ["airspaceTerraced", { names: ["R-2508"], more: 0, count: 1 }, "R-2508 has a floor given above ground, built as steps over the terrain."],
    ["airspaceTerraced", { names: ["A MOA", "B MOA", "C MOA"], more: 1, count: 4 }, "A MOA, B MOA, C MOA and 1 more have a floor given above ground, built as steps over the terrain."],
    ["airspacePiecesDropped", { count: 1 }, "1 airspace piece was left out because it was smaller than 10 cm² after overlap partitioning, terrain and cropping cut it."],
    ["airspacePiecesDropped", { count: 7 }, "7 airspace pieces were left out because they were smaller than 10 cm² after overlap partitioning, terrain and cropping cut them."],
    ["workAreaUnsplit", { pieces: 1440, limit: 400 }, "This work area would cut the model into about 1440 pieces, more than the 400 this tool emits. Use a larger work area or a smaller model."],
    ["seamSlivers", { count: 1 }, "1 cut piece is narrower than the minimum feature size. Glue the offcut in place with its neighbour, or raise the work area so the seam misses it."],
    ["seamSlivers", { count: 3 }, "3 cut pieces are narrower than the minimum feature size. Glue the offcut in place with its neighbour, or raise the work area so the seam misses it."],
    ["seamTabsOmitted", { count: 1, layers: ["3"] }, "Alignment tabs could not be placed along some seams on layer 3; those pieces meet edge to edge. Glue them against a straight edge."],
    ["seamTabsOmitted", { count: 2, layers: ["3", "7"] }, "Alignment tabs could not be placed along some seams on layers 3, 7; those pieces meet edge to edge. Glue them against a straight edge."],
    ["workAreaOversize", { count: 1, pieces: ["L1-P2"], divisions: 12 }, "1 piece (L1-P2) remain larger than the work area. The seam grid stops at 12 divisions per axis; use a larger work area or a smaller model."],
    ["workAreaOversize", { count: 6, pieces: ["L1-P1", "L1-P2", "L2-P1", "L2-P2"], divisions: 12 }, "6 pieces (L1-P1, L1-P2, L2-P1, L2-P2) remain larger than the work area. The seam grid stops at 12 divisions per axis; use a larger work area or a smaller model."],
    ["assemblyIdsOmitted", { count: 1, pieces: ["L3-P1"] }, "Assembly ids were omitted from 1 piece (L3-P1) because no position stayed hidden under the layer above."],
    ["assemblyIdsOmitted", { count: 2, pieces: ["L3-P1", "L4-P2"] }, "Assembly ids were omitted from 2 pieces (L3-P1, L4-P2) because no position stayed hidden under the layer above."],
    ["waterDepthClamped", { count: 1 }, "Water here is deeper than the 1 sheet below the shoreline can hold, so its floor is flattened. Increase the depth-layer limit or turn it off for automatic coverage. Fit depth compresses lakes to the chosen allowance."],
    ["waterDepthClamped", { count: 4 }, "Water here is deeper than the 4 sheets below the shoreline can hold, so its floor is flattened. Increase the depth-layer limit or turn it off for automatic coverage. Fit depth compresses lakes to the chosen allowance."],
    ["capsOmitted", { count: 1, unit: "sheet" }, "1 upper sheet was omitted because the circular crop retained no material meeting the minimum feature size."],
    ["capsOmitted", { count: 2, unit: "contour" }, "2 upper contours were omitted because the circular crop retained no material meeting the minimum feature size."],
    ["emptyLayer", { layer: 7 }, "Layer 7 has no printable terrain at its elevation."],
    ["paintWindowsOmitted", { count: 1, layers: ["2"] }, "Some paint windows on layer 2 could not be cut, so those areas are left off the stencils. Paint them by hand, or nudge the design and generate again."],
    ["paintWindowsOmitted", { count: 2, layers: ["2", "4"] }, "Some paint windows on layers 2, 4 could not be cut, so those areas are left off the stencils. Paint them by hand, or nudge the design and generate again."],
    ["bathymetryGridMismatch", { lake: "Crater Lake", source: "survey" }, "Crater Lake has survey data that does not match the terrain grid, so its floor uses existing terrain or a modeled basin instead."],
    ["bathymetryGridMismatchUnnamed", { source: "chart" }, "A lake has depth chart data that does not match the terrain grid, so its floor uses existing terrain or a modeled basin instead."],
    ["bathymetryIncomplete", { lake: "Lake Tahoe", source: "chart" }, "Lake Tahoe has incomplete depth chart coverage. Uncovered cells use existing terrain, modeled depths, or estimates near surveyed shores; cells without enough information remain at the waterline."],
    ["bathymetryIncompleteUnnamed", { source: "survey" }, "A lake has incomplete survey coverage. Uncovered cells use existing terrain, modeled depths, or estimates near surveyed shores; cells without enough information remain at the waterline."],
    ["lakePastEdge", { lake: "Lake Mead" }, "Lake Mead extends past the edge of this map, so its depth could not be modeled. Zoom out to include its shoreline."],
    ["lakePastEdgeUnnamed", {}, "A lake extends past the edge of this map, so its depth could not be modeled. Zoom out to include its shoreline."],
    ["exportBlockNotReal", { files: "engraving" }, "Generate real terrain data before exporting engraving files."],
    ["exportBlockNotReal", { files: "fabrication" }, "Generate real terrain data before exporting fabrication files."],
    // Warnings the studio adds itself when loading terrain (App.svelte).
    ["mapServiceFallbackBecause", { reason: "Terrain service returned 503." }, "The map service was unavailable, so this preview uses deterministic sample terrain. (Terrain service returned 503.)"],
    ["waterOutlinesFailed", { reason: "Water outlines could not be assembled." }, "Water outlines could not be applied, so the terrain has no water adjustment. (Water outlines could not be assembled.)"],
    ["depthChartMissing", { lake: "Lake Tahoe" }, "The depth chart for Lake Tahoe is unavailable or has not completed contour review, so it is carved without it. Import a reviewed project file or recreate the chart from its source."],
  ];

  it.each(cases)("formats %s as core writes it", (key, params, english) => {
    expect(warningText({ message: "", messageKey: key, params })).toBe(english);
  });

  it("covers every interpolated message key", () => {
    const interpolated = Object.keys(en).filter((key) => key.startsWith("warnings.") && !key.startsWith("warnings.airspaceClass.") && en[key as MessageKey].includes("{")).map((key) => key.slice("warnings.".length));
    expect(interpolated.filter((key) => !cases.some(([covered]) => covered === key))).toEqual([]);
  });

  it("formats the catalog directly the same way, for keys without translated params", () => {
    for (const [key, params, english] of cases) if (!params?.airspaceClasses) expect(formatMessage(message(key), params)).toBe(english);
  });

  it("falls back to core's English for warnings saved before keys existed", () => {
    expect(warningText({ message: "Old warning." })).toBe("Old warning.");
    expect(warningText({ message: "Old warning.", messageKey: "noSuchKey" })).toBe("Old warning.");
  });
});

describe("export blocks in English", () => {
  const real = { ...createSyntheticSource(DEFAULT_PROJECT, 48), sourceKind: "real" as const };
  const ir = generateGeometry(DEFAULT_PROJECT, real);
  const aviation = { ...DEFAULT_PROJECT, aviation: { airspace: true, specialUse: true, runways: true, airports: true, navaids: true, obstacles: true, labels: false } };
  const lands: ProjectConfigV1 = { ...DEFAULT_PROJECT, paintTemplates: ["national-park"] };
  const airspace = { ...quiet, airspaceStack: DEFAULT_AIRSPACE_STACK };
  const scenarios: Array<[GeometryIRV1, ProjectConfigV1]> = [
    [{ ...ir, sourceKind: "synthetic" }, DEFAULT_PROJECT],
    [{ ...ir, sourceKind: "synthetic" }, { ...DEFAULT_PROJECT, outputMode: "engraving" }],
    [ir, { ...DEFAULT_PROJECT, materialThicknessMm: 6 }],
    [generateGeometry(DEFAULT_PROJECT, { ...real, vectorStatus: "partial" }), DEFAULT_PROJECT],
    [generateGeometry(DEFAULT_PROJECT, { ...real, vectorStatus: "unavailable" }), DEFAULT_PROJECT],
    [generateGeometry(aviation, { ...real, aviationStatus: "partial" }), aviation],
    [generateGeometry(aviation, { ...real, aviationStatus: "unavailable" }), aviation],
    [generateGeometry(lands, { ...real, landsStatus: "partial" }), lands],
    [generateGeometry(lands, { ...real, landsStatus: "unavailable" }), lands],
    [generateGeometry(airspace, { ...real, airspaceVolumes: [], airspaceStatus: "partial" }), airspace],
    [generateGeometry(airspace, real), airspace],
    [generateGeometry(DEFAULT_PROJECT, { ...real, lakeDataStatus: "unavailable" }), DEFAULT_PROJECT],
  ];

  it("keeps exportBlockReason as the English of exportBlockMessage, and translates by key", () => {
    const keys = new Set<string>();
    for (const [geometry, project] of scenarios) {
      const block = exportBlockMessage(geometry, project);
      expect(block, JSON.stringify(project.outputMode)).toBeDefined();
      expect(block!.message).toBe(exportBlockReason(geometry, project));
      expect(exportBlockText(block!)).toBe(block!.message);
      keys.add(block!.messageKey!);
    }
    expect(keys.size).toBeGreaterThanOrEqual(11);
    expect(exportBlockText(exportBlockMessage(ir, DEFAULT_PROJECT))).toBeUndefined();
  });

  it("names the failing airspace warning as the block", () => {
    const built = generateGeometry(airspace, { ...real, airspaceVolumes: [], airspaceStatus: "available" });
    const failed = { ...built, warnings: [{ code: "AIRSPACE_PIECES_OVERLAP" as const, message: "overlap", messageKey: "airspacePiecesOverlap" }] };
    expect(exportBlockMessage(failed, airspace)).toEqual({ message: "overlap", messageKey: "airspacePiecesOverlap" });
  });
});
