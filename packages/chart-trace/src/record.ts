// A traced chart to a UserChartBathymetryV1 record.
//
// The last step of every route into bathymetry: the batch build's curated
// charts and the studio's uploads both end here, so a chart means the same
// thing however it was traced. Levels become depths in metres, geometry moves
// from chart pixels to lon/lat, contours are simplified until they fit the
// contract, and the grid is interpolated from them.

import { CHART_BATHYMETRY_LIMITS, CHART_BATHYMETRY_SCHEMA, CHART_UNIT_METRES, chartLabelDepthM, encodeChartDepths, isPublishableChart, parseUserChartBathymetry, type ChartAttestation, type ChartGeorefMethod, type ChartLabelsV1, type ChartUnit, type UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import { apply, type Matrix3 } from "./georef.ts";
import { gridDepths, type GridMethod } from "./grid.ts";
import type { Point2 } from "./local-frame.ts";
import { simplify } from "./trace-raster.ts";

/** A contour as the tracers report it: a line in chart pixels at a level in chart units. */
export interface TracedLevel {
  points: Point2[];
  closed: boolean;
  /** Level in chart units: a depth, or an elevation when the chart labels elevations. */
  value: number;
  inside?: "deeper" | "shallower";
  interiorValue?: number;
}

export interface ChartRecordRequest {
  /** Record id: 8-64 lowercase letters, digits, or dashes. */
  id: string;
  lake: { name?: string; region?: string; hylakId?: number };
  /** Chart pixels or page units to [lon, lat, 1], with how it was found. */
  georef: { matrix: Matrix3; rmsM: number; method: ChartGeorefMethod; controlPoints?: { x: number; y: number; lon: number; lat: number }[]; iou?: number };
  units: ChartUnit;
  labels: ChartLabelsV1;
  /** Contour interval in chart units. */
  interval?: number;
  /** Reviewed contours explicitly hold their interior unless a target is supplied. */
  explicitInteriors?: boolean;
  contours: TracedLevel[];
  /**
   * The water's edge, one ring per tile, filled even-odd. `pixels` is the shore
   * the chart itself draws; `lonLat` is a known lake outline, which is what a
   * snapped chart already matched itself against.
   */
  water: { pixels: Point2[][] } | { lonLat: Point2[][] };
  spots?: { x: number; y: number; value: number }[];
  resolutionM: number;
  method?: GridMethod;
  provenance: { title: string; publisher?: string; sourceUrl?: string; year?: number; fileSha256: string; tool: string };
  license: { attestation: ChartAttestation; spdx?: string; note?: string };
}

export interface ChartRecordReport {
  /** License eligibility only; never geometry, accuracy, or fabrication approval. */
  publishable: boolean;
  georefRmsM: number;
  contours: number;
  contourPoints: number;
  /** Cells with a depth, and the deepest of them in metres. */
  waterCells: number;
  deepestM: number;
  grid: { width: number; height: number; resolutionM: number };
}

function ringArea(ring: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/** At most `limit` contours, the longest, in the order they came. */
function longestContours<T extends { points: readonly unknown[] }>(contours: T[], limit: number): T[] {
  if (contours.length <= limit) return contours;
  const kept = new Set([...contours].sort((left, right) => right.points.length - left.points.length).slice(0, limit));
  return contours.filter((contour) => kept.has(contour));
}

/**
 * Builds and validates the record. Throws with what the maker should fix when
 * no contour carries a level or the chart has no water outline, because
 * neither can be guessed and both are choices made earlier in the trace.
 */
export function buildChartRecord(request: ChartRecordRequest): { record: UserChartBathymetryV1; report: ChartRecordReport } {
  // The simplification below grows from this; zero or NaN would never grow and never finish.
  if (!(request.resolutionM > 0) || !Number.isFinite(request.resolutionM)) throw new Error(`Depth chart ${request.id}: the grid resolution must be a positive number of metres.`);
  // Six decimals is about 0.1 m, finer than any chart's line width, and keeps a
  // record with tens of thousands of points to a sane size.
  const toLonLat = ([x, y]: Point2): Point2 => apply(request.georef.matrix, x, y).map((value) => Math.round(value * 1e6) / 1e6) as Point2;
  // Ground metres per chart unit, to size simplification in ground terms.
  const [lon0, lat0] = apply(request.georef.matrix, 0, 0);
  const [lon1, lat1] = apply(request.georef.matrix, 1, 0);
  const metresPerUnit = Math.hypot((lon1 - lon0) * 111_320 * Math.cos((lat0 * Math.PI) / 180), (lat1 - lat0) * 110_574);
  if (!(metresPerUnit > 0)) throw new Error(`Depth chart ${request.id}: the georeferencing collapses the chart to a point.`);

  const unit = CHART_UNIT_METRES[request.units];
  // Keep the longest lines, in their own order, when a noisy scan yields more
  // than a record holds. Capping first also bounds the loop below: every line
  // keeps at least two points, and the cap's two points each fit the budget.
  const levelled = longestContours(request.contours
    .map((contour) => ({ ...contour, depthM: chartLabelDepthM(request.labels, contour.value * unit) }))
    .filter((contour) => contour.depthM >= 0 && contour.points.length >= 2), CHART_BATHYMETRY_LIMITS.maxContours);
  if (!levelled.length) throw new Error(`Depth chart ${request.id}: no contour got a level; add labels or check which lines are contours.`);

  // Simplify until the contours fit the contract's point budget.
  let tolerance = request.explicitInteriors ? 0 : request.resolutionM / 4 / metresPerUnit;
  let contours: { depthM: number; closed: boolean; line: Point2[]; inside?: "deeper" | "shallower"; interiorDepthM?: number }[];
  for (;;) {
    contours = levelled.map((contour) => ({ ...(contour.inside ? { inside: contour.inside } : {}), ...(request.explicitInteriors ? { interiorDepthM: Math.round((contour.interiorValue === undefined ? contour.depthM : chartLabelDepthM(request.labels, contour.interiorValue * unit)) * 1000) / 1000 } : {}), depthM: Math.round(contour.depthM * 1000) / 1000, closed: contour.closed, line: simplify(contour.points, tolerance).map(toLonLat) }));
    if (contours.reduce((sum, contour) => sum + contour.line.length, 0) <= CHART_BATHYMETRY_LIMITS.maxContourPoints) break;
    if (request.explicitInteriors) throw new Error("Reviewed geometry exceeds the point limit.");
    tolerance *= 1.5;
  }
  contours = contours.filter((contour) => contour.line.length >= 2);

  // A shore the chart drew is at the chart's scale, so it simplifies the same
  // way; a known lake outline is already in ground terms and is used as given.
  const waterRings = ("lonLat" in request.water ? request.water.lonLat : request.water.pixels.map((ring) => simplify(ring, tolerance).map(toLonLat)))
    .filter((ring) => ring.length >= 3);
  if (!waterRings.length) throw new Error(`Depth chart ${request.id}: no water outline; mark the shore before gridding.`);

  const intervalM = request.interval === undefined ? undefined : request.interval * unit;
  // Spots shape the grid, so the record keeps them: the grid can be regenerated from what it stores.
  const spots = (request.spots ?? []).map((spot) => {
    const [lon, lat] = toLonLat([spot.x, spot.y]);
    return { lon: lon!, lat: lat!, depthM: Math.round(chartLabelDepthM(request.labels, spot.value * unit) * 1000) / 1000 };
  }).filter((spot) => spot.depthM >= 0);
  if (spots.length > CHART_BATHYMETRY_LIMITS.maxSpots) throw new Error(`Depth chart ${request.id}: ${spots.length} spot depths is more than a record holds (${CHART_BATHYMETRY_LIMITS.maxSpots}).`);
  const grid = gridDepths({
    water: { rings: waterRings },
    contours,
    spots,
    resolutionM: request.resolutionM,
    method: request.method ?? "harmonic",
    ...(intervalM === undefined ? {} : { intervalM }),
    maxSide: CHART_BATHYMETRY_LIMITS.maxGridSide,
  });

  // The lake outline in the record: the largest water ring, thinned to the limit.
  const largest = [...waterRings].sort((a, b) => ringArea(b) - ringArea(a))[0]!;
  let outline = largest;
  for (let step = 2; outline.length > CHART_BATHYMETRY_LIMITS.maxOutlinePoints; step += 1) outline = largest.filter((_, index) => index % step === 0);

  const record = parseUserChartBathymetry({
    schema: CHART_BATHYMETRY_SCHEMA,
    id: request.id,
    lake: {
      ...(request.lake.name ? { name: request.lake.name } : {}),
      ...(request.lake.region ? { region: request.lake.region } : {}),
      ...(request.lake.hylakId ? { hylakId: request.lake.hylakId } : {}),
      outline: outline.length >= 4 ? outline : [...outline, outline[0]!],
      ...(request.explicitInteriors && waterRings.length > 1 ? { islands: waterRings.filter(ring => ring !== largest) } : {}),
    },
    georef: {
      method: request.georef.method,
      matrix: request.georef.matrix,
      ...(request.georef.controlPoints ? { controlPoints: request.georef.controlPoints } : {}),
      ...(request.georef.iou === undefined ? {} : { iou: Math.round(request.georef.iou * 1000) / 1000 }),
      rmsM: Math.round(request.georef.rmsM * 100) / 100,
    },
    units: request.units,
    labels: request.labels,
    ...(intervalM === undefined ? {} : { intervalM }),
    contours,
    spots,
    grid: { bounds: grid.bounds, width: grid.width, height: grid.height, method: grid.method, depthsDm: encodeChartDepths(grid.depthsM) },
    provenance: request.provenance,
    license: request.license,
  });

  let deepest = 0;
  let waterCells = 0;
  for (const depth of grid.depthsM) {
    if (Number.isNaN(depth)) continue;
    waterCells += 1;
    deepest = Math.max(deepest, depth);
  }
  return {
    record,
    report: {
      publishable: isPublishableChart(record),
      georefRmsM: record.georef.rmsM,
      contours: record.contours.length,
      contourPoints: record.contours.reduce((sum, contour) => sum + contour.line.length, 0),
      waterCells,
      deepestM: Math.round(deepest * 10) / 10,
      grid: { width: grid.width, height: grid.height, resolutionM: grid.resolutionM },
    },
  };
}
