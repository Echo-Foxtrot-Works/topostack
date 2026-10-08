import { appendFile, readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { filesBelow } from "../lib/files.mjs";

const dist = new URL("../../apps/generator/dist/", import.meta.url);

// Enforced budgets cover only what a visitor waits for: the homepage, the
// studio's first paint, and its default 3D preview. Each keeps roughly 10%
// headroom so ordinary feature work fits and a real regression (a heavy
// dependency landing on a critical path) still fails. Raise one in the pull
// request that needs it and put the measured number in the description.
// Measured 2026-09-21 with Node 22.22.2, production build, VITE_MAP_API_URL=https://ci.invalid.
const budgets = {
  // JavaScript the homepage preloads. 58,053 when set.
  landingJavaScriptGzip: 64_000,
  // Prerendered homepage HTML. 9,579 when set; 11,142 after adding the
  // accessible water-finish comparison with responsive images (2026-10-08).
  landingHtmlGzip: 12_300,
  // JavaScript studio.html preloads before the studio can render. 130,547 when set.
  // 145,307 when raised 2026-09-29 (from 143,137): the VFR sectional legend
  // symbols are geometry in core, whose chunk studio.html preloads.
  initialJavaScriptGzip: 160_000,
  // Studio route plus App, the default 3D preview and the geometry worker:
  // everything needed for the first preview. Other routes are not counted.
  // 440,324 when set (the old measure counted every route and read 505,789).
  // 488,122 when raised 2026-09-29: FAA aviation routing, symbols and styling
  // live in core, which ships in both the studio and the geometry worker.
  startupJavaScriptGzip: 537_000,
  // Any single chunk; catches an accidental vendor merge. 275,299 when set.
  largestJavaScriptGzip: 300_000,
  studioHtmlBytes: 10_000,
  // Fetched when browsing or searching lakes; grows with survey sources.
  // 335,417 when set (8,147 records across 28 sources, with the NOAA NBS and chart lakes).
  lakeDirectoryGzip: 370_000,
  // The sheet-nesting engine (sparrow, WebAssembly). Lazy: fetched only when
  // the maker nests parts, and never on startup (asserted below). 309,153 when set.
  nestEngineWasmGzip: 340_000,
  // The in-chat preview (MCP App): one self-contained page a chat host loads
  // when an assistant previews a model. It never loads on the site. 117,290 when set;
  // 130,596 once generation gained acrylic water inserts (dev was 128,227).
  mcpAppHtmlGzip: 143_000,
};

// Reported, never enforced: totals across every route, lazy tool and worker
// grow with each guide page without costing anyone a byte they do not ask for.
const reported = ["totalJavaScriptGzip", "totalCssGzip", "standaloneCssGzip", "atommCssGzip", "nestWorkerJavaScriptGzip"];

const files = await filesBelow(dist);
const measured = await Promise.all(files.filter((file) => /\.(?:js|css)$/.test(file.pathname)).map(async (file) => {
  const body = await readFile(file);
  return { file: decodeURIComponent(file.pathname.split("/").at(-1) ?? file.pathname), type: file.pathname.endsWith(".js") ? "js" : "css", gzip: gzipSync(body).byteLength };
}));
const javascript = measured.filter((entry) => entry.type === "js");
const css = measured.filter((entry) => entry.type === "css");
const largestJavaScript = javascript.toSorted((left, right) => right.gzip - left.gzip)[0];
const totalCssGzip = css.reduce((total, entry) => total + entry.gzip, 0);
const indexHtml = new URL("index.html", dist);
const indexHtmlBody = await readFile(indexHtml, "utf8");
const studioHtml = new URL("studio.html", dist);
const studioHtmlBody = await readFile(studioHtml, "utf8");
function preloads(html, page) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({
      href: tag.match(/\bhref=["']([^"']+)["']/i)?.[1],
      rel: tag.match(/\brel=["']([^"']+)["']/i)?.[1],
    }))
    .filter(({ href, rel }) => href && rel?.split(/\s+/).includes("modulepreload"))
    .map(({ href }) => new URL(href, page))
    .filter((file) => file.protocol === "file:" && file.pathname.startsWith(dist.pathname));
}
async function gzipTotal(files) {
  return (await Promise.all([...new Set(files.map((file) => file.href))].map(async (href) =>
    gzipSync(await readFile(new URL(href))).byteLength
  ))).reduce((total, size) => total + size, 0);
}
const initialJavaScriptFiles = preloads(studioHtmlBody, studioHtml);
const manifest = JSON.parse(await readFile(new URL("../../apps/generator/.svelte-kit/output/client/.vite/manifest.json", import.meta.url), "utf8"));
const atommStyles = new Set(Object.entries(manifest)
  .filter(([key]) => /AtommWorkbench\.svelte$/.test(key))
  .flatMap(([, entry]) => entry.css ?? [])
  .map((path) => path.split("/").at(-1)));
const atommCssGzip = css.filter((entry) => atommStyles.has(entry.file)).reduce((sum, entry) => sum + entry.gzip, 0);

