import { parseReviewDraft, type ChartReviewDraftFile } from "$lib/domain/chart-review-draft";
import { reviewGeometryIssues, reviewAlignment } from "$lib/domain/chart-review";
import { styleKey } from "@topostack/chart-trace/vector-chart";
import type { ChartBuildRequest } from "$lib/domain/chart-build";
import type { ChartContour } from "$lib/domain/chart-contours";
import { CHART_BATHYMETRY_LIMITS, decodeChartDepths, type ChartAttestation, type ChartUnit, type UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import type { ChartImage } from "$lib/domain/chart-build";
import type { UserDepthChartRefV1 } from "@topostack/core";
import { ChartTraceClient } from "$lib/workers/chart-trace-client";
import { draft, draftRevision, resetChartImage } from "$lib/studio/customdata/chart-draft.svelte";

/**
 * Tracing one depth chart: reading the picture, reviewing its contours, and
 * asking the worker for the lake bed they give.
 *
 * The controls sit in the sidebar and the chart being clicked fills the
 * viewport, so neither component can own this. It lives here with the draft,
 * which means it also survives the view being left and reopened.
 *
 * Depths are typed by the maker, not read by machine. A recognizer reads
 * labels set into contour lines poorly, and a wrong depth is worse than no
 * depth: it carves a lake bed that looks right.
 */

/** Charts are traced at most this wide or tall: enough detail, bounded memory. */
const MAX_SIDE = 2400;

export const CHART_UNITS: { value: ChartUnit; label: string }[] = [
  { value: "ft", label: "Feet" },
  { value: "m", label: "Metres" },
  { value: "fathom", label: "Fathoms" },
];
export const CHART_READS = [
  { value: "depth", label: "Depth below the surface" },
  { value: "elevation", label: "Height above a datum" },
];
export const CHART_ATTESTATIONS: { value: ChartAttestation; label: string }[] = [
  { value: "own-work", label: "I made this chart myself" },
  { value: "public-domain", label: "It is in the public domain" },
  { value: "open-license", label: "Its licence allows reuse" },
  { value: "personal-use", label: "Someone else's chart, for my own use only" },
];

/** The name typed for the chart, within the record's limit, or one made from the lake's. */
function chartTitle(): string {
  return draft.title.trim().slice(0, CHART_BATHYMETRY_LIMITS.title) || `${draft.lake?.name ?? "Lake"} depth chart`;
}

/** What is happening to the draft right now, as opposed to what it holds. */
export const session = $state({ busy: false, keeping: false, error: "" });

/** Why the chart cannot be traced yet, or an empty string when it can. */
export function traceHint(): string {
  if (draft.reads === "elevation" && !Number.isFinite(typedNumber(draft.surface))) return "Enter the water surface elevation in the same units as the chart.";
  return "";
}

export function canTrace(): boolean {
  return !traceHint();
}

export function unitLabel(unit: ChartUnit): string {
  return unit === "m" ? "m" : unit === "ft" ? "ft" : "fathoms";
}

let client: ChartTraceClient | undefined;
let operation = 0;

/** Frees the trace worker. The custom data view calls this as it closes. */
export function disposeTracer(): void {
  client?.dispose();
  client = undefined;
}

async function digestOf(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A decoded page as the engine reads it, and as the canvas redraws it. */
function asChartImage(pixels: ImageData): { image: ChartImage; pixels: ImageData } {
  return { image: { width: pixels.width, height: pixels.height, data: pixels.data }, pixels };
}

const isPdf = (file: File): boolean => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Decodes the upload to RGBA, shrinking anything larger than MAX_SIDE. */
async function readImage(file: File): Promise<{ image: ChartImage; pixels: ImageData }> {
  const source = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const page = document.createElement("canvas");
    page.width = width;
    page.height = height;
    const context = page.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot read image pixels.");
    context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    return { image: { width, height, data: pixels.data }, pixels };
  } finally {
    source.close();
  }
}

/**
 * Reads a chart upload: a picture, or one page of a PDF drawn as a picture.
 * The PDF reader is loaded only when a PDF is chosen.
 */
export async function chooseChartFile(file: File | undefined, page = 1): Promise<void> {
  if (!file) return;
  const mine = ++operation;
  const revision = draftRevision();
  const current = () => mine === operation && revision === draftRevision();
  disposeTracer();
  session.error = "";
  session.busy = true;
  try {
    const pdf = isPdf(file);
    const [read, digest] = await Promise.all([
      pdf ? import("$lib/domain/chart-pdf").then(async ({ renderPdfPage }) => renderPdfPage(new Uint8Array(await file.arrayBuffer()), page, MAX_SIDE)) : readImage(file),
      digestOf(file),
    ]);
    if (!current()) return;
    if ("blank" in read && read.blank) {
      // The chart may be on another page: offer the pages, not a blank picture.
      resetChartImage();
      draft.pdf = { file, pages: read.pages, page: read.page };
      draft.imageName = file.name;
      session.error = `Page ${read.page} of this PDF is blank here. Choose the page the chart is on; if every page is blank, save the chart as a PNG or JPEG instead.`;
      return;
    }
    const { image, pixels } = "pages" in read ? asChartImage(read.pixels) : read;
    resetChartImage();
    draft.image = image;
    draft.vectorPage = "vectors" in read ? read.vectors : undefined;
    draft.pixels = pixels;
    draft.imageName = "pages" in read && read.pages > 1 ? `${file.name}, page ${read.page}` : file.name;
    draft.pdf = "pages" in read ? { file, pages: read.pages, page: read.page } : undefined;
    draft.fileSha256 = digest;
    draft.title ||= `${draft.lake?.name ?? "Lake"} depth chart`;
  } catch (cause) {
    if (current()) session.error = cause instanceof Error ? cause.message : "This file could not be read as an image.";
  } finally {
    if (mine === operation) session.busy = false;
  }
}

/** Draws the chart with every placed depth marked on it, and the keyboard crosshair when it has one. */
export function paintChart(canvas: HTMLCanvasElement, crosshair?: { x: number; y: number }, contour?: ChartContour): void {
  const context = canvas.getContext("2d");
  const image = draft.image;
  if (!context || !image) return;
  if (draft.pixels) context.putImageData(draft.pixels, 0, 0);
  if (contour?.points.length) {
    const scale = image.width / (canvas.getBoundingClientRect().width || image.width);
    const accent = getComputedStyle(canvas).getPropertyValue("--loidolt-accent").trim() || "#c4511b";
    for (const [colour, width] of [["#ffffff", 7], [accent, 3]] as const) {
      context.strokeStyle = colour;
      context.lineWidth = width * scale;
      context.beginPath();
      contour.points.forEach(([x, y], i) => { if (i === 0) context.moveTo(x, y); else context.lineTo(x, y); });
      if (contour.closed) context.closePath();
      context.stroke();
    }
  }
  context.lineWidth = Math.max(2, image.width / 400);
  context.font = `${Math.max(12, Math.round(image.width / 40))}px sans-serif`;
  context.textBaseline = "middle";
  const radius = Math.max(6, image.width / 120);
  for (const [index, depth] of draft.depths.entries()) {
    context.strokeStyle = "#b3261e";
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(depth.x, depth.y, radius, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
    context.fillStyle = "#b3261e";
    context.fillText(`${index + 1} · ${depth.value}`, depth.x + radius * 1.4, depth.y);
  }
  if (crosshair) {
    // Drawn twice, light under dark, so it shows on ink and on paper alike.
    const arm = radius * 3;
    for (const [colour, width] of [["#ffffff", context.lineWidth * 2.5], ["#1d4ed8", context.lineWidth]] as const) {
      context.strokeStyle = colour;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(crosshair.x - arm, crosshair.y); context.lineTo(crosshair.x + arm, crosshair.y);
      context.moveTo(crosshair.x, crosshair.y - arm); context.lineTo(crosshair.x, crosshair.y + arm);
      context.stroke();
    }
  }
}

/** The finished lake bed, shallow to deep, so its shape can be checked at a glance. */
export function paintDepthPreview(canvas: HTMLCanvasElement): void {
  const record = draft.result?.record;
  const context = canvas.getContext("2d");
  if (!record || !context) return;
  const depths = decodeChartDepths(record.grid);
  const { width, height } = record.grid;
  canvas.width = width;
  canvas.height = height;
  const pixels = context.createImageData(width, height);
  let deepest = 0;
  for (const depth of depths) if (!Number.isNaN(depth)) deepest = Math.max(deepest, depth);
  for (let index = 0; index < depths.length; index += 1) {
    const depth = depths[index]!;
    const at = index * 4;
    if (Number.isNaN(depth)) { pixels.data[at + 3] = 0; continue; }
    const share = deepest ? depth / deepest : 0;
    pixels.data[at] = Math.round(222 * (1 - share) + 8 * share);
    pixels.data[at + 1] = Math.round(238 * (1 - share) + 46 * share);
    pixels.data[at + 2] = Math.round(255 * (1 - share) + 122 * share);
    pixels.data[at + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
}

/**
 * Everything a trace is made from. A result traced from other inputs is out of
 * date: it must not be kept, and a trace that finishes after the inputs moved
 * on must not land on the new draft.
 */
export function reviewSourceKey(): string {
  return JSON.stringify([draft.lake?.id, draft.lake?.outline, draft.lake?.spanKm, draft.image?.width, draft.image?.height, draft.fileSha256, draft.pdf?.page ?? 0, draft.placement, draft.depths.map(({ x, y, value, reach }) => [x, y, value, reach]), draft.units, draft.reads, draft.reads === "elevation" ? draft.surface : "", draft.interval, draft.vectorStyles]);
}

export function traceInputsKey(): string {
  return JSON.stringify([reviewSourceKey(), draft.review]);
}

/** Whether the traced result still matches what is on screen. */
export function resultIsCurrent(): boolean {
  return draft.result !== undefined && draft.resultKey === traceInputsKey();
}

const typedNumber = (text: string): number => (String(text).trim() === "" ? Number.NaN : Number(text));

function buildRequest(): ChartBuildRequest {
  const image = draft.image!, lake = draft.lake!;
  return {
    image: { width: image.width, height: image.height, data: image.data },
    lake: { name: lake.name, ...(lake.hylakId === undefined ? {} : { hylakId: lake.hylakId }), outline: lake.outline.map(([lon, lat]) => [lon, lat]) },
    units: draft.units, labels: draft.reads,
    ...(draft.reads === "elevation" ? { surface: typedNumber(draft.surface) } : {}),
    interval: typedNumber(draft.interval),
    marks: draft.depths.map(({ x, y, value, reach }) => ({ x, y, value, reach })),
    ...(draft.vectorPage && draft.vectorStyles.length ? { sourceContours: draft.vectorPage.paths.filter(p => p.stroke && draft.vectorStyles.includes(styleKey(p))).map(p => ({ points: p.points.map(([x, y]) => [x, y] as [number, number]), closed: p.closed })) } : {}),
    resolutionM: Math.max(5, ...lake.spanKm.map(km => km * 1000 / 512)), title: chartTitle(), attestation: draft.attestation, fileSha256: draft.fileSha256, tool: "chart-trace", placement: draft.placement,
  };
}

/** Extract proposed geometry only; no depth grid is generated before review. */
export async function traceChart(): Promise<void> {
  if (!draft.image || !draft.lake || !canTrace() || session.busy || session.keeping) return;
  const mine = ++operation, revision = draftRevision(), key = reviewSourceKey();
  session.busy = true; session.error = "";
  client ??= new ChartTraceClient();
  try {
    const review = await client.prepare(buildRequest());
    if (mine !== operation || revision !== draftRevision() || key !== reviewSourceKey()) return;
    draft.reviewRevision += 1; draft.review = review; draft.reviewSourceKey = key;
    draft.result = undefined; draft.resultKey = ""; draft.layersReviewedKey = "";
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return;
    if (mine === operation && revision === draftRevision() && key === reviewSourceKey()) session.error = cause instanceof Error ? cause.message : "Contours could not be prepared.";
  } finally { if (mine === operation) session.busy = false; }
}

export function generationIssues(): string[] {
  if (!draft.review || !draft.image || !draft.lake) return ["Prepare and review the contours first."];
  if (draft.reviewSourceKey !== reviewSourceKey()) return ["Chart settings changed. Prepare the contours again before generating depths."];
  const request = buildRequest();
  const messages = reviewGeometryIssues(draft.review, request).map(i => i.message);
  try { reviewAlignment(draft.review, request.lake.outline); }
  catch (error) { messages.push(error instanceof Error ? error.message : "Check the alignment."); }
  if (!draft.review.alignmentConfirmed) messages.push("Confirm the aligned map outline against the source chart.");
  return [...new Set(messages)];
}

export async function generateReviewedDepths(): Promise<void> {
  if (session.busy || session.keeping) return;
  const issues = generationIssues();
  if (issues.length) { session.error = issues[0]!; return; }
  const mine = ++operation, revision = draftRevision(), key = traceInputsKey();
  session.busy = true; session.error = ""; draft.layersReviewedKey = "";
  client ??= new ChartTraceClient();
  try {
    const result = await client.build({ ...buildRequest(), review: JSON.parse(JSON.stringify(draft.review)) });
    if (mine !== operation || revision !== draftRevision() || key !== traceInputsKey()) return;
    draft.result = result; draft.resultKey = key;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return;
    if (mine === operation && revision === draftRevision() && key === traceInputsKey()) session.error = cause instanceof Error ? cause.message : "Depth generation failed.";
  } finally { if (mine === operation) session.busy = false; }
}

export function canKeepChart(): boolean {
  return resultIsCurrent() && !!draft.review && draft.layersReviewedKey === draft.resultKey && !generationIssues().length && !session.busy && !session.keeping;
}

/**
 * Hands the traced record to the library. Saving is the studio's job, so the
 * caller passes it in and this module stays free of the studio context.
 */
export async function keepChart(save: (record: UserChartBathymetryV1) => Promise<UserDepthChartRefV1>): Promise<boolean> {
  const traced = draft.result?.record;
  if (!traced || !canKeepChart()) return false;
  session.keeping = true;
  session.error = "";
  // The name and where the chart came from are asked for after the trace, so
  // they are applied here rather than baked in when it was traced.
  const record: UserChartBathymetryV1 = {
    ...traced,
    review: { version: 1, profile: "contour-topology-v1", reviewedAt: new Date().toISOString(), contours: true, alignment: true, layers: true },
    provenance: { ...traced.provenance, title: chartTitle() },
    license: { ...traced.license, attestation: draft.attestation },
  };
  try {
    await save(record);
    return true;
  } catch (cause) {
    session.error = cause instanceof Error ? cause.message : "This chart could not be saved in this browser.";
    return false;
  } finally {
    session.keeping = false;
  }
}

/**
 * Traces again with the chart laid on the lake the next plausible way. A lake
 * that looks the same turned half round fits both ways, and only the maker,
 * comparing the lake bed with the chart, can say which is right.
 */
export async function tryNextPlacement(): Promise<void> {
  const report = draft.result?.report;
  if (!report || report.placements < 2) return;
  draft.placement = (report.placement + 1) % report.placements;
  await traceChart();
}

export function resetSession(): void {
  operation += 1;
  disposeTracer();
  session.busy = false;
  session.keeping = false;
  session.error = "";
}

export function exportReviewDraft(): ChartReviewDraftFile | undefined {
  if (!draft.review || !draft.image || draft.reviewSourceKey !== reviewSourceKey()) return undefined;
  return {
    schema: "chart-review-draft-v1",
    source: { sha256: draft.fileSha256, page: draft.pdf?.page ?? 0, width: draft.image.width, height: draft.image.height, units: draft.units, reads: draft.reads, surface: String(draft.surface), interval: String(draft.interval) },
    review: JSON.parse(JSON.stringify(draft.review)),
  };
}

export async function restoreReviewDraft(file: File | undefined): Promise<void> {
  if (!file || !draft.image || session.busy || session.keeping) return;
  const revision = draftRevision(), key = reviewSourceKey();
  try {
    if (file.size > 10_000_000) throw new Error("Review draft exceeds the 10 MB limit.");
    const restored = parseReviewDraft(await file.text(), { sha256: draft.fileSha256, page: draft.pdf?.page ?? 0, width: draft.image.width, height: draft.image.height });
    if (revision !== draftRevision() || key !== reviewSourceKey()) return;
    draft.units = restored.source.units; draft.reads = restored.source.reads;
    draft.surface = restored.source.surface; draft.interval = restored.source.interval;
    draft.depths = []; draft.reviewRevision += 1; draft.review = restored.review; draft.reviewSourceKey = reviewSourceKey();
    draft.result = undefined; draft.resultKey = ""; draft.layersReviewedKey = ""; session.error = "";
  } catch (cause) {
    if (revision === draftRevision() && key === reviewSourceKey()) session.error = cause instanceof Error ? cause.message : "Review draft could not be restored.";
  }
}
