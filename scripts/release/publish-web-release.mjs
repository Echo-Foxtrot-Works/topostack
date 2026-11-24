import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMainModule } from "../lib/main-module.mjs";
import { notesFor, readChangelog } from "./changelog.mjs";
import { readVersions } from "./versions.mjs";

export function publishWebRelease({ version, commit, notesFile, run }) {
  const tag = `v${version}`;
  const ref = `refs/tags/${tag}`;
  const exists = run("git", ["ls-remote", "--refs", "origin", ref]).trim();
  if (exists) {
    let release;
    try {
      release = JSON.parse(run("gh", ["release", "view", tag, "--json", "isDraft"]));
    } catch (error) {
      if (!/release not found|HTTP 404/i.test(String(error.stderr ?? error.message))) throw error;
    }
    if (release && !release.isDraft) return;
    run("git", ["fetch", "--no-tags", "origin", ref]);
    const target = run("git", ["rev-parse", "FETCH_HEAD^{commit}"]).trim();
    if (target !== commit) throw new Error(`Unpublished tag ${tag} points to ${target}, expected ${commit}`);
    if (release?.isDraft) {
      run("gh", ["release", "edit", tag, "--draft=false", "--title", `TopoStack ${version}`, "--notes-file", notesFile, "--latest=false"]);
      return;
    }
  } else {
    run("git", ["tag", "-a", tag, commit, "-m", `TopoStack ${version}`]);
    run("git", ["push", "origin", ref]);
  }
  run("gh", ["release", "create", tag, "--verify-tag", "--title", `TopoStack ${version}`, "--notes-file", notesFile, "--latest=false"]);
}

if (isMainModule(import.meta.url)) {
  const { version } = await readVersions();
  const notesFile = join(process.env.RUNNER_TEMP, "web-release-notes.md");
  writeFileSync(notesFile, notesFor(await readChangelog(), version));
  publishWebRelease({ version, commit: process.env.GITHUB_SHA, notesFile,
    run: (program, args) => execFileSync(program, args, { encoding: "utf8" }),
  });
}
