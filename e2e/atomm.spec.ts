import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_PROJECT, DEFAULT_SHEET_NESTING } from "@topostack/core";

// Startup prepares sample geometry before mounting the embedded workbench.
// Deep stacks also take longer than a normal DOM assertion on CI workers.
const STARTUP_TIMEOUT_MS = 30_000;
const PREVIEW_TIMEOUT_MS = 30_000;

/**
 * The embed loads terrain on its own at startup. Holding the geometry worker's
 * second fetch (the first builds the page's bundled preview) pauses that run
 * at its last step, so a test can watch it or cancel it.
 */
async function holdAutomaticTerrain(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route("**/geometry.worker-*.js", async route => { if (++requests > 1) await gate; await route.continue(); });
  return release;
}

test("Atomm uses the platform export hook and template layout across desktop, RTL, and narrow frames", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/v1/**", route => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `
    window.atomm = {
      lifecycle: { on(event, hook) { window.testExport = hook; } },
      app: { getLocale: async () => 'ja', getSupportedLocales: async () => [{ code: 'en', name: 'English' }] },
      ui: { toast: async () => 'toast', closeToast: async () => {} }
    };
    const render = () => document.querySelectorAll('[data-atomm-export-button]').forEach(slot => {
      if (!slot.firstChild) { const button = document.createElement('button'); button.textContent = 'Platform Export'; slot.append(button); }
    });
    new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true }); render();
  ` }));
  await page.route("**/atomm-test", route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0"><iframe title="Atomm generator" src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe></body></html>' }));
  await page.goto("/atomm-test");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".atomm-workbench")).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  await expect(studio.locator(".app-header")).toHaveCount(0);
  await expect(studio.locator(".feedback-trigger, .feedback-dialog")).toHaveCount(0);
  await expect(studio.locator('a[href*="/guides/how-lake-depths-work"]')).toHaveCount(0);
  await expect(studio.locator("[data-atomm-export-button]")).toHaveCount(1);
  await expect(studio.getByRole("button", { name: "Platform Export" })).toBeVisible();
  await expect(studio.locator("html")).toHaveAttribute("lang", "en");
  for (const selector of [".gen-rail-lead", ".gen-rail-params"]) {
    expect(await studio.locator(selector).evaluate(el => el.getBoundingClientRect().width)).toBe(320);
  }
  const invoke = async (intent: "download" | "openInStudio") => studio.locator("body").evaluate(async (_el, intent) => {
    type ExportFile = { filename: string; blob: Blob };
    const hook = (window as unknown as { testExport: (value: { intent: string }) => Promise<ExportFile | ExportFile[]> }).testExport;
    try {
      const output = await hook({ intent });
      const files = Array.isArray(output) ? output : [output];
      return { files: await Promise.all(files.map(async file => ({ filename: file.filename, text: file.filename.endsWith(".svg") ? await file.blob.text() : "", bytes: file.blob.size }))), error: "" };
    } catch (error) { return { files: [], error: (error as Error).message }; }
  }, intent);
  // The embed has no Generate step: it loads real terrain on its own.
  await expect(studio.getByRole("button", { name: "Generate terrain", exact: true })).toHaveCount(0);
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  expect([...await studio.locator('.mode-switch [role="radio"]').allTextContents()].map(text => text.trim())).toEqual(["2D", "3D", "Export"]);
  await studio.getByRole("button", { name: "Cut size", exact: true }).click();
  const width = studio.getByRole("spinbutton", { name: "Width", exact: true });
  expect(await width.evaluate(el => (el as HTMLInputElement).validity.valid)).toBe(true);
  expect(await width.evaluate(el => el.closest(".number-input")!.getBoundingClientRect().width)).toBe(92);
  expect(await width.evaluate(el => el.closest(".number-input")!.getBoundingClientRect().height)).toBe(28);
  // An active segment is the white item on the grey track, with no border of its own.
  const rectangle = studio.getByRole("radio", { name: "Rectangle", exact: true });
  expect(await rectangle.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, border: getComputedStyle(el).borderTopWidth }))).toEqual({ outline: "none", border: "0px" });
  const master = await invoke("openInStudio");
  expect(master.error).toBe("");
  expect(master.files).toHaveLength(1);
  expect(master.files[0]!.filename).toMatch(/-master\.svg$/);
  expect(master.files[0]!.text).toContain('stroke="#FE0002"');
  expect(master.files[0]!.text).toContain('stroke="#2366FF"');
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  const manifest = studio.locator(".export-manifest");
  await expect(manifest).toContainText(master.files[0]!.filename, { timeout: PREVIEW_TIMEOUT_MS });
  await expect(manifest).toContainText("Red line · Cut");
  await expect(manifest).toContainText("Blue line · Score");
  // Credits share the zoom cluster's row, as light text without a plate.
  const zoomBox = await studio.locator(".atomm-zoom-cluster").boundingBox();
  const creditBox = await studio.locator(".preview-attribution").boundingBox();
  expect(Math.abs((zoomBox!.y + zoomBox!.height / 2) - (creditBox!.y + creditBox!.height / 2))).toBeLessThan(1);
  expect(await studio.locator(".preview-attribution").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await studio.getByRole("radio", { name: "3D", exact: true }).click();
  expect(await page.evaluate(svg => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    return !doc.querySelector("parsererror") && [...doc.querySelectorAll("path")].every(path =>
      path.getAttribute("fill") === "none" && ["#2366FF", "#FE0002"].includes(path.getAttribute("stroke") ?? ""));
  }, master.files[0]!.text)).toBe(true);
  // Invalid edits remain visible, with the last valid fabrication model unchanged.
  await width.fill("99999");
  await width.blur();
  await expect(width).toHaveValue("99999");
  await expect(width).toHaveAttribute("aria-invalid", "true");
  await expect(studio.locator(".atomm-number-error")).toContainText("10000");
  expect((await invoke("openInStudio")).files[0]!.text).toBe(master.files[0]!.text);
  await width.fill("300");
  await expect(width).not.toHaveAttribute("aria-invalid", "true");
  // Parameter edits must change exported geometry without another Generate.
  await studio.getByRole("button", { name: "Terrain layers", exact: true }).click();
  await studio.getByRole("spinbutton", { name: "Vertical exaggeration", exact: true }).fill("8");
  await expect.poll(async () => Number(await studio.getByRole("slider", { name: "Selected layer", exact: true }).getAttribute("max"))).toBeGreaterThan(23);
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  const tall = await invoke("openInStudio");
  expect(tall.error).toBe("");
  expect(tall.files[0]!.text).not.toBe(master.files[0]!.text);
  expect(tall.files[0]!.text).toContain("layer-25");
  const layerCount = Number(await studio.getByRole("slider", { name: "Selected layer", exact: true }).getAttribute("max")) + 1;
  await expect(studio.locator("#section-terrain .relief-summary strong")).toContainText(`${layerCount} layers`);
  const previousLayers = await studio.locator(".layer-heading").textContent();
  await studio.getByRole("spinbutton", { name: "Vertical exaggeration", exact: true }).fill("1");
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  await expect(studio.locator(".layer-heading")).not.toHaveText(previousLayers!);
  const exaggerated = await invoke("openInStudio");
  expect(exaggerated.error).toBe("");
  expect(exaggerated.files[0]!.text).not.toBe(master.files[0]!.text);
  await width.fill("450");
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  const resized = await invoke("openInStudio");
  expect(resized.error).toBe("");
  expect(resized.files[0]!.text).not.toBe(exaggerated.files[0]!.text);
  await studio.getByRole("button", { name: "Map details", exact: true }).click();
  const lakeHelp = studio.locator("#section-details").getByRole("button", { name: "How lake depths work", exact: true });
  await lakeHelp.click();
  const helpDialog = studio.getByRole("dialog", { name: "Fabrication tips" });
  await expect(helpDialog.getByRole("heading", { name: "How lake depths work" })).toBeVisible();
  await expect(helpDialog).toContainText("Neither reflects today's water level.");
  await expect(helpDialog.locator("a")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(lakeHelp).toBeFocused();
  await expect(studio.locator(".feedback-trigger, .feedback-dialog")).toHaveCount(0);
  await expect(studio.locator('a[href*="/guides/how-lake-depths-work"]')).toHaveCount(0);
  const stage = studio.locator(".preview-stage");
  await studio.getByRole("checkbox", { name: "Latitude and longitude grid", exact: true }).check();
  await expect(stage).toHaveAttribute("aria-busy", "false");
  const gridded = await invoke("openInStudio");
  expect(gridded.error).toBe("");
  expect(gridded.files[0]!.text).not.toBe(resized.files[0]!.text);
  await studio.getByRole("checkbox", { name: "North arrow", exact: true }).check();
  const arrows = studio.getByRole("radiogroup", { name: "North arrow design", exact: true });
  await arrows.scrollIntoViewIfNeeded();
  expect(await arrows.locator("button").evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth))).toBe(true);
  expect(await arrows.evaluate(el => el.getBoundingClientRect().right <= el.closest(".gen-rail-params")!.getBoundingClientRect().right - 16)).toBe(true);
  // The embed uses the platform's native keyboard/touch picker without a clipping popup.
  const fontPicker = studio.getByRole("combobox", { name: "Engraving font", exact: true });
  await fontPicker.scrollIntoViewIfNeeded();
  expect(await fontPicker.evaluate(el => el.tagName)).toBe("SELECT");
  await expect(fontPicker.locator("option")).toHaveCount(11);
  expect(await fontPicker.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))).toEqual({ width: 110, height: 28 });
  await fontPicker.selectOption({ label: "Jost" });
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  await expect(manifest).toContainText("Blue fill · Engrave", { timeout: PREVIEW_TIMEOUT_MS });
  await fontPicker.selectOption({ label: "Technical" });
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  await studio.getByRole("radio", { name: "2D", exact: true }).click();
  expect(await studio.locator(".mode-switch").evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await studio.locator(".status-line").evaluate(el => getComputedStyle(el).whiteSpace)).toBe("normal");
  const tipsControl = studio.getByRole("button", { name: "Tips", exact: true });
  await tipsControl.hover();
  expect(await tipsControl.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(246, 246, 247)");
  const all = await invoke("download");
  expect(all.error).toBe("");
  expect(all.files.length).toBeGreaterThan(4);
  expect(all.files.every(file => !/[\\/]/.test(file.filename))).toBe(true);
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  const total = all.files.reduce((sum, file) => sum + file.bytes, 0);
  const sizeLabel = total < 1024 ? `${total} B` : total < 1024 * 1024 ? `${Math.round(total / 1024)} KB` : `${(total / 1024 / 1024).toFixed(1)} MB`;
  await expect(manifest.locator("summary")).toContainText(sizeLabel, { timeout: PREVIEW_TIMEOUT_MS });
  await studio.getByRole("radio", { name: "Flat engraving" }).click();
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  const flat = await invoke("openInStudio");
  expect(flat.error).toBe("");
  expect(flat.files[0]!.filename).toMatch(/-engraving\.svg$/);
  expect(flat.files[0]!.text).not.toContain('stroke="#FE0002"');
  await studio.locator("html").evaluate(el => el.setAttribute("dir", "rtl"));
  const lead = await studio.locator(".gen-rail-lead").boundingBox();
  const params = await studio.locator(".gen-rail-params").boundingBox();
  expect(lead!.x).toBeGreaterThan(params!.x);
  expect(await studio.locator(".preview-stage").evaluate(el => getComputedStyle(el).direction)).toBe("ltr");
  await studio.getByRole("button", { name: "Tips", exact: true }).click();
  const tipsDialog = studio.getByRole("dialog", { name: "Fabrication tips" });
  await expect(tipsDialog).toBeVisible();
  // One step at a time, as the platform's walkthrough does.
  await expect(tipsDialog.getByRole("heading", { level: 3 })).toHaveText("Pick a place");
  await tipsDialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tipsDialog.getByRole("heading", { level: 3 })).toHaveText("Terrain layers");
  await tipsDialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(tipsDialog.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(studio.getByRole("button", { name: "Tips", exact: true })).toBeFocused();
  // Collapsed, the lead rail keeps its title in the canvas corner.
  await studio.getByRole("button", { name: "Collapse Terrain project", exact: true }).click();
  await expect(studio.getByRole("button", { name: "Expand Terrain project", exact: true })).toContainText("Terrain project");
  await studio.getByRole("button", { name: "Expand Terrain project", exact: true }).click();
  await page.setViewportSize({ width: 700, height: 800 });
  await expect.poll(() => studio.locator(".gen-rail-params").evaluate(el => el.getBoundingClientRect().width)).toBe(700);
  expect(await studio.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const canvas = await studio.locator(".gen-canvas").boundingBox();
  expect(canvas!.y).toBe(0);
  const footer = await studio.locator(".atomm-export-footer").boundingBox();
  expect(Math.round(footer!.y + footer!.height)).toBe(800);
});


