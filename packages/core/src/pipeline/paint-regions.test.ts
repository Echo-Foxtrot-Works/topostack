import { describe, expect, it, vi } from "vitest";
import polygonClipping from "polygon-clipping";
import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, validateProject, type GeometryIRV1, type GeometryWarning, type LayerIR, type Point2D, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1 } from "../index.js";
import { distanceToSegment, pointInPolygon, pointInPreparedPolygons, preparePolygons } from "../primitives/geometry2d.js";
import { PAINT_BLEED_MM, PAINT_LOOSE_SHEET_MIN_MM, PAINT_PAPER_MIN_MM, paintRegions, paintStencil } from "./paint-regions.js";
import { sourceRequirements } from "./source-requirements.js";

const EARTH_RADIUS_M = 6_371_008.8;
const LAKE_RADIUS_MM = 40;

function circleRing(centerX: number, centerY: number, radiusMm: number, segments = 96): Point2D[] {
  const points = Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: centerX + Math.cos(angle) * radiusMm, y: centerY + Math.sin(angle) * radiusMm };
  });
  return [...points, { ...points[0]! }];
}

function square(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
}

function lakeArea(overrides: Partial<WaterAreaV1> = {}): WaterAreaV1 {
  return { id: "lake-1", kind: "lake", polygon: { outer: circleRing(0, 0, LAKE_RADIUS_MM), holes: [] }, maxDepthM: 150, meanDepthM: 60, ...overrides };
}

function gridSource(project: ProjectConfigV1, size: number, elevationAt: (nx: number, ny: number) => number): SourceBundleV1 {
  const values = new Float32Array(size * size);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const elevation = elevationAt((x / (size - 1) - 0.5) * 2, (y / (size - 1) - 0.5) * 2);
      values[y * size + x] = elevation;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  }
  return { ...createSyntheticSource(project, 2), sourceKind: "real", elevation: { width: size, height: size, values, min, max } };
}

/** A flat lake in a bowl: level inside the outline, rising 4 m per mm beyond it. */
function flatLake(project: ProjectConfigV1): SourceBundleV1 {
  return gridSource(project, 96, (nx, ny) => {
    const radiusMm = Math.hypot((nx * project.widthMm) / 2, (ny * project.heightMm) / 2);
    return radiusMm <= LAKE_RADIUS_MM + 2 ? 1500 : 1500 + (radiusMm - LAKE_RADIUS_MM - 2) * 4;
  });
}

function scaledForLayers(project: ProjectConfigV1, source: SourceBundleV1, layerCount: number): [ProjectConfigV1, SourceBundleV1] {
  const relief = source.elevation.max - source.elevation.min;
  const groundWidthM = (relief * project.widthMm * project.verticalExaggeration) / (layerCount * project.materialThicknessMm);
  const halfSpan = groundWidthM / (2 * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(project.location.lat * (Math.PI / 180)));
  const bounds = { west: project.location.lon - halfSpan, south: project.location.lat - halfSpan * 0.7, east: project.location.lon + halfSpan, north: project.location.lat + halfSpan * 0.7 };
  return [{ ...project, location: { ...project.location, bounds } }, { ...source, bounds }];
}

function vertices(polygons: Polygon2D[]): Point2D[] {
  return polygons.flatMap((polygon) => [...polygon.outer, ...polygon.holes.flat()]);
}

function nearRing(point: Point2D, ring: Point2D[], tolerance: number): boolean {
  for (let index = 1; index < ring.length; index += 1) if (distanceToSegment(point, ring[index - 1]!, ring[index]!) <= tolerance) return true;
  return false;
}

function insideOrOn(point: Point2D, polygon: Polygon2D, tolerance = 0.02): boolean {
  return pointInPolygon(point, polygon) || [polygon.outer, ...polygon.holes].some((ring) => nearRing(point, ring, tolerance));
}

const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, paintTemplates: ["water"], waterDepthLayerLimit: 6, showWater: false, optimizeMaterialUse: false, showAlignmentGuides: false };

