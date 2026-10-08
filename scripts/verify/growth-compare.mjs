import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { USAGE_EVENTS } from "@topostack/data-contracts/usage";

const DIMENSIONS = ["channel", "source", "landing", "device", "output"];
const DIMENSION_EVENTS = ["studio_open", "generation_started", "generation_succeeded", "generation_failed", "export_prepared"];
const count = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const available = (section) => ["available", "partial"].includes(section?.status);

function windowOf(snapshot) {
  if (snapshot?.version !== 1) throw new Error("Only version 1 growth snapshots are supported.");
  const timestamps = [snapshot.from, snapshot.to].map((value) => {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Snapshot timestamps require explicit timezone offsets.");
    return Date.parse(value);
  });
  if (timestamps[0] >= timestamps[1]) throw new Error("Snapshot window must be increasing.");
  return { from: timestamps[0], to: timestamps[1], duration: timestamps[1] - timestamps[0] };
}

function effectiveWindow(section, requested) {
  const actual = section?.actualTimeframe;
  return actual?.from === requested.from && actual?.to === requested.to;
}

function metric(name, previous, current, comparable) {
  return { name, previous, current, change: comparable && previous !== null && current !== null ? current - previous : null, percent: comparable && previous !== null && current !== null && previous > 0 ? (current - previous) / previous * 100 : null };
}

function dimensionCounts(snapshot, dimension) {
  const section = snapshot.usage?.breakdowns?.[dimension];
  if (!available(section)) return new Map();
  const result = new Map();
  for (const row of section.rows ?? []) {
    if (!DIMENSION_EVENTS.includes(row.event)) continue;
    if (typeof row.value !== "string" || count(row.count) === null) throw new Error(`Invalid ${dimension} breakdown row.`);
    const key = `${row.event}\u0000${row.value}`;
    result.set(key, (result.get(key) ?? 0) + row.count);
  }
  return result;
}

/** Missing observations remain unknown; provider-weighted counts are never resampled here. */
export function compareBaselines(previous, current) {
  const before = windowOf(previous);
  const after = windowOf(current);
  const warnings = ["Counts describe aggregate events and provider traffic, not unique makers, retention or a joined conversion funnel. Export preparation does not prove a saved file or physical build.", "A missing event or category is not observed, not zero. Missing values have no calculated change."];
  const equalWindows = before.duration === after.duration;
  if (!equalWindows) warnings.push("Requested windows have different elapsed durations. Changes and ratios are suppressed; capture equal-length windows.");
  if (before.to > after.from) warnings.push("The windows overlap or are out of chronological order. Changes and ratios are suppressed; use separate earlier and later windows.");
  const comparable = equalWindows && before.to <= after.from;
  const usageComparable = comparable && effectiveWindow(previous.usage, before) && effectiveWindow(current.usage, after);
  for (const [label, snapshot, window] of [["Previous", previous, before], ["Current", current, after]]) {
    if (!effectiveWindow(snapshot.usage, window)) warnings.push(`${label} usage effective timeframe is missing or differs from its requested window. Usage changes and ratios are suppressed.`);
    for (const section of ["usage", "traffic"]) {
      if (snapshot[section]?.status !== "available") warnings.push(`${label} ${section}: ${snapshot[section]?.status ?? "missing"}. Check capture availability before interpreting results.`);
    }
    const trafficSample = snapshot.traffic?.totals?.some((row) => row.avg?.sampleInterval > 1);
    if (snapshot.usage?.sampled || snapshot.usage?.adaptiveSamplingLevel > 1 || trafficSample) warnings.push(`${label} snapshot reports sampling. Counts and differences are estimates; small changes are inconclusive.`);
    warnings.push(`${label} Search Console: ${snapshot.search?.status ?? "missing"}; search data is not substituted with zero.`);
  }
  const channelCoverage = [previous, current].map((snapshot) => snapshot.usage?.breakdowns?.channel?.status === "available");
  if (channelCoverage[0] !== channelCoverage[1]) warnings.push("Channel coverage differs between snapshots. Legacy events lack channels; the channel release also reclassified some referrer hosts. Check release versions before comparing broad sources.");
  const usageCount = (snapshot, event) => available(snapshot.usage) ? count(snapshot.usage.byEvent?.[event]) : null;
  const trafficCount = (snapshot, key) => available(snapshot.traffic) && snapshot.traffic.totals?.length ? snapshot.traffic.totals.reduce((sum, row) => {
    const value = count(key === "visits" ? row.sum?.visits : row.count);
    return sum === null || value === null ? null : sum + value;
  }, 0) : null;
  const metrics = [
    ...["visits", "page_views"].map((key) => metric(key, trafficCount(previous, key), trafficCount(current, key), comparable)),
    ...USAGE_EVENTS.map((event) => metric(event, usageCount(previous, event), usageCount(current, event), usageComparable)),
  ];
  const ratios = [
    ["Generation successes / starts (aggregate outcome ratio)", "generation_succeeded", "generation_started"],
    ["Prepared exports / studio entries (event ratio, not conversion)", "export_prepared", "studio_open"],
  ].map(([name, numerator, denominator]) => {
    const value = (snapshot) => {
      const n = usageCount(snapshot, numerator); const d = usageCount(snapshot, denominator);
      return n !== null && d !== null && d > 0 ? n / d * 100 : null;
    };
    return { name, previous: usageComparable ? value(previous) : null, current: usageComparable ? value(current) : null };
  });
  const breakdowns = {};
  for (const dimension of DIMENSIONS) {
    const a = dimensionCounts(previous, dimension); const b = dimensionCounts(current, dimension);
    const sections = [previous.usage?.breakdowns?.[dimension], current.usage?.breakdowns?.[dimension]];
    const valid = comparable && effectiveWindow(sections[0], before) && effectiveWindow(sections[1], after);
    if (sections.some((section) => !available(section) || !effectiveWindow(section, section === sections[0] ? before : after))) warnings.push(`${dimension} breakdown is missing, incomplete or has a different effective window. Its changes are suppressed.`);
    breakdowns[dimension] = [...new Set([...a.keys(), ...b.keys()])].sort().map((key) => {
      const [event, category] = key.split("\u0000");
      return { event, category, ...metric(key, a.get(key) ?? null, b.get(key) ?? null, valid) };
    });
  }
  return { previous: { from: previous.from, to: previous.to }, current: { from: current.from, to: current.to }, warnings, metrics, ratios, breakdowns };
}

