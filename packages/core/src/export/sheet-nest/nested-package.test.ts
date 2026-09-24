import { describe, expect, it } from "vitest";
import { generateGeometry } from "../../pipeline/generate.js";
import { parsePathPoints, pointInRing, realSource } from "../../test-support/sources.js";
import { DEFAULT_PROJECT, type GeometryIRV1, type ProjectConfigV1, type SheetNestPlanV1 } from "../../types.js";
import { buildFabricationPackage } from "../packages.js";
import { placementMatrix, suffixIds } from "./apply.js";
import { nestableParts, polygonLabel } from "./parts.js";
import { planSheets } from "./plan-sheets.js";
import { rectangleEngine } from "./rectangles.js";
import { resolveSheetNestSettings } from "./resolve.js";

const sheetNesting = { sheetWidthMm: 400, sheetHeightMm: 300, marginMm: 3, spacingMm: 2, rotation: "quarter" as const, timeBudgetS: 5, seed: 1 };

async function nestedProject(overrides: Partial<ProjectConfigV1> = {}): Promise<{ config: ProjectConfigV1; ir: GeometryIRV1; plan: SheetNestPlanV1 }> {
  const config: ProjectConfigV1 = { ...DEFAULT_PROJECT, workAreaWidthMm: 160, workAreaHeightMm: 120, sheetNesting, ...overrides };
  const ir = generateGeometry(config, realSource(config));
  const resolved = resolveSheetNestSettings(config);
  if (!resolved.ok) throw new Error(resolved.error);
  const plan = await planSheets(nestableParts(ir), resolved.settings, { engine: rectangleEngine });
  return { config, ir, plan };
}

const text = (pkg: ReturnType<typeof buildFabricationPackage>, suffix: string) => pkg.files.find((file) => file.filename.endsWith(suffix))!.blob.text();

/** Every CUT point of a sheet SVG in sheet coordinates, found by applying each part group's matrix. */
function sheetCutPoints(svg: string): Array<{ x: number; y: number; part: string }> {
  const cut = svg.slice(svg.indexOf('<g id="CUT"'));
  const groups = [...cut.matchAll(/<g id="part-(\d+)-CUT" data-part="([^"]*)"[^>]*transform="matrix\(([^)]*)\)">/g)];
  return groups.flatMap((group, index) => {
    const [a, b, c, d, e, f] = group[3]!.split(" ").map(Number) as [number, number, number, number, number, number];
    const body = cut.slice(group.index!, groups[index + 1]?.index ?? cut.length);
    return [...body.matchAll(/ d="([^"]*)"/g)].flatMap((path) => parsePathPoints(path[1]!).map(({ x, y }) => ({ x: a * x + c * y + e, y: b * x + d * y + f, part: group[2]! })));
  });
}

/** Each piece's outer cut line in sheet coordinates, keyed `<layer id>:<polygon index>`. */
function sheetCutRings(svg: string): Map<string, Array<{ x: number; y: number }>> {
  const cut = svg.slice(svg.indexOf('<g id="CUT"'));
  const groups = [...cut.matchAll(/<g id="part-(\d+)-CUT"[^>]*transform="matrix\(([^)]*)\)">/g)];
  const rings = new Map<string, Array<{ x: number; y: number }>>();
  groups.forEach((group, index) => {
    const [a, b, c, d, e, f] = group[2]!.split(" ").map(Number) as [number, number, number, number, number, number];
    const body = cut.slice(group.index!, groups[index + 1]?.index ?? cut.length);
    for (const path of body.matchAll(/ id="(layer-\d+)-cut-(\d+)-offset-1--p\d+" d="([^"]*)"/g)) {
      rings.set(`${path[1]}:${Number(path[2]) - 1}`, parsePathPoints(path[3]!).map(({ x, y }) => ({ x: a * x + c * y + e, y: b * x + d * y + f })));
    }
  });
  return rings;
}

