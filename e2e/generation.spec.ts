import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test("generates deterministic real terrain and downloads the complete fabrication package", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));

  const usage: Record<string, unknown>[] = [];
  await page.route("**/v1/events", async (route) => {
    usage.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto("/studio");
  await expect(page.getByRole("tab", { name: "Place", exact: true })).toBeVisible({ timeout: 30_000 });
  // The bundled real-data preview must never be exportable: fail closed until
  // the user generates fresh terrain.
  await expect(page.getByText("Generate before export")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("button", { name: /Complete project/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Project settings/ })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: /Cut layers/ }).click();
  await expect(page.locator(".layer-heading")).toContainText(/Layer \d+.*of 12/);
  await expect(page.locator('[data-marking-kind="road"]')).not.toHaveCount(0);
  await page.getByRole("radio", { name: /3D stack/ }).click();
  const preview = page.locator(".preview-stage");
  const mapDetails = [
    ["Features", "Roads", "data-road-markings"],
    ["Features", "Trails", "data-trail-markings"],
    ["Water", "Water outlines", "data-water-markings"],
    ["Fabricate", "Assembly guides", "data-alignment-markings"],
    ["Labels", "Elevation labels", "data-elevation-markings"],
    ["Labels", "North arrow", "data-north-markings"],
    ["Labels", "Scale bar", "data-scale-markings"],
  ] as const;
  // Component tests cover every switch transition. Keep the browser test focused
  // on rendered output plus one representative live geometry refresh.
  for (const [panel, label, attribute] of mapDetails) {
    await page.getByRole("tab", { name: panel, exact: true }).click();
    await expect(page.getByRole("switch", { name: label })).toBeChecked();
    await expect.poll(async () => Number(await preview.getAttribute(attribute)), { timeout: 15_000 }).toBeGreaterThan(0);
  }
  await page.getByRole("tab", { name: "Place", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("1200");
  await expect(page.locator(".status-line")).toContainText("Fabrication geometry updated", { timeout: 30_000 });
  await expect(page.locator(".preview-readout")).toContainText("1200 × 200 mm");
  await page.getByRole("button", { name: /Regenerate terrain/ }).click();

  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 30_000 });
  await expect(page.getByText("Ready to export")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadButton = page.getByRole("button", { name: /Complete project/ });
  await expect(downloadButton).toBeEnabled();
  // Nests and seams sit beside the sheet layout they feed.
  await expect(page.getByRole("switch", { name: "Material-saving nests" })).toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "Glue margin", exact: true })).toHaveValue("8");

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("crater-lake-project-files.zip");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  expect(Object.keys(files)).toContain("README.txt");
  const masterSvg = files["crater-lake-master.svg"];
  expect(masterSvg).toBeDefined();
  const svg = Buffer.from(masterSvg!).toString("utf8");
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('data-operation="CUT"');
  // Layer count is derived, and this 1200 mm cut resolves into thin bands, so
  // the base layer's face may be too narrow for its label. Assert the engraved
  // elevation labels exist rather than pinning one layer's.
  expect(svg).toMatch(/id="elevation-\d+"/);
  expect(svg).toContain('id="alignment-layer-01-to-02-');
  expect(svg).toContain("data-layers=");
  expect(svg).not.toContain("<text");
  expect(svg).toContain("Crater Lake — master layout");
  expect(svg).toContain("Made with TopoStack");
  expect(Buffer.from(files["README.txt"]!).toString("utf8")).toContain("Made with TopoStack");
  expect(browserErrors).toEqual([]);
  await expect(page.locator(".export-feedback")).toContainText("Download ready");
  await expect.poll(() => usage.map((event) => event.event)).toEqual(["studio_open", "generation_started", "generation_succeeded", "export_prepared"]);
  expect(usage.at(-1)).toMatchObject({ output: "stack", delivery: "browser" });
});

test("persists the selected color scheme across reloads", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/studio");
  const themeColor = page.locator('meta[name="theme-color"]');
  await expect(themeColor).toHaveCount(1);
  const menu = page.getByRole("button", { name: /^Studio menu/ });
  await menu.click();
  await expect(page.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await menu.click();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await expect(themeColor).toHaveCount(1);
  await expect(themeColor).toHaveAttribute("content", "#161814");
});

