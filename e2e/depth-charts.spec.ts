import { boundsAround, DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import { shareUrl } from "@topostack/data-contracts/share-link";
import { unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { chartPdf, chartRings, lakeArchive, lakeCentre } from "./fixtures/depth-chart";

async function openCharts(page: Page, fromMap = false, withoutSearch = false, project?: ProjectConfigV1): Promise<void> {
  // Linux WebKit can capture a stale WebGL frame after buffer swaps. Preserve
  // test drawing buffers so screenshot assertions observe the current hover.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: object) {
      return Reflect.apply(getContext, this, [type,
        type === "webgl" || type === "webgl2" ? { ...options, preserveDrawingBuffer: true } : options,
      ]);
    } as typeof getContext;
  });
  const centre = withoutSearch ? DEFAULT_PROJECT.location : lakeCentre;
  const hydro = lakeArchive(centre, project ? "coarse-lake" : undefined);
  const mapWater = project ? lakeArchive(centre, "map-water") : undefined;
  await page.route("**/v1/**", async route => {
    const url = route.request().url();
    if (url.includes("/geocode")) return route.fulfill({ json: [{ place_id: "round-lake", display_name: "Round Lake, Test Region", ...lakeCentre }] });
    if (url.includes("/lake-outlines/")) return route.fulfill({ json: { schemaVersion: 1, shards: [] } });
    const archive = url.endsWith("/lakes.pmtiles") ? hydro : url.endsWith("/osm.pmtiles") ? mapWater : undefined;
    if (archive) {
      const range = /bytes=(\d+)-(\d+)/.exec(route.request().headers().range ?? "");
      const start = Number(range?.[1] ?? 0), end = Math.min(Number(range?.[2] ?? archive.length - 1), archive.length - 1);
      return route.fulfill({ status: 206, headers: { "content-type": "application/octet-stream", "access-control-expose-headers": "ETag, Content-Range", etag: '"test-lake"', "content-range": `bytes ${start}-${end}/${archive.length}` }, body: archive.subarray(start, end + 1) });
    }
    return route.abort();
  });
  await page.route("https://static-res.makextool.com/**", route => route.abort());
  await page.route("https://tiles.openfreemap.org/styles/**", route => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#e9e5da" } }],
  } }));
  await page.goto(project ? "/studio" + new URL(shareUrl(project, "https://example.test/studio")).hash : "/studio");
  await page.getByRole("radio", { name: "Custom data", exact: true }).click();
  await expect(page.locator(".generate-dock")).toHaveCount(0);
  if (!withoutSearch) {
  await page.getByRole("textbox", { name: "Search for a lake", exact: true }).fill("Round Lake");
  await page.locator(".chart-search").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".chart-lakes")).toContainText("Round Lake");
  }
  if (fromMap) {
    const canvas = page.locator(".maplibregl-canvas");
    await expect(canvas).toBeVisible();
    // Wait for the actual GeoJSON hit target, then check hover and leave states.
    await expect(async () => {
      await page.mouse.move(0, 0);
      await canvas.hover();
      await expect(canvas).toHaveCSS("cursor", "pointer");
    }).toPass({ timeout: 15_000 });
    // Inspect a rendered fill pixel: cursor feedback alone does not prove the hover highlight renders.
    await expect.poll(async () => {
      // Capture without scrolling the map or moving the pointer.
      const clip = await canvas.boundingBox();
      if (!clip) throw new Error("Lake map missing");
      const png = (await page.screenshot({ clip })).toString("base64");
      await expect(canvas).toHaveCSS("cursor", "pointer");
      return page.evaluate(async (base64) => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
        const copy = document.createElement("canvas"); copy.width = image.width; copy.height = image.height;
        const context = copy.getContext("2d")!; context.drawImage(image, 0, 0);
        return context.getImageData(Math.floor(copy.width / 2), Math.floor(copy.height / 2), 1, 1).data[1];
      }, png);
    }).toBeLessThan(180);
    await page.screenshot({ path: test.info().outputPath("lake-map-hover.png") });
    await page.mouse.move(0, 0);
    await expect(canvas).not.toHaveCSS("cursor", "pointer");
    if (withoutSearch) {
      await expect(page.getByRole("textbox", { name: "Search for a lake", exact: true })).toHaveValue("");
      await expect(page.locator(".chart-chosen")).toHaveCount(0);
      await expect(page.locator(".chart-lakes")).toHaveCount(0);
    }
    await canvas.click();
  } else await page.locator(".chart-lakes").getByRole("button", { name: /Round Lake/ }).click();
  await expect(page.locator(".chart-chosen")).toContainText("Round Lake");
}

