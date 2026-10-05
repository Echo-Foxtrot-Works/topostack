import polygonClipping, { type Pair } from "polygon-clipping";
import { insideRing } from "./chart-geometry";
import { EARTH_RADIUS_M, OUTLINE_CHART_KEY_PREFIX, type GeoBounds, type ElevationGrid, type ProjectConfigV1, type WaterAreaV1 } from "@topostack/core";
import { ringIou } from "@topostack/chart-trace/georef";
import { decodeChartDepths, type UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import { buildPixelMask, sampleDepth, type PixelMask, type SurveyResult } from "$lib/domain/bathymetry";
import { artworkToLonLat, latToWorldY, worldYToLat } from "$lib/domain/tile-math";

/**
 * A depth chart the maker traced themselves, resampled onto the terrain grid.
 *
 * It runs after the survey providers and overwrites them: a chart is chosen for
 * one named lake, so it is a deliberate answer to "this provider is wrong or
 * missing here". Everything downstream is unchanged; the lake carries an
 * ordinary bathymetry grid, marked `bathymetryOrigin: "chart"` so the warning
 * and the surface's depth source can say where it came from.
 */

/** A chart with the content hash the project references it by. */
export interface LoadedUserChart {
  chart: UserChartBathymetryV1;
  contentHash: string;
}

/**
 * Terrain grid columns are evenly spaced in longitude and rows evenly spaced in
 * Web Mercator, matching the survey raster sampler. A chart grid is even in
 * longitude and latitude, so only the rows need converting.
 */
export function sampleChartDepths(chart: UserChartBathymetryV1, bounds: GeoBounds, grid: Pick<ElevationGrid, "width" | "height">): Float32Array {
  const { width, height } = grid;
  const depths = decodeChartDepths(chart.grid);
  const chartGrid = chart.grid;
  // The outer half-cell at each edge takes the edge cell's value: a chart's
  // first row covers the water up to its own boundary, not just its centre.
  const sample = (x: number, y: number): number => {
    const column = Math.max(0, Math.min(chartGrid.width - 1, Math.round(x)));
    const row = Math.max(0, Math.min(chartGrid.height - 1, Math.round(y)));
    return depths[row * chartGrid.width + column]!;
  };
  const spanLon = chartGrid.bounds.east - chartGrid.bounds.west;
  const spanLat = chartGrid.bounds.north - chartGrid.bounds.south;
  const values = new Float32Array(width * height).fill(Number.NaN);
  if (spanLon <= 0 || spanLat <= 0) return values;
  // Chart cell centres: cell 0 covers the first 1/width of the span.
  const columnOf = (lon: number) => ((lon - chartGrid.bounds.west) / spanLon) * chartGrid.width - 0.5;
  const rowOf = (lat: number) => ((chartGrid.bounds.north - lat) / spanLat) * chartGrid.height - 0.5;
  // A terrain edge that lines up with the chart's edge lands on the outer
  // half-cell to within rounding, so the bounds check allows for that much.
  const slack = 1e-6;
  const northY = latToWorldY(bounds.north, 0);
  const southY = latToWorldY(bounds.south, 0);
  const columns = Array.from({ length: width }, (_, column) =>
    columnOf(bounds.west + (bounds.east - bounds.west) * (width === 1 ? 0 : column / (width - 1))));
  for (let row = 0; row < height; row += 1) {
    const lat = worldYToLat(northY + (southY - northY) * (height === 1 ? 0 : row / (height - 1)), 0);
    const chartRow = rowOf(lat);
    if (chartRow < -0.5 - slack || chartRow > chartGrid.height - 0.5 + slack) continue;
    for (let column = 0; column < width; column += 1) {
      const chartColumn = columns[column]!;
      if (chartColumn < -0.5 - slack || chartColumn > chartGrid.width - 0.5 + slack) continue;
      const lon = bounds.west + (bounds.east - bounds.west) * (width === 1 ? 0 : column / (width - 1));
      if (chart.lake.islands?.some(ring => insideRing([lon, lat], ring))) continue;
      values[row * width + column] = sampleDepth(sample, chartColumn, chartRow);
    }
  }
  return values;
}

/** Ground metres between chart cells, from its grid bounds. */
export function chartSpacingM(chart: UserChartBathymetryV1): number {
  const { bounds, width, height } = chart.grid;
  const midLat = (bounds.north + bounds.south) / 2;
  const across = ((bounds.east - bounds.west) * Math.PI / 180) * EARTH_RADIUS_M * Math.cos(midLat * Math.PI / 180) / width;
  const down = ((bounds.north - bounds.south) * Math.PI / 180) * EARTH_RADIUS_M / height;
  return Math.max(across, down);
}

const overlaps = (bounds: GeoBounds, grid: UserChartBathymetryV1["grid"]): boolean =>
  bounds.east > grid.bounds.west && bounds.west < grid.bounds.east && bounds.north > grid.bounds.south && bounds.south < grid.bounds.north;

/** A chart keyed by outline takes a lake only when their outlines overlap at least this much. */
export const OUTLINE_MATCH_MIN_IOU = 0.5;

type LonLat = [number, number];

/** A ring cut to a rectangle (Sutherland-Hodgman; the rectangle is convex, so this is exact). */
function clipRing(ring: readonly LonLat[], bounds: GeoBounds): LonLat[] {
  const edges: [(point: LonLat) => boolean, (a: LonLat, b: LonLat) => LonLat][] = [
    [([x]) => x >= bounds.west, (a, b) => [bounds.west, a[1] + ((b[1] - a[1]) * (bounds.west - a[0])) / (b[0] - a[0])]],
    [([x]) => x <= bounds.east, (a, b) => [bounds.east, a[1] + ((b[1] - a[1]) * (bounds.east - a[0])) / (b[0] - a[0])]],
    [([, y]) => y >= bounds.south, (a, b) => [a[0] + ((b[0] - a[0]) * (bounds.south - a[1])) / (b[1] - a[1]), bounds.south]],
    [([, y]) => y <= bounds.north, (a, b) => [a[0] + ((b[0] - a[0]) * (bounds.north - a[1])) / (b[1] - a[1]), bounds.north]],
  ];
  let output: LonLat[] = [...ring];
  for (const [inside, cross] of edges) {
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index]!;
      const previous = input[(index + input.length - 1) % input.length]!;
      if (inside(current)) {
        if (!inside(previous)) output.push(cross(previous, current));
        output.push(current);
      } else if (inside(previous)) output.push(cross(previous, current));
    }
    if (!output.length) break;
  }
  return output;
}

