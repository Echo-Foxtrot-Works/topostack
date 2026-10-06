// Traces the curated depth charts in scripts/data/depth-charts.json into
// UserChartBathymetryV1 records with @topostack/chart-trace.
//
//   node scripts/data-build/trace-depth-charts.mjs [--only <id>] [--work <dir>]
//
// Each source is downloaded once into the work directory and checked against
// its sha256 pin. Vector PDFs are read with pdf.js; scanned PDFs are
// rasterized with poppler's pdftoppm; PNGs are read directly. Records whose
// licence allows publishing go to scripts/data/depth-charts/<id>.json for the
// survey archive build; the rest stay in the work directory, which is
// gitignored, along with report.json.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdfPage } from "@topostack/chart-trace/pdf";
import { writeJsonAtomic } from "../lib/files.mjs";
import { chartRecord, parseChartManifest, traceChart } from "../lib/depth-charts.mjs";
import { pinnedDownload } from "../lib/pinned-download.mjs";
import { run } from "../lib/process.mjs";

const root = new URL("../../", import.meta.url);
const { values: args } = parseArgs({ options: { only: { type: "string" }, work: { type: "string" } } });
const work = args.work ?? fileURLToPath(new URL(".topostack/depth-charts/", root));
const published = fileURLToPath(new URL("scripts/data/depth-charts/", root));
const tool = `chart-trace@${JSON.parse(await readFile(new URL("packages/chart-trace/package.json", root), "utf8")).version}`;

/** The source bytes, downloaded once and always checked against the pin. */
async function source(chart) {
  const bytes = await pinnedDownload({ url: chart.source.url, sha256: chart.source.sha256, file: join(work, "sources", chart.source.sha256), label: `Depth chart ${chart.id}`, headers: { "user-agent": "topostack-depth-charts" } });
  return new Uint8Array(bytes);
}

function decodePng(bytes) {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: png.data };
}

async function input(chart, bytes) {
  if (chart.input.kind === "pdf-vector") return { page: await readPdfPage(pdfjs, bytes, chart.input.page ?? 1) };
  if (chart.input.kind === "png") return { image: decodePng(bytes) };
  // Scanned PDF: rasterize the page at the resolution its control points were read at.
  const scratch = join(work, "raster", chart.id);
  await mkdir(scratch, { recursive: true });
  const pdf = join(scratch, "source.pdf");
  await writeFile(pdf, bytes);
  const page = String(chart.input.page ?? 1);
  await run("pdftoppm", ["-r", String(chart.input.dpi ?? 200), "-f", page, "-l", page, "-gray", "-png", "-singlefile", pdf, join(scratch, "page")]);
  const image = decodePng(await readFile(join(scratch, "page.png")));
  await rm(scratch, { recursive: true, force: true });
  return { image };
}

const manifest = parseChartManifest(JSON.parse(await readFile(new URL("scripts/data/depth-charts.json", root), "utf8")));
const charts = args.only ? manifest.filter((chart) => chart.id === args.only) : manifest;
if (!charts.length) throw new Error(`No depth chart ${args.only} in the manifest.`);
await mkdir(work, { recursive: true });
await mkdir(published, { recursive: true });
const reports = [];
for (const chart of charts) {
  const started = performance.now();
  const bytes = await source(chart);
  const traced = traceChart(chart, await input(chart, bytes));
  const { record, report } = chartRecord(chart, traced, { fileSha256: chart.source.sha256, tool });
  const target = report.publishable ? join(published, `${chart.id}.json`) : join(work, `${chart.id}.json`);
  await writeJsonAtomic(target, record);
  reports.push({ ...report, seconds: Math.round((performance.now() - started) / 100) / 10, written: target });
  console.log(`${chart.id}: ${report.contours} contours, ${Math.round(report.coverage * 100)}% levelled, grid ${report.grid}, deepest ${report.deepestM} m, georef RMS ${report.georefRmsM} m -> ${report.publishable ? "published" : "kept local"}`);
}
await writeJsonAtomic(join(work, "report.json"), { tool, charts: reports });
