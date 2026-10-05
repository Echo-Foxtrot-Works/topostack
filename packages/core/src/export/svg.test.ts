import { describe, expect, it } from "vitest";
import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, layerToSvg, type ProjectConfigV1 } from "../index.js";
import { engravingToSvg } from "./engraving-svg.js";
import { buildEngravingPackage } from "./packages.js";
import { masterToSvg } from "./svg.js";
import { gridSource, realSource } from "../test-support/sources.js";
import { EXPORT_CREDIT } from "./svg-primitives.js";

describe("SVG export", () => {
  it("exports 1:1 millimeter SVGs with machine operation groups", async () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const svg = layerToSvg(result, result.layers[0]!);
    expect(svg).toContain('width="300.15mm"');
    expect(svg).toContain('viewBox="-150.075 -100.075 300.15 200.15"');
    expect(svg).toMatch(/M150\.075 100\.075 .*L-150\.075 -100\.075/s);
    expect(svg).toContain('data-operation="CUT"');
    expect(svg).toContain('data-operation="ENGRAVE"');
    expect(svg).toContain('id="elevation-0"');
    expect(svg).not.toContain("<text");
    const donorLayer = result.layers[result.fabricationNests[0]!.donorLayerIndex]!;
    const nestedSvg = layerToSvg(result, donorLayer);
    const cutGroup = nestedSvg.slice(nestedSvg.indexOf('data-operation="CUT"'));
    const cutPathData = [...cutGroup.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(cutPathData.length).toBeGreaterThan(1);
    expect(cutPathData.every((data) => (data.match(/M/g) ?? []).length === 1)).toBe(true);
    const fabrication = buildFabricationPackage(result, DEFAULT_PROJECT);
    expect(fabrication.files).toHaveLength((result.layers.length - result.fabricationNests.length) * 2 + 5);
    expect(await fabrication.master.blob.text()).toContain("master layout");
  });

  it("builds one physical-size engrave-only graphic with contours and optional map details", async () => {
    const project: ProjectConfigV1 = {
      ...DEFAULT_PROJECT,
      outputMode: "engraving",
      engravingContourCount: 8,
      engravingIndexInterval: 4,
      lineStyle: { ...DEFAULT_PROJECT.lineStyle, contourMm: 0.12, indexContourMm: 0.4, majorRoadMm: 0.52, trailMm: 0.18, waterMm: 0.36, borderMm: 0.46, trailPattern: "dotted" },
      showWaterDepth: true,
      showAlignmentGuides: true,
    };
    const source = {
      ...realSource(project),
      markings: [
        { id: "road-flat", kind: "road" as const, operation: "engrave" as const, transportationClass: "major-road" as const, points: [{ x: -120, y: -30 }, { x: 120, y: 30 }] },
        { id: "trail-flat", kind: "trail" as const, operation: "engrave" as const, transportationClass: "trail" as const, points: [{ x: -100, y: 40 }, { x: 100, y: -40 }] },
        { id: "water-flat", kind: "water" as const, operation: "score" as const, points: [{ x: -80, y: 10 }, { x: 80, y: 10 }] },
      ],
    };
    const result = generateGeometry(project, source);
    expect(result.layers).toHaveLength(9);
    expect(result.fabricationNests).toEqual([]);
    expect(result.layers.flatMap((layer) => layer.markings).some((marking) => marking.id.startsWith("alignment-"))).toBe(false);
    const svg = engravingToSvg(result, project);
    expect(svg).toContain('width="300mm"');
    expect(svg).toContain('height="200mm"');
    expect(svg).toContain('data-operation="ENGRAVE"');
    expect(svg).toContain('id="ENGRAVE-contours-minor"');
    expect(svg).toContain('id="ENGRAVE-contours-index"');
    expect(svg).toContain('id="ENGRAVE-contours-minor" stroke-width="0.12"');
    expect(svg).toContain('id="ENGRAVE-contours-index" stroke-width="0.4"');
    expect(svg).toContain('id="ENGRAVE-major-roads" stroke-width="0.52"');
    expect(svg).toMatch(/id="ENGRAVE-trails" stroke-width="0\.18" stroke-dasharray="0\.01 [^"]+"/);
    expect(svg).toContain('id="ENGRAVE-water" stroke-width="0.36"');
    expect(svg).toContain('id="ENGRAVE-border" stroke-width="0.46"');
    expect(svg).toContain("road-flat");
    expect(svg).toContain("trail-flat");
    expect(svg).toContain("water-flat");
    expect(svg).toContain('id="engraving-border"');
    expect(svg).not.toContain('data-operation="CUT"');
    expect(svg).not.toContain('data-operation="SCORE"');
    const output = buildEngravingPackage(result, project);
    expect(output.master.filename).toBe("crater-lake-engraving.svg");
    expect(output.files).toHaveLength(4);
    expect(await output.master.blob.text()).toBe(svg);
    const renamed = { ...project, name: "Renamed Crater" };
    const renamedOutput = buildEngravingPackage(result, renamed);
    expect(renamedOutput.master.filename).toBe("renamed-crater-engraving.svg");
    expect(await renamedOutput.master.blob.text()).toContain("Renamed Crater");
    const renamedManifest = JSON.parse(await renamedOutput.files.find((file) => file.filename.endsWith("project.json"))!.blob.text());
    expect(renamedManifest.project.name).toBe("Renamed Crater");
  });

  it("emits only the base outline for a flat engraving of perfectly flat ground", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving", showElevationLabels: true, engravingContourCount: 10, engravingIndexInterval: 2 };
    const result = generateGeometry(project, gridSource(project, 32, () => 640));
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.markings.some((marking) => marking.id.startsWith("elevation-"))).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain("LOW_RELIEF");
    const svg = engravingToSvg(result, project);
    expect(svg).not.toContain('id="contour-');
    expect(svg).toContain('id="engraving-border"');
  });

  it("keeps flat linework bounded and uniquely keyed when provider ids repeat", () => {
    const project: ProjectConfigV1 = {
      ...DEFAULT_PROJECT,
      outputMode: "engraving",
      engravingContourCount: 40,
      showElevationLabels: false,
      showNorthArrow: false,
      showScaleBar: false,
      showTransportationLabels: false,
      showWater: false,
    };
    const source = realSource(project);
    source.markings = Array.from({ length: 200 }, (_, index) => ({
      id: index < 2 ? "duplicate-provider-id" : `statewide-road-${index}`,
      kind: "road" as const,
      operation: "engrave" as const,
      transportationClass: "local-road" as const,
      points: [{ x: -140, y: -90 + index * 0.9 }, { x: 140, y: -90 + index * 0.9 }],
    }));
    const result = generateGeometry(project, source);
    const roadsByLayer = result.layers.map((layer) => layer.markings.filter((marking) => marking.kind === "road"));
    const roads = roadsByLayer.flat();
    const ids = result.layers.flatMap((layer) => layer.markings).map((marking) => marking.id);
    const svgIds = [...engravingToSvg(result, project).matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);

    expect(roads).toHaveLength(200);
    expect(roadsByLayer.filter((markings) => markings.length > 0)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(svgIds).size).toBe(svgIds.length);
  });

  it("blocks stale and synthetic fabrication exports", () => {
    const synthetic = generateGeometry(DEFAULT_PROJECT, createSyntheticSource(DEFAULT_PROJECT, 32));
    expect(() => buildFabricationPackage(synthetic, DEFAULT_PROJECT)).toThrow(/real terrain/i);
    const real = generateGeometry(DEFAULT_PROJECT, realSource());
    expect(() => buildFabricationPackage(real, { ...DEFAULT_PROJECT, widthMm: 301 })).toThrow(/settings changed/i);
    real.vectorStatus = "unavailable";
    expect(() => buildFabricationPackage(real, DEFAULT_PROJECT)).toThrow(/map detail data is unavailable/i);
  });

  it("uses unique SVG ids in a multi-layer master", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const svg = masterToSvg(result);
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const cutGroup = svg.slice(svg.indexOf('data-operation="CUT"'));
    const cutPaths = [...cutGroup.matchAll(/<path[^>]* d="([^"]+)"/g)].map((path) => path[1] ?? "");
    expect(cutPaths.length).toBeGreaterThanOrEqual(result.layers.length);
    expect(cutPaths.every((data) => (data.match(/M/g) ?? []).length === 1)).toBe(true);
  });

  it("credits TopoStack once, as a non-drawing description right after the title", async () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const engraving = { ...DEFAULT_PROJECT, outputMode: "engraving" as const };
    const fabrication = buildFabricationPackage(result, DEFAULT_PROJECT);
    const svgs = [
      layerToSvg(result, result.layers[0]!),
      masterToSvg(result),
      ...await Promise.all(fabrication.files.filter((file) => file.filename.endsWith(".svg")).map((file) => file.blob.text())),
      engravingToSvg(generateGeometry(engraving, realSource(engraving)), engraving),
    ];
    expect(EXPORT_CREDIT).toBe("Made with TopoStack · https://topostack.app");
    const desc = `<desc>${EXPORT_CREDIT}</desc>`;
    const count = (svg: string, pattern: RegExp) => svg.match(pattern)?.length ?? 0;
    for (const svg of svgs) {
      expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
      expect(count(svg, /<desc\b/g)).toBe(1);
      expect(count(svg, /Made with TopoStack/g)).toBe(1);
      // The credit is a text-only element between the title and the artwork, so the drawn
      // groups and paths follow it unchanged (the path-count tests above still hold).
      expect(svg).toMatch(new RegExp(`^[^\\n]*\\n<svg [^>]*><title>[^<]*</title>${desc}<(?:g|path)\\b`));
      expect(count(svg, /<path\b/g)).toBeGreaterThan(0);
    }
  });
});
