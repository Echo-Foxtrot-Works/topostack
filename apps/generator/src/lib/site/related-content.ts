export interface RelatedContent { path: string; title: string; description: string }

const RELIEF: RelatedContent = { path: "/studio?starter=relief", title: "Start a small layered relief", description: "Prepared Crater Lake settings with a checklist for your first export." };
const ENGRAVING: RelatedContent = { path: "/studio?starter=engraving", title: "Start a flat engraving", description: "One contour SVG, with no layers to cut and glue." };
const LIGHTBURN: RelatedContent = { path: "/guides/lightburn", title: "Take your SVG into LightBurn", description: "Check dimensions, processing layers and kerf before running the job." };
const EXPORT: RelatedContent = { path: "/guides/export-files", title: "Choose the right export files", description: "Understand panels, companion engravings, settings and the assembly booklet." };
const CRATER: RelatedContent = { path: "/examples/crater-lake", title: "Follow the Crater Lake project", description: "See a software preview and a worked setup with surveyed lake-floor data." };
const TAHOE: RelatedContent = { path: "/examples/lake-tahoe", title: "Explore the Lake Tahoe example", description: "Open a prepared lake project and learn why its framing and depth settings were chosen." };
const FUJI: RelatedContent = { path: "/examples/mount-fuji", title: "Explore the Mount Fuji example", description: "A circular volcano relief with a downloadable project and measured results." };

/** Curated next actions; registered guides and generated pages share this list. */
export function relatedContent(path: string): readonly RelatedContent[] {
  if (path.startsWith("/lake/") || path.startsWith("/lakes/")) return [TAHOE, CRATER, LIGHTBURN];
  if (path.startsWith("/examples/")) return [RELIEF, EXPORT, LIGHTBURN];
  switch (path) {
    case "/guides/laser-cut-topographic-map": return [RELIEF, FUJI, LIGHTBURN];
    case "/guides/topographic-map-engraving": return [ENGRAVING, EXPORT, LIGHTBURN];
    case "/guides/lightburn": return [RELIEF, ENGRAVING, EXPORT];
    case "/guides/custom-lake-depth-map":
    case "/guides/how-lake-depths-work":
    case "/guides/lake-depth-data":
    case "/lakes": return [TAHOE, CRATER, LIGHTBURN];
    case "/guides/export-files": return [LIGHTBURN, { path: "/guides/troubleshooting", title: "Resolve an export problem", description: "Understand stale terrain, missing data and export-blocking warnings." }, FUJI];
    case "/guides/studio-tour":
    case "/guides/troubleshooting": return [RELIEF, ENGRAVING, LIGHTBURN];
    case "/guides/split-large-maps":
    case "/guides/water-paint-templates": return [CRATER, EXPORT, LIGHTBURN];
    default: return [];
  }
}
