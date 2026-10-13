import { describe, expect, it } from "vitest";
import { buildFabricationPackage, buildProjectPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, LAND_CLASSES, parseProject, type LandAreaV1, type Point2D, type ProjectConfigV1, type SourceBundleV1 } from "../index.js";
import { pointInPolygon } from "../primitives/geometry2d.js";
import { landFeatures, landStroke } from "./lands.js";
import { projectFingerprint } from "./fingerprint.js";
import { landClassesNeeded, sourceRequirements } from "./source-requirements.js";

const square = (minX: number, minY: number, maxX: number, maxY: number): Point2D[] => [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
const unit = (landClass: LandAreaV1["landClass"], ring: Point2D[], name?: string): LandAreaV1 => ({ unit: `${landClass}:${name ?? "x"}`, landClass, ...(name ? { name } : {}), polygons: [{ outer: ring, holes: [] }] });
const config = (lands: ProjectConfigV1["lands"], outputMode: ProjectConfigV1["outputMode"] = "stack"): ProjectConfigV1 => ({ ...DEFAULT_PROJECT, widthMm: 200, heightMm: 150, outputMode, lands });
const ALL: ProjectConfigV1["lands"] = { boundaries: [...LAND_CLASSES], hatched: false, labels: false };

describe("land strokes", () => {
  it("gives every class its own look, the national park the heaviest line", () => {
    const style = { boundaryMm: 0.3 };
    const looks = LAND_CLASSES.map((landClass) => JSON.stringify(landStroke(landClass, style)));
    expect(new Set(looks).size).toBe(LAND_CLASSES.length);
    expect(landStroke("national-park", style).widthMm).toBeGreaterThan(landStroke("blm", style).widthMm);
    expect(landStroke("national-park", style).dash).toBeUndefined();
    // Dashes never shrink below what a laser can draw, however thin the line.
    expect(Math.min(...landStroke("preserve", { boundaryMm: 0.05 }).dash!)).toBeGreaterThanOrEqual(0.2);
  });
});

describe("land features", () => {
  it("engraves a unit wholly inside the crop as its closed outline", () => {
    const { lines } = landFeatures([unit("national-park", square(-20, -20, 20, 20), "Test Park")], config(ALL));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "land", landClass: "national-park", operation: "engrave" });
    expect(lines[0]!.points).toHaveLength(5);
  });

  it("leaves out the edges the crop added, and classes not asked for", () => {
    // A forest reaching past the east edge: its outline was cut along x = 100.
    const forest = unit("national-forest", square(0, -30, 100, 30));
    const { lines } = landFeatures([forest, unit("blm", square(-90, -60, -50, -20))], config({ boundaries: ["national-forest"], hatched: false, labels: false }));
    expect(lines.every((line) => line.landClass === "national-forest")).toBe(true);
    expect(lines).toHaveLength(1);
    const points = lines[0]!.points;
    expect(points.some((point) => point.x === 0)).toBe(true);
    // No piece of the line runs along the crop edge.
    for (let index = 1; index < points.length; index += 1) expect(points[index - 1]!.x === 100 && points[index]!.x === 100).toBe(false);
    expect(landFeatures([forest], config({ boundaries: [], hatched: true, labels: true }))).toEqual({ lines: [], labels: [] });
  });

  it("hatches the inside of a boundary in a flat engraving only, whichever way its ring runs", () => {
    const area = unit("wilderness", [...square(-20, -20, 20, 20)].reverse());
    const flat = landFeatures([area], config({ boundaries: ["wilderness"], hatched: true, labels: false }, "engraving"));
    const ticks = flat.lines.filter((line) => line.points.length === 2);
    expect(ticks.length).toBeGreaterThan(20);
    for (const tick of ticks) expect(pointInPolygon(tick.points[1]!, area.polygons[0]!)).toBe(true);
    const stacked = landFeatures([area], config({ boundaries: ["wilderness"], hatched: true, labels: false }));
    expect(stacked.lines).toHaveLength(1);
  });

  it("offers the largest named units' roomiest points for names", () => {
    const areas = [unit("national-park", square(-80, -60, 0, 20), "Big Park"), unit("national-park", square(20, 20, 30, 30), "Small Park"), unit("blm", square(40, -60, 90, 0))];
    const { labels } = landFeatures(areas, config({ boundaries: ["national-park", "blm"], hatched: false, labels: true }));
    expect(labels.map((label) => label.label)).toEqual(["Big Park", "Small Park"]);
    expect(labels[0]!.clearanceMm).toBeGreaterThan(30);
    expect(pointInPolygon(labels[0]!.anchor, areas[0]!.polygons[0]!)).toBe(true);
  });
});

