import { expect, test, type Page } from "@playwright/test";

async function expectWithinWidth(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overflow = await page.locator(".app-header button, .app-header input, .app-header a, .preview-toolbar button, .config-panel button, .config-panel input").evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
  }).map((element) => element.getAttribute("aria-label") || element.textContent));
  expect(overflow).toEqual([]);
}

async function expectDialogFits(page: Page, name: string | RegExp): Promise<void> {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
  await dialog.getByRole("button", { name: /^Close .*dialog$/ }).click();
  await expect(dialog).not.toBeVisible();
}

const devices = [
  { name: "small phone", width: 320, height: 568, touch: true },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "tablet", width: 768, height: 1024, touch: true },
  { name: "tablet Air", width: 820, height: 1180, touch: true },
  { name: "large tablet", width: 1024, height: 1366, touch: true },
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "short window", width: 1280, height: 500, touch: false },
];

for (const device of devices) {
  test(`${device.name} keeps the studio usable through rotation`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, hasTouch: device.touch, viewport: { width: device.width, height: device.height } });
    const page = await context.newPage();
    await page.route("https://static-res.makextool.com/**", (route) => route.abort());
    await page.goto("/studio");
    await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Responsive landscape");
    await page.getByRole("radio", { name: "Cut layers", exact: true }).click();
    await expect(page.locator('svg[aria-label^="Cut preview for layer"]')).toBeVisible();

    // Resize the same project both ways; a reload would miss stale canvas sizes
    // and scroll containment left behind when crossing layout breakpoints.
    for (const [width, height] of [[device.width, device.height], [device.height, device.width], [device.width, device.height]] as const) {
      await page.setViewportSize({ width, height });
      for (const panel of ["Features", "Water", "Labels", "Place"]) {
        await page.getByRole("tab", { name: panel, exact: true }).click();
        await expectWithinWidth(page);
      }
      const preview = (await page.locator(".preview-panel").boundingBox())!;
      const settings = (await page.locator(".config-panel").boundingBox())!;
      const stacked = width <= 1000 || (width <= 1100 && height >= width);
      if (stacked) {
        expect(preview.width).toBe(width);
        expect(settings.y).toBeGreaterThanOrEqual(preview.y + preview.height - 1);
      } else {
        expect(preview.x).toBeGreaterThanOrEqual(settings.width - 1);
      }
      expect((await page.locator(".preview-stage").boundingBox())!.height).toBeGreaterThan(180);
      await page.getByRole("button", { name: /Generate terrain/ }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: /Generate terrain/ })).toBeInViewport({ ratio: 1 });
      await page.getByRole("textbox", { name: "Project name", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Responsive landscape");
      await expect(page.getByRole("button", { name: "Project actions", exact: true })).toBeInViewport();
    }

    await page.locator(".location-card").click();
    await expectDialogFits(page, "Choose anywhere");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expectDialogFits(page, /Export/);
    await page.getByRole("radio", { name: "Flat engraving", exact: true }).click();
    await expect(page.locator(".engraving-stage [data-svg-viewport]")).toBeVisible();
    await expectWithinWidth(page);
    await context.close();
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`mobile export stays centered and reachable at ${viewport.width}px`, async ({ browser, browserName, baseURL }) => {
    const context = await browser.newContext({
      baseURL, viewport, hasTouch: true,
      ...(browserName !== "firefox" ? { isMobile: true, deviceScaleFactor: 3 } : {}),
    });
    const page = await context.newPage();
    await page.route("https://static-res.makextool.com/**", (route) => route.abort());
    await page.goto("/studio");
    const trigger = page.getByRole("button", { name: "Export", exact: true });
    const button = (await trigger.boundingBox())!;
    const icon = (await trigger.locator("svg").boundingBox())!;
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2)).toBeLessThan(1);
    expect(Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2)).toBeLessThan(1);
    await trigger.tap();
    const dialog = page.getByRole("dialog", { name: "Export your project" });
    const close = dialog.getByRole("button", { name: "Close export dialog" });
    const body = dialog.locator(".export-dialog-body");
    for (const size of [viewport, { width: viewport.width, height: 360 }, { width: viewport.height, height: viewport.width }, viewport]) {
      // Keep the dialog open as the available viewport shrinks or rotates.
      await page.setViewportSize(size);
      await expect(dialog).toBeInViewport({ ratio: 1 });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
      await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect(dialog.getByRole("link", { name: /Donate/ })).toBeInViewport();
      await expect(close).toBeInViewport({ ratio: 1 });
      await body.evaluate((element) => { element.scrollTop = 0; });
      await expect(dialog.getByRole("heading", { name: "Export your project" })).toBeInViewport();
    }
    await close.tap();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.tap();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await context.close();
  });
}

test("mobile preview warnings can be dismissed without enabling export", async ({ browser, browserName, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, ...(browserName !== "firefox" ? { isMobile: true } : {}) });
  const page = await context.newPage();
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/studio");
  const notice = page.getByRole("button", { name: /^Dismiss notice: 3D is unavailable/ });
  await expect(notice).toBeVisible();
  await notice.press("Enter");
  await expect(page.locator(".preview-notice")).toHaveCount(0);
  await expect(page.locator(".warning-dismiss").first()).toBeFocused();
  // Only two warnings are visible at once. Higher-priority lake-depth warnings
  // can precede the bundled-preview warning, so inspect each as it is revealed.
  let dismissedSampleWarning = false;
  for (let count = 0; count < 20 && await page.locator(".warning-dismiss").count(); count++) {
    const warning = page.locator(".warning-dismiss").first();
    await expect(warning).toBeVisible();
    const label = (await warning.getAttribute("aria-label"))!;
    const target = (await warning.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    await warning.tap();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    if (label.startsWith("Dismiss warning: Bundled real-data preview")) dismissedSampleWarning = true;
  }
  expect(dismissedSampleWarning).toBe(true);
  await expect(page.locator(".warning-stack")).toHaveCount(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".warning-stack")).toHaveCount(0);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("button", { name: /Complete project/ })).toBeDisabled();
  await page.getByRole("button", { name: "Close export dialog" }).click();
  // A new failed attempt must still explain why the selected view is unavailable.
  await page.getByRole("radio", { name: "3D stack", exact: true }).click();
  await expect(notice).toBeVisible();
  await context.close();
});
