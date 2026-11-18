import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry, type GeometryIRV1, type SourceBundleV1, buildProjectPackage, nestableParts, planSheets, rectangleEngine, resolveSheetNestSettings } from "@topostack/core";
import { acrylicOutsideStudio, buildAtommPackage, createAtommExport, exportBlockReason, withLightBurnProjects } from "$lib/studio/export-policy";

function geometry(kind: SourceBundleV1["sourceKind"] = "real") {
  return generateGeometry(DEFAULT_PROJECT, { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: kind });
}

describe("Atomm export policy", () => {
  it("blocks synthetic and stale results", () => {
    expect(exportBlockReason(geometry("synthetic"), DEFAULT_PROJECT)).toMatch(/real terrain/i);
    expect(exportBlockReason(geometry("preview"), DEFAULT_PROJECT)).toMatch(/real terrain/i);
    expect(exportBlockReason(geometry(), { ...DEFAULT_PROJECT, verticalExaggeration: 9 })).toMatch(/settings changed/i);
    // Older terrain, compass and single-layer marker geometry need regeneration.
    for (const version of ["v6", "v7", "v8"]) {
      const stale = geometry();
      stale.configFingerprint = stale.configFingerprint!.replace(/^v\d+-/, `${version}-`);
      expect(exportBlockReason(stale, DEFAULT_PROJECT)).toMatch(/settings changed/i);
    }
  });

  it("blocks incomplete requested vector data", () => {
    const result = geometry();
    result.vectorStatus = "unavailable";
    expect(exportBlockReason(result, DEFAULT_PROJECT)).toMatch(/map detail data is unavailable/i);
    result.vectorStatus = "partial";
    expect(exportBlockReason(result, DEFAULT_PROJECT)).toMatch(/safe feature limit/i);
    result.vectorStatus = "available";
    result.lakeDataStatus = "unavailable";
    expect(exportBlockReason(result, DEFAULT_PROJECT)).toMatch(/lake depth data is unavailable/i);
    const depthOnly = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false };
    const missingOceanMask = generateGeometry(depthOnly, { ...createSyntheticSource(depthOnly, 32), sourceKind: "real", vectorStatus: "not-requested" });
    expect(exportBlockReason(missingOceanMask, depthOnly)).toMatch(/map detail data is unavailable/i);
    const withoutVectorDetails = { ...depthOnly, showWaterDepth: false };
    const completeWithoutVectors = generateGeometry(withoutVectorDetails, { ...createSyntheticSource(withoutVectorDetails, 32), sourceKind: "real", vectorStatus: "not-requested" });
    expect(exportBlockReason(completeWithoutVectors, withoutVectorDetails)).toBeUndefined();
  });

  it("maps nested assembly labels to blue without changing geometry or standalone exports", async () => {
    const project = { ...DEFAULT_PROJECT, sheetNesting: { sheetWidthMm: 600, sheetHeightMm: 400, marginMm: 3, spacingMm: 2, rotation: "quarter" as const, timeBudgetS: 5, seed: 1 } };
    const result = generateGeometry(project, { ...createSyntheticSource(project, 32), sourceKind: "real" });
    const settings = resolveSheetNestSettings(project);
    if (!settings.ok) throw new Error(settings.error);
    const sheetPlan = await planSheets(nestableParts(result), settings.settings, { engine: rectangleEngine });
    const original = buildProjectPackage(result, project, { sheetPlan });
    const adapted = await buildAtommPackage(result, project, [], sheetPlan);
    const originalSvg = await original.master.blob.text();
    expect(originalSvg).toContain("#00A651");
    expect(await adapted.master.blob.text()).toBe(originalSvg.replaceAll("#00A651", "#2366FF"));
    for (const file of adapted.files.filter(file => /\.(svg|html|txt)$/.test(file.filename))) {
      expect(await file.blob.text()).not.toMatch(/#00A651|green id|engraved in green/);
    }
    expect(await original.master.blob.text()).toContain("#00A651");
  });

  it("returns one master for Studio and all files for download", async () => {
    const result = geometry();
    const studio = await createAtommExport(result, DEFAULT_PROJECT, "openInStudio");
    const download = await createAtommExport(result, DEFAULT_PROJECT, "download");
    expect(Array.isArray(studio)).toBe(false);
    expect("filename" in studio && studio.filename.endsWith("-master.svg")).toBe(true);
    expect(Array.isArray(download)).toBe(true);
    expect(Array.isArray(download) && download.length).toBe((result.layers.length - result.fabricationNests.length) * 2 + 5);
  });

  it("names the acrylic Open in Studio leaves out", () => {
    const wood = { waterInserts: undefined, airspaceStack: undefined } as unknown as GeometryIRV1;
    const inserts = { waterInserts: [{}] } as unknown as GeometryIRV1;
    const airspace = { airspaceStack: { levels: [{}] } } as unknown as GeometryIRV1;
    const both = { waterInserts: [{}], airspaceStack: { levels: [{}] } } as unknown as GeometryIRV1;
    expect(acrylicOutsideStudio(wood)).toBe("");
    expect(acrylicOutsideStudio({ airspaceStack: { levels: [] } } as unknown as GeometryIRV1)).toBe("");
    expect(acrylicOutsideStudio(inserts)).toBe("The acrylic water inserts are not in it: download the project files for their own SVGs.");
    expect(acrylicOutsideStudio(airspace)).toBe("The acrylic airspace is not in it: download the project files for their own SVGs.");
    expect(acrylicOutsideStudio(both)).toBe("The acrylic water inserts and airspace are not in it: download the project files for their own SVGs.");
  });

  it("returns the engrave-only artwork for a flat project", async () => {
    const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, engravingContourCount: 10 };
    const result = generateGeometry(project, { ...createSyntheticSource(project, 32), sourceKind: "real" });
    const studio = await createAtommExport(result, project, "openInStudio");
    const download = await createAtommExport(result, project, "download");
    expect("filename" in studio && studio.filename.endsWith("-engraving.svg")).toBe(true);
    expect(Array.isArray(download) && download).toHaveLength(4);
  });
  it("uses Atomm processing colors and physical dimensions for layered and flat artwork", async () => {
    for (const outputMode of ["stack", "engraving"] as const) {
      const project = { ...DEFAULT_PROJECT, outputMode, name: "Map / expedition\\draft" };
      const result = generateGeometry(project, { ...createSyntheticSource(project, 32), sourceKind: "real" });
      const output = await createAtommExport(result, project, "openInStudio");
      if (Array.isArray(output)) throw new Error("Studio must receive one editable SVG");
      const svg = await output.blob.text();
      expect(output.filename).toMatch(/^[a-z0-9-]+\.svg$/);
      expect(output.blob.type).toBe("image/svg+xml");
      expect(svg).toMatch(/width="[\d.]+mm" height="[\d.]+mm" viewBox=/);
      expect(svg).toContain('stroke="#2366FF"');
      expect(svg.includes('stroke="#FE0002"')).toBe(outputMode === "stack");
      expect(svg).not.toMatch(/<use\b|#ff0035|#111827|#2563eb/);
      const shapes = svg.match(/<(?:path|rect|circle)\b[^>]*>/g) ?? [];
      expect(shapes.length).toBeGreaterThan(0);
      // Default artwork is all linework, even when a guide/contour is closed.
      // Its no-fill and processing color must survive removal of parent styles.
      for (const shape of shapes) {
        expect(shape).toContain('fill="none"');
        expect(shape).toMatch(/stroke="#(?:2366FF|FE0002)"/);
      }
      expect(shapes.some(shape => /alignment-|contour-/.test(shape))).toBe(true);
      const files = await createAtommExport(result, project, "download");
      if (!Array.isArray(files)) throw new Error("Download must receive the project files");
      for (const file of files) {
        expect(file.filename).not.toMatch(/[\\/]/);
        expect(file.filename).toMatch(/\.[a-z]+$/);
      }
      expect(files.reduce((sum, file) => sum + file.blob.size, 0)).toBeLessThanOrEqual(100_000_000);
    }
  });

});

