import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appUrl } from "../lib/app-url.mjs";
import { assertDigestPinPolicy, parseArchiveFlags, provisionWithReceipt, verifyArchiveDigest } from "../lib/archive-provisioning.mjs";
import { cloudflareClient } from "../lib/cloudflare-client.mjs";
import { filesBelow, writeJsonAtomic } from "../lib/files.mjs";
import { capture, run } from "../lib/process.mjs";

const accountId = "a".repeat(32);
const quiet = { log: () => {}, warn: () => {} };

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "topostack-scripts-"));
  try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("archive flags share parsing and digest-pin policy", () => {
  const digest = "c".repeat(64);
  const parsed = parseArchiveFlags(["archive.pmtiles", "--provision", "--prod", "--promote", `--expected-sha256=${digest.toUpperCase()}`], {});
  assert.equal(parsed.archivePath, "archive.pmtiles");
  assert.equal(parsed.expectedDigest, digest);
  assert.equal(parsed.promote, true);
  assert.deepEqual(parsed.buckets, ["topostack-vector-data-development", "topostack-vector-data"]);
  assertDigestPinPolicy(parsed);
  assert.equal(parseArchiveFlags(["a"], { EXPECTED_ARCHIVE_SHA256: ` ${digest} ` }).expectedDigest, digest);
  assert.deepEqual(parseArchiveFlags(["a"], {}).buckets, ["topostack-vector-data-development"]);
  assert.throws(() => assertDigestPinPolicy(parseArchiveFlags(["a", "--prod", "--skip-digest-check"], {})), /Production provisioning requires/);
  assert.throws(() => assertDigestPinPolicy(parseArchiveFlags(["a", "--skip-digest-check", `--expected-sha256=${digest}`], {})), /either a pinned/);
  assert.throws(() => assertDigestPinPolicy(parseArchiveFlags(["a", "--expected-sha256=abc"], {})), /64 hexadecimal/);
});

test("archive digest verification refuses mismatches and unpinned uploads", () => withTemporaryDirectory(async (directory) => {
  const archivePath = join(directory, "archive.pmtiles");
  await writeFile(archivePath, "archive bytes");
  const digest = createHash("sha256").update("archive bytes").digest("hex");
  assert.equal(await verifyArchiveDigest(archivePath, { expectedDigest: digest }, quiet), digest);
  assert.equal(await verifyArchiveDigest(archivePath, { skipDigestCheck: true }, quiet), digest);
  await assert.rejects(verifyArchiveDigest(archivePath, { expectedDigest: "0".repeat(64) }, quiet), /digest mismatch/);
  await assert.rejects(verifyArchiveDigest(archivePath, {}, quiet), /No pinned digest/);
}));

test("atomic JSON writes never leave a partial file behind", () => withTemporaryDirectory(async (directory) => {
  const target = join(directory, "receipt.json");
  await writeFile(target, "previous");
  await writeJsonAtomic(target, { promoted: true });
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { promoted: true });
  assert.deepEqual(await readdir(directory), ["receipt.json"]);
  // A value that cannot be serialized fails before the previous receipt is replaced.
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(writeJsonAtomic(target, cyclic));
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { promoted: true });
  assert.deepEqual(await readdir(directory), ["receipt.json"]);
}));

test("provisioning receipts are checkpointed atomically per bucket", () => withTemporaryDirectory(async (directory) => {
  const archivePath = join(directory, "archive.pmtiles");
  const writes = [];
  const provision = async ({ buckets, checkpoint }) => {
    for (const bucket of buckets) {
      await checkpoint({ bucket, promoted: false });
      await checkpoint({ bucket, promoted: true });
    }
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    const { receiptPath } = await provisionWithReceipt({ archivePath, dataset: "fixture", logicalKey: "osm/current.pmtiles", maxZoom: 12, sha256: "d".repeat(64), bytes: 10,
      buckets: ["dev", "prod"], promote: true, provision,
      writeReceipt: async (target, value) => { writes.push(structuredClone(value)); await writeJsonAtomic(target, value); } });
    assert.equal(receiptPath, `${archivePath}.provisioning.json`);
    const stored = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.deepEqual(stored.releases, [{ bucket: "dev", promoted: true }, { bucket: "prod", promoted: true }]);
    assert.equal(stored.schemaVersion, 2);
    assert.equal(writes.length, 4);
    assert.deepEqual(writes[2].releases, [{ bucket: "dev", promoted: true }, { bucket: "prod", promoted: false }]);
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".part")), []);
  } finally { console.log = originalLog; }
}));

