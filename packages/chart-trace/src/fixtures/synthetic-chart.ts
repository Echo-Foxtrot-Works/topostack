// A synthetic vector chart page shaped like a GIS export: a lopsided lake,
// contours split into short, randomly reversed paths in alternating styles,
// an index contour in its own style, a few labels along the lines, and
// distractions (a legend, grid ticks, a road) around it.

import type { Point2 } from "../local-frame.ts";
import type { VectorPage, VectorPath, VectorText } from "../vector-page.ts";

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CENTRE: Point2 = [600, 500];

/** The lake at a fraction of its shoreline radius: nested, lopsided rings. */
export function ring(fraction: number, count = 240): Point2[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    const radius = 300 * fraction * (1 + 0.18 * Math.sin(3 * angle) + 0.08 * Math.cos(5 * angle));
    return [CENTRE[0] + 1.3 * radius * Math.cos(angle) - 40 * (1 - fraction), CENTRE[1] + radius * Math.sin(angle)];
  });
}

export interface SyntheticChart {
  page: VectorPage;
  /** The level of each contour in order of `fractions`. */
  levels: number[];
  contourStyles: string[];
  shorelineStyle: string;
}

/**
 * `levels[i]` is drawn at `fractions[i]` of the shoreline radius; only the
 * indexes in `labelled` get labels.
 */
export function syntheticChart(options: { levels: number[]; fractions: number[]; labelled: number[]; indexEvery?: number; seed?: number }): SyntheticChart {
  const next = random(options.seed ?? 1);
  const paths: VectorPath[] = [];
  const texts: VectorText[] = [];
  const minor = ["#9c9c9c", "#4e4e4e"];
  options.levels.forEach((level, index) => {
    const points = ring(options.fractions[index]!);
    const isIndex = options.indexEvery !== undefined && index % options.indexEvery === 0;
    const stroke = isIndex ? "#000000" : minor[index % 2]!;
    const lineWidth = isIndex ? 0.72 : 0.48;
    // Split the ring into 4-9 pieces at random vertices; reverse some.
    const cuts = new Set<number>([0]);
    const pieces = 4 + Math.floor(next() * 6);
    while (cuts.size < pieces) cuts.add(Math.floor(next() * points.length));
    const sorted = [...cuts].sort((a, b) => a - b);
    sorted.forEach((start, piece) => {
      const end = sorted[piece + 1] ?? points.length;
      const slice = [...points.slice(start, end + 1), ...(end === points.length ? [points[0]!] : [])];
      paths.push({ stroke, lineWidth, dashed: false, points: next() < 0.5 ? slice : slice.reverse(), closed: false });
    });
    if (options.labelled.includes(index)) {
      for (const at of [0.1, 0.6]) {
        const vertex = Math.floor(at * points.length);
        const [x1, y1] = points[vertex]!;
        const [x2, y2] = points[vertex + 1]!;
        texts.push({ text: String(level), x: x1, y: y1, angle: Math.atan2(y2 - y1, x2 - x1), size: 9, width: 14 });
      }
    }
  });
  paths.push({ stroke: "#73dfff", lineWidth: 0.72, dashed: false, points: ring(1), closed: true });
  // A road across the page, a legend with a sample contour, and grid ticks.
  paths.push({ stroke: "#ff0000", lineWidth: 1.5, dashed: false, points: [[0, 950], [1200, 980]], closed: false });
  paths.push({ stroke: "#9c9c9c", lineWidth: 0.48, dashed: false, points: [[20, 20], [60, 20]], closed: false });
  texts.push({ text: "25", x: 80, y: 20, angle: 0, size: 9, width: 14 });
  texts.push({ text: "1,200,000", x: 600, y: 990, angle: 0, size: 8, width: 40 });
  return {
    page: { width: 1200, height: 1000, paths, texts },
    levels: options.levels,
    contourStyles: ["#9c9c9c/0.48", "#4e4e4e/0.48", "#000000/0.72"],
    shorelineStyle: "#73dfff/0.72",
  };
}
