import { describe, expect, it } from "vitest";
import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, layerToSvg, parseProject, projectFingerprint, sourceRequirements, type ProjectConfigV1 } from "../index.js";
import { engravingToSvg } from "./engraving-svg.js";
import { buildEngravingPackage } from "./packages.js";
import { masterToSvg } from "./svg.js";
import { gridSource, realSource } from "../test-support/sources.js";
import { EXPORT_CREDIT } from "./svg-primitives.js";
import { hasOperation, operationBody, rootGroups } from "../test-support/svg.js";

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

  it("engraves rail in its own group only when railways are on", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving", showRoads: true, lineStyle: { ...DEFAULT_PROJECT.lineStyle, localRoadMm: 0.3 } };
    const source = {
      ...realSource(project),
      markings: [{ id: "rail-flat", kind: "road" as const, operation: "engrave" as const, transportationClass: "rail" as const, points: [{ x: -120, y: 20 }, { x: 120, y: -20 }] }],
    };
    expect(engravingToSvg(generateGeometry(project, source), project)).not.toContain("rail-flat");
    const withRail = { ...project, showRail: true };
    const svg = engravingToSvg(generateGeometry(withRail, source), withRail);
    expect(svg).toContain('id="ENGRAVE-rail" stroke-width="0.3" stroke-linecap="round"');
    expect(svg).toContain("rail-flat");
    expect(svg).not.toContain('id="ENGRAVE-local-roads"');
  });

  it("saves optional footprints, clips them to the artwork and exports a separate engraving group", () => {
    const { showBuildings: _oldSetting, ...legacy } = DEFAULT_PROJECT;
    expect(parseProject(legacy).showBuildings).toBe(false);
    expect(projectFingerprint(parseProject(legacy))).toBe(projectFingerprint(DEFAULT_PROJECT));
    const project = parseProject({ ...legacy, outputMode: "engraving", showRoads: false, showTrails: false, showWater: false,
      location: { ...legacy.location, zoom: 13 }, showBuildings: true, lineStyle: { ...legacy.lineStyle, buildingMm: 0.12 } });
    const points = [{ x: 130, y: 10 }, { x: 180, y: 10 }, { x: 180, y: 50 }, { x: 130, y: 50 }, { x: 130, y: 10 }];
    const source = { ...realSource(project), markings: [{ id: "terminal", kind: "building" as const, operation: "engrave" as const, points }] };
    expect(sourceRequirements(project).vectors).toBe(true);
    for (const hidden of [{ ...project, showBuildings: false }, { ...project, location: { ...project.location, zoom: 12.99 } }]) {
      expect(sourceRequirements(hidden).vectors).toBe(false);
      expect(engravingToSvg(generateGeometry(hidden, source), hidden)).not.toContain("terminal");
    }
    const result = generateGeometry(project, source);
    const paths = result.layers.flatMap(layer => layer.markings.filter(mark => mark.kind === "building"));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.flatMap(path => path.points).every(point => point.x <= 150)).toBe(true);
    expect(engravingToSvg(result, project)).toContain('id="ENGRAVE-buildings" stroke-width="0.12"');
    const stack = generateGeometry({ ...project, outputMode: "stack" }, source);
    const sheets = stack.layers.map(layer => layerToSvg(stack, layer));
    expect(sheets.some(svg => operationBody(svg, "ENGRAVE").includes("terminal"))).toBe(true);
    expect(sheets.every(svg => !operationBody(svg, "CUT").includes("terminal"))).toBe(true);
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

  it("engraves only the map details when contour lines are off", async () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving", showEngravingContours: false, showElevationLabels: true, engravingIndexInterval: 2 };
    const source = {
      ...realSource(project),
      markings: [
        { id: "road-flat", kind: "road" as const, operation: "engrave" as const, transportationClass: "major-road" as const, points: [{ x: -120, y: -30 }, { x: 120, y: 30 }] },
        { id: "water-flat", kind: "water" as const, operation: "score" as const, points: [{ x: -80, y: 10 }, { x: 80, y: 10 }] },
      ],
    };
    const result = generateGeometry(project, source);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.markings.some((marking) => marking.id.startsWith("elevation-"))).toBe(false);
    const svg = engravingToSvg(result, project);
    expect(svg).not.toContain('id="contour-');
    expect(svg).toContain("road-flat");
    expect(svg).toContain("water-flat");
    expect(svg).toContain('id="engraving-border"');
    const output = buildEngravingPackage(result, project);
    const readme = await output.files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(readme).toContain("Contour lines: none\n");
    expect(readme).not.toContain("Index contour:");
    const manifest = JSON.parse(await output.files.find((file) => file.filename.endsWith("project.json"))!.blob.text());
    expect(manifest.result.contourCount).toBe(0);
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
    const cutGroup = operationBody(svg, "CUT");
    const cutPaths = [...cutGroup.matchAll(/<path[^>]* d="([^"]+)"/g)].map((path) => path[1] ?? "");
    expect(cutPaths.length).toBeGreaterThanOrEqual(result.layers.length);
    expect(cutPaths.every((data) => (data.match(/M/g) ?? []).length === 1)).toBe(true);
  });

  it("writes one root-level group per cut piece, holding its own cuts and engraving (Atomm SVG grouping spec)", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const svg = masterToSvg(result);
    const parts = rootGroups(svg);
    const pieces = result.layers.reduce((count, layer) => count + layer.polygons.length, 0);
    expect(parts).toHaveLength(pieces);
    for (const part of parts) {
      // A part never holds another part, and every part has its outline to cut.
      expect(part.slice(1).match(/<g id="[^"]*-part-\d+"/)).toBeNull();
      expect(hasOperation(part, "CUT")).toBe(true);
      expect(part).toMatch(/^<g id="[^"]+" data-name="[^"]+"/);
    }
    // Nothing is lost by grouping: every marking path of every layer is in some part.
    const markingIds = result.layers.flatMap((layer) => layer.markings.filter((mark) => mark.points.length > 1).map((mark) => mark.id));
    for (const id of markingIds) expect(svg).toContain(` id="${id}"`);
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
