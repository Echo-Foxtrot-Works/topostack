import { beforeAll, describe, expect, it } from "vitest";
import { generateGeometry } from "../../pipeline/generate.js";
import { realSource } from "../../test-support/sources.js";
import { DEFAULT_PROJECT, type GeometryIRV1, type ProjectConfigV1 } from "../../types.js";
import { OPERATIONS, panelBodies } from "../svg.js";
import { nestedSheets, placementMatrix, suffixIds, type NestedSheet } from "./apply.js";
import { nestableParts } from "./parts.js";
import { planSheets } from "./plan-sheets.js";
import { rectangleEngine } from "./rectangles.js";
import { resolveSheetNestSettings } from "./resolve.js";
import { nestedPaintTemplateSvg, nestedSheetBodies } from "./sheet-svg.js";

const sheetNesting = { sheetWidthMm: 400, sheetHeightMm: 300, marginMm: 3, spacingMm: 2, rotation: "quarter" as const, timeBudgetS: 5, seed: 1 };

/** Every part group of one operation body, with its attributes and contents. */
function partGroups(body: string): Array<{ index: number; part: string; transform: string; content: string }> {
  const opening = [...body.matchAll(/<g id="part-(\d+)-[A-Z-]+" data-part="([^"]*)" data-layers="[^"]*" transform="([^"]*)">/g)];
  return opening.map((match, position) => ({
    index: Number(match[1]),
    part: match[2]!,
    transform: match[3]!,
    content: body.slice(match.index! + match[0].length, (opening[position + 1]?.index ?? body.length) - "</g>".length),
  }));
}

// Generating and nesting a whole split model is slow under coverage instrumentation.
describe("nested sheet SVG", { timeout: 30_000 }, () => {
  let config: ProjectConfigV1;
  let ir: GeometryIRV1;
  let sheets: NestedSheet[];

  beforeAll(async () => {
    config = { ...DEFAULT_PROJECT, workAreaWidthMm: 160, workAreaHeightMm: 120, sheetNesting };
    ir = generateGeometry(config, realSource(config));
    const resolved = resolveSheetNestSettings(config);
    if (!resolved.ok) throw new Error(resolved.error);
    const parts = nestableParts(ir);
    sheets = nestedSheets(ir, parts, await planSheets(parts, resolved.settings, { engine: rectangleEngine }));
  });

  it("wraps each part's cut lines in one group placed by its own transform", () => {
    for (const sheet of sheets) {
      const groups = partGroups(nestedSheetBodies(ir, sheet).cut);
      expect(groups.map((group) => group.index)).toEqual(sheet.parts.map((_, index) => index + 1));
      groups.forEach((group, index) => {
        expect(group.transform).toBe(placementMatrix(sheet.parts[index]!.placement));
        expect(group.part).toBe(sheet.parts[index]!.part.label);
      });
    }
  });

  it("draws each part exactly as its own panel would, only with suffixed ids", () => {
    const sheet = sheets[0]!;
    const bodies = nestedSheetBodies(ir, sheet);
    for (const operation of OPERATIONS) {
      const groups = new Map(partGroups(bodies[operation]).map((group) => [group.index, group.content]));
      sheet.parts.forEach((nested, index) => {
        const alone = panelBodies(ir, nested.panel)[operation];
        expect(groups.get(index + 1) ?? "").toBe(alone ? suffixIds(alone, `--p${index + 1}`) : "");
      });
    }
  });

  it("keeps every id on a sheet unique although parts repeat layer groups", () => {
    for (const sheet of sheets) {
      const svg = OPERATIONS.map((operation) => nestedSheetBodies(ir, sheet)[operation]).join("");
      const ids = [...svg.matchAll(/ id="([^"]*)"/g)].map((match) => match[1]);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("escapes part labels written into attributes", () => {
    const sheet = sheets[0]!;
    const renamed = { ...sheet, parts: sheet.parts.map((nested, index) => index === 0 ? { ...nested, part: { ...nested.part, label: `A&"<1>` } } : nested) };
    expect(nestedSheetBodies(ir, renamed).cut).toContain('data-part="A&amp;&quot;&lt;1&gt;"');
  });

  it("registers a paint stencil to the sheet, and writes none when no part keeps paper", () => {
    // Give the first part's first piece a stencil: the piece itself as paper.
    const { layerIndex, polygonIndexes: [polygonIndex] } = sheets[0]!.parts[0]!.part.members[0]!;
    const polygon = ir.layers[layerIndex]!.polygons[polygonIndex!]!;
    const painted = { ...ir, paintRegions: [{ kind: "water" as const, layerIndex, polygonIndex: polygonIndex!, polygons: [], paper: [polygon] }] };
    const svg = nestedPaintTemplateSvg(painted, config, sheets[0]!, "water")!;
    expect(svg).toContain(`viewBox="0 0 ${sheetNesting.sheetWidthMm} ${sheetNesting.sheetHeightMm}"`);
    expect(svg).toContain("water paint template — sheet 1");
    expect(svg).toContain(`<g id="part-1-PAINT-WATER" data-part="${sheets[0]!.parts[0]!.part.label}"`);
    expect(svg).toContain(`transform="${placementMatrix(sheets[0]!.parts[0]!.placement)}"`);
    expect(svg.match(/data-role="stencil"/g)).toHaveLength(1);
    expect(nestedPaintTemplateSvg(ir, config, sheets[0]!, "water")).toBeUndefined();
    for (const sheet of sheets.slice(1)) expect(nestedPaintTemplateSvg(painted, config, sheet, "water")).toBeUndefined();
  });
});
