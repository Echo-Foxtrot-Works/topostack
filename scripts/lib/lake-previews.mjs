import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyArchiveResponse } from "./archive-provisioning.mjs";

// Lake-page depth previews rendered by scripts/dev/render-lake-previews.mjs,
// published to R2 as content-addressed objects (lake-previews/<sha24>.webp)
// that the Worker serves at /v1/lake-previews/. The committed pin tells the
// page build which lakes have one and what it shows.
export { sha256Hex as digest } from "./hash.mjs";
import { sha256Hex as digest } from "./hash.mjs";
export const pinPath = new URL("../../apps/generator/src/lib/site/lake-previews.json", import.meta.url);

/** The pin and upload list for a render folder: every lake in its manifest with a WebP on disk. */
export async function inspectPreviews(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const lakes = {};
  const objects = [];
  for (const slug of Object.keys(manifest.lakes).sort()) {
    const entry = manifest.lakes[slug];
    const bytes = await readFile(join(directory, `${slug}.webp`));
    const sha256 = digest(bytes);
    const file = `${sha256.slice(0, 24)}.webp`;
    lakes[slug] = { file, sha256, bytes: bytes.length, width: entry.width, height: entry.height,
      maxDepthM: entry.maxDepthM, contourIntervalM: entry.contourIntervalM, surveyedShare: entry.surveyedShare, surveys: entry.surveys, renderedAt: entry.renderedAt };
    if (!objects.some((object) => object.file === file)) objects.push({ file, sha256, bytes });
  }
  return { pin: { schemaVersion: 1, rendererVersion: manifest.rendererVersion, lakes }, objects };
}

/** Uploads each object once (If-None-Match), then reads it back and checks its bytes and hash. */
export async function publishPreviews(request, objects, progress = () => {}) {
  const publish = async (object) => {
    const key = `lake-previews/${object.file}`;
    const uploaded = await request(key, { method: "PUT", headers: { "if-none-match": "*", "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable", "x-amz-meta-sha256": object.sha256 }, body: object.bytes });
    await uploaded.body?.cancel();
    if (!uploaded.ok && uploaded.status !== 412) throw new Error(`Preview upload failed (${uploaded.status}).`);
    const downloaded = await request(key, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (downloaded.headers.get("x-amz-meta-sha256") !== object.sha256) {
      await downloaded.body?.cancel();
      throw new Error(`Remote preview integrity metadata mismatch for ${object.file}.`);
    }
    await verifyArchiveResponse(downloaded, object.bytes.length, object.sha256);
    progress(object.file);
  };
  const queue = [...objects];
  const workers = await Promise.allSettled(Array.from({ length: 6 }, async () => {
    while (queue.length) await publish(queue.shift());
  }));
  const failed = workers.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}
