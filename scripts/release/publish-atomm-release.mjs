import { atommReleaseFiles } from "../lib/atomm-release-files.mjs";
import assert from "node:assert/strict";
import { validateVersion } from "./versions.mjs";
import { notesBetween, readChangelog } from "./changelog.mjs";
import { compareVersions } from "@topostack/data-contracts/changelog";
import { execFileSync } from "node:child_process";
import { sha256Hex } from "../lib/hash.mjs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainModule } from "../lib/main-module.mjs";

export function validateRun(run, repository) {
  assert.equal(run.repository.full_name, repository, "CI must belong to this repository");
  assert.equal(run.path, ".github/workflows/ci.yml", "Use the production CI workflow");
  assert.equal(run.head_branch, "main", "Only main production builds can be released");
  assert.ok(["push", "workflow_dispatch"].includes(run.event), "PR artifacts cannot be released");
  assert.equal(run.status, "completed", "CI must be complete");
  assert.equal(run.conclusion, "success", "All production CI jobs must pass");
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
}

export function validatePackage(receipt, archive, checksum, commit, tag) {
  validateVersion(receipt.version);
  validateVersion(receipt.atommVersion);
  assert.equal(receipt.atommVersion, receipt.version, "The Atomm package must carry the main version; they release together");
  assert.equal(tag, `atomm-v${receipt.atommVersion}`, "Release tag must match the packaged Atomm version");
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.commit, commit, "Package must match the tested commit");
  assert.equal(receipt.workingTreeDirty, false, "Package must come from a clean checkout");
  assert.equal(receipt.apiOrigin, "https://topostack.app", "Package must use the production API");
  const files = atommReleaseFiles(receipt.atommVersion);
  assert.equal(receipt.archive, files.archive);
  assert.equal(receipt.bytes, archive.length, "Archive size does not match its receipt");
  const digest = sha256Hex(archive);
  assert.equal(receipt.sha256, digest, "Archive checksum does not match its receipt");
  assert.equal(checksum.trim(), `${digest}  ${files.archive}`, "Checksum file does not match the archive");
  return digest;
}

/** The newest atomm-v tag older than `tag`, if any. */
export function previousAtommTag(tags, tag) {
  const current = tag.slice("atomm-v".length);
  return tags
    .filter((name) => /^atomm-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(name))
    .map((name) => name.slice("atomm-v".length))
    .filter((version) => compareVersions(version, current) < 0)
    .sort(compareVersions)
    .map((version) => `atomm-v${version}`)
    .at(-1);
}

/** User-facing changes since the main version the previous Atomm release shipped. */
export function atommChangeNotes(changelog, previousMainVersion, mainVersion) {
  if (!previousMainVersion) return "";
  const notes = notesBetween(changelog, previousMainVersion, mainVersion);
  return notes ? `## What's changed\n\nChanges since the previous Atomm release (TopoStack ${previousMainVersion}).\n\n${notes.replaceAll(/^### /gm, "### TopoStack ")}\n` : "";
}

const isNotFound = (error) => /HTTP 404|Not Found|release not found/i.test(`${error?.message ?? ""}\n${error?.stderr ?? ""}`);

/**
 * Creates the tag and a draft release, uploads assets, then publishes. Safe to
 * rerun after a partial failure: an existing tag is reused only when it already
 * points at the verified commit, and an existing draft is updated in place. A
 * moved tag or an already-published release is always refused.
 * `gh(...args)` runs the GitHub CLI and returns stdout, throwing on failure.
 */
