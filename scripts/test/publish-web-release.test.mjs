import assert from "node:assert/strict";
import test from "node:test";
import { publishWebRelease } from "../release/publish-web-release.mjs";

test("a failed web publication resumes from its verified tag", () => {
  let target, published = false, pushes = 0, attempts = 0;
  function run(program, args) {
    if (program === "git") {
      if (args[0] === "ls-remote") return target ?? "";
      if (args[0] === "tag" || args[0] === "fetch") return "";
      if (args[0] === "push") { target = "candidate"; pushes++; return ""; }
      if (args[0] === "rev-parse") return target;
    }
    if (args[1] === "view") {
      if (!published) throw new Error("release not found");
      return JSON.stringify({ isDraft: false });
    }
    if (args[1] === "create") {
      if (++attempts === 1) throw new Error("connection failed");
      published = true;
      return "";
    }
    throw new Error(`Unexpected command: ${program} ${args}`);
  }
  const opts = { version: "1.2.3", commit: "candidate", notesFile: "notes.md", run };
  assert.throws(() => publishWebRelease(opts), /connection failed/);
  assert.throws(() => publishWebRelease({ ...opts, commit: "different" }), /points to candidate/);
  publishWebRelease(opts);
  publishWebRelease({ ...opts, commit: "maintenance" });
  assert.deepEqual([pushes, attempts, published], [1, 2, true]);
});
