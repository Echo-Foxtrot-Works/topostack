# SEO and discoverability audit

Date: September 15, 2026. Source reviewed: `dev` at `335a5c9`, initially clean working tree. Live site: [TopoStack](https://topostack.echofoxtrot.works/).

Implementation follow-up: [SEO operations and verification](../seo-operations.md). The findings below record the pre-implementation audit.

## Assessment

TopoStack has a useful, specific product and a crawlable homepage. Its largest opportunities are fixing deployment responses, describing the tool in the language makers search for, publishing practical examples, and measuring successful use. These should take priority over further homepage speed optimization.

The audit found **confirmed technical defects and discoverability gaps**, but cannot establish current Google indexing, rankings, search volume, or organic conversions without Search Console and analytics access. Lighthouse scores measure selected technical checks, not ranking potential.

This is an audit and implementation backlog. Application code and external settings were not changed.

## Verified baseline

| Check | Observed result | Interpretation |
| --- | --- | --- |
| Production `/` | HTTP 200; title, description, H1, explanatory text and ordinary links in initial HTML | Healthy foundation; Google need not execute the editor to understand the homepage |
| `/studio` | HTTP 200; initial HTML has no title, description, H1 or useful body copy; title and UI appear after JavaScript | Client rendering limits immediate crawler/share-preview understanding |
| `/robots.txt` | HTTP 200, `text/html`, homepage body | Invalid crawler file |
| `/sitemap.xml` | HTTP 200, `text/html`, homepage body | No usable sitemap |
| `/seo-audit-missing-page-20260915` | HTTP 200, homepage body | Incorrect success response for an unknown URL; soft-404 risk |
| `/about` | HTTP 200 with immediate HTML refresh and JavaScript redirect to `/` | Source-level `redirect(308)` is not an HTTP 308 in the static deployment |
| Development homepage | HTTP 200; neither HTML `noindex` nor `X-Robots-Tag` | Public development copy has no observed indexing exclusion |
| Canonical, Open Graph, Twitter card, JSON-LD | Absent on the production homepage | Missing URL preference and sharing/entity metadata |
| GitHub repository API | `description: null`, `homepage: null`, `topics: []`, `license: null` | Repository discovery/profile fields are unconfigured |
| Live homepage Lighthouse, mobile, v13.4.1 | SEO 91; accessibility 100; best practices 92 | SEO failure is invalid robots.txt; best-practices failures concern blocked analytics |

HTTP observations were checked through browser fetches and independent requests. Some later command-line requests to URL variants returned 403 while the browser saw redirects. HTTP-to-HTTPS normalization and bot-specific access therefore remain unverified; investigate with Search Console URL Inspection and Cloudflare security events before diagnosing a crawler block.

### Performance observations

| Metric | Observed value | Assessment |
| --- | --- | --- |
| Largest Contentful Paint | 161 ms | Fast in this laboratory observation |
| Cumulative Layout Shift | 0.00 | No observed layout shift |
| Time to First Byte | 106 ms | Fast in this observation |
| Interaction to Next Paint | Not measured | Requires interaction/field evidence |
| Real-user Core Web Vitals | No page-level CrUX data returned | Cannot declare a field pass |

The trace used desktop Chrome, 1× CPU, no network throttling, and a previously visited page with cached assets. It is separate from the mobile Lighthouse audit and is not a cold mobile benchmark. Render-blocking and cache insights estimated **0 ms savings**. Keep the existing homepage/editor split and bundle budgets; there is no evidence here to make speed work the first growth investment.

## Prioritized findings and fixes

Priority 1 means address in the first implementation batch; Priority 2 means the next growth batch. Effort estimates are rough engineering estimates, excluding deployment approval, content production and search-engine recrawling.

### 1. Correct crawler endpoints and unknown-page responses

**Priority 1 · High technical impact · Approximately half a day.**

Evidence: [Worker configuration](../../workers/map-api/wrangler.jsonc), lines 7–10, uses `not_found_handling: "single-page-application"`. The static asset directory contains neither robots.txt nor sitemap.xml. All three problematic responses in the baseline follow from this fallback.

Recommended implementation:

- Use `assets.not_found_handling: "404-page"` and ship an actual `404.html`. Preserve the generated homepage and `studio.html` and the existing API routing exceptions.
- Add `apps/generator/static/robots.txt`, served as plain text, allowing public content and its rendering assets and advertising the absolute production sitemap URL.
- Add a generated or static XML sitemap containing canonical, indexable production pages. Initially this may contain only `/`; include `/studio` only if it becomes an intentional indexable destination. Exclude redirects, errors, development URLs and arbitrary project/query variants.
- Do not add artificial last-modified dates on every build.

Missing robots.txt by itself would not prevent indexing, and a tiny linked site can be discovered without a sitemap. The confirmed defect is serving HTML as both files and reporting nonexistent pages as successful. Cloudflare documents the [404 configuration](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/); Google documents the [robots.txt format](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt).

**Acceptance:** GET requests return plain-text robots, parseable XML sitemap, and HTTP 404 for a random missing URL. `/` and direct `/studio` still work. Verify against the deployed Worker, not only Vite preview.

### 2. Establish production canonical URLs and exclude development

**Priority 1 · High technical impact · Approximately half a day.**

Evidence: [homepage head](../../apps/generator/src/routes/+page.svelte), lines 14–17; [shared headers](../../apps/generator/static/_headers); [deployment workflow](../../.github/workflows/ci.yml), lines 152–164. The frontend build currently receives no explicit indexing environment; selecting a Wrangler environment afterward does not automatically change prerendered metadata.

Recommended implementation:

- Add an absolute self-canonical on each indexable production page. The homepage canonical should be `https://topostack.echofoxtrot.works/`, including when visited with tracking parameters.
- Apply development-only `X-Robots-Tag: noindex` to actual static HTML responses, using explicit build environment configuration or verified host-specific response handling. The current Worker runs first only for selected API/health routes, so adding this solely inside API code would miss the pages.
- Test production and development together so a development directive cannot leak into production. Check any enabled workers.dev/preview hosts as well; their exposure was not verified in this audit.
- Keep pages crawlable where crawlers must read `noindex`. A blanket robots disallow is not an indexing-removal mechanism.

**Acceptance:** Production returns one correct canonical and no `noindex`; development HTML carries `noindex`. Tracking variants resolve to the same canonical. These recommendations follow Google's [canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) and [indexing-control guidance](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).

### 3. Repair analytics before judging growth

**Priority 1 · High measurement impact · Approximately half a day, plus funnel instrumentation.**

The live Lighthouse run recorded Cloudflare's injected `static.cloudflareinsights.com/beacon.min.js` script being blocked by Content Security Policy. [Static headers](../../apps/generator/static/_headers), line 2, allow the Atomm script origin but omit the Cloudflare analytics origin. Searches found no dedicated acquisition-to-export event instrumentation in the app.

Allow the intended Cloudflare analytics script through the existing policy while retaining its other protections. Verify successful beacon transmission, not just script download. The existing `connect-src https:` already permits HTTPS collection endpoints; do not broaden unrelated directives. See [Cloudflare's CSP requirements](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/content-security-policies/).

Verify the production property in Google Search Console and Bing Webmaster Tools, or use existing verified properties. DNS verification may already exist; its absence cannot be inferred from source. Submit the corrected sitemap and inspect the homepage's selected canonical and indexing status.

Add or choose a suitable event system for this funnel:

`landing visit → studio opened → real terrain generated → fabrication export completed`

Distinguish layered/flat output and generation/export failures. A preview click or opening the Export dialog is not a completed export. Record acquisition source and landing page without recording user project names, exact coordinates or search text.

**Acceptance:** A fresh browser session sends intended analytics successfully; a complete test journey records the expected funnel events once each. Search Console supplies the baseline for impressions, clicks, queries and indexed pages.

### 4. Make the homepage immediately identify the searchable product

**Priority 1 · High relevance/conversion opportunity · A few hours.**

Evidence: [homepage](../../apps/generator/src/routes/+page.svelte), lines 15–40. The current title emphasizes “laser projects”; the H1 is emotional copy. The page does explain the workflows further down, but its most prominent text does not clearly name a topographic map generator or SVG export.

Suggested starting copy, subject to product review:

- **Title:** `Free Topographic Map Generator for Laser Cutting | TopoStack`
- **H1:** `Turn real terrain into laser-cut topographic maps`
- **Description:** `Create layered terrain maps and flat topographic engravings from real elevation data. Customize your design and export SVG files free in your browser.`
- **Supporting text:** `Free to use. No account required. Export SVG files for layered reliefs or flat engraving.`

The current app has no account gate, and the homepage states that donations are optional for every export. Keep the expressive brand copy as supporting text. Add visible, concise answers about file types, physical dimensions, material thickness, fresh generation before export and browser storage. Google recommends using searchers' language in [prominent page content](https://developers.google.com/search/docs/essentials).

**Acceptance:** Initial HTML contains the updated title, description and one descriptive H1; the explanation and CTA remain usable without JavaScript. Update the existing literal-heading assertions in [landing tests](../../e2e/landing.spec.ts).

### 5. Publish practical pages and examples for the two workflows

**Priority 2 · High growth opportunity · Several content/design sessions.**

There are only three source routes: homepage, studio and an about redirect. Homepage internal links lead to anchors or the studio. The README and fabrication docs contain useful information that is not available as dedicated pages on the product domain.

The following are **keyword hypotheses**, not measured search-volume or ranking claims. Validate and refine them with Search Console once data accumulates.

| Proposed destination | Search intent | Distinct useful content |
| --- | --- | --- |
| `/` | Topographic map generator; laser-cut terrain SVG | Explain the tool, outputs, price and first action |
| `/guides/laser-cut-topographic-map` | How to make a layered topographic map | Real worked example, sheet thickness, layer count, cut/score/engrave, assembly |
| `/guides/topographic-map-engraving` | Contour map SVG for laser engraving | Flat workflow, contour density, index lines, physical size and sample export |
| `/examples/crater-lake` | Crater Lake topographic map project | Actual generated artwork, project settings, terrain limitations and reproducible steps |
| A tested software-import guide | Import topographic SVG into a named laser application | Screenshots, scale verification, operation assignment and known limitations |

Start with the two workflow guides and one excellent example. Link to them from relevant homepage sections, add breadcrumbs, and link each to the studio. Give each a unique title, description and canonical, and include it in the sitemap. Add preset-aware studio links only when the app actually supports them.

Use real exported artwork and genuine fabrication photographs when available. The homepage currently has decorative inline SVG illustrations and no `<img>` elements; the existing [studio screenshot](../images/studio-crater-lake.png) is shown in the README, not on the landing page. A screenshot can explain the product now; label it as a preview. Future photos should document actual results. Use descriptive alt text, dimensions and compressed responsive assets. See Google's [image guidance](https://developers.google.com/search/docs/appearance/google-images).

A spot check of relevant searches surfaced other tools with explicit generator pages, including [Maperivo](https://www.maperivo.com/map-generator) and [LayeredMaps](https://layeredmaps.app/). This supports testing specific maker-oriented pages; it does not establish their traffic or relative Google positions. Avoid mass-producing near-identical place pages and unverified compatibility claims.

### 6. Add reliable sharing metadata and decide the studio's indexing role

**Priority 2 · Medium discovery impact · Approximately half a day to a day.**

Add initial-HTML `og:title`, `og:description`, `og:url`, `og:type`, `og:image`, image alt text, and a Twitter large-image card. Use an absolute, publicly fetchable image URL, ideally showing actual output and the product name. A 1200×630 card is a practical starting asset. Test the fetched HTML and preview image response.

[Studio configuration](../../apps/generator/src/routes/studio/+page.ts) disables SSR, so its [Svelte head](../../apps/generator/src/routes/studio/+page.svelte), lines 25–28, appears only after client execution. Metadata added only to that component will still be missing from the initial response. Google's renderer can execute JavaScript, but many link-preview consumers do not; see [JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

Recommended default: keep the editor client-rendered, give it an intentional initial-HTML `noindex` policy, and use the homepage/guides as search entry points. If direct studio ranking is desired instead, prerender a useful descriptive shell and metadata, loading the browser-only editor after mount. Do not simply turn SSR on around browser-dependent code. Do not canonicalize the distinct studio page to the homepage just to hide it.

Add factual `WebSite`, `Organization` and `SoftwareApplication`/`WebApplication` JSON-LD where appropriate. Match visible content; do not invent ratings or reviews. Schema is an entity-description improvement, not a ranking guarantee or a promise of rich results.

### 7. Finish repository and platform discovery surfaces

**Priority 2 · Medium acquisition/trust impact · Under an hour for metadata; licensing needs owner choice.**

The public [GitHub repository](https://github.com/Echo-Foxtrot-Works/topostack) has no API-reported description, homepage or topics. Suggested settings:

- **Description:** `Browser-based topographic map generator for laser cutting and engraving. Create layered terrain reliefs and export SVG files from real elevation data.`
- **Website:** `https://topostack.echofoxtrot.works/`
- **Topics:** `topographic-maps`, `laser-cutting`, `laser-engraving`, `svg`, `terrain`, `digital-fabrication`, `svelte`
- **Social preview:** Use the same recognizable product artwork as the website sharing card.

The homepage calls the project open source, but [README license status](../../README.md), lines 223–225, explicitly says no project LICENSE exists. Select an appropriate project license and align the public wording; this is a contributor/adoption clarity gap. This audit does not select a license for the owner.

The [Atomm listing](../../atomm/listing.md), lines 4–5, emphasizes layered terrain and understates flat engraving. Update the listing copy and cover description to reflect both supported workflows; confirm the actual published listing matches. The immutable generator slug should remain unchanged.

After publishing the guides, share a real finished project, reproducible steps and the relevant guide with maker communities and potential tutorial creators. Measure visits and completed exports from those sources. No outreach or external edits were performed during this audit.

### 8. Replace the legacy about refresh with an HTTP redirect

**Priority 2 · Low/medium technical impact · Small change.**

Add a static `_redirects` entry such as `/about / 308`, covering normalized variants as needed. Cloudflare supports this in [Workers static redirects](https://developers.cloudflare.com/workers/static-assets/redirects/). The current immediate refresh can be understood by Google; this is cleanup, not evidence of a total indexing failure.

**Acceptance:** An unfollowed request returns a permanent HTTP redirect with `Location: /`, and the destination returns 200. The existing browser test only checks arrival at `/`, so it does not validate the response status.

## AI and assistant discoverability

Readable pages with direct answers, stable URLs, real examples and accurate metadata also make the product easier for assistants to describe and cite. Add a concise feature/output summary and links to documentation and the repository.

Lighthouse reported an agentic-browsing score of 67 because `/llms.txt` was treated as an invalid file under the same homepage fallback. Fix unknown-path behavior first. A maintained llms.txt can be an optional documentation convenience; it is not an access-control mechanism or a prerequisite for ranking. Google explicitly says its AI search features require [no special AI text file or schema](https://developers.google.com/search/docs/appearance/ai-features).

## Delivery sequence and measurement

1. **First implementation batch:** correct 404/robots/sitemap behavior; establish canonical and development indexing policy; repair intended analytics; update homepage positioning; fill GitHub metadata.
2. **Next batch:** publish the two workflow guides and Crater Lake example; add social metadata and truthful structured data; implement the chosen studio indexing policy and HTTP about redirect.
3. **Following 30 days:** inspect indexing and queries weekly, distribute the real example, and improve pages based on observed search terms and where users abandon generation/export. Expand content only when it answers a distinct maker need.

Track a baseline and changes in: indexed production pages, non-brand impressions and clicks by landing page, search click-through rate, studio-start rate, real-generation success rate, and completed-fabrication-export rate. Segment by acquisition source and device. Establish numeric growth targets after measurement works; no defensible traffic forecast is available from this audit alone.

### Regression checks for implementation

- Parse built HTML for expected titles, descriptions, canonicals, sharing tags and intended indexing directives.
- Validate robots and sitemap content/types and sitemap destinations.
- Verify deployed HTTP 404 and redirect statuses; Vite-only tests cannot cover Cloudflare routing.
- Assert production remains indexable while development is excluded.
- Exercise direct studio entry, homepage-to-studio navigation, restored settings and Atomm packaging after rendering/routing changes.
- Confirm actual analytics script/beacon requests succeed under production CSP. Local HTML tests do not reproduce Cloudflare-injected scripts.
- Run existing lint, typecheck, build/budget and relevant browser tests for subsequent code changes.

For this audit, validation consisted of source/configuration inspection, raw HTTP checks, rendered browser inspection, one mobile Lighthouse run, one desktop performance trace, and the public GitHub metadata API. The application test suite was not rerun because no executable code changed. Actual search-engine index status, backlink profile, production deployment revision, published Atomm settings and real-user conversion data remain unverified.
