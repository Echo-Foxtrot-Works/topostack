import { expect, test } from "@playwright/test";

test("roads leave visible strokes on the fitted 3D stack", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => route.abort());
  await page.goto("/studio");
  await page.getByRole("tab", { name: "Features", exact: true }).click();
  const stage = page.locator(".preview-stage");
  const canvas = stage.locator(".three-stage canvas");
  await expect(stage).toHaveAttribute("data-road-markings", /^[1-9]\d*$/);
  await expect(canvas).toBeVisible();
  const readCanvas = async () => {
    const png = (await canvas.screenshot()).toString("base64");
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const copy = document.createElement("canvas");
      copy.width = image.width;
      copy.height = image.height;
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let redTotal = 0;
      let woodPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const red = pixels[i]!;
        redTotal += red;
        if (red > 160) woodPixels++;
      }
      return { redTotal, woodPixels };
    }, png);
  };
  // Wait for the bundled sample's terrain mesh to reach the canvas.
  let withRoads = 0;
  await expect.poll(async () => {
    const frame = await readCanvas();
    withRoads = frame.redTotal;
    return frame.woodPixels;
  }).toBeGreaterThan(1000);
  await page.getByRole("switch", { name: "Roads", exact: true }).click();
  await expect(stage).toHaveAttribute("data-road-markings", "0");
  // Road strokes darken the wood. Removing them should lighten pixels along
  // the roads, even when the selected burn width projects below one pixel.
  await expect.poll(async () => (await readCanvas()).redTotal - withRoads,
    { timeout: 15_000 }).toBeGreaterThan(75 * 30);
});
