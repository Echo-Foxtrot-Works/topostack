import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { sha256Hex } from "../lib/hash.mjs";
import { join } from "node:path";
import { chromium } from "playwright";

// Captures the illustration band of each Atomm Tips slide from the real studio,
// running as the embed does (inside a frame) so it uses the platform's light
// canvas. Each image is an unaltered crop of what the studio draws for the
// bundled Crater Lake project once real terrain has loaded. Run against a
// frontend with a working map API (npm run dev):
//   node scripts/dev/capture-atomm-tips.mjs
// Needs cwebp on PATH. Commit the files it writes under apps/generator/src/lib/atomm/tips/.
const origin = process.env.TOPOSTACK_CAPTURE_URL ?? "http://127.0.0.1:5273";
const output = new URL("../../apps/generator/src/lib/atomm/tips/", import.meta.url);
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "topostack-tips-"));

// The platform's media band is 480 × 267 CSS pixels; captures are twice that
// for sharp displays, and the viewport shares the band's proportions.
const RATIO = 480 / 267;
const VIEWPORT = { width: 1200, height: Math.round(1200 / RATIO) };
const band = (x, y, width) => ({ x, y, width, height: Math.round(width / RATIO) });
const centered = (width) => band((VIEWPORT.width - width) / 2, (VIEWPORT.height - width / RATIO) / 2, width);

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
  page.setDefaultTimeout(180_000);
  // A stand-in for the platform SDK: the studio only needs it to mount the embed.
  await page.route("https://static-res.makextool.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: "window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] }, ui: { toast: async () => '', closeToast: async () => {} } };" }));
  await page.route(`${origin}/atomm-tips-frame`, (route) => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><iframe src="studio" style="width:100vw;height:100vh;border:0;display:block"></iframe></body>' }));
  // The public API restricts browser origins; relay its genuine responses for a localhost capture.
  await page.route("https://topostack.app/v1/**", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers.origin;
    delete headers.referer;
    await route.fulfill({ response: await route.fetch({ headers }) });
  });
  await page.goto(`${origin}/atomm-tips-frame`);
  const studio = page.frameLocator("iframe");
  const frame = () => page.frames().find((candidate) => candidate !== page.mainFrame());
  await studio.locator(".atomm-workbench").waitFor();
  // The embed loads real terrain on its own; wait for it rather than the bundled preview.
  await studio.locator(".status-line", { hasText: "Real terrain ready" }).waitFor();
  await studio.locator('.preview-stage[aria-busy="false"]').waitFor();
  // The canvas alone: no rails and no overlays over the artwork.
  await frame().addStyleTag({ content: ".gen-rail, .preview-toolbar, .atomm-tips, .atomm-zoom-cluster, .warning-stack, .preview-attribution, .gen-rail-collapsed, .maplibregl-ctrl, .export-manifest { display: none !important; }" });
  await frame().evaluate(() => document.fonts.ready);

  const settle = (ms = 2500) => page.waitForTimeout(ms);
  const view = async (label) => { await frame().evaluate((name) => [...document.querySelectorAll('.mode-switch [role="radio"]')].find((tab) => tab.textContent?.trim() === name).click(), label); await settle(); };
  const fit = async () => { await frame().evaluate(() => document.querySelector('.atomm-zoom-cluster button[aria-label="Fit to canvas"]').click()); await settle(1200); };
  const press = async (key, times) => { for (let step = 0; step < times; step += 1) await studio.locator(".three-stage").press(key); await settle(1500); };
  const explode = async (value) => {
    await frame().evaluate((next) => {
      const input = document.querySelector('input[aria-label="Stack separation"]');
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await settle(2000);
  };
  // Orbit the 3D camera down towards the table by dragging, as a user would.
  const lower = async (pixels) => {
    const [x, y] = [VIEWPORT.width / 2, VIEWPORT.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y - (pixels * step) / 10);
    await page.mouse.up();
    await settle(800);
  };
  const zoomTo = async (level) => { await frame().evaluate((value) => { const select = document.querySelector(".atomm-zoom-cluster select"); select.value = String(value); select.dispatchEvent(new Event("change", { bubbles: true })); }, level); await settle(); };
  /**
   * A band around the model: the pixels that differ from the canvas colour in
   * the top-left corner, plus a margin, widened or heightened to the band's
   * proportions and kept inside the viewport.
   */
  async function around(margin = 36) {
    const png = await page.screenshot({ animations: "disabled" });
    const reader = await browser.newPage({ deviceScaleFactor: 1 });
    try {
      await reader.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}"></body>`);
      const box = await reader.locator("img").evaluate(async (img, scale) => {
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(img, 0, 0);
        const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
        const [r, g, b] = data;
        let left = width, top = height, right = 0, bottom = 0;
        for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4;
          if (Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) < 24) continue;
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        return { left: left / scale, top: top / scale, right: right / scale, bottom: bottom / scale };
      }, 2);
      let width = box.right - box.left + margin * 2;
      let height = box.bottom - box.top + margin * 2;
      if (width / height < RATIO) width = height * RATIO; else height = width / RATIO;
      width = Math.min(width, VIEWPORT.width);
      height = Math.min(height, VIEWPORT.height, width / RATIO);
      width = height * RATIO;
      const clamp = (value, size, limit) => Math.max(0, Math.min(limit - size, value));
      return { x: clamp((box.left + box.right - width) / 2, width, VIEWPORT.width), y: clamp((box.top + box.bottom - height) / 2, height, VIEWPORT.height), width, height };
    } finally {
      await reader.close();
    }
  }
  async function save(id, clip) {
    const png = join(scratch, `${id}.png`);
    await page.screenshot({ path: png, clip, animations: "disabled" });
    execFileSync("cwebp", ["-quiet", "-resize", "960", "534", "-q", "82", png, "-o", join(scratch, `${id}.webp`)]);
    console.log(`Saved ${id}.webp`);
  }

  await view("3D");
  await fit();
  await explode(0.8);
  await lower(40);
  await press("+", 2);
  await save("layers", await around());
  await fit();
  await explode(0);
  await press("+", 10);
  await save("lakes", centered(860));
  await fit();
  await lower(35);
  await press("+", 4);
  await save("assembly", await around());
  await view("2D");
  await save("size", await around(24));
  await frame().evaluate(() => document.querySelector(".atomm-edit-map").click());
  await settle(4000);
  await save("place", centered(VIEWPORT.width));
  await view("Export");
  await studio.locator('.export-preview[aria-busy="false"] .export-manifest').waitFor({ state: "attached", timeout: 60_000 }).catch(async error => { console.error(await frame().locator("body").innerText()); await page.screenshot({ path: join(scratch, "failure.png") }); console.error("Capture diagnostics:", scratch); throw error; });
  await settle(1000);
  // A wider canvas keeps the contents card beside the sheets rather than over them.
  await page.setViewportSize({ width: 1440, height: 800 });
  await settle();
  await frame().addStyleTag({ content: ".atomm-workbench .export-manifest { display: flex !important; }" });
  await save("export", { x: 0, y: 0, width: 1440, height: 800 });
  await frame().addStyleTag({ content: ".atomm-workbench .export-manifest { display: none !important; }" });
  await page.setViewportSize(VIEWPORT);
  await settle();
  await zoomTo(1);
  // Select a real artwork region containing both processing colors, rather than
  // zooming into the empty center of a multi-sheet layout.
  const reader = await browser.newPage();
  await reader.setContent(`<img src="data:image/png;base64,${(await page.screenshot()).toString("base64")}">`);
  const processingClip = await reader.locator("img").evaluate(async img => {
    await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 668;
    const context = canvas.getContext("2d"); context.drawImage(img, 0, 0, 1200, 668);
    const pixels = context.getImageData(0, 0, 1200, 668).data;
    let best = { x: 0, y: 0, width: 600, height: 334 }, score = -1;
    for (let y = 0; y <= 334; y += 20) for (let x = 0; x <= 600; x += 20) {
      let red = 0, blue = 0;
      for (let py = y; py < y + 334; py += 2) for (let px = x; px < x + 600; px += 2) {
        const i = (py * 1200 + px) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r > g + 25 && r > b + 25) red++;
        if (b > r + 25 && b > g + 20) blue++;
      }
      const next = Math.min(red, blue);
      if (next > score) { score = next; best = { x, y, width: 600, height: 334 }; }
    }
    if (score < 10) throw new Error("Processing illustration has insufficient cut and score artwork");
    return best;
  });
  await reader.close();
  await save("processing", processingClip);
  const images = [];
  for (const id of ["place", "layers", "size", "lakes", "export", "processing", "assembly"]) {
    const bytes = await readFile(join(scratch, `${id}.webp`));
    await copyFile(join(scratch, `${id}.webp`), new URL(`${id}.webp`, output));
    images.push({ file: `${id}.webp`, width: 960, height: 534, sha256: sha256Hex(bytes) });
  }
  await writeFile(new URL("media-provenance.json", output), JSON.stringify({ capturedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), origin, method: "Real-data embedded studio captures; no fixtures. Artwork crops, resized to the Tips media band. Files replaced only after every capture completes.", images }, null, 2) + "\n");
} finally {
  await browser.close();
}