export function publishRelease({ gh, repository, tag, sha, assets, title, notesFile, prerelease }) {
  let ref = null;
  try {
    ref = JSON.parse(gh("api", `repos/${repository}/git/ref/tags/${tag}`));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (ref) {
    assert.ok(ref.object?.type === "commit" && ref.object.sha === sha,
      `Tag ${tag} already exists at a different commit; never move a release tag`);
  } else {
    // Ref creation is atomic: a concurrent run creating the same tag fails here.
    gh("api", `repos/${repository}/git/refs`, "--method", "POST", "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`);
  }
  let release = null;
  try {
    release = JSON.parse(gh("release", "view", tag, "--repo", repository, "--json", "isDraft"));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  assert.ok(!release || release.isDraft, `Release ${tag} is already published`);
  const flags = prerelease ? ["--prerelease"] : [];
  if (release) {
    // Resume a draft left by an interrupted run with the freshly verified files.
    gh("release", "upload", tag, ...assets, "--repo", repository, "--clobber");
    gh("release", "edit", tag, "--repo", repository, "--title", title, "--notes-file", notesFile, ...flags);
  } else {
    // Stage all files on a draft before publishing, including for immutable releases.
    gh("release", "create", tag, ...assets, "--repo", repository,
      "--verify-tag", "--draft", "--title", title, "--notes-file", notesFile, ...flags);
  }
  gh("release", "edit", tag, "--repo", repository, "--draft=false", `--latest=${!prerelease}`, ...flags);
  return gh("release", "view", tag, "--repo", repository, "--json", "url", "--jq", ".url").trim();
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.ATOMM_CI_RUN_ID;
  const tag = process.env.ATOMM_RELEASE_TAG;
  assert.match(repository ?? "", /^[\w.-]+\/[\w.-]+$/);
  assert.match(runId ?? "", /^\d+$/);
  assert.match(tag ?? "", /^atomm-v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/, "Use a version such as atomm-v0.1.0");
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const api = (...args) => JSON.parse(gh("api", ...args));
  const run = api(`repos/${repository}/actions/runs/${runId}`);
  validateRun(run, repository);
  const directory = await mkdtemp(join(tmpdir(), "atomm-release-"));
  gh("run", "download", runId, "--repo", repository, "--name", `topostack-atomm-${run.head_sha}`, "--dir", directory);
  const files = atommReleaseFiles(tag.slice("atomm-v".length));
  const code = join(directory, "apps/generator", files.archive);
  const checksum = code + ".sha256";
  const receiptPath = join(directory, "apps/generator", files.receipt);
  const listing = join(directory, "atomm", files.listing);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const digest = validatePackage(receipt, await readFile(code), await readFile(checksum, "utf8"), run.head_sha, tag);
  const build = JSON.parse(execFileSync("unzip", ["-p", code, "version.json"], { encoding: "utf8" }));
  assert.equal(build.environment, "atomm");
  assert.equal(build.version, receipt.version);
  assert.equal(build.atommVersion, receipt.atommVersion);
  assert.equal(build.commit, receipt.commit);
  assert.equal(build.workingTreeDirty, false);
  assert.ok((await readFile(listing)).length > 0, "Listing media bundle is required");
  execFileSync("unzip", ["-tq", code], { stdio: "pipe" });
  execFileSync("unzip", ["-tq", listing], { stdio: "pipe" });
  console.log(`Verified ${tag}: ${run.head_sha}, SHA-256 ${digest}`);
  if (process.argv.includes("--dry-run")) return;

  const notes = join(directory, "release-notes.md");
  const tags = api(`repos/${repository}/git/matching-refs/tags/atomm-v`).map((ref) => ref.ref.slice("refs/tags/".length));
  const previous = previousAtommTag(tags, tag);
  const previousMainVersion = previous
    ? JSON.parse(Buffer.from(api(`repos/${repository}/contents/package.json?ref=${previous}`).content, "base64").toString("utf8")).version
    : undefined;
  const changes = atommChangeNotes(await readChangelog(), previousMainVersion, receipt.version);
  await writeFile(notes, `Upload **${files.archive}** to the Atomm developer console. GitHub's automatic Source code archives are not the upload package.\n\n` +
    `- **${files.archive}** — static generator, opening directly in the terrain studio.\n` +
    `- **${files.checksum}** — SHA-256 checksum.\n` +
    `- **${files.receipt}** — clean source commit, production API, dataset and archive metadata.\n` +
    `- **${files.listing}** — cover options, feature screenshots, listing copy and media provenance.\n\n` +
    `Built and deployed by [production CI run ${runId}](${run.html_url}) at commit ${run.head_sha}. These are the exact verified CI assets, without a local rebuild.\n\n` +
    `TopoStack **${receipt.version}**, the same version as the web app's [v${receipt.version}](https://github.com/${repository}/releases/tag/v${receipt.version}) release.\n\n` +
    `ZIP SHA-256: \`${digest}\`\n\nAtomm host review and physical fabrication acceptance are separate from automated CI.\n` +
    (changes ? `\n${changes}` : ""));
  const prerelease = tag.slice("atomm-v".length).includes("-");
  console.log(publishRelease({ gh, repository, tag, sha: run.head_sha, assets: [code, checksum, receiptPath, listing],
    title: `TopoStack ${tag.slice("atomm-".length)} for Atomm`, notesFile: notes, prerelease }));
}

if (isMainModule(import.meta.url)) await main();
