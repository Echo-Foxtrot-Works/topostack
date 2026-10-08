import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { captureSocialCard, socialCardHtml } from "../lib/social-card.mjs";
import { ALL_EXAMPLES, EXAMPLES, exampleProject } from "../../apps/generator/src/lib/site/examples.ts";
import { appUrl } from "../lib/app-url.mjs";

// Generates each example in the real studio and saves what the example pages
// publish: a render, a smaller render, a sharing card and the project file with
// the measured layer count. Run against the normal frontend (npm run dev):
//   node scripts/dev/capture-examples.mjs [slug ...]
// Needs cwebp on PATH. Commit the files it writes under apps/generator/static.
const origin = appUrl("TOPOSTACK_CAPTURE_URL");
const only = process.argv.slice(2);
const staticDir = new URL("../../apps/generator/static/", import.meta.url);
const imageDir = new URL("images/examples/", staticDir);
const dataDir = new URL("examples/", staticDir);
await mkdir(imageDir, { recursive: true });
await mkdir(dataDir, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "topostack-examples-"));
const template = JSON.parse(await readFile(new URL("../../atomm/media-project-v3.json", import.meta.url), "utf8"));

const browser = await chromium.launch({ headless: true });

/** Crop a render to the model plus a margin: pixels that differ from the corner background color. */
async function trim(png, margin = 40) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  try {
    await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}"></body>`);
    const box = await page.locator("img").evaluate(async (img) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(img, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      const [r, g, b] = data;
      let left = width, top = height, right = 0, bottom = 0;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) > 30) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      return { left, top, right, bottom, width, height };
    });
    if (box.right <= box.left) throw new Error("Render is empty");
    // A model touching the frame is cut off; zoom out for that shape instead.
    if (box.left === 0 || box.top === 0 || box.right === box.width - 1 || box.bottom === box.height - 1) throw new Error("Render touches the frame edge; reduce the zoom steps.");
    const x = Math.max(0, box.left - margin), y = Math.max(0, box.top - margin);
    const clip = { x, y, width: Math.min(box.width, box.right + margin) - x, height: Math.min(box.height, box.bottom + margin) - y };
    await page.setViewportSize({ width: box.width, height: box.height });
    return { png: await page.screenshot({ clip }), width: clip.width, height: clip.height };
  } finally {
    await page.close();
  }
}
try {
  // Named slugs may include drafts; no arguments captures every published example.
  for (const example of only.length ? ALL_EXAMPLES.filter((entry) => only.includes(entry.slug)) : EXAMPLES) {
    const project = exampleProject(template, example);
    // Taller frames get a taller window so the model renders at a useful size.
    const tall = example.widthMm / example.heightMm < 1.4;
    const page = await browser.newPage({ viewport: { width: 1600, height: tall ? 1800 : 1100 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
    page.setDefaultTimeout(240_000);
    // The public API restricts browser origins; relay genuine responses for localhost capture.
    await page.route("https://topostack.app/v1/**", async (route) => {
      const headers = { ...route.request().headers() };
      delete headers.origin;
      delete headers.referer;
      await route.fulfill({ response: await route.fetch({ headers }) });
    });
    await page.goto(origin);
    // Restore only settings; Generate terrain loads the actual data.
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
    await page.getByText("Local project restored · generate to refresh terrain", { exact: true }).first().waitFor({ timeout: 30_000 }).catch(async (error) => {
      await page.screenshot({ path: join(scratch, `${example.slug}-restore.png`) });
      throw new Error(`${example.slug}: project was not restored; see ${join(scratch, `${example.slug}-restore.png`)}`, { cause: error });
    });
    console.log(`Generating ${example.place}`);
    await page.getByRole("button", { name: "Generate terrain", exact: true }).click();
    await page.getByRole("button", { name: "Regenerate terrain", exact: true }).waitFor();
    await page.locator('.preview-stage[aria-busy="false"]').waitFor();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    const summary = await page.getByText(/relief → \d+ layers/).first().textContent();
    const match = summary?.match(/([\d,]+) m relief → (\d+) layers, ([\d.,]+) mm tall/);
    if (!match) throw new Error(`Unexpected layer summary for ${example.slug}: ${summary}`);
    // The studio reports surveyed lake-floor coverage in the water depth notes.
    const surveyed = await page.getByText("Surveyed lake-floor data is used where available", { exact: false }).count() > 0;
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    // Studio notices float over the preview; they are UI, not part of the model.
    await page.addStyleTag({ content: ".warning-stack { display: none !important; }" });
    // ArrowUp moves the camera closer. Wide frames fill the canvas when zoomed
    // in; square, round and portrait models need the default distance to fit.
    const stage = page.locator(".three-stage");
    const aspect = example.widthMm / example.heightMm;
    const zoomSteps = aspect >= 1.4 ? 7 : example.shape === "circle" ? 6 : aspect >= 0.9 ? 5 : 2;
    for (let step = 0; step < zoomSteps; step += 1) await stage.press("ArrowUp");
    await page.waitForTimeout(2000);
    const canvas = await page.locator(".three-stage canvas").boundingBox();
    if (!canvas) throw new Error("3D canvas is unavailable");
    // Crop empty canvas margins and UI overlays; the terrain itself is untouched.
    const clip = { x: canvas.x + 60, y: canvas.y + 90, width: canvas.width - 120, height: canvas.height - 150 };
    const renderPng = join(scratch, `${example.slug}.png`);
    const trimmed = await trim(await page.screenshot({ clip, animations: "disabled" }));
    await writeFile(renderPng, trimmed.png);
    const { width, height } = trimmed;
    execFileSync("cwebp", ["-quiet", "-q", "82", renderPng, "-o", new URL(`${example.slug}.webp`, imageDir).pathname]);
    // The small variant never upscales a narrow render.
    execFileSync("cwebp", ["-quiet", "-q", "80", ...(width > 800 ? ["-resize", "800", "0"] : []), renderPng, "-o", new URL(`${example.slug}-800.webp`, imageDir).pathname]);

    const render = await readFile(renderPng);
    await captureSocialCard(browser, socialCardHtml({
      title: example.place,
      intro: `${match[2]} laser-cut layers from real elevation data.`,
      media: `<img alt="" src="data:image/png;base64,${render.toString("base64")}">`,
      footer: `${example.region} · Terrain: Mapzen · Map: © OpenStreetMap contributors`,
      style: "img { position: absolute; right: 16px; top: 60px; width: 760px; height: 470px; object-fit: contain; }",
    }), new URL(`${example.slug}-card.jpg`, imageDir).pathname);

    const capture = {
      capturedAt: new Date().toISOString().slice(0, 10),
      layers: Number(match[2]),
      reliefM: Number(match[1].replaceAll(",", "")),
      heightMm: Number(match[3].replaceAll(",", "")),
      surveyed,
      image: { width, height },
    };
    // The studio's project import accepts this wrapper, so the same file is the download.
    await writeFile(new URL(`${example.slug}.json`, dataDir), JSON.stringify({ project, capture }, null, 2) + "\n");
    console.log(`${example.slug}: ${capture.layers} layers, ${capture.reliefM} m relief${capture.surveyed ? ", surveyed lake floor" : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
