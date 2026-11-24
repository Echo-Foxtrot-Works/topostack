import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  changelogMarkdown, checkBranch, inferPullRequest, newFragment, notesBetween, notesFor, prepareRelease,
  readChangelog, readFragments, verifyRelease, writeReleaseFiles,
} from "../release/changelog.mjs";
import { nextVersion, readVersions } from "../release/versions.mjs";

const VERSION_FILES = ["package.json", "package-lock.json", "apps/generator/package.json", "packages/chart-trace/package.json", "packages/core/package.json", "packages/data-contracts/package.json", "packages/nest-wasm/package.json", "workers/map-api/package.json", "atomm/version.json"];
const fragment = (type, title, body = "Something a maker notices.") => `---\ntype: ${type}\ntitle: ${title}\n---\n${body}\n`;

/** A throwaway git repository with the real version files and a one-release changelog. */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "topostack-changelog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = pathToFileURL(directory + "/");
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  for (const path of ["apps/generator", "packages/chart-trace", "packages/core", "packages/data-contracts", "packages/nest-wasm", "workers/map-api", "atomm", "changelog/unreleased"]) await mkdir(new URL(path, base), { recursive: true });
  for (const path of VERSION_FILES) await writeFile(new URL(path, base), await readFile(new URL(`../../${path}`, import.meta.url)));
  const { version } = await readVersions(base);
  await writeFile(new URL("changelog/unreleased/.gitkeep", base), "");
  await writeFile(new URL("changelog/releases.json", base), JSON.stringify({ schemaVersion: 1, releases: [
    { version, date: "2026-09-01", entries: [{ type: "feature", title: "First", body: "The [first](/guides) release." }] },
  ] }));
  await writeReleaseFiles(await readChangelog(base), base);
  git("init", "-q", "-b", "dev");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "-qm", "Initial");
  return { base, directory, git, version };
}

async function addOnBranch({ base, git }, branch, files, pr) {
  git("checkout", "-qb", branch);
  for (const [name, text] of Object.entries(files)) await writeFile(new URL(`changelog/unreleased/${name}`, base), text);
  git("add", ".");
  git("commit", "-qm", `Work on ${branch}`);
  if (pr === undefined) return;
  git("checkout", "-q", "dev");
  git("merge", "-q", "--no-ff", branch, "-m", `Merge pull request #${pr} from org/${branch}`);
}

test("prepare folds fragments into a release, infers pull requests, and bumps every workspace", async (t) => {
  const repo = await fixture(t);
  await addOnBranch(repo, "feat/tracks", { "tracks.md": fragment("feature", "Tracks") }, 7);
  await addOnBranch(repo, "fix/edge", { "edge.md": fragment("fix", "Edge") }, 5);
  await writeFile(new URL("changelog/unreleased/pinned.md", repo.base), `---\ntype: fix\ntitle: Pinned\npr: 3\n---\nKept.\n`);

  const dry = await prepareRelease({ base: repo.base, date: "2026-09-21", dryRun: true });
  assert.equal(dry.version, nextVersion(repo.version, "minor"));
  assert.equal((await readVersions(repo.base)).version, repo.version, "a dry run edits nothing");
  assert.equal((await readFragments(repo.base)).length, 3);

  const result = await prepareRelease({ base: repo.base, date: "2026-09-21" });
  assert.equal(result.bump, "minor");
  assert.equal((await readVersions(repo.base)).version, result.version);
  assert.deepEqual(result.release.entries.map(({ title, pr }) => [title, pr]), [["Tracks", 7], ["Pinned", 3], ["Edge", 5]]);
  assert.deepEqual(await readdir(new URL("changelog/unreleased/", repo.base)), [".gitkeep"]);
  const changelog = await verifyRelease(repo.base);
  assert.deepEqual(changelog.releases.map(({ version }) => version), [result.version, repo.version]);
  assert.equal(await prepareRelease({ base: repo.base }), undefined, "a rerun with nothing pending is a no-op");
});

test("the largest change sets the bump", async (t) => {
  const repo = await fixture(t);
  await writeFile(new URL("changelog/unreleased/a.md", repo.base), fragment("improvement", "A"));
  assert.equal((await prepareRelease({ base: repo.base, dryRun: true })).bump, "patch");
  await writeFile(new URL("changelog/unreleased/b.md", repo.base), fragment("breaking", "B"));
  assert.equal((await prepareRelease({ base: repo.base, dryRun: true })).bump, "major");
});