/**
 * Which chart each lake carves with, by area id. A lake HydroLAKES knows takes
 * the chart under its id. A chart keyed `outline:<chart id>` names no lake, so
 * it takes the one lake its own outline overlaps best, if well enough. The map
 * area may cut a lake off, so the chart's outline is cut the same way first.
 */
export function chartsForAreas(
  areas: readonly WaterAreaV1[],
  charts: ReadonlyMap<string, LoadedUserChart>,
  bounds: GeoBounds,
  dimensions?: Pick<ProjectConfigV1, "widthMm" | "heightMm">,
): Map<string, LoadedUserChart> {
  const chosen = new Map<string, LoadedUserChart>();
  for (const area of areas) {
    const loaded = area.hylakId === undefined ? undefined : charts.get(String(area.hylakId));
    if (loaded) chosen.set(area.id, loaded);
  }
  const byOutline = [...charts].filter(([key]) => key.startsWith(OUTLINE_CHART_KEY_PREFIX)).map(([, loaded]) => loaded);
  if (!byOutline.length || !dimensions) return chosen;
  const toLonLat = artworkToLonLat(bounds, dimensions.widthMm, dimensions.heightMm);
  const candidates = areas.filter((area) => area.kind === "lake" && !chosen.has(area.id)).map((area) => ({ area, outline: area.polygon.outer.map(toLonLat) }));
  for (const loaded of byOutline) {
    const outline = clipRing(loaded.chart.lake.outline, bounds);
    if (outline.length < 3) continue;
    let best: { id: string; iou: number } | undefined;
    for (const candidate of candidates) {
      if (chosen.has(candidate.area.id)) continue;
      const iou = ringIou(outline, candidate.outline);
      if (iou >= OUTLINE_MATCH_MIN_IOU && (!best || iou > best.iou)) best = { id: candidate.area.id, iou };
    }
    if (best) chosen.set(best.id, loaded);
  }
  return chosen;
}

/**
 * Replace each charted lake's depths with the chart's, keyed by HydroLAKES id
 * as `waterDepthOverrides` is. A chart whose samples miss the lake entirely
 * leaves the provider result alone rather than blanking it.
 */