/** Correct and approve paths through visible controls, without injecting review state. */
async function reviewContours(page: Page, topology?: "island" | "rise"): Promise<void> {
  await expect(page.getByRole("heading", { name: "5 · Review and correct contours" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate reviewed depths", exact: true })).toBeDisabled();
  await expect(page.locator(".chart-report")).toHaveCount(0);
  const chooser = page.getByLabel("Select review contour", { exact: true });
  for (const [value, x] of [[0,40],[5,275],[10,130]]) {
    const id = await page.locator(".review-source svg[aria-label='Source with reviewed contour overlay']").evaluate((element, x) => {
      const image = element.querySelector("image")!;
      const target = {x:x / 360 * image.width.baseVal.value,y:140 / 280 * image.height.baseVal.value};
      return [...element.querySelectorAll<SVGPathElement>('path[role="button"]')].map(path => {
        let distance=Infinity;
        const length=path.getTotalLength();
        for(let i=0;i<=1000;i++){const p=path.getPointAtLength(length*i/1000);distance=Math.min(distance,Math.hypot(p.x-target.x,p.y-target.y));}
        return {id:path.getAttribute("aria-label")!.split(",")[0]!,distance};
      }).sort((a,b)=>a.distance-b.distance)[0]!.id;
    }, x!);
    await chooser.selectOption(id);
    if (value === 0) await page.getByLabel("Path type", {exact:true}).selectOption("shoreline");
    else await page.getByLabel("Contour printed value", {exact:true}).fill(String(value));
    if (value === 10 && topology === "island") await page.getByLabel("Path type", {exact:true}).selectOption("island");
    if (value === 10 && topology === "rise") {
      await page.getByLabel("Contour printed value", {exact:true}).fill("3");
      await page.getByLabel("Contour interior", {exact:true}).selectOption("shallower");
      await page.getByText("Interior beyond the last contour", {exact:true}).click();
      await page.getByLabel("Contour interior value", {exact:true}).fill("2");
    }
    if (value === 5) {
      await page.getByLabel("Contour printed value", { exact: true }).fill("6");
      await page.getByRole("button", { name: "Undo edit", exact: true }).click();
      await expect(page.getByLabel("Contour printed value", { exact: true })).toHaveValue("5");
      await page.getByRole("button", { name: "Redo edit", exact: true }).click();
      await expect(page.getByLabel("Contour printed value", { exact: true })).toHaveValue("6");
      await page.getByLabel("Contour printed value", { exact: true }).fill("5");
    }
    await page.getByRole("button", { name: "Confirm path and value", exact: true }).click();
  }
  await page.getByRole("button", { name: "Exclude all unassigned paths", exact: true }).click();
  const draftDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export review draft", exact: true }).click();
  const draftStream = await (await draftDownload).createReadStream();
  const draftChunks: Buffer[] = [];
  for await (const chunk of draftStream) draftChunks.push(Buffer.from(chunk));
  const savedDraft = Buffer.concat(draftChunks);
  const saved = JSON.parse(savedDraft.toString());
  expect(saved.schema).toBe("chart-review-draft-v1");
  if (topology === "island") expect(saved.review.contours.some((c: {role?:string;excluded:boolean}) => c.role === "island" && !c.excluded)).toBe(true);
  if (topology === "rise") expect(saved.review.contours.some((c: {inside?:string;interiorValue?:number}) => c.inside === "shallower" && c.interiorValue === 2)).toBe(true);
  await page.locator(".chart-review-restore input").setInputFiles({ name: "review.json", mimeType: "application/json", buffer: savedDraft });
  await page.getByRole("button", { name: "Alignment", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "I checked the alignment and orientation against the source." })).not.toBeChecked();
  for (const [index, [x, y]] of ([[40,50],[320,50],[320,230],[40,230]] as const).entries()) {
    await page.getByRole("button", { name: "Place alignment point", exact: true }).click();
    const svg = page.locator(".review-source svg[aria-label='Source with reviewed contour overlay']");
    await svg.scrollIntoViewIfNeeded();
    const point = await svg.evaluate((element, point) => {
      const svg = element as SVGSVGElement;
      const image = svg.querySelector("image")!;
      const local = new DOMPoint(point.x / 360 * image.width.baseVal.value, point.y / 280 * image.height.baseVal.value);
      const screen = local.matrixTransform(svg.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
    await page.getByRole("spinbutton", { name: `Longitude ${index + 1}`, exact: true }).fill(String(-80 + (x - 180) * .0001));
    await page.getByRole("spinbutton", { name: `Latitude ${index + 1}`, exact: true }).fill(String(45 - (y - 140) * .0001));
    await page.getByRole("spinbutton", { name: `Latitude ${index + 1}`, exact: true }).press("Tab");
  }
  await page.getByRole("checkbox", { name: "I checked the alignment and orientation against the source." }).check();
  await expect(page.getByRole("button", { name: "Generate reviewed depths", exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("contour-review-aligned.png") });
  await page.getByRole("button", { name: "Generate reviewed depths", exact: true }).click();
}

test("traces an image in the worker, saves it, applies it, and restores the library", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text()); });
  await openCharts(page);
  const image = await page.evaluate(rings => {
    const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 280;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white"; context.fillRect(0, 0, 360, 280);
    context.strokeStyle = "#141414"; context.lineWidth = 2;
    for (const [rx, ry] of rings) { context.beginPath(); context.ellipse(180, 140, rx, ry, 0, 0, 2 * Math.PI); context.stroke(); }
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, chartRings);
  await page.locator(".chart-upload input").setInputFiles({ name: "round-lake.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await expect(page.locator(".chart-canvas")).toBeVisible();
  // Source marking shares the cut/flat viewport; panning must never place a depth.
  const sourceViewport = page.locator(".chart-image-area [data-svg-viewport]");
  await page.locator(".chart-image-area").getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(sourceViewport).toHaveAttribute("data-render-zoom", "1.50");
  const sourceBounds = await sourceViewport.boundingBox();
  await page.mouse.move(sourceBounds!.x + sourceBounds!.width / 2, sourceBounds!.y + sourceBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBounds!.x + sourceBounds!.width / 2 - 20, sourceBounds!.y + sourceBounds!.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: /Assign point/ })).toHaveCount(0);
  await page.locator(".chart-image-area").getByRole("button", { name: "Reset source chart view", exact: true }).click();
  await expect(sourceViewport).toHaveAttribute("data-zoom", "1.00");
  await page.getByRole("button", { name: "Prepare contours for review", exact: true }).click();
  await expect(page.locator(".review-tools")).toBeVisible();
  await expect(page.locator(".chart-result")).toHaveCount(0);
  const sourceAtEdit = await page.locator(".review-chart").boundingBox();
  const toolsAtEdit = await page.locator(".review-tools").boundingBox();
  expect(toolsAtEdit!.x).toBeGreaterThanOrEqual(sourceAtEdit!.x + sourceAtEdit!.width);
  expect(Math.abs(toolsAtEdit!.y - sourceAtEdit!.y)).toBeLessThan(2);
  const chartTop = (await page.locator(".review-source").boundingBox())!.y;
  await page.locator(".review-tools-body").evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect((await page.locator(".review-source").boundingBox())!.y).toBe(chartTop);
  await reviewContours(page);
  await expect(page.locator(".chart-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".review-tools")).toHaveCount(0);
  const reviewCamera = page.locator(".review-source [data-svg-viewport]");
  await page.locator(".review-source").getByRole("button", {name:"Zoom in",exact:true}).click();
  await expect(reviewCamera).toHaveAttribute("data-render-zoom", "1.50");
  await page.getByRole("button", {name:"Edit contours",exact:true}).click();
  await expect(page.locator(".review-tools")).toBeVisible();
  await expect(page.locator(".chart-result")).toHaveCount(0);
  await expect(reviewCamera).toHaveAttribute("data-zoom", "1.50");
  await page.getByRole("button", {name:"Contours",exact:true}).click();
  await expect(page.getByRole("button", {name:"Undo edit",exact:true})).toBeEnabled();
  await page.getByRole("button", {name:"View generated depths",exact:true}).click();
  await expect(page.locator(".chart-result")).toBeVisible();
  await expect(reviewCamera).toHaveAttribute("data-zoom", "1.50");
  await page.locator(".review-source").getByRole("button", {name:"Reset chart review view",exact:true}).click();
  await expect(page.locator(".chart-report")).toContainText("100%");
  await expect(page.getByRole("button", { name: "Keep this chart", exact: true })).toBeDisabled();
  await expect(page.locator(".depth-3d canvas:visible")).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1100 });
  const editor = await page.locator(".chart-editor").boundingBox();
  const three = await page.locator(".chart-result__3d").boundingBox();
  const dem = await page.locator(".chart-result__dem").boundingBox();
  expect(three!.x).toBeGreaterThan(editor!.x + editor!.width);
  const previewPanel = await page.locator(".review-preview").boundingBox();
  expect(Math.abs(previewPanel!.y - editor!.y)).toBeLessThan(2);
  expect(dem!.y).toBeGreaterThan(three!.y + three!.height);
  await expect(page.locator(".chart-preview")).toBeVisible();

  await page.locator(".depth-controls").getByRole("button", { name: "Rotate", exact: true }).click();
  await page.locator(".depth-controls").getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("slider", { name: "Exploded layers", exact: true }).fill("0.2");
  await page.locator(".depth-controls").getByRole("button", { name: "Fit view", exact: true }).click();
  await page.locator(".depth-3d").scrollIntoViewIfNeeded();
  await expect(page.getByLabel("3D surface style", { exact: true })).toHaveValue("stack");
  await expect(page.locator(".depth-viewer .chart-hint")).toContainText("12 representative layers · 3 mm stock");
  const contours = await page.locator(".depth-3d").screenshot();
  await page.getByLabel("3D surface style", { exact: true }).selectOption("dem");
  await expect(page.locator(".dem-3d canvas")).toBeVisible();
  await page.getByLabel("Vertical exaggeration", { exact: true }).selectOption("auto");
  const shaded = await page.locator(".depth-3d").screenshot();
  expect(contours.equals(shaded)).toBe(false);
  await page.getByLabel("3D surface style", { exact: true }).selectOption("stack");
  await page.screenshot({ path: testInfo.outputPath("depth-chart-result.png") });
  await expect(page.locator(".chart-preview")).toBeVisible();
  await expect(page.locator(".chart-preview-legend")).toContainText("Shallow");
  await expect(page.locator(".depth-3d canvas:visible")).toBeVisible();
  await page.getByRole("button", { name: "Review and save chart", exact: true }).click();
  await expect(page.locator("#chart-save-heading")).toBeFocused();
  await page.getByRole("checkbox", { name: "I checked the generated basin and layers against the source." }).check();
  await page.getByRole("button", { name: "Keep this chart", exact: true }).click();
  await expect(page.locator(".chart-saved")).toContainText("Round Lake depth chart");
  await page.getByRole("button", { name: "Use for Round Lake", exact: true }).click();
  await expect(page.locator(".chart-saved__state")).toContainText("Ready for Round Lake");
  await expect(page.locator(".generate-dock")).toHaveCount(0);
  // The transferable project file must contain both the reference and chart data.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Project settings/ }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.charts).toHaveLength(1);
  expect(exported.charts[0].review).toMatchObject({ version: 1, profile: "contour-topology-v1", contours: true, alignment: true, layers: true });
  expect(exported.charts[0].lake.hylakId).toBe(900001);
  expect(exported.charts[0].grid.depthsDm.length).toBeGreaterThan(0);
  expect(exported.project.userDepthCharts["900001"].id).toBe(exported.charts[0].id);
  await page.reload();
  await page.getByRole("radio", { name: "Custom data", exact: true }).click();
  await expect(page.locator(".chart-saved")).toContainText("Round Lake depth chart");
  await expect(page.getByRole("button", { name: "Stop using", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop using", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use for Round Lake", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("recovers from invalid uploads and a blank PDF cover, and reviews contours at narrow widths", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openCharts(page);
  const file = page.locator(".chart-upload input");
  await file.setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
  await expect(page.getByRole("alert")).toContainText("could not be read as a PDF");
  await file.setInputFiles({ name: "round-lake.pdf", mimeType: "application/pdf", buffer: chartPdf() });
  await expect(page.getByRole("alert")).toContainText("Page 1 of this PDF is blank");
  const pageNumber = page.getByRole("spinbutton", { name: "Page, of 2", exact: true });
  await pageNumber.fill("2"); await pageNumber.press("Tab");
  await expect(page.locator(".chart-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".chart-error")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Prepare contours for review", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Prepare contours for review", exact: true }).click();
  await reviewContours(page);
  await expect(page.locator(".chart-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".chart-report")).toContainText("100%");
  await expect(page.locator(".depth-3d canvas:visible")).toBeVisible();
  const editor = await page.locator(".chart-editor").boundingBox();
  const three = await page.locator(".chart-result__3d").boundingBox();
  const dem = await page.locator(".chart-result__dem").boundingBox();
  expect(three!.y).toBeGreaterThan(editor!.y + editor!.height);
  expect(dem!.y).toBeGreaterThan(three!.y + three!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".depth-3d").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("depth-chart-mobile.png") });
  await page.locator(".chart-preview").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("depth-chart-mobile-dem.png") });
});


test("selects a lake on the map without changing the terrain location", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openCharts(page, true);
  await expect(page.locator(".chart-lake-map__guide")).toContainText("Lake selected");
  await expect(page.locator(".chart-upload input")).toBeAttached();
  await page.screenshot({ path: testInfo.outputPath("lake-map-selected.png") });
  // Chart selection leaves the existing project's place name alone.
  await expect(page.locator(".terrain-contextbar")).toContainText("Crater Lake");
  expect(errors).toEqual([]);
});


test("discovers and highlights lakes on first open before any search or selection", async ({ page }) => {
  await openCharts(page, true, true);
  await expect(page.locator(".chart-chosen")).toContainText("Round Lake");
});


test("prepares native PDF paths without raster marks and requires review", async ({ page }) => {
  await openCharts(page);
  await page.locator(".chart-upload input").setInputFiles({ name: "native.pdf", mimeType: "application/pdf", buffer: chartPdf() });
  const number = page.getByRole("spinbutton", { name: "Page, of 2", exact: true });
  await number.fill("2"); await number.press("Tab");
  await page.getByText("Use native PDF lines (recommended)", { exact: true }).click();
  const style = page.getByRole("checkbox", { name: /Line style 1/ });
  await expect(style).toBeVisible();
  await style.check();
  await expect(page.locator(".chart-depths li")).toHaveCount(0);
  await page.getByRole("button", { name: "Prepare contours for review", exact: true }).click();
  await expect(page.getByLabel("Select review contour", { exact: true }).locator('option:not([value=""])')).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Generate reviewed depths", exact: true })).toBeDisabled();
  await expect(page.locator(".chart-report")).toHaveCount(0);
});


test("chart repair keeps source coordinates accurate through zoom, pan, and pinch", async ({ page }) => {
  await openCharts(page);
  await page.locator(".chart-upload input").setInputFiles({ name: "native.pdf", mimeType: "application/pdf", buffer: chartPdf() });
  const pageNumber = page.getByRole("spinbutton", { name: "Page, of 2", exact: true });
  await pageNumber.fill("2"); await pageNumber.press("Tab");
  await page.getByText("Use native PDF lines (recommended)", { exact: true }).click();
  await page.getByRole("checkbox", { name: /Line style 1/ }).check();
  await page.getByRole("button", { name: "Prepare contours for review", exact: true }).click();
  const source = page.locator(".review-source");
  const viewport = source.locator("[data-svg-viewport]");
  const svg = source.locator("svg[aria-label='Source with reviewed contour overlay']");
  await source.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(viewport).toHaveAttribute("data-render-zoom", "1.50");
  await page.getByRole("button", { name: "Alignment", exact: true }).click();
  await page.getByRole("button", { name: "Place alignment point", exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const bounds = await viewport.boundingBox();
  const center = { x: Math.round(bounds!.x + bounds!.width / 2), y: Math.round(bounds!.y + bounds!.height / 2) };
  const before = await svg.evaluate(el => { const p = new DOMPoint(100,100).matrixTransform((el as SVGSVGElement).getScreenCTM()!); return {x:p.x,y:p.y}; });
  await page.mouse.move(center.x,center.y); await page.mouse.down();
  await page.mouse.move(center.x + 35,center.y + 20,{steps:6}); await page.mouse.up();
  await expect(page.getByRole("spinbutton", { name: "Longitude 1", exact: true })).toHaveCount(0);
  const after = await svg.evaluate(el => { const p = new DOMPoint(100,100).matrixTransform((el as SVGSVGElement).getScreenCTM()!); return {x:p.x,y:p.y}; });
  expect(after.x-before.x).toBeCloseTo(35,0); expect(after.y-before.y).toBeCloseTo(20,0);
  const local = await svg.evaluate((el,p) => { const v=new DOMPoint(p.x,p.y).matrixTransform((el as SVGSVGElement).getScreenCTM()!.inverse());return {x:v.x,y:v.y}; },center);
  await page.mouse.click(center.x,center.y);
  await expect(page.locator(".review-editor legend").filter({hasText:"Alignment point 1"})).toHaveText(`Alignment point 1 · pixel ${local.x.toFixed(1)}, ${local.y.toFixed(1)}`);
  await page.getByRole("button", { name: "Remove alignment point 1", exact: true }).click();
  await page.getByRole("button", { name: "Draw new contour", exact: true }).click();
  // Same touch handlers as the flat/cut views. Synthetic pointers cannot acquire native capture.
  await viewport.evaluate(async el => {
    const r=el.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
    const capture=el.setPointerCapture; el.setPointerCapture=()=>{};
    const fire=(type:string,id:number,dx:number)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:"touch",button:0,clientX:x+dx,clientY:y,bubbles:true,cancelable:true}));
    try {fire("pointerdown",1,-30);fire("pointerdown",2,30);fire("pointermove",1,-45);fire("pointermove",2,45);fire("pointerup",2,45);fire("pointerup",1,-45);
      el.dispatchEvent(new MouseEvent("click",{detail:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
      await new Promise(requestAnimationFrame);
    } finally {el.setPointerCapture=capture;}
  });
  await expect.poll(async()=>Number(await viewport.getAttribute("data-zoom"))).toBeGreaterThan(1.5);
  await expect(page.getByRole("button", { name: "Finish closed path", exact: true })).toBeDisabled();
  await viewport.scrollIntoViewIfNeeded();
  for(const offset of [0,20]) {const r=await viewport.boundingBox();await page.mouse.click(r!.x+r!.width/2+offset,r!.y+r!.height/2);}
  await expect(page.getByRole("button", { name: "Finish closed path", exact: true })).toBeDisabled();
  const keyboardPath = svg.locator("path[role='button']").first();
  await keyboardPath.evaluate(el => (el as SVGElement).focus({preventScroll:true}));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Finish closed path", exact: true })).toBeEnabled();
  await source.getByRole("button", { name: "Reset chart review view", exact: true }).click();
  await expect(viewport).toHaveAttribute("data-zoom", "1.00");
  await page.getByRole("button", { name: "Cancel drawing", exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const contour = svg.locator("path[role='button']").first();
  const hit = await contour.evaluate(el => {
    const path=el as SVGPathElement, p=path.getPointAtLength(path.getTotalLength()*.2).matrixTransform(path.getScreenCTM()!);
    return {x:p.x,y:p.y,id:el.getAttribute("aria-label")!.split(",")[0]!};
  });
  await page.mouse.click(hit.x,hit.y);
  await expect(page.getByLabel("Select review contour", {exact:true})).toHaveValue(hit.id);
});

for (const topology of ["island", "rise"] as const) test(`reviews and restores an explicit ${topology} before generation`, async ({ page }) => {
  test.setTimeout(120_000);
  const project: ProjectConfigV1 = {
    ...DEFAULT_PROJECT, name: "Island control", widthMm: 300, heightMm: 240, materialThicknessMm: 1, verticalExaggeration: 10,
    location: { ...lakeCentre, zoom: 13, label: "Round Lake", bounds: boundsAround(lakeCentre, 3.2, 300, 240) },
    optimizeMaterialUse: false, paintTemplates: ["water"], showRoads: false, showTrails: false, showAlignmentGuides: false,
  };
  await openCharts(page, false, false, topology === "island" ? project : undefined);
  await page.locator(".chart-upload input").setInputFiles({name:"topology.pdf",mimeType:"application/pdf",buffer:chartPdf()});
  const pageNumber = page.getByRole("spinbutton", {name:"Page, of 2",exact:true});
  await pageNumber.fill("2"); await pageNumber.press("Tab");
  await expect(page.locator(".chart-canvas")).toBeVisible();
  await page.getByRole("button", {name:"Prepare contours for review",exact:true}).click();
  await reviewContours(page, topology);
  await expect(page.locator(".chart-report")).toContainText("100%");
  await page.screenshot({path:test.info().outputPath(`reviewed-${topology}.png`)});
  if (topology !== "island") return;
  // Terrarium RGB (128,100,0) is a flat 100 m plateau. The 180-vertex map
  // shore supersedes the 30-vertex lake outline. Only the chart defines the island.
  const tile = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "rgb(128, 100, 0)"; ctx.fillRect(0, 0, 256, 256);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.route("**/v1/terrain/**/*.png", route => route.fulfill({
    contentType: "image/png",
    headers: { "x-topostack-dataset": "round-lake-100m", "access-control-expose-headers": "x-topostack-dataset" },
    body: Buffer.from(tile, "base64"),
  }));
  await page.getByRole("button", { name: "Review and save chart", exact: true }).click();
  await page.getByRole("checkbox", { name: "I checked the generated basin and layers against the source." }).check();
  await page.getByRole("button", { name: "Keep this chart", exact: true }).click();
  await page.getByRole("button", { name: "Use for Round Lake", exact: true }).click();
  await expect(page.locator(".chart-saved__state")).toContainText("Ready for Round Lake");
  await page.getByRole("radio", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: /Generate terrain|Regenerate terrain/ }).click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Complete project/ }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of await (await download).createReadStream()) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  const text = (name: string) => Buffer.from(files[name]!).toString("utf8");
  const manifest = JSON.parse(text(Object.keys(files).find(name => name.endsWith("-project.json"))!));
  expect(manifest.result.lakeDepths).toContainEqual(expect.objectContaining({ hylakId: 900001, depthSource: "user", surfaceElevationM: 100 }));
  const bounds = manifest.project.location.bounds;
  // Source (180,140) lies on dry land. (255,140) is deep water between the island and 5 m ring.
  const wetX = 0.0075 / (bounds.east - bounds.west) * manifest.project.widthMm;
  const panels: { filename: string; paintTemplateFilenames: string[] }[] = manifest.result.fabrication.panels;
  const shapes = await page.evaluate(({ panels, wetX }) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const sample = (markup: string, x: number) => {
      const svg = new DOMParser().parseFromString(markup, "image/svg+xml");
      return [...svg.querySelectorAll('[data-operation="CUT"] path')].filter(path => ctx.isPointInPath(new Path2D(path.getAttribute("d")!), x, 0, "evenodd")).length % 2 === 1;
    };
    return panels.map(({ wood, stencil }) => ({
      island: sample(wood, 0), bed: sample(wood, wetX),
      maskedIsland: stencil.some(svg => sample(svg, 0)), maskedBed: stencil.some(svg => sample(svg, wetX)),
    }));
  }, { panels: panels.map(panel => ({ wood: text(panel.filename), stencil: panel.paintTemplateFilenames.map(text) })), wetX });
  expect(shapes.every(sheet => sheet.island)).toBe(true);
  expect(shapes.some(sheet => sheet.bed)).toBe(true);
  expect(shapes.some(sheet => !sheet.bed)).toBe(true);
  expect(shapes.some(sheet => sheet.maskedIsland && !sheet.maskedBed)).toBe(true);
});

test("joins visible path fragments with hover feedback, cancellation, and undo", async ({ page }) => {
  await openCharts(page);
  await page.locator(".chart-upload input").setInputFiles({name:"fragments.pdf",mimeType:"application/pdf",buffer:chartPdf()});
  const pageNumber = page.getByRole("spinbutton", {name:"Page, of 2",exact:true});
  await pageNumber.fill("2"); await pageNumber.press("Tab");
  await page.getByRole("button", {name:"Prepare contours for review",exact:true}).click();
  async function exportDraft() {
    const download = page.waitForEvent("download");
    await page.getByRole("button", {name:"Export review draft",exact:true}).click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const draft = await exportDraft();
  const {width,height} = draft.source;
  const contour = (id:string, value:number, points:number[][], closed=false) => ({id,value,points:points.map(([x,y])=>[x!*width,y!*height]),closed,confirmed:true,excluded:false});
  draft.review = {shorelineId:"",controlPoints:[],alignmentConfirmed:false,contours:[
    contour("source",5,[[.2,.4],[.4,.4]]),
    contour("target",5,[[.5,.45],[.65,.6]]),
    contour("wrong-value",9,[[.2,.7],[.4,.7]]),
    contour("closed",5,[[.7,.2],[.9,.2],[.8,.3]],true),
  ]};
  await page.locator(".chart-review-restore input").setInputFiles({name:"fragments.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(draft))});
  const svg = page.locator("svg[aria-label='Source with reviewed contour overlay']");
  const path = (id:string) => svg.locator(`path[role='button'][aria-label^='${id},']`);
  const point = async (id:string) => path(id).evaluate(el => {
    const p = el as SVGPathElement;
    const at = p.getPointAtLength(p.getTotalLength()/2).matrixTransform(p.getScreenCTM()!);
    return {x:at.x,y:at.y};
  });
  const source = await point("source"); await page.mouse.click(source.x,source.y);
  const choose = page.getByLabel("Select review contour", {exact:true});
  await page.getByRole("button", {name:"Join paths",exact:true}).click();
  const target = await point("target"); await page.mouse.move(target.x,target.y);
  await expect(svg.locator('[data-join-target="valid"]')).toHaveCount(1);
  await expect(svg.locator('[aria-label="Proposed endpoint connection"]')).toHaveCount(1);
  await expect(choose).toHaveValue("source");
  await page.screenshot({path:test.info().outputPath("join-target-preview.png")});
  // Dragging a target pans the chart and must not commit a join.
  await page.mouse.down(); await page.mouse.move(target.x+20,target.y+10,{steps:5}); await page.mouse.up();
  await expect(path("target")).toHaveCount(1);
  await expect(page.getByRole("button", {name:"Cancel joining",exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", {name:"Cancel joining",exact:true})).toHaveCount(0);
  await page.getByRole("button", {name:"Join paths",exact:true}).click();
  const wrong = await point("wrong-value"); await page.mouse.click(wrong.x,wrong.y);
  await expect(page.locator('.review-join-status')).toContainText("same value");
  await expect(choose).toHaveValue("source");
  await expect(path("target")).toHaveCount(1);
  const next = await point("target"); await page.mouse.click(next.x,next.y);
  await expect(path("target")).toHaveCount(0);
  await expect(page.locator('.review-join-status')).toContainText("Paths joined");
  const joined = await exportDraft();
  expect(joined.review.contours[0]).toMatchObject({id:"source",confirmed:false,points:[...draft.review.contours[0].points,...draft.review.contours[1].points]});
  expect(joined.review.contours[1].excluded).toBe(true);
  await page.getByRole("button", {name:"Undo edit",exact:true}).click();
  await expect(path("target")).toHaveCount(1);
  await page.getByRole("button", {name:"Redo edit",exact:true}).click();
  await expect(path("target")).toHaveCount(0);
  await page.getByRole("button", {name:"Undo edit",exact:true}).click();
  await page.getByRole("button", {name:"Join paths",exact:true}).click();
  await path("target").evaluate(el => (el as SVGElement).focus({preventScroll:true}));
  await expect(svg.locator('[data-join-target="valid"]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(path("target")).toHaveCount(0);
});
