import { mkdir, readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { chromium } from "playwright";
import { captureSocialCard, escapeHtml, socialCardHtml } from "../lib/social-card.mjs";
import { PUBLIC_PAGES } from "../../apps/generator/src/lib/site/seo.ts";
import { LAKE_REGIONS, lakeRegionCard } from "../../apps/generator/src/lib/site/lake-pages.ts";

// Draws the sharing cards for guides, hubs and lake regions into
// apps/generator/static/images/cards/, from pictures already in the repository:
// studio screenshots, example renders and the Atomm Tips crops, plus a dot map
// of each lake region drawn from the lake directory. No dev server or map API:
//   node scripts/dev/capture-social-cards.mjs [card-name ...]
// Pages declare their card with socialCard() in seo.ts or lakeRegionCard() in
// lake-pages.ts; this script refuses a declared card it has no recipe for.
// Commit the JPEGs it writes; look at them first.

const root = new URL("../../", import.meta.url);
const outputDir = new URL("apps/generator/static/images/cards/", root);
const only = process.argv.slice(2);
const MAX_BYTES = 150_000;

const TERRAIN = "Terrain: Mapzen · Map: © OpenStreetMap contributors";
const STUDIO = "apps/generator/static/images/studio-crater-lake.png";
const TIPS = "apps/generator/src/lib/atomm/tips/";
const EXAMPLES = "apps/generator/static/images/examples/";
const GUIDES = "apps/generator/static/images/guides/";

/** A render on the studio's dark 3D background, shown whole. */
const render = (file) => ({ kind: "render", files: [file] });
/** A screenshot, or the part of one inside `crop` ([x, y, width, height] in source pixels), in a frame. */
const shot = (file, crop) => ({ kind: "shot", file, crop });

// Card text is short and written for a feed: the page title reads too long at 50 px.
const PAGE_CARDS = {
  "/guides/lightburn": { kicker: "LightBurn workflow", title: "From terrain SVG to laser job", intro: "Check size, assign operations, apply kerf once and preview before cutting.", media: shot(`${TIPS}export.webp`), footer: `TopoStack export dialog · Software screenshot · ${TERRAIN}` },
  "/guides": { kicker: "Guides", title: "Guides for laser-cut terrain maps", intro: "Layered reliefs, flat engravings, lake depths, your own data and export files.", media: shot(`${TIPS}assembly.webp`), footer: `Crater Lake, Oregon, in the TopoStack studio · ${TERRAIN}` },
  "/guides/laser-cut-topographic-map": { kicker: "Guide", title: "Make a laser-cut topographic map", intro: "Pick a place, set material thickness, preview the stack and export SVG cut panels.", media: shot(`${TIPS}layers.webp`), footer: `Crater Lake layers, exploded in the studio's 3D view · ${TERRAIN}` },
  "/guides/topographic-map-engraving": { kicker: "Guide", title: "Engrave a topographic map", intro: "One flat contour SVG at your chosen size, with roads, water and elevation labels.", media: shot("atomm/assets/topostack-gallery-03-flat-engraving.png", [406, 325, 789, 527]), footer: `Crater Lake contour engraving in the studio · ${TERRAIN}` },
  "/guides/lake-depth-data": { kicker: "Lake depth directory", title: "Find lakes with surveyed depth data", intro: "Search thousands of lakes by name, region or source, then open one in the studio.", media: shot(`${TIPS}place.webp`), footer: "Choosing the map area around Crater Lake in the studio · Map: © OpenStreetMap contributors" },
  "/guides/custom-lake-depth-map": { kicker: "Guide", title: "Make a lake depth map from wood", intro: "Frame the shoreline, set depth layers, paint the water and export the SVG files.", media: render(`${EXAMPLES}lake-tahoe.webp`), footer: `Lake Tahoe, California and Nevada · USGS lake-floor survey · ${TERRAIN}` },
  "/lakes": { kicker: "Lake depth maps", title: "Lake depth maps for laser cutting", intro: "Thousands of lakes with surveyed depths in North America and Europe, ready to cut in wood.", media: shot(`${TIPS}lakes.webp`), footer: `Crater Lake, Oregon · USGS lake-floor survey, depth exaggerated · ${TERRAIN}` },
  "/guides/how-lake-depths-work": { kicker: "How it works", title: "How lake depths work", intro: "Surveys, estimates and shoreline terrain become a lake floor you can cut as layers.", media: render(`${EXAMPLES}crater-lake-800.webp`), footer: `Crater Lake, Oregon · USGS lake-floor survey, depth exaggerated · ${TERRAIN}` },
  "/guides/studio-tour": { kicker: "Guide", title: "A tour of the TopoStack studio", intro: "Choose a place, frame the map, generate terrain, switch previews and save projects.", media: shot(STUDIO), footer: `The studio with Crater Lake in the 3D stack view · ${TERRAIN}` },
  "/guides/map-details": { kicker: "Guide", title: "Map details, labels and linework", intro: "Roads, trails, water, boundaries, elevation labels and line widths for engraving.", media: render(`${EXAMPLES}grand-canyon.webp`), footer: `Grand Canyon, Arizona, with roads, trails and labels · ${TERRAIN}` },
  "/guides/custom-data": { kicker: "Guide", title: "Add your own data to a map", intro: "Depth charts, markers, GPS tracks, boundaries and SVG graphics in one project.", media: shot(`${GUIDES}chart-reviewed-workspace.png`, [289, 200, 1311, 900]), footer: "King City South Lake, Missouri · USGS SIM 3486 depth chart · Map: © OpenStreetMap contributors" },
  "/guides/custom-markers-and-paths": { kicker: "Guide", title: "Add markers and trails to your map", intro: "Import a GPX, KML or GeoJSON route, or enter coordinates for your own markers.", media: shot("atomm/assets/topostack-gallery-08-custom-marker.png", [0, 380, 1160, 820]), footer: `A star marker on Crater Lake's Wizard Island · ${TERRAIN}` },
  "/guides/custom-graphics": { kicker: "Guide", title: "Add a logo or graphic to your map", intro: "Upload an SVG, place and rotate it, then engrave it, score it or cut it out.", media: shot(`${TIPS}processing.webp`, [180, 0, 780, 534]), footer: `Cut lines in red and score lines in blue, from the studio's export preview · ${TERRAIN}` },
  "/guides/trace-a-depth-chart": { kicker: "Guide", title: "Trace a lake depth chart", intro: "Correct the chart's contours, align them with known points and apply them to your map.", media: shot(`${GUIDES}chart-contour-editing.png`, [289, 266, 930, 782]), footer: "King City South Lake, Missouri · USGS SIM 3486 depth chart, public domain" },
  "/guides/how-depth-chart-tracing-works": { kicker: "How it works", title: "How depth-chart tracing works", intro: "How reviewed chart contours become lake floors and cut layers, and where they fall short.", media: shot(`${GUIDES}chart-generated-terrain.png`, [560, 330, 760, 480]), footer: "King City South Lake, Missouri, from a traced USGS chart · Map: © OpenStreetMap contributors" },
  "/guides/how-terrain-generation-works": { kicker: "How it works", title: "How terrain generation works", intro: "Elevation data becomes cut layers in your browser, with caching and parallel workers.", media: render(`${EXAMPLES}matterhorn.webp`), footer: `Matterhorn, Switzerland and Italy · ${TERRAIN}` },
  "/guides/settings-reference": { kicker: "Reference", title: "Studio settings reference", intro: "Every control with its range and default, from vertical exaggeration to kerf.", media: shot(STUDIO, [0, 60, 900, 640]), footer: `Project controls beside Crater Lake in the studio · ${TERRAIN}` },
  "/guides/use-with-ai-assistants": { kicker: "Guide", title: "Plan a terrain model with AI", intro: "Ask Claude or ChatGPT for a model, see a preview in the chat, then open it in the studio.", media: shot(`${GUIDES}ai-assistant-preview.webp`, [0, 140, 1360, 800]), footer: `Mount Rainier previewed inside a chat, generated from real terrain · ${TERRAIN}` },
  "/guides/browser-agents": { kicker: "Guide", title: "Use a browser agent in the studio", intro: "Let an agent in your browser tab change the open design, generate it and open Export.", media: shot(STUDIO, [0, 60, 1100, 700]), footer: `The studio's controls beside Crater Lake · ${TERRAIN}` },
  "/guides/mcp-server": { kicker: "Reference", title: "TopoStack MCP server reference", intro: "Tools, resources, prompts, the in-chat preview, protocol behavior and limits.", media: shot(`${GUIDES}ai-assistant-preview.webp`, [0, 0, 1360, 900]), footer: `Mount Rainier previewed inside a chat from the MCP server · ${TERRAIN}` },
  "/guides/agent-api": { kicker: "Reference", title: "Project request and HTTP API", intro: "Every request field, studio links, and the routes that plan models and make links.", media: render(`${EXAMPLES}lake-tahoe.webp`), footer: `Lake Tahoe, California and Nevada · USGS lake-floor survey · ${TERRAIN}` },
  "/guides/export-files": { kicker: "Guide", title: "What's in your laser export", intro: "SVG panels, cut and score colors, kerf compensation, the assembly guide and project file.", media: shot(`${TIPS}export.webp`), footer: `Crater Lake cut panels in the studio's export preview · ${TERRAIN}` },
  "/guides/troubleshooting": { kicker: "Guide", title: "Troubleshoot map exports", intro: "Fix blocked exports, understand studio warnings and answer common questions.", media: shot(STUDIO, [290, 160, 870, 580]), footer: `Studio notices above a Crater Lake relief · ${TERRAIN}` },
  "/examples": { kicker: "Examples", title: "Topographic map examples", intro: "Layered terrain projects with renders, settings and project files to import.", media: { kind: "renders", files: [`${EXAMPLES}yosemite-valley.webp`, `${EXAMPLES}mount-fuji.webp`, `${EXAMPLES}mount-rainier.webp`] }, footer: `Yosemite Valley, Mount Fuji and Mount Rainier · ${TERRAIN}` },
};

// The dot maps show where each region's lakes are; the text stays true as the directory grows.
const REGION_CARDS = {
  minnesota: { title: "Minnesota lake depth maps", intro: "Surveyed depth contours for thousands of Minnesota lakes, ready to cut as layers.", footer: "Source: Minnesota DNR lake bathymetry" },
  ontario: { title: "Ontario lake depth maps", intro: "Provincial depth surveys for thousands of Ontario lakes, ready to cut as layers.", footer: "Source: Ontario lake bathymetry" },
  finland: { title: "Finland lake depth maps", intro: "Depth contours for lakes across Finland, ready to cut as a layered wood map.", footer: "Source: Syke Finland lake bathymetry" },
  norway: { title: "Norway lake depth maps", intro: "Depth contours for hundreds of Norwegian lakes and reservoirs, ready to cut as layers.", footer: "Source: NVE Norway lake bathymetry" },
  switzerland: { title: "Swiss lake depth maps", intro: "Surveyed lake-floor grids for Lake Geneva, Lake Constance and more Swiss lakes.", footer: "Source: swisstopo swissBATHY3D" },
  "great-lakes": { title: "Great Lakes depth maps", intro: "Surveyed depth grids for all five Great Lakes and Lake St. Clair.", footer: "Source: NOAA NCEI Great Lakes Bathymetry" },
  "united-states": { title: "US lake and reservoir depth maps", intro: "Crater Lake, Lake Tahoe, Lake Okeechobee and hundreds more US lakes and reservoirs.", footer: "Sources: USGS, NOAA, Texas Water Development Board, Bureau of Reclamation · Lower 48 shown" },
};

// Where the picture sits on the 1200 × 630 card, right of the text.
const AREA = { left: 544, top: 56, width: 608, height: 468 };
const STYLE = `
      .brand .kicker { margin-left: 14px; padding-left: 14px; border-left: 1px solid #58604f; font-size: 15px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; color: #d8b98f; }
      h1 { width: 440px; margin-top: 34px; }
      .intro { width: 420px; }
      .media { position: absolute; left: ${AREA.left}px; top: ${AREA.top}px; width: ${AREA.width}px; height: ${AREA.height}px; display: flex; align-items: center; justify-content: center; }
      .render { width: 100%; height: 100%; object-fit: contain; }
      .shot { position: relative; overflow: hidden; border: 1px solid #58604f; border-radius: 10px; box-shadow: 0 18px 44px rgb(0 0 0 / .4); }
      .shot img { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
      .renders { display: grid; width: 100%; height: 100%; grid-template: 1fr 1fr / 1fr 1fr; gap: 8px; }
      .renders img { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
      .renders img:first-child { grid-column: 1 / 3; }`;

const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };
async function dataUrl(file) {
  return `data:${MIME[extname(file)]};base64,${(await readFile(new URL(file, root))).toString("base64")}`;
}
/** Natural pixel size of a PNG or lossy/lossless WebP, for fitting a screenshot frame. */
async function imageSize(file) {
  const bytes = await readFile(new URL(file, root));
  if (bytes.toString("ascii", 1, 4) === "PNG") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  throw new Error(`Unknown image format: ${file}`);
}

