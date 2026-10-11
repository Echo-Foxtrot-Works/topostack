import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test("marker size persists and fabrication artwork spans visible stack layers", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/v1/**", route => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", route => route.abort("internetdisconnected"));
  await page.goto("/studio");
  const openMarkers = async () => {
    await page.getByRole("radio", { name: "Custom data", exact: true }).click();
    await page.getByRole("tab", { name: "Markers", exact: true }).click();
  };
  await openMarkers();
  await page.getByRole("button", { name: "Add marker", exact: true }).click();
  const size = page.getByRole("spinbutton", { name: "Marker 1 size", exact: true });
  await expect(size).toHaveValue("8");
  await page.getByRole("radiogroup", { name: "Marker 1 symbol" }).getByRole("radio", { name: "Circle", exact: true }).click();
  await size.fill("180");
  // Terrain generation controls live in the output views, outside Custom data.
  await page.getByRole("radio", { name: /3D stack/ }).click();
  await expect(page.locator(".status-line")).toContainText("Custom data updated", { timeout: 30_000 });
  await page.getByRole("button", { name: /^(?:Generate|Regenerate) terrain/ }).click();
  await expect(page.getByText("Ready to export")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: /3D stack/ }).click();
  await page.screenshot({ path: testInfo.outputPath("marker-across-stack.png") });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Complete project/ }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  const master = Buffer.from(files["crater-lake-master.svg"]!).toString("utf8");
  const layerIndexes = [...master.matchAll(/id="map-marker-0-0-(\d+)-\d+"/g)].map(match => Number(match[1]));
  expect(new Set(layerIndexes).size).toBeGreaterThan(1);
  expect(master).not.toContain('fill="#ffffff"');
  expect(master.match(/id="map-marker-0-[^"]+"[^>]*fill="#2366FF" stroke="none"/g)?.length).toBe(layerIndexes.length);
  const projectEntry = Object.keys(files).find(name => name.endsWith("-project.json"))!;
  const saved = JSON.parse(Buffer.from(files[projectEntry]!).toString("utf8"));
  expect(saved.project.markers[0].sizeMm).toBe(180);
  await page.keyboard.press("Escape");
  await page.reload();
  await openMarkers();
  await expect(size).toHaveValue("180");
  await expect(page.getByText("Generate before export")).toBeVisible();
  expect(errors).toEqual([]);
});
