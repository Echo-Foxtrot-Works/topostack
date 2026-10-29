import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSeoResponse, fetchSitemapUrls, samplePaths } from "../verify/verify-seo-http.mjs";

for (const status of [404, 429, 503]) {
  test(`deployment SEO retries a transient ${status}`, async (t) => {
    const responses = [new Response("not ready", { status }), new Response("ready")];
    const fetch = t.mock.method(globalThis, "fetch", async () => responses.shift());
    const response = await fetchSeoResponse("https://ci.invalid/guide", { deadline: Date.now() + 1_000, retryDelayMs: 0 });
    assert.equal(response.status, 200);
    assert.equal(fetch.mock.callCount(), 2);
    assert.equal(fetch.mock.calls[0].arguments[1].redirect, "manual");
  });
}

for (const error of [new DOMException("The operation was aborted due to timeout", "TimeoutError"), new TypeError("fetch failed")]) {
  test(`deployment SEO retries a request that fails with ${error.name}`, async (t) => {
    const outcomes = [error, new Response("ready")];
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    const response = await fetchSeoResponse("https://ci.invalid/guide", { deadline: Date.now() + 1_000, retryDelayMs: 0 });
    assert.equal(response.status, 200);
    assert.equal(fetch.mock.callCount(), 2);
  });
}

test("a failing request is reported once the window expires, and monitors fail at once", async (t) => {
  const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw error; });
  await assert.rejects(fetchSeoResponse("https://ci.invalid/guide", { deadline: Date.now() - 1, retryDelayMs: 0 }), error);
  await assert.rejects(fetchSeoResponse("https://ci.invalid/guide"), error);
  assert.equal(fetch.mock.callCount(), 2);
});

for (const [name, status, options] of [
  ["ordinary verification remains immediate", 404, {}],
  ["persistent missing pages fail when the window expires", 404, { deadline: Date.now() - 1 }],
  ["intentional 404 checks are not retried", 404, { expectedStatus: 404, deadline: Infinity }],
  ["authorization errors are not retried", 403, { deadline: Infinity }],
  ["unexpected redirects are not followed or retried", 307, { deadline: Infinity }],
  ["permanent redirects keep their status", 308, { expectedStatus: 308, deadline: Infinity }],
]) {
  test(name, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response("response", { status }));
    assert.equal((await fetchSeoResponse("https://ci.invalid/guide", options)).status, status);
    assert.equal(fetch.mock.callCount(), 1);
  });
}

const sitemap = (...urls) => new Response(
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map((url) => `<url><loc>${url}</loc><lastmod>2026-09-18</lastmod></url>`).join("") + "</urlset>",
  { headers: { "content-type": "application/xml; charset=utf-8" } },
);

test("deployment SEO re-reads a sitemap the edge still serves from the previous deployment", async (t) => {
  const responses = [sitemap("https://ci.invalid/"), sitemap("https://ci.invalid/", "https://ci.invalid/guides/new")];
  const fetch = t.mock.method(globalThis, "fetch", async () => responses.shift());
  const urls = await fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/guides/new", "https://ci.invalid/"], { deadline: Date.now() + 1_000, retryDelayMs: 0 });
  assert.deepEqual(urls, ["https://ci.invalid/", "https://ci.invalid/guides/new"]);
  assert.equal(fetch.mock.callCount(), 2);
});

test("a stale sitemap is reported as read once the propagation window expires, and monitors read it once", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => sitemap("https://ci.invalid/"));
  assert.deepEqual(await fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/", "https://ci.invalid/guides/new"], { deadline: Date.now() - 1, retryDelayMs: 0 }), ["https://ci.invalid/"]);
  assert.deepEqual(await fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/guides/new"]), ["https://ci.invalid/"]);
  assert.equal(fetch.mock.callCount(), 2);
});

test("a deployed sitemap whose content dates do not match the build is rejected", async (t) => {
  t.mock.method(globalThis, "fetch", async () => sitemap("https://ci.invalid/"));
  const read = (lastmod) => fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/"], { lastmod });
  assert.deepEqual(await read({ "https://ci.invalid/": "2026-09-18" }), ["https://ci.invalid/"]);
  await assert.rejects(() => read({ "https://ci.invalid/": "2026-09-19" }), /deployed lastmod/);
  // Callers that do not know the dates still get the URL list.
  assert.deepEqual(await read(undefined), ["https://ci.invalid/"]);
});

