import { del, get, getMany, keys, set } from "idb-keyval";
import type { ProjectConfigV1, UserDepthChartRefV1 } from "@topostack/core";
import { parseUserChartBathymetry, type UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import type { LoadedUserChart } from "$lib/domain/user-bathymetry";

/**
 * Traced depth charts, one IndexedDB entry each.
 *
 * Charts are the maker's own data and stay on their device: a project records
 * only which chart each lake uses, and an exported project file carries the
 * charts it needs beside it. A chart is therefore never fetched from a server,
 * and a project opened on another device simply falls back to the survey
 * providers until its charts are imported.
 */

const PREFIX = "topostack:chart:v1:";
const chartKey = (id: string): string => `${PREFIX}${id}`;
/**
 * A few fields per chart, kept beside it so listing the library reads a line
 * per chart rather than decoding and validating every contour and grid.
 */
const SUMMARY_PREFIX = "topostack:chart-summary:v1:";
const summaryKey = (id: string): string => `${SUMMARY_PREFIX}${id}`;

/** A saved chart alongside the hash a project references it by. */
interface StoredChart {
  savedAt: string;
  contentHash: string;
  chart: UserChartBathymetryV1;
}

/** JSON with every object's keys sorted, so the same record always gives the same text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The hash a project pins a chart by: SHA-256 of the record's canonical JSON,
 * keys sorted. It must not depend on the order a parser happens to build keys
 * in, or a later release would see every saved chart as changed.
 */
export async function chartContentHash(chart: UserChartBathymetryV1): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(chart));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const summaryOf = (chart: UserChartBathymetryV1, savedAt: string, contentHash: string): SavedChartSummary => ({
  reviewed: chart.review?.version === 1, id: chart.id, savedAt, name: chart.provenance.title, lakeName: chart.lake.name, hylakId: chart.lake.hylakId, contentHash,
});

/** Saves a chart and returns the reference a project stores for a lake. */
export async function saveUserChart(chart: UserChartBathymetryV1): Promise<UserDepthChartRefV1> {
  const parsed = parseUserChartBathymetry(chart);
  const contentHash = await chartContentHash(parsed);
  const savedAt = new Date().toISOString();
  await set(chartKey(parsed.id), { savedAt, contentHash, chart: parsed } satisfies StoredChart);
  await set(summaryKey(parsed.id), summaryOf(parsed, savedAt, contentHash));
  return { id: parsed.id, contentHash };
}

/**
 * One saved chart, or undefined when it is missing, unreadable, or storage is
 * unavailable. A chart that will not load is not worth failing a render over:
 * the lake falls back to the survey providers, and the warning says so.
 */
export async function loadUserChart(id: string): Promise<LoadedUserChart | undefined> {
  let stored: unknown;
  try {
    stored = await get<unknown>(chartKey(id));
  } catch (error) {
    console.warn("TopoStack: saved depth charts are unavailable in this browser.", error);
    return undefined;
  }
  if (!stored || typeof stored !== "object") return undefined;
  return readStored(id, stored as Partial<StoredChart>);
}

/** A stored entry as a chart and its hash, or undefined when it no longer parses. */
async function readStored(id: string, record: Partial<StoredChart>): Promise<LoadedUserChart | undefined> {
  try {
    const chart = parseUserChartBathymetry(record.chart);
    return { chart, contentHash: typeof record.contentHash === "string" ? record.contentHash : await chartContentHash(chart) };
  } catch (error) {
    console.warn(`TopoStack: the saved depth chart ${id} could not be read.`, error);
    return undefined;
  }
}

/**
 * The reviewed charts a project's lakes use, under the same keys. Legacy
 * records stay loadable/exportable but cannot silently re-enter generation. A chart whose content
 * no longer matches the project's reference is still used, because the saved
 * chart is the one the maker means; `currentChartReferences` brings the
 * project's references up to date before a generation, so what is carved and
 * what the project says it carved agree.
 */
export async function loadUserCharts(references: Record<string, UserDepthChartRefV1> | undefined): Promise<Map<string, LoadedUserChart>> {
  const charts = new Map<string, LoadedUserChart>();
  if (!references) return charts;
  const byId = new Map<string, LoadedUserChart>();
  for (const [lake, reference] of Object.entries(references)) {
    let loaded = byId.get(reference.id);
    if (!loaded) {
      loaded = await loadUserChart(reference.id);
      if (!loaded || !loaded.chart.review) continue;
      byId.set(reference.id, loaded);
    }
    charts.set(lake, loaded);
  }
  return charts;
}

