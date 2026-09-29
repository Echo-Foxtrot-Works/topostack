import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, buildProjectPackage, exportBlockReason, generateGeometry, parseProject, projectFingerprint, sourceRequirements, type AviationDetailsV1, type MarkingFeature, type ProjectConfigV1 } from "../index.js";
import { masterToSvg } from "../export/svg.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { aviationFeatures, aviationStroke, runwayPaths } from "./aviation.js";
import { realSource } from "../test-support/sources.js";

const ALL: AviationDetailsV1 = { airspace: true, specialUse: true, runways: true, airports: true, navaids: true, obstacles: true, labels: true };
const quiet = { showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false, optimizeMaterialUse: false } satisfies Partial<ProjectConfigV1>;

const ring = (half: number) => [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }, { x: -half, y: -half }];

function aviationSource(project: ProjectConfigV1) {
  const source = realSource(project);
  const markings: MarkingFeature[] = [
    { id: "b", kind: "aviation", operation: "engrave", aviationClass: "class-b", points: ring(80) },
    { id: "d", kind: "aviation", operation: "engrave", aviationClass: "class-d", points: ring(40) },
    { id: "r-2601", kind: "aviation", operation: "engrave", aviationClass: "special-use", points: ring(60) },
    { id: "rwy", kind: "aviation", operation: "engrave", aviationClass: "runway", widthM: 45, points: [{ x: -20, y: 10 }, { x: 20, y: 10 }] },
    { id: "den", kind: "aviation", operation: "engrave", aviationClass: "airport", aviationSymbol: "airport-towered", label: "DEN", points: [{ x: 0, y: -20 }] },
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
    expect(aviationStroke("special-use", style).dash).toHaveLength(4);
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

  it("builds symbols and labels only for enabled detail", () => {
    const project = { ...DEFAULT_PROJECT, aviation: { ...ALL, obstacles: false, labels: false } };
    const { lines, labels } = aviationFeatures(aviationSource(project).aviationMarkings, project, 0.01);
    expect(new Set(lines.map((line) => line.aviationClass))).toEqual(new Set(["class-b", "class-d", "special-use", "runway", "airport", "navaid"]));
    expect(labels).toEqual([]);
    const labelled = aviationFeatures(aviationSource(project).aviationMarkings, { ...project, aviation: ALL }, 0.01).labels;
    expect(labelled.map((label) => label.label)).toEqual(["DEN", "DVV"]);
  });
});

describe("aviation generation and export", () => {
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
    expect(svg).toMatch(/ENGRAVE-special-use-airspace"[^>]*stroke-dasharray=/);
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
