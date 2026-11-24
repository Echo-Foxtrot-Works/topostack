import aviation from "../data/faa-aviation-production-release.json" with { type: "json" };
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { atommChangeNotes, previousAtommTag, publishRelease, validatePackage, validateRun } from "../release/publish-atomm-release.mjs";

const commit = "a".repeat(40);
const repository = "Echo-Foxtrot-Works/topostack";
const run = { repository: { full_name: repository }, path: ".github/workflows/ci.yml", head_branch: "main", event: "push", status: "completed", conclusion: "success", head_sha: commit };
const archive = Buffer.from("test artifact bytes");
const digest = createHash("sha256").update(archive).digest("hex");
const receipt = { schemaVersion: 2, aviation, frontend: { commit, version: "0.2.0", environment: "production" }, deployment: { commit, id: "worker-a" }, vectorData: { etag: '"v1"' }, lakeData: { etag: '"l1"' }, version: "0.2.0", atommVersion: "0.2.0", commit, workingTreeDirty: false, apiOrigin: "https://topostack.app", archive: "topostack-atomm-v0.2.0.zip", bytes: archive.length, sha256: digest };
const checksum = `${digest}  topostack-atomm-v0.2.0.zip\n`;

test("accepts completed production CI and its matching clean artifact", () => {
  validateRun(run, repository);
  assert.equal(validatePackage(receipt, archive, checksum, commit, "atomm-v0.2.0"), digest);
});

test("rejects untrusted, incomplete, failed, PR, and development runs", () => {
  for (const patch of [{ repository: { full_name: "other/repo" } }, { path: ".github/workflows/other.yml" }, { head_branch: "dev" }, { event: "pull_request" }, { status: "in_progress" }, { conclusion: "failure" }, { head_sha: "main" }]) {
    assert.throws(() => validateRun({ ...run, ...patch }, repository));
  }
});

test("rejects mismatched, dirty, nonproduction, and tampered artifacts", () => {
  for (const patch of [{ aviation: { ...aviation, sha256: "different" } }, { frontend: { ...receipt.frontend, commit: "older" } }, { deployment: { ...receipt.deployment, commit: "older" } }, { lakeData: {} }, { commit: "b".repeat(40) }, { workingTreeDirty: true }, { apiOrigin: "https://dev.topostack.app" }, { bytes: 1 }, { sha256: "0".repeat(64) }, { archive: "other.zip" }, { archive: "topostack-atomm-v0.1.0.zip" }]) {
    assert.throws(() => validatePackage({ ...receipt, ...patch }, archive, checksum, commit, "atomm-v0.2.0"));
  }
  assert.throws(() => validatePackage(receipt, Buffer.from("tampered"), checksum, commit, "atomm-v0.2.0"));
  assert.throws(() => validatePackage(receipt, archive, `${digest}  other.zip`, commit, "atomm-v0.2.0"));
});

test("rejects missing versions and tags that do not match the packaged version", () => {
  assert.throws(() => validatePackage(receipt, archive, checksum, commit, "atomm-v0.3.0"));
  for (const patch of [{ version: undefined }, { atommVersion: undefined }, { atommVersion: "01.2.0" }, { version: "0.1.0" }]) {
    assert.throws(() => validatePackage({ ...receipt, ...patch }, archive, checksum, commit, "atomm-v0.2.0"));
  }
});

function fakeGh({ tagSha, release }) {
  const calls = [];
  const notFound = (message) => Object.assign(new Error("Command failed"), { stderr: message });
  const gh = (...args) => {
    calls.push(args);
    const [command, sub] = args;
    if (command === "api" && sub.includes("/git/ref/tags/")) {
      if (!tagSha) throw notFound("gh: Not Found (HTTP 404)");
      return JSON.stringify({ object: { type: "commit", sha: tagSha } });
    }
    if (command === "release" && sub === "view" && args.includes("isDraft")) {
      if (!release) throw notFound("release not found");
      return JSON.stringify(release);
    }
    if (command === "release" && sub === "view") return "https://example.invalid/release\n";
    return "";
  };
  return { gh, calls };
}

