import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVersions } from "../release/versions.mjs";
import { sha256Hex } from "../lib/hash.mjs";
import { appUrl } from "../lib/app-url.mjs";
import { featureProjects, listingPlaces } from "./atomm-listing-places.mjs";
import { engravingSvg, matte, openStudio } from "./atomm-listing-render.mjs";
import { backdrop, card, contourLines, cutout, engravingArtwork, escapeHtml, model, renderCard, screenshot } from "./atomm-listing-compose.mjs";

// Atomm listing media, v11: a cover built for the 272 × 204 grid card and nine
// gallery cards. Every model is the studio's own render of live terrain; every
// interface image is a screenshot of the embedded studio. Backdrops are the
// place's flat-engraving artwork. Run against `npm run dev` (or
// TOPOSTACK_CAPTURE_URL) with @topostack/core built.
const VERSION = "v11";
const { atommVersion } = await readVersions();
const origin = appUrl("TOPOSTACK_CAPTURE_URL");
const root = new URL("../../atomm/", import.meta.url);
const assets = new URL("assets/", root);
await mkdir(assets, { recursive: true });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDiffSha256 = sha256Hex(execFileSync("git", ["diff", "HEAD", "--", "apps/generator/src", "scripts/dev"]));
const media = [], projects = {}, attribution = new Map(), surveyResponses = new Set();
const errors = [];
// TOPOSTACK_LISTING_REUSE=1 recomposes from the last capture's renders (layout work only; never for a release set).
const cacheFile = join(tmpdir(), "topostack-listing-renders.json");
const reuse = process.env.TOPOSTACK_LISTING_REUSE === "1";

