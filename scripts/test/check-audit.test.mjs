import assert from "node:assert/strict";
import test from "node:test";
import { advisoryId, findBlockingVulnerabilities } from "../verify/check-audit.mjs";

const advisory = (id, severity) => ({ source: 1, name: "x", url: `https://github.com/advisories/${id}`, severity, title: id, range: "*" });

// The shape `npm audit --json` reported for the picomatch ReDoS: one advisory, and the packages that depend on it.
const picomatchReport = {
  vulnerabilities: {
    picomatch: { name: "picomatch", severity: "high", via: [advisory("GHSA-fc5q-39xc-vjpf", "high")] },
    fdir: { name: "fdir", severity: "high", via: ["picomatch"] },
    tinyglobby: { name: "tinyglobby", severity: "high", via: ["fdir", "picomatch"] },
    vite: { name: "vite", severity: "high", via: ["picomatch", "tinyglobby"] },
    "@sveltejs/vite-plugin-svelte": { name: "@sveltejs/vite-plugin-svelte", severity: "high", via: ["vite"] },
  },
};
const exception = { id: "GHSA-fc5q-39xc-vjpf", package: "picomatch", reason: "test", reviewBy: "2026-12-18" };

test("reads the GHSA id from an advisory URL", () => {
  assert.equal(advisoryId(advisory("GHSA-fc5q-39xc-vjpf", "high")), "GHSA-fc5q-39xc-vjpf");
});

test("an active exception clears the advisory and every package that only depends on it", () => {
  const result = findBlockingVulnerabilities(picomatchReport, { exceptions: [exception], today: "2026-11-18" });
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.skipped, [exception]);
  assert.deepEqual(result.expired, []);
  assert.deepEqual(result.stale, []);
});

test("without the exception every package in the chain blocks", () => {
  const result = findBlockingVulnerabilities(picomatchReport, { exceptions: [], today: "2026-11-18" });
  assert.deepEqual(result.blocking.map((entry) => entry.name).sort(), ["@sveltejs/vite-plugin-svelte", "fdir", "picomatch", "tinyglobby", "vite"]);
});

test("an exception past its review date stops applying", () => {
  const result = findBlockingVulnerabilities(picomatchReport, { exceptions: [exception], today: "2026-12-19" });
  assert.equal(result.blocking.length, 5);
  assert.deepEqual(result.expired, [exception]);
});

test("another advisory in the same chain still blocks", () => {
  const report = structuredClone(picomatchReport);
  report.vulnerabilities.vite.via.push(advisory("GHSA-aaaa-bbbb-cccc", "critical"));
  const result = findBlockingVulnerabilities(report, { exceptions: [exception], today: "2026-11-18" });
  assert.deepEqual(result.blocking.map((entry) => [entry.name, entry.advisories]), [["vite", ["GHSA-aaaa-bbbb-cccc"]], ["@sveltejs/vite-plugin-svelte", ["GHSA-aaaa-bbbb-cccc"]]]);
});

test("advisories below the level do not block, and unreported exceptions are flagged stale", () => {
  const report = { vulnerabilities: { left: { name: "left", severity: "moderate", via: [advisory("GHSA-low0-0000-0000", "moderate")] } } };
  const result = findBlockingVulnerabilities(report, { exceptions: [exception], today: "2026-11-18" });
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.stale, [exception]);
});

test("a dependency cycle between flagged packages terminates", () => {
  const report = { vulnerabilities: { a: { name: "a", severity: "high", via: ["b", advisory("GHSA-cycl-e000-0000", "high")] }, b: { name: "b", severity: "high", via: ["a"] } } };
  const result = findBlockingVulnerabilities(report, { exceptions: [], today: "2026-11-18" });
  assert.deepEqual(result.blocking.map((entry) => entry.name).sort(), ["a", "b"]);
});
