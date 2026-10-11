// Fixed categories only: never send project names, coordinates, queries or user IDs.
export const USAGE_EVENTS = ["landing_view", "studio_open", "generation_started", "generation_succeeded", "generation_failed", "generation_cancelled", "export_prepared", "export_failed", "share_link_copied", "share_link_opened", "share_link_shared", "share_preview_prepared"] as const;
// Every public page, so a search landing on any guide is attributed to it.
// Generated pages below /lakes and /examples report "/lakes" and "/examples".
// Additions are compatible; removing a path rejects events from open tabs.
export const USAGE_LANDINGS = [
  "/", "/studio", "/guides", "/guides/laser-cut-topographic-map", "/guides/topographic-map-engraving", "/examples/crater-lake", "/privacy",
  "/attribution", "/guides/split-large-maps", "/guides/water-paint-templates", "/guides/lake-depth-data", "/guides/how-lake-depths-work",
  "/guides/studio-tour", "/guides/map-details", "/guides/custom-markers-and-paths", "/guides/settings-reference", "/guides/export-files",
  "/guides/troubleshooting", "/lakes", "/guides/custom-lake-depth-map", "/examples", "/changelog", "/guides/custom-graphics",
  "/guides/custom-data", "/guides/trace-a-depth-chart",
  "/guides/how-depth-chart-tracing-works", "/guides/how-terrain-generation-works", "/guides/use-with-ai-assistants",
  "/guides/browser-agents", "/guides/mcp-server", "/guides/agent-api", "/guides/lightburn",
  "/guides/airspace-in-3d", "/guides/airspace-assembly",
] as const;
// "ai" covers assistant and answer-engine referrers, which send a visitor who
// already read a description of the tool rather than a search result snippet.
export const USAGE_SOURCES = ["direct", "google", "bing", "duckduckgo", "ai", "github", "atomm", "social", "other"] as const;
// Campaign and medium come only from utm_campaign/utm_medium on links we publish
// (README, launch posts, creator walkthroughs). Unlisted values report "other".
export const USAGE_CAMPAIGNS = ["none", "launch", "readme", "newsletter", "creator", "atomm", "other"] as const;
export const USAGE_MEDIUMS = ["none", "social", "forum", "email", "video", "referral", "other"] as const;
// utm_content identifies a venue or a numbered creator slot, never a person's
// name, post URL or arbitrary campaign text. Broad sources stay comparable.
export const USAGE_CHANNELS = [
  "none", "other", "reddit", "reddit-lasercutting", "reddit-lasercut", "reddit-laserengraving",
  "reddit-cartography", "reddit-gis", "reddit-xtool", "reddit-glowforge", "reddit-crealityfalcon",
  "lightburn-forum", "glowforge-forum", "xtool-community", "hacker-news", "product-hunt",
  "youtube", "instagram", "facebook", "pinterest", "bluesky", "mastodon", "x", "github", "atomm",
  "creator-01", "creator-02", "creator-03", "creator-04", "creator-05",
  "creator-06", "creator-07", "creator-08", "creator-09", "creator-10",
] as const;
export type UsageEventName = typeof USAGE_EVENTS[number];
export interface UsageEvent {
  event: UsageEventName;
  landing: typeof USAGE_LANDINGS[number];
  source: typeof USAGE_SOURCES[number];
  device: "small" | "large";
  output: "stack" | "engraving" | "none";
  delivery: "browser" | "atomm" | "none";
  /** Sent together with `medium` or not at all; tabs opened before 0.7 send neither. */
  campaign?: typeof USAGE_CAMPAIGNS[number];
  medium?: typeof USAGE_MEDIUMS[number];
  /** Optional independently of campaign/medium so older open tabs remain valid. */
  channel?: typeof USAGE_CHANNELS[number];
}

export function isUsageEvent(value: unknown): value is UsageEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields: Record<string, readonly unknown[]> = {
    event: USAGE_EVENTS, landing: USAGE_LANDINGS, source: USAGE_SOURCES,
    device: ["small", "large"], output: ["stack", "engraving", "none"], delivery: ["browser", "atomm", "none"],
  };
  // Compatibility: a field may be added only as an optional group that the
  // validator accepts both with and without, because tabs loaded before a
  // deploy keep sending the previous shape until they are reloaded.
  const attributed = "campaign" in record || "medium" in record;
  if (attributed) Object.assign(fields, { campaign: USAGE_CAMPAIGNS, medium: USAGE_MEDIUMS });
  if ("channel" in record) Object.assign(fields, { channel: USAGE_CHANNELS });
  return Object.keys(record).length === Object.keys(fields).length
    && Object.entries(fields).every(([key, options]) => options.includes(record[key]));
}