const browser = await chromium.launch({ headless: true, ...(process.env.TOPOSTACK_CAPTURE_GPU === "1" ? { channel: "chrome", args: ["--use-angle=metal", "--enable-gpu"] } : { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }) });
try {
  const composer = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });

  /** Open a project, show it in 3D, and collect what every card needs from it. */
  async function capture(id, project, work) {
    console.log("Loading", id);
    const session = await openStudio(browser, origin, project, { onResponse: response => { if (response.ok() && /usgs-crater-lake/.test(response.url())) surveyResponses.add(response.url()); } });
    try {
      const view = async name => { await session.studio.getByRole("radio", { name, exact: true }).click(); await session.settled(); };
      await view("3D");
      const result = await work({ ...session, view });
      // The download's own manifest is the record of what each render used.
      const manifest = await session.frame.evaluate(async () => { const files = await window.captureExport({ intent: "download" }); return JSON.parse(await files.find(file => file.filename.endsWith("-project.json")).blob.text()); });
      for (const source of manifest.attribution ?? []) attribution.set(source.name, source);
      projects[id] = project;
      errors.push(...session.errors.map(message => `${id}: ${message}`));
      return result;
    } finally { await session.page.close(); }
  }

  const dismissWarnings = async ({ studio, page }) => {
    const buttons = studio.getByRole("button", { name: /^Dismiss (warning|notice):/ });
    for (let n = 0; n < 12 && await buttons.count(); n++) { await buttons.first().click(); await page.waitForTimeout(100); }
  };
  const ui = async session => { await session.studio.locator(".generation-overlay:not(.nesting-progress)").waitFor({ state: "hidden", timeout: 180_000 }); await dismissWarnings(session); await session.page.waitForTimeout(400); return session.page.screenshot({ animations: "disabled" }); };
  const openSection = async ({ studio }, name) => {
    for (const open of await studio.locator('.gen-rail-params .section-disclosure[aria-expanded="true"]').all()) await open.click();
    const control = studio.getByRole("button", { name, exact: true });
    if (await control.getAttribute("aria-expanded") !== "true") await control.click();
    await control.scrollIntoViewIfNeeded();
  };

  // Places: one hero-angle render each; Crater Lake also supplies the backdrop,
  // the exploded stack, the flat artwork and the interface screenshots.
  const places = await listingPlaces();
  let renders = {};
  if (reuse) {
    const cached = JSON.parse(await readFile(cacheFile, "utf8"));
    const revive = value => value && typeof value === "object" ? (value.$buffer ? Buffer.from(value.$buffer, "base64") : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]))) : value;
    renders = revive(cached.renders); Object.assign(projects, cached.projects); cached.attribution.forEach(source => attribution.set(source.name, source)); cached.surveyResponses.forEach(url => surveyResponses.add(url));
  } else {
    for (const place of places) {
      renders[place.id] = await capture(place.id, place.project, async session => {
        const hero = await matte(session.frame, { fill: place.id === "crater-lake" ? 0.95 : 1.02 });
        if (place.id !== "crater-lake") return { hero };
        const exploded = await matte(session.frame, { explode: 0.45, azimuth: -76, elevation: 32, fill: 1.12 });
        const svg = await engravingSvg(session);
        await session.studio.getByRole("button", { name: /Choose location/ }).click();
        // Show a search for the card's place: the unfiltered lake list opens on survey ids.
        await session.studio.getByRole("textbox", { name: "Search places", exact: true }).fill("Crater Lake");
        await session.studio.locator(".lake-search-results .location-option").first().waitFor();
        await session.studio.locator(".search-results:not(.lake-search-results) .location-option").first().waitFor({ timeout: 30_000 });
        await session.page.waitForTimeout(400);
        const location = await session.studio.getByRole("dialog").screenshot();
        await session.page.keyboard.press("Escape");
        await session.settled();
        await openSection(session, "Cut size");
        const sizeTop = await session.studio.getByRole("button", { name: "Cut size", exact: true }).boundingBox(), sizeBottom = await session.studio.locator("#panel-place").boundingBox();
        const size = await session.page.screenshot({ clip: { x: sizeTop.x - 8, y: sizeTop.y - 8, width: sizeTop.width + 16, height: sizeBottom.y + sizeBottom.height - sizeTop.y + 16 } });
        await session.view("Export");
        await session.studio.locator('.export-preview[aria-busy="false"] .export-layout-note').waitFor({ timeout: 180_000 });
        const exported = await ui(session);
        const exportPreview = await session.studio.locator(".export-preview").screenshot();
        await session.studio.getByRole("radio", { name: "Flat engraving", exact: true }).click();
        await session.settled();
        await session.view("Engraving");
        await openSection(session, "Labels and marks");
        const labels = await ui(session);
        await session.studio.getByRole("radio", { name: "Layered relief", exact: true }).click();
        await session.settled();
        await session.view("3D");
        return { hero, exploded, svg, location, size, exported, exportPreview, labels };
      });
    }
    const features = await featureProjects();
    for (const [id, project] of Object.entries(features)) {
      renders[id] = await capture(id, project, async session => ({ hero: await matte(session.frame, { fill: 1.0, elevation: id === "airspace" ? 38 : 50 }) }));
    }
    const pack = value => Buffer.isBuffer(value) ? { $buffer: value.toString("base64") } : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v)])) : value;
    await writeFile(cacheFile, JSON.stringify({ renders: pack(renders), projects, attribution: [...attribution.values()], surveyResponses: [...surveyResponses] }));
  }
  const crater = renders["crater-lake"];
  if (!surveyResponses.size) throw new Error("No successful Crater Lake survey request; refusing to label modeled-only media as surveyed.");

  const cut = {};
  for (const [id, value] of Object.entries(renders)) {
    cut[id] = await cutout(composer, value.hero);
    if (value.exploded) cut[`${id}-exploded`] = await cutout(composer, value.exploded);
  }
  const lines = contourLines(crater.svg);

  async function save(id, html, meta) {
    const name = `topostack-${id}-${VERSION}.png`;
    const buffer = await renderCard(composer, html, new URL(name, assets).pathname);
    media.push({ file: `assets/${name}`, bytes: buffer.length, sha256: sha256Hex(buffer), width: 3200, height: 2400, sourceCommit, ...meta });
    console.log("Saved", name);
  }
  const caption = place => `Software render · ${place} · Live terrain data`;

  await save("cover", backdrop(lines, 0.5) + model(cut["crater-lake"], { width: 94, top: 54 }), { title: "Crater Lake", subtitle: "Cover: software render on its own engraving artwork", place: "Crater Lake" });

  const grid = places.map((place, i) => {
    const col = i % 3, row = Math.floor(i / 3), left = 19 + col * 31, top = 46 + row * 29;
    return model(cut[place.id], { left, top, width: 25 }) + `<div style="position:absolute;left:${left}%;top:${top + 10}%;transform:translateX(-50%);z-index:5;text-align:center;color:#e9dcc6;font:600 22px/1.2 'Helvetica Neue',Arial;letter-spacing:2px;white-space:nowrap">${escapeHtml(place.label.toUpperCase())}<div style="font-weight:400;font-size:16px;opacity:.7;letter-spacing:1px">${escapeHtml(place.where)}</div></div>`;
  }).join("");
  await save("gallery-01-places", card({ lines, headline: "Any place on Earth.", subtitle: "Mountains, canyons, volcanoes and lakes from real elevation data.", body: grid, caption: "Software renders · Six places at the same size · Live terrain data" }), { title: "Any place on Earth.", places: places.map(place => place.label) });

  await save("gallery-02-layers", card({ lines, headline: "Built layer by layer.", subtitle: "Every contour becomes a sheet. Separate the stack to see how it fits.", body: model(cut["crater-lake-exploded"], { height: 66, top: 62 }), caption: caption("Crater Lake") }), { title: "Built layer by layer." });

  await save("gallery-03-relief-engraving", card({ lines, headline: "Relief or engraving.", subtitle: "Stack it in layers, or engrave the same map on a single sheet.", body:
    model(cut["crater-lake"], { left: 30, top: 63, width: 52 }) +
    `<div style="position:absolute;left:73%;top:63%;width:42%;transform:translate(-50%,-50%) rotate(2deg);z-index:2;background:#e2c497;border-radius:6px;padding:2.2%;box-shadow:0 26px 40px rgba(0,0,0,.5)"><img src="${engravingArtwork(crater.svg)}" style="width:100%;display:block"></div>`,
    caption: "Software render and actual engraving artwork · Crater Lake" }), { title: "Relief or engraving." });

  await save("gallery-04-acrylic", card({ lines, headline: "Cut lakes from acrylic.", subtitle: "Each lake becomes a fitted acrylic insert in the sheet at its waterline.", body: model(cut.acrylic, { width: 82, top: 63 }), caption: caption("Crater Lake · Acrylic water inserts") }), { title: "Cut lakes from acrylic." });

  await save("gallery-05-public-lands", card({ lines, headline: "Paint the parks.", subtitle: "Paint templates for national parks, forests and wilderness, in the US and Canada.", body: model(cut.lands, { width: 82, top: 63 }), caption: caption("Grand Teton · PAD-US public lands") }), { title: "Paint the parks." });

  await save("gallery-06-airspace", card({ lines, headline: "Airspace you can hold.", subtitle: "FAA Class C and D airspace in acrylic tiers above US terrain.", body: model(cut.airspace, { width: 82, top: 63 }), caption: caption("Colorado Springs · FAA airspace, not for navigation") }), { title: "Airspace you can hold." });

  const step = (n, label, x) => `<div style="position:absolute;left:${x}%;top:31%;transform:translateX(-50%);z-index:5;color:#e9dcc6;font:700 26px 'Helvetica Neue',Arial;white-space:nowrap"><span style="display:inline-block;width:42px;height:42px;border-radius:50%;background:#e9dcc6;color:#1a2a34;text-align:center;line-height:42px;margin-right:12px">${n}</span>${escapeHtml(label)}</div>`;
  await save("gallery-07-three-steps", card({ lines, headline: "Three steps to a cut file.", subtitle: "Pick a place, set its size, then open it in xTool Studio.", body:
    step(1, "Pick a place", 18) + step(2, "Set the size", 50) + step(3, "Open in Studio", 82) +
    screenshot(crater.location, { left: 18, top: 37, width: 27, anchor: "top" }) + screenshot(crater.size, { left: 50, top: 37, width: 24, anchor: "top" }) + screenshot(crater.exportPreview, { left: 82, top: 37, width: 28, anchor: "top" }),
    caption: "Screenshots of the TopoStack generator in Atomm · Crater Lake" }), { title: "Three steps to a cut file." });

  await save("gallery-08-ready-to-cut", card({ lines, headline: "Ready to cut.", subtitle: "Pieces nested on your material, cuts in red and scores in blue.", body: screenshot(crater.exported, { top: 61, width: 74 }), caption: "Screenshot of the Export view in Atomm · Crater Lake" }), { title: "Ready to cut." });

  await save("gallery-09-make-it-yours", card({ lines, headline: "Make it yours.", subtitle: "Titles, labels, compass, scale bar, and your own markers and paths.", body: screenshot(crater.labels, { top: 61, width: 74 }), caption: "Screenshot of the TopoStack generator in Atomm · Flat engraving" }), { title: "Make it yours." });

  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await writeFile(new URL(`media-projects-${VERSION}.json`, root), JSON.stringify(projects, null, 2) + "\n");
  const archive = new URL(`media-provenance-v${Number(VERSION.slice(1)) - 1}.json`, root);
  try { await access(archive); } catch { await copyFile(new URL("media-provenance.json", root), archive); }
  await writeFile(new URL("media-provenance.json", root), JSON.stringify({
    schemaVersion: 8, capturedAt: new Date().toISOString(), reusedRenders: reuse, sourceCommit, sourceDiffSha256,
    developmentBase: execFileSync("git", ["rev-parse", "origin/dev"], { encoding: "utf8" }).trim(), version: atommVersion, origin,
    projectFile: `media-projects-${VERSION}.json`,
    method: "Embedded studio with live terrain and survey data, through an SDK stand-in. Models are the studio's own Three.js meshes and materials, rendered twice (over white and over black) so their alpha can be recovered; only the camera and the key light's angle and colour are set for capture. Backdrops are each card's flat-engraving SVG from the same studio, restyled as faint lines. Interface images are unedited screenshots of the embedded studio at 2x. Cards are composed in HTML; no AI imagery, photo compositing or fabricated interface. Historical media remains on disk and is excluded from this upload set.",
    surveyResponses: [...surveyResponses], attribution: [...attribution.values()], media,
  }, null, 2) + "\n");
  console.log("Completed", media.length, "media files");
} finally { await browser.close(); }