test("Cloudflare client reports status for non-JSON failures without echoing bodies", async () => {
  const api = cloudflareClient(accountId, "token", async () => new Response("<html>bad gateway secret</html>", { status: 502 }));
  await assert.rejects(api("/tokens/verify"), (error) => /\(502; response was not JSON\)/.test(error.message) && !error.message.includes("secret"));
});

test("Cloudflare client checks status and success and returns results", async () => {
  const failing = cloudflareClient(accountId, "token", async () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 }));
  await assert.rejects(failing("/x"), /\(403; codes: 10000\)/);
  const unsuccessful = cloudflareClient(accountId, "token", async () => Response.json({ success: false, errors: null }));
  await assert.rejects(unsuccessful("/x"), /\(200; codes: \)/);
  let seen;
  const ok = cloudflareClient(accountId, "token", async (url, init) => { seen = { url, init }; return Response.json({ success: true, result: { id: 1 } }); });
  assert.deepEqual(await ok("/tokens/verify", { headers: { "x-extra": "1" } }), { id: 1 });
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`);
  assert.equal(seen.init.headers.authorization, "Bearer token");
  assert.equal(seen.init.headers["x-extra"], "1");
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test("Cloudflare client honors the caller's abort signal alongside its timeout", async () => {
  const controller = new AbortController();
  const api = cloudflareClient(accountId, "token", (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const pending = api("/slow", { signal: controller.signal });
  controller.abort(new Error("caller cancelled"));
  await assert.rejects(pending, /caller cancelled/);
});

test("filesBelow lists nested files as file URLs", () => withTemporaryDirectory(async (directory) => {
  await mkdir(join(directory, "assets", "deep"), { recursive: true });
  await writeFile(join(directory, "index.html"), "");
  await writeFile(join(directory, "assets", "deep", "app one.js"), "");
  const files = await filesBelow(new URL(`file://${directory}/`));
  assert.ok(files.every((file) => file instanceof URL));
  assert.deepEqual(files.map((file) => fileURLToPath(file).slice(directory.length + 1)).sort(), ["assets/deep/app one.js", "index.html"]);
  assert.equal((await filesBelow(directory)).length, 2);
}));

test("process helpers wait for all output before resolving", async () => {
  const bytes = 4 * 1024 * 1024;
  const output = await capture(process.execPath, ["-e", `process.stdout.write("x".repeat(${bytes}))`]);
  assert.equal(output.length, bytes);
  await run(process.execPath, ["-e", ""], {});
  await assert.rejects(capture(process.execPath, ["-e", "process.exit(3)"]), /code 3/);
});

test("appUrl prefers TOPOSTACK_APP_URL, then a script's own variable, then the dev server", () => {
  const saved = { ...process.env };
  try {
    delete process.env.TOPOSTACK_APP_URL; delete process.env.LEGACY_APP_URL; delete process.env.TOPOSTACK_WEB_PORT;
    assert.equal(appUrl("LEGACY_APP_URL"), "http://localhost:5273");
    process.env.TOPOSTACK_WEB_PORT = "5290";
    assert.equal(appUrl("LEGACY_APP_URL"), "http://localhost:5290");
    process.env.LEGACY_APP_URL = "http://127.0.0.1:5278/";
    assert.equal(appUrl("LEGACY_APP_URL"), "http://127.0.0.1:5278");
    process.env.TOPOSTACK_APP_URL = "https://dev.topostack.app";
    assert.equal(appUrl("LEGACY_APP_URL"), "https://dev.topostack.app");
  } finally {
    for (const name of ["TOPOSTACK_APP_URL", "LEGACY_APP_URL", "TOPOSTACK_WEB_PORT"]) {
      if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
  }
});