test("Atomm SDK failure explains recovery and reconnects after reload", async ({ page }) => {
  let offline = true;
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => offline ? route.abort() : route.fulfill({ contentType: "application/javascript", body: `
    window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] } };
  ` }));
  await page.route("**/atomm-recovery", route => route.fulfill({ contentType: "text/html", body: '<iframe title="Generator" src="/studio" style="width:100%;height:800px"></iframe>' }));
  await page.goto("/atomm-recovery");
  const studio = page.frameLocator("iframe");
  await expect(studio.getByText("Connecting to Atomm…", { exact: true })).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  const retry = studio.getByRole("button", { name: "Reload connection" });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await expect(studio.getByText("Atomm has not connected.", { exact: false })).toBeVisible();
  offline = false;
  await retry.click();
  await expect(studio.locator(".atomm-workbench")).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  await expect(retry).toHaveCount(0);
  await expect(studio.getByText("Connecting to Atomm…", { exact: true })).toHaveCount(0);
});


test("Atomm map selection tools leave view, Tips, and zoom controls accessible", async ({ page }, testInfo) => {
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://tiles.openfreemap.org/styles/**", route => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#cbd9c3" } }],
  } }));
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `
    window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] } };
  ` }));
  await page.route("**/atomm-map", route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0"><iframe title="Generator" src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe></body></html>' }));
  await page.goto("/atomm-map");
  const studio = page.frameLocator("iframe");
  for (const [width, height, direction] of [[1280, 900, "ltr"], [960, 600, "ltr"], [700, 800, "ltr"], [390, 700, "ltr"], [1280, 900, "rtl"]] as const) {
    await page.setViewportSize({ width, height });
    await studio.locator("html").evaluate((el, dir) => el.setAttribute("dir", dir), direction);
    await studio.getByRole("button", { name: "Edit map area", exact: true }).click();
    await expect(studio.locator(".map-wrap")).toBeVisible();
    await expect(studio.getByRole("radio", { name: "2D", exact: true })).toHaveAttribute("tabindex", "0");
    await expect(studio.locator(".selection-tools")).toHaveCount(0);
    expect(await studio.locator(".map-wrap").evaluate(el => getComputedStyle(el).isolation)).toBe("isolate");
    const lock = studio.locator(".gen-rail-lead #section-setup").getByRole("checkbox", { name: "Lock aspect ratio", exact: true });
    await expect(studio.locator(".gen-rail-params").getByRole("checkbox", { name: "Lock aspect ratio" })).toHaveCount(0);
    await lock.check();
    await studio.getByRole("radio", { name: "2D", exact: true }).click();
    await studio.getByRole("button", { name: "Edit map area", exact: true }).click();
    await expect(lock).toBeChecked();
    if (width === 1280 && direction === "ltr") {
      const guide = studio.locator(".crop-guide");
      const ratio = () => guide.evaluate(el => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
      const before = await ratio();
      const handle = studio.getByRole("button", { name: "Resize selection right", exact: true });
      await handle.focus();
      await page.keyboard.press("ArrowLeft");
      await expect.poll(ratio).toBeCloseTo(before, 2);
      await lock.uncheck();
      await handle.focus();
      await page.keyboard.press("ArrowLeft");
      await expect.poll(ratio).not.toBeCloseTo(before, 2);
    } else await lock.uncheck();
    const tips = studio.getByRole("button", { name: "Tips", exact: true });
    await tips.click();
    await expect(studio.getByRole("dialog", { name: "Fabrication tips" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tips).toBeFocused();
    await studio.getByRole("button", { name: "Zoom in", exact: true }).click();
    await studio.getByRole("button", { name: "Fit to canvas", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`map-controls-${width}-${direction}.png`) });
    await studio.getByRole("radio", { name: "2D", exact: true }).click();
    await expect(studio.locator(".selection-tools")).toHaveCount(0);
  }
  await studio.locator("html").evaluate(el => el.setAttribute("dir", "ltr"));
  const lead = studio.locator(".gen-rail-lead");
  const custom = lead.getByRole("button", { name: "Markers & paths", exact: true });
  await expect(studio.locator(".gen-rail-params .custom-data-section")).toHaveCount(0);
  await expect(lead.locator('.config-section + .custom-data-section')).toHaveCount(1);
  await custom.click();
  await studio.getByRole("button", { name: "Edit map area", exact: true }).click();
  await lead.getByRole("button", { name: "Add marker", exact: true }).click();
  await expect(studio.locator(".topostack-map-marker")).toHaveCount(1);
  await lead.getByRole("radio", { name: "Star", exact: true }).click();
  await expect(studio.locator(".topostack-map-marker")).toHaveAttribute("data-symbol", "star");
  for (const direction of ["ltr", "rtl"]) {
    await studio.locator("html").evaluate((el, dir) => el.setAttribute("dir", dir), direction);
    expect(await lead.locator(".marker-symbol-options button").evaluateAll(buttons => buttons.every(button => {
      const bounds = button.getBoundingClientRect();
      const icon = button.querySelector("svg")!.getBoundingClientRect();
      return Math.abs(icon.x + icon.width / 2 - bounds.x - bounds.width / 2) < 0.5
        && Math.abs(icon.y + icon.height / 2 - bounds.y - bounds.height / 2) < 0.5;
    }))).toBe(true);
  }
  await studio.locator("html").evaluate(el => el.setAttribute("dir", "ltr"));
  await lead.getByRole("button", { name: "Add path", exact: true }).click();
  await lead.getByRole("button", { name: "Add point", exact: true }).click();
  await expect(lead.getByRole("spinbutton", { name: "Path 1 point 3 latitude", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("left-markers-paths.png") });
  await lead.getByRole("button", { name: "Remove path 1", exact: true }).click();
  await lead.getByRole("button", { name: "Remove marker 1", exact: true }).click();
  await expect(studio.locator(".topostack-map-marker")).toHaveCount(0);
  await studio.getByRole("button", { name: "Cut size", exact: true }).click();
  await studio.getByRole("radio", { name: "Circle", exact: true }).click();
  const lock = lead.getByRole("checkbox", { name: "Lock aspect ratio", exact: true });
  await expect(lock).toBeDisabled();
  await expect(lock).toBeChecked();
  await studio.getByRole("radio", { name: "Rectangle", exact: true }).click();
  await expect(lock).toBeEnabled();
  await expect(lock).not.toBeChecked();
});


test("Atomm layer and exploded controls stay above expanded settings", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `
    window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] } };
  ` }));
  await page.route("**/atomm-layers", route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0"><iframe title="Generator" src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe></body></html>' }));
  await page.goto("/atomm-layers");
  const studio = page.frameLocator("iframe");
  const dock = studio.locator(".gen-rail-params .layer-dock");
  await expect(dock).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  await expect(studio.locator(".gen-params-content > :first-child")).toHaveClass(/\blayer-dock\b/);
  for (const name of ["Cut size", "Terrain layers", "Map details", "Linework", "Fabrication settings"]) {
    const section = studio.getByRole("button", { name, exact: true });
    if (await section.getAttribute("aria-expanded") === "false") await section.click();
  }
  const scroller = studio.locator(".gen-rail-params .gen-rail-scroll");
  for (const direction of ["ltr", "rtl"]) {
    await studio.locator("html").evaluate((el, dir) => el.setAttribute("dir", dir), direction);
    await scroller.evaluate(el => el.scrollTop = el.scrollHeight);
    await expect.poll(() => dock.evaluate(el => {
      const card = el.getBoundingClientRect();
      const viewport = el.closest(".gen-rail-scroll")!.getBoundingClientRect();
      return card.top >= viewport.top && card.top <= viewport.top + 1 && card.bottom < viewport.bottom;
    })).toBe(true);
    const exploded = studio.getByRole("slider", { name: "Stack separation", exact: true });
    await exploded.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    await expect(exploded).toHaveValue("0.05");
    await page.screenshot({ path: testInfo.outputPath(`pinned-layer-controls-${direction}.png`) });
  }
  const layer = studio.getByRole("slider", { name: "Selected layer", exact: true });
  await layer.focus();
  await page.keyboard.press("Home");
  await expect(studio.locator(".layer-heading")).toContainText("Layer 1");
  await expect(studio.getByRole("radio", { name: "2D", exact: true })).toHaveAttribute("aria-checked", "true");
  await studio.getByRole("radio", { name: "Flat engraving" }).click();
  await expect(dock).toHaveCount(0);
});


