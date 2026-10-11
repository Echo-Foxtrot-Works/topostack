/** Manual integration check against a local Vite app + Worker with development R2. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { artifactDirectory, openBrowserCheck } from "../lib/browser-check.mjs";
import { unzipSync } from "fflate";
import { appUrl } from "../lib/app-url.mjs";

const baseURL = appUrl("NOAA_TEST_APP_URL");
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Use a local Vite app for this development-data check.");
const coreUrl = `/@fs${fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))}`;
const { page, errors, output: artifacts, run } = await openBrowserCheck({
  output: artifactDirectory(process.env.NOAA_TEST_OUTPUT, "noaa-validation"),
  pageOptions: { viewport: { width: 1440, height: 1000 } },
  defaultTimeout: 120_000,
  failureReport: true,
});
const reports = [];
await run(async () => {
  await page.goto(`${baseURL}/studio`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Build the landscape." }).waitFor();
  for (const [name, hylakId, lon, lat] of [
    ["Superior", 5, -87, 47.5], ["Michigan", 6, -87, 44], ["Huron", 8, -82.5, 44.7],
    ["Erie", 9, -81.5, 42], ["Ontario", 7, -77.8, 43.6], ["Saint Clair", 66, -82.7, 42.45],
  ]) {
    const result = await page.evaluate(async ({ name, hylakId, lon, lat }) => {
      const { loadSurveyedLakeDepths } = await import("/src/lib/domain/data-provider.ts");
      const grid = { width: 16, height: 16, values: new Float32Array(256), min: 0, max: 0 };
      const loaded = await loadSurveyedLakeDepths({ west: lon - 0.02, east: lon + 0.02, south: lat - 0.02, north: lat + 0.02 }, grid, 11,
        [{ id: String(hylakId), kind: "lake", name, hylakId, polygon: { outer: [], holes: [] } }]);
      const samples = Array.from(loaded.areas[0].bathymetry?.depthsM ?? []).filter(Number.isFinite);
      return { name, status: loaded.status, samples: samples.length, minDepthM: Math.min(...samples), maxDepthM: Math.max(...samples) };
    }, { name, hylakId, lon, lat });
    assert.equal(result.status, "available", `${name} coverage`);
    assert(result.samples > 0 && result.maxDepthM > 0 && result.maxDepthM < 1500, `${name} depths`);
    reports.push(result);
    console.log(JSON.stringify(result));
  }

  console.log("Checking browser generation and export…");
  const project = await page.evaluate(async (coreUrl) => {
    const { DEFAULT_PROJECT } = await import(coreUrl);
    return { ...DEFAULT_PROJECT, id: "noaa-live-validation", name: "NOAA Erie validation", widthMm: 300, heightMm: 240,
      location: { lat: 41.8, lon: -81.55, zoom: 9, label: "Lake Erie", bounds: { west: -82.2, east: -80.9, south: 41.3, north: 42.3 } },
      showRoads: false, showTrails: false, showBoundaries: false, showWaterDepth: false };
  }, coreUrl);
  await page.locator('input[type="file"]').setInputFiles({ name: "noaa.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.locator(".status-line").filter({ hasText: "Project imported" }).waitFor();
  await page.getByRole("tab", { name: "Water", exact: true }).click();
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
    return manifest;
  }
  console.log("NOAA depth enabled after generation.");
  const surveyed = await downloadProject("noaa-surveyed");
  assert(JSON.stringify(surveyed).includes("noaa-great-lakes-v1"), "Export includes NOAA dataset version");
  assert(JSON.stringify(surveyed).includes("NOAA NCEI Great Lakes Bathymetry"), "Export includes NOAA attribution");
  await page.screenshot({ path: `${artifacts}/noaa-erie.png`, fullPage: true });
  reports.push({ case: "enable depth after generation and export", status: "passed" });

  console.log("Measured-depth export verified; testing NOAA failure…");
  await page.route("**/v1/bathymetry/**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: /generate terrain/i }).click();
  await page.locator(".status-line").filter({ hasText: "Real terrain ready" }).waitFor();
  await page.getByText("Some surveyed lake-floor data is unavailable.", { exact: false }).waitFor();
  const fallback = await downloadProject("noaa-fallback");
  assert(JSON.stringify(fallback).includes("BATHYMETRY_FALLBACK"), "Export records unavailable NOAA data");
  assert(!JSON.stringify(fallback).includes("noaa-great-lakes-v1"), "Fallback does not claim NOAA dataset usage");
  reports.push({ case: "NOAA network failure and fallback export", status: "passed" });
  assert.deepEqual(errors, [], "Browser errors");
  await writeFile(`${artifacts}/report.json`, JSON.stringify(reports, null, 2) + "\n");
  console.log(`NOAA live checks passed. Artifacts: ${artifacts}`);
});
