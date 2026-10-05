import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, buildProjectPackage, exportBlockReason, generateGeometry, parseProject, projectFingerprint, sourceRequirements, type AviationDetailsV1, type MarkingFeature, type ProjectConfigV1 } from "../index.js";
import { masterToSvg } from "../export/svg.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { aviationFeatures, aviationStroke, runwayPaths, specialUseHatching } from "./aviation.js";
import { realSource } from "../test-support/sources.js";

const ALL: AviationDetailsV1 = { airspace: true, specialUse: true, runways: true, airports: true, navaids: true, obstacles: true, labels: true };
const quiet = { showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false, optimizeMaterialUse: false } satisfies Partial<ProjectConfigV1>;

/** A square ring that runs clockwise on the page (area on its right); `.reverse()` puts the area on the left, as the archive writes rings. */
const ring = (half: number) => [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }, { x: -half, y: -half }];

function aviationSource(project: ProjectConfigV1) {
  const source = realSource(project);
  const markings: MarkingFeature[] = [
    { id: "b", kind: "aviation", operation: "engrave", aviationClass: "class-b", points: ring(80) },
    { id: "d", kind: "aviation", operation: "engrave", aviationClass: "class-d", points: ring(40) },
    { id: "r-2601", kind: "aviation", operation: "engrave", aviationClass: "special-use", points: ring(60).reverse() },
    { id: "rwy", kind: "aviation", operation: "engrave", aviationClass: "runway", widthM: 45, points: [{ x: -20, y: 10 }, { x: 20, y: 10 }] },
    { id: "den", kind: "aviation", operation: "engrave", aviationClass: "airport", aviationSymbol: "airport-hard", aviationDetail: { towered: true, fuel: true, runways: [[{ x: 0, y: -1 }, { x: 0, y: 1 }]] }, label: "DEN", points: [{ x: 0, y: -20 }] },
    { id: "vor", kind: "aviation", operation: "engrave", aviationClass: "navaid", aviationSymbol: "vortac", label: "DVV", points: [{ x: -30, y: 30 }] },
    { id: "farm", kind: "aviation", operation: "engrave", aviationClass: "airport", aviationSymbol: "airport-private", label: "CO12", points: [{ x: 50, y: -40 }] },
    { id: "mast", kind: "aviation", operation: "engrave", aviationClass: "obstacle", aviationSymbol: "obstacle", points: [{ x: 30, y: 30 }] },
  ];
  return { ...source, aviationMarkings: markings, aviationStatus: "available" as const, aviationCycle: "2026-09-03" };
}