const publishOptions = { repository, tag: "atomm-v0.2.0", sha: commit, assets: ["a.zip"], title: "T", notesFile: "notes.md", prerelease: false };
const verbs = (calls) => calls.map(([command, sub, ...rest]) => command === "api" ? (rest.includes("POST") ? "api:create-ref" : "api:get-ref") : `release:${sub}${rest.includes("--draft=false") ? ":publish" : ""}`);

test("publishes a fresh tag through a draft release", () => {
  const { gh, calls } = fakeGh({});
  assert.equal(publishRelease({ gh, ...publishOptions }), "https://example.invalid/release");
  assert.deepEqual(verbs(calls), ["api:get-ref", "api:create-ref", "release:view", "release:create", "release:edit:publish", "release:view"]);
});

test("rerun reuses a matching tag and resumes an existing draft", () => {
  const { gh, calls } = fakeGh({ tagSha: commit, release: { isDraft: true } });
  publishRelease({ gh, ...publishOptions });
  assert.deepEqual(verbs(calls), ["api:get-ref", "release:view", "release:upload", "release:edit", "release:edit:publish", "release:view"]);
  assert.ok(calls.find(([, sub]) => sub === "upload").includes("--clobber"));
});

test("rerun after tag creation alone creates the draft without recreating the tag", () => {
  const { gh, calls } = fakeGh({ tagSha: commit });
  publishRelease({ gh, ...publishOptions });
  assert.deepEqual(verbs(calls), ["api:get-ref", "release:view", "release:create", "release:edit:publish", "release:view"]);
});

test("refuses moved tags, published releases, and unexpected lookup failures", () => {
  assert.throws(() => publishRelease({ gh: fakeGh({ tagSha: "b".repeat(40) }).gh, ...publishOptions }), /different commit/);
  assert.throws(() => publishRelease({ gh: fakeGh({ tagSha: commit, release: { isDraft: false } }).gh, ...publishOptions }), /already published/);
  const failing = () => { throw Object.assign(new Error("Command failed"), { stderr: "HTTP 500" }); };
  assert.throws(() => publishRelease({ gh: failing, ...publishOptions }), /Command failed/);
});

test("finds the previous Atomm tag by version, ignoring other tags", () => {
  const tags = ["v0.1.1", "atomm-v0.1.0", "atomm-v0.1.10", "atomm-v0.1.2", "atomm-v0.2.0-rc.1", "atomm-vX"];
  assert.equal(previousAtommTag(tags, "atomm-v0.2.0"), "atomm-v0.2.0-rc.1");
  assert.equal(previousAtommTag(tags, "atomm-v0.1.10"), "atomm-v0.1.2");
  assert.equal(previousAtommTag(tags, "atomm-v0.1.0"), undefined);
});

test("lists user-facing changes since the previous Atomm release's main version", () => {
  const entry = { type: "feature", title: "Share links", body: "Open a design from a [link](/guides)." };
  const changelog = { schemaVersion: 1, releases: [
    { version: "0.3.0", date: "2026-10-01", entries: [{ ...entry, title: "Not packaged yet" }] },
    { version: "0.2.0", date: "2026-09-21", entries: [entry] },
    { version: "0.1.2", date: "2026-09-17", entries: [{ ...entry, title: "Already shipped" }] },
  ] };
  const notes = atommChangeNotes(changelog, "0.1.2", "0.2.0");
  assert.match(notes, /^## What's changed\n\nChanges since the previous Atomm release \(TopoStack 0\.1\.2\)\.\n\n### TopoStack 0\.2\.0 \(2026-09-21\)\n\n#### New\n/);
  assert.match(notes, /\[link\]\(https:\/\/topostack\.app\/guides\)/);
  assert.doesNotMatch(notes, /Already shipped|Not packaged yet/);
  assert.equal(atommChangeNotes(changelog, "0.2.0", "0.2.0"), "", "a repackage without a main release adds nothing");
  assert.equal(atommChangeNotes(changelog, undefined, "0.2.0"), "", "the first Atomm release has no baseline");
});
