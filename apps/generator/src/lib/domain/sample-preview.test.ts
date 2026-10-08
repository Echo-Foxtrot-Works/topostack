import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, layerToSvg } from "@topostack/core";
import { boundsForProject } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";

// Full bundled geometry includes contouring and label placement; coverage on
// shared CI runners can exceed Vitest's default five-second test timeout.
const GEOMETRY_TEST_TIMEOUT_MS = 20_000;

describe("Crater Lake bundled preview", () => {
  it("contains real elevation, classified transportation, and water data for the default crop", () => {
    const source = createSamplePreviewSource();
    const expectedBounds = boundsForProject(DEFAULT_PROJECT);
    expect(source.sourceKind).toBe("preview");
    expect(source.elevation.values).toHaveLength(66 * 44);
    expect(source.elevation.max - source.elevation.min).toBeGreaterThan(1_000);
    expect(source.markings.some((marking) => marking.kind === "road")).toBe(true);
    expect(source.markings.some((marking) => marking.kind === "trail")).toBe(true);
    expect(new Set(source.markings.map((marking) => marking.transportationClass).filter(Boolean))).toEqual(new Set(["major-road", "local-road", "trail"]));
    expect(source.markings.some((marking) => marking.kind === "road" && marking.label)).toBe(true);
    expect(source.markings.some((marking) => marking.kind === "water")).toBe(true);
    expect(source.bounds.west).toBeCloseTo(expectedBounds.west, 8);
    expect(source.bounds.north).toBeCloseTo(expectedBounds.north, 8);
    expect(source.attribution.some((item) => item.name === "OpenStreetMap contributors")).toBe(true);
  });

  it("produces visible fabrication markings for every default map detail", { timeout: GEOMETRY_TEST_TIMEOUT_MS }, () => {
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    const markings = geometry.layers.flatMap((layer) => layer.markings);
    expect(markings.some((marking) => marking.kind === "road")).toBe(true);
    expect(markings.some((marking) => marking.kind === "trail")).toBe(true);
    expect(markings.some((marking) => marking.kind === "water")).toBe(true);
    expect(markings.some((marking) => marking.id.startsWith("alignment-"))).toBe(true);
    expect(markings.filter((marking) => marking.id.startsWith("elevation-")).length).toBeGreaterThanOrEqual(Math.ceil(geometry.layers.length / 2));
    expect(markings.some((marking) => marking.id.startsWith("north-"))).toBe(true);
    expect(markings.some((marking) => marking.id.startsWith("scale-"))).toBe(true);
  });

  it("contains a closed shoreline without vector-tile closure edges", () => {
    const shoreline = createSamplePreviewSource().markings.find((marking) => marking.kind === "water")!;
    expect(shoreline.id).toContain("water-area");
    expect(shoreline.points[0]).toEqual(shoreline.points.at(-1));
    const suspiciousClosures = shoreline.points.slice(0, -1).filter((point, index) => {
      const next = shoreline.points[index + 1]!;
      return (point.x === next.x || point.y === next.y) && Math.hypot(next.x - point.x, next.y - point.y) > 10;
    });
    expect(suspiciousClosures).toEqual([]);
  });

  it.each([false, true])("shows named roads on narrow terrain terraces with coordinate grid %s", { timeout: GEOMETRY_TEST_TIMEOUT_MS }, (showCoordinateGrid) => {
    const geometry = generateGeometry({ ...DEFAULT_PROJECT, verticalExaggeration: 4, showTransportationLabels: true, showCoordinateGrid }, createSamplePreviewSource());
    const labels = geometry.layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("transport-label-"));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((marking) => marking.operation === "engrave" && marking.label)).toBe(true);
    const layer = geometry.layers.find(layer => layer.markings.some(marking => marking.id.startsWith("transport-label-")))!;
    expect(layerToSvg(geometry, layer)).toContain(`id="${layer.id}-ENGRAVE-transport-labels"`);
  });
});
