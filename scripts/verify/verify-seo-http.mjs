import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { SITE_ORIGIN } from "../../apps/generator/src/lib/site/seo.ts";
import { expectedPages } from "./seo-pages.mjs";

const pages = expectedPages();

// Deployment assets can become available shortly after the Worker itself.
// Only callers verifying a fresh deployment opt into a shared retry window.
export async function fetchSeoResponse(url, { expectedStatus = 200, deadline = 0, retryDelayMs = 3_000, headers = {} } = {}) {
  while (true) {
    const response = await fetch(url, { redirect: "manual", headers, signal: AbortSignal.timeout(10_000) });
    const retryable = response.status === 429 || response.status >= 500
      || (response.status === 404 && expectedStatus === 200);
    if (response.status === expectedStatus || !retryable || Date.now() + retryDelayMs >= deadline) return response;
    await response.body?.cancel();
    console.warn(`SEO response ${response.status} for ${url}; waiting for deployment assets.`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

/** The child sitemaps production's `/sitemap.xml` index lists, in order. */
export const SITEMAPS = ["/sitemap-pages.xml", "/sitemap-lakes.xml"];
/** Generated lake pages checked over HTTP per run; the build verifier checks every one. */
export const LAKE_PAGE_SAMPLE = 20;

/**
 * Evenly spaced paths from the sorted list, always including the first, so
 * every run checks the same pages and the sample spans every region.
 */
export function samplePaths(paths, size = LAKE_PAGE_SAMPLE) {
  const sorted = [...paths].sort();
  if (sorted.length <= size) return sorted;
  return Array.from({ length: size }, (_, index) => sorted[Math.floor(index * sorted.length / size)]);
}

const parseXml = async (response) => new JSDOM(await response.text(), { contentType: "application/xml" }).window.document;

/**
 * Reads a sitemap, following a sitemap index one level down. Child locations
 * name the canonical origin; they are read from the origin being checked, so a
 * development or local deployment is verified against its own files.
 * Returns the child sitemap paths (empty for a plain urlset) and every
 * `<url>` entry.
 */
async function readSitemap(url, { deadline, retryDelayMs }) {
  const read = async (target) => {
    const response = await fetchSeoResponse(target, { deadline, retryDelayMs });
    assert.equal(response.status, 200, target + " status");
    assert.match(response.headers.get("content-type"), /xml/, target + " content type");
    return parseXml(response);
  };
  const root = await read(url);
  const urlEntries = (document) => [...document.querySelectorAll("url")].map((entry) => ({
    loc: entry.querySelector("loc")?.textContent,
    lastmod: entry.querySelector("lastmod")?.textContent,
  }));
  if (root.documentElement.localName !== "sitemapindex") return { sitemaps: [], entries: urlEntries(root) };
  const sitemaps = [...root.querySelectorAll("sitemap > loc")].map((node) => new URL(node.textContent).pathname);
  const entries = [];
  for (const path of sitemaps) entries.push(...urlEntries(await read(new URL(path, url))));
  return { sitemaps, entries };
}

/**
 * The sitemaps are prerendered assets the edge cache may still serve from the
 * previous deployment for a short while after the Worker itself is live, so a
 * fresh deployment keeps re-reading them until they list the expected pages
 * and content dates, or the propagation window closes. Returns the last URL
 * list read, sorted, across every child sitemap of an index.
 *
 * `lastmod` maps each expected URL to the content date the build recorded for
 * it. Callers that know those dates pass them so the deployed sitemap is
 * checked in the same read that confirmed propagation. `sitemaps`, when given,
 * is the list of child sitemap paths the index must name; a plain urlset left
 * from an older deployment then counts as not yet propagated.
 */
export async function fetchSitemapUrls(url, expected, { deadline = 0, retryDelayMs = 3_000, lastmod, sitemaps } = {}) {
  const wanted = [...expected].sort();
  const sameList = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);
  while (true) {
    const read = await readSitemap(url, { deadline, retryDelayMs });
    const urls = read.entries.map((entry) => entry.loc).sort();
    const indexMatches = !sitemaps || sameList(read.sitemaps, sitemaps);
    const pagesMatch = sameList(urls, wanted);
    const staleDates = pagesMatch && lastmod ? read.entries.filter((entry) => entry.lastmod !== lastmod[entry.loc]) : [];
    if (indexMatches && pagesMatch && !staleDates.length) return urls;
    if (Date.now() + retryDelayMs >= deadline) {
      // Monitors fail immediately; deployments fail after their retry window.
      // Preserve the specific date diagnostic when the URL list is correct.
      if (sitemaps) assert.deepEqual(read.sitemaps, sitemaps, url + ": sitemap index children");
      for (const entry of staleDates) assert.equal(entry.lastmod, lastmod[entry.loc], entry.loc + ": deployed lastmod");
      return urls;
    }
    console.warn(`Sitemap at ${url} does not list the expected pages and content dates yet; waiting for deployment assets.`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

export async function verifyHttpSeo(origin, environment, { propagationTimeoutMs = 0 } = {}) {
  assert.ok(["production", "development"].includes(environment));
  const production = environment === "production";
  const deadline = Date.now() + propagationTimeoutMs;
  const get = (path, expectedStatus = 200, headers = {}) => fetchSeoResponse(new URL(path, origin), { expectedStatus, deadline, headers });
  const robots = await get("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  const robotsBody = await robots.text();
  assert.match(robotsBody, /^User-agent: \*\nAllow: \//);
  assert.match(robotsBody, /^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m);
  // Agents asking for Markdown get the page's twin; browsers keep the HTML.
  for (const path of ["/", "/guides/mcp-server"]) {
    const markdown = await get(path, 200, { accept: "text/markdown" });
    assert.match(markdown.headers.get("content-type"), /^text\/markdown/, path + " Markdown negotiation");
    assert.match(markdown.headers.get("vary") ?? "", /accept/i, path + " Markdown varies on Accept");
    assert.match(await markdown.text(), /^---\ntitle: /, path + " Markdown front matter");
  }
  const recorded = [...pages].map(([path, page]) => [path, page.updated]);
  const expectedUrls = production ? recorded.map(([path]) => SITE_ORIGIN + path).sort() : [];
  const recordedDates = Object.fromEntries(recorded.map(([path, updated]) => [SITE_ORIGIN + path, updated]));
  const urls = await fetchSitemapUrls(new URL("/sitemap.xml", origin), expectedUrls, {
    deadline, lastmod: production ? recordedDates : undefined, sitemaps: production ? SITEMAPS : [],
  });
  assert.deepEqual(urls, expectedUrls, "Sitemap must list exactly the public pages");
  // Every registered page and example, and a fixed sample of the generated
  // lake pages: there are thousands, and the build verifier checks them all.
  const lakePaths = [...pages].filter(([, page]) => page.lake).map(([path]) => path);
  const checked = [...[...pages].filter(([, page]) => !page.lake).map(([path]) => path), ...samplePaths(lakePaths)];
  for (const path of [...checked, "/studio"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const document = new JSDOM(await response.text()).window.document;
    const noindex = !production || path === "/studio";
    assert.equal(document.querySelector('meta[name="robots"]')?.content.includes("noindex"), noindex, path);
    assert.equal(Boolean(response.headers.get("x-robots-tag")?.includes("noindex")), noindex, path + " header");
    assert.equal(document.querySelector('link[rel="canonical"]')?.href, "https://topostack.app" + path, path);
    assert.ok(response.headers.get("content-security-policy")?.includes("https://static.cloudflareinsights.com"));
    if (path !== "/studio") assert.match(response.headers.get("link") ?? "", /rel="api-catalog"/, path + " discovery Link header");
  }
  const llms = await get("/llms.txt");
  assert.equal(llms.status, 200);
  assert.match(llms.headers.get("content-type"), /^text\/plain/, "llms.txt must not be served as HTML");
  assert.match(await llms.text(), /^# TopoStack\n/);
  const missing = await get("/seo-verification-missing-page", 404);
  assert.equal(missing.status, 404, "Unknown URLs must return HTTP 404");
  for (const path of ["/about", "/about/"]) {
    const response = await get(path, 308);
    assert.equal(response.status, 308, path + " permanent redirect");
    assert.equal(new URL(response.headers.get("location"), origin).pathname, "/");
  }
  const image = await get("/images/studio-crater-lake.png");
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /image\/png/);
  // Every declared sharing card must actually be fetchable: a 404 here means
  // link previews render without an image wherever the page is shared.
  for (const url of new Set([...pages.values()].map((page) => page.image.url))) {
    const card = await get(url);
    assert.equal(card.status, 200, url + " sharing card");
    assert.match(card.headers.get("content-type"), /^image\//, url + " content type");
  }
  console.log("Verified " + environment + " SEO response semantics at " + origin);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A fresh deployment's assets can lag the Worker, so the deploy job passes a
  // propagation window; monitors leave it unset and fail immediately.
  const propagation = Number(process.env.SEO_PROPAGATION_TIMEOUT_MS ?? 0);
  assert.ok(Number.isFinite(propagation) && propagation >= 0, "SEO_PROPAGATION_TIMEOUT_MS must be a non-negative number of milliseconds");
  await verifyHttpSeo(process.argv[2], process.argv[3], { propagationTimeoutMs: propagation });
}
