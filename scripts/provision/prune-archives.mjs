import { parseArchiveRelease } from "@topostack/data-contracts/archive-release";
import candidate from "../data/faa-aviation-production-release.json" with { type: "json" };
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DEVELOPMENT_BUCKET, PRODUCTION_BUCKET } from "../lib/archive-provisioning.mjs";
import { DEFAULT_GRACE_DAYS, planArchivePrune, pointersUnchanged, readReleasePointers } from "../lib/archive-pruning.mjs";
import { cloudflareClient } from "../lib/cloudflare-client.mjs";
import { receiptDirectory, writeJsonAtomic } from "../lib/files.mjs";
import { temporaryR2Client, verifyParentToken } from "../lib/r2-s3.mjs";

const USAGE = "Usage: node --env-file=.env scripts/provision/prune-archives.mjs [--apply] [--prod] [--grace-days=N] [--include-legacy]";
const flags = process.argv.slice(2);
if (flags.some((flag) => !["--apply", "--prod", "--include-legacy"].includes(flag) && !/^--grace-days=\d+$/.test(flag))) throw new Error(USAGE);
const apply = flags.includes("--apply");
const graceDays = Number(flags.find((flag) => flag.startsWith("--grace-days="))?.slice("--grace-days=".length) ?? DEFAULT_GRACE_DAYS);
const includeLegacy = flags.includes("--include-legacy");
const buckets = flags.includes("--prod") ? [DEVELOPMENT_BUCKET, PRODUCTION_BUCKET] : [DEVELOPMENT_BUCKET];
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const api = cloudflareClient(accountId);
const parentAccessKeyId = await verifyParentToken(api);
const receipts = receiptDirectory();
const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;

async function readState({ list, request }) {
  const pointerKeys = (await list({ prefix: "releases/" })).objects.map(({ key }) => key).filter((key) => key.endsWith(".json"));
  const pointers = await readReleasePointers(request, pointerKeys);
  const archives = (await list({ prefix: "archives/" })).objects;
  const legacy = [];
  for (const { release } of pointers) {
    const head = await request(release.logicalKey, { method: "HEAD" });
    if (head.status === 200) legacy.push({ key: release.logicalKey, size: Number(head.headers.get("content-length")), uploaded: new Date(head.headers.get("last-modified") ?? "") });
    else if (head.status !== 404) throw new Error(`Legacy object lookup failed for ${release.logicalKey} (${head.status}).`);
  }
  if (legacy.some(({ size, uploaded }) => !Number.isSafeInteger(size) || !Number.isFinite(uploaded.getTime()))) throw new Error("Legacy object metadata is incomplete.");
  return { pointers, archives, legacy };
}

for (const bucket of buckets) {
  const client = await temporaryR2Client({ cloudflare: api, accountId, bucket, parentAccessKeyId, permission: apply ? "object-read-write" : "object-read-only" });
  const state = await readState(client);
  const protectedKeys = bucket === PRODUCTION_BUCKET ? [parseArchiveRelease(candidate, "aviation/current.pmtiles").objectKey] : [];
  const plan = planArchivePrune({ ...state, protectedKeys, graceDays, includeLegacy });
  console.log(`\n${bucket}: keep ${plan.keep.length} (${gib(plan.keepBytes)}), remove ${plan.remove.length} (${gib(plan.removeBytes)}); grace cutoff ${plan.cutoff}`);
  for (const entry of plan.keep) console.log(`  keep   ${entry.reason.padEnd(19)} ${entry.key} (${gib(entry.size)})`);
  for (const entry of plan.remove) console.log(`  remove ${entry.reason.padEnd(19)} ${entry.key} (${gib(entry.size)}, uploaded ${entry.uploaded})`);
  if (!apply || plan.remove.length === 0) continue;

  await mkdir(receipts, { recursive: true, mode: 0o700 });
  const receiptPath = join(receipts, `${bucket}-archive-prune-${Date.now()}.json`);
  const receipt = { bucket, graceDays, includeLegacy, pointers: state.pointers, plan, deleted: [] };
  await writeJsonAtomic(receiptPath, receipt);
  // A promotion or rollback since planning could change what is referenced.
  if (!pointersUnchanged(state.pointers, await readReleasePointers(client.request, state.pointers.map(({ key }) => key)))
    || (await client.list({ prefix: "releases/" })).objects.filter(({ key }) => key.endsWith(".json")).length !== state.pointers.length) {
    throw new Error(`Release pointers in ${bucket} changed during review. Rerun the audit.`);
  }
  for (const entry of plan.remove) {
    const response = await client.request(entry.key, { method: "DELETE" });
    await response.body?.cancel();
    if (response.status !== 204 && response.status !== 200) throw new Error(`Deleting ${entry.key} failed (${response.status}). Receipt: ${receiptPath}`);
    receipt.deleted.push(entry.key);
    await writeJsonAtomic(receiptPath, receipt);
  }
  console.log(`Deleted ${plan.remove.length} objects (${gib(plan.removeBytes)}) from ${bucket}. Receipt: ${receiptPath}`);
}
if (!apply) console.log("\nAudit only. Rerun with --apply to delete the objects marked remove.");