describe("aviation styling", () => {
  it("tells classes apart by weight and dash in one colour", () => {
    const style = { aviationMm: 0.2 };
    expect(aviationStroke("class-b", style).widthMm).toBeCloseTo(0.3);
    expect(aviationStroke("class-c", style)).toEqual({ widthMm: 0.2 });
    expect(aviationStroke("class-d", style).dash).toHaveLength(2);
    expect(aviationStroke("special-use", style)).toEqual({ widthMm: 0.2 });
    expect(aviationStroke("class-c", {}).widthMm).toBe(0.24);
  });

  it("outlines a runway only when it is wide enough to read at this scale", () => {
    const centerline = [{ x: 0, y: 0 }, { x: 30, y: 0 }];
    const [outline] = runwayPaths(centerline, 60, 0.05, { aviationMm: 0.24 });
    expect(outline).toHaveLength(5);
    expect(outline![0]).toEqual(outline![4]);
    expect(Math.abs(outline![0]!.y - outline![3]!.y)).toBeCloseTo(3);
    expect(runwayPaths(centerline, 60, 0.005, { aviationMm: 0.24 })).toEqual([centerline]);
    expect(runwayPaths(centerline, undefined, 1, { aviationMm: 0.24 })).toEqual([centerline]);
  });

  it("hatches special use airspace on the inside of the boundary, as the sectional does", () => {
    const boundary = ring(10).reverse();
    const ticks = specialUseHatching(boundary, { aviationMm: 0.2 });
    // 80 mm of boundary at 0.6 mm spacing.
    expect(ticks.length).toBe(Math.floor((80 - 0.3) / 0.6) + 1);
    for (const [base, tip] of ticks) {
      expect(Math.max(Math.abs(base!.x), Math.abs(base!.y))).toBeCloseTo(10);
      expect(Math.hypot(tip!.x - base!.x, tip!.y - base!.y)).toBeCloseTo(1.1);
      expect(Math.max(Math.abs(tip!.x), Math.abs(tip!.y))).toBeLessThan(10);
    }
    // A piece clipped open by the crop keeps its side: the area stays on the left of travel.
    const [[, tip]] = specialUseHatching([{ x: 0, y: 0 }, { x: 10, y: 0 }], { aviationMm: 0.2 }) as [[unknown, { x: number; y: number }]];
    expect(tip.y).toBeLessThan(0);
  });

  it("builds symbols and labels only for enabled detail", () => {
    const project = { ...DEFAULT_PROJECT, aviation: { ...ALL, obstacles: false, labels: false } };
    const { lines, labels } = aviationFeatures(aviationSource(project).aviationMarkings, project, 0.01);
    expect(new Set(lines.map((line) => line.aviationClass))).toEqual(new Set(["class-b", "class-d", "special-use", "runway", "airport", "navaid"]));
    expect(labels).toEqual([]);
    const labelled = aviationFeatures(aviationSource(project).aviationMarkings, { ...project, aviation: ALL }, 0.01).labels;
    expect(labelled.map((label) => label.label)).toEqual(["DEN", "DVV"]);
  });

  it("leaves out optional symbols that would print over another, keeping the first listed", () => {
    const point = (id: string, aviationClass: MarkingFeature["aviationClass"], aviationSymbol: MarkingFeature["aviationSymbol"], x: number, y = 0): MarkingFeature =>
      ({ id, kind: "aviation", operation: "engrave", aviationClass, aviationSymbol, label: id, points: [{ x, y }] });
    const project = { ...DEFAULT_PROJECT, aviation: ALL };
    const drawn = (features: MarkingFeature[]) => new Set(aviationFeatures(features, project, 0.01).lines.map((line) => line.id.replace(/-\d+$/, "")));
    // Default 3.2 mm symbols: 1 mm apart overlap, 10 mm apart do not.
    expect(drawn([
      point("tower-tall", "obstacle", "obstacle-tall", 20), point("tower-short", "obstacle", "obstacle", 21), point("tower-far", "obstacle", "obstacle", 30),
      point("PVT", "airport", "airport-private", 0), point("PUB", "airport", "airport", 1), point("VOR", "navaid", "vor", 0.5),
      point("mast", "obstacle", "obstacle", 0.5, 2),
    ])).toEqual(new Set(["tower-tall", "tower-far", "PUB", "VOR"]));
    // Public fields and navaids are always drawn, even on top of each other.
    expect(drawn([point("A", "airport", "airport", 0), point("B", "airport", "airport-hard", 0.5), point("V", "navaid", "vortac", 0)])).toEqual(new Set(["A", "B", "V"]));
    const labels = aviationFeatures([point("PVT", "airport", "seaplane-base", 0), point("H1", "airport", "heliport", 0.5)], project, 0.01).labels;
    expect(labels.map((label) => label.label)).toEqual(["PVT"]);
  });
});

