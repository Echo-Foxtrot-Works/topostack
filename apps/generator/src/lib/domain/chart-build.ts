import { reviewAlignment, reviewGeometryIssues, type ChartReview } from "./chart-review.ts";
import { snapCandidates, SNAP_MIN_IOU } from "@topostack/chart-trace/georef";
import type { Point2 } from "@topostack/chart-trace/local-frame";
import type { Rgb } from "@topostack/chart-trace/raster";
import { buildChartRecord, type ChartRecordReport } from "@topostack/chart-trace/record";
import { traceRasterChart, type ChartWord, type PlacedMark } from "@topostack/chart-trace/trace-raster";
import { CHART_UNIT_METRES, type ChartAttestation, type ChartUnit, type UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";

/**
 * One uploaded chart image to a finished depth chart record.
 *
 * This is the whole engine the custom data view drives, kept out of any
 * component so it can run in a worker and be tested without a DOM. It never
 * touches storage or the network: the caller hands it pixels and the lake's
 * known outline, and gets back a record to save.
 *
 * Placing the chart is done by snapping its traced shore onto that outline
 * rather than by asking for control points, because the lake is already known:
 * the maker picked it before uploading.
 */

export interface ChartImage {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

export interface ChartBuildRequest {
  /** Exact source paths, when a vector PDF supplies them. */
  sourceContours?: { points: Point2[]; closed: boolean }[];
  /** Production generation requires the explicitly reviewed paths. */
  review?: ChartReview;
  image: ChartImage;
  /** The lake being charted, with its outline in [lon, lat]. */
  lake: { name?: string; region?: string; hylakId?: number; outline: Point2[] };
  /** Which ink is contour line: chosen swatches, or everything darker than a threshold. */
  ink?: { colours: Rgb[]; tolerance?: number } | { threshold?: number };
  units: ChartUnit;
  /** Whether the chart prints depths or elevations, and the surface for elevations. */
  labels: "depth" | "elevation";
  surface?: number;
  /** Contour interval in chart units; inferred from the labels when absent. */
  interval?: number;
  /** Labels with the box of ink they are printed in, in image pixels; the boxes are erased before tracing. */
  words?: ChartWord[];
  /** Depths the maker placed by clicking a contour, in image pixels. */
  marks?: PlacedMark[];
  /** The map rectangle, so a legend or margin is not traced. */
  mapArea?: { left: number; top: number; right: number; bottom: number };
  resolutionM: number;
  title: string;
  attestation: ChartAttestation;
  /** SHA-256 of the uploaded file, for the record's provenance. */
  fileSha256: string;
  tool: string;
  /** Record id; one is generated from the lake's name when absent. */
  id?: string;
  /**
   * Which of the chart's plausible placements on the lake to use, best first.
   * A lake that looks the same turned half round fits both ways equally, so
   * the maker steps through them while comparing the lake bed with the chart.
   */
  placement?: number;
}

export interface ChartBuildResult {
  record: UserChartBathymetryV1;
  report: ChartRecordReport & {
    /** Share of traced contour length that ended with a level. */
    coverage: number;
    labelled: number;
    inferred: number;
    /** Overlap between the snapped chart shore and the lake outline. */
    iou: number;
    /** True when the snap is too poor to trust without the maker looking at it. */
    snapUncertain: boolean;
    /** Plausible placements there are to step through; the one used is `placement`. */
    placements: number;
    placement: number;
    /** True when another placement fits about as well: the outline alone cannot choose. */
    ambiguous: boolean;
  };
}

/** Placements this close in overlap to the best are as good a fit as it is. */
const AMBIGUOUS_IOU = 0.05;

const SLUG = /[^a-z0-9]+/g;

/** A record id from the lake's name, unique enough that two traces never collide. */
export function chartId(name: string | undefined, random: () => number = Math.random): string {
  const base = (name ?? "lake").toLowerCase().replace(SLUG, "-").replace(/^-|-$/g, "").slice(0, 40) || "lake";
  const suffix = Math.floor(random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${base}-chart-${suffix}`.slice(0, 64);
}

const ringLength = (ring: readonly Point2[]): number => {
  let total = 0;
  for (let index = 1; index < ring.length; index += 1) total += Math.hypot(ring[index]![0] - ring[index - 1]![0], ring[index]![1] - ring[index - 1]![1]);
  return total;
};

/**
 * The shore the snap is fitted from: the longest traced line that closes, or
 * the longest line of all when nothing closed. A chart's outer shore is its
 * longest ink by a wide margin, so this is steadier than a width rule.
 */
export function shorelineFor(trace: { shoreline: Point2[][]; contours: { points: Point2[]; closed: boolean }[]; lines?: { points: Point2[] }[] }): Point2[] | undefined {
  const candidates = trace.shoreline.length ? trace.shoreline : trace.contours.filter((contour) => contour.closed).map((contour) => contour.points);
  // Fall back to every traced line, including lines no level reached: the shore
  // is usually one of them, and placing the chart must not wait on levelling.
  const rings = candidates.length ? candidates : [...trace.contours, ...(trace.lines ?? [])].map((line) => line.points);
  let best: Point2[] | undefined;
  let bestLength = 0;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const length = ringLength(ring);
    if (length > bestLength) { best = ring; bestLength = length; }
  }
  return best;
}

/**
 * Why no contour got a depth, in the maker's terms. The record's own error
 * names ids and batch steps, which mean nothing in the studio.
 */
function levellingFailure(diagnostics: { labels: number; labelled: number; labelDisagreements: number; contradictoryRegions: number }): string {
  if (!diagnostics.labels) return "The placed depths could not be read. Type each as a number, such as 10 or 2.5.";
  if (!diagnostics.labelled) return "None of the placed depths is on a traced line. Click on the contour line itself, a little away from its printed number.";
  if (diagnostics.labelDisagreements || diagnostics.contradictoryRegions) return "The placed depths disagree with each other or with the contour interval. Check each depth, and that the interval matches the chart.";
  return "The contours could not be given depths from these. Place depths on two neighbouring contours.";
}

export function buildChartFromImage(request: ChartBuildRequest, random: () => number = Math.random): ChartBuildResult {
  if (request.lake.outline.length < 3) throw new Error("This lake has no outline to place the chart against.");
  // Without the surface every elevation becomes a negative depth, and the
  // maker would be told no contour got a level instead of what is missing.
  if (request.labels === "elevation" && !Number.isFinite(request.surface)) throw new Error("Enter the water surface elevation the chart's heights are measured against.");
  if (request.review) return buildReviewedChart(request, random);
  const trace = traceRasterChart(request.image, {
    ...(request.ink ? { ink: request.ink } : {}),
    labels: request.labels,
    ...(request.surface === undefined ? {} : { surface: request.surface }),
    ...(request.interval === undefined ? {} : { interval: request.interval }),
    ...(request.words ? { words: request.words } : {}),
    ...(request.marks ? { marks: request.marks } : {}),
    ...(request.mapArea ? { mapArea: request.mapArea } : {}),
    // Frames, roads and lettering are often bold too, so the shore is not
    // guessed from stroke width; it comes from the traced lines themselves.
    shoreline: "none",
  });
  const shoreline = shorelineFor(trace);
  if (!shoreline) throw new Error("No lines were traced from this image. Check which ink is contour line, or crop to the map.");
  if (!trace.contours.length) throw new Error(levellingFailure(trace.diagnostics));

  // The best placement, and after it only those good enough to be the right one.
  const candidates = snapCandidates(shoreline, request.lake.outline).filter((candidate, index) => index === 0 || candidate.iou >= SNAP_MIN_IOU);
  const placement = Math.max(0, Math.min(candidates.length - 1, Math.trunc(request.placement ?? 0)));
  const snap = candidates[placement]!;
  const { record, report } = buildChartRecord({
    id: request.id ?? chartId(request.lake.name, random),
    lake: { ...(request.lake.name ? { name: request.lake.name } : {}), ...(request.lake.region ? { region: request.lake.region } : {}), ...(request.lake.hylakId ? { hylakId: request.lake.hylakId } : {}) },
    georef: { matrix: snap.matrix, rmsM: snap.rmsM, method: "snap", iou: snap.iou },
    units: request.units,
    labels: request.labels === "depth" ? { kind: "depth" } : { kind: "elevation", surfaceElevationM: (request.surface ?? 0) * CHART_UNIT_METRES[request.units] },
    interval: trace.interval,
    contours: trace.contours.map((contour) => ({ points: contour.points, closed: contour.closed, value: contour.value })),
    // The lake's own outline is the water: the chart was just snapped onto it,
    // and it is a cleaner boundary than a shore traced from ink.
    water: { lonLat: [request.lake.outline] },
    resolutionM: request.resolutionM,
    provenance: { title: request.title, fileSha256: request.fileSha256, tool: request.tool },
    license: { attestation: request.attestation },
  });

  return {
    record,
    report: {
      ...report,
      coverage: Math.round(trace.diagnostics.coverage * 1000) / 1000,
      labelled: trace.diagnostics.labelled,
      inferred: trace.diagnostics.inferred,
      iou: Math.round(snap.iou * 1000) / 1000,
      snapUncertain: snap.iou < SNAP_MIN_IOU,
      placements: candidates.length,
      placement,
      ambiguous: candidates.filter((candidate) => candidate.iou >= candidates[0]!.iou - AMBIGUOUS_IOU).length > 1,
    },
  };
}

/** Production route: never re-detect, infer, or replace a reviewed contour. */
function buildReviewedChart(request: ChartBuildRequest, random: () => number): ChartBuildResult {
  const review = request.review!;
  const issues = reviewGeometryIssues(review, request);
  if (issues.length) throw new Error(issues[0]!.message);
  if (!review.alignmentConfirmed) throw new Error("Review the aligned map outline over the source chart before generating depths.");
  const alignment = reviewAlignment(review, request.lake.outline);
  const shore = review.contours.find(c => c.id === review.shorelineId)!;
  const islands = review.contours.filter(c => !c.excluded && c.role === "island" && c !== shore);
  const active = review.contours.filter(c => !c.excluded && c !== shore && c.role !== "island");
  const result = buildChartRecord({
    id: request.id ?? chartId(request.lake.name, random), lake: request.lake,
    georef: { method: "control-points", matrix: alignment.matrix, rmsM: alignment.rmsM, controlPoints: review.controlPoints, iou: alignment.iou },
    units: request.units,
    labels: request.labels === "depth" ? { kind: "depth" } : { kind: "elevation", surfaceElevationM: request.surface! * CHART_UNIT_METRES[request.units] },
    explicitInteriors: true, contours: active.map(c => ({ points: c.points, closed: c.closed, value: c.value!, inside: c.inside ?? "deeper", ...(c.interiorValue === undefined ? {} : { interiorValue: c.interiorValue }) })),
    water: { pixels: [shore.points, ...islands.map(c => c.points)] }, resolutionM: request.resolutionM,
    provenance: { title: request.title, fileSha256: request.fileSha256, tool: "chart-reviewed-v1" },
    license: { attestation: request.attestation },
  });
  if (result.record.contours.length !== active.length || result.record.contours.some(c => c.line.length < 3)) throw new Error("A reviewed contour was lost at this grid resolution. This chart needs a higher-detail workflow before it can be used.");
  return { ...result, report: { ...result.report, coverage: 1, labelled: active.length, inferred: 0, iou: alignment.iou, snapUncertain: false, placements: 1, placement: 0, ambiguous: false } };
}
