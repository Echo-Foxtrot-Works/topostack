import { describe, expect, it } from "vitest";
import { pointInPolygon, ringBounds } from "../primitives/geometry2d.js";
import { parsePathPoints } from "../test-support/sources.js";
import { build, cap, core, plain, project, shelf, square, stem, volume, SHELF, CEILING } from "../test-support/airspace.js";
import { DEFAULT_AIRSPACE_STACK } from "../pipeline/airspace-settings.js";
import type { FabricationPackageV1, GeometryIRV1, ProjectConfigV1 } from "../types.js";
import { buildFabricationPackage } from "./packages.js";
import { exportBlockReason } from "./export-policy.js";
import { airspaceGeometry, airspacePanels } from "./airspace.js";

const named = { name: "Cake", laserKerfMm: 0.15 };
const text = (pkg: FabricationPackageV1, suffix: string) => pkg.files.find((file) => file.filename.endsWith(suffix))!.blob.text();
const manifestOf = async (pkg: FabricationPackageV1) => JSON.parse(await text(pkg, "-project.json"));

/** The config a generated IR was made with, so the package's fingerprint check passes. */
function packaged(ir: GeometryIRV1, settings: Partial<ProjectConfigV1["airspaceStack"]> & object, extra: Partial<ProjectConfigV1> = {}): FabricationPackageV1 {
  const config: ProjectConfigV1 = { ...project, ...named, ...extra, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, ...settings } as ProjectConfigV1["airspaceStack"] };
  return buildFabricationPackage(ir, config);
}

