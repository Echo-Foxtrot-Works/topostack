import { createSyntheticSource, DEFAULT_PROJECT, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1 } from "../index.js";
import { EARTH_RADIUS_M } from "../primitives/units.js";

export function realSource(project = DEFAULT_PROJECT) {
  return { ...createSyntheticSource(project, 48), sourceKind: "real" as const, imagerySources: ["srtm/N46W122.tif"] };
}

export function pointInRing(point: { x: number; y: number }, ring: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    if (a && b && (a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

export function gridSource(project: ProjectConfigV1, size: number, elevationAt: (nx: number, ny: number) => number): SourceBundleV1 {
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

/** Closed CCW ring approximating a circle in mm space. */
export function circleRing(centerX: number, centerY: number, radiusMm: number, segments = 96) {
  const points = Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: centerX + Math.cos(angle) * radiusMm, y: centerY + Math.sin(angle) * radiusMm };
  });
  return [...points, { ...points[0]! }];
}

export function lakeArea(overrides: Partial<WaterAreaV1> = {}): WaterAreaV1 {
  return {
    id: "lake-1",
    kind: "lake",
    polygon: { outer: circleRing(0, 0, 40), holes: [] },
    maxDepthM: 300,
    ...overrides,
  };
}


/**
 * Layer count is derived from map scale, so a test that needs an exact count
 * states it by widening the mapped window until the relief resolves into that
 * many sheets of material. Returns the project and source sharing those bounds.
 */
export function scaledForLayers(project: ProjectConfigV1, source: SourceBundleV1, layerCount: number): [ProjectConfigV1, SourceBundleV1] {
  const relief = source.elevation.max - source.elevation.min;
  const groundWidthM = (relief * project.widthMm * project.verticalExaggeration) / (layerCount * project.materialThicknessMm);
  const halfSpan = groundWidthM / (2 * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(project.location.lat * (Math.PI / 180)));
  const bounds = {
    west: project.location.lon - halfSpan,
    south: project.location.lat - halfSpan * 0.7,
    east: project.location.lon + halfSpan,
    north: project.location.lat + halfSpan * 0.7,
  };
  return [{ ...project, location: { ...project.location, bounds } }, { ...source, bounds }];
}

/** Bounds spanning an exact ground width, so scale-driven expectations stay readable. */
export function groundBounds(project: ProjectConfigV1, groundWidthM: number) {
  const halfSpan = groundWidthM / (2 * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(project.location.lat * (Math.PI / 180)));
  return {
    west: project.location.lon - halfSpan,
    south: project.location.lat - halfSpan * 0.7,
    east: project.location.lon + halfSpan,
    north: project.location.lat + halfSpan * 0.7,
  };
}

export function parsePathPoints(pathData: string): Array<{ x: number; y: number }> {
  return [...pathData.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}
