import { DEFAULT_PROJECT, carveWaterDepth, groundWidthMFor, smoothLakeShorelines, type GeoBounds, type ProjectConfigV1 } from "@topostack/core";
import { KM_PER_DEGREE_LAT, kmPerDegreeLon } from "$lib/domain/coordinates";
import { loadTerrain } from "$lib/domain/data-provider";
import type { PreviewInput } from "$lib/site/lake-preview/render";

/**
 * Loads the same terrain and lake-floor data the studio generates from, for a
 * lake's page preview. It uses the framing of the lake's studio link, and depth
 * is carved at true scale (exaggeration 1) before the studio would fit it to
 * sheets. Runs in Node through Vite (scripts/dev/render-lake-previews.mjs).
 */
export interface PreparedPreview {
  input: PreviewInput;
  bounds: GeoBounds;
  datasetVersion: string;
  bathymetryStatus?: string;
}
/** The directory entry being previewed; its survey outline and box pick the lake out of the other water in frame. */
export interface PreviewLake { name: string; sourceId: string; surveyId: string; bounds: [number, number, number, number] }

/** The most elongated preview, either way; a longer lake gets more of its surroundings instead of a thin strip. */
const MAX_ASPECT = 2;

/**
 * The studio link's framing (the survey bounds plus 8% on every side), widened
 * along its short side to at most 2:1 so a long, narrow lake still fills a
 * readable image.
 */
export function previewBounds([west, south, east, north]: [number, number, number, number]): GeoBounds {
  const padX = (east - west) * 0.08;
  const padY = (north - south) * 0.08;
  let [w, s, e, n] = [west - padX, south - padY, east + padX, north + padY];
  const kmPerLon = kmPerDegreeLon((s + n) / 2);
  const widthKm = (e - w) * kmPerLon;
  const heightKm = (n - s) * KM_PER_DEGREE_LAT;
  if (widthKm * MAX_ASPECT < heightKm) {
    const grow = (heightKm / MAX_ASPECT - widthKm) / kmPerLon / 2;
    w -= grow; e += grow;
  } else if (heightKm * MAX_ASPECT < widthKm) {
    const grow = (widthKm / MAX_ASPECT - heightKm) / KM_PER_DEGREE_LAT / 2;
    s -= grow; n += grow;
  }
  return { west: Math.max(-180, w), south: Math.max(-85, s), east: Math.min(180, e), north: Math.min(85, n) };
}

const mercatorY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

/**
 * The previewed lake's cells. A surface whose survey outline names this lake
 * wins; otherwise it is every surface lying mostly inside the survey box. Other
 * water in the frame, such as a modelled quarry, then cannot set the depth scale.
 */
function targetCells(lake: PreviewLake, bounds: GeoBounds, width: number, height: number, surfaces: { area?: { surveyId?: string; outlineSourceId?: string }; cells: Int32Array }[]): Uint8Array {
  const target = new Uint8Array(width * height);
  const named = surfaces.filter(({ area }) => area?.surveyId === lake.surveyId && area.outlineSourceId === lake.sourceId);
  const top = mercatorY(bounds.north);
  const span = top - mercatorY(bounds.south);
  const inBox = (cell: number): boolean => {
    const lon = bounds.west + (cell % width) / Math.max(1, width - 1) * (bounds.east - bounds.west);
    const y = top - Math.floor(cell / width) / Math.max(1, height - 1) * span;
    const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
    return lon >= lake.bounds[0] && lon <= lake.bounds[2] && lat >= lake.bounds[1] && lat <= lake.bounds[3];
  };
  const chosen = named.length ? named : surfaces.filter(({ cells }) => {
    let inside = 0;
    for (const cell of cells) if (inBox(cell)) inside++;
    return cells.length > 0 && inside / cells.length >= 0.5;
  });
  for (const { cells } of chosen) for (const cell of cells) target[cell] = 1;
  return target;
}

/** A map zoom that fits the frame in about three 256-pixel tiles, as the studio's camera would. */
function frameZoom(bounds: GeoBounds): number {
  return Math.max(3, Math.min(14, Math.round(Math.log2(3 * 360 / Math.max(1e-6, bounds.east - bounds.west)))));
}

export async function preparePreview(lake: PreviewLake, signal?: AbortSignal): Promise<PreparedPreview> {
  const { name } = lake;
  const bounds = previewBounds(lake.bounds);
  const aspect = (mercatorY(bounds.north) - mercatorY(bounds.south)) / ((bounds.east - bounds.west) * Math.PI / 180);
  const config: ProjectConfigV1 = {
    ...DEFAULT_PROJECT,
    name,
    location: { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2, label: name, zoom: frameZoom(bounds), bounds },
    widthMm: 400,
    heightMm: Math.round(400 * aspect * 1000) / 1000,
    outputMode: "stack",
    showWaterDepth: true,
    waterDepthExaggeration: 1,
    showRoads: false,
    showTrails: false,
    showBoundaries: false,
    showCoordinateGrid: false,
  };
  const { fallback, source: loaded } = await loadTerrain(config, signal);
  if (fallback) throw new Error(`${name}: real terrain unavailable`);
  const source = smoothLakeShorelines(loaded, config);
  const grid = source.elevation;
  const groundWidthM = groundWidthMFor(source.bounds);
  const groundHeightM = groundWidthM * (mercatorY(source.bounds.north) - mercatorY(source.bounds.south)) / ((source.bounds.east - source.bounds.west) * Math.PI / 180);
  const areas = source.waterAreas ?? [];
  const carved = carveWaterDepth(grid, config, areas, groundWidthM, groundHeightM);
  const cells = grid.width * grid.height;

  const depth = new Float32Array(cells).fill(NaN);
  const water = new Uint8Array(cells);
  carved.surfaces.forEach((surface, index) => {
    const surfaceCells = carved.surfaceCells?.[index];
    if (!surfaceCells) throw new Error(`${name}: carve returned no cells for ${surface.id}`);
    for (const cell of surfaceCells) {
      water[cell] = 1;
      depth[cell] = Math.max(0, surface.surfaceElevationM - carved.grid.values[cell]!);
    }
  });
  const surveyed = new Uint8Array(cells);
  for (const area of areas) {
    const bathymetry = area.bathymetry;
    if (!bathymetry || bathymetry.width !== grid.width || bathymetry.height !== grid.height) continue;
    for (let i = 0; i < cells; i++) if (water[i] && Number.isFinite(bathymetry.depthsM[i])) surveyed[i] = 1;
  }
  const target = targetCells(lake, source.bounds, grid.width, grid.height, carved.surfaces.map((surface, index) => ({ area: areas.find((area) => area.id === surface.id), cells: carved.surfaceCells![index]! })));
  // A preview without the lake, or without its survey, would show a flat or modelled lake as if it were measured.
  if (!target.some((cell) => cell === 1)) throw new Error(`no lake outline in frame (lake data ${source.lakeDataStatus ?? "unknown"}, map data ${source.vectorStatus ?? "unknown"})`);
  if (source.bathymetryStatus === "unavailable" || source.bathymetryStatus === "not-covered") throw new Error(`survey depths ${source.bathymetryStatus}`);
  return {
    input: { width: grid.width, height: grid.height, elevation: carved.grid.values, water, depth, surveyed, target, groundWidthM, groundHeightM },
    bounds: source.bounds,
    datasetVersion: source.datasetVersion,
    ...(source.bathymetryStatus ? { bathymetryStatus: source.bathymetryStatus } : {}),
  };
}
