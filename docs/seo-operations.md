# Search and discovery operations

## Build and hosting policy

Set `VITE_SITE_ENV=production` **only** for the production custom-domain build.
Pass it in the shell or CI build environment, rather than an application .env file.
Omitting it defaults to non-indexable development behavior. Other accepted
values are `development` and `atomm`; unknown values fail the build.
CI sets the value explicitly per deployment and verifies generated metadata.

- Homepage, both guides, Crater Lake example and privacy page: indexable in production.
- Studio: prerendered metadata/loading shell, client-loaded editor, always noindex.
- Development and Atomm artifacts: noindex in HTML and static response headers.
- Sitemap: production pages only; non-production builds emit an empty index and
  empty child sitemaps. See [Sitemaps](#sitemaps).
- Sitemap `lastmod` comes from each page's recorded `updated` date in `PUBLIC_PAGES`.
- `www.topostack.app` has no Worker route; a zone redirect rule sends it to the apex.
- Workers.dev and preview URLs are disabled in Wrangler; custom domains remain.
- Unknown URLs return a real 404. About URLs use permanent HTTP redirects on Workers.
- The portable About refresh remains in static output for hosts that ignore _redirects.

Validate an artifact and the actual Worker response behavior:

```sh
VITE_SITE_ENV=production npm run build -w @topostack/generator
node scripts/verify/verify-seo.mjs --environment production
node scripts/verify/verify-seo-http.mjs https://topostack.app production
```

The HTTP check is also called by the deployment verifier. Use the development
origin and `development` argument when checking that environment. Recheck both
after any indexing or hosting change. Keep new public pages in `PUBLIC_PAGES`
and the fixed usage landing list (`seo.test.ts` fails if a registered page is
missing from `USAGE_LANDINGS`); update verification expectations too.

Head metadata is resolved by `pageSeo()` in the root `+layout.server.ts` at
prerender time and read by `Seo.svelte` from page data. The registry therefore
does not ship in the homepage bundle; adding a page no longer costs homepage
JavaScript. Client components that need site constants import `$lib/site/site`,
not `$lib/site/seo`.

## Sitemaps

`/sitemap.xml` is a sitemap index; robots.txt names only it. It points at two
prerendered child sitemaps, built by `apps/generator/src/lib/site/sitemap.server.ts`:

| Sitemap | Lists | Entries from |
| --- | --- | --- |
| `/sitemap-pages.xml` | Every registered page in `PUBLIC_PAGES` (including the `/lakes` hub) and every published example | `pageSitemapEntries()` |
| `/sitemap-lakes.xml` | Every generated lake page (`/lakes/<region>…`, later `/lake/<slug>`) | `lakeSitemapEntries()` |

The split exists so Search Console reports submitted and indexed counts per
sitemap. Each index entry's `lastmod` is the newest content date in that child.
A new generated lake route adds its entries to `lakeSitemapEntries()` and marks
its pages `lake: true` in `scripts/verify/seo-pages.mjs`; `verify-seo.mjs`
fails when a page sits in the wrong child sitemap. Each child sitemap must stay
under the protocol limits (50,000 URLs, 50 MB uncompressed). The build
verifier checks every page; the HTTP verifier checks a fixed, evenly spaced
sample of 20 lake pages (`samplePaths()`) so deploy checks stay fast.

`llms.txt` lists the registered pages, examples and `/lakes/*` region pages,
and links `/sitemap-lakes.xml` for the complete lake list; individual `/lake/`
pages are deliberately not listed there.

## Page dates and sharing cards

Every entry in `PUBLIC_PAGES` records `published` and `updated` ISO dates. They
feed three places at once: sitemap `lastmod`, the `TechArticle` JSON-LD on
guides and examples, and the `article:*` Open Graph tags. Build dates are
deliberately not used; a `lastmod` that moves on every deploy teaches search
engines to ignore the field.

**Bump `updated` when a page's substance changes** — new or rewritten guidance,
a changed procedure, corrected facts. Leave it alone for styling, typography,
link housekeeping and refactors. `scripts/verify/verify-seo.mjs` asserts that the
sitemap and the article markup both match the recorded dates, that no date is
in the future, and that hubs and policy pages carry no article metadata.

Guides and worked examples (`/guides/*`, `/examples/*`) are treated as articles.
The homepage, the guides hub and the policy pages are not, so they do not claim
an authorship and publication date.

A page may override the default sharing card with its own `image`, giving the
URL, real pixel dimensions and alt text. The dimensions are asserted against the
tags and the file is fetched over HTTP by the deployment verifier, so a card
that 404s or is mislabelled fails the deploy rather than rendering as a blank
preview wherever the page is shared.

Every guide, the `/guides`, `/lakes` and `/examples` hubs, and each lake region
have their own card, so a link shared on a forum, in chat or on social media
shows what that page is about. The homepage, `/examples/crater-lake`, the
changelog and the policy pages keep the default Crater Lake card
(`social-crater-lake.png`); examples use the card their capture writes.

- Guide and hub cards are declared with `socialCard(name, alt)` in `seo.ts`;
  `name` is the path without its leading slash, `/` replaced by `-`, and the
  file is `static/images/cards/<name>.jpg`. Lake pages use
  `lakeRegionCard(slug)`, shared by the region's county, state and letter-range
  pages.
- `scripts/dev/capture-social-cards.mjs` draws them (1200×630 JPEG, quality 85,
  about 40–110 kB each) with Playwright from local HTML: no dev server or map
  API. Guide and hub cards reuse pictures already in the repository (studio
  screenshots, example renders, the Atomm Tips crops and the depth-chart guide
  captures), cropped but not retouched, with a credit line. Region cards plot
  each lake in the directory as a dot. The card title and line of text are
  written for a feed in the script's `PAGE_CARDS` and `REGION_CARDS`; they are
  shorter than the page titles.
- The script refuses a declared card it has no recipe for, and a recipe whose
  page declares no card. `seo.test.ts` checks that each card file exists at
  1200×630 and under 150 kB, that no two pages share one, and that
  `static/images/cards/` holds no stray files.
- Re-run the script after changing a card's page text, its source picture or
  the lake regions, look at the output, and commit the JPEGs:
  `node scripts/dev/capture-social-cards.mjs [name ...]`. The Atomm build drops
  `images/cards/` with the other site-only images.

## Generated lake depth pages

`/lakes` (registered in `PUBLIC_PAGES`) indexes one page per lake region,
generated at build time from `static/data/lake-depth-directory.json` by
`buildLakePages()` in `apps/generator/src/lib/site/lake-pages.ts`:

- Minnesota is split into county pages (counties with at least 8 lakes; the
  rest are listed on the Minnesota page). Ontario, Finland and Norway are split
  into consecutive initial-letter ranges of at most 400 lakes.
- Every lake appears on exactly one page (`lake-pages.test.ts`). A new directory
  source must be assigned to a region in `LAKE_REGIONS`, or the build fails.
  A new region also needs a card in `capture-social-cards.mjs` (see above).
- Letter-range slugs follow the data, so a large directory change can move a
  lake to a different range URL. Check the sitemap diff after data releases.
- Lake pages set `csr = false`: they are plain HTML with no hydration script,
  so they share the site CSP instead of adding `_headers` rules (Cloudflare
  allows 100). `finalizeStaticHeaders` skips pages whose scripts the fallback
  policy already covers, and JSON-LD is not hashed.
- Metadata comes from `lakePageSeo()`; the sitemap, `llms.txt` and both SEO
  verifiers include the generated pages. Lake pages run no script, so they
  send no `landing_view`; when a visitor opens the studio from one, the session
  takes its landing from the same-site referrer and reports `/lakes` (as do
  per-lake `/lake/*` pages).

### One page per lake

Each page opens with a locator map, drawn at build time as inline SVG (no
script) by `buildLocator()` in `lake-locator.ts` and `LakeLocator.svelte`. It
shows at least 400 km, or three times the survey area, around the lake, with
Natural Earth 1:50m land, lakes and borders. The survey area appears as a box, or
as a marker when the box would be too small to see. Other directory lakes show as
dots, thinned to one per 5-unit cell. The map is about 8 KB at the median and
14 KB at the 95th percentile; the four Great Lakes pages reach about 38 KB.
`apps/generator/src/lib/site/locator-data.json` (370 KB, server-only) is built
by `node scripts/build/build-locator-data.mjs` from Natural Earth v5.1.2. Run it
again when the lake directory reaches a new area, because features outside every
lake's map window are dropped.

**Depth previews (not published yet).** `node scripts/dev/render-lake-previews.mjs --sample` renders a top-down depth map for each lake page:
- **Data:** the studio's own terrain and survey data from the map API, via `loadTerrain`, `smoothLakeShorelines` and `carveWaterDepth` at true depth.
- **Image:** shaded land, the lake floor tinted by depth, contours at a round interval, and a hatch over modelled depths. `apps/generator/src/lib/site/lake-preview/render.ts` draws it.
- **Scale:** colours, contours and the reported maximum come from the previewed lake's own cells, at the 99.5th-percentile depth. Other water in frame cannot set them.
- **Refusals:** a lake is not saved when its outline is missing or its survey is unavailable. Whole-Great-Lake frames currently exceed the lake and vector loaders, the same limit the studio hits, so the six Great Lakes wait for that fix.
- **Frame shape:** the frame is the lake's studio framing, widened along its short side to at most 2:1, so long, narrow lakes such as Champlain show more of their valley instead of becoming a thin strip.
- **Speed and size:** about 10 s and 25–80 KB per lake.
- **Next step:** publishing them (R2, a Worker route and the page image) is a separate change.

Named lakes with a surveyed grid, or with contours covering at least
`PLACE_PAGE_MIN_KM2` (5 km²) of survey area, also get a page of their own at
`/lake/<slug>` (`buildLakePlaces()` in `lake-places.ts`, rendered by
`LakePlaceView.svelte`). That was 2,728 lakes in September 2026. Map references,
unnamed records, "Part of" fragments and Finnish records tagged with an N60 datum
level stay list-only. Each page shows survey facts, piece sizes and scales at
three widths, six nearby lakes and an **Open in the studio** link. The JSON-LD
has a `LakeBodyOfWater` with its survey box. The region list that names a lake
links to its page, with a small **studio** link beside it. The featured lakes on `/lakes` link to their pages too, and the in-browser search at `/guides/lake-depth-data` adds a **Lake page** link from `/data/lake-pages.json` (lake id → slug, prerendered from the same lock, about 35 KB gzipped, fetched only by that page).

- Slugs are locked in `apps/generator/src/lib/site/lake-slugs.json`, keyed by
  source (without its version suffix) and survey id. After a lake directory
  change, run `node scripts/build/lock-lake-slugs.mjs`; it only appends.
  `lake-places.test.ts` fails until it has run. Colliding new slugs get the
  survey id appended.
- The pages carry their region's sharing card and are plain HTML (`csr = false`).
  A production build takes about 45 s and adds about 19 KB per page. `dist`
  holds about 5,900 files, well inside the Workers static-asset limit.
- The pages repeat one template, so watch the indexed count for the lakes
  sitemap in Search Console. If Google reports most of them as "Crawled –
  currently not indexed", raise the threshold rather than adding more. Lower it
  (about 5,300 lakes at 1 km²) only once indexing is healthy.

## Example projects

### First-project paths and related content

The homepage's three starters use `/studio?starter=relief`, `engraving` or `lake`. Descriptions live in `site/starters.ts`; settings are built lazily by `studio/starter-project.ts` from a fresh default project, never from saved machine settings. Startup restores a saved design first and opens the starter as an undoable change. Shared designs take precedence. The starter query is consumed so reloads retain edits; the first-visit checklist waits for an explicit Generate after size/material review. Fabrication exports still require current real terrain.

`Article.svelte` renders curated next actions from `site/related-content.ts` on relevant guides, examples and generated lake pages. They are ordinary anchors, including on pages without JavaScript. Keep destinations published and descriptions specific; `related-content.test.ts` checks them. The LightBurn workflow is registered in metadata, guide navigation, usage landings and the sharing-card capture recipe.

The export dialog's preview PNG is generated locally from the existing `StackTopView` or `EngravingPreview`, with its CSS resolved into standalone SVG before rasterization. The card labels it as a software preview and includes the geometry's source names/licenses and the attribution page. This lazy workflow uploads nothing and emits `share_preview_prepared`, independently of fabrication exports. Publish the compatible Worker event contract before or with the browser build.

`/examples` lists worked projects; each page under `/examples/<slug>` comes from
`ALL_EXAMPLES` in `apps/generator/src/lib/site/examples.ts` (Crater Lake keeps
its own route). Pages never state numbers by hand: layer count, elevation range
and model height come from `static/examples/<slug>.json`, which
`scripts/dev/capture-examples.mjs` writes after generating the project in the
real studio. The same file is the download and what **Open in studio** loads:
`/studio?example=<slug>` makes the studio fetch `examples/<slug>.json`, open it
as an undoable change on top of the saved project, drop the parameter from the
address bar and generate terrain (`startup-restore.ts`). Crater Lake has no file
and opens the studio's starting project. The link is used instead of a `#p=`
share link so the committed file stays the only copy of each example and
`share_link_opened` counts only designs people shared. `verify-seo.mjs` fails a
build whose pages link to an example with no published project file.

- To add or change an example, edit its entry and re-run the capture for that
  slug. `examples.test.ts` fails when the committed project file no longer
  matches the entry, or when a render, card or capture is missing.
- An entry with `draft` set is captured on request but gets no page. Lake Tahoe
  is a draft until its survey stops rendering with east–west bands.
- Sharing cards are 1200×630 JPEGs; renders are WebP at capture size plus an
  800 px variant.

## Non-goals

`FAQPage` and `HowTo` structured data are intentionally absent. Google removed
HowTo rich results in 2023 and FAQ rich results on May 7, 2026; both remain
valid schema.org types but produce no search appearance for a site like this
one. Adding them would duplicate page copy into metadata that has to be kept in
sync, for no measurable return.

## Crawler access monitoring

`scripts/verify/verify-worker-deployment.mjs` runs after every deploy and hourly from
`production-monitor.yml`. It requests the homepage as GPTBot, ClaudeBot and
PerplexityBot and asserts the prerendered HTML comes back, then asserts that
robots.txt is still a permissive plain-text file with no `Disallow`.

Cloudflare's AI scraper blocking, Bot Fight Mode and WAF rules are dashboard
settings that no repository check would otherwise notice; a site can stop being
readable by assistants without any deploy, test or error. Googlebot is
deliberately not spoofed: Cloudflare verifies it by reverse DNS, so a request
from a CI runner is judged an impostor and proves nothing either way. Search
Console's URL Inspection remains the authority on Googlebot access.

## Usage measurement

The existing Cloudflare Web Analytics beacon is now permitted by CSP. It remains
configured in Cloudflare; no beacon token is embedded in this repository.

The website also POSTs fixed-category events to `/v1/events`. The Worker logs
validated events as JSON with `message: "usage_event"` and its environment.
The endpoint requires same-origin JSON, limits bodies to 1,024 bytes, rejects
unknown fields/values and uses the existing per-client rate limiter.

Filter Workers Logs for `usage_event` and production, then group by `event`,
`landing`, `source`, `campaign`, `medium`, `device`, `output` and `delivery`. No new database,
third-party analytics subscription or user identifier is required.

Events:

| Event | Meaning |
| --- | --- |
| landing_view | First public content page in a tab session |
| studio_open | First studio entry in that tab session |
| generation_started | User starts explicit terrain generation |
| generation_succeeded | Current real-data geometry passes the fabrication export gate |
| generation_failed | Request failed or resulting data cannot be fabricated |
| generation_cancelled | Generation was aborted or superseded |
| export_prepared | Fabrication files handed to the browser download action or Atomm SDK |
| export_failed | Fabrication export was blocked or preparation failed |
| share_link_copied | A design share link was copied to the clipboard |
| share_link_opened | A valid share link opened a design in the studio |
| share_link_shared | A design share link was sent through the system share sheet |

Settings-only and assembly-only downloads are excluded from successful
fabrication counts. Sample previews and automatically updated geometry do not
count as successful generation. Browser save completion and physical fabrication
cannot be observed; `export_prepared` is a handoff measure, not proof that a user
saved a file or made an object.

Attribution is a fixed category derived from an allowlisted `utm_source` or the
referrer host. Assistant and answer-engine referrers are grouped as `ai` and
are matched before the search engines, because `gemini.google.com` is a Google
host whose visitors did not come from a search result page. Unknown values
become `other`. Links we publish (README, launch posts, creator walkthroughs)
can also carry `utm_campaign` (`launch`, `readme`, `newsletter`, `creator`,
`atomm`) and `utm_medium` (`social`, `forum`, `email`, `video`, `referral`);
unlisted values become `other` and absent ones `none`, so free text is never
sent. Events from tabs loaded before that change carry neither field. Fixed
`channel` values from `utm_content` or recognized referrer hosts are
recorded by the week 1 attribution release. Channels distinguish forums,
social venues and numbered creator slots while broad sources stay comparable.
The channel is independently optional in the Worker contract, preserving old
open tabs. Unknown tags become `other`; absent/unrecoverable channels are `none`.
Static lake entry tags can be recovered from the same-origin referrer when
the studio starts the session. No arbitrary referrer path is collected. See
[the launch link scheme](launch/README.md#link-scheme) for values and examples.
Only those categories and the public landing path are kept in tab session storage, with entry deduplication flags and
a 30-minute inactivity expiry. No coordinates, project names, raw query strings,
custom data or stable user IDs are sent. Collection honors DNT and GPC and is
best effort. It runs only on the production host (or the explicit E2E test build).

Metrics are aggregate event counts, not exact unique-user/cohort funnels.
Blocked requests, retries, spoofed public events and disabled browser storage
can affect counts. Cloudflare's operational logs retain their own request
metadata independently. Workers Logs retention depends on the account plan;
export aggregates regularly if a longer baseline is needed.

Recommended weekly measures: non-brand search impressions/clicks by landing
page, studio entries, generation success/attempts, and prepared fabrication
exports, segmented by output and acquisition source, and by campaign and
medium while a launch is running. Use Search Console for
search traffic and Cloudflare Web Analytics for visit/device context.
The [growth measurement runbook](launch/measurement.md) and
`scripts/verify/growth-baseline.mjs` capture aggregate Cloudflare baselines,
including sampling and availability. Segment new events by `channel` as well.
Sampled provider counts are estimates; do not treat missing groups as proof of
zero usage or event ratios as a unique-user conversion funnel.

## Account steps after publishing

1. Open the existing Search Console property, or verify ownership of the production
   domain. DNS verification requires a token from that account; it is not inferable
   from the codebase. Submit the index, `https://topostack.app/sitemap.xml`;
   Search Console then reads both child sitemaps. Under Sitemaps, watch the
   indexed count of each child separately. `sitemap-lakes.xml` is the
   thin-content early warning: if its indexed share stalls or falls while
   `sitemap-pages.xml` holds steady, Google is judging the generated lake pages
   too thin to index, and they need more distinct content before more are added.
2. Inspect the homepage and new guides, their selected canonicals and index status.
   Check Cloudflare security events if the inspection fetch is blocked.
3. Verify/submit the sitemap in Bing Webmaster Tools. Import from Search Console
   rather than re-verifying by hand, and enable IndexNow (Cloudflare's Crawler
   Hints covers the whole zone without application changes).
4. After a domain move, verify the previous domain as its own property and run
   Search Console's Change of Address against it. The legacy 301s must stay in
   place for at least a year; they are configured by
   `scripts/build/configure-redirects.mjs`, which also manages the `www` alias.
5. Confirm the Cloudflare beacon script and collection request succeed in a fresh
   browser session on the deployed site.
6. Update the published Atomm listing from `atomm/listing.md`. The immutable slug
   is `topostack`.
7. The GitHub description, topics and website field (`https://topostack.app`)
   are set. The repository's custom social preview can be uploaded through repository settings using
   the existing studio screenshot. The site itself already references that image.

The MIT license applies to project software. Source-data and dependency licenses
remain separate; preserve export attribution. Publish real project photos and
tested laser-software import walkthroughs as evidence becomes available.

## Implementation verification — September 15, 2026

- Production, development and Atomm builds passed generated SEO validation.
- Production and development response checks passed under the local Cloudflare
  runtime, including redirects, 404s, content types and indexing/security headers.
- The Atomm ZIP built and passed the full embedded-endpoint/package scan.
- Local mobile Lighthouse: SEO, accessibility, best practices and agentic browsing
  all scored 100. These are local checks, not a claim about the deployed site.
- Unit/component suites passed; 33 affected browser cases passed across Chromium,
  Firefox and WebKit, including generation-to-export events and mobile guide navigation.
- Worker coverage met all existing thresholds. Lint, type checks, the full build
  and bundle budgets passed.
- The homepage JavaScript allowance increased from 50 to 52 kB gzip for metadata
  and attribution; observed initial homepage JavaScript was 50,701 bytes gzip.
  Existing editor-startup and total-asset limits remain enforced.

Website changes have not been deployed by this task. GitHub description, website
and topic updates were applied and read back successfully. Concurrent terrain and
bathymetry work in the shared checkout was preserved.
