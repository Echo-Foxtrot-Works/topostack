import { fontNotices } from "../lib/font-notices.mjs";
import { validateStaticHeaders } from "../lib/static-headers.mjs";
import { readFile, stat } from "node:fs/promises";
import { forbiddenHostsIn } from "../lib/api-host.mjs";
import { filesBelow } from "../lib/files.mjs";
import { SITE_ONLY_PATHS } from "../lib/atomm-site-only.mjs";

// `--skip-endpoint-scan` is used only by the CI validate job, whose build
// intentionally embeds the hermetic `https://ci.invalid` sentinel so tests
// cannot reach real services. Every packaging path (`package:atomm`,
// `release:atomm`) runs the full scan.
const skipEndpointScan = process.argv.includes("--skip-endpoint-scan");

const indexPath = new URL("../../apps/generator/dist/index.html", import.meta.url);
const index = await readFile(indexPath, "utf8");
const studio = await readFile(new URL("../../apps/generator/dist/studio.html", import.meta.url), "utf8");
const requireSdkEntry = process.argv.includes("--require-sdk-entry");
const sdkCount = (html) => (html.match(/<script\b[^>]*\bsrc=["']https:\/\/static-res\.makextool\.com\/scripts\/js\/generator-sdk\/platform-sdk\.js["']/g) ?? []).length;
if (requireSdkEntry) {
  if (sdkCount(index) !== 1 || sdkCount(studio) !== 1) throw new Error("Each Atomm entry page must include exactly one platform SDK script.");
  if (index.includes('class="landing-page"')) throw new Error("The Atomm entry page must open the workbench, not the marketing homepage.");
} else {
  if (sdkCount(index) || sdkCount(studio)) throw new Error("Public entry pages must load the platform SDK only when embedded.");
  if (!/href=["'][^"']*studio["']/.test(index)) throw new Error("The homepage does not link to the terrain studio.");
}
const headers = await readFile(new URL("../../apps/generator/dist/_headers", import.meta.url), "utf8");
validateStaticHeaders(headers);
if (headers.includes("__TOPOSTACK_SCRIPT_HASHES__") || /script-src[^;]*unsafe-inline/.test(headers) || !/script-src[^;]*sha256-/.test(headers)) throw new Error("Production security headers do not contain finalized inline-script hashes.");
const distDirectory = new URL("../../apps/generator/dist/", import.meta.url);
const distFiles = await filesBelow(distDirectory);
if (requireSdkEntry) {
  // The Atomm package is the studio alone: its pages, the credits page it
  // links to, and what it fetches at runtime. The public site stays out.
  const packaged = distFiles.map((file) => file.pathname.slice(distDirectory.pathname.length));
  const allowedPages = new Set(["index.html", "studio.html", "attribution.html", "404.html"]);
  const sitePages = packaged.filter((file) => file.endsWith(".html") && !allowedPages.has(file));
  const siteAssets = packaged.filter((file) => SITE_ONLY_PATHS.some((path) => file === path || file.startsWith(`${path}/`)));
  if (sitePages.length || siteAssets.length) throw new Error(`The Atomm package contains public site files: ${[...sitePages, ...siteAssets].slice(0, 8).join(", ")}${sitePages.length + siteAssets.length > 8 ? ", …" : ""}`);
  if (!packaged.includes("data/lake-depth-directory.json")) throw new Error("The Atomm package is missing the lake directory that place search reads.");
}
const scripts = distFiles.filter((file) => file.pathname.endsWith(".js"));
if (!scripts.length) throw new Error("Production artifact contains no JavaScript application files.");
// The nesting engine is redistributed in compiled form; its MIT and MPL-2.0 notices must ship with it.
const licenses = await readFile(new URL("../../apps/generator/dist/licenses/third-party.txt", import.meta.url), "utf8").catch(() => "");
if (!licenses.includes("Copyright (c) 2025 Jeroen Gardeyn, KU Leuven") || !licenses.includes("Mozilla Public License")) throw new Error("dist/licenses/third-party.txt is missing the nesting engine's licence notices.");
for (const source of fontNotices) {
  const notice = (await readFile(new URL("../../" + source, import.meta.url), "utf8")).trim();
  if (!licenses.includes(source + "\n\n" + notice)) throw new Error(`Packaged engraving font notice is missing: ${source}`);
}
if (!/script-src[^;]*'wasm-unsafe-eval'/.test(headers)) throw new Error("Production security headers do not allow the nesting engine's WebAssembly to compile.");
// Scanned file by file, so a host a bundled library only writes into its own
// code (see LIBRARY_HOSTS) is excused there and nowhere else.
const searchable = [index, studio, ...await Promise.all(scripts.map((file) => readFile(file, "utf8")))];

if (!skipEndpointScan) {
  const forbidden = searchable.flatMap((text) => forbiddenHostsIn(text));
  if (forbidden.length) throw new Error(`Production artifact contains development or placeholder API endpoints: ${[...new Set(forbidden)].join(", ")}`);
}

if (/\b(?:src|href)=["']\/(?!\/)/.test(index + studio)) throw new Error("Production pages contain root-relative assets that may fail in Atomm.");
const size = (await stat(indexPath)).size;
if (size <= 0) throw new Error("Production entry page is empty.");
