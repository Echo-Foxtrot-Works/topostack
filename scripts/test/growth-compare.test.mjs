import assert from "node:assert/strict";
import { test } from "node:test";
import { compareBaselines, comparisonMarkdown } from "../verify/growth-compare.mjs";

function snapshot(from, to, values = { studio_open: 10, export_prepared: 20 }) {
  const actualTimeframe = { from: Date.parse(from), to: Date.parse(to) };
  return { version: 1, from, to, usage: { status: "available", actualTimeframe, sampled: true, byEvent: values, breakdowns: { channel: { status: "available", actualTimeframe, rows: [{ event: "studio_open", value: "lightburn-forum", count: values.studio_open, sampleInterval: 10 }] } } }, traffic: { status: "available", totals: [{ count: 30, sum: { visits: 12 }, avg: { sampleInterval: 1 } }] }, search: { status: "awaiting-search-console-export" } };
}
const pair = () => [snapshot("2026-10-02T00:00:00Z", "2026-10-08T00:00:00Z"), snapshot("2026-10-08T00:00:00Z", "2026-10-14T00:00:00Z", { studio_open: 20, export_prepared: 30 })];

test("compares weighted counts once and permits export event ratios above 100%", () => {
  const report = compareBaselines(...pair());
  assert.deepEqual(report.metrics.find((row) => row.name === "studio_open"), { name: "studio_open", previous: 10, current: 20, change: 10, percent: 100 });
  assert.equal(report.breakdowns.channel[0].change, 10);
  assert.equal(report.ratios[1].previous, 200);
  assert.ok(report.warnings.some((warning) => warning.includes("sampling")));
});
test("keeps missing events, unavailable queries and old channel coverage unknown", () => {
  const [before, after] = pair();
  before.usage.breakdowns.channel = { status: "no-matching-events", rows: [] };
  after.traffic = { status: "unavailable" };
  const report = compareBaselines(before, after);
  assert.equal(report.metrics.find((row) => row.name === "generation_failed").current, null);
  assert.equal(report.metrics.find((row) => row.name === "visits").change, null);
  assert.equal(report.breakdowns.channel[0].previous, null);
  assert.equal(report.breakdowns.channel[0].change, null);
  assert.match(comparisonMarkdown(report), /Legacy events lack channels/);
  assert.match(comparisonMarkdown(report), /awaiting-search-console-export/);
});
test("suppresses misleading changes for unequal, overlapping and clipped windows", () => {
  for (const mutate of [
    (before) => { before.to = "2026-10-07T00:00:00Z"; },
    (_before, after) => { after.from = "2026-10-07T00:00:00Z"; after.to = "2026-10-13T00:00:00Z"; },
    (before) => { before.usage.actualTimeframe.from += 1000; },
  ]) {
    const snapshots = pair(); mutate(...snapshots);
    const report = compareBaselines(...snapshots);
    assert.equal(report.metrics.find((row) => row.name === "studio_open").change, null);
    assert.equal(report.ratios[1].previous, null);
  }
});
test("rejects unknown schemas and ambiguous timezones and escapes table categories", () => {
  const [before, after] = pair();
  assert.throws(() => compareBaselines({ ...before, version: 2 }, after), /version 1/);
  assert.throws(() => compareBaselines({ ...before, from: "2026-10-02" }, after), /timezone/);
  after.usage.breakdowns.channel.rows[0].value = "value|extra\nline";
  assert.match(comparisonMarkdown(compareBaselines(before, after)), /value extra line/);
});
