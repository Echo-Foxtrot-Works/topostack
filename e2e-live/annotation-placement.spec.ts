import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

/** Model coordinates in millimetres, before the master lays layers out on panels. */
function artworkBounds(paths: string[]) {
  const points = paths.flatMap(d => [...d.matchAll(/[ML]\s*(-?[\d.e+-]+)[ ,]+(-?[\d.e+-]+)/gi)].map(m => [Number(m[1]), Number(m[2])] as const));
  expect(points.length).toBeGreaterThan(1);
  return points.reduce<[number, number, number, number]>(([left, top, right, bottom], [x, y]) =>
    [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)], [Infinity, Infinity, -Infinity, -Infinity]);
}

for (const output of ["Layered relief", "Flat engraving"]) {
  test(`${output}: real terrain retains placed annotations through export and reload`, async ({ page }, testInfo) => {
    // Two real generations (before export and after reload) each allow 120 seconds.
    test.setTimeout(300_000);
    const readyStatus = output === "Flat engraving" ? "Engraving ready" : "Real terrain ready";
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    await page.getByRole("radio", { name: output, exact: true }).click();
    await page.getByRole("button", { name: /Generate terrain/ }).click();
    await expect(page.locator(".status-line")).toContainText(readyStatus, { timeout: 120_000 });
    await page.getByRole("tab", { name: "Labels", exact: true }).click();
    await page.getByRole("switch", { name: "Title", exact: true }).click();
    await page.locator(".plaque-settings textarea").fill("Release placement check");
    await page.locator(".plaque-settings .placement-start").click();
    const title = page.locator('[data-placeable="plaque"]');
    const compass = page.locator('[data-placeable="north"]');
    const scale = page.locator('[data-placeable="scale"]');
    await title.focus();
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("+");
    await compass.focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("+");
    await scale.focus();
    await page.keyboard.press("Shift+ArrowDown");
    const kinds = ["plaque", "north", "scale"] as const;
    const draftBounds = await Promise.all(kinds.map(async kind => artworkBounds(await page.locator(`[data-placement-draft="${kind}"] path`).evaluateAll(paths => paths.map(path => path.getAttribute("d")!)))));
    const positions = await Promise.all([title, compass, scale].map(item => item.getAttribute("d")));
    await page.locator(".placement-toolbar").getByRole("button", { name: "Done", exact: true }).click();
    await expect(title).toHaveCount(0);
    await expect(page.getByText("Ready to export", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const downloadReady = page.waitForEvent("download");
    await page.getByRole("button", { name: /Complete project/ }).click();
    const stream = await (await downloadReady).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const files = unzipSync(Buffer.concat(chunks));
    const projectFile = Object.keys(files).find(name => name.endsWith("-project.json"));
    const masterFile = Object.keys(files).find(name => name.endsWith(output === "Flat engraving" ? "-engraving.svg" : "-master.svg"));
    expect(projectFile).toBeTruthy();
    expect(masterFile).toBeTruthy();
    const saved = JSON.parse(Buffer.from(files[projectFile!]!).toString("utf8")).project;
    expect(saved.plaque.text).toBe("Release placement check");
    expect(saved.plaque.sizeMm).toBe(6.5);
    expect(saved.northArrowSizeMm).toBe(25);
    expect(saved.scaleBarPlacement).toBeDefined();
    const master = Buffer.from(files[masterFile!]!).toString("utf8");
    expect(master).toContain('data-operation="ENGRAVE"');
    expect(master).not.toMatch(/NaN|Infinity/);
    for (const [index, kind] of kinds.entries()) {
      const exported = await page.evaluate(({ master, kind }) => {
        const doc = new DOMParser().parseFromString(master, "image/svg+xml");
        return [...doc.querySelectorAll(`path[id^="${kind}-"]`)].map(path => path.getAttribute("d")!);
      }, { master, kind });
      const measured = artworkBounds(exported);
      for (const [axis, bound] of measured.entries()) expect(Math.abs(bound - draftBounds[index]![axis]!)).toBeLessThan(0.02);
    }
    await testInfo.attach("placed-annotations.svg", { body: master, contentType: "image/svg+xml" });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.getByRole("button", { name: /Generate terrain/ }).click();
    await expect(page.locator(".status-line")).toContainText(readyStatus, { timeout: 120_000 });
    await page.getByRole("tab", { name: "Labels", exact: true }).click();
    await page.locator(".plaque-settings .placement-start").click();
    for (const [index, item] of [title, compass, scale].entries()) {
      await expect(item).toHaveAttribute("d", positions[index]!);
    }
    await page.screenshot({ path: testInfo.outputPath("restored-placement.png") });
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });
}
