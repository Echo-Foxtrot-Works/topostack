/**
 * Upload the public lands archive built by scripts/data-build/build-public-lands.py.
 *
 * Uses the same staged upload, full remote verification, and conditional
 * release-pointer promotion as provision-vector-data.mjs. The archive's own
 * metadata must name the dataset pinned in scripts/data/public-lands-sources.json,
 * so an archive from another PAD-US release cannot be uploaded under the current registration.
 */
import { readFile } from "node:fs/promises";
import { cloudflareClient } from "../lib/cloudflare-client.mjs";
import { assertDigestPinPolicy, parseArchiveFlags, provisionWithReceipt, statArchive, verifyArchiveDigest, verifyPmtilesHeader } from "../lib/archive-provisioning.mjs";
import { processRunner } from "../lib/process.mjs";
import { LANDS_LAYER, parseLandsArchiveMetadata, validateLandsSources } from "@topostack/data-contracts/land-tiles";

const OBJECT_KEY = "lands/current.pmtiles";

const options = parseArchiveFlags(process.argv.slice(2));
const { flags, archivePath, buckets } = options;
const verifyOnly = flags.includes("--verify-only");
const candidateSources = flags.find((flag) => flag.startsWith("--sources="))?.slice("--sources=".length);
if (candidateSources && !verifyOnly) throw new Error("--sources is only allowed for local candidate verification; publication requires the committed registration.");
const sources = validateLandsSources(JSON.parse(await readFile(candidateSources ?? new URL("../data/public-lands-sources.json", import.meta.url), "utf8")));
if (verifyOnly && (flags.includes("--provision") || flags.includes("--promote") || flags.includes("--prod"))) throw new Error("--verify-only cannot be combined with publication flags.");
if (!archivePath || (!verifyOnly && !flags.includes("--provision"))) {
  throw new Error("Usage: node scripts/provision/provision-lands-data.mjs <archive.pmtiles> (--provision | --verify-only) [--sources=<candidate.json> (verify-only)] [--prod] [--promote] [--expected-sha256=<hex> | EXPECTED_ARCHIVE_SHA256=<hex>] [--skip-digest-check]");
}
assertDigestPinPolicy(options);

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const pmtilesBin = process.env.PMTILES_BIN ?? "pmtiles";
if (!verifyOnly && (!accountId || !apiToken)) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
const childBaseEnv = { ...process.env };
delete childBaseEnv.CLOUDFLARE_API_TOKEN;

const archive = await statArchive(archivePath);
const { run, capture } = processRunner(childBaseEnv);

console.log(`Verifying ${archivePath} (${(archive.size / 1_000_000).toFixed(1)} MB).`);
const archiveDigest = await verifyArchiveDigest(archivePath, options);
const header = await verifyPmtilesHeader({ run, capture, pmtilesBin, archivePath });
if (header.tile_type !== "mvt" || header.minzoom !== sources.minZoom || header.maxzoom !== sources.maxZoom) {
  throw new Error(`Expected a vector archive at zoom ${sources.minZoom}-${sources.maxZoom}; received ${header.tile_type} at zoom ${header.minzoom}-${header.maxzoom}.`);
}
const metadata = JSON.parse(await capture(pmtilesBin, ["show", archivePath, "--metadata"]));
const identity = parseLandsArchiveMetadata(metadata);
if (identity.dataset !== sources.dataset || identity.padusVersion !== sources.padusVersion) {
  throw new Error(`Archive is ${identity.dataset}; scripts/data/public-lands-sources.json registers ${sources.dataset}. Refusing to upload a different dataset.`);
}
if (!(metadata.vector_layers ?? []).some((layer) => layer.id === LANDS_LAYER)) throw new Error(`Archive is missing the ${LANDS_LAYER} layer.`);

if (verifyOnly) {
  console.log("Verified locally: archive hash, format, registration and layer. No remote changes.");
  process.exit(0);
}
const cloudflare = cloudflareClient(accountId, apiToken);

// Staging is the default. --promote changes a small release pointer only after
// the uploaded object's entire SHA-256 and size have been verified remotely.
await provisionWithReceipt({ accountId, cloudflare, buckets, logicalKey: OBJECT_KEY,
  dataset: sources.dataset, archivePath, sha256: archiveDigest, bytes: archive.size, maxZoom: sources.maxZoom,
  pmtilesBin, run, promote: options.promote });
