import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import polygonClipping, { type Pair } from "polygon-clipping";
import { DEFAULT_PROJECT, distanceToSegment, type Point2D } from "@topostack/core";
import { shareUrl } from "@topostack/data-contracts/share-link";

test("nests the parts onto stock sheets with sparrow and exports one file per sheet", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.route("**/v1/events", (route) => route.fulfill({ status: 204 }));

  const split = { ...DEFAULT_PROJECT, workAreaWidthMm: 175, workAreaHeightMm: 140, optimizeMaterialUse: false };
  await page.goto("/studio" + new URL(shareUrl(split, "https://example.test/studio")).hash);
  await expect(page.getByRole("tab", { name: "Place", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /generate terrain/i }).first().click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 60_000 });

  await page.getByRole("button", { name: "Export", exact: true }).click();
  // The nesting engine is credited wherever the tool appears.
  await expect(page.getByRole("link", { name: /^sparrow/ })).toHaveAttribute("href", "https://github.com/JeroenGar/sparrow");
  await page.getByRole("radio", { name: "Nested sheets" }).check();
  await page.getByRole("spinbutton", { name: "Sheet width", exact: true }).fill("400");
  await page.getByRole("spinbutton", { name: "Sheet height", exact: true }).fill("300");
  await page.getByRole("combobox", { name: "Search time" }).selectOption("10");
  await page.getByRole("button", { name: "Nest parts" }).click();
  await expect(page.getByRole("button", { name: /Stop and keep best/ })).toBeVisible();
  // The search runs for its budget in the worker; the button returns once it settles.
  await expect(page.getByRole("button", { name: "Nest again" })).toBeVisible({ timeout: 60_000 });
  const status = page.locator(".sheet-layout-status");
  await expect(status).toContainText(/\d+ sheets? · \d+% material used/);
  // The WebAssembly engine started: no fallback note.
  await expect(status).not.toContainText("could not start");
  await expect(page.locator(".sheet-previews li")).not.toHaveCount(0);
  await expect(page.locator(".export-hero")).toContainText("nested sheet");

  async function downloadBytes(label: RegExp): Promise<Buffer> {
    const ready = page.waitForEvent("download");
    await page.getByRole("button", { name: label }).click();
    const stream = await (await ready).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  const files = unzipSync(await downloadBytes(/Complete project/));
  const names = Object.keys(files);
  expect(names).toContain("crater-lake-sheet-01.svg");
  expect(names).toContain("crater-lake-sheet-01-engrave.svg");
  expect(names.some((name) => /-panel-|layer-\d+\.svg$/.test(name))).toBe(false);
  const manifest = JSON.parse(Buffer.from(files["crater-lake-project.json"]!).toString("utf8"));
  expect(manifest.result.fabrication.sheetNesting.engine).toMatchObject({ name: "sparrow", jaguaVersion: "0.8.3" });
  const panels: { filename: string; layerIds: string[]; parts: { label: string }[] }[] = manifest.result.fabrication.panels;
  expect(panels.map(panel => panel.filename).sort()).toEqual(names.filter(name => /-sheet-\d+\.svg$/.test(name)).sort());
  expect(manifest.result.fabrication.workArea.columns).toBeGreaterThan(1);
  const { marginMm: margin, spacingMm: spacing } = manifest.result.fabrication.sheetNesting.settings;
  let neighbouringPieces = 0;
  for (const panel of panels) {
    const markup = Buffer.from(files[panel.filename]!).toString("utf8");
    const measured = await page.evaluate(svg => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = doc.documentElement as unknown as SVGSVGElement;
      const layers = new Set<string>(), labels = new Set<string>();
      const rings: Point2D[][] = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, vertices = 0;
      for (const path of root.querySelectorAll<SVGPathElement>('[data-operation="CUT"] path')) {
        const layer = /^(layer-\d+)-cut-/.exec(path.id)?.[1];
        if (!layer) throw new Error("Unidentified wood cut " + path.id);
        layers.add(layer);
        const label = path.closest("[data-part]")?.getAttribute("data-part");
        if (!label) throw new Error("Cut without a placed part " + path.id);
        labels.add(label);
        let matrix = new DOMMatrix();
        for (let node: Element | null = path; node && node !== root; node = node.parentElement) {
          const transform = (node as SVGGraphicsElement).transform.baseVal.consolidate();
          if (transform) matrix = new DOMMatrix([transform.matrix.a, transform.matrix.b, transform.matrix.c, transform.matrix.d, transform.matrix.e, transform.matrix.f]).multiply(matrix);
        }
        const ring: Point2D[] = [];
        for (const match of path.getAttribute("d")!.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
          const point = new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(matrix);
          ring.push({ x: point.x, y: point.y });
          vertices++;
          minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
        }
        if (!path.id.includes("-hole-")) rings.push(ring);
      }
      return { rings, layers: [...layers].sort(), labels: [...labels].sort(), bounds: [minX, minY, maxX, maxY], vertices, viewBox: root.getAttribute("viewBox") };
    }, markup);
    expect(measured.viewBox).toBe("0 0 400 300");
    expect(measured.vertices).toBeGreaterThan(2);
    expect(measured.layers).toEqual([...panel.layerIds].sort());
    expect(measured.labels).toEqual(panel.parts.map(part => part.label).sort());
    expect(measured.bounds[0]!).toBeGreaterThanOrEqual(margin - 0.02);
    expect(measured.bounds[1]!).toBeGreaterThanOrEqual(margin - 0.02);
    expect(measured.bounds[2]!).toBeLessThanOrEqual(400 - margin + 0.02);
    expect(measured.bounds[3]!).toBeLessThanOrEqual(300 - margin + 0.02);
    // Measure the emitted cut rings after the root group transform. Optimizing
    // donor material is off, so every outer ring is an independently cut piece.
    const pairs = (ring: Point2D[]): Pair[] => ring.map(({ x, y }) => [x, y]);
    const vertexGap = (first: Point2D[], second: Point2D[]) => {
      let gap = Infinity;
      for (const point of first) for (let i = 0; i < second.length; i++) {
        gap = Math.min(gap, distanceToSegment(point, second[i]!, second[(i + 1) % second.length]!));
      }
      return gap;
    };
    for (const [index, a] of measured.rings.entries()) for (const b of measured.rings.slice(index + 1)) {
      expect(polygonClipping.intersection([pairs(a)], [pairs(b)])).toHaveLength(0);
      expect(Math.min(vertexGap(a, b), vertexGap(b, a))).toBeGreaterThanOrEqual(spacing - 0.02);
      neighbouringPieces++;
    }
  }
  expect(neighbouringPieces).toBeGreaterThan(0);
  const readme = Buffer.from(files["README.txt"]!).toString("utf8");
  expect(readme).toContain("sparrow");

  await page.getByText("Individual files").click();
  const sheetNames = manifest.result.fabrication.panels.map(({ filename }: { filename: string }) =>
    filename.replace("crater-lake-sheet-", "Sheet ").replace(".svg", ""));
  const studio = unzipSync(await downloadBytes(/xTool Studio project/));
  const project = JSON.parse(Buffer.from(studio["project.json"]!).toString("utf8"));
  const titles = project.modules.canvases.map((id: string) => JSON.parse(Buffer.from(studio[`canvases/${id}.json`]!).toString("utf8")).title);
  expect(titles).toEqual(sheetNames);
  const lightburn = (await downloadBytes(/LightBurn project with pages/)).toString("utf8");
  expect(lightburn).toContain(`Page0Name="${sheetNames[0]}"`);
  expect([...lightburn.matchAll(/SubType="Page" Name="([^"]+)"/g)].map(match => match[1])).toEqual(sheetNames.slice(1));

  // After a reload the same design finds its saved layout; no second search.
  const summary = (await status.textContent())?.trim();
  await page.reload();
  await page.getByRole("button", { name: /generate terrain/i }).first().click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Nested sheets" })).toBeChecked();
  await expect(page.locator(".sheet-layout-status")).toHaveText(summary!);
  await expect(page.locator(".export-hero")).toContainText("nested sheet");
  expect(browserErrors).toEqual([]);
});
