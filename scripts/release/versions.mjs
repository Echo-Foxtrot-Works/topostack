import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isMainModule } from "../lib/main-module.mjs";

const root = new URL("../../", import.meta.url);
const workspaces = ["apps/generator", "packages/chart-trace", "packages/core", "packages/data-contracts", "packages/nest-wasm", "workers/map-api"];
const numeric = "(?:0|[1-9]\\d*)";
const identifier = `(?:${numeric}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`);

export function validateVersion(version) {
  assert.equal(typeof version, "string", "Version must be a string");
  assert.equal(version.trim(), version, "Version must not contain surrounding whitespace");
  assert.match(version, semver, "Use SemVer, for example 0.2.0 or 1.0.0-rc.1 (without build metadata)");
  return version;
}

export function nextVersion(current, bump) {
  validateVersion(current);
  if (!["major", "minor", "patch"].includes(bump)) return validateVersion(bump);
  const [major, minor, patch] = current.split("-")[0].split(".").map(BigInt);
  if (bump === "major") return `${major + 1n}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1n}.0`;
  // Promote a prerelease to its corresponding stable version.
  return `${major}.${minor}.${current.includes("-") ? patch : patch + 1n}`;
}

// The web app and the Atomm package release together under one version.
// atomm/version.json mirrors it so the package metadata stays self-describing,
// and atommVersion is kept in the returned shape for the packaging scripts.
export async function readVersions(base = root) {
  const read = async (path) => JSON.parse(await readFile(new URL(path, base), "utf8"));
  const main = await read("package.json");
  const atomm = await read("atomm/version.json");
  const version = validateVersion(main.version);
  assert.equal(atomm.version, version, "atomm/version.json is out of sync; the Atomm package releases with the main version");
  const lock = await read("package-lock.json");
  assert.equal(lock.version, version, "Lockfile root version is out of sync");
  assert.equal(lock.packages[""].version, version, "Lockfile package version is out of sync");
  for (const workspace of workspaces) {
    assert.equal((await read(`${workspace}/package.json`)).version, version, `${workspace} version is out of sync`);
    assert.equal(lock.packages[workspace].version, version, `${workspace} lockfile version is out of sync`);
  }
  return { version, atommVersion: version };
}

export async function bumpVersion(target, bump, base = root) {
  assert.equal(target, "main", "Target must be main; the Atomm package follows the main version");
  const versions = await readVersions(base);
  const version = nextVersion(versions.version, bump);
  const paths = ["package.json", ...workspaces.map((path) => `${path}/package.json`), "package-lock.json", "atomm/version.json"];
  // Prepare every edit before writing, preserving all unrelated package fields.
  const edits = await Promise.all(paths.map(async (path) => {
    const file = new URL(path, base);
    const value = JSON.parse(await readFile(file, "utf8"));
    value.version = version;
    if (path === "package-lock.json") {
      for (const workspace of ["", ...workspaces]) value.packages[workspace].version = version;
    }
    return [file, JSON.stringify(value, null, 2) + "\n"];
  }));
  for (const [file, content] of edits) await writeFile(file, content);
  return version;
}

if (isMainModule(import.meta.url)) {
  const [target, bump, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0, "Too many arguments");
  if (target === "check" && !bump) {
    console.log(await readVersions());
    // Release consistency includes the dataset snapshot: wrangler.jsonc cannot
    // import the worker constant, so the two are compared here.
    const { assertDatasetVersionsAgree } = await import("../lib/dataset-version.mjs");
    console.log({ datasetVersion: await assertDatasetVersionsAgree() });
  }
  else {
    assert.ok(bump, "Usage: versions.mjs check | main <major|minor|patch|version>");
    console.log(`${target}: ${await bumpVersion(target, bump)}`);
  }
}
