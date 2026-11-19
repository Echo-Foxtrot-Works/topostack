import { describe, expect, it } from "vitest";
import { buildFabricationPackage, DEFAULT_PROJECT, generateGeometry } from "../index.js";
import { distanceToSegment, gridSource, pointInRing, realSource, scaledForLayers } from "../test-support/sources.js";

describe("material nesting", () => {
  it("nests smaller layers into covered cavities with the configured glue margin", async () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    expect(result.fabricationNests.length).toBeGreaterThan(0);
    expect(result.fabricationNests.some((nest) => result.fabricationNests.some((next) => next.donorLayerIndex === nest.donorLayerIndex + 1))).toBe(true);
    for (const nest of result.fabricationNests) {
      expect(nest.nestedLayerIndex).toBeGreaterThan(nest.donorLayerIndex + 1);
      const donor = result.layers[nest.donorLayerIndex]!;
      const cover = result.layers[nest.donorLayerIndex + 1]!;
      const nested = result.layers[nest.nestedLayerIndex]!;
      for (const cavity of nest.cavities) {
        const childRing = nested.polygons[cavity.nestedPolygonIndex]!.outer;
        expect(donor.polygons[cavity.donorPolygonIndex]!.holes[cavity.donorHoleIndex]).toEqual([...childRing].reverse());
        const container = cover.polygons.find((polygon) => childRing.slice(0, -1).every((point) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))));
        expect(container).toBeTruthy();
        const clearance = Math.min(...childRing.slice(0, -1).flatMap((point) => [container!.outer, ...container!.holes].flatMap((ring) => ring.slice(0, -1).map((start, index) => distanceToSegment(point, start, ring[index + 1]!)))));
        expect(clearance).toBeGreaterThanOrEqual(DEFAULT_PROJECT.glueMarginMm + DEFAULT_PROJECT.laserKerfMm - 1e-6);
      }
    }
    const fabrication = buildFabricationPackage(result, DEFAULT_PROJECT);
    const panelFiles = fabrication.files.filter((file) => file.filename.endsWith(".svg") && !file.filename.endsWith("-engrave.svg") && !file.filename.endsWith("master.svg"));
    const engravingFiles = fabrication.files.filter((file) => file.filename.endsWith("-engrave.svg"));
    expect(panelFiles).toHaveLength(result.layers.length - result.fabricationNests.length);
    expect(engravingFiles).toHaveLength(panelFiles.length);
    expect(panelFiles.some((file) => file.filename.includes("-panel-") && file.filename.includes("-layers-"))).toBe(true);
    expect(await fabrication.master.blob.text()).toContain("data-layer=");
    const engraving = await engravingFiles[0]!.blob.text();
    expect(engraving).toContain('data-operation="ENGRAVE"');
    expect(engraving).not.toContain('data-operation="CUT"');
    expect(engraving).not.toContain('data-operation="SCORE"');
    const manifest = JSON.parse(await fabrication.files.find((file) => file.filename.endsWith("project.json"))!.blob.text());
    expect(manifest.result.fabrication.panels[0].engravingFilename).toMatch(/-engrave\.svg$/);
  });

  it("keeps one fabrication panel per layer when material nesting is disabled", () => {
    const project = { ...DEFAULT_PROJECT, optimizeMaterialUse: false };
    const result = generateGeometry(project, realSource(project));
    expect(result.fabricationNests).toEqual([]);
    expect(buildFabricationPackage(result, project).files).toHaveLength(result.layers.length * 2 + 5);
  });

  it("accepts fewer nests as the requested glue margin grows", () => {
    const tight = { ...DEFAULT_PROJECT, glueMarginMm: 2 };
    const generous = { ...DEFAULT_PROJECT, glueMarginMm: 25 };
    expect(generateGeometry(tight, realSource(tight)).fabricationNests.length)
      .toBeGreaterThanOrEqual(generateGeometry(generous, realSource(generous)).fabricationNests.length);
  });

  it("includes the laser kerf in the nesting glue clearance", () => {
    // Square-pyramid terrain with three layers leaves exactly one nesting
    // candidate with an exact 20 mm ring gap. A 19.5 mm glue margin fits
    // without kerf; adding 1 mm of kerf pushes the required clearance past the
    // gap and must block the nest.
    const pyramid = (nx: number, ny: number) => 100 * (1 - Math.max(Math.abs(nx), Math.abs(ny)));
    const fitsBase = { ...DEFAULT_PROJECT, widthMm: 120, heightMm: 120, glueMarginMm: 19.5, laserKerfMm: 0 };
    const [fits, pyramidSource] = scaledForLayers(fitsBase, gridSource(fitsBase, 41, pyramid), 3);
    expect(generateGeometry(fits, pyramidSource).fabricationNests.length).toBeGreaterThan(0);
    const blocked = { ...fits, laserKerfMm: 1 };
    expect(generateGeometry(blocked, pyramidSource).fabricationNests).toEqual([]);
    const project = { ...DEFAULT_PROJECT, glueMarginMm: 2, laserKerfMm: 1 };
    const result = generateGeometry(project, realSource(project));
    expect(result.fabricationNests.length).toBeGreaterThan(0);
    for (const nest of result.fabricationNests) {
      const cover = result.layers[nest.donorLayerIndex + 1]!;
      const nested = result.layers[nest.nestedLayerIndex]!;
      for (const cavity of nest.cavities) {
        const childRing = nested.polygons[cavity.nestedPolygonIndex]!.outer;
        const container = cover.polygons.find((polygon) => childRing.slice(0, -1).every((point) => pointInRing(point, polygon.outer)))!;
        const clearance = Math.min(...childRing.slice(0, -1).flatMap((point) => [container.outer, ...container.holes].flatMap((ring) => ring.slice(0, -1).map((start, index) => distanceToSegment(point, start, ring[index + 1]!)))));
        expect(clearance).toBeGreaterThanOrEqual(project.glueMarginMm + project.laserKerfMm - 1e-6);
      }
    }
  });

  it("refuses to nest under a covering layer with a terrain hole over the cavity", () => {
    // Caldera: gaussian ring of high terrain around a low crater floor. Every
    // upper layer is an annulus, so any nested ring would sit under the
    // covering layer's crater hole — the cavity would be visible from above.
    const base = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, glueMarginMm: 2 };
    const [project, source] = scaledForLayers(base, gridSource(base, 64, (nx, ny) => {
      const r = Math.hypot(nx, ny);
      return 100 * Math.exp(-(((r - 0.45) / 0.25) ** 2));
    }), 4);
    const result = generateGeometry(project, source);
    expect(result.layers[1]!.polygons.some((polygon) => polygon.holes.length > 0)).toBe(true);
    expect(result.fabricationNests).toEqual([]);
  });

  it("reserves base-layer material beneath the north arrow when nesting is enabled", () => {
    const base = {
      ...DEFAULT_PROJECT,
      widthMm: 200,
      heightMm: 200,
      northArrowSizeMm: 40,
      northArrowPlacement: { anchor: "center" as const, offset: { x: 0, y: 0 } },
    };
    const [project, source] = scaledForLayers(base, gridSource(base, 64, (nx, ny) => 1_500 - Math.hypot(nx, ny) * 900), 6);
    const result = generateGeometry(project, source);
    expect(result.layers.slice(1).some((layer) => layer.markings.some((marking) => marking.id.startsWith("north-")))).toBe(true);
    expect(result.fabricationNests.some((nest) => nest.donorLayerIndex === 0)).toBe(false);
  });
});
