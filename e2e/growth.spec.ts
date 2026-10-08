import { expect, test } from "@playwright/test";

for (const starter of ["relief", "engraving", "lake"] as const) {
  const title = { relief: "small layered relief", engraving: "flat contour engraving", lake: "surveyed lake relief" }[starter];
  test(`first-project ${starter} reaches export and prepares an honest sharing image`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    const events: Record<string, unknown>[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
    await page.route("https://static-res.makextool.com/**", (route) => route.abort());
    await page.route("**/v1/events", async (route) => { events.push(route.request().postDataJSON()); await route.fulfill({ status: 204 }); });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=lightburn-forum");
    await page.getByRole("link", { name: "Choose a first project" }).click();
    await expect(page.getByRole("heading", { name: "Choose your first project." })).toBeInViewport();
    expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
    if (starter === "relief") await page.locator("#first-project").screenshot({ path: testInfo.outputPath("starter-choices.png") });
    await page.getByRole("link", { name: `Start ${title}`, exact: true }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(`Crater Lake · ${title[0]!.toUpperCase()}${title.slice(1)}`);
    const checklist = page.getByRole("region", { name: starter === "engraving" ? "Your first engraving" : "Your first relief" });
    await expect(checklist).toBeVisible();
    expect(events.some((event) => event.event === "generation_started")).toBe(false);
    await checklist.getByRole("button", { name: "Generate starter terrain" }).click();
    await expect(checklist.getByRole("button", { name: "Open export" })).toBeEnabled({ timeout: 45_000 });
    await checklist.getByRole("button", { name: "Open export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export your project" });
    const fabrication = page.waitForEvent("download");
    await dialog.getByRole("button", { name: /Complete project/ }).click();
    expect((await fabrication).suggestedFilename()).toMatch(/\.zip$/);
    const imageDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Save preview image" }).click();
    const download = await imageDownload;
    expect(download.suggestedFilename()).toMatch(/-preview\.png$/);
    await download.saveAs(testInfo.outputPath(`${starter}-preview.png`));
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
    const image = await page.evaluate(async (base64) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      // Check the artwork rather than the card's title or footer.
      let material = 0;
      for (let y = 168; y < 728; y++) for (let x = 48; x < 1152; x++) {
        const index = (y * image.width + x) * 4;
        if (data[index]! > 130 && data[index]! > data[index + 2]! + 20 && data[index + 3] === 255) material++;
      }
      return { width: image.width, height: image.height, material };
    }, Buffer.concat(chunks).toString("base64"));
    expect(image.width).toBe(1200);
    expect(image.height).toBeGreaterThanOrEqual(900);
    expect(image.material).toBeGreaterThan(10_000);
    await expect(dialog).toContainText("Preview image prepared");
    await dialog.getByRole("button", { name: "Copy design link" }).click();
    await expect(dialog.locator('.export-share [role="status"]')).toContainText(/Share link copied|Could not copy the share link/);
    await expect.poll(() => events.filter((event) => event.event === "share_preview_prepared").length).toBe(1);
    expect(events.filter((event) => event.event === "export_prepared")).toHaveLength(1);
    expect(events.every((event) => event.channel === "lightburn-forum")).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("LightBurn workflow and contextual lake links are usable without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto("/guides/lightburn");
  await expect(page).toHaveTitle("Import Topographic Map SVGs into LightBurn | TopoStack");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Use TopoStack SVG files in LightBurn");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://topostack.app/guides/lightburn");
  await expect(page.getByRole("heading", { name: "Apply kerf compensation once" })).toBeVisible();
  const next = page.getByRole("region", { name: "Continue your project" });
  const destination = async (name: RegExp) => new URL(await next.getByRole("link", { name }).getAttribute("href") ?? "", page.url()).href;
  expect(await destination(/Start a flat engraving/)).toBe(`${baseURL}/studio?starter=engraving`);
  await page.goto("/lake/crater-lake-oregon");
  expect(await destination(/Explore the Lake Tahoe example/)).toBe(`${baseURL}/examples/lake-tahoe`);
  expect(await destination(/Take your SVG into LightBurn/)).toBe(`${baseURL}/guides/lightburn`);
  await context.close();
});
