// A vector chart page to contours with levels, in page units and chart units.
// Which strokes are contours and which is the shoreline is the maker's choice
// (or a batch manifest's): colours differ between publishers, and the same
// colour can mean a road on one chart and a contour on the next.

import { pathLength } from "./geometry.ts";
import type { Point2 } from "./local-frame.ts";
import { inferLevels } from "./levels.ts";
import { bridgeGaps, chainPaths, depthLabels, labelChains, styleKey, type Chain, type DepthLabel } from "./vector-chart.ts";
import type { VectorPage } from "./vector-page.ts";
import { inferIntervalM } from "./grid.ts";

export interface VectorTraceOptions {
  /** Stop after chaining, before labels and level inference. */
  geometryOnly?: boolean;
  /** Stroke style keys (from strokeStyles) that draw contours. */
  contourStyles: string[];
  /** Stroke style keys that draw the shoreline; omit when the chart has none. */
  shorelineStyles?: string[];
  /** Whether labels are depths below the surface or elevations above a datum. */
  labels: "depth" | "elevation";
  /** The surface in chart units for elevation labels, which the shoreline stands for. */
  surface?: number;
  /** Contour interval in chart units; inferred from the labels when absent. */
  interval?: number;
  /** The map's page rectangle. Labels and contour paths outside it (legends, insets, grid ticks) are ignored. */
  mapArea?: { left: number; top: number; right: number; bottom: number };
  /** Join contour pieces straight through junctions where other ink crosses them; for scans. */
  continueThroughJunctions?: boolean;
  /**
   * Leave out long, ruler-straight lines (section lines, roads, frames) that
   * share the contours' ink; for scans. A contour is never straight for long.
   */
  dropStraightLines?: boolean;
}

export interface TracedContour {
  points: Point2[];
  closed: boolean;
  /** Level in chart units. */
  value: number;
  inferred: boolean;
}

export interface VectorTrace {
  /** Joined paths used to bind labels, including contours without a depth yet. */
  selectionContours: { points: Point2[]; closed: boolean }[];
  contours: TracedContour[];
  shoreline: Point2[][];
  interval: number;
  diagnostics: {
    paths: number;
    chains: number;
    labels: number;
    labelled: number;
    inferred: number;
    unresolved: number;
    /** Chains carrying labels that disagree with each other; they get no level. */
    labelDisagreements: number;
    /**
     * Spaces between lines that touch levels no single band can hold. Some
     * are normal on a real chart (lines crowding closer than the raster, gaps
     * at the map edge); many means a contour style is missing.
     */
    contradictoryRegions: number;
    /** Share of contour length that ended with a level. */
    coverage: number;
  };
}

/**
 * With the interval known, keeps only labels on the chart's ladder: the
 * remainder most labels share (0 for depths in whole intervals, 2 for
 * elevations like 322, 317, 312). OCR misreads of dashes and symbols fall off.
 */
function onLadder(labels: DepthLabel[], interval: number | undefined): DepthLabel[] {
  if (!interval || labels.length < 2) return labels;
  const remainder = (value: number) => Math.round((((value % interval) + interval) % interval) * 1000) / 1000;
  const counts = new Map<number, number>();
  for (const label of labels) counts.set(remainder(label.value), (counts.get(remainder(label.value)) ?? 0) + 1);
  const [common] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  return labels.filter((label) => remainder(label.value) === common);
}

/** A long open chain that never strays more than 1% of its length from the chord between its ends. */
function isStraight(chain: Chain, minLength: number): boolean {
  if (chain.closed) return false;
  const [x1, y1] = chain.points[0]!;
  const [x2, y2] = chain.points.at(-1)!;
  const chord = Math.hypot(x2 - x1, y2 - y1);
  if (chord < minLength) return false;
  let farthest = 0;
  for (const [x, y] of chain.points) farthest = Math.max(farthest, Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / chord);
  return farthest <= chord * 0.01;
}

