import { expect, test } from "@playwright/test";
import { DEFAULT_PROJECT } from "@topostack/core";

for (const outputMode of ["stack", "engraving"] as const) {
for (const [widthMm, heightMm] of [[100, 200], [400, 100]] as const) {
  test(`fits and navigates a ${widthMm} × ${heightMm} ${outputMode} preview`, async ({ page }) => {
    await page.route("https://static-res.makextool.com/**", (route) => route.abort());
    await page.route("https://tiles.openfreemap.org/styles/**", (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
    await page.goto("/studio");
    // Include legacy bounds with an aspect ratio different from this cut.
    const project = { ...DEFAULT_PROJECT, outputMode, widthMm, heightMm, location: { ...DEFAULT_PROJECT.location, bounds: { west: -122.3, east: -122, north: 43.05, south: 42.85 } } };
    await page.locator('input[type="file"][accept^="application/json"]').setInputFiles({ name: "viewport.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await page.getByRole("radio", { name: "Map", exact: true }).click();
    const guide = page.locator(".crop-guide");
    async function expectAspect(): Promise<void> {
      await expect.poll(async () => {
        const rect = await guide.boundingBox();
        return rect ? rect.width / rect.height : 0;
      }).toBeCloseTo(widthMm / heightMm, 2);
    }
    await expectAspect();
    await page.setViewportSize({ width: 900, height: 900 });
    await expectAspect();
    await page.getByRole("button", { name: /Generate terrain/ }).click();
    await expect(page.getByText("Ready to export")).toBeVisible();
    await page.getByRole("radio", { name: outputMode === "stack" ? "Cut layers" : "Engraving", exact: true }).click();
    const viewport = page.locator("[data-svg-viewport]");
    const svg = viewport.getByRole("img");
    await expect(svg).toBeVisible();
    async function expectFitted(): Promise<void> {
      const result = await svg.evaluate((element, size) => {
        const svg = element as SVGSVGElement;
        const stage = svg.closest("[data-svg-viewport]")!.getBoundingClientRect();
        const matrix = svg.getScreenCTM()!;
        const first = new DOMPoint(-size.widthMm / 2, -size.heightMm / 2).matrixTransform(matrix);
        const last = new DOMPoint(size.widthMm / 2, size.heightMm / 2).matrixTransform(matrix);
        return { inside: first.x > stage.left && first.y > stage.top && last.x < stage.right && last.y < stage.bottom,
          offsetX: (first.x + last.x) / 2 - (stage.left + stage.width / 2),
          offsetY: (first.y + last.y) / 2 - (stage.top + stage.height / 2) };
      }, { widthMm, heightMm });
      expect(result.inside).toBe(true);
      expect(Math.abs(result.offsetX)).toBeLessThan(1);
      expect(Math.abs(result.offsetY)).toBeLessThan(1);
    }
    await expectFitted();
    await page.setViewportSize({ width: 720, height: 900 });
    await expectFitted();
    const initial = await svg.getAttribute("viewBox");
    // Newly generated artwork must pan at 100%, without redrawing its vectors.
    const panAtFit = (await viewport.boundingBox())!;
    const originAtFit = await svg.evaluate((element) => {
      const p = new DOMPoint(0, 0).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
    await page.mouse.move(panAtFit.x + panAtFit.width / 2, panAtFit.y + panAtFit.height / 2);
    await page.mouse.down();
    await page.mouse.move(panAtFit.x + panAtFit.width / 2 + 40, panAtFit.y + panAtFit.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const pannedAtFit = await svg.evaluate((element) => {
      const p = new DOMPoint(0, 0).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
    expect(pannedAtFit.x - originAtFit.x).toBeCloseTo(40, 0);
    expect(pannedAtFit.y - originAtFit.y).toBeCloseTo(30, 0);
    await expect(svg).toHaveAttribute("viewBox", initial!);
    await expect(viewport).toHaveAttribute("data-zoom", "1.00");
    await viewport.press("0");
    await expectFitted();

    // Continuous zoom reuses the vector drawing and preserves the cursor anchor.
    const gesture = await viewport.evaluate(async (element) => {
      const svg = element.querySelector("svg")!;
      const bounds = element.getBoundingClientRect();
      const cursor = new DOMPoint(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 20);
      const anchor = cursor.matrixTransform(svg.getScreenCTM()!.inverse());
      const viewBoxes = new Set([svg.getAttribute("viewBox")]);
      let maxDrift = 0;
      for (let i = 0; i < 12; i++) {
        element.dispatchEvent(new WheelEvent("wheel", { deltaY: -20, clientX: cursor.x, clientY: cursor.y, bubbles: true, cancelable: true }));
        await new Promise(requestAnimationFrame);
        viewBoxes.add(svg.getAttribute("viewBox"));
        const point = anchor.matrixTransform(svg.getScreenCTM()!);
        maxDrift = Math.max(maxDrift, Math.hypot(point.x - cursor.x, point.y - cursor.y));
      }
      return { drawings: viewBoxes.size, maxDrift, anchor: { x: anchor.x, y: anchor.y }, cursor: { x: cursor.x, y: cursor.y } };
    });
    expect(gesture.drawings).toBe(1);
    expect(gesture.maxDrift).toBeLessThan(1);
    await expect(viewport).toHaveAttribute("data-rendering", "sharp");
    const settledDrift = await svg.evaluate((element, { anchor, cursor }) => {
      const point = new DOMPoint(anchor.x, anchor.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
      return Math.hypot(point.x - cursor.x, point.y - cursor.y);
    }, gesture);
    expect(settledDrift).toBeLessThan(1);
    await viewport.press("0");
    const pinchGesture = await viewport.evaluate(async (element) => {
      const svg = element.querySelector("svg")!;
      const bounds = element.getBoundingClientRect();
      const x = Math.round(bounds.x + bounds.width / 2 + 20);
      const y = Math.round(bounds.y + bounds.height / 2 + 20);
      const anchor = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!.inverse());
      const initial = svg.getAttribute("viewBox");
      // Synthetic pointers have no browser capture state. Exercise the same
      // handlers in every engine; the mouse test below uses native capture.
      const capture = element.setPointerCapture;
      element.setPointerCapture = () => {};
      const pointer = (type: string, pointerId: number, clientX: number) =>
        element.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: "touch", button: 0, clientX, clientY: y, bubbles: true, cancelable: true }));
      try {
        pointer("pointerdown", 1, x - 40);
        pointer("pointerdown", 2, x + 40);
        let maxDrift = 0;
        let reusedDrawing = true;
        for (let i = 1; i <= 12; i++) {
          pointer("pointermove", 1, x - 40 - i);
          pointer("pointermove", 2, x + 40 + i * 3);
          await new Promise(requestAnimationFrame);
          reusedDrawing &&= svg.getAttribute("viewBox") === initial;
          const point = anchor.matrixTransform(svg.getScreenCTM()!);
          maxDrift = Math.max(maxDrift, Math.hypot(point.x - (x + i), point.y - y));
        }
        // Pausing with both fingers down must not trigger a vector redraw.
        await new Promise((resolve) => setTimeout(resolve, 220));
        reusedDrawing &&= svg.getAttribute("viewBox") === initial;
        pointer("pointerup", 2, x + 76);
        await new Promise(requestAnimationFrame);
        const settled = anchor.matrixTransform(svg.getScreenCTM()!);
        // Lifting one finger should flow directly into a one-finger drag.
        pointer("pointermove", 1, x - 42);
        await new Promise(requestAnimationFrame);
        pointer("pointerup", 1, x - 42);
        await new Promise(requestAnimationFrame);
        const dragged = anchor.matrixTransform(svg.getScreenCTM()!);
        return { reusedDrawing, maxDrift, settledDrift: Math.hypot(settled.x - (x + 12), settled.y - y),
          dragDistance: dragged.x - settled.x };
      } finally { element.setPointerCapture = capture; }
    });
    expect(pinchGesture.reusedDrawing).toBe(true);
    expect(pinchGesture.maxDrift).toBeLessThan(1);
    expect(pinchGesture.settledDrift).toBeLessThan(1);
    expect(pinchGesture.dragDistance).toBeCloseTo(10, 0);
    await viewport.press("0");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(viewport).toHaveAttribute("data-zoom", "1.50");
    await expect(viewport).toHaveAttribute("data-rendering", "sharp");
    const zoomed = await svg.getAttribute("viewBox");
    const rect = (await viewport.boundingBox())!;
    const screenOrigin = () => svg.evaluate((element) => {
      const point = new DOMPoint(0, 0).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    // Drag beyond each pair of limits. The last preview frame and the committed
    // vector camera must agree, even when the pointer has overshot the bounds.
    for (const [dx, dy] of [[260, 220], [-260, -220], [-260, 220], [260, -220]] as const) {
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      const beforeDrag = await svg.getAttribute("viewBox");
      await page.mouse.move(rect.x + rect.width / 2 + dx, rect.y + rect.height / 2 + dy, { steps: 5 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await expect(svg).toHaveAttribute("viewBox", beforeDrag!);
      const beforeRelease = await screenOrigin();
      await page.mouse.up();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const afterRelease = await screenOrigin();
      expect(Math.hypot(afterRelease.x - beforeRelease.x, afterRelease.y - beforeRelease.y)).toBeLessThan(1);
    }
    await expect(svg).toHaveAttribute("viewBox", zoomed!);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => Number(await viewport.getAttribute("data-zoom"))).toBeGreaterThan(1.5);
    await viewport.press("0");
    await expect(svg).toHaveAttribute("viewBox", initial!);
    await viewport.press("+");
    await expect(viewport).toHaveAttribute("data-rendering", "sharp");
    const beforeKeyboardPan = await svg.getAttribute("viewBox");
    const beforeKeyOrigin = await screenOrigin();
    await viewport.press("ArrowRight");
    await expect(svg).toHaveAttribute("viewBox", beforeKeyboardPan!);
    expect((await screenOrigin()).x).toBeLessThan(beforeKeyOrigin.x);
    await page.getByRole("button", { name: outputMode === "stack" ? "Reset cut view" : "Reset engraving view" }).click();
    await expect(svg).toHaveAttribute("viewBox", initial!);
    await expectFitted();
    // Exercise the close-detail rendering mode with native pointer capture.
    // Releasing and resetting must retain the same camera coordinates as SVG.
    for (let step = 0; step < 10; step++) await viewport.press("+");
    await expect(viewport).toHaveAttribute("data-zoom", "6.00");
    await expect(viewport).toHaveAttribute("data-rendering", "sharp");
    const closeViewBox = await svg.getAttribute("viewBox");
    const closeOrigin = await screenOrigin();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 80, rect.y + rect.height / 2 - 60, { steps: 12 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const closeDragged = await screenOrigin();
    expect(closeDragged.x - closeOrigin.x).toBeCloseTo(80, 0);
    expect(closeDragged.y - closeOrigin.y).toBeCloseTo(-60, 0);
    await page.mouse.up();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const closeReleased = await screenOrigin();
    expect(Math.hypot(closeReleased.x - closeDragged.x, closeReleased.y - closeDragged.y)).toBeLessThan(1);
    await expect(svg).toHaveAttribute("viewBox", closeViewBox!);
    await viewport.press("0");
    await expectFitted();
    if (outputMode === "stack") {
      // Switching layers retains the shared camera.
      await viewport.press("+");
      await expect(viewport).toHaveAttribute("data-rendering", "sharp");
      const beforeLayer = await svg.getAttribute("viewBox");
      await page.locator(".layer-range").fill("0");
      await expect(svg).toHaveAttribute("viewBox", beforeLayer!);
    }
    await page.getByRole("radio", { name: "Map", exact: true }).click();
    await page.getByRole("tab", { name: "Place", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Width", exact: true }).fill(String(widthMm * 2));
    await expect.poll(async () => {
      const rect = await guide.boundingBox();
      return rect ? rect.width / rect.height : 0;
    }).toBeCloseTo(widthMm * 2 / heightMm, 2);
    await expect(page.locator(".status-line")).toContainText(outputMode === "stack" ? "Fabrication geometry updated" : "Engraving artwork updated", { timeout: 30_000 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("button", { name: /Complete project/ })).toBeEnabled();
  });
}
}
