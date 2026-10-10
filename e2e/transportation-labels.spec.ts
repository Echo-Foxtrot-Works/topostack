import { expect, test } from "@playwright/test";

test("transportation names appear in the 3D stack and cut preview on narrow terraces", async ({ page }, testInfo) => {
  await page.route("https://static-res.makextool.com/**", route => route.abort());
  await page.route("**/v1/events", route => route.fulfill({ status: 204 }));
  await page.goto("/studio");
  await page.getByRole("tab", { name: "Terrain", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Vertical exaggeration", exact: true }).fill("4");
  const stage = page.locator(".preview-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await page.getByRole("tab", { name: "Features", exact: true }).click();
  await page.getByRole("switch", { name: "Latitude and longitude grid", exact: true }).click();
  await expect(stage).toHaveAttribute("aria-busy", "false");
  const canvas = page.locator(".three-stage canvas");
  await expect(canvas).toBeVisible();
  // The 3D scene debounces rebuilds for 160ms after the geometry commit.
  await page.waitForTimeout(400);
  const before = await canvas.screenshot();
  await page.getByRole("switch", { name: "Transportation labels", exact: true }).click();
  await expect.poll(async () => Number(await stage.getAttribute("data-transportation-label-markings"))).toBeGreaterThan(0);
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await canvas.screenshot({ path: testInfo.outputPath("transportation-labels.png") });
  await page.getByRole("radio", { name: /Cut layers/ }).click();
  const labels = page.locator('[data-marking-id^="transport-label-"]');
  await expect(labels.first()).toBeVisible();
  await expect(labels.first().locator("path").last()).toHaveAttribute("d", /M.+L/);
  await page.getByRole("switch", { name: "Transportation labels", exact: true }).click();
  await expect(stage).toHaveAttribute("data-transportation-label-markings", "0");
  await expect(labels).toHaveCount(0);
});