test("pull requests come from a squash subject, a later merge, or nowhere", async (t) => {
  const repo = await fixture(t);
  assert.equal(inferPullRequest("changelog/unreleased/missing.md", repo.base), undefined);
  await writeFile(new URL("changelog/unreleased/squash.md", repo.base), fragment("fix", "Squash"));
  repo.git("add", ".");
  repo.git("commit", "-qm", "Fix the thing (#12)");
  assert.equal(inferPullRequest("changelog/unreleased/squash.md", repo.base), 12);
  await addOnBranch(repo, "feat/open", { "open.md": fragment("feature", "Open") });
  assert.equal(inferPullRequest("changelog/unreleased/open.md", repo.base), undefined, "unmerged work has no pull request yet");
  assert.equal(inferPullRequest("x", pathToFileURL(tmpdir() + "/")), undefined, "outside a repository");
});

test("check requires an added fragment unless skipped, and rejects invalid ones", async (t) => {
  const repo = await fixture(t);
  repo.git("checkout", "-qb", "feat/none");
  await assert.rejects(checkBranch({ base: repo.base, against: "dev" }), /no-changelog/);
  assert.deepEqual(await checkBranch({ base: repo.base, against: "dev", skip: true }), { added: [], skipped: true });
  await addOnBranch(repo, "feat/some", { "some.md": fragment("feature", "Some") });
  assert.deepEqual((await checkBranch({ base: repo.base, against: "dev" })).added, ["changelog/unreleased/some.md"]);
  await writeFile(new URL("changelog/unreleased/bad.md", repo.base), fragment("chore", "Bad"));
  await assert.rejects(checkBranch({ base: repo.base, against: "dev", skip: true }), /bad\.md: type must be one of/);
  await rm(new URL("changelog/unreleased/bad.md", repo.base));
  await writeFile(new URL("changelog/unreleased/notes.txt", repo.base), "x");
  await assert.rejects(readFragments(repo.base), /fragments are Markdown files/);
});

test("verify catches stale derived files and hand-edited versions", async (t) => {
  const repo = await fixture(t);
  await verifyRelease(repo.base);
  await writeFile(new URL("CHANGELOG.md", repo.base), "# edited\n");
  await assert.rejects(verifyRelease(repo.base), /CHANGELOG\.md is stale/);
  await writeReleaseFiles(await readChangelog(repo.base), repo.base);
  await writeFile(new URL("changelog/latest.json", repo.base), JSON.stringify({ version: "9.9.9", date: "2026-09-01" }));
  await assert.rejects(verifyRelease(repo.base), /latest\.json is stale/);
  const changelog = await readChangelog(repo.base);
  changelog.releases[0].version = "9.9.9";
  await writeReleaseFiles(changelog, repo.base);
  await assert.rejects(verifyRelease(repo.base), /must match the package version/);
});

test("new scaffolds a valid fragment named after the branch without overwriting", async (t) => {
  const repo = await fixture(t);
  repo.git("checkout", "-qb", "feat/Geo_Import");
  assert.equal(await newFragment("feature", "Import tracks", { base: repo.base }), "changelog/unreleased/geo-import.md");
  assert.equal(await newFragment("fix", "Again", { base: repo.base }), "changelog/unreleased/geo-import-2.md");
  assert.equal(await newFragment("fix", "Named", { base: repo.base, branch: "codex/" }), "changelog/unreleased/named.md");
  assert.equal((await readFragments(repo.base)).length, 3);
  await assert.rejects(newFragment("chore", "X", { base: repo.base }), /Type must be one of/);
  await assert.rejects(newFragment("fix", " ", { base: repo.base }), /title/);
});

