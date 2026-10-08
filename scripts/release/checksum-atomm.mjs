import { execFileSync } from "node:child_process";
import { sha256Hex } from "../lib/hash.mjs";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "../lib/files.mjs";
import { atommReleaseFiles } from "../lib/atomm-release-files.mjs";
import { readVersions } from "./versions.mjs";

// Every check runs before any release output is written, so a failed release
// never leaves a checksum or receipt describing an unverified archive.
const rawApiUrl = process.env.VITE_MAP_API_URL;
if (!rawApiUrl) {
  console.error("VITE_MAP_API_URL is required to record Atomm release evidence (use the same value as `npm run package:atomm`).");
  process.exit(1);
}
let apiOrigin;
try {
  apiOrigin = new URL(rawApiUrl).origin;
} catch {
  console.error(`VITE_MAP_API_URL is not a valid URL: ${JSON.stringify(rawApiUrl)}`);
  process.exit(1);
}

const versions = await readVersions();
const files = atommReleaseFiles(versions.atommVersion);
const archiveUrl = new URL(`../../apps/generator/${files.archive}`, import.meta.url);
const archive = await readFile(archiveUrl);
const digest = sha256Hex(archive);

async function readApi(path) {
  const response = await fetch(new URL(path, apiOrigin), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Release evidence ${path} returned HTTP ${response.status}.`);
  return response.json();
}
const [manifest, readiness] = await Promise.all([readApi("/v1/manifest"), readApi("/ready")]);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const build = JSON.parse(execFileSync("unzip", ["-p", fileURLToPath(archiveUrl), "version.json"], { encoding: "utf8" }));
assert.equal(build.environment, "atomm");
assert.equal(build.version, versions.version);
assert.equal(build.atommVersion, versions.atommVersion);
assert.equal(build.commit, commit);
const receipt = {
  ...versions,
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  commit,
  workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  archive: files.archive, sha256: digest, bytes: archive.byteLength,
  apiOrigin, datasetVersion: manifest.datasetVersion,
  vectorData: readiness.dependencies.vectorData,
  lakeData: readiness.dependencies.lakeData,
};

const outputs = [
  [fileURLToPath(new URL(`../../apps/generator/${files.checksum}`, import.meta.url)), `${digest}  ${files.archive}\n`],
  [fileURLToPath(new URL(`../../apps/generator/${files.receipt}`, import.meta.url)), JSON.stringify(receipt, null, 2) + "\n"],
];
// Each output replaces its predecessor only once fully written and fsynced.
for (const [target, contents] of outputs) await writeFileAtomic(target, contents);
console.log(`SHA-256 ${digest}`);
