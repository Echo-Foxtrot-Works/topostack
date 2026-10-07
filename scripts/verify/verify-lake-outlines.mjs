/** Exercise R2-backed provider outlines and real survey archives with HydroLAKES unavailable. */
import assert from "node:assert/strict";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openBrowserCheck } from "../lib/browser-check.mjs";

const base = process.env.SURVEY_TEST_APP_URL ?? "http://localhost:5297";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use a local Vite server");
const { values: { "local-archives": archives } } = parseArgs({ options: { "local-archives": { type: "string" } } });
assert(archives, "Pass --local-archives=<directory>");
const directory = JSON.parse(await readFile(new URL("../../apps/generator/static/data/lake-depth-directory.json", import.meta.url), "utf8"));
const datasets = ["mn-dnr-lakes-v1", "syke-finland-lakes-v1", "ontario-lakes-v1", "nve-norway-lakes-v1", "twdb-texas-reservoirs-v1", "usbr-reservoirs-v1"];
const coreUrl = `/@fs${fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))}`;
const { page, run } = await openBrowserCheck();
await run(async () => {
  await page.route("**/v1/lakes.pmtiles", (route) => route.abort());
  await page.route("**/v1/bathymetry/*.pmtiles", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").at(-1);
    if (!/^[a-z0-9-]+\.pmtiles$/.test(file)) return route.abort();
    const handle = await open(resolve(archives, file)).catch(() => undefined);
    if (!handle) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" } });
    try {
      const { size } = await handle.stat();
      const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? "");
      assert(range, "Archive requests must use bounded byte ranges");
      const start = Number(range[1]), end = Math.min(size - 1, Number(range[2]));
      const buffer = Buffer.alloc(end - start + 1);
      await handle.read(buffer, 0, buffer.length, start);
      await route.fulfill({ status: 206, body: buffer, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "etag,content-range", "content-range": `bytes ${start}-${end}/${size}`, "etag": '"local-survey"', "content-type": "application/octet-stream" } });
    } finally { await handle.close(); }
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  for (const dataset of datasets) {
    const candidates = directory.lakes.filter((lake) => lake.sourceId === dataset);
    const lake = candidates.find((lake) => lake.bounds[2] - lake.bounds[0] > 0.01 && lake.bounds[2] - lake.bounds[0] < 0.04) ?? candidates[0];
    assert(lake);
    const result = await page.evaluate(async ({ lake, coreUrl }) => {
      const { loadSurveyedLakeDepths } = await import("/src/lib/domain/data-provider.ts");
      const { loadLakeAreas } = await import("/src/lib/domain/lake-area-loader.ts");
      const { DEFAULT_PROJECT, carveWaterDepth } = await import(coreUrl);
      const [west, south, east, north] = lake.bounds;
      const bounds = { west, south, east, north };
      const config = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, minimumFeatureMm: 0.1, waterDepthExaggeration: 1 };
      const areas = await loadLakeAreas(bounds, 14, config);
      const grid = { width: 64, height: 64, values: new Float32Array(4096).fill(200), min: 200, max: 200 };
      const result = await loadSurveyedLakeDepths(bounds, grid, 14, areas, undefined, config);
      const carved = carveWaterDepth(grid, config, result.areas, 5000);
      return { name: lake.name, dataset: lake.sourceId, providers: areas.filter((area) => area.outlineSource === "provider").length,
        status: result.status, sources: result.datasetVersions, carvedCells: Array.from(carved.grid.values).filter((value) => value < 200).length };
    }, { lake, coreUrl });
    assert(result.providers > 0, JSON.stringify(result));
    assert.equal(result.status, "available", JSON.stringify(result));
    assert(result.sources.includes(dataset), JSON.stringify(result));
    assert(result.carvedCells > 0, JSON.stringify(result));
    console.log(JSON.stringify(result));
  }
});