/** One line per saved chart: enough to list it, and to use it for its lake. */
export interface SavedChartSummary {
  reviewed?: boolean;
  id: string;
  savedAt: string;
  /** The chart's own name. */
  name: string;
  /** The lake it was traced for, which is the only lake it can carve. */
  lakeName: string | undefined;
  hylakId: number | undefined;
  contentHash: string;
}

function isSummary(value: unknown): value is SavedChartSummary {
  const summary = value as Partial<SavedChartSummary> | undefined;
  return !!summary && typeof summary.id === "string" && typeof summary.name === "string" && typeof summary.contentHash === "string";
}

/**
 * Every saved chart, newest first, for a manager listing. Charts saved before
 * summaries existed are read in full once and given one.
 */
export async function listUserCharts(): Promise<SavedChartSummary[]> {
  let stored: IDBValidKey[];
  let summaries: unknown[];
  let ids: string[];
  try {
    stored = await keys();
    ids = stored.filter((key): key is string => typeof key === "string" && key.startsWith(PREFIX)).map((key) => key.slice(PREFIX.length));
    summaries = ids.length ? await getMany(ids.map(summaryKey)) : [];
  } catch (error) {
    console.warn("TopoStack: saved depth charts are unavailable in this browser.", error);
    return [];
  }
  const listed: SavedChartSummary[] = [];
  for (const [index, id] of ids.entries()) {
    const summary = summaries[index];
    if (isSummary(summary) && typeof summary.reviewed === "boolean") { listed.push(summary); continue; }
    const saved = await get<Partial<StoredChart>>(chartKey(id)).catch(() => undefined);
    const loaded = saved && await readStored(id, saved);
    if (!loaded) continue;
    const backfilled = summaryOf(loaded.chart, typeof saved.savedAt === "string" ? saved.savedAt : "", loaded.contentHash);
    await set(summaryKey(id), backfilled).catch(() => undefined);
    listed.push(backfilled);
  }
  return listed.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : a.id.localeCompare(b.id)));
}

/**
 * The project's chart references with each content hash made current. A chart
 * saved again under the same id (a project imported with a newer copy) carves
 * as it is now, so the reference, and with it the design's fingerprint, must
 * say so. Returns the same object when nothing changed, and leaves a chart
 * this browser does not hold as it was.
 */
export async function currentChartReferences(references: Record<string, UserDepthChartRefV1> | undefined): Promise<Record<string, UserDepthChartRefV1> | undefined> {
  if (!references) return references;
  let changed = false;
  const next: Record<string, UserDepthChartRefV1> = {};
  for (const [lake, reference] of Object.entries(references)) {
    const summary = await get<unknown>(summaryKey(reference.id)).catch(() => undefined);
    const stored = isSummary(summary) ? summary.contentHash : (await loadUserChart(reference.id))?.contentHash;
    if (stored && stored !== reference.contentHash) { next[lake] = { id: reference.id, contentHash: stored }; changed = true; }
    else next[lake] = reference;
  }
  return changed ? next : references;
}

export async function deleteUserChart(id: string): Promise<void> {
  await del(chartKey(id));
  await del(summaryKey(id));
}

/** At most this many charts travel with one project file. */
const MAX_PROJECT_CHARTS = 16;

/** The charts an exported project must carry, so it opens on another device. */
export async function chartsForProject(config: Pick<ProjectConfigV1, "userDepthCharts">): Promise<UserChartBathymetryV1[]> {
  const ids = [...new Set(Object.values(config.userDepthCharts ?? {}).map((reference) => reference.id))].slice(0, MAX_PROJECT_CHARTS);
  const charts: UserChartBathymetryV1[] = [];
  for (const id of ids) {
    const loaded = await loadUserChart(id);
    if (loaded) charts.push(loaded.chart);
  }
  return charts;
}

/**
 * Save the charts that arrived with an imported project. Only charts the
 * project actually references are kept, so a file cannot fill this browser's
 * storage with charts nothing uses, and an unreadable one is skipped rather
 * than failing the import: that lake falls back to the survey providers.
 */
export async function saveProjectCharts(value: unknown, config: Pick<ProjectConfigV1, "userDepthCharts">): Promise<{ saved: number; skipped: number }> {
  if (!Array.isArray(value) || !value.length) return { saved: 0, skipped: 0 };
  const wanted = new Set(Object.values(config.userDepthCharts ?? {}).map((reference) => reference.id));
  let saved = 0;
  let skipped = 0;
  for (const item of value.slice(0, MAX_PROJECT_CHARTS)) {
    try {
      const chart = parseUserChartBathymetry(item);
      if (!wanted.has(chart.id)) { skipped += 1; continue; }
      await saveUserChart(chart);
      saved += 1;
    } catch (error) {
      console.warn("TopoStack: a depth chart in this project file could not be read.", error);
      skipped += 1;
    }
  }
  return { saved, skipped };
}
