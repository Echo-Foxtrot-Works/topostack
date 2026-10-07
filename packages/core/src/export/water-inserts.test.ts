import { describe, expect, it } from "vitest";
import { generateGeometry } from "../pipeline/generate.js";
import { ringBounds } from "../primitives/geometry2d.js";
import { bowlLake, lakeArea, parsePathPoints, scaledForLayers } from "../test-support/sources.js";
import { DEFAULT_PROJECT, type FabricationPackageV1, type MarkingFeature, type ProjectConfigV1 } from "../types.js";
import { buildFabricationPackage } from "./packages.js";
import { planSheets } from "./sheet-nest/plan-sheets.js";
import { rectangleEngine } from "./sheet-nest/rectangles.js";
import { nestableParts } from "./sheet-nest/parts.js";
import { acrylicGeometry, acrylicNestableParts, resolveAcrylicNestSettings } from "./water-inserts.js";
import { sheetNestJobKey } from "./sheet-nest/job-key.js";

const road: MarkingFeature = { id: "causeway", kind: "road", operation: "engrave", transportationClass: "local-road", points: [{ x: -90, y: 5 }, { x: 90, y: 5 }] };
const settings: ProjectConfigV1 = {
  ...DEFAULT_PROJECT, name: "Bowl", waterDepthLayerLimit: 6, showWater: true, showRoads: true, optimizeMaterialUse: false, laserKerfMm: 0.15,
  waterInserts: { kerfMm: 0.1, fitClearanceMm: 0.1, excludedLakeIds: [] },
};
const [config, scaled] = scaledForLayers(settings, bowlLake(settings), 8);
const source = { ...scaled, waterAreas: [lakeArea({ name: "Bowl", hylakId: 42, maxDepthM: 150, meanDepthM: 60 })], markings: [road] };
const ir = generateGeometry(config, source);

const text = (pkg: FabricationPackageV1, suffix: string) => pkg.files.find((file) => file.filename.endsWith(suffix))!.blob.text();