describe("paint regions", () => {
  it("windows only exposed water, reaching under the layer above but never onto dry land", () => {
    const layer: LayerIR = { id: "layer-01", index: 0, elevationM: 0, materialThicknessMm: 3, polygons: [{ outer: square(-50, -50, 50, 50), holes: [] }], markings: [], pieces: [] };
    const covering = preparePolygons([{ outer: square(0, -50, 50, 50), holes: [] }]);
    const regions = paintRegions(base, [{ layer, covering }], {
      waterSurfaces: [{ id: "lake", kind: "lake", polygons: [{ outer: circleRing(0, 0, 30), holes: [] }], surfaceElevationM: 0, bedElevationM: 0, layerIndex: 0, depthSource: "modeled" }],
      flatWater: [],
      cellPitchMm: 1,
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ kind: "water", layerIndex: 0, polygonIndex: 0 });
    const points = vertices(regions[0]!.polygons);
    const maxX = Math.max(...points.map((point) => point.x));
    const minX = Math.min(...points.map((point) => point.x));
    // The bleed carries the window under the covering by exactly the bleed...
    expect(maxX).toBeCloseTo(PAINT_BLEED_MM, 2);
    // ...and no further than the water on the exposed side.
    expect(minX).toBeCloseTo(-30, 1);
    for (const point of points) if (point.x < -0.01) expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(30.02);

    // A layer below the surface owns the basin rim too: the outline grows by one cell.
    const below = paintRegions(base, [{ layer, covering: preparePolygons([]) }], {
      waterSurfaces: [{ id: "lake", kind: "lake", polygons: [{ outer: circleRing(0, 0, 30), holes: [] }], surfaceElevationM: 0, bedElevationM: 0, layerIndex: 4, depthSource: "modeled" }],
      flatWater: [],
      cellPitchMm: 2,
    });
    const radii = vertices(below[0]!.polygons).map((point) => Math.hypot(point.x, point.y));
    expect(Math.max(...radii)).toBeCloseTo(32, 1);
    expect(Math.min(...radii)).toBeGreaterThan(31.9);
  });

  it("cuts the stencil as one outline: an edge window reshapes the edge and a thin bridge opens up", () => {
    const piece: Polygon2D = { outer: square(0, 0, 100, 60), holes: [] };
    // Water along the bottom edge, leaving 0.3 mm of paper under it near the left, none at the right.
    const window: Polygon2D = { outer: [{ x: 10, y: 0.3 }, { x: 60, y: 0.3 }, { x: 60, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 0.3 }], holes: [] };
    const paper = paintStencil(piece, [window], 0.8);
    expect(paper).toHaveLength(1);
    expect(paper[0]!.holes).toEqual([]);
    const points = paper[0]!.outer;
    // The bridge is gone: nothing of the paper sits under the window.
    expect(points.some((point) => point.x > 10.5 && point.x < 89.5 && point.y < 19.9)).toBe(false);
    // The piece corners survive the opening exactly.
    for (const corner of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]) expect(points.some((point) => Math.hypot(point.x - corner.x, point.y - corner.y) < 0.01)).toBe(true);
    const area = Math.abs(points.reduce((sum, point, index) => sum + (index ? points[index - 1]!.x * point.y - point.x * points[index - 1]!.y : 0), 0)) / 2;
    expect(area).toBeCloseTo(100 * 60 - 80 * 20, 0);

    // An interior window is a hole; an island in it becomes its own sheet.
    const island = paintStencil(piece, [{ outer: circleRing(50, 30, 20), holes: [circleRing(50, 30, 8)] }], 0.8);
    expect(island).toHaveLength(2);
    expect(island.map((sheet) => sheet.holes.length).sort()).toEqual([0, 1]);
    // A loose sliver of land pinched off against the edge is dropped rather than left as a scrap nobody can place.
    const flake = paintStencil(piece, [{ outer: [{ x: 10, y: 0 }, { x: 46, y: 0 }, { x: 46, y: 3 }, { x: 50, y: 3 }, { x: 50, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 0 }], holes: [] }], 0.8);
    expect(flake).toHaveLength(1);
    expect(flake[0]!.outer.some((point) => point.y < 19.9 && point.x > 10.5 && point.x < 89.5)).toBe(false);
    expect(PAINT_LOOSE_SHEET_MIN_MM).toBeGreaterThan(4);
    // Long does not help a sliver: a 2 mm strip 40 mm long is still a scrap, while the main sheet is kept whatever its shape.
    const strip = paintStencil(piece, [{ outer: [{ x: 10, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 2 }, { x: 70, y: 2 }, { x: 70, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 0 }], holes: [] }], 0.8);
    expect(strip).toHaveLength(1);
    expect(strip[0]!.outer.some((point) => point.y < 19.9 && point.x > 10.5 && point.x < 89.5)).toBe(false);
    // A ribbon of beach thinner than the paper minimum is opened up even where it hangs off the sheet; a sound strip stays.
    const ribbons = paintStencil(piece, [{ outer: [{ x: 10, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 20 }, { x: 62, y: 20 }, { x: 62, y: 5 }, { x: 60, y: 5 }, { x: 60, y: 20 }, { x: 41, y: 20 }, { x: 41, y: 5 }, { x: 40, y: 5 }, { x: 40, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 0 }], holes: [] }], 0.8);
    expect(ribbons).toHaveLength(1);
    expect(ribbons[0]!.outer.some((point) => point.x > 39.5 && point.x < 41.5 && point.y < 19.9)).toBe(false);
    expect(ribbons[0]!.outer.some((point) => point.x > 59.5 && point.x < 62.5 && point.y < 5.1)).toBe(true);
    expect(PAINT_PAPER_MIN_MM).toBeLessThan(1.8);
    // Water edge to edge leaves no paper, so no stencil.
    expect(paintStencil(piece, [piece], 0.8)).toEqual([]);
  });

  it("carries each region's stencil, cut from the piece without its nest cavities", () => {
    const layer: LayerIR = { id: "layer-01", index: 0, elevationM: 0, materialThicknessMm: 3, polygons: [{ outer: square(-50, -50, 50, 50), holes: [square(-45, 20, -35, 30), square(35, 20, 45, 30)] }], markings: [], pieces: [] };
    const sources = { waterSurfaces: [{ id: "lake", kind: "lake" as const, polygons: [{ outer: circleRing(0, -20, 15), holes: [] }], surfaceElevationM: 0, bedElevationM: 0, layerIndex: 0, depthSource: "modeled" as const }], flatWater: [], cellPitchMm: 1 };
    const nests = [{ id: "nest", donorLayerIndex: 0, nestedLayerIndex: 1, glueMarginMm: 8, cavities: [{ donorPolygonIndex: 0, donorHoleIndex: 1, nestedPolygonIndex: 0 }] }];
    const [region] = paintRegions(base, [{ layer, covering: preparePolygons([]) }], sources, nests);
    expect(region?.paper).toHaveLength(1);
    // The window and the kept hole; the cavity is left whole for the paper.
    expect(region!.paper![0]!.holes).toHaveLength(2);
    expect(region!.paper![0]!.holes.some((hole) => hole.some((point) => point.x > 35))).toBe(false);
  });

  it("returns nothing for a flat engraving, an empty kind list, or a layer with no water", () => {
    const layer: LayerIR = { id: "layer-01", index: 0, elevationM: 0, materialThicknessMm: 3, polygons: [{ outer: square(-50, -50, 50, 50), holes: [] }], markings: [], pieces: [] };
    const clips = [{ layer, covering: preparePolygons([]) }];
    const sources = { waterSurfaces: [{ id: "lake", kind: "lake" as const, polygons: [{ outer: circleRing(0, 0, 30), holes: [] }], surfaceElevationM: 0, bedElevationM: 0, layerIndex: 0, depthSource: "modeled" as const }], flatWater: [], cellPitchMm: 1 };
    expect(paintRegions({ ...base, outputMode: "engraving" }, clips, sources)).toEqual([]);
    expect(paintRegions({ ...base, paintTemplates: [] }, clips, sources)).toEqual([]);
    expect(paintRegions(base, clips, { waterSurfaces: [], flatWater: [], cellPitchMm: 1 })).toEqual([]);
    // Water far from the piece never reaches the clipper.
    expect(paintRegions(base, clips, { ...sources, waterSurfaces: [{ ...sources.waterSurfaces[0]!, polygons: [{ outer: circleRing(500, 500, 30), holes: [] }] }] })).toEqual([]);
  });

  it("says which layers lost paint windows the clipper refused", () => {
    const layer: LayerIR = { id: "layer-02", index: 1, elevationM: 0, materialThicknessMm: 3, polygons: [{ outer: square(-50, -50, 50, 50), holes: [] }], markings: [], pieces: [] };
    const sources = { waterSurfaces: [{ id: "lake", kind: "lake" as const, polygons: [{ outer: circleRing(0, 0, 30), holes: [] }], surfaceElevationM: 0, bedElevationM: 0, layerIndex: 1, depthSource: "modeled" as const }], flatWater: [], cellPitchMm: 1 };
    const refuse = vi.spyOn(polygonClipping, "intersection").mockImplementation(() => { throw new Error("degenerate ring"); });
    const warnings: GeometryWarning[] = [];
    try {
      expect(paintRegions(base, [{ layer, covering: preparePolygons([]) }], sources, [], warnings)).toEqual([]);
    } finally {
      refuse.mockRestore();
    }
    expect(warnings).toEqual([{ code: "PAINT_WINDOWS_OMITTED", message: expect.stringContaining("layer 2 could not be cut") }]);
  });

  it("survives a degenerate piece and drops windows thinner than the minimum feature", () => {
    const degenerate: LayerIR = { id: "layer-01", index: 0, elevationM: 0, materialThicknessMm: 3, polygons: [{ outer: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], holes: [] }], markings: [], pieces: [] };
    const sources = { waterSurfaces: [{ id: "lake", kind: "lake" as const, polygons: [{ outer: circleRing(0, 0, 30), holes: [] }], surfaceElevationM: 0, bedElevationM: 0, layerIndex: 0, depthSource: "modeled" as const }], flatWater: [], cellPitchMm: 1 };
    expect(() => paintRegions(base, [{ layer: degenerate, covering: preparePolygons([]) }], sources)).not.toThrow();

    const layer: LayerIR = { id: "layer-01", index: 0, elevationM: 0, materialThicknessMm: 3, polygons: [{ outer: square(-50, -50, 50, 50), holes: [] }], markings: [], pieces: [] };
    const strip = { ...sources, waterSurfaces: [{ ...sources.waterSurfaces[0]!, polygons: [{ outer: square(-20, -0.05, 20, 0.05), holes: [] }] }] };
    expect(paintRegions({ ...base, minimumFeatureMm: 0.5 }, [{ layer, covering: preparePolygons([]) }], strip)).toEqual([]);
  });

  it("paints every basin step of a carved lake and leaves islands above the surface dry", () => {
    const [project, scaled] = scaledForLayers(base, flatLake(base), 8);
    const result = generateGeometry(project, { ...scaled, waterAreas: [lakeArea()] });
    const surface = result.waterSurfaces[0]!;
    const regions = result.paintRegions ?? [];
    expect(regions.length).toBeGreaterThan(1);
    expect(regions.every((region) => region.layerIndex <= surface.layerIndex)).toBe(true);
    // Layers above the waterline get no window, even where they sit inside the outline.
    expect(regions.some((region) => region.layerIndex > surface.layerIndex)).toBe(false);
    const cellPitchMm = project.widthMm / (scaled.elevation.width - 1);
    let bled = false;
    for (const region of regions) {
      const piece = result.layers[region.layerIndex]!.polygons[region.polygonIndex]!;
      const above = result.layers.filter((layer) => layer.index > region.layerIndex).flatMap((layer) => layer.polygons);
      const covering = preparePolygons(above);
      // The surface layer keeps the exact outline; bed layers own the contoured rim one cell past it.
      const reach = LAKE_RADIUS_MM + (region.layerIndex < surface.layerIndex ? cellPitchMm : 0) + 0.05;
      for (const point of vertices(region.polygons)) {
        expect(insideOrOn(point, piece)).toBe(true);
        const inLake = Math.hypot(point.x, point.y) <= reach;
        const covered = pointInPreparedPolygons(point, covering) || above.some((polygon) => insideOrOn(point, polygon));
        // Never dry exposed material: either water, or hidden by the layer above.
        expect(inLake || covered).toBe(true);
        if (covered && Math.hypot(point.x, point.y) < LAKE_RADIUS_MM - PAINT_BLEED_MM - 0.5) bled = true;
      }
    }
    expect(bled).toBe(true);
  });

  it("paints a flat lake on the layer holding its level when water depth is off", () => {
    const project: ProjectConfigV1 = { ...base, showWaterDepth: false, showWater: true };
    const [scaledProject, scaled] = scaledForLayers(project, flatLake(project), 8);
    const result = generateGeometry(scaledProject, { ...scaled, waterAreas: [lakeArea()] });
    expect(result.waterSurfaces).toEqual([]);
    const regions = result.paintRegions ?? [];
    expect(regions).toHaveLength(1);
    const region = regions[0]!;
    // The lake sits at 1500 m, the layer whose base is at or below that.
    expect(result.layers[region.layerIndex]!.elevationM).toBeLessThanOrEqual(1500);
    expect(result.layers[region.layerIndex + 1]!.elevationM).toBeGreaterThan(1500);
    const above = result.layers.filter((layer) => layer.index > region.layerIndex).flatMap((layer) => layer.polygons);
    for (const point of vertices(region.polygons)) expect(Math.hypot(point.x, point.y) <= LAKE_RADIUS_MM + 0.05 || above.some((polygon) => insideOrOn(point, polygon))).toBe(true);

    // Without depth or outlines the same project has nothing to window.
    expect(generateGeometry(scaledProject, scaled).paintRegions).toEqual([]);
  });

  it("keys windows to the split piece they belong to", () => {
    const project: ProjectConfigV1 = { ...base, workAreaWidthMm: 160, workAreaHeightMm: 120 };
    const [scaledProject, scaled] = scaledForLayers(project, flatLake(project), 8);
    const result = generateGeometry(scaledProject, { ...scaled, waterAreas: [lakeArea()] });
    expect(result.splitPlan).toBeDefined();
    const regions = result.paintRegions ?? [];
    expect(regions.length).toBeGreaterThan(1);
    for (const region of regions) {
      const layer = result.layers[region.layerIndex]!;
      const piece = layer.polygons[region.polygonIndex];
      expect(piece).toBeDefined();
      expect(layer.pieces[region.polygonIndex]?.polygonIndex).toBe(region.polygonIndex);
      for (const point of vertices(region.polygons)) expect(insideOrOn(point, piece!)).toBe(true);
    }
  });

  it("validates the kind list", () => {
    expect(() => validateProject({ ...DEFAULT_PROJECT, paintTemplates: ["water", "water"] })).toThrow(/Paint templates/);
    expect(() => validateProject({ ...DEFAULT_PROJECT, paintTemplates: ["lava" as "water"] })).toThrow(/Paint templates/);
    expect(() => validateProject({ ...DEFAULT_PROJECT, paintTemplates: "water" as unknown as ["water"] })).toThrow(/Paint templates/);
    expect(() => validateProject({ ...DEFAULT_PROJECT, paintTemplates: ["water"] })).not.toThrow();
  });

  it("needs the vector water layer when a water stencil is the only reason", () => {
    const bare: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false, showWaterDepth: false, showRoads: false, showTrails: false, showBoundaries: false };
    expect(sourceRequirements(bare)).toEqual({ vectors: false, lakes: false, water: false });
    expect(sourceRequirements({ ...bare, paintTemplates: ["water"] })).toEqual({ vectors: true, lakes: false, water: true });
    expect(sourceRequirements({ ...bare, paintTemplates: ["water"], outputMode: "engraving" }).water).toBe(false);
  });
});

