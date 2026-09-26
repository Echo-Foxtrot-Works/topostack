// User-facing release history. Pull requests add fragments under
// changelog/unreleased/; the release script folds them into
// changelog/releases.json, which the site page, the Atom feed, the GitHub
// release, and the Atomm release notes all read. See docs/changelog.md.

// Ordered as the page lists them within a release.
export const CHANGE_TYPES = ["breaking", "feature", "improvement", "fix"] as const;
export type ChangeType = typeof CHANGE_TYPES[number];
export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  breaking: "Breaking", feature: "New", improvement: "Improved", fix: "Fixed",
};

export interface ChangelogEntry {
  type: ChangeType;
  title: string;
  body: string;
  pr?: number;
}
export interface ChangelogRelease {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}
export interface ChangelogV1 {
  schemaVersion: 1;
  releases: ChangelogRelease[];
}
/** The newest release only, small enough for client bundles. */
export interface LatestRelease {
  version: string;
  date: string;
}
export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string };

const TITLE_MAX = 100;
const BODY_MAX = 600;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

function isChangeType(value: unknown): value is ChangeType {
  return (CHANGE_TYPES as readonly unknown[]).includes(value);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Negative when a is older than b. Prereleases sort before their release. */
export function compareVersions(a: string, b: string): number {
  const left = VERSION.exec(a), right = VERSION.exec(b);
  if (!left || !right) throw new Error(`Not a SemVer version: ${left ? b : a}`);
  for (let index = 1; index <= 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference) return Math.sign(difference);
  }
  if (left[4] === right[4]) return 0;
  if (left[4] === undefined) return 1;
  if (right[4] === undefined) return -1;
  return comparePrerelease(left[4].split("."), right[4].split("."));
}

/** SemVer precedence: numeric identifiers compare as numbers and sort before text; a longer list wins a tie. */
function comparePrerelease(left: string[], right: string[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const a = left[index]!, b = right[index]!;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a), bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return Math.sign(left.length - right.length);
}

/** The SemVer bump a set of entries calls for. */
export function releaseBump(entries: readonly Pick<ChangelogEntry, "type">[]): "major" | "minor" | "patch" {
  if (entries.some((entry) => entry.type === "breaking")) return "major";
  if (entries.some((entry) => entry.type === "feature")) return "minor";
  return "patch";
}

/** Release order: by type as the page lists them, then by pull request; unknown pull requests last. */
export function sortEntries<T extends Pick<ChangelogEntry, "type" | "pr">>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => CHANGE_TYPES.indexOf(a.type) - CHANGE_TYPES.indexOf(b.type) || (a.pr ?? Infinity) - (b.pr ?? Infinity));
}

/** Stable fragment id for a release heading: 0.2.0 → v0-2-0. */
export function releaseAnchor(version: string): string {
  return `v${version.replace(/[^0-9A-Za-z-]/g, "-")}`;
}

function checkEntry(entry: unknown, where: string): ChangelogEntry {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(where, "entry must be an object");
  const { type, title, body, pr, ...extra } = entry as Record<string, unknown>;
  if (Object.keys(extra).length) fail(where, `unknown field ${Object.keys(extra)[0]}`);
  if (!isChangeType(type)) fail(where, `type must be one of ${CHANGE_TYPES.join(", ")}`);
  if (typeof title !== "string" || !title.trim() || title !== title.trim() || title.includes("\n")) fail(where, "title must be one trimmed line");
  if (title.length > TITLE_MAX) fail(where, `title is longer than ${TITLE_MAX} characters`);
  if (typeof body !== "string" || !body.trim() || body !== body.trim()) fail(where, "body must be non-empty trimmed text");
  if (body.length > BODY_MAX) fail(where, `body is longer than ${BODY_MAX} characters`);
  inlineTokens(body, where);
  if (pr !== undefined && (!Number.isInteger(pr) || (pr as number) < 1)) fail(where, "pr must be a positive integer");
  return pr === undefined ? { type, title, body } : { type, title, body, pr: pr as number };
}

/**
 * Parse a fragment file:
 *
 *   ---
 *   type: feature
 *   title: Import GPX tracks as paths
 *   ---
 *   One to three sentences a maker would care about.
 */
export function parseFragment(text: string, name: string): ChangelogEntry {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text.replace(/^\uFEFF/, ""));
  if (!match) fail(name, "expected front matter between --- lines followed by the body");
  const [, front = "", body = ""] = match;
  const fields: Record<string, unknown> = {};
  for (const line of front.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!field) fail(name, `cannot read front matter line "${line}"`);
    const [, key = "", raw = ""] = field;
    if (key in fields) fail(name, `duplicate field ${key}`);
    const value = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
    fields[key] = key === "pr" ? Number(value) : value;
  }
  return checkEntry({ ...fields, body: body.replace(/\s+/g, " ").trim() }, name);
}

export function validateChangelog(value: unknown): ChangelogV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("changelog", "must be an object");
  const { schemaVersion, releases } = value as Record<string, unknown>;
  if (schemaVersion !== 1) fail("changelog", "schemaVersion must be 1");
  if (!Array.isArray(releases)) fail("changelog", "releases must be an array");
  const checked = releases.map((release: unknown, index): ChangelogRelease => {
    const where = `release ${index}`;
    if (!release || typeof release !== "object") fail(where, "must be an object");
    const { version, date, entries } = release as Record<string, unknown>;
    if (typeof version !== "string" || !VERSION.test(version)) fail(where, "version must be SemVer");
    if (!isValidDate(date)) fail(version, "date must be YYYY-MM-DD");
    if (!Array.isArray(entries) || !entries.length) fail(version, "needs at least one entry");
    return { version, date, entries: entries.map((entry, item) => checkEntry(entry, `${version} entry ${item}`)) };
  });
  checked.forEach((release, index) => {
    const older = checked[index + 1];
    if (!older) return;
    if (compareVersions(release.version, older.version) <= 0) fail(release.version, `must be newer than the release after it (${older.version})`);
    if (release.date < older.date) fail(release.version, `is dated before ${older.version}`);
  });
  return { schemaVersion: 1, releases: checked };
}

export function latestRelease(changelog: ChangelogV1): LatestRelease | undefined {
  const [release] = changelog.releases;
  return release && { version: release.version, date: release.date };
}

/**
 * Split entry text into plain text, `code`, **bold**, and [links](/path). Nothing else
 * is markup, so renderers escape every token and never inject HTML.
 */
export function inlineTokens(text: string, where = "text"): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });
    const [whole, code, strong, label = "", href = ""] = match;
    if (code !== undefined) tokens.push({ kind: "code", text: code });
    else if (strong !== undefined) tokens.push({ kind: "strong", text: strong });
    else {
      if (!/^\/(?!\/)/.test(href) && !href.startsWith("https://")) fail(where, `link ${href} must be a site path or https URL`);
      tokens.push({ kind: "link", text: label, href });
    }
    last = match.index + whole.length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
