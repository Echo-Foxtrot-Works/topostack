import { DOCS_HOME, PUBLIC_PAGES } from "$lib/site/seo";

export { DOCS_HOME };

/**
 * Navigation order for the guides area. Every public page except the homepage
 * belongs to exactly one section; docs.test.ts enforces that so new pages
 * cannot be published without a place in the sidebar.
 */
export const DOCS_SECTIONS: readonly { id: string; title: string; summary: string; paths: readonly string[] }[] = [
  {
    id: "start",
    title: "Get started",
    summary: "Find your way around the studio, start from an AI assistant, or follow a complete first project.",
    paths: ["/guides/studio-tour", "/guides/use-with-ai-assistants", "/examples", "/examples/crater-lake"],
  },
  {
    id: "make",
    title: "Make a map",
    summary: "Step-by-step workflows from choosing a place to exporting SVG files for your laser.",
    paths: ["/guides/laser-cut-topographic-map", "/guides/split-large-maps", "/guides/water-paint-templates", "/guides/topographic-map-engraving", "/guides/lightburn"],
  },
  {
    id: "customize",
    title: "Customize",
    summary: "Choose map details, labels and line widths, and bring in your own markers, routes, graphics and depth charts.",
    paths: ["/guides/map-details", "/guides/custom-data", "/guides/custom-markers-and-paths", "/guides/custom-graphics"],
  },
  {
    id: "lakes",
    title: "Lakes and depth",
    summary: "Make a layered lake map, trace a depth chart for an unsurveyed lake, browse lakes with surveyed depth data, and learn how TopoStack builds lake floors.",
    paths: ["/guides/custom-lake-depth-map", "/guides/trace-a-depth-chart", "/guides/how-depth-chart-tracing-works", "/lakes", "/guides/lake-depth-data", "/guides/how-lake-depths-work"],
  },
  {
    id: "airspace",
    title: "Airspace in 3D",
    summary: "Model FAA airspace above your terrain, choose acrylic shelves or solid volumes, and follow the rod and assembly guides.",
    paths: ["/guides/airspace-in-3d", "/guides/airspace-assembly"],
  },
  {
    id: "agents",
    title: "AI agents and API",
    summary: "Drive the studio with a browser agent, and build on TopoStack's MCP server and HTTP API.",
    paths: ["/guides/browser-agents", "/guides/mcp-server", "/guides/agent-api"],
  },
  {
    id: "help",
    title: "Help",
    summary: "Fix blocked exports, understand warnings and find answers to common questions.",
    paths: ["/guides/troubleshooting"],
  },
  {
    id: "reference",
    title: "Reference",
    summary: "How terrain generation works, every studio setting, export contents, data sources, privacy, and release notes.",
    paths: ["/guides/how-terrain-generation-works", "/guides/settings-reference", "/guides/export-files", "/attribution", "/privacy", "/changelog"],
  },
];

export interface DocLink { path: string; label: string; description: string }

function link(path: string): DocLink {
  const metadata = PUBLIC_PAGES[path];
  if (!metadata) throw new Error(`Guide ${path} is missing from PUBLIC_PAGES`);
  return { path, label: metadata.label, description: metadata.description };
}

export const DOCS_NAV = DOCS_SECTIONS.map((section) => ({ ...section, links: section.paths.map(link) }));

const ORDER: DocLink[] = [link(DOCS_HOME), ...DOCS_NAV.flatMap((section) => section.links)];

export function docsSection(path: string): (typeof DOCS_NAV)[number] | undefined {
  return DOCS_NAV.find((section) => section.paths.includes(path));
}

export function docsNeighbours(path: string): { previous?: DocLink; next?: DocLink } {
  const index = ORDER.findIndex((entry) => entry.path === path);
  if (index < 0) return {};
  return { previous: ORDER[index - 1], next: ORDER[index + 1] };
}

export function headingId(text: string, taken: Set<string>): string {
  const slug = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
  let id = slug;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${slug}-${suffix}`;
  taken.add(id);
  return id;
}
