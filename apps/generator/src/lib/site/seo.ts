// Constants live in site.ts so client components can import them without the
// registry. The explicit extension lets the Node verification scripts load this file.
import { DEFAULT_SOCIAL_IMAGE, DOCS_HOME, SITE_ORIGIN, socialCard, type SocialImage } from "./site.ts";
import latestRelease from "../../../../../changelog/latest.json" with { type: "json" };

export { DEFAULT_SOCIAL_IMAGE, DOCS_HOME, REPOSITORY_URL, SITE_ORIGIN, type SocialImage } from "./site.ts";

export interface PageMeta {
  title: string;
  description: string;
  label: string;
  /**
   * First publication and last *significant* content change, as ISO dates.
   * They drive sitemap `lastmod` and article timestamps, so bump `updated`
   * when the page's substance changes and leave it alone for typography,
   * styling or link housekeeping. A build date here would be a false signal.
   */
  published: string;
  updated: string;
  /**
   * The page's sharing card; pages without one share the default Crater Lake card.
   * `socialCard()` cards are drawn by scripts/dev/capture-social-cards.mjs.
   */
  image?: SocialImage;
}

const SPLIT_IMAGE: SocialImage = {
  url: "/images/guides/split-relief.webp",
  width: 1600,
  height: 1100,
  alt: "TopoStack studio showing a Crater Lake relief in the 3D stack view with a smaller work area set for splitting.",
};

const PAINT_IMAGE: SocialImage = {
  url: "/images/guides/paint-template-on.webp",
  width: 1600,
  height: 1100,
  alt: "Cut layers view of a Crater Lake layer with the paint template on: land is covered by a stencil and only the lake is open.",
};

const CHANGELOG_PUBLISHED = "2026-09-21";

