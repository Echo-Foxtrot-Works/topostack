import { beforeAll, describe, expect, it } from "vitest";
import { generateGeometry } from "../../pipeline/generate.js";
import { realSource } from "../../test-support/sources.js";
import { DEFAULT_PROJECT, type GeometryIRV1, type ProjectConfigV1 } from "../../types.js";
import { OPERATIONS, panelBodies, partGroup } from "../svg.js";
import { nestedSheets, placementMatrix, suffixIds, type NestedSheet } from "./apply.js";
import { nestableParts } from "./parts.js";
import { planSheets } from "./plan-sheets.js";
import { rectangleEngine } from "./rectangles.js";
import { resolveSheetNestSettings } from "./resolve.js";
import { nestedPaintTemplateSvg, nestedSheetBodies } from "./sheet-svg.js";

const sheetNesting = { sheetWidthMm: 400, sheetHeightMm: 300, marginMm: 3, spacingMm: 2, rotation: "quarter" as const, timeBudgetS: 5, seed: 1 };

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

  it("gives each placed piece its own group, moved onto the sheet by its own transform", () => {
    for (const sheet of sheets) {
      const parts = nestedSheetBodies(ir, sheet);
      const expected = sheet.parts.flatMap((nested, index) => panelBodies(ir, nested.panel).map(() => ({ transform: placementMatrix(nested.placement), label: nested.part.label, suffix: `--p${index + 1}` })));
      expect(parts.map((part) => ({ transform: part.transform, label: /data-part="([^"]*)"/.exec(part.attributes ?? "")?.[1], suffix: part.id.slice(part.id.lastIndexOf("--")) })))
        .toEqual(expected.map(({ transform, label, suffix }) => ({ transform, label, suffix })));
    }
  });

  it("draws each part exactly as its own panel would, only with suffixed ids", () => {
    const sheet = sheets[0]!;
    const parts = nestedSheetBodies(ir, sheet);
    let position = 0;
    sheet.parts.forEach((nested, index) => {
      for (const alone of panelBodies(ir, nested.panel)) {
        const placed = parts[position++]!;
        expect(placed.id).toBe(`${alone.id}--p${index + 1}`);
        for (const operation of OPERATIONS) expect(placed.bodies[operation] ?? "").toBe(suffixIds(alone.bodies[operation] ?? "", `--p${index + 1}`));
      }
    });
    expect(position).toBe(parts.length);
  });

  it("keeps every id on a sheet unique although parts repeat layer groups", () => {
    for (const sheet of sheets) {
      const svg = nestedSheetBodies(ir, sheet).map((part) => partGroup(part, OPERATIONS, ir.lineStyle)).join("");
      const ids = [...svg.matchAll(/ id="([^"]*)"/g)].map((match) => match[1]);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("escapes part labels written into attributes", () => {
    const sheet = sheets[0]!;
    const renamed = { ...sheet, parts: sheet.parts.map((nested, index) => index === 0 ? { ...nested, part: { ...nested.part, label: `A&"<1>` } } : nested) };
    expect(partGroup(nestedSheetBodies(ir, renamed)[0]!, OPERATIONS, ir.lineStyle)).toContain('data-part="A&amp;&quot;&lt;1&gt;"');
  });

  it("registers a paint stencil to the sheet, and writes none when no part keeps paper", () => {
    // Give the first part's first piece a stencil: the piece itself as paper.
    const { layerIndex, polygonIndexes: [polygonIndex] } = sheets[0]!.parts[0]!.part.members[0]!;
    const polygon = ir.layers[layerIndex]!.polygons[polygonIndex!]!;
    const painted = { ...ir, paintRegions: [{ kind: "water" as const, layerIndex, polygonIndex: polygonIndex!, polygons: [], paper: [polygon] }] };
    const svg = nestedPaintTemplateSvg(painted, config, sheets[0]!, "water")!;
    expect(svg).toContain(`viewBox="0 0 ${sheetNesting.sheetWidthMm} ${sheetNesting.sheetHeightMm}"`);
    expect(svg).toContain("water paint template — sheet 1");
    expect(svg).toMatch(new RegExp(`<g id="[^"]*-paint-water-part-\\d+--p1" data-name="[^"]+"[^>]* data-paint-kind="water" data-part="${sheets[0]!.parts[0]!.part.label}"`));
    expect(svg).toContain(`transform="${placementMatrix(sheets[0]!.parts[0]!.placement)}"`);
    expect(svg.match(/data-role="stencil"/g)).toHaveLength(1);
    expect(nestedPaintTemplateSvg(ir, config, sheets[0]!, "water")).toBeUndefined();
    for (const sheet of sheets.slice(1)) expect(nestedPaintTemplateSvg(painted, config, sheet, "water")).toBeUndefined();
  });
});