test("Atomm linework and location search stay readable under light and dark themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `
    window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] } };
  ` }));
  await page.route("**/atomm-contrast", route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0"><iframe title="Generator" src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe></body></html>' }));
  await page.goto("/atomm-contrast");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".atomm-workbench")).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  const chooseLocation = studio.locator(".location-card");
  await expect(chooseLocation.locator("strong")).toHaveText("Choose location");
  await expect(chooseLocation.locator("small")).not.toBeEmpty();
  await expect(chooseLocation).toHaveAttribute("aria-haspopup", "dialog");
  const suggestions = studio.getByRole("group", { name: "Suggested places", exact: true });
  await expect(suggestions.getByRole("button")).toHaveCount(4);
  await expect(suggestions.locator("button svg")).toHaveCount(4);
  expect(await suggestions.locator("button").evaluateAll(buttons => buttons.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
  await studio.getByRole("button", { name: "Linework", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await studio.locator("html").evaluate((el, value) => el.setAttribute("data-theme", value), theme);
    expect(await chooseLocation.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor }))).toEqual({ background: "rgb(255, 255, 255)", border: "rgb(61, 62, 66)" });
    for (const name of ["Fine", "Balanced", "Bold"]) {
      const preset = studio.getByRole("radio", { name, exact: true });
      await preset.click();
      await expect(preset).toHaveAttribute("aria-checked", "true");
      expect(await preset.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))).toEqual({ background: "rgb(255, 255, 255)", color: "rgb(23, 23, 25)" });
    }
    const customize = studio.getByRole("button", { name: "Customize preset", exact: true });
    expect(await customize.evaluate(el => {
      const button = el.getBoundingClientRect();
      const presets = el.parentElement!.querySelector(".line-presets")!.getBoundingClientRect();
      return Math.abs(button.left - presets.left) < 1 && Math.abs(button.right - presets.right) < 1;
    })).toBe(true);
    await customize.click();
    await expect(customize).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: testInfo.outputPath(`linework-${theme}.png`) });
    await customize.click();
    await studio.locator(".location-card").click();
    const dialog = studio.getByRole("dialog", { name: "Choose anywhere", exact: true });
    const search = dialog.getByRole("textbox", { name: "Search places", exact: true });
    await search.fill("Crater");
    expect(await search.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))).toEqual({ background: "rgb(238, 239, 241)", color: "rgb(23, 23, 25)" });
    await search.clear();
    await dialog.locator(".preset-locations summary").click();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const latitude = dialog.getByRole("spinbutton", { name: "Latitude", exact: true });
      await latitude.scrollIntoViewIfNeeded();
      const locate = dialog.getByRole("button", { name: "Use current location", exact: true });
      expect(await locate.evaluate(el => {
        const button = el.getBoundingClientRect();
        const icon = el.querySelector("svg")!.getBoundingClientRect();
        const useCoordinates = el.parentElement!.querySelector(".ldt-button:not(.ldt-icon-button)")!.getBoundingClientRect();
        return Math.abs(useCoordinates.right - el.parentElement!.getBoundingClientRect().right) < 1
          && useCoordinates.height === 40 && Math.abs(useCoordinates.top - button.top) < 1 && button.width === 40 && button.height === 40 && icon.width === 24 && icon.height === 24
          && Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2) < 1
          && Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2) < 1;
      })).toBe(true);
      expect(await dialog.locator(".coordinate-row").evaluate(el => {
        const row = el.getBoundingClientRect();
        const fields = [...el.querySelectorAll(".atomm-number")].map(field => field.getBoundingClientRect());
        return fields.length === 2 && Math.abs(fields[0]!.top - fields[1]!.top) < 1
          && fields.every(field => Math.abs(field.width - (row.width - 8) / 2) < 1);
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`location-coordinates-${theme}-${width}.png`) });
      await dialog.locator(".preset-grid").scrollIntoViewIfNeeded();
      expect(await dialog.locator(".preset-grid .location-option").evaluateAll(buttons => buttons.every(button => {
        const style = getComputedStyle(button);
        return Number.parseFloat(style.paddingTop) >= 8 && Number.parseFloat(style.paddingLeft) >= 8
          && button.scrollWidth <= button.clientWidth;
      }))).toBe(true);
      expect(await dialog.locator(".preset-grid").evaluate(el => Number.parseFloat(getComputedStyle(el).gap))).toBeGreaterThanOrEqual(8);
      await page.screenshot({ path: testInfo.outputPath(`location-examples-${theme}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: testInfo.outputPath(`location-search-${theme}.png`) });
    await page.keyboard.press("Escape");
  }
});

