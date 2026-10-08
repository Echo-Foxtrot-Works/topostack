import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareClient } from "../lib/cloudflare-client.mjs";

const GROUPS = ["event", "source", "campaign", "medium", "channel", "landing", "device", "output", "delivery"];
const ROW_LIMIT = 2_000;

export function usageQuery(from, to, dimension = "source") {
  if (!GROUPS.includes(dimension) || dimension === "event") throw new Error("Unknown usage dimension.");
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
    throw new Error("Use an increasing ISO timestamp range with explicit timezone offsets.");
  }
  if (![from, to].every((value) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value))) throw new Error("Timestamps require an explicit timezone offset.");
  return {
    queryId: "topostack-growth-baseline", view: "calculations", chartType: "aggregate", ignoreSeries: true, dry: true, limit: ROW_LIMIT,
    timeframe: { from: Date.parse(from), to: Date.parse(to) },
    parameters: {
      datasets: ["cloudflare-workers"], filterCombination: "and",
      filters: [
        { key: "$metadata.service", operation: "eq", type: "string", value: "topostack" },
        { key: "message", operation: "eq", type: "string", value: "usage_event" },
        { key: "environment", operation: "eq", type: "string", value: "production" },
      ],
      calculations: [{ operator: "count", alias: "events" }],
      // Grouping by an absent optional field excludes legacy rows at the
      // provider. Query each dimension separately; source supplies the totals.
      groupBys: ["event", dimension].map((value) => ({ type: "string", value })), limit: ROW_LIMIT,
    },
  };
}

export function usageSummary(result) {
  if (result.run?.status !== "COMPLETED" || !Array.isArray(result.calculations?.[0]?.aggregates)) throw new Error("Usage query did not return completed aggregates.");
  const aggregates = result.calculations[0].aggregates;
  if (aggregates.length >= ROW_LIMIT) throw new Error("Usage breakdown reached its row limit; split the date range before reporting.");
  const rows = aggregates.map((row) => ({
    event: "none", source: "none", channel: "none",
    ...Object.fromEntries((row.groups ?? []).filter((group) => GROUPS.includes(group.key)).map((group) => [group.key, group.value || "none"])),
    count: row.value, sampleInterval: row.sampleInterval ?? row.interval ?? 1,
  }));
  if (rows.some((row) => !Number.isFinite(row.count) || row.count < 0 || !Number.isFinite(row.sampleInterval) || row.sampleInterval < 1)) throw new Error("Usage query returned invalid counts or sampling intervals.");
  const byEvent = {};
  for (const row of rows) byEvent[row.event] = (byEvent[row.event] ?? 0) + row.count;
  return {
    status: rows.length ? "available" : "no-matching-events", actualTimeframe: result.run.timeframe,
    sampled: rows.some((row) => row.sampleInterval > 1), adaptiveSamplingLevel: result.statistics?.abr_level ?? 1,
    byEvent, rows,
  };
}

async function collectUsageBaseline(from, to) {
  const cf = cloudflareClient();
  const dimensions = GROUPS.filter((key) => key !== "event");
  const results = await Promise.allSettled(dimensions.map(async (dimension) => usageSummary(await cf(
    "/workers/observability/telemetry/query", { method: "POST", body: JSON.stringify(usageQuery(from, to, dimension)) },
  ))));
  const total = results[0];
  if (total.status !== "fulfilled") throw total.reason;
  const breakdowns = {};
  for (const [index, dimension] of dimensions.entries()) {
    const result = results[index];
    breakdowns[dimension] = result.status === "fulfilled" ? {
      status: result.value.status, sampled: result.value.sampled,
      actualTimeframe: result.value.actualTimeframe,
      rows: result.value.rows.map((row) => ({ event: row.event, value: row[dimension] ?? "none", count: row.count, sampleInterval: row.sampleInterval })),
    } : { status: "unavailable", reason: result.reason.message };
  }
  return { ...total.value, status: results.some((result) => result.status === "rejected") ? "partial" : total.value.status, breakdowns };
}

async function trafficSummary(from, to) {
  const cf = cloudflareClient();
  const sites = await cf("/rum/site_info/list");
  const site = sites.find((candidate) => candidate.ruleset?.zone_name === "topostack.app" || candidate.host === "topostack.app");
  if (!site?.site_tag) throw new Error("No Web Analytics site found for topostack.app.");
  const filter = { datetime_geq: from, datetime_lt: to, siteTag: site.site_tag, requestHost: "topostack.app" };
  const query = `query GrowthBaseline($account: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
    viewer { accounts(filter: {accountTag: $account}) {
      totals: rumPageloadEventsAdaptiveGroups(limit: 1, filter: $filter) { count sum { visits } avg { sampleInterval } }
      referrers: rumPageloadEventsAdaptiveGroups(limit: 20, filter: $filter, orderBy: [count_DESC]) { count sum { visits } dimensions { refererHost } avg { sampleInterval } }
      devices: rumPageloadEventsAdaptiveGroups(limit: 20, filter: $filter, orderBy: [count_DESC]) { count dimensions { deviceType } avg { sampleInterval } }
    } }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { account: process.env.CLOUDFLARE_ACCOUNT_ID, filter } }), signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  // Keep provider errors and account identifiers out of saved reports.
  if (!response.ok || payload.errors?.length) throw new Error(`Web Analytics query failed (HTTP ${response.status}; check token permissions and GraphQL schema).`);
  const data = payload.data?.viewer?.accounts?.[0];
  if (!data || !Array.isArray(data.totals)) throw new Error("Web Analytics returned no account data.");
  return { status: data.totals.length ? "available" : "no-matching-events", ...data };
}

export async function collectBaseline(from, to) {
  usageQuery(from, to);
  const report = {
    version: 1, capturedAt: new Date().toISOString(), timezone: "America/Denver", from, to,
    interpretation: "Aggregate events and Web Analytics visits, not unique users or a joined conversion funnel. Sampled counts are estimates; missing events do not prove zero usage. export_prepared is file handoff, not a completed physical build.",
    search: { status: "awaiting-search-console-export" },
  };
  const results = await Promise.allSettled([
    collectUsageBaseline(from, to),
    trafficSummary(new Date(Date.parse(from)).toISOString(), new Date(Date.parse(to)).toISOString()),
  ]);
  for (const [index, name] of ["usage", "traffic"].entries()) {
    const result = results[index];
    report[name] = result.status === "fulfilled" ? result.value : { status: "unavailable", reason: result.reason.message };
  }
  return report;
}

async function main() {
  const [from, to, output] = process.argv.slice(2);
  if (!from || !to || !output) throw new Error("Usage: node --env-file-if-exists=.env scripts/verify/growth-baseline.mjs <from-ISO> <to-ISO> <output.json>");
  const report = await collectBaseline(from, to);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output, usage: report.usage.status, traffic: report.traffic.status, search: report.search.status, sampledUsage: report.usage.sampled, events: report.usage.byEvent }));
  if (["unavailable", "partial"].includes(report.usage.status) || report.traffic.status === "unavailable") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