// Walk static imports from what studio.html preloads (the entry scripts, the
// root layout and the studio route) plus the two modules the route imports
// dynamically on mount. Other routes' nodes stay out of the startup cost.
const keyByFile = new Map(Object.entries(manifest).map(([key, entry]) => [new URL(entry.file, dist).href, key]));
const startupFiles = new Set(initialJavaScriptFiles.map((file) => file.href));
const visited = new Set();
function includeModule(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const entry = manifest[key];
  if (!entry) throw new Error(`Missing startup module ${key} in build manifest.`);
  if (entry.file.endsWith(".js")) startupFiles.add(new URL(entry.file, dist).href);
  for (const dependency of entry.imports ?? []) includeModule(dependency);
}
for (const file of initialJavaScriptFiles) {
  const key = keyByFile.get(file.href);
  if (key) includeModule(key);
}
const lazyStartup = Object.keys(manifest).filter((key) => /src\/lib\/studio\/(?:App|ThreePreview)\.svelte$/.test(key));
if (lazyStartup.length !== 2) throw new Error(`Expected App.svelte and ThreePreview.svelte in the build manifest, found ${lazyStartup.join(", ") || "neither"}.`);
for (const key of lazyStartup) includeModule(key);
// Vite emits workers as independent assets, outside the client manifest graph.
for (const file of files.filter((file) => /geometry\.worker[^/]*\.js$/.test(file.pathname))) startupFiles.add(file.href);
// Sheet nesting is loaded on demand; its worker or engine on the startup path is a regression whatever its size.
const nestOnStartup = [...startupFiles].filter((href) => /nest\.worker|nest_wasm/.test(href));
if (nestOnStartup.length) throw new Error(`Sheet nesting reached the studio startup path: ${nestOnStartup.join(", ")}`);
// Browser-agent tools (WebMCP) load only where the browser offers WebMCP.
const webMcpKeys = Object.keys(manifest).filter((key) => /src\/lib\/studio\/webmcp\.ts$/.test(key));
if (webMcpKeys.length !== 1) throw new Error(`Expected the WebMCP module as its own chunk in the build manifest, found ${webMcpKeys.length}.`);
if (startupFiles.has(new URL(manifest[webMcpKeys[0]].file, dist).href)) throw new Error("The WebMCP tools reached the studio startup path.");
const nestWasm = files.filter((file) => /topostack_nest_wasm[^/]*\.wasm$/.test(file.pathname));
if (nestWasm.length !== 1) throw new Error(`Expected one nesting engine .wasm in the build, found ${nestWasm.length}.`);
const nestWorkers = files.filter((file) => /nest\.worker[^/]*\.js$/.test(file.pathname));
const mcpAppHtml = new URL("mcp-app/terrain-preview.html", dist);
const mcpAppHtmlBody = await readFile(mcpAppHtml).catch(() => { throw new Error("dist/mcp-app/terrain-preview.html is missing; the generator build should produce it."); });
// It is served as an MCP resource, never from the site's pages.
const previewOnSite = [indexHtmlBody, studioHtmlBody].some((html) => html.includes("mcp-app/"));
if (previewOnSite) throw new Error("A site page references the in-chat preview.");

const report = {
  landingJavaScriptGzip: await gzipTotal(preloads(indexHtmlBody, indexHtml)),
  landingHtmlGzip: gzipSync(indexHtmlBody).byteLength,
  initialJavaScriptGzip: await gzipTotal(initialJavaScriptFiles),
  startupJavaScriptGzip: await gzipTotal([...startupFiles].map((href) => new URL(href))),
  largestJavaScriptGzip: largestJavaScript?.gzip ?? 0,
  studioHtmlBytes: (await stat(studioHtml)).size,
  lakeDirectoryGzip: gzipSync(await readFile(new URL("data/lake-depth-directory.json", dist))).byteLength,
  nestEngineWasmGzip: await gzipTotal(nestWasm),
  nestWorkerJavaScriptGzip: await gzipTotal(nestWorkers),
  mcpAppHtmlGzip: gzipSync(mcpAppHtmlBody).byteLength,
  totalJavaScriptGzip: javascript.reduce((total, entry) => total + entry.gzip, 0),
  totalCssGzip,
  standaloneCssGzip: totalCssGzip - atommCssGzip,
  atommCssGzip,
};

const rows = [
  ...Object.entries(budgets).map(([name, budget]) => ({ name, actual: report[name], budget })),
  ...reported.map((name) => ({ name, actual: report[name] })),
];
const format = (bytes) => bytes.toLocaleString("en-US");
const status = ({ actual, budget }) => budget === undefined ? "report" : actual > budget ? "OVER" : `${(100 * (budget - actual) / budget).toFixed(1)}% left`;
console.table(Object.fromEntries(rows.map((row) => [row.name, { bytes: format(row.actual), budget: row.budget === undefined ? "-" : format(row.budget), status: status(row) }])));
console.log(`Largest chunk: ${largestJavaScript?.file ?? "none"}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const table = rows.map((row) => `| ${row.name} | ${format(row.actual)} | ${row.budget === undefined ? "-" : format(row.budget)} | ${status(row)} |`);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, ["### Web bundle sizes (gzip bytes)", "", "| Measure | Bytes | Budget | Status |", "| --- | ---: | ---: | --- |", ...table, ""].join("\n"));
}

const failures = rows.filter((row) => row.budget !== undefined && row.actual > row.budget);
if (failures.length) throw new Error(failures.map((row) => `${row.name} is ${format(row.actual)} bytes; budget is ${format(row.budget)} bytes.`).join("\n"));
