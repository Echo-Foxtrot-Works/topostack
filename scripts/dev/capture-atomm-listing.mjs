import { chromium } from "playwright";
import { readVersions } from "../release/versions.mjs";
import { installNativeCapture, nativeFrame } from "./atomm-native-capture.mjs";
import { readFile, writeFile, mkdir, mkdtemp, copyFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reproducible listing cards: genuine embedded UI and model pixels, with captions.
// Run against the current generator and deployed data API; no E2E fixture build.
const { atommVersion } = await readVersions();
const origin = process.env.TOPOSTACK_CAPTURE_URL ?? "http://127.0.0.1:5284";
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const root = new URL("../../atomm/", import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), "topostack-listing-"));
const assets = new URL("assets/", root);
await mkdir(assets, { recursive: true });
const sourceDiffSha256 = createHash("sha256").update(execFileSync("git", ["diff", "HEAD", "--", "apps/generator/src", "scripts/dev"])).digest("hex");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const project = JSON.parse(await readFile(new URL("media-project-v6.json", root), "utf8"));
project.name = "Crater Lake";
project.sheetNesting = { sheetWidthMm: 600, sheetHeightMm: 400, marginMm: 3, spacingMm: 2, rotation: "quarter", timeBudgetS: 5, seed: 1 };
const media = [], surveyResponses = new Set(), errors = [];
const browser = await chromium.launch({ headless: true, ...(process.env.TOPOSTACK_CAPTURE_GPU === "1" ? { channel: "chrome", args: ["--use-angle=metal", "--enable-gpu"] } : { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }) });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
  page.setDefaultTimeout(60_000);
  await installNativeCapture(page);
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.ok() && /usgs-crater-lake/.test(response.url())) surveyResponses.add(response.url()); });
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.atomm = { lifecycle: { on(event, hook) { if(event === 'export') window.captureExport = hook; } }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] }, ui: { toast: async () => '', closeToast: async () => {} } };` }));
  await page.route("https://topostack.app/v1/**", async route => {
    const headers = { ...route.request().headers() }; delete headers.origin; delete headers.referer;
    await route.fulfill({ response: await route.fetch({ headers, timeout: 180_000 }) });
  });
  await page.route(`${origin}/atomm-media-frame`, route => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><iframe src="/studio" style="width:100vw;height:100vh;border:0;display:block"></iframe></body>' }));
  await page.goto(origin);
  await page.evaluate(async value => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keyval");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(value, "topostack:project:v1");
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  }, project);
  await page.goto(`${origin}/atomm-media-frame`);
  const studio = page.frameLocator("iframe");
  const frame = () => page.frames().find(candidate => candidate !== page.mainFrame());
  const settled = async () => { await studio.locator('.preview-stage[aria-busy="false"]').waitFor(); await page.waitForTimeout(1000); };
  await studio.locator(".status-line", { hasText: "Real terrain ready" }).waitFor({ timeout: 180_000 });
  await settled();
  if (!surveyResponses.size) throw new Error("No successful Crater Lake survey request; refusing to label fixture or modeled-only media as surveyed.");
  console.log("Real terrain ready", await studio.locator(".status-line").innerText());
  const cardPage = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  async function card(id, title, subtitle, png, caption = "Crater Lake · Software preview · Review material and machine settings before fabrication") {
    const name = `topostack-${id}-v8.png`;
    await cardPage.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#e7e8e9;color:#1d302e;font-family:Arial,sans-serif;padding:48px 64px}header{display:flex;justify-content:space-between;font-size:22px;font-weight:700;letter-spacing:-.5px}header span{font-size:16px;font-weight:400;letter-spacing:2px}h1{font-size:62px;letter-spacing:-2.5px;line-height:1.08;margin:30px 0 12px}p{font-size:26px;margin:0 0 30px;color:#405451}main{height:840px;display:flex;align-items:center;justify-content:center}img{width:100%;height:100%;object-fit:contain;border-radius:16px;box-shadow:0 10px 35px #00000012}footer{position:absolute;bottom:35px;left:64px;right:64px;display:flex;justify-content:space-between;color:#52625f;font-size:15px}</style></head><body><header>TopoStack<span>MAP · LAYER · MAKE</span></header><h1>${escape(title)}</h1><p>${escape(subtitle)}</p><main><img src="data:image/png;base64,${png.toString("base64")}"></main><footer><span>${escape(caption)}</span><span>topostack.app</span></footer></body></html>`);
    await cardPage.locator("img").evaluate(img => img.decode());
    const buffer = await cardPage.screenshot({ path: new URL(name, assets).pathname });
    media.push({ file: `assets/${name}`, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), width: 3200, height: 2400, sourceCommit, title, subtitle });
    console.log("Saved", name);
  }
  const view = async name => { await studio.getByRole("radio", { name, exact: true }).click(); await settled(); };
  const dismissWarnings = async () => {
    const buttons = studio.getByRole("button", { name: /^Dismiss (warning|notice):/ });
    for (let n = 0; n < 12 && await buttons.count(); n++) { await buttons.first().click(); await page.waitForTimeout(100); }
    await page.waitForTimeout(200);
    const remaining = await studio.locator(".warning-stack").textContent({ timeout: 500 }).catch(() => "");
    if (remaining?.trim()) throw new Error(`A warning banner remains in the promotional capture: ${remaining}`);
  };
  const shot = async () => {
    await studio.locator(".generation-overlay:not(.nesting-progress)").waitFor({ state: "hidden", timeout: 180_000 });
    await dismissWarnings();
    await page.waitForTimeout(350);
    return page.screenshot({ animations: "disabled" });
  };
  const model = amount => nativeFrame(frame(), { amount, azimuth: -76, elevation: 49, width: 2944, height: 1680 });
  await view("3D");
  await studio.getByRole("button", { name: "Fit to canvas", exact: true }).click();
  await studio.locator(".three-stage").press("+");
  await studio.locator(".three-stage").press("+");
  await page.waitForTimeout(1000);
  await card("cover", "A place, made personal.", "Real terrain. Layered reliefs. Ready-to-make artwork.", await model(0));
  await card("gallery-01-workbench", "Your landscape, your way.", "Shape the terrain and preview every change in Atomm.", await shot());
  await studio.getByRole("slider", { name: "Stack separation", exact: true }).fill("0.7");
  await studio.getByRole("button", { name: "Fit to canvas", exact: true }).click();
  await studio.locator(".three-stage").press("+");
  await studio.locator(".three-stage").press("+");
  await page.waitForTimeout(1500);
  await card("gallery-02-layers", "See how the layers fit.", "Explore the assembled relief or separate the stack before cutting.", await model(0.7));
  // One independently rendered frame per output frame, with continuous layer
  // offsets and camera movement, matching the earlier native-render approach.
  for (let n = 0; n < 360; n++) {
    const t = n / 360, phase = 2 * Math.PI * t;
    const png = await nativeFrame(frame(), { amount: 0.75 * (1 - Math.cos(phase)) / 2,
      azimuth: -76 + 20 * Math.sin(phase), elevation: 49 + 5 * Math.sin(phase), width: 1920, height: 1440 });
    await writeFile(join(scratch, `motion-${String(n).padStart(3, "0")}.png`), png);
    if (n % 60 === 0) console.log(`Native motion: ${n}/360 frames`);
  }
  await studio.getByRole("slider", { name: "Stack separation", exact: true }).fill("0");
  await view("2D");
  await card("gallery-03-cut-layer", "Inspect every layer.", "Review cut outlines, score lines and alignment before fabrication.", await shot());
  await studio.getByRole("radio", { name: "Flat engraving", exact: true }).click();
  await settled();
  await view("Engraving");
  await card("gallery-04-flat", "One landscape. Two ways to make.", "Choose flat topographic engraving or a layered relief.", await shot(), "Surface contour artwork · Software preview · Physical dimensions preserved in SVG");
  await studio.getByRole("radio", { name: "Layered relief", exact: true }).click();
  await settled();
  await view("3D");
  await studio.getByRole("button", { name: "Map details", exact: true }).click();
  await studio.getByRole("spinbutton", { name: "Water depth exaggeration", exact: true }).scrollIntoViewIfNeeded();
  await card("gallery-05-depth", "Explore below the shoreline.", "Surveyed lake floors where available, with adjustable depth relief.", await shot(), "USGS survey where available · Terrain or modeled depths fill gaps · Depth exaggerated");
  await studio.getByRole("radio", { name: "Export", exact: true }).click();
  await studio.locator(".atomm-nesting-drafts svg").first().waitFor();
  await card("gallery-06-nesting", "Watch the sheets take shape.", "Automatic nesting, live layouts and a choice to finish early.", await shot());
  await studio.locator('.export-preview[aria-busy="false"] .export-layout-note').waitFor();
  await card("gallery-07-export", "Know what you are exporting.", "See the actual artwork, file contents and cut/score colors.", await shot());
  await studio.getByRole("spinbutton", { name: "Material width", exact: true }).fill("700");
  await studio.getByRole("spinbutton", { name: "Material height", exact: true }).fill("500");
  await studio.locator(".export-layout-note", { hasText: "700 × 500 mm" }).waitFor();
  await card("gallery-08-material", "Fit the material you have.", "Set sheet width and height. The layout updates automatically.", await shot());
  await view("3D");
  const openSection = async (name) => {
    const control = studio.getByRole("button", { name, exact: true });
    const openControls = studio.locator('.gen-rail-params .section-disclosure[aria-expanded="true"]');
    for (const other of await openControls.all()) {
      if (await other.getAttribute("id") !== await control.getAttribute("id")) await other.click();
    }
    if (await control.getAttribute("aria-expanded") !== "true") await control.click();
    await control.scrollIntoViewIfNeeded();
  };
  await studio.getByRole("button", { name: /Choose location/ }).click();
  await studio.getByRole("textbox", { name: "Search places", exact: true }).waitFor();
  await card("gallery-09-location", "Start with a place you love.", "Search places and surveyed lakes, or enter coordinates.", await shot());
  await page.keyboard.press("Escape");
  await studio.getByRole("dialog").waitFor({ state: "hidden" });
  await settled();
  await openSection("Cut size");
  await card("gallery-10-size", "Choose the shape and scale.", "Rectangle or circle, physical dimensions, metric or imperial units.", await shot());
  await openSection("Terrain layers");
  await card("gallery-11-terrain", "Shape the relief.", "Set material thickness and vertical exaggeration before fabrication.", await shot());
  await studio.getByRole("radio", { name: "Flat engraving", exact: true }).click();
  await settled();
  await view("Engraving");
  await openSection("Map details");
  await studio.getByRole("checkbox", { name: "North arrow", exact: true }).scrollIntoViewIfNeeded();
  await card("gallery-12-annotations", "Make the map readable.", "Roads, trails, water, elevation labels, compass and scale bar.", await shot());
  await openSection("Linework");
  await studio.locator(".linework-customize").click();
  await card("gallery-13-linework", "Give every line a purpose.", "Choose a preset or customize widths, road styles and trail patterns.", await shot());
  await studio.getByRole("radio", { name: "Layered relief", exact: true }).click();
  await settled();
  await view("3D");
  await openSection("Fabrication settings");
  await card("gallery-14-fabrication", "Prepare for your process.", "Review kerf, minimum features, work area and water paint templates.", await shot());
  await studio.getByRole("radio", { name: "Flat engraving", exact: true }).click();
  await settled();
  await view("Engraving");
  await openSection("Markers & paths");
  const annotations = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { name: "My Crater Lake marker" }, geometry: { type: "Point", coordinates: [-122.109, 42.9446] } },
    { type: "Feature", properties: { name: "Illustrative custom path" }, geometry: { type: "LineString", coordinates: [[-122.16,42.92],[-122.14,42.94],[-122.12,42.95]] } }
  ] };
  await writeFile(new URL("media-annotations-v8.json", root), JSON.stringify(annotations, null, 2) + "\n");
  await studio.locator("[data-custom-import]").setInputFiles({ name: "annotations.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(annotations)) });
  await studio.getByRole("textbox", { name: "Name for marker 1", exact: true }).waitFor();
  await settled();
  await studio.getByRole("textbox", { name: "Name for marker 1", exact: true }).fill("My Crater Lake marker");
  await studio.getByRole("textbox", { name: "Name for path 1", exact: true }).fill("Illustrative custom path");
  await settled();
  await studio.locator(".marker-editor").scrollIntoViewIfNeeded();
  await card("gallery-15-markers", "Mark your own places.", "Import GPX, KML or GeoJSON, then edit marker coordinates and symbols.", await shot(), "Illustrative user-added marker and path · Software preview · Not navigation guidance");
  await settled();
  await studio.locator(".custom-line-editor").scrollIntoViewIfNeeded();
  await card("gallery-16-paths", "Bring your own paths.", "Draw or import trails and boundaries; edit their points and line style.", await shot(), "Illustrative user-added marker and path · Software preview · Not navigation guidance");
  await studio.getByRole("radio", { name: "Layered relief", exact: true }).click();
  await settled();
  await view("Export");
  await studio.locator('.export-preview[aria-busy="false"] .export-layout-note').waitFor();
  const manifest = await frame().evaluate(async () => { const files = await window.captureExport({ intent: "download" }); return JSON.parse(await files.find(file => file.filename.endsWith("-project.json")).blob.text()); });
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await writeFile(new URL("media-project-v8.json", root), JSON.stringify(project, null, 2) + "\n");
  await writeFile(new URL("media-export-v8.json", root), JSON.stringify(manifest, null, 2) + "\n");
  const movie = new URL("topostack-cover-loop-v8.mp4", assets).pathname;
  execFileSync(ffmpeg, ["-y", "-framerate", "60", "-i", join(scratch, "motion-%03d.png"), "-vf", "fps=60", "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", movie], { stdio: "ignore" });
  // Dynamic opening and closing, with gentle pan/zoom on crisp gallery cards.
  const segments = [];
  for (const [i, item] of media.filter(item => item.file.includes("gallery")).entries()) {
    const segment = join(scratch, `scene-${i}.mp4`);
    execFileSync(ffmpeg, ["-y", "-i", new URL(item.file, root).pathname, "-vf",
      "zoompan=z='1+0.025*on/239':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=240:s=1920x1440:fps=60,fade=t=in:st=0:d=0.15:color=0xe7e8e9,fade=t=out:st=3.85:d=0.15:color=0xe7e8e9",
      "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-an", segment], { stdio: "ignore" });
    segments.push(segment);
  }
  const list = join(scratch, "showcase.txt");
  await writeFile(list, [movie, ...segments, movie].map(file => `file '${file}'`).join("\n"));
  const showcase = new URL("topostack-showcase-v8.mp4", assets).pathname;
  execFileSync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", showcase], { stdio: "ignore" });
  for (const file of ["topostack-cover-loop-v8.mp4", "topostack-showcase-v8.mp4"]) {
    execFileSync(ffmpeg, ["-v", "error", "-i", new URL(file, assets).pathname, "-f", "null", "-"], { stdio: "pipe" });
    const bytes = await readFile(new URL(file, assets));
    media.push({ file: `assets/${file}`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width: 1920, height: 1440, sourceCommit, fullDecodePassed: true, codec: "H.264", fps: 60, audio: false });
  }
  const archive = new URL("media-provenance-v7.json", root);
  try { await access(archive); } catch { await copyFile(new URL("media-provenance.json", root), archive); }
  await writeFile(new URL("media-provenance.json", root), JSON.stringify({ schemaVersion: 7, sourceDiffSha256, annotationsFile: "media-annotations-v8.json", capturedAt: new Date().toISOString(), sourceCommit, developmentBase: execFileSync("git", ["rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), version: atommVersion, origin, projectFile: "media-project-v8.json", exportFile: "media-export-v8.json", method: "Current embedded studio with genuine live terrain/survey data. Native UI/model screenshots with typography around unchanged app pixels. SDK mount/export stand-in only; no fixture terrain, AI imagery or fabricated UI. Screenshots captured at 2x device scale, with native model renders at their presentation resolution; warning notifications dismissed before promotional captures. Cover movie contains 360 distinct native renders at 60 fps using the unchanged Three.js meshes/materials, continuous layer offsets and an orbiting camera. Capture-only module interception exposes the renderer without changing shipped code. Showcase combines native motion with gently moving high-resolution feature cards; no optical-flow interpolation. Historical v5/v6/v7 media remains on disk but is excluded from this upload set.", surveyResponses: [...surveyResponses], source: manifest.result, attribution: manifest.attribution, media }, null, 2) + "\n");
  console.log("Completed", media.length, "media files", scratch);
} finally { await browser.close(); }
