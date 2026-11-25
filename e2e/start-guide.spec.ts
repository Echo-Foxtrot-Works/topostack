import { expect, test } from "@playwright/test";

// A browser that has never opened the studio; every other spec starts past the guide.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
});

test("a first visit is guided from map type to material, then handed the settings rail", async ({ page }) => {
  await page.goto("/studio");
  const guide = page.locator(".start-guide");
  await expect(guide.getByRole("heading", { name: "What are you making?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".settings-rail")).toHaveCount(0);
  await guide.getByRole("radio", { name: /Flat engraving/ }).click();
  await expect(page.locator(".mode-switch").getByRole("radio", { checked: true })).toContainText("Engraving");
  await guide.getByRole("radio", { name: /Layered relief/ }).click();

  await guide.getByRole("button", { name: "Next", exact: true }).click();
  await expect(guide.getByRole("heading", { name: "Where, and how big?" })).toBeFocused();
  // The area is framed on the map, not on a model of the previous place.
  await expect(page.locator(".mode-switch").getByRole("radio", { checked: true })).toContainText("Map");
  await expect(guide.getByRole("spinbutton", { name: "Width", exact: true })).toBeVisible();

  await guide.getByRole("button", { name: "Load terrain and continue" }).click();
  await expect(guide.getByRole("heading", { name: "Choose the look" })).toBeVisible();
  await expect(guide.getByRole("switch", { name: "Roads", exact: true })).toBeVisible();
  // Generation finishes on the model.
  await expect(page.locator(".mode-switch").getByRole("radio", { checked: true })).toContainText("3D", { timeout: 30_000 });

  await guide.getByRole("button", { name: "Next", exact: true }).click();
  await expect(guide.getByRole("spinbutton", { name: "Material", exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.locator(".settings-rail")).toBeVisible();

  // Finished for good: a reload opens the rail.
  await page.reload();
  await expect(page.locator(".settings-rail")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".start-guide")).toHaveCount(0);
});

test("the guide can be skipped, and reopened from the studio menu", async ({ page }) => {
  await page.goto("/studio");
  const guide = page.locator(".start-guide");
  await expect(guide).toBeVisible({ timeout: 30_000 });
  await guide.getByRole("button", { name: "Skip guide" }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.locator(".settings-rail")).toBeVisible();
  await page.getByRole("button", { name: /^Studio menu/ }).click();
  await page.getByRole("menuitem", { name: "Setup guide" }).click();
  await expect(guide.getByRole("heading", { name: "What are you making?" })).toBeVisible();
});

test("a link that names a design opens it without the guide", async ({ page }) => {
  await page.goto("/studio?starter=relief");
  await expect(page.locator(".starter-steps")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".start-guide")).toHaveCount(0);
});

test("the guide fits a phone beside the preview", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/studio");
  const guide = page.locator(".start-guide");
  await expect(guide).toBeVisible({ timeout: 30_000 });
  await expect(guide.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
  await expect(page.locator(".preview-panel")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
