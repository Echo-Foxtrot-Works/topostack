import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test("nests the parts onto stock sheets with sparrow and exports one file per sheet", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.route("**/v1/events", (route) => route.fulfill({ status: 204 }));

  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Build the landscape." })).toBeVisible();
  await page.getByRole("button", { name: /generate terrain/i }).first().click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 60_000 });

  await page.getByRole("button", { name: "Export", exact: true }).click();
  // The nesting engine is credited wherever the tool appears.
  await expect(page.getByRole("link", { name: /^sparrow/ })).toHaveAttribute("href", "https://github.com/JeroenGar/sparrow");
  await page.getByRole("radio", { name: "Nested sheets" }).check();
  await page.getByRole("spinbutton", { name: "Sheet width", exact: true }).fill("400");
  await page.getByRole("spinbutton", { name: "Sheet height", exact: true }).fill("300");
  await page.getByRole("combobox", { name: "Search time" }).selectOption("10");
  await page.getByRole("button", { name: "Nest parts" }).click();
  await expect(page.getByRole("button", { name: /Stop and keep best/ })).toBeVisible();
  // The search runs for its budget in the worker; the button returns once it settles.
  await expect(page.getByRole("button", { name: "Nest again" })).toBeVisible({ timeout: 60_000 });
  const status = page.locator(".sheet-layout-status");
  await expect(status).toContainText(/\d+ sheets? · \d+% material used/);
  // The WebAssembly engine started: no fallback note.
  await expect(status).not.toContainText("could not start");
  await expect(page.locator(".sheet-previews li")).not.toHaveCount(0);
  await expect(page.locator(".export-hero")).toContainText("nested sheet");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Complete project/ }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  const names = Object.keys(files);
  expect(names).toContain("crater-lake-sheet-01.svg");
  expect(names).toContain("crater-lake-sheet-01-engrave.svg");
  expect(names.some((name) => /-panel-|layer-\d+\.svg$/.test(name))).toBe(false);
  const manifest = JSON.parse(Buffer.from(files["crater-lake-project.json"]!).toString("utf8"));
  expect(manifest.result.fabrication.sheetNesting.engine).toMatchObject({ name: "sparrow", jaguaVersion: "0.8.3" });
  const sheet = Buffer.from(files["crater-lake-sheet-01.svg"]!).toString("utf8");
  expect(sheet).toContain('viewBox="0 0 400 300"');
  expect(sheet).toMatch(/<g id="part-1-CUT" data-part="[^"]+" data-layers="[^"]+" transform="matrix\(/);
  const readme = Buffer.from(files["README.txt"]!).toString("utf8");
  expect(readme).toContain("sparrow");

  // After a reload the same design finds its saved layout; no second search.
  const summary = (await status.textContent())?.trim();
  await page.reload();
  await page.getByRole("button", { name: /generate terrain/i }).first().click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Nested sheets" })).toBeChecked();
  await expect(page.locator(".sheet-layout-status")).toHaveText(summary!);
  await expect(page.locator(".export-hero")).toContainText("nested sheet");
  expect(browserErrors).toEqual([]);
});