describe("assembly guide fonts", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("loads the site faces once and encodes them for embedding", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32])));
    vi.stubGlobal("fetch", fetch);
    const { loadGuideFonts } = await import("$lib/studio/export-policy");
    const fonts = await loadGuideFonts();
    expect(fonts).toEqual([
      { family: "Jost", weight: 500, woff2Base64: "d09GMg==" },
      { family: "Archivo", weight: 400, woff2Base64: "d09GMg==" },
    ]);
    await loadGuideFonts();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves out a face that fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("Jost") ? new Response(null, { status: 404 }) : new Response(new Uint8Array([1]))));
    const { loadGuideFonts } = await import("$lib/studio/export-policy");
    expect((await loadGuideFonts()).map((font) => font.family)).toEqual(["Archivo"]);
  });

  it("embeds the loaded fonts in the downloaded guide", async () => {
    const { createAtommExport } = await import("$lib/studio/export-policy");
    const result = generateGeometry(DEFAULT_PROJECT, { ...createSyntheticSource(DEFAULT_PROJECT, 32), sourceKind: "real" });
    const files = await createAtommExport(result, DEFAULT_PROJECT, "download", [{ family: "Jost", weight: 500, woff2Base64: "d09GMg==" }]);
    if (!Array.isArray(files)) throw new Error("Download must receive the project files");
    const guide = await files.find((file) => file.filename.endsWith("-assembly-guide.html"))!.blob.text();
    expect(guide).toContain('font-family:"Jost";src:url(data:font/woff2;base64,d09GMg==)');
  });
});

describe("LightBurn projects", () => {
  it("adds a project beside every artwork SVG except the engraving-only companions", async () => {
    const output = buildProjectPackage(geometry(), DEFAULT_PROJECT);
    const withProjects = await withLightBurnProjects(output);
    const artwork = output.files.filter((file) => file.filename.endsWith(".svg") && !file.filename.endsWith("-engrave.svg"));
    const projects = withProjects.files.filter((file) => file.filename.endsWith(".lbrn2"));
    expect(projects.map((file) => file.filename)).toEqual(artwork.map((file) => file.filename.replace(/\.svg$/, ".lbrn2")));
    expect(withProjects.files.slice(0, output.files.length)).toEqual(output.files);
    expect(withProjects.master).toBe(output.master);
    const xml = await projects[0]!.blob.text();
    expect(xml).toContain("<LightBurnProject ");
    expect(xml).toContain('<name Value="Cut"/>');
  });

  it("leaves out an SVG with nothing to run", async () => {
    const empty = { filename: "ridge-layer-01-paint-water.svg", blob: new Blob(['<svg width="10mm" height="10mm" viewBox="0 0 10 10"></svg>'], { type: "image/svg+xml" }) };
    const result = await withLightBurnProjects({ schemaVersion: 1, master: empty, files: [empty] });
    expect(result.files).toEqual([empty]);
  });
});
