import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { USAGE_CAMPAIGNS, USAGE_CHANNELS, USAGE_MEDIUMS, USAGE_SOURCES } from "@topostack/data-contracts/usage";
import { collectBaseline, usageQuery, usageSummary } from "../verify/growth-baseline.mjs";

test("baseline requests production aggregates over an explicit timezone range", () => {
  const query = usageQuery("2026-10-02T00:00:00-06:00", "2026-10-08T00:00:00-06:00");
  assert.equal(query.timeframe.from, Date.parse("2026-10-02T06:00:00Z"));
  assert.equal(query.view, "calculations");
  assert.equal(query.dry, true);
  assert.deepEqual(query.parameters.groupBys.map((group) => group.value), ["event", "source"]);
  assert.deepEqual(usageQuery("2026-10-02T00:00:00Z", "2026-10-08T00:00:00Z", "channel").parameters.groupBys.map((group) => group.value), ["event", "channel"]);
  assert.ok(query.parameters.filters.some((filter) => filter.key === "$metadata.service" && filter.value === "topostack"));
  assert.ok(query.parameters.filters.some((filter) => filter.key === "environment" && filter.value === "production"));
  assert.throws(() => usageQuery("2026-10-02", "2026-10-08"), /timezone/);
  assert.throws(() => usageQuery("2026-10-08T00:00:00Z", "2026-10-02T00:00:00Z"), /increasing/);
});

test("launch and README campaign links use recognized attribution tags", async () => {
  for (const path of ["README.md", "docs/launch/posts.md", "docs/launch/creator-pitch.md"]) {
    const contents = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
    const links = [...contents.matchAll(/https:\/\/topostack\.app[^\s)>`]+/g)].map((match) => new URL(match[0])).filter((url) => url.searchParams.has("utm_source"));
    assert.ok(links.length > 0, path);
    for (const url of links) {
      for (const [parameter, allowed] of [["utm_source", USAGE_SOURCES], ["utm_medium", USAGE_MEDIUMS], ["utm_campaign", USAGE_CAMPAIGNS], ["utm_content", USAGE_CHANNELS]]) {
        assert.ok(allowed.includes(url.searchParams.get(parameter)), `${path}: invalid ${parameter} on ${url.pathname}`);
      }
    }
  }
});

const result = (aggregates) => ({ run: { status: "COMPLETED", timeframe: { from: 10, to: 20 }, accountId: "private" }, statistics: { abr_level: 1 }, calculations: [{ aggregates }] });
test("provider weighted counts are not multiplied again and missing channels stay unknown", () => {
  const summary = usageSummary(result([
    { groups: [{ key: "event", value: "export_prepared" }, { key: "source", value: "direct" }], value: 80, sampleInterval: 10 },
    { groups: [{ key: "event", value: "export_prepared" }, { key: "source", value: "social" }], value: 3, sampleInterval: 1 },
  ]));
  assert.equal(summary.byEvent.export_prepared, 83);
  assert.equal(summary.sampled, true);
  assert.equal(summary.rows[0].channel, "none");
  assert.deepEqual(summary.actualTimeframe, { from: 10, to: 20 });
  assert.ok(!JSON.stringify(summary).includes("private"));
});
test("empty, unfinished, invalid and truncated queries cannot masquerade as complete totals", () => {
  assert.equal(usageSummary(result([])).status, "no-matching-events");
  assert.throws(() => usageSummary({ run: { status: "STARTED" } }), /completed/);
  assert.throws(() => usageSummary(result([{ value: -1 }])), /invalid/);
  assert.throws(() => usageSummary(result(Array.from({ length: 2_000 }, () => ({ value: 1 })))), /row limit/);
});

test("capture retains legacy totals when channel data is absent and exposes partial query failures", async (t) => {
  const savedAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const savedToken = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  process.env.CLOUDFLARE_API_TOKEN = "baseline-fixture-token";
  t.after(() => {
    if (savedAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = savedAccount;
    if (savedToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = savedToken;
  });
  let rejectChannel = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/rum/site_info/list")) return Response.json({ success: true, result: [{ site_tag: "private-site-tag", ruleset: { zone_name: "topostack.app" } }] });
    if (url.endsWith("/graphql")) return Response.json({ data: { viewer: { accounts: [{ totals: [{ count: 4, sum: { visits: 3 }, avg: { sampleInterval: 1 } }], referrers: [], devices: [] }] } } });
    const query = JSON.parse(init.body);
    const dimension = query.parameters.groupBys[1].value;
    if (dimension === "channel" && rejectChannel) return Response.json({ success: false, errors: [{ code: 1 }] }, { status: 403 });
    return Response.json({ success: true, result: result(dimension === "channel" ? [] : [{ groups: [{ key: "event", value: "export_prepared" }, { key: dimension, value: "direct" }], value: 80, sampleInterval: 10 }]) });
  });
  const report = await collectBaseline("2026-10-02T00:00:00Z", "2026-10-08T00:00:00Z");
  assert.equal(report.usage.status, "available");
  assert.equal(report.usage.byEvent.export_prepared, 80);
  assert.equal(report.usage.breakdowns.channel.status, "no-matching-events");
  assert.equal(report.traffic.totals[0].sum.visits, 3);
  assert.equal(report.search.status, "awaiting-search-console-export");
  assert.ok(!JSON.stringify(report).includes("baseline-fixture-token"));
  assert.ok(!JSON.stringify(report).includes("private-site-tag"));
  rejectChannel = true;
  const partial = await collectBaseline("2026-10-02T00:00:00Z", "2026-10-08T00:00:00Z");
  assert.equal(partial.usage.status, "partial");
  assert.equal(partial.usage.byEvent.export_prepared, 80);
  assert.equal(partial.usage.breakdowns.channel.status, "unavailable");
});
