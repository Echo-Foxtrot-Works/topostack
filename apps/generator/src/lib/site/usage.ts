import { USAGE_CAMPAIGNS, USAGE_CHANNELS, USAGE_LANDINGS, USAGE_MEDIUMS, USAGE_SOURCES, type UsageEvent, type UsageEventName } from "@topostack/data-contracts/usage";

const STORAGE_KEY = "topostack-usage-session";
const SESSION_MS = 30 * 60 * 1000;
interface Session {
  landing: UsageEvent["landing"];
  source: UsageEvent["source"];
  campaign: NonNullable<UsageEvent["campaign"]>;
  medium: NonNullable<UsageEvent["medium"]>;
  channel: NonNullable<UsageEvent["channel"]>;
  updatedAt: number;
  landingSeen: boolean;
  studioSeen: boolean;
}

function enabled(): boolean {
  return import.meta.env.VITE_SITE_ENV === "production" && typeof window !== "undefined"
    && (location.hostname === "topostack.app" || (import.meta.env.MODE === "e2e" && import.meta.env.VITE_E2E === "1"))
    && navigator.doNotTrack !== "1" && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}
/** A utm_* value from the fixed list; unlisted values collapse to "other" so free text is never sent. */
function tagged<T extends string>(entry: URL, parameter: string, options: readonly T[], absent: T): T {
  const value = entry.searchParams.get(parameter)?.toLowerCase();
  return value ? options.find((option) => option === value) ?? ("other" as T) : absent;
}
// Static lake pages collect no events. Recover their published link tags from
// the same-origin referrer when the studio is the first scripted page.
function entryUrl(): URL {
  const here = new URL(location.href);
  if (["utm_source", "utm_campaign", "utm_medium", "utm_content"].some((key) => here.searchParams.has(key))) return here;
  try {
    const from = new URL(document.referrer);
    if (from.origin === here.origin && (from.pathname === "/lakes" || from.pathname.startsWith("/lakes/") || from.pathname.startsWith("/lake/"))) return from;
  } catch { /* Missing or malformed referrers keep the current URL. */ }
  return here;
}
function acquisition(entry: URL): UsageEvent["source"] {
  const tag = entry.searchParams.get("utm_source")?.toLowerCase();
  if (tag) return USAGE_SOURCES.find((source) => source === tag) ?? "other";
  if (!document.referrer) return "direct";
  try {
    const host = new URL(document.referrer).hostname;
    if (host === location.hostname) return "direct";
    // Assistants are matched before the search engines: gemini.google.com is a
    // Google host, but its visitors did not come from a search result page.
    if (["chatgpt.com", "openai.com", "perplexity.ai", "claude.ai", "anthropic.com", "copilot.microsoft.com", "gemini.google.com"].some((domain) => host === domain || host.endsWith("." + domain))) return "ai";
    if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
    if (host === "bing.com" || host.endsWith(".bing.com")) return "bing";
    if (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")) return "duckduckgo";
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host === "atomm.com" || host.endsWith(".atomm.com")) return "atomm";
    if (["reddit.com", "youtube.com", "youtu.be", "facebook.com", "instagram.com", "pinterest.com", "t.co", "x.com", "bsky.app", "news.ycombinator.com", "forum.lightburnsoftware.com", "community.glowforge.com"].some((domain) => host === domain || host.endsWith("." + domain))) return "social";
  } catch { /* Unknown referrers use the fixed fallback category. */ }
  return "other";
}
function channel(entry: URL): NonNullable<UsageEvent["channel"]> {
  if (entry.searchParams.get("utm_content")) return tagged(entry, "utm_content", USAGE_CHANNELS, "none");
  try {
    const host = new URL(document.referrer).hostname;
    const hosts: ReadonlyArray<readonly [string, NonNullable<UsageEvent["channel"]>]> = [
      ["reddit.com", "reddit"], ["forum.lightburnsoftware.com", "lightburn-forum"],
      ["community.glowforge.com", "glowforge-forum"], ["news.ycombinator.com", "hacker-news"],
      ["producthunt.com", "product-hunt"], ["youtube.com", "youtube"], ["youtu.be", "youtube"],
      ["instagram.com", "instagram"], ["facebook.com", "facebook"], ["pinterest.com", "pinterest"],
      ["bsky.app", "bluesky"], ["t.co", "x"], ["x.com", "x"], ["github.com", "github"], ["atomm.com", "atomm"],
    ];
    return hosts.find(([domain]) => host === domain || host.endsWith("." + domain))?.[1]
      ?? (host === location.hostname ? "none" : "other");
  } catch { return "none"; }
}
/** The fixed landing category for a path; generated lake and example pages share "/lakes" and "/examples". */
function landingOf(path: string): UsageEvent["landing"] | undefined {
  return USAGE_LANDINGS.find((landing) => landing === path)
    ?? (path.startsWith("/lakes/") || path.startsWith("/lake/") ? "/lakes" : path.startsWith("/examples/") ? "/examples" : undefined);
}
/**
 * Where a new session landed. Lake pages ship no JavaScript, so a visitor who
 * reads one and opens the studio starts the session on /studio; the same-site
 * referrer still names the page they arrived on.
 */