for (const previousDate of [undefined, "2026-09-17"]) {
  test(`deployment SEO retries a sitemap with ${previousDate ?? "missing"} content dates`, async (t) => {
    const stale = new Response(
      `<urlset><url><loc>https://ci.invalid/</loc>${previousDate ? `<lastmod>${previousDate}</lastmod>` : ""}</url></urlset>`,
      { headers: { "content-type": "application/xml" } },
    );
    const responses = [stale, sitemap("https://ci.invalid/")];
    const fetch = t.mock.method(globalThis, "fetch", async () => responses.shift());
    assert.deepEqual(await fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/"], {
      deadline: Date.now() + 1_000, retryDelayMs: 0, lastmod: { "https://ci.invalid/": "2026-09-18" },
    }), ["https://ci.invalid/"]);
    assert.equal(fetch.mock.callCount(), 2);
  });
}

test("stale sitemap dates fail when propagation expires instead of passing or retrying forever", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    now += 10;
    return sitemap("https://ci.invalid/");
  });
  await assert.rejects(fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/"], {
    deadline: 20, retryDelayMs: 0, lastmod: { "https://ci.invalid/": "2026-09-19" },
  }), /deployed lastmod/);
  assert.equal(fetch.mock.callCount(), 2);
});

const sitemapIndex = (...paths) => new Response(
  '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + paths.map((path) => `<sitemap><loc>https://topostack.app${path}</loc><lastmod>2026-09-18</lastmod></sitemap>`).join("") + "</sitemapindex>",
  { headers: { "content-type": "application/xml; charset=utf-8" } },
);
const CHILDREN = ["/sitemap-pages.xml", "/sitemap-lakes.xml"];

test("a sitemap index is followed to its child sitemaps on the origin being checked", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url) => ({
    "https://ci.invalid/sitemap.xml": () => sitemapIndex(...CHILDREN),
    "https://ci.invalid/sitemap-pages.xml": () => sitemap("https://ci.invalid/", "https://ci.invalid/guides"),
    "https://ci.invalid/sitemap-lakes.xml": () => sitemap("https://ci.invalid/lakes/norway"),
  })[String(url)]());
  const urls = await fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/lakes/norway", "https://ci.invalid/guides", "https://ci.invalid/"], {
    sitemaps: CHILDREN, lastmod: { "https://ci.invalid/": "2026-09-18", "https://ci.invalid/guides": "2026-09-18", "https://ci.invalid/lakes/norway": "2026-09-18" },
  });
  assert.deepEqual(urls, ["https://ci.invalid/", "https://ci.invalid/guides", "https://ci.invalid/lakes/norway"]);
  assert.deepEqual(fetch.mock.calls.map((call) => String(call.arguments[0])), ["https://ci.invalid/sitemap.xml", ...CHILDREN.map((path) => "https://ci.invalid" + path)]);
});

test("a plain sitemap left by the previous deployment is re-read until the index replaces it", async (t) => {
  const responses = [sitemap("https://ci.invalid/"), sitemapIndex(...CHILDREN), sitemap("https://ci.invalid/"), sitemap()];
  const fetch = t.mock.method(globalThis, "fetch", async () => responses.shift());
  assert.deepEqual(await fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/"], { sitemaps: CHILDREN, deadline: Date.now() + 1_000, retryDelayMs: 0 }), ["https://ci.invalid/"]);
  assert.equal(fetch.mock.callCount(), 4);
});

test("a missing sitemap index fails once the propagation window closes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => sitemap("https://ci.invalid/"));
  await assert.rejects(fetchSitemapUrls("https://ci.invalid/sitemap.xml", ["https://ci.invalid/"], { sitemaps: CHILDREN }), /sitemap index children/);
});

test("lake pages are sampled deterministically and evenly", () => {
  const paths = Array.from({ length: 2_700 }, (_, index) => `/lake/${String(index).padStart(4, "0")}`);
  const sample = samplePaths(paths.toReversed());
  assert.equal(sample.length, 20);
  assert.deepEqual(sample, samplePaths(paths));
  assert.equal(sample[0], "/lake/0000");
  assert.equal(new Set(sample).size, 20);
  assert.ok(sample.at(-1) > "/lake/2500", "the sample reaches the end of the list");
  assert.deepEqual(samplePaths(["/lakes/b", "/lakes/a"]), ["/lakes/a", "/lakes/b"], "short lists are checked in full");
});
