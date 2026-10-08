import { readVersions } from "./versions.mjs";
import { atommReleaseFiles } from "../lib/atomm-release-files.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { sha256Hex } from "../lib/hash.mjs";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../../atomm/", import.meta.url);
const provenance = JSON.parse(await readFile(new URL("media-provenance.json", root), "utf8"));
const files = ["listing.md", "listing-copy.txt", "media-provenance.json", "review-readiness.md"];
for (const reference of [provenance.coverPresentation?.prompt, provenance.projectFile, provenance.annotationsFile, provenance.exportFile, provenance.video?.recipe, provenance.video?.projectFile, provenance.projectsFile, provenance.storyboardFile, provenance.coverVideo?.recipe, provenance.legacyVideo?.recipe, provenance.legacyVideo?.projectFile]) {
  if (!reference) continue;
  assert.match(reference, /^[a-z0-9-]+\.(txt|json)$/);
  files.push(reference);
}
for (const item of provenance.media) {
  assert.match(item.file, /^assets\/[a-z0-9-]+\.(png|mp4)$/);
  const data = await readFile(new URL(item.file, root));
  const video = item.file.endsWith(".mp4");
  assert.equal(sha256Hex(data), item.sha256, `${item.file}: stale media provenance`);
  assert.equal(data.length, item.bytes, `${item.file}: stale byte count`);
  assert.ok(data.length <= (video ? 70_000_000 : 15_000_000), `${item.file}: exceeds Atomm's ${video ? "video" : "image"} limit`);
  if (video) {
    assert.equal(data.subarray(4, 8).toString("ascii"), "ftyp", `${item.file}: expected MP4`);
  } else {
    assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${item.file}: expected PNG`);
    assert.equal(data.readUInt32BE(16), item.width, `${item.file}: stale width`);
    assert.equal(data.readUInt32BE(20), item.height, `${item.file}: stale height`);
  }
  files.push(item.file);
}
assert.ok(provenance.media.length <= 20, "Too many listing media files");
const { listing } = atommReleaseFiles((await readVersions()).atommVersion);
await rm(new URL(listing, root), { force: true });
execFileSync("zip", ["-Xq", listing, ...new Set(files)], { cwd: fileURLToPath(root), stdio: "inherit" });
console.log(`Packaged ${listing} with listing text and ${provenance.media.length} media files.`);
