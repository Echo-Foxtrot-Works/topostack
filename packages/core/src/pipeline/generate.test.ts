import { describe, expect, it } from "vitest";
import { buildFabricationPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, labelDimensions, layerToSvg, validateProject, type ProjectConfigV1 } from "../index.js";
import { geoPointToMapPoint, longitudeInBounds } from "../annotate/markers.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { gridSource, parsePathPoints, pointInRing, realSource, scaledForLayers } from "../test-support/sources.js";

describe("geometry generation", () => {
  it("does not invent road or water markings in sample terrain", () => {
    expect(createSyntheticSource(DEFAULT_PROJECT, 48).markings).toEqual([]);
  });

  it("projects user markers into engraving paths and validates their coordinates and symbols", () => {
    const markers = [
      { id: "summit", lat: DEFAULT_PROJECT.location.lat, lon: DEFAULT_PROJECT.location.lon, symbol: "pin" as const },
      { id: "camp", lat: DEFAULT_PROJECT.location.lat + 0.001, lon: DEFAULT_PROJECT.location.lon + 0.001, symbol: "star" as const },
      { id: "crossing", lat: DEFAULT_PROJECT.location.lat - 0.001, lon: DEFAULT_PROJECT.location.lon - 0.001, symbol: "cross" as const },
    ];
    const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, markers };
    const result = generateGeometry(project, realSource(project));
    const rendered = result.layers.flatMap((layer) => layer.markings).filter((marking) => marking.kind === "marker");
    expect(rendered.length).toBeGreaterThanOrEqual(3);
    expect(rendered.every((marking) => marking.operation === "engrave" && marking.points.length > 1)).toBe(true);
    expect(rendered.every((marking) => marking.filled)).toBe(true);
    const halos = rendered.filter((marking) => marking.knockout);
    const foregroundPin = rendered.find((marking) => marking.id.startsWith("map-marker-0-") && !marking.knockout);
    const foregroundCross = rendered.filter((marking) => marking.id.startsWith("map-marker-2-") && !marking.knockout);
    const pinAnchor = geoPointToMapPoint(markers[0]!.lat, markers[0]!.lon, realSource(project).bounds, project.widthMm, project.heightMm);
    expect(halos.length).toBeGreaterThanOrEqual(markers.length);
    expect(foregroundPin?.points.some(point => Math.abs(point.x - pinAnchor.x) < 1e-6 && Math.abs(point.y - pinAnchor.y) < 1e-6)).toBe(true);
    // The two bars are merged into one 12-sided outline, filled and cleared once.
    expect(foregroundCross).toHaveLength(1);
    expect(foregroundCross[0]!.points).toHaveLength(13);
    // The pin's eye is engraved as a hole in its head.
    expect(foregroundPin?.holes).toHaveLength(1);
    const svg = engravingToSvg(result, project);
    expect(svg).toMatch(/id="map-marker-[^"]+"[^>]+fill="#2366FF"/);
    expect(svg).not.toContain('fill="#ffffff"');
    expect(svg).toMatch(/id="map-marker-[^"]+"[^>]+fill="#2366FF" stroke="none"/);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [{ ...markers[0]!, lat: 90 }] })).toThrow(/marker latitude/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [{ ...markers[0]!, symbol: "flag" as never }] })).toThrow(/marker symbol/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, markers: [markers[0]!, { ...markers[1]!, id: markers[0]!.id }] })).toThrow(/unique/i);
  });

  it("projects and validates features across the antimeridian", () => {
    const bounds = { west: 179.8, south: -1, east: 180.2, north: 1 };
    expect(longitudeInBounds(179.9, bounds)).toBe(true);
    expect(longitudeInBounds(-179.9, bounds)).toBe(true);
    expect(longitudeInBounds(-179, bounds)).toBe(false);
    expect(geoPointToMapPoint(0, 179.9, bounds, 100, 100).x).toBeCloseTo(-25);
    expect(geoPointToMapPoint(0, -179.9, bounds, 100, 100).x).toBeCloseTo(25);
    expect(() => validateProject({
      ...DEFAULT_PROJECT,
      location: { ...DEFAULT_PROJECT.location, lat: 0, lon: 180, zoom: 11, bounds },
    })).not.toThrow();
    expect(() => validateProject({
      ...DEFAULT_PROJECT,
      location: { ...DEFAULT_PROJECT.location, lat: 0, lon: 0, zoom: 1, bounds: { west: -181, south: -1, east: 181, north: 1 } },
    })).toThrow(/longitude span/i);
  });

  it("projects custom trails and boundaries independently of built-in map-detail toggles", () => {
    const center = DEFAULT_PROJECT.location;
    const customLines = [
      { id: "approach", kind: "trail" as const, points: [{ lat: center.lat, lon: center.lon - 0.004 }, { lat: center.lat, lon: center.lon + 0.004 }] },
      { id: "district", kind: "boundary" as const, points: [{ lat: center.lat - 0.003, lon: center.lon }, { lat: center.lat + 0.003, lon: center.lon }] },
    ];
    const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, showTrails: false, showBoundaries: false, customLines };
    const result = generateGeometry(project, realSource(project));
    const rendered = result.layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("custom-data-line-"));
    expect(rendered.some((marking) => marking.kind === "trail" && marking.transportationClass === "trail")).toBe(true);
    expect(rendered.some((marking) => marking.kind === "boundary")).toBe(true);
    expect(engravingToSvg(result, project)).toContain("custom-data-line-");
    expect(() => validateProject({ ...DEFAULT_PROJECT, customLines: [{ ...customLines[0]!, points: [customLines[0]!.points[0]!] }] })).toThrow(/at least two points/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, customLines: [{ ...customLines[0]!, kind: "river" as never }] })).toThrow(/trail or boundary/i);
    expect(() => validateProject({ ...DEFAULT_PROJECT, customLines: [{ ...customLines[0]!, points: [{ lat: 90, lon: 0 }, customLines[0]!.points[1]!] }] })).toThrow(/latitude/i);
  });

  it("renders optional state and province boundaries as a dedicated dashed engraving layer", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving", showBoundaries: true, lineStyle: { ...DEFAULT_PROJECT.lineStyle, boundaryMm: 0.27 } };
    const source = realSource(project);
    source.markings = [{ id: "region-line", kind: "boundary", operation: "engrave", points: [{ x: -140, y: -15 }, { x: 140, y: 25 }] }];
    const result = generateGeometry(project, source);
    const boundaries = result.layers.flatMap((layer) => layer.markings).filter((marking) => marking.kind === "boundary");
    const svg = engravingToSvg(result, project);

    expect(boundaries).toHaveLength(1);
    expect(svg).toMatch(/id="ENGRAVE-boundaries" stroke-width="0\.27" stroke-dasharray="[^"]+"/);
    expect(generateGeometry({ ...project, showBoundaries: false }, source).layers.flatMap((layer) => layer.markings).some((marking) => marking.kind === "boundary")).toBe(false);
  });

  it("records unavailable requested vector data as a geometry warning", () => {
    const source = realSource();
    source.vectorStatus = "unavailable";
    source.lakeDataStatus = "unavailable";
    const result = generateGeometry(DEFAULT_PROJECT, source);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "VECTOR_DATA_UNAVAILABLE" }), expect.objectContaining({ code: "LAKE_DATA_UNAVAILABLE" })]));
    expect(() => buildFabricationPackage(result, DEFAULT_PROJECT)).toThrow(/map detail data is unavailable/i);
    result.vectorStatus = "available";
    expect(() => buildFabricationPackage(result, DEFAULT_PROJECT)).toThrow(/lake depth data is unavailable/i);
  });

  it("clips markings to circular layer material", () => {
    const project = { ...DEFAULT_PROJECT, cropShape: "circle" as const, widthMm: 200, heightMm: 200 };
    const source = realSource(project);
    source.markings = [{ id: "crossing", kind: "road", operation: "engrave", points: [{ x: -160, y: 0 }, { x: 160, y: 0 }] }];
    const result = generateGeometry(project, source);
    const crossing = result.layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("crossing"));
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.flatMap((marking) => marking.points).every((point) => Math.hypot(point.x, point.y) <= 100.001)).toBe(true);
  });

  it("keeps marking ids unique when one feature re-enters an elevation layer", () => {
    const source = realSource();
    source.markings = [{ id: "switchback", kind: "road", operation: "engrave", points: [{ x: -140, y: -80 }, { x: 0, y: 0 }, { x: 140, y: -80 }, { x: 0, y: 0 }, { x: -140, y: -80 }] }];
    const result = generateGeometry(DEFAULT_PROJECT, source);
    const ids = result.layers.flatMap((layer) => layer.markings).map((marking) => marking.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("engraves the next layer footprint on every lower layer by default", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    result.layers.slice(0, -1).forEach((layer, index) => {
      const nextLayer = result.layers[index + 1]!;
      const outlines = layer.markings.filter((marking) => marking.id.startsWith(`alignment-layer-${String(index + 1).padStart(2, "0")}-to-`) && marking.id.includes("-outline-"));
      if (nextLayer.polygons.length) expect(outlines.length).toBeGreaterThan(0);
      expect(outlines.every((marking) => marking.operation === "engrave" && marking.kind === "guide")).toBe(true);
      expect(outlines.flatMap((marking) => marking.points).every((point) => nextLayer.polygons.some((polygon) => pointInRing(point, polygon.outer)))).toBe(true);
    });
    expect(result.layers.at(-1)?.markings.some((marking) => marking.id.startsWith("alignment-layer-"))).toBe(false);
    expect(layerToSvg(result, result.layers[0]!)).toContain('id="alignment-layer-01-to-02-');
  });

  it("keeps alignment labels entirely under the next layer", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const labels = result.layers.flatMap((layer, index) => layer.markings
      .filter((marking) => marking.id.startsWith("alignment-layer-") && marking.id.endsWith("-label"))
      .map((marking) => ({ marking, donorLayer: layer, nextLayer: result.layers[index + 1] })));
    expect(labels.length).toBeGreaterThan(0);
    for (const { marking, donorLayer, nextLayer } of labels) {
      expect(marking.label).toMatch(/^L\d{2}$/);
      const origin = marking.points[0]!;
      const dimensions = labelDimensions(marking.label ?? "");
      const corners = [origin, { x: origin.x + dimensions.width, y: origin.y }, { x: origin.x, y: origin.y + dimensions.height }, { x: origin.x + dimensions.width, y: origin.y + dimensions.height }];
      expect(corners.every((point) => nextLayer?.polygons.some((polygon) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))))).toBe(true);
      expect(corners.every((point) => donorLayer.polygons.some((polygon) => pointInRing(point, polygon.outer) && !polygon.holes.some((hole) => pointInRing(point, hole))))).toBe(true);
    }
  });

  it("removes all assembly registration marks when disabled", () => {
    const project = { ...DEFAULT_PROJECT, showAlignmentGuides: false };
    const result = generateGeometry(project, realSource(project));
    expect(result.layers.some((layer) => layer.markings.some((marking) => marking.id.startsWith("alignment-layer-")))).toBe(false);
  });

  it("offsets external cuts outward and internal cuts inward for kerf", () => {
    const result = generateGeometry(DEFAULT_PROJECT, realSource());
    const nest = result.fabricationNests[0]!;
    const donor = result.layers[nest.donorLayerIndex]!;
    const cavity = nest.cavities[0]!;
    const polygon = donor.polygons[cavity.donorPolygonIndex]!;
    const hole = polygon.holes[cavity.donorHoleIndex]!;
    const svg = layerToSvg(result, donor);
    const holePath = svg.match(new RegExp(`id="${donor.id}-cut-${cavity.donorPolygonIndex + 1}-hole-${cavity.donorHoleIndex + 1}-offset-1" d="([^"]+)"`))?.[1];
    expect(holePath).toBeTruthy();
    const holePoints = parsePathPoints(holePath!);
    expect(holePoints.length).toBeGreaterThan(3);
    expect(holePoints.every((point) => pointInRing(point, hole))).toBe(true);
    const outerPath = svg.match(new RegExp(`id="${donor.id}-cut-${cavity.donorPolygonIndex + 1}-offset-1" d="([^"]+)"`))?.[1];
    expect(outerPath).toBeTruthy();
    const outerPoints = parsePathPoints(outerPath!);
    expect(outerPoints.length).toBeGreaterThan(3);
    expect(outerPoints.every((point) => !pointInRing(point, polygon.outer))).toBe(true);
  });

  it("warns about empty layers and blocks their fabrication export", () => {
    const base = { ...DEFAULT_PROJECT, minimumFeatureMm: 5, optimizeMaterialUse: false };
    // Gradient terrain plus one single-cell spike: the top layer's only region
    // is smaller than the minimum feature size, so it is culled to empty.
    const [project, source] = scaledForLayers(base, gridSource(base, 48, (nx, ny) => (nx > 0.01 && nx < 0.04 && ny > 0.01 && ny < 0.04 ? 100 : 30 * (nx + 1))), 4);
    const result = generateGeometry(project, source);
    expect(result.warnings.some((warning) => warning.code === "EMPTY_LAYER")).toBe(true);
    expect(result.layers.some((layer) => layer.polygons.length === 0)).toBe(true);
    expect(() => buildFabricationPackage(result, project)).toThrow(/empty/i);
  });
});