async function mediaHtml(media) {
  if (media.kind === "render") return `<div class="media"><img class="render" alt="" src="${await dataUrl(media.files[0])}"></div>`;
  if (media.kind === "renders") return `<div class="media"><div class="renders">${(await Promise.all(media.files.map(dataUrl))).map((src) => `<img alt="" src="${src}">`).join("")}</div></div>`;
  if (media.kind === "shot") {
    const size = await imageSize(media.file);
    const [x, y, width, height] = media.crop ?? [0, 0, size.width, size.height];
    if (x + width > size.width || y + height > size.height) throw new Error(`Crop is outside ${media.file}`);
    const scale = Math.min((AREA.width - 2) / width, (AREA.height - 2) / height);
    return `<div class="media"><div class="shot" style="width: ${Math.round(width * scale) + 2}px; height: ${Math.round(height * scale) + 2}px"><img alt="" style="transform: scale(${scale}) translate(${-x}px, ${-y}px)" src="${await dataUrl(media.file)}"></div></div>`;
  }
  if (media.kind === "svg") return `<div class="media">${media.svg}</div>`;
  throw new Error(`Unknown media kind: ${media.kind}`);
}

/**
 * Each lake in the region as a dot at the centre of its bounds, sized by its
 * extent, on an equirectangular projection corrected for latitude. The few
 * largest lakes are labelled when the region has only a handful.
 */
