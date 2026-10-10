import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { appUrl } from "../lib/app-url.mjs";

// Run against the normal frontend configured with a live survey-data API.
const origin = appUrl("TOPOSTACK_CAPTURE_URL");
const output = new URL("../../docs/images/", import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(180_000);
  // The public API restricts browser origins. Relay genuine responses through
  // Playwright for localhost capture, preserving range headers and response bytes.
  await page.route("https://topostack.app/v1/**", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers.origin;
    delete headers.referer;
    const response = await route.fetch({ headers });
    await route.fulfill({ response });
  });
  await page.goto(origin);
  await page.locator(".workflow-art svg").first().waitFor();
  await page.evaluate(() => document.fonts.ready);

  // Standalone SVGs cannot inherit the app's CSS variables or Svelte classes.
  const workflows = await page.evaluate(() => {
    const ns = "http://www.w3.org/2000/svg";
    const theme = getComputedStyle(document.querySelector(".landing-page"));
    const color = (name) => theme.getPropertyValue(`--loidolt-${name}`).trim();
    const root = document.createElementNS(ns, "svg");
    root.setAttribute("xmlns", ns);
    root.setAttribute("viewBox", "0 0 960 360");
    root.setAttribute("role", "img");
    root.setAttribute("aria-labelledby", "title description");
    const add = (tag, attributes, text) => {
      const element = document.createElementNS(ns, tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      if (text) element.textContent = text;
      root.append(element);
    };
    add("title", { id: "title" }, "Two ways to make terrain with TopoStack");
    add("desc", { id: "description" }, "Layered relief stacks cut contours into a physical landscape. Flat engraving draws contour lines on a single surface.");
    add("rect", { width: "960", height: "360", fill: color("surface") });
    add("path", { d: "M480 24V336", stroke: color("border") });
    const styles = ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size", "font-weight", "letter-spacing"];
    document.querySelectorAll(".workflow-art svg").forEach((source, index) => {
      add("text", { x: String(32 + index * 480), y: "44", fill: color("text"), "font-family": "Arial, sans-serif", "font-size": "24" }, index === 0 ? "Layered relief" : "Flat engraving");
      const clone = source.cloneNode(true);
      const originals = [source, ...source.querySelectorAll("*")];
      const copies = [clone, ...clone.querySelectorAll("*")];
      originals.forEach((element, i) => {
        const computed = getComputedStyle(element);
        copies[i].removeAttribute("class");
        copies[i].removeAttribute("style");
        copies[i].removeAttribute("aria-hidden");
        for (const property of styles) copies[i].setAttribute(property, computed.getPropertyValue(property));
      });
      clone.setAttribute("x", String(10 + index * 480));
      clone.setAttribute("y", "64");
      clone.setAttribute("width", "460");
      clone.setAttribute("height", "280");
      root.append(clone);
    });
    return new XMLSerializer().serializeToString(root);
  });
  await writeFile(new URL("workflows.svg", output), `${workflows}\n`);

  // Restore only settings; Generate terrain must load the actual survey data.
  const project = JSON.parse(await readFile(new URL("../../atomm/media-project-v3.json", import.meta.url), "utf8"));
  project.name = "Crater Lake · Surveyed lake floor";
  await page.evaluate(async (project) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keyval");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("keyval", "readwrite");
        transaction.objectStore("keyval").put(project, "topostack:project:v1");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, project);
  await page.goto(new URL("/studio", origin).href);
  await page.getByText("Local project restored · generate to refresh terrain", { exact: true }).waitFor();
  const surveyResponses = [];
  page.on("response", (response) => {
    if (response.url().includes("usgs-crater-lake") && response.ok()) surveyResponses.push(response.url());
  });
  console.log("Generating survey-backed terrain");
  await page.getByRole("button", { name: "Generate terrain", exact: true }).click();
  await page.getByRole("button", { name: "Regenerate terrain", exact: true }).waitFor({ timeout: 180_000 });
  await page.locator('.preview-stage[aria-busy="false"]').waitFor({ timeout: 180_000 });
  await page.getByRole("tab", { name: "Water", exact: true }).click();
  await page.getByText("Surveyed lake-floor data is used where available. Gaps use existing terrain or modeled depths.", { exact: true }).waitFor({ timeout: 180_000 });
  if (!surveyResponses.length) throw new Error("No successful USGS Crater Lake survey response; refusing to capture modeled-only terrain.");
  await page.getByRole("tab", { name: "Place", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  const stage = page.locator(".three-stage");
  for (let step = 0; step < 7; step += 1) await stage.press("ArrowUp");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: new URL("studio-crater-lake.png", output).pathname, animations: "disabled" });
  const staticOutput = new URL("../../apps/generator/static/images/", import.meta.url);
  await copyFile(new URL("studio-crater-lake.png", output), new URL("studio-crater-lake.png", staticOutput));
  // The site serves WebP copies of this capture; re-encode them after a new capture:
  //   cwebp -q 82 studio-crater-lake.png -o studio-crater-lake.webp
  //   cwebp -q 80 -resize 640 450 studio-crater-lake.png -o studio-crater-lake-640.webp
  // and the gallery thumbnail, cropped to the 3D model:
  //   sips -c 430 740 --cropOffset 295 420 studio-crater-lake.png --out crater.png
  //   cwebp -q 80 crater.png -o examples/crater-lake-800.webp
  // Compose the sharing card around an unaltered capture of the app's WebGL canvas.
  const canvas = await page.locator(".three-stage canvas").boundingBox();
  if (!canvas) throw new Error("3D canvas is unavailable");
  // Crop empty canvas margins and UI overlays; the terrain itself is untouched.
  const terrain = await page.screenshot({ clip: { x: canvas.x + 100, y: canvas.y + 130, width: canvas.width - 200, height: canvas.height - 180 } });
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await card.setContent(`<!doctype html><html lang="en"><head><style>
    * { box-sizing: border-box; } body { margin: 0; background: #20231d; color: #f6f4ef; font-family: Arial, sans-serif; }
    main { width: 1200px; height: 630px; padding: 42px 48px; position: relative; overflow: hidden; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: -.6px; }
    h1 { margin: 30px 0 16px; font-size: 52px; line-height: 1.04; letter-spacing: -2px; width: 370px; }
    .intro { font-size: 21px; line-height: 1.45; width: 320px; color: #c2cabb; }
    img { position: absolute; right: 16px; top: 78px; width: 740px; height: 430px; object-fit: contain; }
    footer { position: absolute; bottom: 34px; left: 48px; right: 48px; border-top: 1px solid #58604f; padding-top: 17px; font-size: 15px; line-height: 1.5; color: #c2cabb; }
  </style></head><body><main><div class="brand">TopoStack</div><h1>From peaks<br>to lake floors.</h1><p class="intro">Layered terrain with surveyed lake bathymetry.</p><img alt="Crater Lake relief rendered by TopoStack" src="data:image/png;base64,${terrain.toString("base64")}"><footer>Crater Lake, Oregon · USGS lake-floor survey · Depth exaggerated for display<br>Survey data where available; existing terrain or modeled depths fill gaps. Terrain: Mapzen · Map: © OpenStreetMap</footer></main></body></html>`);
  await card.locator("img").evaluate((img) => img.decode());
  await card.screenshot({ path: new URL("social-crater-lake.png", staticOutput).pathname });
  await card.close();
  await writeFile(new URL("media-provenance.json", output), JSON.stringify({ capturedAt: new Date().toISOString(), project, surveyResponses: [...new Set(surveyResponses)], coverageNote: "USGS surveyed lake-floor data where available; existing terrain or modeled depths in gaps.", screenshot: { width: 1280, height: 900 } }, null, 2) + "\n");
  console.log(`README assets saved to ${output.pathname}`);
} finally {
  await browser.close();
}