function cutBounds(svg: string) {
  const cut = svg.slice(svg.indexOf('<g id="CUT"'));
  return ringBounds([...cut.matchAll(/ d="([^"]*)"/g)].flatMap((path) => parsePathPoints(path[1]!)));
}

describe("airspace export", { timeout: 60_000 }, () => {
  const tiers = build({ form: "tiers", kerfMm: 0.1 }, [core, shelf], named);
  const plates = build({ form: "plates", kerfMm: 0.1 }, [core, shelf], named);

  it("writes a panel per level and tint, engraving companions, a master per tint and the backing sheet", async () => {
    const pkg = packaged(tiers, { form: "tiers", kerfMm: 0.1 });
    const names = pkg.files.map((file) => file.filename);
    expect(names).toContain("cake-airspace-blue-01.svg");
    expect(names).toContain("cake-airspace-blue-01-engrave.svg");
    expect(names).toContain("cake-airspace-blue-02.svg");
    expect(names).toContain("cake-airspace-blue-master.svg");
    expect(names).toContain("cake-airspace-backing.svg");
    expect(pkg.master.filename).toBe("cake-master.svg");
    const panel = await text(pkg, "-airspace-blue-01.svg");
    expect(panel).toContain('data-operation="CUT"');
    expect(panel).toContain("airspace panel");
    const engrave = await text(pkg, "-airspace-blue-01-engrave.svg");
    expect(engrave).not.toContain('data-operation="CUT"');
    // Rod outlines are engraved where rods meet the pieces.
    expect(engrave).toMatch(/A1-\d+-rod-1/);
  });

  it("cuts each piece at its nominal size with the acrylic kerf", async () => {
    const pkg = packaged(tiers, { form: "tiers", kerfMm: 0.1 });
    const level = tiers.airspaceStack!.levels[1]!;
    const nominal = ringBounds(level.pieces.flatMap((piece) => piece.polygons.flatMap((polygon) => polygon.outer)));
    const cut = cutBounds(await text(pkg, "-airspace-blue-02.svg"));
    expect(cut.maxX - cut.minX).toBeCloseTo(nominal.maxX - nominal.minX + 0.1, 1);
  });

  it("frosts plate shelves as filled engraving and draws sector edges in their chart style", async () => {
    const engrave = await text(packaged(plates, { form: "plates", kerfMm: 0.1 }), "-airspace-clear-01-engrave.svg");
    expect(engrave).toMatch(/A1-1-frost-1[^>]*fill="#2366FF"/);
    expect(engrave).toContain("ENGRAVE-airspace-b");
  });

  it("keeps every rod outline readable: frost stops short of it", () => {
    const airspace = airspaceGeometry(plates)!;
    let checked = 0;
    for (const layer of airspace.layers) {
      const frost = layer.markings.filter((marking) => marking.filled).map((marking) => ({ outer: marking.points, holes: marking.holes ?? [] }));
      for (const locator of layer.markings.filter((marking) => marking.id.includes("-rod-"))) {
        for (const point of locator.points) expect(frost.some((polygon) => pointInPolygon(point, polygon))).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("records the airspace in the manifest and README", async () => {
    const pkg = packaged(tiers, { form: "tiers", kerfMm: 0.1 });
    const airspace = (await manifestOf(pkg)).result.fabrication.airspaceStack;
    expect(airspace).toMatchObject({ form: "tiers", thicknessMm: project.materialThicknessMm, kerfMm: 0.1, backingSheet: ["cake-airspace-backing.svg"], masters: ["cake-airspace-blue-master.svg"] });
    expect(airspace.levels.map((level: { altitudeFt: number }) => level.altitudeFt)).toEqual([SHELF, CEILING]);
    expect(airspace.cutList.reduce((sum: number, rod: { count: number }) => sum + rod.count, 0)).toBe(tiers.airspaceStack!.columns.reduce((sum, column) => sum + column.segments.length, 0));
    expect(airspace.panels[0]).toMatchObject({ filename: "cake-airspace-blue-01.svg", engravingFilename: "cake-airspace-blue-01-engrave.svg", tint: "blue", levelIndex: 0 });
    const readme = await text(pkg, "README.txt");
    expect(readme).toContain("Airspace in acrylic (tiers)");
    expect(readme).toContain("rod segment");
    expect(readme).toContain("cake-airspace-backing.svg");
    expect(readme).toContain("not for navigation");
  });

  it("adds the rods, the cut list, the levels and their maps to the assembly guide", async () => {
    const guide = await text(packaged(tiers, { form: "tiers", kerfMm: 0.1 }), "-assembly-guide.html");
    expect(guide).toContain("<dt>Airspace</dt>");
    expect(guide).toContain("Build the airspace");
    expect(guide).toContain("Rod cut list");
    expect(guide).toContain("round rod for");
    expect(guide).toContain("backing sheet");
    expect(guide).toMatch(/Level 1 at [\d,]+ ft/);
    expect(guide).toContain(">R1<");
  });

  it("cuts holes for through rods and gives the height to glue every piece at", async () => {
    const rod = { ...DEFAULT_AIRSPACE_STACK.rod, joint: "through" as const };
    const through = build({ form: "tiers", kerfMm: 0.1, rod }, [core, shelf], named);
    const passing = through.airspaceStack!.columns.find((column) => column.segments[0]!.throughPieceIds?.length)!;
    expect(passing).toBeDefined();
    const pkg = packaged(through, { form: "tiers", kerfMm: 0.1, rod });
    const guide = await text(pkg, "-assembly-guide.html");
    expect(guide).toContain("Rod heights");
    expect(guide).toContain(`<td>${passing.id}</td>`);
    expect(guide).toContain("(on top)");
    expect(guide).toContain("Slide each piece down its rods");
    expect(await text(pkg, "README.txt")).toContain("rising through holes in the pieces it carries");
    // The piece the rod passes has its hole in the CUT path: an extra subpath around the rod.
    const holed = through.airspaceStack!.levels.findIndex((level) => level.pieces.some((piece) => piece.id === passing.segments[0]!.throughPieceIds![0]));
    const panel = await text(pkg, `-airspace-blue-${String(holed + 1).padStart(2, "0")}.svg`);
    const cut = panel.slice(panel.indexOf('<g id="CUT"'));
    expect((cut.match(/M/g) ?? []).length).toBeGreaterThan(1);
  });

  it("tells the maker to stand rods under a volume sheet that reaches past the one below", async () => {
    const leaning = build({ form: "volumes" }, [stem, cap], named);
    const guide = await text(packaged(leaning, { form: "volumes" }), "-assembly-guide.html");
    expect(guide).toContain("rods stand under the part that reaches");
    expect(guide).toMatch(/\d+ × R\d+; glued on the level below/);
  });

  it("puts each piece on its own panel when a level outgrows the work area", () => {
    // A second shelf apart from the first, so the lowest level holds two pieces.
    const east = volume("east", "class-b", square(118, -60, 145, 60), { ref: "msl", ft: SHELF }, { ref: "msl", ft: CEILING });
    const withEast = build({ form: "tiers" }, [core, shelf, east], named);
    const airspace = airspaceGeometry(withEast)!;
    const level = airspace.layers.findIndex((layer) => new Set(layer.pieces.map((piece) => piece.id)).size > 1);
    expect(level).toBeGreaterThanOrEqual(0);
    const panels = airspacePanels(withEast, airspace, { workAreaWidthMm: 120, workAreaHeightMm: 120 }).filter((panel) => panel.rootLayerIndex === level);
    expect(panels.length).toBe(new Set(airspace.layers[level]!.pieces.map((piece) => piece.id)).size);
    expect(panels.every((panel) => panel.cellName)).toBe(true);
  });

  it("leaves a model without airspace exactly as it was", async () => {
    const pkg = buildFabricationPackage(plain, { ...project });
    expect(pkg.files.some((file) => file.filename.includes("airspace"))).toBe(false);
    expect(JSON.stringify((await manifestOf(pkg)).result)).not.toContain("airspace");
    expect(await text(pkg, "README.txt")).not.toContain("Airspace");
    expect(await text(pkg, "-assembly-guide.html")).not.toContain("airspace");
  });

  it("blocks export when airspace was asked for but never loaded", () => {
    const missing = build({ form: "plates" }, undefined, named);
    const config = { ...project, ...named, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form: "plates" as const } };
    expect(exportBlockReason(missing, config)).toContain("Airspace was not loaded");
    // An area with airspace data but no sectors in it exports without airspace files.
    const empty = build({ form: "plates" }, [volume("far", "class-b", square(400, 400, 420, 420), { ref: "msl", ft: SHELF }, { ref: "msl", ft: CEILING })], named);
    expect(exportBlockReason(empty, config)).toBeUndefined();
  });
});