export const PUBLIC_PAGES: Record<string, PageMeta> = {
  "/": {
    title: "Free Topographic Map Generator for Laser Cutting | TopoStack",
    description: "Create layered terrain maps and flat topographic engravings from real elevation data. Customize your design and export SVG files free in your browser.",
    label: "Home",
    published: "2026-08-19",
    updated: "2026-10-08",
  },
  "/guides": {
    title: "Topographic Map Guides and Documentation | TopoStack",
    description: "Guides for making layered and engraved topographic maps, understanding terrain generation, lake-depth data and export files, troubleshooting, and TopoStack's sources, credits and privacy.",
    label: "Guides",
    published: "2026-09-17",
    updated: "2026-09-17",
    image: socialCard("guides", "TopoStack guides card with an assembled Crater Lake relief rendered in the studio."),
  },
  "/guides/laser-cut-topographic-map": {
    title: "How to Make a Laser-Cut Topographic Map | TopoStack",
    description: "Make a layered terrain map from real elevation data. Choose material thickness, preview your stack, and export SVG cut panels with an assembly guide.",
    label: "Layered map guide",
    published: "2026-09-15",
    updated: "2026-09-18",
    image: socialCard("guides-laser-cut-topographic-map", "Laser-cut topographic map guide card with an exploded stack of Crater Lake layers rendered in the studio."),
  },
  "/guides/lightburn": {
    title: "Import Topographic Map SVGs into LightBurn | TopoStack",
    description: "Use TopoStack SVGs in LightBurn: check size, assign cut and marking layers, avoid duplicate engraving, apply kerf once, and preview the job.",
    label: "LightBurn workflow",
    published: "2026-10-08",
    updated: "2026-10-08",
    image: socialCard("guides-lightburn", "LightBurn workflow guide card showing TopoStack’s export dialog, not a LightBurn screenshot."),
  },
  "/guides/topographic-map-engraving": {
    title: "Create a Topographic Map SVG for Laser Engraving | TopoStack",
    description: "Create a flat contour map for laser engraving. Set contour density, add roads and water, and export a single SVG at your chosen physical size.",
    label: "Engraving guide",
    published: "2026-09-15",
    updated: "2026-09-17",
    image: socialCard("guides-topographic-map-engraving", "Topographic map engraving guide card with a flat Crater Lake contour engraving in the studio."),
  },
  "/guides/split-large-maps": {
    title: "Split a Large Laser-Cut Map to Fit Your Bed | TopoStack",
    description: "Build a layered topographic map bigger than your laser. Split each layer into bed-sized pieces with staggered seams, puzzle tabs and assembly ids.",
    label: "Split large maps",
    published: "2026-09-18",
    updated: "2026-09-18",
    image: SPLIT_IMAGE,
  },
  "/guides/water-paint-templates": {
    title: "Paint Lakes with Laser-Cut Stencils | TopoStack",
    description: "Cut a paper stencil for each layer of a topographic map and spray paint only the water that stays visible after the stack is glued.",
    label: "Water paint templates",
    published: "2026-09-18",
    updated: "2026-10-05",
    image: PAINT_IMAGE,
  },
  "/guides/lake-depth-data": {
    title: "Search Lakes with Surveyed Depth Data | TopoStack",
    description: "Search TopoStack's lake-depth catalog by name, region or source. Find surveyed grids and depth contours, then open a lake in the studio.",
    label: "Lake depth directory",
    published: "2026-09-15",
    updated: "2026-09-17",
    image: socialCard("guides-lake-depth-data", "Lake depth directory card with a map area selected around Crater Lake in the studio."),
  },
  "/guides/custom-lake-depth-map": {
    title: "How to Make a Custom Lake Depth Map from Wood | TopoStack",
    description: "Make a layered wooden lake map from surveyed depth data. Find your lake, frame the shoreline, set depth layers, paint the water and export SVG files.",
    label: "Custom lake depth map",
    published: "2026-09-21",
    updated: "2026-09-23",
    image: socialCard("guides-custom-lake-depth-map", "Custom lake depth map guide card with a layered Lake Tahoe relief showing the surveyed lake floor."),
  },
  "/lakes": {
    title: "Lake Depth Maps for Laser Cutting: Surveyed Lakes by Region | TopoStack",
    description: "Browse thousands of lakes with surveyed depth data in Minnesota, Ontario, Finland, Norway, Switzerland and the Great Lakes, and turn one into a layered wood lake map.",
    label: "Lake depth maps by region",
    published: "2026-09-21",
    updated: "2026-09-21",
    image: socialCard("lakes", "Lake depth maps card with a Crater Lake relief whose lake floor is cut as layers."),
  },
  "/guides/how-lake-depths-work": {
    title: "How Lake Depths Work: Surveys, Predictions and Layers | TopoStack",
    description: "Learn how TopoStack combines lake surveys, shoreline terrain and depth estimates, handles missing data, and turns lake floors into cut layers.",
    label: "How lake depths work",
    published: "2026-09-16",
    updated: "2026-09-23",
    image: socialCard("guides-how-lake-depths-work", "How lake depths work card with a Crater Lake relief showing the surveyed lake floor."),
  },
  "/guides/studio-tour": {
    title: "Studio Tour: Settings, Previews and Saving | TopoStack",
    description: "Find your way around the TopoStack studio: choose a place, frame the map, generate terrain, switch previews, and save or import projects.",
    label: "Studio tour",
    published: "2026-09-17",
    updated: "2026-09-23",
    image: socialCard("guides-studio-tour", "Studio tour card with the TopoStack studio showing a Crater Lake relief in the 3D stack view."),
  },
  "/guides/map-details": {
    title: "Map Details, Labels and Linework for Laser Maps | TopoStack",
    description: "Choose roads, trails, water fills and boundaries, place elevation labels and the north arrow, and set line widths for laser engraving.",
    label: "Map details and linework",
    published: "2026-09-17",
    updated: "2026-09-20",
    image: socialCard("guides-map-details", "Map details guide card with a Grand Canyon relief showing roads, trails, a river and elevation labels."),
  },
  "/guides/custom-data": {
    title: "Add Your Own Data to a Topographic Map | TopoStack",
    description: "Bring depth charts, markers, GPS tracks, boundaries and SVG graphics into a laser-cut topographic map, and learn how each is saved and shared.",
    label: "Custom data overview",
    published: "2026-09-23",
    updated: "2026-09-23",
    image: socialCard("guides-custom-data", "Custom data card with a traced lake depth chart beside its generated lake bed in the studio."),
  },
  "/guides/custom-markers-and-paths": {
    title: "Add Custom Markers and Trails to a Topographic Map | TopoStack",
    description: "Engrave your own summit markers, hiking routes and boundaries on a topographic map. Import a GPX, KML or GeoJSON file, or enter coordinates.",
    label: "Custom markers and paths",
    published: "2026-09-17",
    updated: "2026-09-23",
    image: socialCard("guides-custom-markers-and-paths", "Custom markers and paths card with the studio's marker settings beside a Crater Lake relief."),
  },
  "/guides/custom-graphics": {
    title: "Add a Logo or Graphic to a Laser-Cut Topographic Map | TopoStack",
    description: "Upload an SVG logo or badge, place and rotate it on your topographic map, and engrave it, score its outline or cut it out of the layer.",
    label: "Custom graphics",
    published: "2026-09-23",
    updated: "2026-09-23",
    image: socialCard("guides-custom-graphics", "Custom graphics card with red cut lines and blue score lines on layers in the studio's export preview."),
  },
  "/guides/trace-a-depth-chart": {
    title: "Trace a Lake Depth Chart for a Laser-Cut Map | TopoStack",
    description: "Review and correct lake-chart contours, align them with known coordinates, inspect the generated layers, and apply the chart to your map.",
    label: "Trace a depth chart",
    published: "2026-09-23",
    updated: "2026-09-23",
    image: socialCard("guides-trace-a-depth-chart", "Depth chart tracing card with reviewed contours drawn over a USGS lake depth chart in the studio."),
  },
  "/guides/how-depth-chart-tracing-works": {
    title: "How Depth-Chart Tracing Works | TopoStack",
    description: "How reviewed chart contours become lake floors and cut layers, why manual review matters, current compromises, and future improvements.",
    label: "How chart tracing works",
    published: "2026-09-23",
    updated: "2026-09-23",
    image: socialCard("guides-how-depth-chart-tracing-works", "Depth-chart tracing explainer card with a layered relief generated from a traced King City South Lake chart."),
  },
  "/guides/how-terrain-generation-works": {
    title: "How Terrain Generation Works in Your Browser | TopoStack",
    description: "Follow elevation data into cut layers and see how terrain caching, spatial indexes, and parallel workers speed up large maps in your browser.",
    label: "How terrain generation works",
    published: "2026-09-24",
    updated: "2026-09-24",
    image: socialCard("guides-how-terrain-generation-works", "Terrain generation card with a layered Matterhorn relief rendered in the studio."),
  },
  "/guides/settings-reference": {
    title: "Studio Settings Reference | TopoStack",
    description: "Every TopoStack studio control with its range, default and output type, from vertical exaggeration and kerf to linework widths.",
    label: "Settings reference",
    published: "2026-09-17",
    updated: "2026-10-05",
    image: socialCard("guides-settings-reference", "Settings reference card with the studio's project controls beside a Crater Lake relief."),
  },
  "/guides/use-with-ai-assistants": {
    title: "Use TopoStack with Claude, ChatGPT and AI Agents | TopoStack",
    description: "Connect an AI assistant to TopoStack's MCP server to plan and preview topographic models in a chat, then open them in the studio to export.",
    label: "AI assistants",
    published: "2026-09-25",
    updated: "2026-09-25",
    image: socialCard("guides-use-with-ai-assistants", "AI assistants guide card with a Mount Rainier model previewed inside a chat as stacked sheets."),
  },
  "/guides/browser-agents": {
    title: "Use a Browser Agent in the Studio with WebMCP | TopoStack",
    description: "Let Chrome's agent or Claude in Chrome read and change your open design through WebMCP, generate it and open the export dialog, with every edit undoable.",
    label: "Browser agents",
    published: "2026-09-25",
    updated: "2026-09-25",
    image: socialCard("guides-browser-agents", "Browser agents guide card with the TopoStack studio's controls beside a Crater Lake relief."),
  },
  "/guides/mcp-server": {
    title: "MCP Server Reference: Tools, Resources and Limits | TopoStack",
    description: "The tools, resources and prompts of TopoStack's remote MCP server, the in-chat preview app, protocol behavior, error codes and rate limits.",
    label: "MCP server reference",
    published: "2026-09-25",
    updated: "2026-10-07",
    image: socialCard("guides-mcp-server", "MCP server reference card with a Mount Rainier model previewed inside a chat as stacked sheets."),
  },
  "/guides/agent-api": {
    title: "Project Request and HTTP API Reference | TopoStack",
    description: "Every field of the TopoStack project request, how studio links work, and the HTTP routes that plan models and make links, with errors and limits.",
    label: "Project request and HTTP API",
    published: "2026-09-25",
    updated: "2026-10-07",
    image: socialCard("guides-agent-api", "Project request and HTTP API card with a layered Lake Tahoe relief rendered in the studio."),
  },
  "/guides/export-files": {
    title: "Laser Export Files and SVG Structure | TopoStack",
    description: "What each TopoStack download contains: SVG panels, colors and operation groups, kerf compensation, assembly guide, project file and attribution.",
    label: "Export files",
    published: "2026-09-17",
    updated: "2026-10-05",
    image: socialCard("guides-export-files", "Export files card with the studio's export preview of SVG cut panels."),
  },
  "/guides/troubleshooting": {
    title: "Troubleshooting Topographic Map Exports | TopoStack",
    description: "Fix blocked exports, understand studio warnings, and get answers to common questions about layers, lake depth, SVG scale and kerf.",
    label: "Troubleshooting",
    published: "2026-09-17",
    updated: "2026-09-23",
    image: socialCard("guides-troubleshooting", "Troubleshooting card with studio notices shown above a Crater Lake relief."),
  },
  "/examples": {
    title: "Topographic Map Examples: Laser-Cut Terrain Projects | TopoStack",
    description: "Layered topographic map projects of the Grand Canyon, Yosemite, Mount Rainier, Mount Fuji and more, with renders, settings and projects that open in the studio.",
    label: "Examples",
    published: "2026-09-21",
    updated: "2026-09-21",
    image: socialCard("examples", "Topographic map examples card with layered reliefs of Mount Fuji, Yosemite Valley and Mount Rainier."),
  },
  "/examples/crater-lake": {
    title: "Crater Lake Topographic Map: A Terrain Project | TopoStack",
    description: "Explore the Crater Lake terrain preview in TopoStack, follow the project setup, and learn how to generate fresh terrain for layered or engraved SVG exports.",
    label: "Crater Lake example",
    published: "2026-09-15",
    updated: "2026-09-25",
  },
  "/attribution": {
    title: "Sources and Attribution | TopoStack",
    description: "Explore TopoStack’s terrain, map, lake-depth, artwork, and software sources, how they are used, and their credits and licenses.",
    label: "Sources and attribution",
    published: "2026-09-16",
    updated: "2026-09-25",
  },
  "/changelog": {
    title: "Changelog: New Features and Fixes | TopoStack",
    description: "What changed in each TopoStack release: new studio features, improvements to terrain and lake data, and fixes, newest first, with a feed you can subscribe to.",
    label: "Changelog",
    published: CHANGELOG_PUBLISHED,
    // The release script writes the newest release date, so the sitemap moves with each release.
    updated: latestRelease.date > CHANGELOG_PUBLISHED ? latestRelease.date : CHANGELOG_PUBLISHED,
  },
  "/privacy": {
    title: "Privacy and Browser Storage | TopoStack",
    description: "How TopoStack stores project settings, requests map data, handles requests from AI assistants, and measures visits and successful exports.",
    label: "Privacy",
    published: "2026-09-15",
    updated: "2026-09-25",
  },
};
const STUDIO_META = {
  title: "Studio: Create Your Topographic Map | TopoStack",
  description: "Choose a place, customize layered relief or flat engraving, and generate SVG artwork in the free TopoStack studio.",
  label: "studio",
};

