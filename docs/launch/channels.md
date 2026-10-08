# Channels

Where to post, what each audience cares about, and which link to use. Drafts for each venue are in [posts.md](posts.md), and the UTM scheme is in [README.md](README.md#link-scheme).

## Current activity

The 2026-10-08 [activity reconciliation](activity.md) confirms the existing LightBurn introduction, community Reddit recommendations and physical-build posts. The previous channel table is guidance, not a list of venues still awaiting a first post. A maker reports a link-containing r/lasercutting post was removed. Re-read current rules before posting and use the four-part [link scheme](README.md#link-scheme) to distinguish venues.

## What was verified

Rules were researched on **2026-09-25** from this repository's tooling.

- **Verified from the source page:** Hacker News' [Show HN rules](https://news.ycombinator.com/showhn.html); Product Hunt's [launch preparation guide](https://www.producthunt.com/launch/preparing-for-launch); the [Glowforge community guidelines](https://community.glowforge.com/guidelines); the [LightBurn forum guidelines](https://forum.lightburnsoftware.com/guidelines).
- **Not verified: every subreddit.** reddit.com refused automated fetches and browser access from this environment, and web searches returned no rule text for these communities. That includes whether r/xToolOfficial, r/Lightburn and r/lasercut exist under those exact names. Where the table below says something about a subreddit, it is a hypothesis from general Reddit norms, marked *unverified*. **Read each subreddit's sidebar, rules and pinned posts before posting.** Look for: a self-promotion ratio (often "10%" or "no more than 1 in 10 posts"), a weekly or monthly promotion thread, required flair, "no links in the post body" rules, OC tags, and a minimum account age or karma.
- **Not verified: the xTool community site and the live Atomm listing.** Both render client-side, so the fetch saw only the site name. Open them in a browser to find the right category and confirm the listing is live under slug `topostack`.

## Venues

The "Link" column gives the page each post should lead with. Use the full UTM link from [posts.md](posts.md).

| Venue | Audience fit | Self-promotion rules | Best angle | Link |
| --- | --- | --- | --- | --- |
| **r/lasercutting** | High. Hobby and small-business laser owners; layered topo maps are a common laser project | *Unverified.* Expect a self-promotion limit and possibly required flair. A free, no-account tool with an honest "I made this, what's missing?" usually fits better than a product post. | "I made a free browser tool that turns any place into layered topo map SVGs": puzzle-tab splitting for small beds, sheet nesting, paint stencils. Ask what their current workflow is missing. | `/guides/laser-cut-topographic-map` |
| **r/xToolOfficial** (name unverified; r/xtool may be the active one) | High. xTool owners, often on small diode beds; TopoStack is also on Atomm, xTool's generator marketplace | *Unverified.* A brand-run or brand-adjacent sub may limit third-party promotion. Check whether Atomm generator posts are welcome. | "It's on Atomm too": Open in Studio sends one SVG with the whole nested layout. Splitting large maps into bed-sized pieces suits small diode beds. | `/guides/split-large-maps`, plus the Atomm listing |
| **r/glowforge** | High. Glowforge owners; bed size is a common constraint | *Unverified.* | Split large maps with puzzle tabs; water paint stencils cut from paper; SVG with separate cut and score colours. Ask someone to try an import in the Glowforge app, since it is untested. | `/guides/split-large-maps` or `/guides/water-paint-templates` |
| **r/Lightburn** (name unverified) | Medium-high. LightBurn users care about file structure | *Unverified.* It may be support-focused, so a "show" post could be off-topic. | Export structure: millimetre SVGs, red `#FE0002` cuts and blue `#2366FF` score/engrave in named groups, kerf compensation. Ask for current-release import reports; the existing LightBurn thread includes maker feedback and a small build (see activity.md). | `/guides/export-files` |
| **r/lasercut** (existence unverified) | Unknown. May be small or a duplicate of r/lasercutting | *Unverified.* | Same as r/lasercutting. Skip if inactive. | `/guides/laser-cut-topographic-map` |
| **r/gis** | Medium. GIS professionals and students; interested in the data, sceptical of hype | *Unverified.* Many technical subs remove low-effort promotion but accept "here's how I built X" posts with substance. | The data pipeline: NOAA NBS survey cells and ENC chart contours, USGS multibeam, Minnesota DNR, Syke, swisstopo, Ontario, NVE; gridding contours; HydroLAKES/GLOBathy gap fill; contours generated in the browser; depth-chart tracing with a Laplace fill. | `/guides/how-lake-depths-work`, `/lakes` |
| **r/MapPorn** | Low for a tool post | *Unverified.* The sub is for maps themselves; a software announcement is likely off-topic. Own maps are usually tagged `[OC]` with sources in a comment (check). | Only a striking single image with its sources, such as a real build photo later. Do not post renders as if they were a map artwork launch. | None in the post; sources in a comment if allowed |
| **r/cartography** | Medium. Cartographers, both hobby and professional | *Unverified.* | Contour generation and flat engraving: index contours, contour density, line widths for a laser, how terrain becomes cut layers in a Web Worker. | `/guides/topographic-map-engraving` or `/guides/how-terrain-generation-works` |
| **r/woodworking** | Medium audience, low fit until a real build exists | *Unverified; likely strict.* Expect a project-photo culture, and possibly rules against CNC/laser promotion or link-only posts. | Wait for a real build photo. Then post the build with build notes and mention the tool only if the rules allow. | Later |
| **Glowforge community forum** | High. Active and long-running | **Verified:** the guidelines have no explicit self-promotion section. They ask members to post only what they own, to be civil, and not to spam. The categories they mention are "Problems and Support", "Beyond the Manual" and "Free Laser Designs". | A free tool rather than a design pack. Check in the forum what "Beyond the Manual" covers and whether it or another category fits a third-party tool; "Free Laser Designs" suits an exported SVG set, not a tool announcement. | `/guides/split-large-maps` |
| **LightBurn forum** | Medium-high. Technical users | **Verified:** the guidelines have no explicit self-promotion section. They say "don't post spam" and send unclear-policy questions to the site feedback category. | Ask the community to check the export structure in LightBurn: layers from colours, millimetre scale. Frame it as a request for testers. | `/guides/export-files` |
| **xTool community / Atomm** | High. Atomm is where xTool users find generators | *Unverified:* the site content could not be read. | The Atomm listing (slug `topostack`): Open in Studio with automatic nesting. Share Atomm projects made with it once there are real builds. | Atomm listing (no UTM); posts use the forum link, and links inside the Atomm listing text use `utm_source=atomm&utm_medium=referral&utm_campaign=atomm&utm_content=atomm` |
| **Hacker News (Show HN)** | Medium-high for the technical story | **Verified:** the title starts with "Show HN"; it must be something people can try, ideally without signups; no landing pages or minor-version posts; don't ask friends to upvote or comment; the maker should take part in the thread. | Open source (MIT), SvelteKit plus sparrow compiled to WebAssembly, geometry computed in the browser, public bathymetry, a solo developer building with AI help. Per-lake routes are implemented. The original ordinary HN submission is verified in activity.md; check any separate Show HN history before considering a new post. | `https://topostack.app/?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=hacker-news` and the repository |
| **Product Hunt** | Medium. Broad and not maker-specific, but good for a one-time backlink and wider awareness | **Verified:** tagline up to 60 characters; description up to 500; recommended gallery images 1270 × 760 with at least 2; makers may post their own product; ask for feedback, not upvotes; the day runs on Pacific time. | Free, no account, real terrain and lake depths to laser files in the browser. Launch last, ideally with real build photos. | `https://topostack.app/?utm_source=other&utm_medium=referral&utm_campaign=launch&utm_content=product-hunt` |
| **Facebook groups** (laser engraving, xTool/Glowforge owner groups, woodworking) | Potentially high, but group-dependent | *General guidance only.* Most groups have admin-set rules; many ban links or allow promotion only on set days. Read the pinned post, and ask an admin first if in doubt. | Same as the maker subreddits. Lead with a picture (labelled as a render) and put the link in a comment if the group prefers that. | `/guides/laser-cut-topographic-map` with `utm_medium=social` |
| **YouTube / Instagram laser creators** | High reach | Outreach only. Do not post in their comments. | A walkthrough-ready project file and honest feedback; see [creator-pitch.md](creator-pitch.md). | `/examples` with `utm_campaign=creator` |
| **X / Bluesky / Mastodon** | Low to medium. Depends on who follows the maintainer | No platform restriction for your own account | A short post with one render or the 6-second loop | `/` or a guide, with `utm_medium=social` |

## Picking the guide for a thread

| If the thread is about | Link |
| --- | --- |
| Making a layered map at all | `/guides/laser-cut-topographic-map` |
| A small laser bed | `/guides/split-large-maps` |
| Flat engraving, contour art | `/guides/topographic-map-engraving` |
| Lake or depth maps | `/guides/custom-lake-depth-map` and `/lakes` |
| Painting water | `/guides/water-paint-templates` |
| File structure, colours, kerf | `/guides/export-files` |
| Something to try right away | `/examples` (six example projects with importable files) |
| How it works | `/guides/how-terrain-generation-works`, `/guides/how-lake-depths-work`, `/guides/how-depth-chart-tracing-works` |
| Personalising a piece | `/guides/custom-markers-and-paths`, `/guides/custom-graphics` |

All paths above exist as routes in `apps/generator/src/routes` and are registered in `apps/generator/src/lib/site/seo.ts`.
