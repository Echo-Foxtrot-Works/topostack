import { expect, test } from "@playwright/test";

test("annotation placement preserves live edits and previews title knockouts", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const state = window as unknown as Window & { placementDrawCalls: number };
    state.placementDrawCalls = 0;
    if (typeof WebGL2RenderingContext === "undefined") return;
    const original = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (mode, count, type, offset) {
      state.placementDrawCalls += 1;
      original.call(this, mode, count, type, offset);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/v1/**", route => route.abort("internetdisconnected"));
  await page.goto("/studio");
  await page.getByRole("tab", { name: "Labels", exact: true }).click();
  await page.getByRole("switch", { name: "Title", exact: true }).click();
  await page.locator(".plaque-settings .placement-start").click();
  const title = page.locator('[data-placeable="plaque"]');
  await expect(title).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  await title.focus();
  await page.keyboard.press("ArrowRight");
  await page.locator(".plaque-settings textarea").fill("Updated title");
  await page.getByRole("combobox", { name: "Title font", exact: true }).click();
  await page.getByRole("option", { name: "Jost", exact: true }).click();
  await expect(title).toBeVisible();
  await expect(page.locator('[data-placement-knockout="plaque"]')).toHaveAttribute("fill", "black");

  // Sample repeated interaction in the actual browser; attach timings rather
  // than imposing a hardware-dependent frame-rate assertion on CI.
  await expect(page.locator(".preview-stage")).toHaveAttribute("aria-busy", "false");
  // Let the camera's 260 ms entrance and the debounced scene update settle.
  await page.waitForTimeout(500);
  const timing = await title.evaluate(async element => {
    const state = window as unknown as Window & { placementDrawCalls: number };
    const draws = state.placementDrawCalls;
    const frames: number[] = [];
    for (let index = 0; index < 30; index++) {
      const start = performance.now();
      element.dispatchEvent(new KeyboardEvent("keydown", { key: index % 2 ? "ArrowLeft" : "ArrowRight", bubbles: true }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      frames.push(performance.now() - start);
    }
    frames.sort((a, b) => a - b);
    return { medianMs: frames[15], p95Ms: frames[28], drawCalls: state.placementDrawCalls - draws };
  });
  expect(timing.drawCalls).toBe(0);
  console.log(`${testInfo.project.name} placement frames: ${JSON.stringify(timing)}`);
  await testInfo.attach("placement-frame-timing", { body: JSON.stringify(timing), contentType: "application/json" });
  await page.locator(".placement-toolbar").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("[data-placement-layer]")).toHaveCount(0);
  await expect(page.locator(".plaque-settings textarea")).toHaveValue("Updated title");

  // Committed Svelte drafts must cross worker and IndexedDB boundaries as
  // plain data; an in-memory reopen alone does not detect proxy leakage.
  await page.locator(".plaque-settings .placement-start").click();
  const committedTitle = await title.getAttribute("d");
  await page.keyboard.press("Escape");
  await expect(title).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    return new Promise<string | undefined>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("keyval").objectStore("keyval").get("topostack:project:v1");
        read.onsuccess = () => { resolve(read.result?.plaque?.text); db.close(); };
        read.onerror = () => { reject(read.error); db.close(); };
      };
    });
  })).toBe("Updated title");
  await page.reload();
  await page.locator(".plaque-settings .placement-start").click();
  await expect(title).toHaveAttribute("d", committedTitle!);
  await page.keyboard.press("Escape");
  await expect(title).toHaveCount(0);

  // The flat backdrop uses the same masks and preserves the draft on cancel.
  await page.getByRole("radio", { name: "Flat engraving", exact: true }).click();
  await page.locator(".plaque-settings .placement-start").click();
  await expect(page.locator('[data-placement-backdrop="flat"]')).toBeVisible();
  await title.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-placement-layer]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("placement controls leave default annotations reachable at desktop and narrow widths", async ({ page }) => {
  await page.goto("/studio");
  await page.getByRole("tab", { name: "Labels", exact: true }).click();
  await page.locator(".placement-start").first().click();
  const scale = page.locator('[data-placeable="scale"]');
  await expect(scale).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await scale.scrollIntoViewIfNeeded();
    await expect.poll(() => scale.evaluate(element => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
    })).toBe(true);
    const toolbar = page.locator(".placement-toolbar");
    const drawing = page.locator(".placement-layer > svg");
    await expect.poll(async () => {
      const controls = await toolbar.boundingBox();
      const canvas = await drawing.boundingBox();
      return Boolean(controls && canvas && controls.y + controls.height <= canvas.y);
    }).toBe(true);
    await expect(toolbar.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
    await expect(toolbar.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
  }
  const before = await scale.getAttribute("d");
  const box = await scale.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await expect(scale).not.toHaveAttribute("d", before!);
  await page.keyboard.press("Escape");
  await expect(scale).toHaveCount(0);

  await page.getByRole("radio", { name: "Flat engraving", exact: true }).click();
  await page.locator(".placement-start").first().click();
  const done = page.locator(".placement-toolbar").getByRole("button", { name: "Done", exact: true });
  await expect.poll(() => done.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await scale.focus();
  await page.keyboard.press("Shift+ArrowRight");
  const committedScale = await scale.getAttribute("d");
  await done.click();
  await expect(scale).toHaveCount(0);
  await page.reload();
  await page.locator(".placement-start").first().click();
  await expect(scale).toHaveAttribute("d", committedScale!);
});