const cell = (value) => value === null ? "not observed / unavailable" : Number(value.toFixed(2)).toLocaleString("en-US");
const escape = (value) => String(value).replace(/[|\r\n]/g, " ");
const change = (row) => row.change === null ? "—" : `${row.change > 0 ? "+" : ""}${cell(row.change)}${row.percent === null ? "" : ` (${row.percent > 0 ? "+" : ""}${cell(row.percent)}%)`}`;

export function comparisonMarkdown(report) {
  const out = ["# Growth snapshot comparison", "", `Previous: ${report.previous.from} → ${report.previous.to}`, `Current: ${report.current.from} → ${report.current.to}`, "", "## Interpretation", "", ...report.warnings.map((warning) => `- ${warning}`), "", "## Traffic and events", "", "| Measure | Previous | Current | Change |", "| --- | ---: | ---: | ---: |", ...report.metrics.map((row) => `| ${escape(row.name)} | ${cell(row.previous)} | ${cell(row.current)} | ${change(row)} |`), "", "## Aggregate ratios", "", "These percentages describe events, not user conversion. No ranking of channel effectiveness is inferred.", "", "| Measure | Previous | Current |", "| --- | ---: | ---: |", ...report.ratios.map((row) => `| ${row.name} | ${row.previous === null ? "—" : `${cell(row.previous)}%`} | ${row.current === null ? "—" : `${cell(row.current)}%`} |`)];
  for (const [dimension, rows] of Object.entries(report.breakdowns)) out.push("", `## ${dimension}`, "", ...(rows.length ? ["| Category | Event | Previous | Current | Change |", "| --- | --- | ---: | ---: | ---: |", ...rows.map((row) => `| ${escape(row.category)} | ${row.event} | ${cell(row.previous)} | ${cell(row.current)} | ${change(row)} |`)] : ["No comparable observations available."]));
  return `${out.join("\n")}\n`;
}

async function main() {
  const [before, after, output, ...extra] = process.argv.slice(2);
  if (!before || !after || !output || extra.length) throw new Error("Usage: node scripts/verify/growth-compare.mjs <previous.json> <current.json> <output.md>");
  const [previous, current] = await Promise.all([before, after].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const report = compareBaselines(previous, current);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, comparisonMarkdown(report), { flag: "wx" });
  console.log(`Saved comparison to ${output}; ${report.warnings.length} interpretation notes. No API requests made.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