/** Bounding box of every point of the CUT paths in an SVG. */
function cutBounds(svg: string) {
  const cut = svg.slice(svg.indexOf('<g id="CUT"'));
  return ringBounds([...cut.matchAll(/ d="([^"]*)"/g)].flatMap((path) => parsePathPoints(path[1]!)));
}

describe("acrylic water insert export", { timeout: 30_000 }, () => {
  it("writes acrylic panels, engraving companions and a master beside the wood files", async () => {
    const pkg = buildFabricationPackage(ir, config);
    const names = pkg.files.map((file) => file.filename);
    const layerId = ir.layers[ir.waterInserts![0]!.layerIndex]!.id.replace("layer-", "");
    expect(names).toContain(`bowl-acrylic-${layerId}.svg`);
    expect(names).toContain(`bowl-acrylic-${layerId}-engrave.svg`);
    expect(names).toContain("bowl-acrylic-master.svg");
    expect(pkg.master.filename).toBe("bowl-master.svg");
    const panel = await text(pkg, `-acrylic-${layerId}.svg`);
    expect(panel).toContain('data-operation="CUT"');
    expect(panel).toContain("acrylic panel");
    // The causeway is engraved on the acrylic, inside its outline.
    const engrave = await text(pkg, `-acrylic-${layerId}-engrave.svg`);
    expect(engrave).toMatch(/causeway/);
    expect(engrave).not.toContain('data-operation="CUT"');
  });

  it("cuts the insert smaller than its opening by the fit clearance, each with its own kerf", async () => {
    const pkg = buildFabricationPackage(ir, config);
    const insert = ir.waterInserts![0]!;
    const nominal = ringBounds(insert.polygons[0]!.outer);
    const acrylic = cutBounds(await text(pkg, `-${acrylicGeometry(ir)!.layers[0]!.id}.svg`));
    // Outline: nominal less the clearance, plus half the acrylic kerf, on every side.
    expect(acrylic.maxX - acrylic.minX).toBeCloseTo(nominal.maxX - nominal.minX - 2 * 0.1 + 0.1, 1);
    // The wood opening is the nominal outline itself: a hole in the surface sheet, compensated inward by the wood kerf.
    const opening = ir.layers[insert.layerIndex]!.polygons.flatMap((polygon) => polygon.holes).map(ringBounds)
      .find((bounds) => Math.abs(bounds.maxX - bounds.minX - (nominal.maxX - nominal.minX)) < 0.05);
    expect(opening).toBeDefined();
  });

  it("records the acrylic in the manifest, README and assembly guide", async () => {
    const pkg = buildFabricationPackage(ir, config);
    const manifest = JSON.parse(await text(pkg, "-project.json"));
    const water = manifest.result.fabrication.waterInserts;
    expect(water).toMatchObject({ thicknessMm: 3, kerfMm: 0.1, fitClearanceMm: 0.1, ledgeMm: 2, master: "bowl-acrylic-master.svg" });
    expect(water.inserts).toEqual([expect.objectContaining({ id: "W1", lakeKey: "42", name: "Bowl" })]);
    expect(water.panels[0].insertIds).toEqual(["W1"]);
    const readme = await text(pkg, "README.txt");
    expect(readme).toContain("Acrylic water inserts: 1 piece (W1 Bowl)");
    expect(readme).toContain("not cyanoacrylate");
    const guide = await text(pkg, "-assembly-guide.html");
    expect(guide).toContain("<h3 style=\"margin-top:24px\">Acrylic</h3>");
    expect(guide).toContain("Acrylic inserts</dt><dd>1 × 3 mm");
    expect(guide).toContain("acrylic-safe glue");
    const surface = ir.waterInserts![0]!.layerIndex;
    const step = (index: number) => {
      const start = guide.indexOf(`id="step-${index + 1}"`);
      return guide.slice(start, guide.indexOf("</article>", start));
    };
    expect(step(surface)).toContain("Set in acrylic <strong>W1</strong> (Bowl)");
    expect(step(surface - 1)).toContain("Under the water.");
    expect(step(surface + 1)).not.toContain("acrylic <strong>W1");
  });

  it("leaves a project without inserts byte-identical", async () => {
    const off = { ...config, waterInserts: undefined };
    const plain = buildFabricationPackage(generateGeometry(off, source), off);
    expect(plain.files.some((file) => file.filename.includes("acrylic"))).toBe(false);
    const manifest = JSON.parse(await text(plain, "-project.json"));
    expect(manifest.result.fabrication.waterInserts).toBeUndefined();
    expect(await text(plain, "README.txt")).not.toContain("Acrylic");
    expect(await text(plain, "-assembly-guide.html")).not.toContain("acrylic");
  });

  it("nests the acrylic on its own stock sheets without engraved ids, and refuses a stale plan", async () => {
    const nesting = { ...config, waterInsertSheetNesting: { sheetWidthMm: 300, sheetHeightMm: 200, marginMm: 3, spacingMm: 2, rotation: "quarter" as const, timeBudgetS: 5, seed: 1 } };
    const resolved = resolveAcrylicNestSettings(nesting);
    if (!resolved.ok) throw new Error(resolved.error);
    const parts = acrylicNestableParts(ir);
    expect(parts.map((part) => part.label)).toEqual(["W1"]);
    // Wood and acrylic jobs never share a key, so a cached wood layout is never taken for acrylic.
    expect(sheetNestJobKey(parts, resolved.settings)).not.toBe(sheetNestJobKey(nestableParts(ir), resolved.settings));
    const plan = await planSheets(parts, resolved.settings, { engine: rectangleEngine });
    const pkg = buildFabricationPackage(ir, nesting, { acrylicSheetPlan: plan });
    expect(pkg.files.filter((file) => /-acrylic-sheet-\d{2}\.svg$/.test(file.filename))).toHaveLength(plan.sheets.length);
    const sheet = await text(pkg, "-acrylic-sheet-01.svg");
    expect(sheet).not.toContain('data-operation="ENGRAVE" fill="none" stroke="#00A651"');
    const manifest = JSON.parse(await text(pkg, "-project.json"));
    expect(manifest.result.fabrication.waterInserts.sheetNesting.sheetCount).toBe(plan.sheets.length);
    expect(await text(pkg, "-assembly-guide.html")).toContain('aria-label="Pieces on bowl-acrylic-sheet-01.svg"');

    const changed = { ...nesting, waterInserts: { ...nesting.waterInserts!, fitClearanceMm: 0.2 } };
    expect(() => buildFabricationPackage(generateGeometry(changed, source), changed, { acrylicSheetPlan: plan })).toThrow("acrylic sheet layout is out of date");
  });
});
