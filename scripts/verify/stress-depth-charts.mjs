// Opt-in, network-backed real-chart probe. Start Vite with the public map API first.
// See docs/reports/real-depth-chart-stress-2026-09-23.md for scope and reproduction.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import { PNG } from "pngjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdfPage } from "@topostack/chart-trace/pdf";
import { parseUserChartBathymetry, decodeChartDepths } from "@topostack/data-contracts/chart-bathymetry";
import { traceVectorChart } from "@topostack/chart-trace/trace-vector";
import { sha256Hex } from "../lib/hash.mjs";
import { pinnedDownload } from "../lib/pinned-download.mjs";

const work = resolve(".topostack/real-chart-stress");
const baseURL = process.env.CHART_STRESS_URL ?? "http://127.0.0.1:5278";
const browserName = process.env.CHART_STRESS_BROWSER ?? "chromium";
const sources = [
  { id: "walden", name: "Walden Pond", url: "https://pubs.usgs.gov/wri/wri014137/pdf/cover.pdf", sha256: "77c75ce92fdfc82a57593f5e3be2c314e1675e9d4ce4a2676ccad91ff4d0b234", area: [710, 285, 1130, 548], scale: 4, units: "m", labels: "depth", interval: 2, styles: ["#01509f/1.00"], location: [42.439, -71.3387] },
  { id: "viking", name: "Lake Viking", url: "https://pubs.usgs.gov/sim/3486/sim3486_sheet07.pdf", sha256: "e345ee6736011a9475bc4d24c8b5dc55e5c33ed87fdc2ae59eb6ea5157a1fc65", area: [1260, 280, 2380, 1620], scale: 2, units: "ft", labels: "elevation", surface: 863.8, interval: 5, styles: ["#9b9c9f/0.70", "#2c2e35/1.00"], shore: ["#0065b7/1.00"], location: [39.925, -94.073] },
  { id: "king-city", name: "King City South Lake", url: "https://pubs.usgs.gov/sim/3486/sim3486_sheet02.pdf", sha256: "fa79e13715a4037bd4a3b412676363c1e451a377eac01d958dbe417d400ec5c6", area: [1045, 210, 2235, 1600], scale: 2, units: "ft", labels: "elevation", surface: 1028.5, interval: 2, styles: ["#9b9c9f/0.70", "#2c2e35/1.00"], shore: ["#0065b7/1.00"], location: [40.04144, -94.5007] },
];
function contains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
await mkdir(`${work}/sources`, { recursive: true });
await mkdir(`${work}/rendered`, { recursive: true });
const legacy = process.env.CHART_STRESS_LEGACY === "1";
if (!legacy && process.env.CHART_STRESS_GENERATE === "1") throw new Error("Use scripts/verify/chart-release/generate.mjs with an exported reviewed chart for live generation.");
const output = `${work}/${browserName}${legacy ? "" : "/review-required"}`;
await mkdir(output, { recursive: true });
const receiptPath = `${output}/results${process.env.CHART_STRESS_ONLY ? `-${process.env.CHART_STRESS_ONLY}` : ""}.json`;
const receipt = { date: new Date().toISOString(), browser: browserName, baseURL, sources: [], scenarios: [] };
for (const source of sources) {
  const pdf = `${work}/sources/${source.id}.pdf`;
  const bytes = await pinnedDownload({ url: source.url, sha256: source.sha256, file: pdf, label: `Source ${source.id}` });
  const page = await readPdfPage(pdfjs, new Uint8Array(bytes));
  const [left, top, right, bottom] = source.area;
  const traced = traceVectorChart(page, { labels: source.labels, surface: source.surface, interval: source.interval, contourStyles: source.styles, shorelineStyles: source.shore, mapArea: { left, top, right, bottom } });
  // Printed labels provide the values; their matching vector contours provide
  // click positions away from text gaps. This is NOT independent survey truth.
  const waterRings = source.id === "walden" ? page.paths.filter(path => path.fill === "#8cacd5").map(path => path.points) : traced.shoreline;
  assert(waterRings.length, `Missing source shoreline: ${source.id}`);
  source.marks = page.texts.filter(text => waterRings.some(ring => contains(ring, text.x, text.y))).filter(text => text.x > left && text.x < right && text.y > top && text.y < bottom && /^\d[\d,]*(\.\d+)?$/.test(text.text)).flatMap(text => {
    const value = Number(text.text.replaceAll(",", ""));
    if (value < (source.surface ? source.surface - 80 : 2) || value >= (source.surface ?? 40)) return [];
    let best;
    for (const contour of traced.contours.filter(contour => contour.value === value)) for (const [x, y] of contour.points) {
      const distance = Math.hypot(x - text.x, y - text.y);
      if (distance > text.size * 1.3 && distance < 20 && (!best || distance < best.distance)) best = { x, y, distance };
    }
    return best ? [{ x: best.x, y: best.y, value, label: text.text }] : [];
  });
  source.page = { width: page.width, height: page.height };
  source.crop = `${work}/rendered/${source.id}-crop.png`;
  execFileSync("pdftoppm", ["-r", String(72 * source.scale), "-x", String(left * source.scale), "-y", String(top * source.scale), "-W", String((right - left) * source.scale), "-H", String((bottom - top) * source.scale), "-png", "-singlefile", pdf, source.crop.replace(/\.png$/, "")]);
  receipt.sources.push({ ...source, vectorDiagnostics: traced.diagnostics, license: "USGS-authored map panel; public domain. Reservoir location insets contain OpenStreetMap data and are not promoted into guide images." });
}
const walden = PNG.sync.read(await readFile(sources[0].crop));
for (let i = 0; i < walden.data.length; i += 4) {
  const ink = walden.data[i] < 90 && walden.data[i + 1] < 145 && walden.data[i + 2] < 200;
  walden.data[i] = walden.data[i + 1] = walden.data[i + 2] = ink ? 0 : 255;
  walden.data[i + 3] = 255;
}
const inkPath = `${work}/rendered/walden-ink.png`;
await writeFile(inkPath, PNG.sync.write(walden));
const scenarios = sources.flatMap(source => [
  { source, id: `${source.id}-pdf`, file: `${work}/sources/${source.id}.pdf`, full: true },
  { source, id: `${source.id}-crop`, file: source.crop },
  ...(source.id === "walden" ? [{ source, id: "walden-ink-three", file: inkPath, minimum: true }, { source, id: "walden-ink-dense", file: inkPath, lifecycle: true }] : []),
]);
const browser = await ({ chromium, firefox, webkit }[browserName]).launch({ headless: true, ...(browserName === "firefox" && process.platform === "darwin" ? { env: { ...process.env, MOZ_APP_DATA: resolve("node_modules/.cache/topostack/firefox-app-data") } } : {}) });
try {
  for (const scenario of scenarios.filter(s => !process.env.CHART_STRESS_ONLY || s.id === process.env.CHART_STRESS_ONLY)) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const result = { id: scenario.id, errors, missed: [], collisions: [] };
    try {
      await page.goto(`${baseURL}/studio`);
      await page.getByRole("radio", { name: "Custom data", exact: true }).click();
      // Test setup uses real cached/live outlines and the actual selection
      // function; name search and map-pointer hit testing are outside this probe.
      const source = scenario.source;
      const cache = `${work}/${source.id}-lake.json`;
      let lake = await readFile(cache, "utf8").then(JSON.parse).catch(() => undefined);
      if (!lake) lake = await page.evaluate(async ([lat, lon]) => {
        const { lakeAt } = await import("/src/lib/domain/lake-lookup.ts");
        return lakeAt(lat, lon);
      }, source.location);
      assert(lake, `No lake outline at ${source.location}`);
      await writeFile(cache, JSON.stringify(lake, null, 2));
      result.lake = { id: lake.id, hylakId: lake.hylakId, originalName: lake.name, vertices: lake.outline.length, sha256: sha256Hex(JSON.stringify(lake.outline)) };
      await page.evaluate(async lake => {
        const { chooseLake } = await import("/src/lib/studio/customdata/lake-picker.svelte.ts");
        await chooseLake(lake);
      }, { ...lake, name: source.name });
      const started = performance.now();
      await page.locator(".chart-upload input").setInputFiles(scenario.file);
      const canvas = page.locator(".chart-canvas");
      await expect(canvas).toBeVisible({ timeout: 60000 });
      await expect(canvas).toHaveAttribute("aria-busy", "false", { timeout: 60000 });
      result.uploadMs = Math.round(performance.now() - started);
      result.image = await canvas.evaluate(c => ({ width: c.width, height: c.height }));
      await page.getByLabel("Depths are in", { exact: true }).selectOption(source.units);
      await page.getByLabel("The chart prints", { exact: true }).selectOption(source.labels);
      if (source.surface) await page.getByLabel("Surface level", { exact: true }).fill(String(source.surface));
      await page.getByLabel("Contour interval", { exact: true }).fill(String(source.interval));
      const marks = scenario.minimum ? [10, 20, 30].map(value => source.marks.find(mark => mark.value === value)) : source.marks;
      for (const mark of marks) {
        assert(mark);
        const [left, top, right, bottom] = scenario.full ? [0, 0, source.page.width, source.page.height] : source.area;
        const box = await canvas.boundingBox();
        await canvas.click({ position: { x: (mark.x - left) / (right - left) * box.width, y: (mark.y - top) / (bottom - top) * box.height } });
        const dialog = page.getByRole("dialog", { name: /Assign point|Edit point/ });
        // Wait for Svelte's event update before checking a missed contour.
        await page.waitForTimeout(50);
        if (!await dialog.isVisible()) { result.missed.push(mark); continue; }
        if ((await dialog.innerText()).includes("Edit point")) {
          result.collisions.push(mark);
          await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
          continue;
        }
        await dialog.getByRole("spinbutton").fill(String(mark.value));
        if (scenario.lifecycle && await page.locator(".chart-depths li").count() === 0) await page.screenshot({ path: `${output}/walden-point-entry.png` });
        await dialog.getByRole("button", { name: /Confirm/ }).click();
      }
      result.points = await page.locator(".chart-depths li").count();
      if (result.points >= 3) {
        // An independent main-thread timer measures responsiveness during work.
        await page.evaluate(() => {
          window.__chartProbe = { last: performance.now(), maxGap: 0, ticks: 0 };
          window.__chartProbeTimer = setInterval(() => {
            const now = performance.now(), probe = window.__chartProbe;
            probe.maxGap = Math.max(probe.maxGap, now - probe.last); probe.last = now; probe.ticks++;
          }, 50);
        });
        const traceStarted = performance.now();
        await page.getByRole("button", { name: legacy ? "Trace chart" : "Prepare contours", exact: true }).click();
        await expect.poll(() => page.evaluate(async () => {
          const { session, resultIsCurrent } = await import("/src/lib/studio/customdata/chart-tracing.svelte.ts");
          const { draft } = await import("/src/lib/studio/customdata/chart-draft.svelte.ts");
          return !session.busy && (Boolean(session.error) || Boolean(draft.review) || resultIsCurrent());
        }), { timeout: 120000 }).toBe(true);
        result.traceMs = Math.round(performance.now() - traceStarted);
        const state = await page.evaluate(async () => {
          clearInterval(window.__chartProbeTimer);
          const { draft } = await import("/src/lib/studio/customdata/chart-draft.svelte.ts");
          const { session } = await import("/src/lib/studio/customdata/chart-tracing.svelte.ts");
          return { review: draft.review, report: draft.result?.report, record: draft.result?.record, error: session.error, heartbeat: window.__chartProbe, points: draft.depths };
        });
        result.report = state.report; result.error = state.error; result.heartbeat = state.heartbeat;
        result.status = state.review ? "awaiting-contour-review" : state.report ? "traced-needs-quality-review" : "trace-rejected";
        if (!legacy && state.review) {
          assert.equal(state.record, undefined, "No grid may be generated before review");
          await expect(page.getByRole("button", { name: "Generate reviewed depths", exact: true })).toBeDisabled();
          result.productionGate = "unreviewed contours cannot generate depths";
        }
        await writeFile(`${output}/${scenario.id}-record.json`, JSON.stringify(state, null, 2));
        if (state.report) {
          const chart = parseUserChartBathymetry(state.record);
          const values = Array.from(decodeChartDepths(chart.grid)).filter(Number.isFinite);
          result.gridValidation = { contract: "passed", validCells: values.length, nonzeroCells: values.filter(value => value > 0).length, minM: Math.min(...values), maxM: Math.max(...values) };
          await expect(page.locator(".depth-3d canvas:visible")).toBeVisible();
          await page.mouse.move(0, 0);
          await page.screenshot({ path: `${output}/${scenario.id}.png` });
        }
        if (scenario.lifecycle && state.report) {
          assert(state.report.deepestM >= 30 && state.report.deepestM <= 34, "Walden's printed 30 m basin must be represented");
          assert(state.report.coverage >= 0.85, "Dense Walden coverage regressed");
          await page.getByLabel("3D surface style", { exact: true }).selectOption("dem");
          await expect(page.locator(".dem-3d canvas")).toBeVisible();
          await page.screenshot({ path: `${output}/walden-shaded-dem.png` });
          await page.setViewportSize({ width: 390, height: 844 });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile horizontal overflow");
          await page.locator(".chart-preview").scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${output}/walden-mobile-review.png` });
          await page.setViewportSize({ width: 1600, height: 1100 });
          await page.getByLabel("Where this chart came from", { exact: true }).selectOption("public-domain");
          await page.getByRole("button", { name: "Keep this chart", exact: true }).click();
          await expect(page.locator(".chart-saved")).toContainText(source.name);
          await page.getByRole("button", { name: `Use for ${source.name}`, exact: true }).click();
          await page.getByRole("button", { name: "Export", exact: true }).click();
          const download = page.waitForEvent("download");
          await page.getByRole("button", { name: /^Project settings/ }).click();
          const file = `${output}/walden-project.json`;
          await (await download).saveAs(file);
          const exported = JSON.parse(await readFile(file, "utf8"));
          assert.equal(exported.charts.length, 1);
          assert.equal(exported.charts[0].license.attestation, "public-domain");
          assert.equal(exported.charts[0].provenance.fileSha256, sha256Hex(await readFile(scenario.file)));
          assert.equal(exported.project.userDepthCharts[String(lake.hylakId)].id, exported.charts[0].id);
          await page.reload();
          await page.getByRole("radio", { name: "Custom data", exact: true }).click();
          await expect(page.locator(".chart-saved")).toContainText(source.name);
          await expect(page.getByRole("button", { name: "Stop using", exact: true })).toBeVisible();
          await page.screenshot({ path: `${output}/walden-library-restored.png` });
          await page.getByRole("button", { name: "Stop using", exact: true }).click();
          await expect(page.getByRole("button", { name: `Use for ${source.name}`, exact: true })).toBeVisible();
          result.lifecycle = "save/apply/export/reload/stop-use passed; mobile and both previews passed";
        }
      } else result.status = "point-input-blocked";
      assert.deepEqual(errors, [], "Uncaught browser errors");
      if (!result.report) await page.screenshot({ path: `${output}/${scenario.id}.png` });
    } catch (error) {
      result.failure = error.message;
      result.status = "probe-failed";
      await page.screenshot({ path: `${output}/${scenario.id}-failure.png` }).catch(() => {});
    } finally {
      receipt.scenarios.push(result);
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
      console.log(JSON.stringify(result));
      await context.close();
    }
  }
  if (process.env.CHART_STRESS_GENERATE === "1") {
    // Fresh browser storage proves that the exported file carries the chart.
    const exported = JSON.parse(await readFile(`${output}/walden-project.json`, "utf8"));
    exported.project.location = { lat: 42.4391, lon: -71.3396, label: "Walden Pond, Massachusetts", zoom: 14, bounds: { west: -71.348, south: 42.434, east: -71.331, north: 42.445 } };
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${baseURL}/studio`);
      await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: "walden-project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
      await expect(page.getByText("Project imported with its depth chart · generate to refresh its terrain", { exact: true }).first()).toBeVisible({ timeout: 30000 });
      await page.getByRole("button", { name: "Generate terrain", exact: true }).click();
      await expect(page.getByText("Ready to export", { exact: true }).first()).toBeVisible({ timeout: 180000 });
      await expect(page.getByText("Some lake floors come from a traced depth chart. They are only as accurate as the chart and its tracing.", { exact: true })).toBeVisible();
      receipt.terrain = { status: "imported chart and generated live terrain", errors, text: await page.locator("body").innerText() };
      await page.screenshot({ path: `${output}/walden-generated-map.png` });
      await page.getByRole("radio", { name: "3D stack", exact: true }).click();
      await expect(page.locator("canvas:visible").first()).toBeVisible();
      await page.screenshot({ path: `${output}/walden-generated-stack.png` });
      assert.deepEqual(errors, []);
    } finally {
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
      await context.close();
    }
  }
} finally { await browser.close(); }
if (receipt.scenarios.some(result => result.failure)) process.exitCode = 1;
