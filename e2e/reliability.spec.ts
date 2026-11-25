import { expect, test } from "@playwright/test";
import { DEFAULT_PROJECT, fitCutBounds } from "@topostack/core";
import { showExportStep } from "./studio-panels";

test("keeps generation and location controls usable when WebGL is unavailable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/studio");
  await expect(page.getByRole("radio", { name: /Cut layers/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('svg[aria-label^="Cut preview for layer"]')).toBeVisible();
  await expect(page.locator(".preview-notice")).toContainText("3D is unavailable");
  await page.getByRole("button", { name: /Generate terrain/ }).click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 30_000 });
  await expect(page.getByText("Ready to export")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Cut layers/ })).toHaveAttribute("aria-checked", "true");
  // Explicit retries must not overwrite the generation result either.
  await page.getByRole("radio", { name: /3D stack/ }).click();
  await expect(page.locator(".preview-notice")).toContainText("3D is unavailable");
  await expect(page.locator(".status-line")).toContainText("Real terrain ready");
  for (const output of ["Layered relief", "Flat engraving"]) {
    await page.getByRole("radio", { name: output, exact: true }).click();
    await page.getByRole("radio", { name: "Map", exact: true }).click();
    await expect(page.locator(".preview-notice")).toContainText("Map is unavailable");
    await expect(page.getByRole("radio", { name: output === "Layered relief" ? "Cut layers" : "Engraving", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Ready to export")).toBeVisible();
  }
  await page.locator(".location-card").click();
  await expect(page.getByRole("dialog", { name: "Choose anywhere" })).toBeVisible();
  await expect(page.getByLabel("Search places")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await showExportStep(page, "Download");
  await expect(page.getByRole("button", { name: /Complete project/ })).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const cropShape of ["rectangle", "circle"] as const) {
test(`keeps saved ${cropShape} bounds aligned after opening and resizing Map`, async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.route("https://tiles.openfreemap.org/styles/**", (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.goto("/studio");
  const bounds = fitCutBounds({ west: -122.3, east: -122.0, north: 43.05, south: 42.85 }, DEFAULT_PROJECT.widthMm, DEFAULT_PROJECT.heightMm);
  const project = { ...DEFAULT_PROJECT, cropShape, location: { ...DEFAULT_PROJECT.location, bounds }, markers: [
    { id: "north-west", symbol: "circle", lat: bounds.north, lon: bounds.west },
    { id: "south-east", symbol: "circle", lat: bounds.south, lon: bounds.east },
  ] };
  await page.locator('input[type="file"][accept^="application/json"]').setInputFiles({ name: "selection.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole("button", { name: /Generate terrain/ }).click();
  await expect(page.getByText("Ready to export")).toBeVisible();
  await page.getByRole("radio", { name: "Map", exact: true }).click();
  const guide = page.locator(".crop-guide");
  const markers = page.locator(".topostack-map-marker");
  await expect(markers).toHaveCount(2);
  async function expectAligned(): Promise<void> {
    await expect.poll(async () => {
      const crop = await guide.boundingBox();
      const first = await markers.nth(0).boundingBox();
      const last = await markers.nth(1).boundingBox();
      if (!crop || !first || !last) return Infinity;
      return Math.max(Math.abs(first.x + first.width / 2 - crop.x), Math.abs(first.y + first.height / 2 - crop.y), Math.abs(last.x + last.width / 2 - crop.x - crop.width), Math.abs(last.y + last.height / 2 - crop.y - crop.height));
    }).toBeLessThan(3);
    await expectCircle();
  }
  async function expectCircle(): Promise<void> {
    if (cropShape !== "circle") return;
    const frame = await guide.boundingBox();
    const outline = await page.locator(".circle-outline").boundingBox();
    expect(outline!.width / frame!.width).toBeCloseTo(Math.min(project.widthMm, project.heightMm) / project.widthMm, 2);
    expect(outline!.height / frame!.height).toBeCloseTo(Math.min(project.widthMm, project.heightMm) / project.heightMm, 2);
  }
  await expectAligned();
  await page.setViewportSize({ width: 900, height: 700 });
  await expectAligned();
  await expect(page.getByText("Ready to export")).toBeVisible();
  await page.getByRole("radio", { name: /Cut layers/ }).click();
  await page.getByRole("radio", { name: "Map", exact: true }).click();
  await expect(markers).toHaveCount(2);
  await expectAligned();
  await expect(page.getByText("Ready to export")).toBeVisible();
});
}

test("3D rendering settles when idle and resumes for preview changes", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    const counter = { draws: 0 };
    Object.assign(window, { previewDrawCounter: counter });
    for (const method of ["drawArrays", "drawElements"] as const) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args: number[]) {
        counter.draws += 1;
        Reflect.apply(original, this, args);
      };
    }
  });
  await page.goto("/studio");
  const preview = page.getByRole("button", { name: /Interactive 3D preview/ });
  await expect(preview.locator("canvas")).toBeVisible();
  const draws = () => page.evaluate(() => (window as unknown as { previewDrawCounter: { draws: number } }).previewDrawCounter.draws);
  await expect.poll(draws).toBeGreaterThan(0);
  async function expectIdle(): Promise<number> {
    // Camera damping is allowed to finish; a continuous render loop never settles.
    let previous = -1;
    await expect.poll(async () => {
      const current = await draws();
      const settled = previous === current;
      previous = current;
      return settled;
    }, { intervals: [500], timeout: 10_000 }).toBe(true);
    const settled = await draws();
    await page.waitForTimeout(600);
    expect(await draws()).toBe(settled);
    return settled;
  }
  const initial = await expectIdle();
  await preview.press("ArrowLeft");
  await expect.poll(draws).toBeGreaterThan(initial);
  const afterOrbit = await expectIdle();
  await page.locator(".explode-control input").fill("0.8");
  await expect.poll(draws).toBeGreaterThan(afterOrbit);
  const afterExplode = await expectIdle();
  await page.setViewportSize({ width: 1000, height: 750 });
  await expect.poll(draws).toBeGreaterThan(afterExplode);
  await expectIdle();
});
