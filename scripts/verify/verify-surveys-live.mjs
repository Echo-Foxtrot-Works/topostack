/** Manual integration check against a local Vite app + Worker with development R2. */
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "@playwright/test";
import { artifactDirectory, openBrowserCheck } from "../lib/browser-check.mjs";
import { unzipSync } from "fflate";

const baseURL = process.env.SURVEY_TEST_APP_URL ?? "http://localhost:5293";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Use a local Vite app for this development-data check.");
const coreUrl = `/@fs${fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))}`;
const browserName = process.env.SURVEY_TEST_BROWSER ?? "chromium";
if (!["chromium", "firefox", "webkit"].includes(browserName)) throw new Error("Unknown survey test browser.");
const firefoxData = join(tmpdir(), "topostack-survey-firefox");
if (browserName === "firefox") await mkdir(firefoxData, { recursive: true });
const { page, errors, output: artifacts, run } = await openBrowserCheck({
  output: artifactDirectory(process.env.SURVEY_TEST_OUTPUT, "survey-validation"),
  browserType: ({ chromium, firefox, webkit })[browserName],
  launchOptions: browserName === "firefox"
    ? { firefoxUserPrefs: { "webgl.force-enabled": true }, env: { ...process.env, MOZ_APP_DATA: firefoxData } } : {},
  pageOptions: { viewport: { width: 1440, height: 1000 } },
  defaultTimeout: 120_000,
  failureReport: true,
});
const reports = [];
const { values: flags } = parseArgs({ options: { "local-archives": { type: "string" }, dataset: { type: "string" }, "coverage-only": { type: "boolean", default: false } } });
const localArchives = flags["local-archives"];
if (localArchives) {
  // Exercise the real browser decoder with built bytes before external promotion.
  await page.route("**/v1/bathymetry/*.pmtiles", async (route) => {
    const dataset = new URL(route.request().url()).pathname.split("/").at(-1);
    if (!/^[a-z0-9-]+\.pmtiles$/.test(dataset ?? "")) return route.abort();
    const bytes = await readFile(resolve(localArchives, dataset)).catch(() => null);
    if (!bytes) return route.continue();
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end || start >= bytes.length) return route.fulfill({ status: 416 });
    await route.fulfill({ status: range ? 206 : 200, body: bytes.subarray(start, end + 1), headers: {
      "content-type": "application/octet-stream", "accept-ranges": "bytes", "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range,etag", etag: '"local-survey-test"',
      ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
    } });
  });
}
await run(async () => {
  await page.goto(`${baseURL}/studio`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Build the landscape." }).waitFor();
  const cases = [
    { name: "Crater Lake", dataset: "usgs-crater-lake-v1", bounds: { west: -122.18, east: -122.04, south: 42.89, north: 42.99 } },
    { name: "Lake Tahoe", dataset: "usgs-lake-tahoe-v1", bounds: { west: -120.17, east: -119.90, south: 38.92, north: 39.26 } },
    { name: "Mono Lake", dataset: "usgs-mono-lake-v1", bounds: { west: -119.2, east: -118.87, south: 37.92, north: 38.08 } },
    { name: "Lake Minnetonka", dataset: "mn-dnr-lakes-v1", bounds: { west: -93.72, east: -93.45, south: 44.85, north: 45.02 } },
  ];
  const pins = JSON.parse(await readFile(new URL("../data/lake-survey-sources.json", import.meta.url), "utf8"));
  for (const item of pins.filter((pin) => pin.dataset === "swissbathy3d-v1")) {
    const [west, south, east, north] = item.bbox;
    cases.push({ name: item.id, dataset: item.dataset, bounds: { west, south, east, north } });
  }
  cases.push(...JSON.parse(await readFile(new URL("../data/lake-survey-validation.json", import.meta.url), "utf8")));
  const selected = flags.dataset;
  const selectedCases = cases.filter((item) => !selected || selected.split(",").includes(item.dataset));
  assert(selectedCases.length > 0, "No survey verification cases selected");
  for (const test of selectedCases) {
    const result = await page.evaluate(async ({ test, coreUrl }) => {
      const { loadSurveyedLakeDepths, loadLakeAreas } = await import("/src/lib/domain/data-provider.ts");
      const { DEFAULT_PROJECT } = await import(coreUrl);
      const config = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200 };
      const lakes = await loadLakeAreas(test.bounds, 12, config);
      const grid = { width: 64, height: 64, values: new Float32Array(4096), min: 0, max: 0 };
      const loaded = await loadSurveyedLakeDepths(test.bounds, grid, 14, lakes, undefined, config);
      const samples = loaded.areas.flatMap((area) => Array.from(area.bathymetry?.depthsM ?? []).filter(Number.isFinite));
      return { name: test.name, status: loaded.status, datasetVersions: loaded.datasetVersions, samples: samples.length,
        minDepthM: Math.min(...samples), maxDepthM: Math.max(...samples), lakes: lakes.map((lake) => ({ name: lake.name, id: lake.hylakId, surfaceElevationM: lake.surfaceElevationM })) };
    }, { test, coreUrl });
    assert.equal(result.status, "available", `${test.name} coverage: ${JSON.stringify(result)}`);
    assert(result.datasetVersions.includes(test.dataset), `${test.name} source`);
    assert(result.samples > 0 && result.maxDepthM > 0 && result.maxDepthM < 1500, `${test.name} depths`);
    if (test.name === "Crater Lake") assert(result.maxDepthM > 550 && result.maxDepthM < 610, "Crater Lake measured depth");
    reports.push(result);
    console.log(JSON.stringify(result));
  }

  if (flags["coverage-only"]) {
    assert.deepEqual(errors, [], "Browser errors");
    await writeFile(`${artifacts}/coverage-report.json`, JSON.stringify(reports, null, 2) + "\n");
    console.log("Survey coverage checks passed.");
  } else {
  console.log("Checking browser generation and export…");
  const project = await page.evaluate(async (coreUrl) => {
    const { DEFAULT_PROJECT } = await import(coreUrl);
    return { ...DEFAULT_PROJECT, id: "survey-live-validation", name: "USGS Crater Lake validation", widthMm: 300, heightMm: 240,
      location: { lat: 42.94, lon: -122.11, zoom: 12, label: "Crater Lake", bounds: { west: -122.19, east: -122.02, south: 42.88, north: 43.01 } },
      showRoads: false, showTrails: false, showBoundaries: false, showWaterDepth: false };
  }, coreUrl);
  await page.locator('input[type="file"]').setInputFiles({ name: "survey.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.locator(".status-line").filter({ hasText: "Project imported" }).waitFor();
  await page.getByRole("button", { name: "Expand all" }).click();
  await page.getByRole("button", { name: /generate terrain/i }).click();
  await page.locator(".status-line").filter({ hasText: "Real terrain ready" }).waitFor();
  assert.equal(await page.getByRole("switch", { name: "Water depth", exact: true }).getAttribute("aria-checked"), "false");
  await page.getByRole("switch", { name: "Water depth", exact: true }).click();
  await page.getByText("Surveyed lake-floor data is used where available.", { exact: false }).waitFor();
  await page.getByText("Ready to export", { exact: true }).waitFor();

  async function downloadProject(label) {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const ready = page.waitForEvent("download");
    await page.getByRole("button", { name: /Complete project/ }).click();
    const download = await ready;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    await writeFile(`${artifacts}/${label}.zip`, bytes);
    const files = unzipSync(bytes);
    const manifestKey = Object.keys(files).find((name) => name.endsWith("-project.json"));
    assert(manifestKey, "Export includes project metadata");
    const manifest = JSON.parse(Buffer.from(files[manifestKey]).toString("utf8"));
    const masterKey = Object.keys(files).find((name) => name.endsWith("-master.svg"));
    assert(masterKey && Buffer.from(files[masterKey]).toString("utf8").includes('data-operation="CUT"'));
    await page.getByRole("button", { name: "Close export dialog", exact: true }).click();
    const paths = [...Buffer.from(files[masterKey]).toString("utf8").matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]);
    return { manifest, paths };
  }
  console.log("Survey depth enabled after generation.");
  const surveyed = await downloadProject("crater-surveyed");
  assert(JSON.stringify(surveyed).includes("usgs-crater-lake-v1"), "Export includes Survey dataset version");
  assert(JSON.stringify(surveyed).includes("USGS Crater Lake multibeam bathymetry"), "Export includes Survey attribution");
  await page.screenshot({ path: `${artifacts}/crater-lake.png`, fullPage: true });
  reports.push({ case: "enable depth after generation and export", status: "passed" });

  console.log("Checking Crater Lake depth fitting…");
  await page.getByRole("button", { name: "Fit depth", exact: true }).click();
  const fitSwitch = page.getByRole("switch", { name: "Fit lake depth to available layers", exact: true });
  await page.getByText("% of requested depth.", { exact: false }).waitFor();
  await page.getByText("Ready to export", { exact: true }).waitFor();
  assert.equal(await fitSwitch.getAttribute("aria-checked"), "true");
  const fitted = await downloadProject("crater-fitted");
  assert.equal(fitted.manifest.project.fitLakeDepth, true);
  assert.equal(fitted.manifest.result.layers.length, surveyed.manifest.result.layers.length, "Fitting keeps the layer budget");
  assert(!fitted.manifest.result.warnings.some((warning) => warning.code === "WATER_DEPTH_CLAMPED"), "Fitting removes the clipping warning");
  const lake = fitted.manifest.result.lakeDepths.find((lake) => lake.hylakId === 9092);
  assert(lake && lake.depthFitScale > 0 && lake.depthFitScale < 1, "Crater Lake reports compression");
  assert.equal(lake.appliedDepthExaggeration, lake.depthFitScale * fitted.manifest.project.waterDepthExaggeration);
  assert.notDeepEqual(fitted.paths, surveyed.paths, "Fitting changes fabricated contours");
  await page.screenshot({ path: `${artifacts}/crater-fitted.png`, fullPage: true });
  reports.push({ case: "Crater Lake fit warning action, geometry, and export", status: "passed", lake, layers: fitted.manifest.result.layers.length });
  await fitSwitch.click();
  await page.getByRole("button", { name: "Fit depth", exact: true }).waitFor();
  await page.getByText("Ready to export", { exact: true }).waitFor();
  const restored = await downloadProject("crater-restored");
  assert.deepEqual(restored.paths, surveyed.paths, "Turning fitting off restores the original geometry");

  console.log("Measured-depth export verified; testing Survey failure…");
  await page.route("**/v1/bathymetry/**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: /generate terrain/i }).click();
  await page.locator(".status-line").filter({ hasText: "Real terrain ready" }).waitFor();
  await page.getByText("Some surveyed lake-floor data is unavailable.", { exact: false }).waitFor();
  const fallback = await downloadProject("crater-fallback");
  assert(JSON.stringify(fallback).includes("BATHYMETRY_FALLBACK"), "Export records unavailable Survey data");
  assert(!JSON.stringify(fallback).includes("usgs-crater-lake-v1"), "Fallback does not claim Survey dataset usage");
  assert.notDeepEqual(surveyed.paths, fallback.paths, "Survey data changes the fabrication paths");
  reports.push({ case: "Survey network failure, changed geometry, and fallback export", status: "passed" });
  assert.deepEqual(errors, [], "Browser errors");
  await writeFile(`${artifacts}/report.json`, JSON.stringify(reports, null, 2) + "\n");
  console.log(`Survey live checks passed. Artifacts: ${artifacts}`);
  }
});