// Each case generates and exports a whole model; coverage instrumentation makes that slow.
describe("nested fabrication package", { timeout: 30_000 }, () => {
  it("writes one fabrication, engraving and paint file per stock sheet, with a matching manifest", async () => {
    const { config, ir, plan } = await nestedProject({ paintTemplates: ["water"] });
    const pkg = buildFabricationPackage(ir, config, { sheetPlan: plan });
    const sheetFiles = pkg.files.filter((file) => /-sheet-\d{2}\.svg$/.test(file.filename));
    expect(sheetFiles).toHaveLength(plan.sheets.length);
    expect(pkg.files.filter((file) => /-sheet-\d{2}-engrave\.svg$/.test(file.filename))).toHaveLength(plan.sheets.length);
    expect(pkg.files.some((file) => /-panel-|layer-\d+\.svg$/.test(file.filename))).toBe(false);

    const manifest = JSON.parse(await text(pkg, "project.json"));
    expect(manifest.result.fabrication.panelCount).toBe(plan.sheets.length);
    expect(manifest.result.fabrication.sheetNesting).toMatchObject({ sheetCount: plan.sheets.length, engine: { name: "rectangles" }, settings: { sheetWidthMm: 400 } });
    const placed = manifest.result.fabrication.panels.flatMap((panel: { sheet: number; parts: Array<{ partId: string }> }) => panel.parts.map((part) => part.partId));
    expect(new Set(placed).size).toBe(nestableParts(ir).length);
    expect(manifest.result.fabrication.panels[0]).toMatchObject({ sheet: 1, widthMm: 400, heightMm: 300 });

    const readme = await text(pkg, "README.txt");
    expect(readme).toContain(`Stock sheets: ${plan.sheets.length}`);
    expect(readme).toContain("Sheet nesting laid the");
    expect(readme).toContain("Layouts were packed by bounding boxes.");
    const guide = await text(pkg, "assembly-guide.html");
    expect(guide).toContain('class="sheet-map"');
    expect(guide).toContain("each 400 mm × 300 mm");

    const sheet = await sheetFiles[0]!.blob.text();
    expect(sheet).toContain('viewBox="0 0 400 300"');
    const ids = [...sheet.matchAll(/ id="([^"]*)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await pkg.master.blob.text())).toContain('id="fabrication-sheet-01-CUT"');
  });

  it("keeps every cut line inside the sheet margin", async () => {
    for (const rotation of ["quarter", "free"] as const) {
      const { config, ir, plan } = await nestedProject({ sheetNesting: { ...sheetNesting, rotation } });
      const pkg = buildFabricationPackage(ir, config, { sheetPlan: plan });
      for (const file of pkg.files.filter((entry) => /-sheet-\d{2}\.svg$/.test(entry.filename))) {
        const points = sheetCutPoints(await file.blob.text());
        expect(points.length).toBeGreaterThan(0);
        for (const point of points) {
          // Path data is written to three decimals.
          expect(point.x).toBeGreaterThanOrEqual(3 - 0.02);
          expect(point.y).toBeGreaterThanOrEqual(3 - 0.02);
          expect(point.x).toBeLessThanOrEqual(397 + 0.02);
          expect(point.y).toBeLessThanOrEqual(297 + 0.02);
        }
      }
    }
  });

  it("engraves an id on pieces of unsplit layers where the layer above hides it", async () => {
    const { config, ir, plan } = await nestedProject({ workAreaWidthMm: 0, workAreaHeightMm: 0, sheetNesting: { ...sheetNesting, sheetWidthMm: 600, sheetHeightMm: 600 } });
    const pkg = buildFabricationPackage(ir, config, { sheetPlan: plan });
    const sheets = await Promise.all(pkg.files.filter((file) => /-sheet-\d{2}\.svg$/.test(file.filename)).map((file) => file.blob.text()));
    const assembly = sheets.join("").match(/id="piece-L\d{2}(-\d+)?-label/g) ?? [];
    expect(assembly.length).toBeGreaterThan(0);
    expect(sheets.join("")).toContain('id="ASSEMBLY"');
    const unlabelled = await nestedProject({ workAreaWidthMm: 0, workAreaHeightMm: 0, showAssemblyLabels: false, sheetNesting: { ...sheetNesting, sheetWidthMm: 600, sheetHeightMm: 600 } });
    const off = buildFabricationPackage(unlabelled.ir, unlabelled.config, { sheetPlan: unlabelled.plan });
    expect((await Promise.all(off.files.filter((file) => /-sheet-\d{2}\.svg$/.test(file.filename)).map((file) => file.blob.text()))).join("")).not.toContain("piece-L");
  });

  it("refuses a plan made for other parts or settings", async () => {
    const { config, ir, plan } = await nestedProject();
    expect(() => buildFabricationPackage(ir, { ...config, sheetNesting: { ...sheetNesting, spacingMm: 4 } }, { sheetPlan: plan })).toThrow(/out of date/);
    expect(() => buildFabricationPackage(ir, config, { sheetPlan: { ...plan, sheets: plan.sheets.slice(1) } })).toThrow(/not valid/);
    // The time budget is effort, not layout: changing it keeps the plan.
    expect(() => buildFabricationPackage(ir, { ...config, sheetNesting: { ...sheetNesting, timeBudgetS: 60 } }, { sheetPlan: plan })).not.toThrow();
  });

  it("maps every piece in the guide exactly where its sheet SVG cuts it", async () => {
    for (const overrides of [{}, { workAreaWidthMm: 0, workAreaHeightMm: 0, sheetNesting: { ...sheetNesting, sheetWidthMm: 600, sheetHeightMm: 600, rotation: "free" as const } }]) {
      const { config, ir, plan } = await nestedProject(overrides);
      const pkg = buildFabricationPackage(ir, config, { sheetPlan: plan });
      const guide = await text(pkg, "assembly-guide.html");
      const keyByLabel = new Map(ir.layers.flatMap((layer) => layer.polygons.map((_, index) => [polygonLabel(ir, layer.index, index), `${layer.id}:${index}`] as const)));
      const figures = [...guide.matchAll(/<figure class="sheet-map">([\s\S]*?)<\/figure>/g)].map((match) => match[1]!);
      expect(figures).toHaveLength(plan.sheets.length);
      let mapped = 0;
      for (const [index, figure] of figures.entries()) {
        const filename = figure.match(/<figcaption><code>([^<]+)<\/code>/)![1]!;
        expect(filename).toMatch(new RegExp(`-sheet-${String(index + 1).padStart(2, "0")}\\.svg$`));
        const cut = sheetCutRings(await pkg.files.find((file) => file.filename === filename)!.blob.text());
        const labels = [...figure.matchAll(/<text data-piece="([^"]+)" x="([-\d.]+)" y="([-\d.]+)"[^>]*>/g)].map((match) => ({ label: match[1]!, x: Number(match[2]), y: Number(match[3]) }));
        // Every piece cut from this sheet is named on its map, and nothing else is.
        expect(labels.map(({ label }) => keyByLabel.get(label)).sort()).toEqual([...cut.keys()].sort());
        for (const { label, x, y } of labels) expect(pointInRing({ x, y }, cut.get(keyByLabel.get(label)!)!)).toBe(true);
        mapped += labels.length;
      }
      expect(mapped).toBe(nestableParts(ir).reduce((total, part) => total + part.members.reduce((sum, member) => sum + member.polygonIndexes.length, 0), 0));
      // Each layer step says which of its pieces are on which sheet.
      expect(guide).toMatch(/-sheet-\d{2}\.svg<\/code> <span class="muted">\(L\d{2}/);
    }
  });

  it("tells the maker about the ids engraved on unsplit layers", async () => {
    const { config, ir, plan } = await nestedProject({ workAreaWidthMm: 0, workAreaHeightMm: 0, sheetNesting: { ...sheetNesting, sheetWidthMm: 600, sheetHeightMm: 600 } });
    const guide = await text(buildFabricationPackage(ir, config, { sheetPlan: plan }), "assembly-guide.html");
    expect(guide).toContain("every piece carries a green id like <code>L05</code>");
    expect(guide).not.toContain("Each layer is cut in");
  });

  it("writes placements as precise matrices and suffixes ids", () => {
    expect(placementMatrix({ rotationDeg: 90, xMm: 10, yMm: 5 })).toBe("matrix(0 1 -1 0 10 5)");
    expect(placementMatrix({ rotationDeg: 0, xMm: 1.5, yMm: 0 })).toBe("matrix(1 0 0 1 1.5 0)");
    expect(placementMatrix({ rotationDeg: 30, xMm: 0, yMm: 0 })).toBe("matrix(0.866025404 0.5 -0.5 0.866025404 0 0)");
    expect(suffixIds('<g id="a"><path id="b" d="M0 0"/></g>', "--p2")).toBe('<g id="a--p2"><path id="b--p2" d="M0 0"/></g>');
  });
});