test("location dialog traps focus and restores it on Escape", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/studio");
  const trigger = page.locator(".location-card");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose anywhere" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Search places")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("compact layouts keep the preview and controls reachable", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/studio");

  await expect(page.locator(".project-name > span")).toHaveText("Project name");
  await expect(page.locator(".terrain-contextbar").getByRole("radiogroup", { name: "Output type" })).toBeVisible();

  const previewBox = await page.locator(".preview-panel").boundingBox();
  const controlsBox = await page.locator(".config-panel").boundingBox();
  expect(previewBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(previewBox!.height).toBeGreaterThan(400);
  expect(controlsBox!.y).toBeGreaterThanOrEqual(previewBox!.y + previewBox!.height);

  await page.setViewportSize({ width: 320, height: 700 });
  const topbarBox = await page.locator(".topbar").boundingBox();
  expect(topbarBox).not.toBeNull();
  // Mobile uses two rows so the project name and history remain available.
  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  const projectName = page.getByRole("textbox", { name: "Project name", exact: true });
  const historyActions = page.locator(".history-actions");
  await expect(exportButton).toBeInViewport({ ratio: 1 });
  await expect(projectName).toBeInViewport({ ratio: 1 });
  await expect(historyActions).toBeInViewport({ ratio: 1 });
  const exportBox = (await exportButton.boundingBox())!;
  const projectBox = (await projectName.boundingBox())!;
  const historyBox = (await historyActions.boundingBox())!;
  expect(projectBox.y).toBeGreaterThanOrEqual(exportBox.y + exportBox.height);
  expect(projectBox.x + projectBox.width).toBeLessThanOrEqual(historyBox.x);
  expect(Math.max(projectBox.y + projectBox.height, historyBox.y + historyBox.height)).toBeLessThanOrEqual(topbarBox!.y + topbarBox!.height);
  await expect(page.locator(".preview-toolbar")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("radiogroup", { name: "Output type" })).toBeVisible();

  await page.getByRole("tab", { name: "Place", exact: true }).click();
  const widthField = page.getByRole("spinbutton", { name: "Width", exact: true });
  await widthField.scrollIntoViewIfNeeded();

  // Firefox may report a 44px CSS target as 43.999996px in layout coordinates.
  const decrementBox = await page.getByRole("button", { name: "Decrease Width" }).boundingBox();
  const incrementBox = await page.getByRole("button", { name: "Increase Width" }).boundingBox();
  expect(decrementBox).not.toBeNull();
  expect(incrementBox).not.toBeNull();
  expect(decrementBox!.width).toBeGreaterThanOrEqual(44 - 0.01);
  expect(incrementBox!.width).toBeGreaterThanOrEqual(44 - 0.01);

  const numberInput = page.locator(".number-input").filter({ has: widthField });
  const numberFieldBox = await numberInput.locator(".ldt-number-field").boundingBox();
  const unitBox = await numberInput.locator("em").boundingBox();
  expect(numberFieldBox).not.toBeNull();
  expect(unitBox).not.toBeNull();
  expect(numberFieldBox!.x + numberFieldBox!.width).toBeLessThanOrEqual(unitBox!.x + 0.5);

  const presetBox = await page.getByRole("button", { name: "Grand Canyon", exact: true }).boundingBox();
  await page.getByRole("tab", { name: "Features", exact: true }).click();
  const roadsBox = await page.getByRole("switch", { name: "Roads" }).boundingBox();
  expect(roadsBox!.height).toBeGreaterThanOrEqual(44 - 0.01);
  expect(presetBox!.height).toBeGreaterThanOrEqual(44 - 0.01);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});


test("export dialog supports keyboard dismissal, project backups, and compact layouts", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.goto("/studio");
  const trigger = page.getByRole("button", { name: "Export", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Export your project" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Complete project/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /Master SVG/ })).toBeHidden();
  await dialog.getByText("Individual files").click();
  await expect(dialog.getByRole("button", { name: /Master SVG/ })).toBeDisabled();
  await expect(dialog.getByText("Donations are optional.", { exact: false })).toBeVisible();
  const downloadReady = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /Project settings/ }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe("crater-lake-project.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString()).project.name).toBe("Crater Lake");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole("radio", { name: "Flat engraving", exact: true }).click();
  await trigger.click();
  await expect(dialog.getByRole("button", { name: /Engraving SVG/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Cut panels/ })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: /Project settings/ }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: /Project settings/ })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