function entryLanding(): UsageEvent["landing"] {
  const here = landingOf(location.pathname) ?? "/";
  if (here !== "/studio" || !document.referrer) return here;
  try {
    const from = new URL(document.referrer);
    if (from.hostname === location.hostname) return landingOf(from.pathname) ?? here;
  } catch { /* Malformed referrers keep the studio landing. */ }
  return here;
}
function session(): Session {
  try {
    const saved: Session = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && USAGE_LANDINGS.includes(saved.landing) && USAGE_SOURCES.includes(saved.source)
      && Number.isFinite(saved.updatedAt) && Date.now() - saved.updatedAt < SESSION_MS && saved.updatedAt <= Date.now()
      && typeof saved.landingSeen === "boolean" && typeof saved.studioSeen === "boolean") {
      // Sessions saved before campaigns were recorded carry none.
      if (!USAGE_CAMPAIGNS.includes(saved.campaign) || !USAGE_MEDIUMS.includes(saved.medium)) Object.assign(saved, { campaign: "none", medium: "none" });
      // Do not invent a channel from a later page for an older saved session.
      if (!USAGE_CHANNELS.includes(saved.channel)) saved.channel = "none";
      return saved;
    }
  } catch { /* Storage restrictions must not affect the studio. */ }
  const entry = entryUrl();
  return { landing: entryLanding(), source: acquisition(entry), campaign: tagged(entry, "utm_campaign", USAGE_CAMPAIGNS, "none"), medium: tagged(entry, "utm_medium", USAGE_MEDIUMS, "none"), channel: channel(entry), updatedAt: Date.now(), landingSeen: false, studioSeen: false };
}
function send(event: UsageEventName, current: Session, output: UsageEvent["output"], delivery: UsageEvent["delivery"]): void {
  current.updatedAt = Date.now();
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* Best effort. */ }
  const payload: UsageEvent = { event, landing: current.landing, source: current.source, device: innerWidth < 768 ? "small" : "large", output, delivery, campaign: current.campaign, medium: current.medium, channel: current.channel };
  // Same-origin collection only. Never wait for analytics before continuing a user action.
  void fetch("/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => undefined);
}
export function trackUsage(event: UsageEventName, output: UsageEvent["output"] = "none", delivery: UsageEvent["delivery"] = "none"): void {
  if (!enabled()) return;
  send(event, session(), output, delivery);
}
export function trackPageView(path: string): void {
  if (!enabled() || !landingOf(path)) return;
  const current = session();
  if (path === "/studio") {
    if (current.studioSeen) return;
    current.studioSeen = true;
    send("studio_open", current, "none", "none");
  } else {
    if (current.landingSeen) return;
    current.landingSeen = true;
    send("landing_view", current, "none", "none");
  }
}