export function traceVectorChart(page: VectorPage, options: VectorTraceOptions): VectorTrace {
  const contourStyles = new Set(options.contourStyles);
  const shorelineStyles = new Set(options.shorelineStyles ?? []);
  if (!contourStyles.size) throw new Error("Choose at least one contour style.");
  if (options.labels === "elevation" && options.surface === undefined) throw new Error("Elevation labels need the surface elevation.");
  const area = options.mapArea;
  const inMap = area ? (x: number, y: number) => x >= area.left && x <= area.right && y >= area.top && y <= area.bottom : undefined;
  // A path belongs to the map when most of it is inside; contours may run to the map frame.
  const onMap = (points: readonly Point2[]) => !inMap || points.filter(([x, y]) => inMap(x, y)).length * 2 >= points.length;
  const contourPaths = page.paths.filter((path) => path.stroke && contourStyles.has(styleKey(path)) && onMap(path.points));
  // Ends a hair apart are the same point; scale with the page, never below a quarter unit.
  const tolerance = Math.max(0.25, Math.hypot(page.width, page.height) * 1e-4);
  const labels = onLadder(depthLabels(page.texts, inMap), options.interval);
  const widths = labels.map((label) => label.width).sort((a, b) => a - b);
  const typicalLabel = widths.length ? widths[Math.floor(widths.length / 2)]! : 0;
  // A label gap is about one label wide; allow some margin either side.
  const bridged = bridgeGaps(chainPaths(contourPaths, tolerance, options.continueThroughJunctions), Math.max(tolerance * 4, typicalLabel * 1.8), undefined, undefined, labels.map((label): Point2 => [label.x, label.y]));
  const minStraight = Math.hypot(page.width, page.height) * 0.03;
  const chains = options.dropStraightLines ? bridged.filter((chain) => !isStraight(chain, minStraight)) : bridged;
  if (options.geometryOnly) return {
    selectionContours: chains.map(({ points, closed }) => ({ points, closed })),
    contours: [], shoreline: [], interval: 0,
    diagnostics: { paths: contourPaths.length, chains: chains.length, labels: 0, labelled: 0, inferred: 0, unresolved: chains.length, labelDisagreements: 0, contradictoryRegions: 0, coverage: 0 },
  };
  const labelled = labelChains(chains, labels);
  const interval = options.interval ?? inferIntervalM(labels.map((label) => label.value));
  if (!interval) throw new Error("Set the contour interval; the labels do not show it.");

  const shoreline = chainPaths(page.paths.filter((path) => path.stroke && shorelineStyles.has(styleKey(path)) && onMap(path.points)), tolerance)
    .filter((chain: Chain) => chain.points.length >= 3)
    .map((chain) => chain.points);
  const surface = options.labels === "depth" ? 0 : options.surface!;
  const levels = inferLevels({
    lines: labelled.map((chain) => ({ points: chain.points, closed: chain.closed, ...(chain.value === undefined ? {} : { value: chain.value }) })),
    ...(shoreline.length ? { shoreline: { rings: shoreline, value: surface } } : {}),
    interval,
    inward: options.labels === "depth" ? 1 : -1,
    surface,
    width: page.width,
    height: page.height,
  });

  const contours: TracedContour[] = [];
  let total = 0;
  let covered = 0;
  labelled.forEach((chain, index) => {
    const length = pathLength(chain.points);
    total += length;
    const value = levels.values[index];
    if (value === undefined) return;
    covered += length;
    contours.push({ points: chain.points, closed: chain.closed, value, inferred: levels.inferred[index]! });
  });
  return {
    contours,
    selectionContours: chains.map(({ points, closed }) => ({ points, closed })),
    shoreline,
    interval,
    diagnostics: {
      paths: contourPaths.length,
      chains: chains.length,
      labels: labels.length,
      labelled: labelled.filter((chain) => chain.value !== undefined).length,
      inferred: levels.inferred.filter(Boolean).length,
      unresolved: labelled.length - contours.length,
      labelDisagreements: labelled.filter((chain) => chain.labels.length && chain.value === undefined).length,
      contradictoryRegions: levels.regions.contradictory,
      coverage: total ? covered / total : 0,
    },
  };
}