function lakeDotMap(lakes) {
  const centre = (lake) => [(lake.bounds[0] + lake.bounds[2]) / 2, (lake.bounds[1] + lake.bounds[3]) / 2];
  const lats = lakes.map((lake) => centre(lake)[1]).sort((a, b) => a - b);
  const cos = Math.cos(lats[Math.floor(lats.length / 2)] * Math.PI / 180);
  const project = ([lon, lat]) => [lon * cos, -lat];
  const points = lakes.map((lake) => {
    const [x, y] = project(centre(lake));
    const [x0, y0] = project([lake.bounds[0], lake.bounds[3]]);
    const [x1, y1] = project([lake.bounds[2], lake.bounds[1]]);
    return { x, y, extent: Math.sqrt(Math.abs((x1 - x0) * (y1 - y0))), name: lake.name };
  });
  const few = lakes.length <= 30;
  // Few lakes: dots sized by the lake and labelled, so the map needs room for both.
  const padX = few ? 130 : 24, padY = few ? 40 : 24;
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((AREA.width - 2 * padX) / Math.max(maxX - minX, 1e-6), (AREA.height - 2 * padY) / Math.max(maxY - minY, 1e-6));
  const offsetX = (AREA.width - (maxX - minX) * scale) / 2, offsetY = (AREA.height - (maxY - minY) * scale) / 2;
  const minRadius = lakes.length < 700 ? 2.6 : 1.6;
  const dots = points.map((point) => ({
    cx: offsetX + (point.x - minX) * scale,
    cy: offsetY + (point.y - minY) * scale,
    // Many lakes: small, even dots so the region's shape reads.
    r: few ? Math.min(26, Math.max(5, point.extent * scale * 0.3)) : Math.min(6, Math.max(minRadius, point.extent * scale * 0.5)),
    name: point.name,
  })).sort((a, b) => b.r - a.r);
  const circles = dots.map((dot) => `<circle cx="${dot.cx.toFixed(1)}" cy="${dot.cy.toFixed(1)}" r="${dot.r.toFixed(1)}"/>`).join("");
  const labels = few ? dots.filter((dot) => dot.r >= 8).slice(0, 6).map((dot) => `<text x="${(dot.cx + dot.r + 6).toFixed(1)}" y="${(dot.cy + 5).toFixed(1)}">${escapeHtml(dot.name)}</text>`).join("") : "";
  return `<svg width="${AREA.width}" height="${AREA.height}" viewBox="0 0 ${AREA.width} ${AREA.height}" xmlns="http://www.w3.org/2000/svg"><g fill="#8fb4c2" fill-opacity="${few ? 0.7 : 0.85}" stroke="#20231d" stroke-width="${few ? 1.5 : 0.4}">${circles}</g><g fill="#f6f4ef" font-family="Arial, sans-serif" font-size="16" paint-order="stroke" stroke="#20231d" stroke-width="4">${labels}</g></svg>`;
}