describe("land settings", () => {
  it("parses, defaults and validates the setting, and leaves older projects' fingerprints alone", () => {
    expect(parseProject({ ...DEFAULT_PROJECT }).lands).toBeUndefined();
    expect(projectFingerprint(parseProject({ ...DEFAULT_PROJECT }))).toBe(projectFingerprint(DEFAULT_PROJECT));
    expect(parseProject({ ...DEFAULT_PROJECT, lands: { boundaries: ["blm"] } }).lands).toEqual({ boundaries: ["blm"], hatched: false, labels: false });
    expect(() => parseProject({ ...DEFAULT_PROJECT, lands: { boundaries: ["blm", "blm"] } })).toThrow(/at most once/);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lands: { boundaries: ["city-park"] } })).toThrow(/at most once/);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lands: [] })).toThrow(/invalid/);
    expect(() => parseProject({ ...DEFAULT_PROJECT, lands: { boundaries: [], labels: "yes" } })).toThrow(/lands.labels/);
    expect(parseProject({ ...DEFAULT_PROJECT }).landExclusions).toBeUndefined();
    expect(parseProject({ ...DEFAULT_PROJECT, landExclusions: ["blm:UT"] }).landExclusions).toEqual(["blm:UT"]);
    for (const landExclusions of [["blm:UT", "blm:UT"], [""], "blm:UT", Array.from({ length: 201 }, (_, index) => `unit-${index}`)]) {
      expect(() => parseProject({ ...DEFAULT_PROJECT, landExclusions })).toThrow(/Left-out land units/);
    }
  });

  it("loads public land for engraved boundaries in either mode, and for paint only in a layered model", () => {
    const engraving: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving", paintTemplates: ["national-park"], lands: { boundaries: ["blm"], hatched: true, labels: false } };
    expect(sourceRequirements(engraving).lands).toBe(true);
    expect(landClassesNeeded(engraving)).toEqual(["blm"]);
    expect(landClassesNeeded({ ...engraving, outputMode: "stack" })).toEqual(["national-park", "blm"]);
    expect(sourceRequirements({ ...engraving, lands: undefined }).lands).toBe(false);
  });
});

describe("land boundaries in generated geometry", () => {
  const source = (project: ProjectConfigV1, landAreas: LandAreaV1[]): SourceBundleV1 => ({ ...createSyntheticSource(project, 24), sourceKind: "real", vectorStatus: "available", landAreas, landsStatus: "available", landsVersion: "4.1" });
  const park = unit("national-park", square(-60, -45, 30, 40), "Rocky Mountain National Park");

  it("routes boundaries over a layered model and writes each class in its own dash", async () => {
    const project = { ...config({ boundaries: ["national-park"], hatched: true, labels: true }), showWater: false, showWaterDepth: false };
    const ir = generateGeometry(project, source(project, [park]));
    const lines = ir.layers.flatMap((layer) => layer.markings.filter((marking) => marking.kind === "land"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.landClass === "national-park")).toBe(true);
    // Hatching is for flat engravings; a layered model gets the line alone.
    expect(lines.every((line) => line.points.length > 2 || line.points.every((point) => park.polygons[0]!.outer.some((corner) => corner.x === point.x || corner.y === point.y)))).toBe(true);
    // The name follows the surface, so it arrives as stroke pieces on the sheets it lies on.
    expect(ir.layers.some((layer) => layer.markings.some((marking) => marking.id.startsWith("land-label-")))).toBe(true);
    const output = buildFabricationPackage(ir, project);
    const panel = await output.files.find((file) => file.filename.endsWith(".svg") && !file.filename.includes("-paint-"))!.blob.text();
    expect(panel).toMatch(/-ENGRAVE-land-national-park" stroke-width="[\d.]+"/);
    const readme = await output.files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(readme).toContain("Public land boundaries: national park");
    expect(readme).toContain("PAD-US) 4.1");
  });

  it("leaves out the units a project turns off, from both its lines and its paint", () => {
    const forest = unit("national-forest", square(-100, -75, 100, 75), "Roosevelt National Forest");
    const project = { ...config({ boundaries: ["national-park", "national-forest"], hatched: false, labels: false }), paintTemplates: ["national-park", "national-forest"] as ProjectConfigV1["paintTemplates"], showWater: false, showWaterDepth: false };
    const all = generateGeometry(project, source(project, [park, forest]));
    const kinds = (ir: typeof all) => new Set([...ir.layers.flatMap((layer) => layer.markings.filter((marking) => marking.kind === "land").map((marking) => marking.landClass)), ...(ir.paintRegions ?? []).map((region) => region.kind)]);
    expect(kinds(all)).toEqual(new Set(["national-park", "national-forest"]));
    const withoutForest = generateGeometry({ ...project, landExclusions: [forest.unit] }, source(project, [park, forest]));
    expect(kinds(withoutForest)).toEqual(new Set(["national-park"]));
  });

  it("says when land comes from OpenStreetMap, in the warnings and the README", async () => {
    const project = { ...config({ boundaries: ["national-park"], hatched: false, labels: false }), showWater: false, showWaterDepth: false };
    const ir = generateGeometry(project, { ...source(project, [park]), landsSource: "openstreetmap", landsVersion: undefined });
    expect(ir.landsSource).toBe("openstreetmap");
    expect(ir.warnings.map((warning) => warning.code)).toContain("LANDS_FROM_OPENSTREETMAP");
    const readme = await buildFabricationPackage(ir, project).files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(readme).toContain("Source: OpenStreetMap protected areas");
    expect(generateGeometry(project, source(project, [park])).warnings.map((warning) => warning.code)).not.toContain("LANDS_FROM_OPENSTREETMAP");
  });

  it("hatches the inside in a flat engraving", async () => {
    const project = { ...config({ boundaries: ["national-park", "blm"], hatched: true, labels: false }, "engraving"), showWater: false };
    const ir = generateGeometry(project, source(project, [park]));
    const marks = ir.layers.flatMap((layer) => layer.markings.filter((marking) => marking.kind === "land"));
    expect(marks.filter((mark) => mark.points.length === 2).length).toBeGreaterThan(20);
    const output = buildProjectPackage(ir, project);
    const svg = await output.files.find((file) => file.filename.endsWith(".svg"))!.blob.text();
    expect(svg).toMatch(/"ENGRAVE-land-national-park" stroke-width="[\d.]+" stroke-linejoin/);
    expect(svg).not.toContain("land-blm");
  });
});
