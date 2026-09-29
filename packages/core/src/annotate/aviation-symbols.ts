import type { AviationSymbol, Point2D } from "../types.js";

/**
 * Line-drawn aviation symbols after the VFR sectional legend, simplified for a
 * single engraving colour: every symbol is open or closed polylines around its
 * center, `sizeMm` across. Closed rings repeat their first point.
 */

const OBSTACLE_SCALE = 0.7;

function ring(center: Point2D, radius: number, sides: number, rotation = 0): Point2D[] {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
  return [...points, { ...points[0]! }];
}

const circle = (center: Point2D, radius: number) => ring(center, radius, 24);

/** A tiny closed square: one engraved dot that survives any laser's minimum segment. */
function dot(center: Point2D, radius: number): Point2D[] {
  return ring(center, radius, 4, Math.PI / 4);
}

function hexagon(center: Point2D, radius: number): Point2D[] {
  return ring(center, radius, 6);
}

/** Ticks radiating from a circle at the four compass points (a sectional's "services available" airport). */
function ticks(center: Point2D, inner: number, outer: number, count = 4, rotation = 0): Point2D[][] {
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + (index / count) * Math.PI * 2;
    return [
      { x: center.x + Math.cos(angle) * inner, y: center.y + Math.sin(angle) * inner },
      { x: center.x + Math.cos(angle) * outer, y: center.y + Math.sin(angle) * outer },
    ];
  });
}

/** The three solid tabs of a VORTAC/TACAN, on alternate hexagon sides. */
function tabs(center: Point2D, radius: number): Point2D[][] {
  return [0, 2, 4].map((side) => {
    const a0 = (side / 6) * Math.PI * 2;
    const a1 = ((side + 1) / 6) * Math.PI * 2;
    const inner0 = { x: center.x + Math.cos(a0) * radius, y: center.y + Math.sin(a0) * radius };
    const inner1 = { x: center.x + Math.cos(a1) * radius, y: center.y + Math.sin(a1) * radius };
    const normal = (a0 + a1) / 2;
    const depth = radius * 0.45;
    const outer0 = { x: inner0.x + Math.cos(normal) * depth, y: inner0.y + Math.sin(normal) * depth };
    const outer1 = { x: inner1.x + Math.cos(normal) * depth, y: inner1.y + Math.sin(normal) * depth };
    return [inner0, outer0, outer1, inner1];
  });
}

function square(center: Point2D, half: number): Point2D[] {
  return [
    { x: center.x - half, y: center.y - half }, { x: center.x + half, y: center.y - half },
    { x: center.x + half, y: center.y + half }, { x: center.x - half, y: center.y + half }, { x: center.x - half, y: center.y - half },
  ];
}

/** Dashes around a circle: the dotted ring of an NDB. */
function dottedCircle(center: Point2D, radius: number, count: number): Point2D[][] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return dot({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }, radius * 0.07);
  });
}

/** The sectional obstacle: an inverted V standing on a dot. */
function obstacle(center: Point2D, size: number): Point2D[][] {
  const half = size / 2;
  const base = { x: center.x, y: center.y + half * 0.8 };
  return [
    [{ x: center.x - half * 0.45, y: base.y }, { x: center.x, y: center.y - half }, { x: center.x + half * 0.45, y: base.y }],
    dot(base, size * 0.06),
  ];
}

/** Polylines drawing `symbol` centered on `center`, `sizeMm` across. */
export function aviationSymbolPaths(symbol: AviationSymbol, center: Point2D, sizeMm: number): Point2D[][] {
  const radius = sizeMm / 2;
  switch (symbol) {
    case "airport": return [circle(center, radius * 0.6)];
    case "airport-towered": return [circle(center, radius * 0.6), ...ticks(center, radius * 0.6, radius)];
    case "airport-private": return [circle(center, radius * 0.45), dot(center, radius * 0.08)];
    case "heliport": return [
      circle(center, radius * 0.6),
      [{ x: center.x - radius * 0.25, y: center.y - radius * 0.3 }, { x: center.x - radius * 0.25, y: center.y + radius * 0.3 }],
      [{ x: center.x + radius * 0.25, y: center.y - radius * 0.3 }, { x: center.x + radius * 0.25, y: center.y + radius * 0.3 }],
      [{ x: center.x - radius * 0.25, y: center.y }, { x: center.x + radius * 0.25, y: center.y }],
    ];
    case "vor": return [hexagon(center, radius * 0.7), dot(center, radius * 0.08)];
    case "vortac": return [hexagon(center, radius * 0.6), ...tabs(center, radius * 0.6), dot(center, radius * 0.08)];
    case "tacan": return [...tabs(center, radius * 0.6), dot(center, radius * 0.08)];
    case "vor-dme": return [hexagon(center, radius * 0.6), square(center, radius * 0.75), dot(center, radius * 0.08)];
    case "dme": return [square(center, radius * 0.6), dot(center, radius * 0.08)];
    case "ndb": return [...dottedCircle(center, radius * 0.75, 12), dot(center, radius * 0.12)];
    case "obstacle": return obstacle(center, sizeMm * OBSTACLE_SCALE);
    case "obstacle-tall": return obstacle(center, sizeMm);
  }
}

/** Radius of the area a symbol occupies, for label offsets and clearance. */
export function aviationSymbolRadius(symbol: AviationSymbol, sizeMm: number): number {
  return symbol === "obstacle" ? sizeMm * OBSTACLE_SCALE / 2 : sizeMm / 2;
}