test("Atomm depth allowance is explicit and fitting actions use readable theme buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/v1/**", route => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: "window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [{ code: 'en', name: 'English' }] } };" }));
  await page.route("**/atomm-test", route => route.fulfill({ contentType: "text/html", body: '<iframe title="Atomm generator" src="/studio" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>' }));
  const releaseTerrain = await holdAutomaticTerrain(page);
  await page.goto("/atomm-test");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".atomm-workbench")).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  // Cancelling the automatic load keeps the bundled Crater Lake preview, whose lake this test needs.
  await studio.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await expect(studio.locator(".status-line")).toContainText("Generation canceled");
  await expect(studio.getByRole("button", { name: "Load terrain", exact: true })).toBeVisible();
  releaseTerrain();
  await studio.getByRole("button", { name: "Terrain layers", exact: true }).click();
  // Each range is one numeric field; the duplicate slider is not shown in the embed.
  await expect(studio.getByRole("slider", { name: "Vertical exaggeration slider", exact: true })).toBeHidden();
  const terrainField = studio.getByRole("spinbutton", { name: "Vertical exaggeration", exact: true });
  await expect(terrainField).toHaveAttribute("max", "10");
  await terrainField.fill("1");
  await terrainField.press("ArrowUp");
  await expect(terrainField).toHaveValue("1.1");
  // Every edit below regenerates the whole stack, so it stays shallow: 8x made
  // about 170 layers and pushed the test past its timeout on CI runners.
  await studio.getByRole("button", { name: "Map details", exact: true }).click();
  const depthField = studio.getByRole("spinbutton", { name: "Water depth exaggeration", exact: true });
  await expect(depthField).toHaveAttribute("min", "0.25");
  await expect(depthField).toHaveAttribute("max", "4");
  await depthField.fill("0.25");
  await depthField.press("ArrowUp");
  await expect(depthField).toHaveValue("0.3");
  const limit = studio.getByRole("checkbox", { name: "Limit depth layers", exact: true });
  await expect(limit).not.toBeChecked();
  await expect(studio.getByRole("spinbutton", { name: "Maximum depth layers", exact: true })).toHaveCount(0);
  await studio.getByRole("spinbutton", { name: "Water depth exaggeration", exact: true }).fill("4");
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  const automaticCount = Number(await studio.getByRole("slider", { name: "Selected layer", exact: true }).getAttribute("max")) + 1;
  await limit.check();
  const depthLayers = studio.getByRole("spinbutton", { name: "Maximum depth layers", exact: true });
  await depthLayers.fill("1");
  const fit = studio.getByRole("button", { name: "Fit depth", exact: true });
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  await expect(fit).toBeVisible();
  expect(Number(await studio.getByRole("slider", { name: "Selected layer", exact: true }).getAttribute("max")) + 1).toBeLessThan(automaticCount);
  const fitting = studio.getByRole("checkbox", { name: "Fit lake depth to available layers", exact: true });
  // A theme only restyles the buttons, so both themes are checked in each
  // fitting state and each button is clicked once: every click regenerates.
  for (const [action, fitsAfter] of [[fit, true], [studio.getByRole("button", { name: "Use manual depth", exact: true }), false]] as const) {
    await page.mouse.move(0, 0);
    for (const theme of ["light", "dark"]) {
      await studio.locator("html").evaluate((el, value) => el.setAttribute("data-theme", value), theme);
      const appearance = await action.evaluate(el => {
        const css = getComputedStyle(el);
        return { radius: css.borderRadius, transform: css.textTransform, border: css.borderTopWidth, height: el.getBoundingClientRect().height, color: css.color };
      });
      expect(appearance).toMatchObject({ radius: "6px", transform: "none", border: "1px", height: 32, color: "rgb(23, 23, 25)" });
    }
    await action.click();
    await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
    await expect(fitting).toBeChecked({ checked: fitsAfter });
  }
  await limit.uncheck();
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
  await expect(fit).toHaveCount(0);
  await expect(depthLayers).toHaveCount(0);
  await expect.poll(async () => Number(await studio.getByRole("slider", { name: "Selected layer", exact: true }).getAttribute("max")) + 1).toBe(automaticCount);
  await expect(studio.locator("#section-details")).toContainText("Automatic: adds all layers needed");
});

