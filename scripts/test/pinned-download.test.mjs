import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../lib/hash.mjs";
import { pinnedDownload } from "../lib/pinned-download.mjs";

const body = Buffer.from("%PDF-1.7 chart");
const pinned = sha256Hex(body);

async function withFetch(response, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response(); };
  const directory = await mkdtemp(join(tmpdir(), "pinned-download-"));
  try { await run(directory, calls); }
  finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
}

test("downloads once, caches the verified bytes and reads the cache after", async () => {
  await withFetch(() => new Response(body), async (directory, calls) => {
    const file = join(directory, "sources", "chart.pdf");
    assert.deepEqual(await pinnedDownload({ url: "https://example.test/chart.pdf", sha256: pinned, file }), body);
    assert.deepEqual(await readFile(file), body);
    assert.deepEqual(await pinnedDownload({ url: "https://example.test/chart.pdf", sha256: pinned, file }), body);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].init.signal instanceof AbortSignal, "downloads carry a timeout");
  });
});

test("a changed upstream fails without leaving a cached copy", async () => {
  await withFetch(() => new Response("changed"), async (directory) => {
    const file = join(directory, "chart.pdf");
    await assert.rejects(pinnedDownload({ url: "https://example.test/chart.pdf", sha256: pinned, file, label: "Chart" }), /Chart: sha256 is [0-9a-f]{64}, pinned /);
    await assert.rejects(readFile(file), { code: "ENOENT" });
  });
});

test("a stale cache names the file to delete, and HTTP errors name the status", async () => {
  await withFetch(() => new Response("missing", { status: 404 }), async (directory) => {
    const file = join(directory, "chart.pdf");
    await writeFile(file, "stale");
    await assert.rejects(pinnedDownload({ url: "https://example.test/chart.pdf", sha256: pinned, file }), /cached at .*chart\.pdf; delete it/);
    await assert.rejects(pinnedDownload({ url: "https://example.test/other.pdf", sha256: pinned, file: join(directory, "other.pdf"), label: "Other" }), /Other: download failed with 404\./);
  });
});
