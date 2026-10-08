/** Local browser check for the lake directory and studio place links. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { artifactDirectory, openBrowserCheck } from "../lib/browser-check.mjs";
import { appUrl } from "../lib/app-url.mjs";

const directory = JSON.parse(await readFile(new URL("../../apps/generator/static/data/lake-depth-directory.json", import.meta.url), "utf8"));
const totalLakes = new Intl.NumberFormat("en-US").format(directory.lakes.length);

const origin = appUrl("DIRECTORY_TEST_APP_URL");
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Use a local preview for this check.");
const { browser, page, errors, output, run } = await openBrowserCheck({
  output: artifactDirectory(process.env.DIRECTORY_TEST_OUTPUT, "lake-directory"),
  pageOptions: { viewport: { width: 1440, height: 1000 } },
});
const directoryPath = `${origin}/guides/lake-depth-data`;
let catalogRequests = 0;
page.on("request", (request) => { if (request.url().endsWith("/data/lake-depth-directory.json")) catalogRequests += 1; });
async function readSaved() {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("keyval-store");
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("keyval")) { db.close(); resolve(null); return; }
      const tx = db.transaction("keyval");
      const get = tx.objectStore("keyval").get("topostack:project:v1");
      get.onsuccess = () => resolve(get.result ?? null);
      tx.oncomplete = () => db.close();
    };
  }));
}
await run(async () => {
  await page.goto(directoryPath);
  await expect(page.locator(".result-summary")).toContainText(totalLakes);
  await expect(page.locator(".lake-list > li")).toHaveCount(25);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("Page 2 of");
  const search = page.getByRole("searchbox", { name: "Search lakes" });
  await search.fill("lake geneva");
  await expect(page.getByRole("heading", { name: "Lac Léman", exact: true })).toBeVisible();
  await expect(page.locator(".pagination")).toContainText("Page 1 of 1");
  await search.fill("zurich");
  await expect(page.locator(".lake-list h2")).toHaveText("Zürichsee");
  await search.fill("");
  await page.getByLabel("Region", { exact: true }).selectOption("Finland");
  await page.getByLabel("Depth data", { exact: true }).selectOption("contours");
  await expect(page.locator(".result-summary strong")).toHaveText("1,821 lakes and basins");
  await page.getByLabel("Depth data", { exact: true }).selectOption("grid");
  await expect(page.getByRole("heading", { name: "No matching lakes" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await search.fill("tahoe");
  await expect(page.locator(".lake-list h2")).toHaveText("Lake Tahoe");
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile page must not overflow horizontally");
  const beforeStudio = catalogRequests;
  await page.locator(".studio-link").click();
  await expect(page.locator(".status-line")).toContainText("Lake selected from the depth directory");
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Lake Tahoe");
  assert.equal(new URL(page.url()).search, "", "Consume place link after selection");
  await expect.poll(async () => (await readSaved())?.location.label).toBe("Lake Tahoe");
  const saved = await readSaved();
  assert(saved.showWaterDepth && saved.outputMode === "stack");
  assert(saved.location.bounds.west < -120 && saved.location.bounds.east > -120);
  assert.equal(catalogRequests, beforeStudio, "Studio must not fetch the full lake directory");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("My Tahoe study");
  await expect.poll(async () => (await readSaved())?.name).toBe("My Tahoe study");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("My Tahoe study");
  assert.equal(catalogRequests, beforeStudio, "Standalone studio does not fetch the directory");
  const recovery = await browser.newPage();
  await recovery.route("**/data/lake-depth-directory.json", (route) => route.abort());
  await recovery.goto(directoryPath);
  await expect(recovery.getByRole("alert")).toContainText("couldn’t load");
  await recovery.unroute("**/data/lake-depth-directory.json");
  await recovery.getByRole("button", { name: "Retry" }).click();
  await expect(recovery.locator(".result-summary")).toContainText(totalLakes);
  await recovery.close();
  assert.deepEqual(errors, []);
  console.log("Lake directory passed: search, accents/aliases, filters, pagination, mobile layout, studio selection, saved edits, and load recovery.");
  console.log(`Screenshots: ${output}`);
});
