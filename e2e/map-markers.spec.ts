import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.route("https://tiles.openfreemap.org/styles/**", (route) => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#2468ac" } }],
  } }));
  await page.goto("/studio");
  // Markers are placed in the custom data view, on its own map.
  await page.getByRole("radio", { name: "Custom data", exact: true }).click();
  await page.getByRole("tab", { name: "Markers", exact: true }).click();
});

test("markers are placed by clicking the map and moved by dragging", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const place = page.getByRole("button", { name: "Place on map" });
  await place.click();
  await expect(page.getByRole("radio", { name: "Custom data", exact: true }), "placing stays in the custom data view").toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Done placing" })).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator(".map-canvas canvas");
  await expect(canvas).toBeVisible();
  const box = (await page.locator(".map-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(page.locator(".marker-card")).toHaveCount(2);
  const firstLon = Number(await page.getByRole("spinbutton", { name: "Marker 1 longitude", exact: true }).inputValue());
  const secondLon = Number(await page.getByRole("spinbutton", { name: "Marker 2 longitude", exact: true }).inputValue());
  expect(secondLon).toBeGreaterThan(firstLon);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Place on map" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("tab", { name: "Paths", exact: true }).click();
  await page.getByRole("tab", { name: "Markers", exact: true }).click();
  // With placement off, a click pans nothing and adds nothing.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.locator(".marker-card")).toHaveCount(2);

  const marker = page.locator(".topostack-map-marker").first();
  const before = Number(await page.getByRole("spinbutton", { name: "Marker 1 latitude", exact: true }).inputValue());
  const markerBox = (await marker.boundingBox())!;
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "Marker 1 latitude", exact: true }).inputValue())).toBeLessThan(before);
  expect(errors).toEqual([]);
});

test("an uploaded SVG becomes a marker symbol on the card and the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Add marker" }).click();
  await expect(page.locator(".marker-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Use an SVG for this marker" }).click();
  await page.locator("[data-marker-icon-import]").setInputFiles({
    name: "cabin.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10 12 3l9 7v11H3Z"/><rect x="9" y="14" width="6" height="7"/></svg>`),
  });
  const symbols = page.getByRole("radiogroup", { name: "Marker 1 symbol" });
  await expect(symbols.getByRole("radio", { name: "cabin" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Marker icons")).toContainText("Icons");
  await expect(page.locator(".topostack-map-marker")).toHaveAttribute("data-symbol", "custom");
  await expect(page.locator(".topostack-map-marker")).toHaveAttribute("aria-label", /cabin marker at/);

  // Removing the icon leaves the marker in place as a pin.
  await page.getByRole("button", { name: "Remove icon cabin" }).click();
  await expect(symbols.getByRole("radio", { name: "Pin" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".topostack-map-marker")).toHaveAttribute("data-symbol", "pin");
  expect(errors).toEqual([]);
});