for (const embedded of [true, false]) {
  test(`${embedded ? "Atomm" : "Standalone"} terrain generation shows animated stage feedback and respects reduced motion`, async ({ page }) => {
    await page.route("**/v1/**", route => route.abort("internetdisconnected"));
    await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en' }, ui: { toast: async () => 'toast', closeToast: async () => {} } };` }));
    await page.route("**/atomm-test", route => route.fulfill({ contentType: "text/html", body: '<iframe title="Atomm generator" src="/studio" style="width:100%;height:100vh;border:0"></iframe>' }));
    // Hold actual geometry work at its worker load boundary, not with a fake timer.
    let releaseWorker!: () => void;
    const workerGate = new Promise<void>(resolve => { releaseWorker = resolve; });
    try {
      // The embed starts loading terrain on its own, so it is held from the start.
      if (embedded) { const release = await holdAutomaticTerrain(page); void workerGate.then(release); }
      await page.goto(embedded ? "/atomm-test" : "/studio");
      const studio = embedded ? page.frameLocator("iframe") : page;
      if (embedded) await expect(studio.locator(".atomm-workbench")).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
      else {
        await expect(studio.getByRole("button", { name: "Generate terrain", exact: true })).toBeVisible();
        await page.route("**/geometry.worker-*.js", async route => { await workerGate; await route.continue(); });
        await studio.getByRole("button", { name: "Generate terrain", exact: true }).click();
      }
      const overlay = studio.locator(".generation-overlay");
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText("Step 3 of 3");
      await expect(overlay).toContainText("Tracing and repairing contours");
      await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "true");
      const loader = overlay.locator(".contour-loader");
      await expect(loader).toBeVisible();
      await expect(loader).toHaveAttribute("aria-hidden", "true");
      const ring = loader.locator("span").first();
      expect(await ring.evaluate(el => getComputedStyle(el).animationName)).toBe(embedded ? "none" : "contour");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await ring.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
      await expect(overlay).toContainText("Step 3 of 3");
      releaseWorker();
      await expect(overlay).toBeHidden({ timeout: 30_000 });
      await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false", { timeout: PREVIEW_TIMEOUT_MS });
      await expect(studio.locator(".status-line")).toContainText("Real terrain ready");
    } finally { releaseWorker(); }
  });
}