export async function applyUserCharts(
  result: SurveyResult,
  charts: ReadonlyMap<string, LoadedUserChart>,
  bounds: GeoBounds,
  grid: ElevationGrid,
  signal?: AbortSignal,
  dimensions?: Pick<ProjectConfigV1, "widthMm" | "heightMm">,
): Promise<SurveyResult> {
  if (!charts.size) return result;
  signal?.throwIfAborted();
  const datasetVersions = [...result.datasetVersions];
  const attribution = [...result.attribution];
  const masks = new Map<string, PixelMask>();
  let areas = result.areas;
  let charted = false;
  const chosen = chartsForAreas(result.areas, charts, bounds, dimensions);
  for (const area of result.areas) {
    const loaded = chosen.get(area.id);
    if (!loaded || !overlaps(bounds, loaded.chart.grid)) continue;
    signal?.throwIfAborted();
    const values = sampleChartDepths(loaded.chart, bounds, grid);
    let mask = masks.get(area.id);
    if (dimensions && !mask) { mask = await buildPixelMask(area.polygon, grid, dimensions, signal); masks.set(area.id, mask); }
    const box = mask ?? { rowStart: 0, rowEnd: grid.height - 1, colStart: 0, colEnd: grid.width - 1 };
    const maskWidth = box.colEnd - box.colStart + 1;
    let samples: Float32Array | undefined;
    let count = 0;
    for (let row = box.rowStart; row <= box.rowEnd; row += 1) {
      for (let column = box.colStart; column <= box.colEnd; column += 1) {
        const index = row * grid.width + column;
        const depth = values[index]!;
        if (!Number.isFinite(depth) || depth < 0 || depth > 1500) continue;
        // Samples outside this lake, including islands and neighbouring lakes.
        if (mask && !mask.inside[(row - box.rowStart) * maskWidth + column - box.colStart]) continue;
        // Start from the provider's grid so an uncharted arm keeps its survey.
        samples ??= area.bathymetry ? Float32Array.from(area.bathymetry.depthsM) : new Float32Array(grid.width * grid.height).fill(Number.NaN);
        samples[index] = depth;
        count += 1;
      }
    }
    if (!count || !samples) continue;
    charted = true;
    const spacingM = chartSpacingM(loaded.chart);
    const islands = loaded.chart.lake.islands ?? [];
    if (islands.length && !dimensions) throw new Error("Chart islands require artwork dimensions to preserve land boundaries.");
    const polygons = islands.length && dimensions ? polygonClipping.difference(
      [[area.polygon.outer.map(p => [p.x, p.y] as Pair), ...area.polygon.holes.map(ring => ring.map(p => [p.x, p.y] as Pair))]],
      islands.map(ring => [ring.map(([lon, lat]): Pair => [
        ((lon - bounds.west) / (bounds.east - bounds.west) - .5) * dimensions.widthMm,
        ((latToWorldY(lat, 0) - latToWorldY(bounds.north, 0)) / (latToWorldY(bounds.south, 0) - latToWorldY(bounds.north, 0)) - .5) * dimensions.heightMm,
      ])]),
    ).map(rings => ({ outer: rings[0]!.map(([x,y]) => ({x,y})), holes: rings.slice(1).map(ring => ring.map(([x,y]) => ({x,y}))) })) : [area.polygon];
    areas = areas.flatMap(item => item.id === area.id ? polygons.map((polygon, index) => ({
      ...item, id: index ? `${item.id}-chart-${index}` : item.id, polygon,
      bathymetryOrigin: "chart" as const, bathymetry: { width: grid.width, height: grid.height, depthsM: samples!, sampleSpacingM: spacingM },
    })) : [item]);
    const version = `userchart-${loaded.contentHash.slice(0, 8)}`;
    if (!datasetVersions.includes(version)) datasetVersions.push(version);
    const { title, publisher, sourceUrl } = loaded.chart.provenance;
    // Only a chart that names a published source carries an attribution line;
    // a maker's own chart has nobody else to credit.
    if (sourceUrl && !attribution.some((item) => item.url === sourceUrl)) {
      attribution.push({ name: `Depth chart: ${title}`, url: sourceUrl, license: publisher ? `${publisher}; ${loaded.chart.license.attestation}` : loaded.chart.license.attestation });
    }
  }
  if (!charted) return result;
  return { areas, status: result.status === "not-covered" || result.status === "unavailable" ? "available" : result.status, datasetVersions, attribution };
}