describe("aviation generation and export", () => {
  it("prints airspace altitudes inside their areas as the sectional does, once per area", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, outputMode: "engraving", aviation: ALL };
    const place = (id: string, aviationClass: MarkingFeature["aviationClass"], x: number, y: number, aviationAltitude: NonNullable<MarkingFeature["aviationAltitude"]>): MarkingFeature =>
      ({ id, kind: "aviation", operation: "engrave", aviationClass, aviationAltitude, points: [{ x, y }] });
    const roomy = 100_000;
    const candidates = [
      place("b-1", "class-b", -60, 0, { area: "1", ceilingFt: 12_000, floorFt: 8_000, clearanceM: roomy }),
      place("b-2", "class-b", 60, 0, { area: "1", ceilingFt: 12_000, floorFt: 8_000, clearanceM: roomy / 2 }),
      place("c-core", "class-c", 0, 60, { area: "2", ceilingFt: 4_800, floorFt: 0, clearanceM: roomy }),
      place("c-under-b", "class-c", 0, -60, { area: "3", ceilingFt: 4_800, floorFt: 2_100, ceilingBelow: true, clearanceM: roomy }),
      place("d", "class-d", 100, 60, { area: "4", ceilingFt: 2_500, ceilingBelow: true, clearanceM: roomy }),
      // A sliver of an area too narrow for its label at this scale.
      place("thin", "class-b", -100, -60, { area: "5", ceilingFt: 10_000, floorFt: 7_000, clearanceM: 1 }),
    ];
    const labels = (aviation: AviationDetailsV1) => generateGeometry({ ...project, aviation }, { ...aviationSource(project), aviationMarkings: candidates }).layers[0]!.markings
      .filter((marking) => marking.id.startsWith("aviation-label-"));
    const printed = labels(ALL);
    const words = printed.filter((marking) => marking.label).map((marking) => marking.label);
    expect(words.sort()).toEqual(["-25", "120", "21", "48", "80", "SFC", "T"].sort());
    // Area 1 took its roomiest place, left of centre; ceiling above the bar, floor below.
    const ceiling = printed.find((marking) => marking.label === "120")!;
    const floor = printed.find((marking) => marking.label === "80")!;
    expect(ceiling.points[0]!.x).toBeLessThan(0);
    expect(ceiling.points[0]!.y).toBeLessThan(floor.points[0]!.y);
    expect(printed.filter((marking) => marking.id.endsWith("-bar"))).toHaveLength(3);
    // Class D: the ceiling in a dashed box of several open strokes.
    expect(printed.filter((marking) => marking.id.includes("-box-")).length).toBeGreaterThan(4);
    expect(labels({ ...ALL, labels: false })).toEqual([]);
    expect(labels({ ...ALL, airspace: false })).toEqual([]);
    // A stack routes them onto whichever sheets show at each place, like identifiers.
    const stack: ProjectConfigV1 = { ...project, outputMode: "stack" };
    const stacked = generateGeometry(stack, { ...aviationSource(stack), aviationMarkings: candidates }).layers.flatMap((layer) => layer.markings)
      .filter((marking) => marking.id.startsWith("aviation-label-"));
    expect(stacked.length).toBeGreaterThan(0);
  });

  it("places identifiers clear of unlabelled symbols too", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, outputMode: "engraving", aviation: ALL };
    const point = (id: string, aviationSymbol: MarkingFeature["aviationSymbol"], x: number): MarkingFeature =>
      ({ id, kind: "aviation", operation: "engrave", aviationClass: "airport", aviationSymbol, label: id, points: [{ x, y: 0 }] });
    // A private field (never labelled) just right of a public one pushes the public label to the left.
    const result = generateGeometry(project, { ...aviationSource(project), aviationMarkings: [point("PUB", "airport", 0), point("PVT", "airport-private", 4)] });
    const label = result.layers[0]!.markings.find((marking) => marking.id.startsWith("aviation-label-"));
    expect(label?.label).toBe("PUB");
    expect(label!.points[0]!.x).toBeLessThan(0);
  });

  it("engraves every class into its own flat SVG group with the not-for-navigation notice", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, outputMode: "engraving", aviation: ALL };
    const result = generateGeometry(project, aviationSource(project));
    const markings = result.layers[0]!.markings;
    for (const aviationClass of ["class-b", "class-d", "special-use", "runway", "airport", "navaid", "obstacle"]) {
      expect(markings.some((marking) => marking.aviationClass === aviationClass && marking.points.length > 1), aviationClass).toBe(true);
    }
    expect(markings.filter((marking) => marking.id.startsWith("aviation-label-")).map((marking) => marking.label)).toEqual(["DEN", "DVV"]);
    expect(result.aviationCycle).toBe("2026-09-03");
    const svg = engravingToSvg(result, project);
    expect(svg).toMatch(/ENGRAVE-airspace-d"[^>]*stroke-dasharray=/);
    expect(svg).not.toMatch(/ENGRAVE-special-use-airspace"[^>]*stroke-dasharray=/);
    expect(svg).toMatch(/ENGRAVE-airspace-b" stroke-width="0.36"/);
    expect(svg).toContain("ENGRAVE-aviation-symbols");
    expect(svg).toContain("ENGRAVE-aviation-labels");
  });

  it("routes aviation onto the exposed surface of every stack layer", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, aviation: { ...ALL, labels: false } };
    const result = generateGeometry(project, aviationSource(project));
    const layersWithAirspace = result.layers.filter((layer) => layer.markings.some((marking) => marking.aviationClass === "class-b"));
    expect(layersWithAirspace.length).toBeGreaterThan(1);
    expect(masterToSvg(result)).toContain("ENGRAVE-runways");
  });

  it("draws nothing for disabled detail even when the source holds it", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, outputMode: "engraving", aviation: { ...ALL, airspace: false, specialUse: false, runways: false, airports: false, navaids: false, obstacles: false } };
    const result = generateGeometry(project, aviationSource(project));
    expect(result.layers[0]!.markings.some((marking) => marking.aviationClass)).toBe(false);
    expect(sourceRequirements(project).aviation).toBe(false);
  });

  it("warns when symbols are too small for their stroke to stay open", () => {
    const codes = (lineStyle: Partial<ProjectConfigV1["lineStyle"]>, aviation = ALL) => {
      const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, outputMode: "engraving", aviation, lineStyle: { ...DEFAULT_PROJECT.lineStyle, ...lineStyle } };
      return generateGeometry(project, aviationSource(project)).warnings.map((warning) => warning.code);
    };
    expect(codes({})).not.toContain("AVIATION_SYMBOLS_FILLED");
    expect(codes({ aviationSymbolMm: 1.5, aviationMm: 0.1 })).not.toContain("AVIATION_SYMBOLS_FILLED");
    expect(codes({ aviationSymbolMm: 3.2, aviationMm: 0.5 })).toContain("AVIATION_SYMBOLS_FILLED");
    // Lines alone draw no symbols.
    expect(codes({ aviationSymbolMm: 3.2, aviationMm: 0.5 }, { ...ALL, airports: false, navaids: false, obstacles: false })).not.toContain("AVIATION_SYMBOLS_FILLED");
  });

  it("warns outside FAA coverage but still exports; missing data blocks export", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, outputMode: "engraving", aviation: ALL };
    const outside = generateGeometry(project, { ...aviationSource(project), aviationMarkings: [], aviationStatus: "not-covered" });
    expect(outside.warnings.map((warning) => warning.code)).toContain("AVIATION_NOT_COVERED");
    expect(exportBlockReason(outside, project)).toBeUndefined();
    const readme = buildProjectPackage(outside, project).files.find((file) => file.filename === "README.txt")!;
    return readme.blob.text().then((text) => {
      expect(text).toContain("NOT FOR NAVIGATION");
      expect(text).toContain("covers only the United States");
      const unavailable = generateGeometry(project, { ...aviationSource(project), aviationMarkings: [], aviationStatus: "unavailable" });
      expect(unavailable.warnings.map((warning) => warning.code)).toContain("AVIATION_DATA_UNAVAILABLE");
      expect(exportBlockReason(unavailable, project)).toMatch(/aviation data is unavailable/i);
      expect(exportBlockReason(generateGeometry(project, { ...aviationSource(project), aviationStatus: "partial" }), project)).toMatch(/feature limit/i);
    });
  });

  it("names the FAA cycle in the fabrication README and manifest", async () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, ...quiet, aviation: { ...ALL, labels: false } };
    const result = generateGeometry(project, aviationSource(project));
    const files = buildProjectPackage(result, project).files;
    const readme = await files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(readme).toContain("NASR cycle effective 2026-09-03");
    const manifest = JSON.parse(await files.find((file) => file.filename.endsWith("-project.json"))!.blob.text());
    expect(manifest.result).toMatchObject({ aviationStatus: "available", aviationCycle: "2026-09-03" });
  });
});

describe("aviation project settings", () => {
  it("leaves projects saved before aviation detail, and their fingerprints, unchanged", () => {
    const saved = JSON.parse(JSON.stringify(DEFAULT_PROJECT));
    const parsed = parseProject(saved);
    expect(parsed.aviation).toBeUndefined();
    expect(parsed.lineStyle.aviationMm).toBeUndefined();
    expect(projectFingerprint(parsed)).toBe(projectFingerprint(DEFAULT_PROJECT));
  });

  it("turns missing switches off and rejects invalid values", () => {
    expect(parseProject({ ...DEFAULT_PROJECT, aviation: { airspace: true } }).aviation).toEqual({ airspace: true, specialUse: false, runways: false, airports: false, navaids: false, obstacles: false, labels: false });
    expect(() => parseProject({ ...DEFAULT_PROJECT, aviation: { airspace: "yes" } })).toThrow(/aviation.airspace/);
    expect(() => parseProject({ ...DEFAULT_PROJECT, aviation: [] })).toThrow(/Aviation settings/);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, aviationSymbolMm: 20 } })).toThrow(/symbol size/);
    expect(parseProject({ ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, aviationMm: 0.3 } }).lineStyle.aviationMm).toBe(0.3);
  });
});
