import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT } from "../types.js";
import { boundsAround, boundsForProject, coverBounds, fitCutBounds, isMercatorBounds, latToWorldY, MERCATOR_MAX_LATITUDE, worldYToLat, zoomForBounds } from "./bounds.js";

const mercatorAspect = (bounds: { west: number; east: number; south: number; north: number }) =>
  ((bounds.east - bounds.west) * Math.PI / 180) / (Math.asinh(Math.tan(bounds.north * Math.PI / 180)) - Math.asinh(Math.tan(bounds.south * Math.PI / 180)));

describe("project bounds", () => {
  it("round-trips latitude through world pixels", () => {
    for (const lat of [-80, -12.5, 0, 46.85, 85]) expect(worldYToLat(latToWorldY(lat, 10), 10)).toBeCloseTo(lat, 9);
  });

  it("centers a ground width on a point at the cut's proportions", () => {
    const bounds = boundsAround({ lat: 60, lon: 10 }, 50, 300, 150);
    expect(mercatorAspect(bounds)).toBeCloseTo(2, 9);
    expect((bounds.west + bounds.east) / 2).toBeCloseTo(10, 9);
    // At 60° a degree of longitude is half as long, so 50 km spans about 0.9°.
    expect(bounds.east - bounds.west).toBeCloseTo(50 / (6371.0088 * Math.PI / 180 * 0.5), 6);
  });

  it("covers a box that fitting would crop, and fitting leaves covered bounds alone", () => {
    const tall = { west: 8, south: 46, east: 8.02, north: 47 };
    const covered = coverBounds(tall, 300, 200);
    expect(covered.south).toBeCloseTo(tall.south, 9);
    expect(covered.north).toBeCloseTo(tall.north, 9);
    expect(covered.east - covered.west).toBeGreaterThan(tall.east - tall.west);
    expect(fitCutBounds(covered, 300, 200)).toBe(covered);
  });

  it("inscribes the cut in a selection of the wrong proportions, centered", () => {
    const wide = { west: 8, south: 46, east: 10, north: 46.5 };
    const fitted = fitCutBounds(wide, 300, 200);
    expect(mercatorAspect(fitted)).toBeCloseTo(1.5, 9);
    expect(fitted.south).toBeCloseTo(wide.south, 9);
    expect(fitted.north).toBeCloseTo(wide.north, 9);
    expect((fitted.west + fitted.east) / 2).toBeCloseTo(9, 9);
    expect(fitted.east - fitted.west).toBeLessThan(wide.east - wide.west);

    const tall = { west: 8, south: 46, east: 8.5, north: 48 };
    const narrowed = fitCutBounds(tall, 300, 200);
    expect(mercatorAspect(narrowed)).toBeCloseTo(1.5, 9);
    expect(narrowed.west).toBeCloseTo(tall.west, 9);
    expect(narrowed.east).toBeCloseTo(tall.east, 9);
    expect(narrowed.south).toBeGreaterThan(tall.south);
    expect(narrowed.north).toBeLessThan(tall.north);
  });

  it("fits a project's stored bounds, or frames a default window around its point", () => {
    const stored = { west: 8, south: 46, east: 10, north: 46.5 };
    expect(boundsForProject({ ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, bounds: stored } })).toEqual(fitCutBounds(stored, 300, 200));

    const framed = boundsForProject(DEFAULT_PROJECT);
    expect(mercatorAspect(framed)).toBeCloseTo(1.5, 9);
    expect((framed.west + framed.east) / 2).toBeCloseTo(DEFAULT_PROJECT.location.lon, 9);
    expect(framed.south).toBeLessThan(DEFAULT_PROJECT.location.lat);
    expect(framed.north).toBeGreaterThan(DEFAULT_PROJECT.location.lat);
    // One zoom level out frames twice the longitude.
    const outer = boundsForProject({ ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, zoom: 10 } });
    expect((outer.east - outer.west) / (framed.east - framed.west)).toBeCloseTo(2, 9);
  });

  it("keeps a default window near the pole, or at an extreme zoom, inside the map", () => {
    // The window slides down to stop where the tiles end.
    const polar = boundsForProject({ ...DEFAULT_PROJECT, location: { lat: 89, lon: 0, label: "Pole", zoom: 11 } });
    expect(polar.north).toBe(MERCATOR_MAX_LATITUDE);
    expect(polar.south).toBeLessThan(polar.north);
    const world = boundsForProject({ ...DEFAULT_PROJECT, location: { lat: 0, lon: 0, label: "World", zoom: -4 } });
    expect(isMercatorBounds(world)).toBe(true);
    expect(world.east - world.west).toBeLessThanOrEqual(360);
    expect(boundsForProject({ ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, zoom: 40 } })).toEqual(boundsForProject({ ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, zoom: 15 } }));
  });

  // The world's top row is 85.05112878°, but the tiles, and isMercatorBounds, stop at 85.0511°.
  it("frames a polar point-only project inside bounds the tiles can serve", () => {
    for (const lat of [89, 85.0511, -85.0511, -89]) for (const zoom of [0, 1, 11, 15]) for (const [widthMm, heightMm] of [[300, 200], [200, 300], [250, 250]] as const) {
      const bounds = boundsForProject({ ...DEFAULT_PROJECT, widthMm, heightMm, location: { lat, lon: 0, label: "Pole", zoom } });
      expect(isMercatorBounds(bounds)).toBe(true);
      expect(mercatorAspect(bounds)).toBeCloseTo(widthMm / heightMm, 9);
    }
  });

  it("recognises bounds the tiles can serve", () => {
    expect(isMercatorBounds({ west: -10, south: -10, east: 10, north: 10 })).toBe(true);
    // Across the antimeridian, east is unwrapped past 180°.
    expect(isMercatorBounds({ west: 170, south: 0, east: 190, north: 1 })).toBe(true);
    expect(isMercatorBounds({ west: -190, south: 0, east: -170, north: 1 })).toBe(true);
    expect(isMercatorBounds({ west: -180, south: 0, east: 180.5, north: 1 })).toBe(false);
    expect(isMercatorBounds({ west: 0, south: 80, east: 1, north: 86 })).toBe(false);
    expect(isMercatorBounds({ west: 1, south: 0, east: 0, north: 1 })).toBe(false);
  });

  it("frames bounds at the zoom a map camera would", () => {
    expect(zoomForBounds({ west: 0, south: 0, east: 0.3, north: 0.2 })).toBe(10);
    expect(zoomForBounds({ west: -180, south: -80, east: 180, north: 80 })).toBe(3);
    expect(zoomForBounds({ west: 0, south: 0, east: 0.0001, north: 0.0001 })).toBe(14);
  });
});