test("Atomm controls and Tips remain reachable in narrow and short frames", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] } };` }));
  await page.route("**/atomm-layout", route => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><iframe src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe>' }));
  await page.goto("/atomm-layout");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  for (const direction of ["ltr", "rtl"]) {
    await studio.locator("html").evaluate((el, value) => el.setAttribute("dir", value), direction);
    for (const width of [1280, 960, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      for (const collapsed of [false, true]) {
        if (collapsed) await studio.getByRole("button", { name: "Collapse Terrain project", exact: true }).click();
        for (const view of ["2D", "3D", "Export"]) {
          const control = studio.getByRole("radio", { name: view, exact: true });
          await control.click();
          await expect(control).toHaveAttribute("aria-checked", "true");
        }
        const tabs = (await studio.locator(".mode-switch").boundingBox())!;
        const tips = (await studio.getByRole("button", { name: "Tips", exact: true }).boundingBox())!;
        expect(tabs.x + tabs.width <= tips.x || tips.x + tips.width <= tabs.x || tabs.y + tabs.height <= tips.y || tips.y + tips.height <= tabs.y).toBe(true);
        await studio.getByRole("button", { name: "Tips", exact: true }).click();
        await expect(studio.getByRole("dialog", { name: "Fabrication tips" })).toBeVisible();
        await page.keyboard.press("Escape");
        if (width === 960 && direction === "ltr") await page.screenshot({ path: testInfo.outputPath(`fixed-controls-${collapsed}.png`) });
        if (collapsed) await studio.getByRole("button", { name: "Expand Terrain project", exact: true }).click();
      }
    }
  }
  for (const height of [480, 320]) {
    await page.setViewportSize({ width: 700, height });
    await studio.getByRole("button", { name: "Tips", exact: true }).click();
    const dialog = studio.getByRole("dialog", { name: "Fabrication tips" });
    for (let step = 0; step < 7; step++) {
      const next = dialog.getByRole("button", { name: step === 6 ? "Done" : "Next", exact: true });
      const bounds = (await dialog.boundingBox())!;
      const button = (await next.boundingBox())!;
      expect(button.y).toBeGreaterThanOrEqual(bounds.y);
      expect(button.y + button.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      await next.click();
    }
    await expect(dialog).toBeHidden();
  }
});


for (const unavailable of [false, true]) test(`Atomm automatic nesting ${unavailable ? "falls back when its worker is unavailable" : "shares simple defaults with Export Preview"}`, async ({ page }) => {
  if (unavailable) await page.route("**/nest.worker-*.js", route => route.abort());
  test.setTimeout(120_000);
  const plannerRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => {
    if (/nest\.worker-|topostack_nest_wasm/.test(request.url())) plannerRequests.push(request.url());
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/v1/**", route => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `
    window.atomm = { lifecycle: { on(event, hook) { window.testExport = hook; } }, ui: { toast: async () => 'ok' } };
  ` }));
  await page.route("**/atomm-nesting-import", route => route.fulfill({ contentType: "text/html", body: '<iframe title="Generator" src="/studio" style="width:100%;height:900px"></iframe>' }));
  await page.goto("/atomm-nesting-import");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  await studio.locator('input[type="file"]').first().setInputFiles({
    name: "nested-project.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...DEFAULT_PROJECT, name: "Nested import", sheetNesting: { ...DEFAULT_SHEET_NESTING, sheetWidthMm: 800, sheetHeightMm: 600 } })),
  });
  await expect(studio.getByRole("textbox", { name: "Project name" })).toHaveValue("Nested import");
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false");
  const exported = await studio.locator("body").evaluate(async () => {
    type File = { filename: string; blob: Blob };
    const hook = (window as unknown as { testExport: (input: { intent: string }) => Promise<File[]> }).testExport;
    const files = await hook({ intent: "download" });
    const manifest = files.find(file => file.filename.endsWith("-project.json"))!;
    return { names: files.map(file => file.filename), manifest: JSON.parse(await manifest.blob.text()) };
  });
  expect(exported.manifest.project.sheetNesting.sheetWidthMm).toBe(800);
  expect(Boolean(exported.manifest.result.fabrication.sheetNesting)).toBe(!unavailable);
  expect(exported.names.some(name => /-sheet-\d+/.test(name))).toBe(!unavailable);
  expect(exported.names.some(name => /-master\.svg$/.test(name))).toBe(true);
  expect(plannerRequests.length).toBeGreaterThan(0);
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  await expect(studio.locator(".export-layout-note")).toContainText(unavailable ? "Using original panels" : "800 × 600 mm");
  expect(errors).toEqual([]);
});

test("Atomm shows live nesting progress, keeps the current layout, and remembers material size", async ({ page }) => {
  test.setTimeout(120_000);
  let geometryRequests = 0;
  page.on("request", request => { if (/geometry\.worker-/.test(request.url())) geometryRequests++; });
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en' } };` }));
  await page.route("**/atomm-live-nesting", route => route.fulfill({ contentType: "text/html", body: '<iframe src="/studio" style="width:100%;height:900px"></iframe>' }));
  await page.goto("/atomm-live-nesting");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  await expect(studio.locator(".preview-stage")).toHaveAttribute("aria-busy", "false");
  const requestsBefore = geometryRequests;
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  const loader = studio.locator(".nesting-progress");
  await expect(loader).toContainText("Arranging sheets");
  await expect(loader).toContainText("Step 1 of 2");
  await expect(studio.locator(".atomm-nesting-drafts svg").first()).toBeVisible();
  await expect(loader).toContainText("material used");
  expect(await loader.locator(".contour-loader span").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await studio.getByRole("button", { name: "Use current layout" }).click();
  await expect(studio.locator(".export-layout-note")).toContainText("600 × 400 mm");
  const width = studio.getByRole("spinbutton", { name: "Material width", exact: true });
  await expect(width).toHaveValue("600");
  await width.fill("10");
  await expect(width).toHaveAttribute("aria-invalid", "true");
  await expect(studio.locator(".export-layout-note")).toContainText("600 × 400 mm");
  await width.fill("700");
  await expect(loader).toContainText("Arranging sheets");
  await expect(studio.locator(".export-layout-note")).toContainText("700 × 400 mm", { timeout: 20_000 });
  expect(geometryRequests).toBe(requestsBefore);
  await page.reload();
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  await expect(width).toHaveValue("700");
  await expect(studio.getByRole("spinbutton", { name: "Material height", exact: true })).toHaveValue("400");
  await expect(studio.locator(".export-layout-note")).toContainText("700 × 400 mm", { timeout: 20_000 });
});

