#!/usr/bin/env node
// The deployment gate on runtime dependencies: `npm audit --omit=dev` at high
// severity, except for advisories listed in AUDIT_EXCEPTIONS. Each exception
// names its reason and a review date; after that date the gate fails on it
// again until someone re-checks it and either removes it or moves the date.
import { spawnSync } from "node:child_process";
import { isMainModule } from "../lib/main-module.mjs";

/**
 * Advisories the gate skips. Keep this list short: an entry belongs here only
 * when no patched release exists and the package cannot reach shipped code.
 */
export const AUDIT_EXCEPTIONS = [];

const SEVERITY = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/** The GHSA id at the end of an advisory URL, or the URL itself. */
export function advisoryId(via) {
  const url = typeof via?.url === "string" ? via.url : "";
  return url.match(/GHSA-[\w-]+$/)?.[0] ?? url;
}

/**
 * Packages in an `npm audit --json` report that still fail the gate. A package
 * fails when any advisory it is affected by, directly or through the packages
 * it depends on, reaches `level` and is not an active exception. Exceptions past
 * their review date stop applying and are returned as `expired`.
 */
export function findBlockingVulnerabilities(report, { level = "high", exceptions = AUDIT_EXCEPTIONS, today = new Date().toISOString().slice(0, 10) } = {}) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const threshold = SEVERITY[level] ?? SEVERITY.high;
  const active = new Set(exceptions.filter((entry) => entry.reviewBy >= today).map((entry) => entry.id));
  const expired = exceptions.filter((entry) => entry.reviewBy < today);
  const reported = new Set();

  // Advisories at or above the threshold that affect `name`, following `via` package names.
  // Walked afresh for each package: reports are small, and a cached result cut short by a cycle would be wrong.
  function advisoriesFor(name, seen = new Set()) {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const found = new Set();
    for (const via of vulnerabilities[name]?.via ?? []) {
      if (typeof via === "string") {
        for (const id of advisoriesFor(via, seen)) found.add(id);
        continue;
      }
      const id = advisoryId(via);
      reported.add(id);
      if ((SEVERITY[via.severity] ?? 0) >= threshold && !active.has(id)) found.add(id);
    }
    return found;
  }

  const blocking = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const advisories = advisoriesFor(name);
    if (advisories.size) blocking.push({ name, severity: entry.severity, advisories: [...advisories].sort() });
  }
  const skipped = exceptions.filter((entry) => active.has(entry.id) && reported.has(entry.id));
  const stale = exceptions.filter((entry) => !reported.has(entry.id));
  return { blocking, skipped, expired, stale };
}

function runAudit() {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    process.stderr.write(result.stderr);
    throw new Error("npm audit did not print a JSON report.");
  }
}

if (isMainModule(import.meta.url)) {
  const report = runAudit();
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
    process.exit(1);
  }
  const { blocking, skipped, expired, stale } = findBlockingVulnerabilities(report);
  for (const entry of skipped) console.log(`Skipping ${entry.id} (${entry.package}) until ${entry.reviewBy}: ${entry.reason}`);
  for (const entry of stale) console.log(`Exception ${entry.id} (${entry.package}) is no longer reported; remove it from scripts/verify/check-audit.mjs.`);
  for (const entry of expired) console.error(`Exception ${entry.id} (${entry.package}) passed its review date ${entry.reviewBy}: re-check the advisory, then remove the entry or move the date.`);
  if (blocking.length) {
    console.error("High-severity advisories in runtime dependencies:");
    for (const entry of blocking) console.error(`  ${entry.name} (${entry.severity}): ${entry.advisories.join(", ")}`);
    console.error("Run `npm audit --omit=dev` for details.");
    process.exit(1);
  }
  console.log("No unreviewed high-severity advisories in runtime dependencies.");
}
