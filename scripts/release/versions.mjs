import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "../lib/files.mjs";
import { isMainModule } from "../lib/main-module.mjs";

const root = new URL("../../", import.meta.url);
const workspaces = ["apps/generator", "packages/chart-trace", "packages/core", "packages/data-contracts", "packages/nest-wasm", "workers/map-api"];
const versionPaths = ["package.json", ...workspaces.map((path) => `${path}/package.json`), "package-lock.json", "atomm/version.json"];
const numeric = "(?:0|[1-9]\\d*)";
const identifier = `(?:${numeric}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`);

export const isVersionFile = (path) => versionPaths.includes(path);
export const releasePreparationPath = (base) => fileURLToPath(new URL(".topostack/release-preparation.json", base));

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

async function readVersionFiles(base) {
  const files = await Promise.all(versionPaths.map(async (path) => {
    const before = await readFile(new URL(path, base), "utf8");
    return { path, before, contents: JSON.parse(before) };
  }));
  const manifests = Object.fromEntries(files.map(({ path, contents }) => [path, contents]));
  const version = validateVersion(manifests["package.json"].version);
  assert.equal(manifests["atomm/version.json"].version, version, "atomm/version.json is out of sync; the Atomm package releases with the main version");
  const lock = manifests["package-lock.json"];
  assert.equal(lock.version, version, "Lockfile root version is out of sync");
  assert.equal(lock.packages[""].version, version, "Lockfile package version is out of sync");
  for (const workspace of workspaces) {
    assert.equal(manifests[`${workspace}/package.json`].version, version, `${workspace} version is out of sync`);
    assert.equal(lock.packages[workspace].version, version, `${workspace} lockfile version is out of sync`);
  }
  return { version, files };
}

// atomm/version.json mirrors the shared version so its package can identify itself.
export async function readVersions(base = root) {
  const { version } = await readVersionFiles(base);
  return { version, atommVersion: version };
}

export async function planVersionBump(bump, base = root) {
  const { version: previous, files } = await readVersionFiles(base);
  const version = nextVersion(previous, bump);
  const changes = files.map(({ path, before, contents }) => {
    contents.version = version;
    if (path === "package-lock.json") {
      for (const workspace of ["", ...workspaces]) contents.packages[workspace].version = version;
    }
    return { path, before, after: JSON.stringify(contents, null, 2) + "\n" };
  });
  return { version, changes };
}

export async function bumpVersion(target, bump, base = root) {
  assert.equal(target, "main", "Target must be main; the Atomm package follows the main version");
  const pending = await access(releasePreparationPath(base)).then(() => true, (error) => {
    if (error.code !== "ENOENT") throw error;
    return false;
  });
  if (pending) throw new Error("Resume the pending changelog:prepare before bumping a version.");
  const { version, changes } = await planVersionBump(bump, base);
  for (const { path, before, after } of changes) {
    const file = new URL(path, base);
    assert.equal(await readFile(file, "utf8"), before, `${path} changed while preparing the version bump`);
    await writeFileAtomic(fileURLToPath(file), after);
  }
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