describe("paint template export", () => {
  it("tells the assembly guide which templates exist and which layers they paint", async () => {
    const [project, scaled] = scaledForLayers(base, flatLake(base), 8);
    const result = generateGeometry(project, { ...scaled, waterAreas: [lakeArea()] });
    const output = buildFabricationPackage(result, project);
    const paintFiles = output.files.filter((file) => file.filename.endsWith("-paint-water.svg"));
    expect(paintFiles.length).toBeGreaterThan(0);
    const html = await output.files.find((file) => file.filename.endsWith("-assembly-guide.html"))!.blob.text();
    expect(html).toContain('<p class="label">Section 2</p>\n<h2>Paint before you glue</h2>');
    expect(html).toContain("kerf compensation turned off");
    expect(html).toContain('<p class="label">Section 3</p>\n<h2>Build the stack</h2>');
    expect(html).toContain("If the step says to paint, do that first");
    expect(html).toContain(`Paper or stencil film for ${paintFiles.length === 1 ? "1 paint template" : `${paintFiles.length} paint templates`}`);
    for (const file of paintFiles) expect(html).toContain(`<code>${file.filename}</code>`);
    // Each painted layer's step names its own template; dry layers' steps say nothing.
    const paintedLayers = new Set((result.paintRegions ?? []).map((region) => region.layerIndex));
    result.layers.forEach((layer, index) => {
      const step = html.slice(html.indexOf(`id="step-${index + 1}"`));
      expect(step.slice(0, step.indexOf("</article>")).includes("Paint the water first")).toBe(paintedLayers.has(layer.index));
    });
  });

  it("writes a registered template beside each panel with visible water and leaves dry panels alone", async () => {
    const [project, scaled] = scaledForLayers(base, flatLake(base), 8);
    const result = generateGeometry(project, { ...scaled, waterAreas: [lakeArea()] });
    const output = buildFabricationPackage(result, project);
    const paintFiles = output.files.filter((file) => file.filename.endsWith("-paint-water.svg"));
    const regionLayers = new Set((result.paintRegions ?? []).map((region) => region.layerIndex));
    expect(paintFiles).toHaveLength(regionLayers.size);
    expect(paintFiles.length).toBeLessThan(result.layers.length);

    const template = paintFiles[0]!;
    const panel = output.files.find((file) => file.filename === template.filename.replace(/-paint-water\.svg$/, ".svg"))!;
    const [templateSvg, panelSvg] = await Promise.all([template.blob.text(), panel.blob.text()]);
    // Same canvas as the panel, so the paper registers to the cut piece.
    expect(templateSvg.match(/viewBox="[^"]+"/)?.[0]).toBe(panelSvg.match(/viewBox="[^"]+"/)?.[0]);
    expect(templateSvg).toContain('data-role="stencil"');
    expect(templateSvg).not.toContain('data-role="window"');
    expect(templateSvg).toContain('data-operation="CUT"');
    expect(templateSvg).not.toContain('data-operation="ENGRAVE"');
    expect(templateSvg).toContain("water paint template");

    const manifest = JSON.parse(await output.files.find((file) => file.filename.endsWith("project.json"))!.blob.text());
    expect(manifest.result.fabrication.paintTemplates).toEqual({ kinds: ["water"], bleedMm: PAINT_BLEED_MM, fileCount: paintFiles.length });
    const withTemplate = manifest.result.fabrication.panels.find((entry: { filename: string }) => entry.filename === panel.filename);
    expect(withTemplate.paintTemplateFilenames).toEqual([template.filename]);
    expect(manifest.result.fabrication.panels.some((entry: { paintTemplateFilenames: string[] }) => entry.paintTemplateFilenames.length === 0)).toBe(true);
    const readme = await output.files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(readme).toContain("Paint templates:");
    expect(readme).toContain("kerf compensation turned off");
  });

  it("changes nothing when no kind is requested, and tolerates IR recorded before paint regions existed", async () => {
    const [project, scaled] = scaledForLayers(base, flatLake(base), 8);
    const source = { ...scaled, waterAreas: [lakeArea()] };
    const off = { ...project, paintTemplates: [] as ProjectConfigV1["paintTemplates"] };
    const result = generateGeometry(off, source);
    expect(result.paintRegions).toEqual([]);
    const output = buildFabricationPackage(result, off);
    expect(output.files.some((file) => file.filename.includes("-paint-"))).toBe(false);
    const readme = await output.files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(readme).not.toContain("Paint templates");
    const manifest = JSON.parse(await output.files.find((file) => file.filename.endsWith("project.json"))!.blob.text());
    expect(manifest.result.fabrication.paintTemplates).toBeUndefined();

    const { paintRegions: _dropped, ...legacy } = generateGeometry(project, source);
    const legacyOutput = buildFabricationPackage(legacy as GeometryIRV1, project);
    expect(legacyOutput.files.some((file) => file.filename.includes("-paint-"))).toBe(false);
    const legacyReadme = await legacyOutput.files.find((file) => file.filename === "README.txt")!.blob.text();
    expect(legacyReadme).toContain("no panel has visible water");
  });
});
