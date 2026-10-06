import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CHANGE_TYPES, CHANGE_TYPE_LABELS, compareVersions, latestRelease, parseFragment, releaseBump, sortEntries, validateChangelog,
} from "@topostack/data-contracts/changelog";
import { bumpVersion, nextVersion, readVersions } from "./versions.mjs";
import { isMainModule } from "../lib/main-module.mjs";

const root = new URL("../../", import.meta.url);
const SITE = "https://topostack.app";
const REPOSITORY = "https://github.com/Echo-Foxtrot-Works/topostack";
export const UNRELEASED = "changelog/unreleased/";
export const SKIP_LABEL = "no-changelog";
const USAGE = `Usage: changelog.mjs <command>
  new <type> "<title>"             scaffold a fragment for this branch (${CHANGE_TYPES.join(", ")})
  check [--base <ref>] [--skip]    fail unless the branch adds a valid fragment
  pending                          fail while unreleased fragments exist
  render                           rewrite latest.json and CHANGELOG.md after editing releases.json
  verify                           check the release files agree with each other and the package version
  prepare [--date YYYY-MM-DD] [--dry-run]   fold fragments into a release and bump the version
  notes <version> | --since <version> [--until <version>]   release notes as Markdown`;

const git = (args, base) => execFileSync("git", args, { cwd: fileURLToPath(base), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export async function readChangelog(base = root) {
  return validateChangelog(JSON.parse(await readFile(new URL("changelog/releases.json", base), "utf8")));
}

/** Every pending fragment, in file-name order. Dotfiles (.gitkeep) are ignored. */
export async function readFragments(base = root) {
  const names = (await readdir(new URL(UNRELEASED, base)).catch(() => [])).filter((name) => !name.startsWith(".")).sort();
  return Promise.all(names.map(async (name) => {
    assert.ok(name.endsWith(".md"), `${UNRELEASED}${name}: fragments are Markdown files`);
    return { name, entry: parseFragment(await readFile(new URL(UNRELEASED + name, base), "utf8"), `${UNRELEASED}${name}`) };
  }));
}

/** The pull request that brought a fragment in, from a squash "(#N)" subject or the first merge after it. */
export function inferPullRequest(path, base = root) {
  try {
    const added = git(["log", "--diff-filter=A", "--format=%H %s", "-1", "--", path], base);
    if (!added) return undefined;
    const [sha] = added.split(" ", 1);
    const squash = /\(#(\d+)\)$/.exec(added);
    if (squash) return Number(squash[1]);
    const merges = git(["log", "--ancestry-path", "--merges", "--reverse", "--format=%s", `${sha}..HEAD`], base);
    const merge = /^Merge pull request #(\d+)/m.exec(merges);
    return merge ? Number(merge[1]) : undefined;
  } catch {
    return undefined;
  }
}

// Site paths become absolute so the links work on GitHub and in Atomm notes.
const absolute = (text) => text.replace(/\]\(\/(?!\/)/g, `](${SITE}/`);
const bullet = (entry) => `- **${entry.title}**: ${absolute(entry.body)}${entry.pr ? ` ([#${entry.pr}](${REPOSITORY}/pull/${entry.pr}))` : ""}`;

export function releaseMarkdown(release, heading = "##") {
  const sections = CHANGE_TYPES.flatMap((type) => {
    const entries = release.entries.filter((entry) => entry.type === type);
    return entries.length ? [`${heading}# ${CHANGE_TYPE_LABELS[type]}\n\n${entries.map(bullet).join("\n")}`] : [];
  });
  return `${heading} ${release.version} (${release.date})\n\n${sections.join("\n\n")}\n`;
}

export function changelogMarkdown(changelog) {
  return "# Changelog\n\n" +
    `User-facing changes to TopoStack, newest first. Also at ${SITE}/changelog with a [feed](${SITE}/changelog.xml) for feed readers.\n\n` +
    "Generated from `changelog/releases.json` by `npm run changelog:prepare`; do not edit by hand. See [docs/changelog.md](docs/changelog.md).\n\n" +
    changelog.releases.map((release) => releaseMarkdown(release)).join("\n");
}

/** Releases newer than `since` up to and including `until`, as one Markdown document. */
export function notesBetween(changelog, since, until) {
  const releases = changelog.releases.filter((release) =>
    compareVersions(release.version, since) > 0 && (!until || compareVersions(release.version, until) <= 0));
  return releases.map((release) => releaseMarkdown(release, "###")).join("\n");
}

export function notesFor(changelog, version) {
  const release = changelog.releases.find((item) => item.version === version);
  assert.ok(release, `No changelog release ${version}`);
  return `${releaseMarkdown(release).split("\n").slice(2).join("\n")}\nFull changelog: ${SITE}/changelog\n`;
}

export async function writeReleaseFiles(changelog, base = root) {
  const json = (value) => JSON.stringify(value, null, 2) + "\n";
  await writeFile(new URL("changelog/releases.json", base), json(changelog));
  await writeFile(new URL("changelog/latest.json", base), json(latestRelease(changelog)));
  await writeFile(new URL("CHANGELOG.md", base), changelogMarkdown(changelog));
}

/**
 * Fold every pending fragment into a new release at the top of
 * releases.json, bump the main version by the largest change, and delete the
 * fragments. Returns undefined when nothing is pending, so reruns are no-ops.
 */
export async function prepareRelease({ base = root, date = new Date().toISOString().slice(0, 10), dryRun = false } = {}) {
  const fragments = await readFragments(base);
  if (!fragments.length) return undefined;
  const changelog = await readChangelog(base);
  const entries = sortEntries(fragments.map(({ name, entry }) => {
    const pr = entry.pr ?? inferPullRequest(UNRELEASED + name, base);
    return pr ? { ...entry, pr } : entry;
  }));
  const bump = releaseBump(entries);
  const version = dryRun ? nextVersion((await readVersions(base)).version, bump) : await bumpVersion("main", bump, base);
  const next = validateChangelog({ ...changelog, releases: [{ version, date, entries }, ...changelog.releases] });
  if (!dryRun) {
    await writeReleaseFiles(next, base);
    await Promise.all(fragments.map(({ name }) => rm(new URL(UNRELEASED + name, base))));
  }
  return { version, bump, release: next.releases[0] };
}

/** The release files, the generated Markdown, and the package version must agree. */
export async function verifyRelease(base = root) {
  const changelog = await readChangelog(base);
  const latest = JSON.parse(await readFile(new URL("changelog/latest.json", base), "utf8"));
  assert.deepEqual(latest, latestRelease(changelog), "changelog/latest.json is stale; run npm run changelog:prepare");
  assert.equal(await readFile(new URL("CHANGELOG.md", base), "utf8"), changelogMarkdown(changelog), "CHANGELOG.md is stale; it is generated from changelog/releases.json");
  const { version } = await readVersions(base);
  assert.equal(latest.version, version, `The newest changelog release (${latest.version}) must match the package version (${version}); bump versions through changelog:prepare`);
  await readFragments(base);
  return changelog;
}

/** A pull request must add a fragment unless it is labelled no-changelog. */
export async function checkBranch({ base = root, against = "origin/dev", skip = false } = {}) {
  const fragments = await readFragments(base);
  if (skip) return { added: [], skipped: true };
  const added = git(["diff", "--name-only", "--diff-filter=A", `${against}...HEAD`, "--", UNRELEASED], base).split("\n").filter(Boolean);
  const known = new Set(fragments.map(({ name }) => UNRELEASED + name));
  assert.ok(added.some((path) => known.has(path)),
    `Add a changelog fragment with "npm run changelog:new -- <type> \\"<title>\\"", or label the pull request ${SKIP_LABEL} when users will not notice the change.`);
  return { added, skipped: false };
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "change";
}

export async function newFragment(type, title, { base = root, branch } = {}) {
  assert.ok(CHANGE_TYPES.includes(type), `Type must be one of ${CHANGE_TYPES.join(", ")}`);
  assert.ok(title?.trim(), "Give the change a title");
  const name = slug((branch ?? git(["branch", "--show-current"], base)).replace(/^(feat|feature|fix|refactor|codex|chore)\//, "") || title);
  await mkdir(new URL(UNRELEASED, base), { recursive: true });
  const existing = new Set(await readdir(new URL(UNRELEASED, base)));
  let file = `${name}.md`;
  for (let index = 2; existing.has(file); index++) file = `${name}-${index}.md`;
  const text = `---\ntype: ${type}\ntitle: ${title.trim()}\n---\nOne to three sentences on what a maker can now do or no longer runs into.\n`;
  parseFragment(text, file);
  await writeFile(new URL(UNRELEASED + file, base), text);
  return UNRELEASED + file;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === "new") console.log(`Created ${await newFragment(rest[0], rest.slice(1).join(" "))}; edit the body before committing.`);
  else if (command === "check") {
    const result = await checkBranch({ against: option(rest, "--base") ?? "origin/dev", skip: rest.includes("--skip") });
    console.log(result.skipped ? `Skipped: labelled ${SKIP_LABEL}.` : `Fragments: ${result.added.join(", ")}`);
  }
  else if (command === "pending") {
    const fragments = await readFragments();
    assert.equal(fragments.length, 0, `${fragments.length} unreleased fragment(s) remain; the release-prepare workflow folds them in before promotion`);
    console.log("No unreleased fragments.");
  }
  else if (command === "render") {
    await writeReleaseFiles(await readChangelog());
    console.log("Rewrote changelog/latest.json and CHANGELOG.md.");
  }
  else if (command === "verify") console.log(`Changelog agrees with version ${(await verifyRelease()).releases[0]?.version}.`);
  else if (command === "prepare") {
    const result = await prepareRelease({ date: option(rest, "--date"), dryRun: rest.includes("--dry-run") });
    if (!result) console.log("No unreleased fragments; nothing to release.");
    else {
      console.log(`${rest.includes("--dry-run") ? "Would release" : "Released"} ${result.version} (${result.bump}):\n\n${releaseMarkdown(result.release)}`);
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\n`);
    }
  }
  else if (command === "notes") {
    const changelog = await readChangelog();
    const since = option(rest, "--since");
    process.stdout.write(since ? notesBetween(changelog, since, option(rest, "--until")) : notesFor(changelog, rest[0]));
  }
  else throw new Error(USAGE);
}

if (isMainModule(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
