import polygonClipping from "polygon-clipping";
import { describe, expect, it, vi } from "vitest";
import { createGeometryGenerator, generateGeometry, type GenerationStage } from "./generate.js";
import { createSyntheticSource } from "./synthetic-source.js";
import { DEFAULT_SHEET_NESTING } from "../export/sheet-nest/resolve.js";
import { DEFAULT_PROJECT, type CustomGraphicV1, type GeometryIRV1, type ProjectConfigV1 } from "../types.js";

const comparable = (geometry: GeometryIRV1) => ({ ...geometry, generatedAt: "" });
const graphic: CustomGraphicV1 = { id: "graphic-0001", name: "Frame", shapes: [{ outer: [-500, -500, 500, -500, 500, 500, -500, 500], holes: [] }] };
// Each loop regenerates a full map per edit; CI coverage runs 2–3x slower than local runs.

describe("generation terrain cache", () => {
  it("reuses terrain for downstream edits, keeping results independently owned", () => {
    const generate = createGeometryGenerator(), source = createSyntheticSource(DEFAULT_PROJECT, 80);
    const original = generate(DEFAULT_PROJECT, source);
    original.layers[0]!.polygons[0]!.outer[0]!.x = 99_999;
    original.layers[0]!.polygons[0]!.holes.push([{ x: 0, y: 0 }]);
    const edits: Partial<ProjectConfigV1>[] = [
      { showElevationLabels: false }, { showRoads: false }, { optimizeMaterialUse: false },
      { workAreaWidthMm: 180, workAreaHeightMm: 180 }, { paintTemplates: ["water"] },
      { showAlignmentGuides: false }, { laserKerfMm: 0.25 }, { units: "imperial" },
      { sheetNesting: { ...DEFAULT_SHEET_NESTING, sheetWidthMm: 300, sheetHeightMm: 200 } },
      { plaque: { enabled: false, text: "Mount Hood", sizeMm: 6, placement: { anchor: "center", offset: { x: 0, y: 0.5 } } } },
      { scaleBarPlacement: { anchor: "center", offset: { x: 0.2, y: -0.4 } } },
      { customGraphics: [graphic], placedGraphics: [{ id: "placed-0001", graphicId: graphic.id, placement: { anchor: "center", offset: { x: 0, y: 0 } }, sizeMm: 12, rotationDeg: 0, operation: "cut" }] },
    ];
    for (const edit of edits) {
      const config = { ...DEFAULT_PROJECT, ...edit }, stages: GenerationStage[] = [];
      const result = generate(config, source, { onStage: stage => { stages.push(stage); } });
      expect(stages).toContain("terrain-cache");
      expect(stages).not.toContain("contours");
      expect(comparable(result)).toEqual(comparable(generateGeometry(config, source)));
    }
  }, 30_000);

  it("invalidates for terrain settings and replaced source snapshots", () => {
    const generate = createGeometryGenerator(), source = createSyntheticSource(DEFAULT_PROJECT, 48);
    const edits: Partial<ProjectConfigV1>[] = [
      { widthMm: 400 }, { heightMm: 300 }, { materialThicknessMm: 4 }, { verticalExaggeration: 3 },
      { cropShape: "circle" }, { smoothing: 0 }, { minimumFeatureMm: 1.2 },
      { showWaterDepth: false }, { waterDepthExaggeration: 2 }, { fitLakeDepth: true },
      { waterDepthOverrides: { "123": 50 } }, { outputMode: "engraving" },
    ];
    for (const edit of edits) {
      generate(DEFAULT_PROJECT, source);
      const config = { ...DEFAULT_PROJECT, ...edit }, stages: GenerationStage[] = [];
      const result = generate(config, source, { onStage: stage => { stages.push(stage); } });
      expect(stages).toContain("contours");
      expect(stages).not.toContain("terrain-cache");
      expect(comparable(result)).toEqual(comparable(generateGeometry(config, source)));
    }
    generate(DEFAULT_PROJECT, source);
    const replacement = { ...source, elevation: { ...source.elevation, values: source.elevation.values.map(v => v + 100), min: source.elevation.min + 100, max: source.elevation.max + 100 } };
    const stages: GenerationStage[] = [];
    expect(comparable(generate(DEFAULT_PROJECT, replacement, { onStage: stage => { stages.push(stage); } }))).toEqual(comparable(generateGeometry(DEFAULT_PROJECT, replacement)));
    expect(stages).toContain("contours");
  }, 30_000);

  it("reuses carved lakes without accumulating shoreline smoothing or sharing output polygons", () => {
    const config = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200 };
    const source = createSyntheticSource(config, 64);
    source.waterAreas = [{
      id: "lake", kind: "lake", hylakId: 123, maxDepthM: 80, surfaceElevationM: 1400,
      polygon: { outer: [{ x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: 30 }, { x: -30, y: 30 }, { x: -30, y: -30 }], holes: [] },
    }];
    const generate = createGeometryGenerator();
    const first = generate(config, source);
    expect(first.waterSurfaces.length).toBeGreaterThan(0);
    first.waterSurfaces[0]!.polygons[0]!.outer[0]!.x = 99_999;
    const edited = { ...config, showElevationLabels: false };
    expect(comparable(generate(edited, source))).toEqual(comparable(generateGeometry(edited, source)));
    const deeper = { ...edited, waterDepthOverrides: { "123": 120 } };
    expect(comparable(generate(deeper, source))).toEqual(comparable(generateGeometry(deeper, source)));
  });

  it("refreshes source warnings when feature requirements change", () => {
    const config = { ...DEFAULT_PROJECT, showWater: false, showWaterDepth: false, showTrails: false, showBoundaries: false };
    const source = { ...createSyntheticSource(config, 48), vectorStatus: "unavailable" as const };
    const generate = createGeometryGenerator();
    expect(generate(config, source).warnings.some(w => w.code === "VECTOR_DATA_UNAVAILABLE")).toBe(true);
    const updated = { ...config, showRoads: false };
    expect(comparable(generate(updated, source))).toEqual(comparable(generateGeometry(updated, source)));
  });
});


describe("covering union fallback", () => {
  it("retains exact line clipping when a covering union cannot resolve its edges", () => {
    const source = createSyntheticSource(DEFAULT_PROJECT, 48);
    source.markings = Array.from({ length: 150 }, (_, i) => ({
      id: `road-${i}`, kind: "road" as const, operation: "engrave" as const,
      points: [{ x: -140, y: i - 75 }, { x: 140, y: i - 75 }],
    }));
    const expected = generateGeometry(DEFAULT_PROJECT, source);
    const union = vi.spyOn(polygonClipping, "union").mockImplementation(() => { throw new Error("Unresolved coincident edges"); });
    try {
      const result = generateGeometry(DEFAULT_PROJECT, source);
      expect(union).toHaveBeenCalled();
      expect(comparable(result)).toEqual(comparable(expected));
    } finally { union.mockRestore(); }
  });
});