test("markdown notes use absolute links and cover a version range", async (t) => {
  const repo = await fixture(t);
  const changelog = await readChangelog(repo.base);
  const notes = notesFor(changelog, repo.version);
  assert.match(notes, /^### New\n\n- \*\*First\*\*: The \[first\]\(https:\/\/topostack\.app\/guides\) release\.\n/);
  assert.match(notes, /Full changelog: https:\/\/topostack\.app\/changelog\n$/);
  assert.throws(() => notesFor(changelog, "9.9.9"), /No changelog release 9\.9\.9/);
  assert.match(notesBetween(changelog, "0.0.0"), new RegExp(`^### ${repo.version.replaceAll(".", "\\.")} \\(2026-09-01\\)`));
  assert.equal(notesBetween(changelog, "0.0.0", "0.0.1"), "");
  assert.equal(notesBetween(changelog, repo.version), "");
  assert.match(changelogMarkdown(changelog), /^# Changelog\n/);
});

test("the repository's own changelog is valid and agrees with the package version", async () => {
  const repository = new URL("../../", import.meta.url);
  await verifyRelease(repository);
  await readFragments(repository);
});

test("an invalid release date preserves every version file, fragment and rendered changelog", async (t) => {
  const repo = await fixture(t);
  await addOnBranch(repo, "fix/date", { "date.md": fragment("fix", "Date") });
  await assert.rejects(prepareRelease({ base: repo.base, date: "invalid" }));
  assert.equal(repo.git("status", "--porcelain"), "");
});

test("preparation resumes after interruption without consuming new fragments or overwriting an edited manifest", async (t) => {
  const repo = await fixture(t);
  const fragmentPath = new URL("changelog/unreleased/first.md", repo.base);
  await writeFile(fragmentPath, fragment("fix", "First queued change"));
  const source = new URL("../../", import.meta.url);
  for (const folder of ["scripts/release", "scripts/lib"]) await mkdir(new URL(folder, repo.base), { recursive: true });
  for (const path of ["scripts/release/changelog.mjs", "scripts/release/versions.mjs", "scripts/lib/files.mjs", "scripts/lib/main-module.mjs"]) {
    await copyFile(new URL(path, source), new URL(path, repo.base));
  }
  await symlink(fileURLToPath(new URL("node_modules", source)), new URL("node_modules", repo.base), "junction");
  const npm = (date, extraEnv = {}) => spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "changelog:prepare", "--", "--date", date], {
    cwd: repo.directory, encoding: "utf8", timeout: 30_000, shell: process.platform === "win32",
    env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`, npm_config_cache: join(repo.directory, "npm-cache"), ...extraEnv },
  });

  // End the child immediately after a manifest replacement. Neither normal
  // cleanup nor the function return runs, but npm and JS imports still work.
  const preload = new URL("interrupt.mjs", repo.base);
  await writeFile(preload, `
    import { promises as fs } from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { fileURLToPath } from "node:url";
    const expectedPath = fileURLToPath(new URL(process.env.TOPOSTACK_TEST_RELEASE_FILE, import.meta.url));
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      await rename(from, to);
      if (process.env.TOPOSTACK_TEST_RELEASE_MOVE === "from" ? from === expectedPath : to === expectedPath) process.exit(85);
    };
    syncBuiltinESMExports();
  `);
  const interrupt = (date, path, move) => {
    const run = npm(date, { NODE_OPTIONS: `--import=${preload.href}`, TOPOSTACK_TEST_RELEASE_FILE: path, TOPOSTACK_TEST_RELEASE_MOVE: move });
    assert.equal(run.status, 85, `${run.error ?? ""}\n${run.stdout}\n${run.stderr}`);
  };
  interrupt("2026-09-21", "apps/generator/package.json", "to");
  const version = nextVersion(repo.version, "patch");
  assert.equal(JSON.parse(await readFile(new URL("package.json", repo.base), "utf8")).version, version);
  assert.equal(JSON.parse(await readFile(new URL("apps/generator/package.json", repo.base), "utf8")).version, version);

  const nextFragment = new URL("changelog/unreleased/later.md", repo.base);
  await writeFile(nextFragment, fragment("fix", "Next release"));
  const manifest = new URL("packages/core/package.json", repo.base);
  const before = await readFile(manifest, "utf8");
  const edited = before.replace('"private": true', '"private": true, "testEdit": true');
  await writeFile(manifest, edited);
  await assert.rejects(prepareRelease({ base: repo.base }), /packages\/core\/package\.json changed during release preparation/);
  assert.equal(await readFile(manifest, "utf8"), edited);
  assert.equal((await readFragments(repo.base)).length, 2);
  assert.equal(JSON.parse(await readFile(new URL("apps/generator/package.json", repo.base), "utf8")).version, version);

  await writeFile(manifest, before);
  assert.equal((await prepareRelease({ base: repo.base, dryRun: true })).version, version);
  interrupt("2026-09-22", "changelog/unreleased/first.md", "from");
  await assert.rejects(readFile(fragmentPath), { code: "ENOENT" });
  assert.deepEqual(await readVersions(repo.base), { version, atommVersion: version });
  const completed = npm("2026-09-22", { GITHUB_OUTPUT: join(repo.directory, "release-output") });
  assert.equal(completed.status, 0, `${completed.error ?? ""}\n${completed.stdout}\n${completed.stderr}`);
  assert.equal(await readFile(new URL("release-output", repo.base), "utf8"), `version=${version}\n`);
  await assert.rejects(readFile(fragmentPath), { code: "ENOENT" });
  assert.equal(await readFile(nextFragment, "utf8"), fragment("fix", "Next release"));
  const { releases } = await verifyRelease(repo.base);
  assert.deepEqual(releases.map((release) => release.version), [version, repo.version]);
  assert.equal(releases[0].date, "2026-09-21");
  assert.deepEqual(releases[0].entries.map(({ title }) => title), ["First queued change"]);
  assert.deepEqual(await readdir(new URL(".topostack/", repo.base)), []);
});
