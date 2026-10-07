import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";
import { socialImage } from "../../apps/generator/src/lib/site/seo.ts";
import { expectedPages } from "./seo-pages.mjs";

const { values: { environment } } = parseArgs({ options: { environment: { type: "string" } } });
assert.ok(["production", "development", "atomm"].includes(environment), "Pass --environment production, development, or atomm");
const production = environment === "production";
const origin = "https://topostack.app";
const dist = new URL("../../apps/generator/dist/", import.meta.url);
const pages = expectedPages();
const recordedDate = (path) => pages.get(path)?.updated;
// Thousands of generated pages each link to shared assets, so membership is
// checked against Sets and each asset is stat'ed at most once.
const builtPaths = new Set(await readdir(dist, { recursive: true }));
// The in-chat preview (mcp-app/) is an MCP resource, never a site page.
const files = [...builtPaths].filter((path) => path.endsWith(".html") && !path.startsWith("mcp-app/"));
const htmlFiles = new Set(files);
const fileChecks = new Map();
function isBuiltFile(path) {
  if (!builtPaths.has(path)) return false;
  if (!fileChecks.has(path)) fileChecks.set(path, stat(new URL(path, dist)).then((entry) => entry.isFile()));
  return fileChecks.get(path);
}
const indexable = [];
const titles = new Set();
for (const file of files) {
  const html = await readFile(new URL(file, dist), "utf8");
  const document = new JSDOM(html).window.document;
  if (file === "about.html") continue; // Static adapter's portable refresh fallback.
  const path = file === "index.html" ? "/" : "/" + file.replace(/\.html$/, "");
  assert.equal(document.head.querySelectorAll("title").length, 1, file + ": unique title");
  const robots = document.querySelector('meta[name="robots"]')?.content;
  assert.ok(robots, file + ": robots policy");
  const noindex = !production || ["/studio", "/404"].includes(path);
  assert.equal(robots.includes("noindex"), noindex, file + ": indexing policy");
  if (path === "/404") continue;
  assert.ok(document.querySelector('meta[name="description"]')?.content, file + ": description");
  assert.equal(document.querySelectorAll('link[rel="canonical"]').length, 1, file + ": unique canonical");
  assert.equal(document.querySelector('link[rel="canonical"]').href, origin + path, file + ": production canonical");
  assert.ok(!titles.has(document.title), file + ": distinct title");
  titles.add(document.title);
  assert.equal(document.querySelectorAll("h1").length, 1, file + ": useful initial HTML");
  // Declared card dimensions must match the page's own image, or consumers that
  // trust the tags without fetching the file lay the preview out wrongly.
  const image = pages.get(path)?.image ?? socialImage(path);
  assert.equal(document.querySelector('meta[property="og:image"]').content, origin + image.url, file + ": og:image");
  assert.equal(document.querySelector('meta[name="twitter:image"]').content, origin + image.url, file + ": twitter:image");
  assert.equal(document.querySelector('meta[property="og:image:width"]').content, String(image.width), file + ": og:image:width");
  assert.equal(document.querySelector('meta[property="og:image:height"]').content, String(image.height), file + ": og:image:height");
  assert.equal(document.querySelector('meta[property="og:image:alt"]').content, image.alt, file + ": og:image:alt");
  assert.equal(document.querySelector('meta[name="twitter:card"]').content, "summary_large_image");
  assert.equal(document.querySelector('meta[property="og:locale"]').content, "en_US", file + ": og:locale");
  const sharedImage = await isBuiltFile(image.url.slice(1));
  assert.ok(sharedImage, file + ": sharing image " + image.url + " is missing from the build");
  const structured = document.querySelector('script[type="application/ld+json"]');
  assert.ok(structured, file + ": structured data");
  const graph = JSON.parse(structured.textContent)["@graph"];
  assert.ok(graph.length);
  // Guides and examples carry dated article metadata; hubs and policy pages
  // must not claim a publication date they do not have.
  const articleNode = graph.find((node) => node["@type"] === "TechArticle");
  const meta = pages.get(path)?.article;
  assert.equal(Boolean(articleNode), Boolean(meta), file + ": article metadata policy");
  if (articleNode) {
    assert.equal(articleNode.headline, meta.headline, file + ": article headline matches the page title");
    assert.equal(articleNode.datePublished, meta.published, file + ": datePublished");
    assert.equal(articleNode.dateModified, meta.updated, file + ": dateModified");
    assert.equal(articleNode.mainEntityOfPage, origin + path, file + ": article canonical");
    assert.equal(document.querySelector('meta[property="og:type"]').content, "article", file + ": og:type");
    assert.equal(document.querySelector('meta[property="article:modified_time"]').content, meta.updated, file + ": article:modified_time");
  }
  if (!noindex) indexable.push(origin + path);
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (href.startsWith("#") || /^(https?:|mailto:)/.test(href)) continue;
    const link = new URL(href, origin + path);
    const target = link.pathname;
    // The studio opens `?example=<slug>` from its published project file; Crater Lake is the starting project.
    const example = target === "/studio" ? link.searchParams.get("example") : null;
    if (example !== null) assert.ok(example === "crater-lake" || builtPaths.has(`examples/${example}.json`), file + ": example link without a project file " + href);
    const expectedFile = target === "/" ? "index.html" : target.slice(1) + ".html";
    assert.ok(htmlFiles.has(expectedFile) || await isBuiltFile(target.slice(1)), file + ": broken internal link " + href);
  }
}
// sitemap.xml is an index of one sitemap per page group, so Search Console
// reports indexing per group. Production lists both; other builds list none
// and publish the child sitemaps empty.
const SITEMAPS = { "/sitemap-pages.xml": false, "/sitemap-lakes.xml": true };
const readXml = async (file) => new JSDOM(await readFile(new URL(file, dist), "utf8"), { contentType: "application/xml" }).window.document;
const sitemapIndex = await readXml("sitemap.xml");
assert.equal(sitemapIndex.documentElement.localName, "sitemapindex", "sitemap.xml must be a sitemap index");
const children = new Map([...sitemapIndex.querySelectorAll("sitemap")].map((node) => [node.querySelector("loc")?.textContent, node.querySelector("lastmod")?.textContent]));
assert.deepEqual([...children.keys()], production ? Object.keys(SITEMAPS).map((path) => origin + path) : [], "Sitemap index must list the child sitemaps in production only");
// lastmod must be the recorded content date. A build date on every entry is a
// signal search engines learn to ignore, so it is rejected here.
const today = new Date().toISOString().slice(0, 10);
const urls = [];
for (const [sitemapPath, lakes] of Object.entries(SITEMAPS)) {
  const sitemap = await readXml(sitemapPath.slice(1));
  assert.equal(sitemap.documentElement.localName, "urlset", sitemapPath + ": urlset");
  const dates = [];
  for (const entry of sitemap.querySelectorAll("url")) {
    const url = entry.querySelector("loc").textContent;
    const path = url.slice(origin.length);
    const lastmod = entry.querySelector("lastmod")?.textContent;
    assert.ok(lastmod, path + ": sitemap lastmod");
    assert.equal(lastmod, recordedDate(path), path + ": lastmod must match the recorded page date");
    assert.ok(lastmod <= today, path + ": lastmod is in the future");
    assert.equal(Boolean(pages.get(path)?.lake), lakes, path + ": listed in " + sitemapPath + " but belongs in the " + (lakes ? "pages" : "lakes") + " sitemap");
    urls.push(url);
    dates.push(lastmod);
  }
  if (production) assert.equal(children.get(origin + sitemapPath), dates.sort().at(-1), sitemapPath + ": index lastmod must be its newest page date");
}
assert.equal(new Set(urls).size, urls.length, "No URL may be listed twice across the sitemaps");
assert.deepEqual(urls.sort(), indexable.sort(), "Sitemaps must list exactly the indexable built pages");
// The assistant index must describe exactly the pages that are indexable, so
// it cannot advertise a page that robots and the sitemap exclude. Individual
// /lake/ pages are too many to list; llms.txt points to the lakes sitemap.
const llms = await readFile(new URL("llms.txt", dist), "utf8");
assert.ok(llms.startsWith("# TopoStack\n"), "llms.txt heading");
assert.ok(!llms.includes("<html"));
const lakeSitemap = origin + "/sitemap-lakes.xml";
const listed = [...llms.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]).filter((url) => url.startsWith(origin));
assert.deepEqual(listed.filter((url) => url !== origin + "/studio" && url !== lakeSitemap).sort(), indexable.filter((url) => !url.startsWith(origin + "/lake/")).toSorted(), "llms.txt must list exactly the indexable pages other than /lake/ pages");
assert.equal(listed.includes(origin + "/studio"), production, "llms.txt names the studio and says why it is excluded");
assert.equal(listed.includes(lakeSitemap), production, "llms.txt points to the lakes sitemap");
const robots = await readFile(new URL("robots.txt", dist), "utf8");
assert.ok(robots.startsWith("User-agent: *\nAllow: /\n"));
assert.equal(robots.includes("Sitemap: " + origin + "/sitemap.xml"), production);
assert.ok(!robots.includes("<html"));
assert.match(robots, /^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m, "robots.txt declares content signals inside the User-agent group");
// Every page with reading content has a Markdown twin for agents (routes/pages.ts in the Worker).
if (environment !== "atomm") for (const file of htmlFiles) {
  if (file === "404.html" || file === "studio.html" || file === "about.html") continue;
  assert.ok(builtPaths.has(file.replace(/\.html$/, ".md")), file + ": Markdown twin");
}
const headers = await readFile(new URL("_headers", dist), "utf8");
assert.ok(headers.includes("https://static.cloudflareinsights.com"), "Analytics allowed by CSP");
assert.ok(headers.includes("X-Robots-Tag: noindex, follow"));
const headerPaths = headers.split("\n").filter((line) => line.startsWith("/"));
assert.equal(new Set(headerPaths).size, headerPaths.length, "Duplicate header blocks can discard security headers");
assert.equal(/\/\*\n {2}X-Robots-Tag: noindex/.test(headers), !production, "Global noindex is non-production only");
const redirects = await readFile(new URL("_redirects", dist), "utf8");
assert.ok(redirects.includes("/about / 308"));
assert.ok((await readFile(new URL("images/studio-crater-lake.png", dist))).byteLength > 0);
assert.ok((await readFile(new URL("images/social-crater-lake.png", dist))).byteLength > 0);
console.log("Verified " + environment + " metadata, crawl files, links, sharing image and indexing policy (" + files.length + " HTML files).");
