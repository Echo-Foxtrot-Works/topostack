import { expect, test } from "@playwright/test";
import { showPanel } from "./studio-panels";

async function openLocation(page: import("@playwright/test").Page): Promise<void> {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.goto("/studio");
  if ((page.viewportSize()?.width ?? 1280) <= 760) await showPanel(page, "Place");
  await page.locator(".location-card").first().click();
  await expect(page.getByRole("dialog", { name: "Choose anywhere" })).toBeVisible();
}

test("current location updates coordinates and closes the selector", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 39.7392, longitude: -104.9903 });
  await openLocation(page);
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choose anywhere" })).not.toBeVisible();
  await page.locator(".location-card").first().click();
  await expect(page.getByRole("spinbutton", { name: "Latitude", exact: true })).toHaveValue("39.7392");
  await expect(page.getByRole("spinbutton", { name: "Longitude", exact: true })).toHaveValue("-104.9903");
});

test("location permission errors allow retry and manual entry", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 1 } as GeolocationPositionError),
    } });
  });
  await openLocation(page);
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Location access was denied");
  await expect(page.getByRole("button", { name: "Use current location", exact: true })).toBeEnabled();
  await page.getByRole("spinbutton", { name: "Latitude", exact: true }).fill("40");
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page.getByRole("button", { name: "Use coordinates", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choose anywhere" })).not.toBeVisible();
});

test("a late location response cannot replace manually entered coordinates", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition: (success: PositionCallback) => {
        Object.assign(window, { finishLocation: () => success({ coords: { latitude: 12, longitude: 34 } } as GeolocationPosition) });
      },
    } });
  });
  await openLocation(page);
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(page.getByRole("button", { name: "Locating…", exact: true })).toBeDisabled();
  await page.getByRole("spinbutton", { name: "Latitude", exact: true }).fill("40");
  await page.evaluate(() => (window as unknown as { finishLocation: () => void }).finishLocation());
  await expect(page.getByRole("dialog", { name: "Choose anywhere" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Latitude", exact: true })).toHaveValue("40");
});


test("lake-directory completion does not move location actions during a click", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await page.route("**/data/lake-depth-directory.json", async route => { await gate; await route.continue(); });
  await openLocation(page);
  const dialog = page.getByRole("dialog", { name: "Choose anywhere" });
  const close = dialog.getByRole("button", { name: "Close dialog", exact: true });
  const before = (await close.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  resume();
  await expect(dialog.locator(".lake-search-summary")).toContainText("lakes and basins available");
  const after = (await close.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
  await page.mouse.up();
  await expect(dialog).not.toBeVisible();
});
