import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test("engraves FAA aviation detail and exports it with its cycle and a not-for-navigation notice", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.route("**/v1/events", (route) => route.fulfill({ status: 204 }));
  await page.goto("/studio");
  await page.getByRole("button", { name: "Expand all" }).click();
  for (const name of ["Class B, C and D airspace", "Runways", "Airports", "Identifiers and airspace altitudes"]) {
    await page.getByRole("switch", { name, exact: true }).click();
    await expect(page.getByRole("switch", { name, exact: true })).toBeChecked();
  }
  await page.getByRole("button", { name: "Customize preset" }).click();
  await expect(page.getByRole("spinbutton", { name: "Aviation line width", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Generate terrain|Regenerate terrain/ }).click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 60_000 });
  const preview = page.locator(".preview-stage");
  await expect.poll(async () => Number(await preview.getAttribute("data-aviation-markings"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await preview.getAttribute("data-aviation-label-markings"))).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Complete project/ }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of await (await downloadPromise).createReadStream()) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  const readme = Buffer.from(files["README.txt"]!).toString("utf8");
  expect(readme).toContain("NASR cycle effective 2026-01-01");
  expect(readme).toContain("NOT FOR NAVIGATION");
  const master = Buffer.from(Object.entries(files).find(([name]) => name.endsWith("-master.svg"))![1]).toString("utf8");
  expect(master).toContain("-ENGRAVE-airspace-b");
  expect(master).toContain("-ENGRAVE-runways");
  expect(master).toContain("-ENGRAVE-aviation-symbols");
});