test("Atomm nesting material aligns card borders, headings and fields with its neighbors", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en' } };` }));
  await page.route("**/atomm-alignment", route => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><iframe src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe></body>' }));
  await page.goto("/atomm-alignment");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  await studio.getByRole("button", { name: "Cut size", exact: true }).click();
  for (const direction of ["ltr", "rtl"]) {
    await studio.locator("html").evaluate((el, value) => el.setAttribute("dir", value), direction);
    for (const width of [1600, 1280, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const alignment = await studio.locator(".gen-params-content").evaluate(el => {
        const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
        const material = rect(".atomm-material-size"), size = rect('[aria-labelledby="atomm-size-title"]');
        const heading = rect(".atomm-material-size h3"), referenceHeading = rect("#atomm-size-title");
        const field = rect('.atomm-material-size .number-input'), referenceField = rect('#section-size .number-input');
        const label = rect('.atomm-material-size .ldt-field__label'), referenceLabel = rect('#section-size .ldt-field__label');
        return [material.left - size.left, material.right - size.right, heading.left - referenceHeading.left,
          heading.right - referenceHeading.right, field.left - referenceField.left, field.right - referenceField.right,
          label.left - referenceLabel.left, label.right - referenceLabel.right];
      });
      for (const delta of alignment) expect(Math.abs(delta)).toBeLessThan(1);
      await page.screenshot({ path: testInfo.outputPath(`material-alignment-${direction}-${width}.png`) });
    }
  }
});

test("Atomm expanded parameter labels and control edges align in layered and flat modes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/v1/**", route => route.abort());
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en' } };` }));
  await page.route("**/atomm-field-alignment", route => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><iframe src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe></body>' }));
  await page.goto("/atomm-field-alignment");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".status-line")).toContainText("Real terrain ready", { timeout: 45_000 });
  for (const mode of ["Layered relief", "Flat engraving"]) {
    await studio.getByRole("radio", { name: mode, exact: true }).click();
    await studio.locator(".gen-params-content").evaluate(el => {
      el.querySelectorAll<HTMLButtonElement>('.section-disclosure[aria-expanded="false"]').forEach(button => button.click());
    });
    const customize = studio.locator(".linework-customize");
    if (await customize.getAttribute("aria-expanded") === "false") await customize.click();
    await expect(studio.locator(".linework-controls .field-row")).toHaveCount(mode === "Flat engraving" ? 10 : 7);
    for (const direction of ["ltr", "rtl"]) {
      await studio.locator("html").evaluate((el, value) => el.setAttribute("dir", value), direction);
      for (const width of [1600, 1280, 700, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const offsets = await studio.locator(".gen-params-content").evaluate(el => {
          const rtl = getComputedStyle(el).direction === "rtl";
          const referenceControl = el.querySelector("#section-size .number-input")!.getBoundingClientRect();
          const referenceLabel = el.querySelector("#section-size .ldt-field__label")!.getBoundingClientRect();
          return [...el.querySelectorAll(".field-row, .range-field, .atomm-switch-row")].flatMap(row => {
            if (!row.getBoundingClientRect().height) return [];
            const control = row.querySelector(".number-input, select, .switch");
            const label = row.querySelector(".ldt-field__label, .range-field__label, label, .toggle-label");
            if (!control || !label) return [];
            const c = control.getBoundingClientRect(), l = label.getBoundingClientRect();
            return [{ label: label.textContent?.trim(), labelOffset: rtl ? referenceLabel.right - l.right : l.left - referenceLabel.left,
              controlOffset: rtl ? c.left - referenceControl.left : referenceControl.right - c.right }];
          });
        });
        expect(offsets.length).toBeGreaterThan(20);
        for (const row of offsets) {
          const context = `${mode}, ${direction}, ${width}px: ${row.label}`;
          expect(Math.abs(row.labelOffset), `${context} label`).toBeLessThan(1);
          expect(Math.abs(row.controlOffset), `${context} control`).toBeLessThan(1);
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }
});