/** Shrink a long title until the text clears the footer; fail rather than overlap it. */
function fitText() {
  const h1 = document.querySelector("h1"), intro = document.querySelector(".intro"), footer = document.querySelector("footer");
  const overflows = () => h1.getBoundingClientRect().height > parseFloat(getComputedStyle(h1).fontSize) * 3.3 || intro.getBoundingClientRect().bottom > footer.getBoundingClientRect().top - 24;
  for (let size = 50; overflows() && size > 36; size -= 2) h1.style.fontSize = `${size - 2}px`;
  if (overflows()) throw new Error(`Card text does not fit: ${h1.textContent}`);
  if (footer.getBoundingClientRect().height > 44) throw new Error(`Card footer wraps: ${footer.textContent}`);
}

// Every declared card needs a recipe here, and every recipe a page.
const cards = [];
for (const [path, meta] of Object.entries(PUBLIC_PAGES)) {
  if (!meta.image?.url.startsWith("/images/cards/")) continue;
  const recipe = PAGE_CARDS[path];
  if (!recipe) throw new Error(`${path} declares ${meta.image.url} but this script has no card for it`);
  cards.push({ url: meta.image.url, ...recipe });
}
for (const path of Object.keys(PAGE_CARDS)) if (!PUBLIC_PAGES[path]?.image?.url.startsWith("/images/cards/")) throw new Error(`${path} has a card recipe but does not declare a socialCard() image`);
const directory = JSON.parse(await readFile(new URL("apps/generator/static/data/lake-depth-directory.json", root), "utf8"));
for (const region of LAKE_REGIONS) {
  const recipe = REGION_CARDS[region.slug];
  if (!recipe) throw new Error(`Lake region ${region.slug} has no card`);
  let lakes = directory.lakes.filter((lake) => region.sources.includes(lake.sourceId));
  // Alaska, Hawaii and the Caribbean would shrink the lower 48 to a strip.
  if (region.slug === "united-states") lakes = lakes.filter((lake) => lake.bounds[0] > -126 && lake.bounds[2] < -66 && lake.bounds[1] > 24 && lake.bounds[3] < 50);
  cards.push({ url: lakeRegionCard(region.slug).url, kicker: "Lake depth maps", ...recipe, footer: `Each dot is a lake with depth data in TopoStack · ${recipe.footer}`, media: { kind: "svg", svg: lakeDotMap(lakes) } });
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const card of cards) {
    const name = card.url.slice("/images/cards/".length, -".jpg".length);
    if (only.length && !only.includes(name)) continue;
    const output = new URL(name + ".jpg", outputDir);
    await captureSocialCard(browser, socialCardHtml({
      brand: `TopoStack<span class="kicker">${escapeHtml(card.kicker)}</span>`,
      title: escapeHtml(card.title),
      intro: escapeHtml(card.intro),
      footer: escapeHtml(card.footer),
      media: await mediaHtml(card.media),
      style: STYLE,
    }), output.pathname, fitText);
    const { size } = await stat(output);
    console.log(`${name}.jpg ${Math.round(size / 1000)} kB${size > MAX_BYTES ? " (over 150 kB)" : ""}`);
  }
} finally {
  await browser.close();
}