/**
 * Guides and worked examples are authored, dated articles; the homepage, the
 * guides hub and the policy pages are not, so they stay plain web pages rather
 * than claiming an authorship and publication date they do not have.
 */
export function isArticlePage(path: string): boolean {
  return path !== DOCS_HOME && (path.startsWith("/guides/") || path.startsWith("/examples/"));
}

/** The visible article name: the page title without the trailing site suffix. */
export function headline(title: string): string {
  return title.replace(/\s*\|\s*TopoStack$/, "");
}

export function socialImage(path: string): SocialImage {
  return PUBLIC_PAGES[path]?.image ?? DEFAULT_SOCIAL_IMAGE;
}

/**
 * Everything the document head needs for one page, resolved on the server.
 * The layout's server load hands this to `Seo.svelte`, so the registry above
 * stays out of the homepage's JavaScript however many pages it gains.
 */
export interface PageSeo {
  title: string;
  description: string;
  canonical: string;
  /** Registered in PUBLIC_PAGES, so eligible for indexing, the sitemap and breadcrumbs. */
  registered: boolean;
  image: SocialImage;
  article?: { headline: string; published: string; updated: string };
  breadcrumbs: { name: string; item: string }[];
  /** A lake page's subject: schema.org LakeBodyOfWater with its survey box ("south west north east"). */
  place?: { name: string; alternateName?: string[]; box: string; containedIn: string };
}

export function pageSeo(path: string): PageSeo | undefined {
  const registered = PUBLIC_PAGES[path];
  const meta = registered ?? (path === "/studio" ? STUDIO_META : undefined);
  if (!meta) return undefined;
  const canonical = SITE_ORIGIN + path;
  const breadcrumbs = registered && path !== "/" ? [
    { name: "TopoStack", item: SITE_ORIGIN + "/" },
    ...(path === DOCS_HOME ? [] : [{ name: PUBLIC_PAGES[DOCS_HOME]!.label, item: SITE_ORIGIN + DOCS_HOME }]),
    { name: registered.label, item: canonical },
  ] : [];
  return {
    title: meta.title,
    description: meta.description,
    canonical,
    registered: Boolean(registered),
    image: socialImage(path),
    // Only pages with recorded dates claim article metadata, so a new page cannot
    // advertise a publication date before one is written down for it.
    ...(registered && isArticlePage(path) ? { article: { headline: headline(registered.title), published: registered.published, updated: registered.updated } } : {}),
    breadcrumbs,
  };
}
