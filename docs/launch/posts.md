# Post drafts

Ready-to-paste drafts, one per channel. Before posting:

- Re-read the venue's rules ([channels.md](channels.md) says which were verified) and adjust.
- Keep the render disclosure. If a real build exists by then, swap in its photo and change that sentence. Otherwise leave it as it is.
- Re-check any number against the repository on the day. The lake count comes from `apps/generator/static/data/lake-depth-directory.json` (8,147 on 2026-09-24).
- Copy links exactly. The UTM values are fixed allowlists ([README.md](README.md#link-scheme)).
- Pick one image from [media.md](media.md) and use the caption given there.

Voice: first person and plain, like one maker talking to others. No hype words ("revolutionary", "game-changing"), no emoji strings, no requests for upvotes.

---

## r/lasercutting (and r/lasercut if it is active)

**Title**

> I made a free browser tool that turns any place into layered topo map SVGs. Looking for feedback from people who cut them

**Body**

> Disclosure: I built this. It's free, open source (MIT) and needs no account: TopoStack, https://topostack.app/guides/laser-cut-topographic-map?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-lasercutting
>
> You pick a place, set the physical size, material thickness and vertical exaggeration, and it generates the files for a layered relief (or a single flat engraving) from real elevation and OpenStreetMap data:
>
> - one SVG per layer at physical size in millimetres, with cuts in red and score/engrave lines in blue, in named groups, plus a kerf setting
> - it works out the sheet count from the terrain, scale, exaggeration and thickness
> - maps bigger than your bed are split into pieces with staggered puzzle-tab seams, and each piece gets an engraved id (like `L03-B2`) where the next layer hides it
> - sheet nesting onto your stock size, run in the browser with the open-source sparrow solver
> - optional paper stencils for painting only the water that stays visible, and an assembly guide
> - lake floors from surveys or charts for more than 8,000 lakes (NOAA, USGS, Minnesota DNR, Ontario, Finland, Norway, swisstopo), with modelled depths elsewhere
> - roads, trails, labels, compass, scale bar, your own markers and GPX tracks, SVG logos
>
> To be upfront: the images are renders and screenshots from the studio. Community makers have shared physical builds; the images attached here are still software renders. I'd like to hear from people who actually cut these:
>
> 1. Does the SVG import at the right size, with the right operations, in your software (LightBurn, xTool Studio, the Glowforge app…)?
> 2. What thickness and exaggeration do you usually use, and does the layer count it suggests seem sensible?
> 3. What's missing from however you make these today?
>
> If you want something to try right away, there are six example projects you can import: https://topostack.app/examples?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-lasercutting
>
> It's a spare-time solo project, built with a lot of help from AI. Bugs go through the Feedback button or GitHub issues; submitting the prefilled issue requires a GitHub account.

**Image:** `atomm/assets/topostack-gallery-02-layers-v8.png` or the 6-second loop. See [media.md](media.md).

---

## r/xToolOfficial / xTool community

Use `utm_content=reddit-xtool` for the subreddit, or change it to `xtool-community` for the xTool community site.

(Confirm the subreddit name and whether third-party generator posts are allowed.)

**Title**

> Free topo map generator on Atomm: layered terrain and lake-depth maps, nested for your material

**Body**

> Disclosure: I made this. TopoStack is a free generator on Atomm (https://www.atomm.com/creativetools/community/generator/topostack) and also runs as a website: https://topostack.app/guides/split-large-maps?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-xtool
>
> In Atomm it loads real terrain for wherever you frame the map, nests the layers onto your material size automatically, and **Open in Studio** sends one SVG with the whole layout. The website version adds a few things the embed leaves out, such as tracing your own lake depth chart.
>
> For smaller beds, the website can split a map larger than your work area into pieces with interlocking puzzle-tab seams. The seams move between layers so they don't stack, and each piece is engraved with an id where the layer above covers it.
>
> The pictures are screenshots and renders from the software, not photos of a cut piece. I'd really like to hear from anyone who runs one through their machine: whether the scoring and cutting look right in xTool Studio, what material thickness you used, and what went wrong.

**Image:** `atomm/assets/topostack-gallery-06-nesting-v8.png` or `atomm/assets/topostack-gallery-08-material-v8.png`.

---

## r/glowforge

**Title**

> Made a free tool for layered topo maps that splits big maps into Glowforge-sized pieces. Would love a real-world test

**Body**

> Disclosure: I built this. It's free and runs in the browser with no account: https://topostack.app/guides/split-large-maps?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-glowforge
>
> Pick a place anywhere, set the size and material thickness, and it generates cut and score SVGs for every layer from real elevation data. If the map is bigger than your bed, set your work area and it splits each layer into pieces with staggered puzzle-tab seams and engraved assembly ids.
>
> It can also cut a paper stencil for each layer so you can spray paint only the water that stays visible after gluing: https://topostack.app/guides/water-paint-templates?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-glowforge
>
> Honest caveats: the images are renders from the studio, not photos of a cut piece, and I haven't been able to confirm how the SVGs import in the Glowforge app. Cuts are red `#FE0002` and score/engrave lines are blue `#2366FF`, at physical size in millimetres. If you try one, I'd love to know whether the operations and scale come through correctly.

**Image:** `docs/images/splitting-paint-templates/02-split-cut-layer.png` with its caption.

---

## Glowforge community forum

(Check what the categories cover first. "Free Laser Designs" is for designs; a tool may belong elsewhere.)

**Title**

> Free browser tool for layered topographic maps, with splitting for the Glowforge bed and paint stencils

**Body**

> Hi all. I've been building a free, open-source tool called TopoStack and would value this forum's eye on it, since layered topo maps are a common laser project.
>
> It takes real elevation and map data for any place and produces layered cut files: one SVG per layer, at physical size, with cuts and score lines in separate colours. Maps larger than the bed are split into pieces with puzzle-tab seams. It can also produce paper stencils for painting the water, and an assembly guide.
>
> Guide: https://topostack.app/guides/split-large-maps?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=glowforge-forum
> Examples with project files: https://topostack.app/examples?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=glowforge-forum
>
> Everything pictured is a screenshot or render from the software. Community makers have shared physical builds; their photos need separate reuse permission. If anyone tries a small one, I'd be grateful to hear how the import went and what you'd change.

---

## LightBurn forum

An introduction already exists; adapt this into a useful update in [the existing thread](https://forum.lightburnsoftware.com/t/i-built-a-free-tool-for-creating-laser-cut-topographic-maps-looking-for-feedback/192506), rather than posting a duplicate introduction.

(Its guidelines send unclear-policy questions to the site feedback category. Ask there first if unsure where this fits.)

**Title**

> Looking for testers: layered topo map SVGs, and whether their structure imports cleanly in LightBurn

**Body**

> I maintain a free, open-source generator for layered topographic maps (TopoStack) and want to make sure its files behave well in LightBurn. Makers in the existing LightBurn thread have shared import feedback and a small physical build. I'd appreciate checks of the current release and more material/machine combinations.
>
> What the export does now:
> - SVGs in millimetres at physical size
> - cuts in `#FE0002`, score and engrave paths in `#2366FF`, in named operation groups
> - a kerf compensation setting
> - optional nested sheets (one SVG per sheet) or one panel per layer
>
> Details: https://topostack.app/guides/export-files?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=lightburn-forum
>
> Questions: do the colours land on sensible layers? Is the scale right on import? Would you rather have a different colour convention or file split? The pictures on the site are software renders, not photos.

---

## r/gis

**Title**

> I stitched NOAA survey grids, ENC chart contours and state/national lake surveys into a browser tool that cuts terrain into laser layers. Notes on the pipeline

**Body**

> Disclosure: this is my own open-source (MIT) project. Posting for the data side, and happy to be told where I got it wrong.
>
> TopoStack makes layered, laser-cut relief maps. The part this sub might find interesting is lake floors. The directory lists 8,147 lakes with survey or chart depth data (as of 2026-09-24), mostly Ontario (3,396), Minnesota (2,000) and Finland (1,821):
>
> - **NOAA National Bathymetric Source:** measured survey cells only (modelled fill dropped), averaged to 8 m and clipped to HydroLAKES; 237 US lakes and lagoons.
> - **NOAA ENC charts:** depth contours and soundings, most detailed chart first, linearly interpolated onto a 20 m grid inside the HydroLAKES outline with the shoreline at 0 m; 135 lakes with no survey grid (Okeechobee, Champlain, Seneca, Cayuga…). Depths are below chart datum.
> - **USGS grids** (Crater Lake and Tahoe multibeam, Mono Lake), **NOAA NCEI Great Lakes** grids, **swissBATHY3D** (bed elevations minus the HydroLAKES surface elevation, with no vertical datum transformation, so absolute depths are approximate).
> - **Contour sources** (Minnesota DNR, Ontario, Syke, NVE, TWDB, USBR): linear interpolation onto grids of 10 to 20 m, masked to the lake and, for most sources, to the measured contour hull.
> - Gaps fall back to HydroLAKES/GLOBathy modelled basins.
>
> Everything is served as PMTiles from R2 through a Cloudflare Worker that only streams and caches. The browser samples numeric PNG tiles, carves the lake into the DEM (Terrarium tiles on land), then traces contours at each layer elevation with d3-contour in Web Workers and plans the cut stack.
>
> There is also a tool for tracing a depth chart you have (an image or PDF): review and repair the contours, assign depths, align to known coordinates, then fill with a harmonic (Laplace) solve so the floor follows the slope the chart implies instead of terracing like a TIN.
>
> Write-up of the depth logic: https://topostack.app/guides/how-lake-depths-work?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-gis
> Lake directory by region: https://topostack.app/lakes?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-gis
> Code: https://github.com/Echo-Foxtrot-Works/topostack
>
> None of this is for navigation. I'd welcome pointers to open lake bathymetry I've missed (especially outside North America and the Nordics), and opinions on the datum handling.

**Image:** `atomm/assets/topostack-gallery-05-depth-v8.png` (lake-floor controls) or `apps/generator/static/images/examples/lake-tahoe.webp`.

---

## r/cartography

**Title**

> Generating contour layers for laser-cut relief maps in the browser: how I handle contour density, index lines and layer planning

**Body**

> Disclosure: my own free, open-source project, TopoStack. It turns elevation and OSM data into either stacked cut layers or a single flat contour engraving.
>
> For the flat engraving you choose the contour count and index interval, line widths per feature (contours, index contours, roads, trails, water, boundaries) and whether to add elevation labels, a lat/long grid, a compass and a scale bar. Output is one SVG at physical size:
> https://topostack.app/guides/topographic-map-engraving?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-cartography
>
> For layered relief, the layer count comes from relief, map scale, vertical exaggeration and material thickness. Roads and trails are clipped to the highest exposed layer so they stay continuous across contour steps. How the generation works: https://topostack.app/guides/how-terrain-generation-works?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=reddit-cartography
>
> The images are software renders. I'd value critique of the linework defaults from people who design maps for a living.

**Image:** `atomm/assets/topostack-gallery-04-flat-v8.png`.

---

## Show HN

An [ordinary Hacker News submission](https://news.ycombinator.com/item?id=49716578) already exists. This is an unposted Show HN draft; check prior activity and current guidelines before submitting it.

Post after per-lake pages ship. Put the URL in the link field and the text below as the first comment (or in the text field).

**Title** (72 characters, under HN's 80)

> Show HN: TopoStack – turn any place into laser-cut topographic map files

**URL**

> https://topostack.app/?utm_source=social&utm_medium=forum&utm_campaign=launch&utm_content=hacker-news

**Text / first comment**

> [Maintainer: one sentence, in your own words, on why you started it.] TopoStack is a browser studio for layered relief maps. You pick a place, set the physical size, material thickness and exaggeration, and get SVG cut files for a stacked relief (or a flat contour engraving). No account or signup; projects stay in IndexedDB, and share links carry the design, compressed, in the URL fragment.
>
> Some parts that might interest HN:
>
> - Geometry runs in the browser. The server is a Cloudflare Worker that only streams and caches source data: Terrarium elevation tiles, an OpenStreetMap PMTiles archive via Protomaps, and lake survey archives. Contour tracing (d3-contour), stack planning, label placement, road clipping across layers and SVG output happen in Web Workers.
> - Sheet nesting uses sparrow (Jeroen Gardeyn, KU Leuven), a Rust strip-packing solver, compiled unmodified to WebAssembly and run in a worker. It streams improving layouts and you can stop early. Every layout is checked independently before export.
> - Lake floors come from public bathymetry for more than 8,000 lakes: NOAA survey grids and nautical-chart contours, USGS multibeam, Minnesota DNR, Ontario, Finland, Norway, swisstopo. Modelled basins fill the gaps. You can also trace a paper depth chart yourself; the fill is a Laplace solve rather than a TIN.
> - Maps larger than your laser bed are split along a staggered seam grid with puzzle tabs and engraved assembly ids.
>
> Stack: Svelte 5/SvelteKit (prerendered), MapLibre, three.js, TypeScript geometry core, MIT licensed: https://github.com/Echo-Foxtrot-Works/topostack
>
> Two honest notes. It's a solo project built with a lot of help from AI coding tools; the repo is open, so judge the result. And the images are renders from the studio. Community makers have also shared physical builds; their photos require separate reuse permission.
>
> I'd like feedback on the output files, on where generation is slow for your area, and on data sources I've missed.

---

## Product Hunt

Launch last. Gallery images need cropping to 1270 × 760 ([media.md](media.md#product-hunt-gallery)).

**Name:** TopoStack

**Tagline** (≤ 60 characters; this one is 55)

> Turn any place into a laser-cut layered topographic map

Alternatives: "Real terrain and lake depths to laser-ready SVGs, free" (54), "Free layered topo maps for laser cutters, in your browser" (57).

**Link:** `https://topostack.app/?utm_source=other&utm_medium=referral&utm_campaign=launch&utm_content=product-hunt`

**Description** (≤ 500 characters; this one is 400)

> TopoStack turns real elevation and map data into files for layered, laser-cut relief maps or flat topographic engravings. Pick a place, set size and material thickness, and download millimetre-scaled SVGs with an assembly guide. It splits big maps to fit small beds, nests parts onto your sheets, and adds lake-floor depth for 8,000+ lakes. Free, no account, open source. Images are software renders.

**First comment**

> Hi Product Hunt, I'm the (solo, spare-time) maker.
>
> [Maintainer: one or two sentences, in your own words, on why you built it.] The workflow is: choose a place, set your material thickness, check the 3D preview, export the SVGs.
>
> A few things it does: splitting maps bigger than your laser bed into puzzle-tab pieces with engraved assembly ids, nesting parts onto your stock sheets in the browser (with the open-source sparrow solver compiled to WebAssembly), paper stencils for painting just the water, and surveyed lake floors for more than 8,000 lakes.
>
> Everything in the gallery is a render or screenshot from the app, not a photo of a finished piece. I'd love feedback from anyone who cuts one: what worked, what didn't, what's missing. It's MIT-licensed on GitHub (https://github.com/Echo-Foxtrot-Works/topostack), and I build it with a lot of help from AI.

---

## X / Bluesky / Mastodon

The link below is tagged for X. Change `utm_content=x` to `bluesky` or `mastodon` for those platforms.

The draft fits Bluesky's 300 and Mastodon's 500 characters with each platform's tagged link; it also fits X's limit with its link counting. Attach the 6-second loop (`atomm/assets/topostack-cover-loop-v8.mp4`) or `apps/generator/static/images/social-crater-lake.png`, with alt text.

> I built a free, open-source studio that turns any place into layered laser-cut topo map files: lake depths for 8,000+ lakes, splitting for small beds. No account. (Video is a software render.)
> https://topostack.app/?utm_source=social&utm_medium=social&utm_campaign=launch&utm_content=x

**Alt text:** "Software render of a layered Crater Lake relief model rotating and separating into its layers in the TopoStack studio."

Mastodon allows 500 characters, so add `#lasercutting #maps #opensource` there. On X, one hashtag at most.

---

## Facebook groups

Check the group rules first. Many prefer the link in a comment.

> I've been building a free tool for making layered topographic maps on a laser and would appreciate feedback from this group. Pick any place, set your size and material thickness, and it gives you SVG cut and score files for each layer, with splitting for small beds and an assembly guide. No account needed.
>
> The picture is a render from the software. The attached media shows a software preview. If you try it, I'd love to hear how the files worked in your software.
>
> https://topostack.app/guides/laser-cut-topographic-map?utm_source=social&utm_medium=social&utm_campaign=launch&utm_content=facebook
