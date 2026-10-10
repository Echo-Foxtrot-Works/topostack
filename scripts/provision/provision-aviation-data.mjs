/**
 * Upload the FAA aviation archive built by scripts/data-build/build-faa-aviation.py.
 *
 * Uses the same staged upload, full remote verification, and conditional
 * release-pointer promotion as provision-vector-data.mjs. The archive's own
 * metadata must name the dataset pinned in scripts/data/faa-aviation-sources.json,
 * so a stale cycle cannot be uploaded under the current registration.
 */
import { readFile } from "node:fs/promises";
import { cloudflareClient } from "../lib/cloudflare-client.mjs";
import { assertDigestPinPolicy, parseArchiveFlags, provisionWithReceipt, statArchive, verifyArchiveDigest, verifyPmtilesHeader } from "../lib/archive-provisioning.mjs";
import { processRunner } from "../lib/process.mjs";
import { AVIATION_LAYERS, parseAviationArchiveMetadata, validateAviationSources } from "@topostack/data-contracts/aviation-tiles";

const OBJECT_KEY = "aviation/current.pmtiles";
const EXPECTED_MIN_ZOOM = 5;

const options = parseArchiveFlags(process.argv.slice(2));
const { flags, archivePath, buckets } = options;
const verifyOnly = flags.includes("--verify-only");
const candidateSources = flags.find((flag) => flag.startsWith("--sources="))?.slice("--sources=".length);
if (candidateSources && !verifyOnly) throw new Error("--sources is only allowed for local candidate verification; publication requires the committed registration.");
const sources = validateAviationSources(JSON.parse(await readFile(candidateSources ?? new URL("../data/faa-aviation-sources.json", import.meta.url), "utf8")));
if (verifyOnly && (flags.includes("--provision") || flags.includes("--promote") || flags.includes("--prod"))) throw new Error("--verify-only cannot be combined with publication flags.");
if (!archivePath || (!verifyOnly && !flags.includes("--provision"))) {
  throw new Error("Usage: node scripts/provision/provision-aviation-data.mjs <archive.pmtiles> (--provision | --verify-only) [--sources=<candidate.json> (verify-only)] [--prod] [--promote] [--expected-sha256=<hex> | EXPECTED_ARCHIVE_SHA256=<hex>] [--skip-digest-check]");
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
if (header.tile_type !== "mvt" || header.minzoom !== EXPECTED_MIN_ZOOM || header.maxzoom !== sources.maxZoom) {
  throw new Error(`Expected a vector archive at zoom ${EXPECTED_MIN_ZOOM}-${sources.maxZoom}; received ${header.tile_type} at zoom ${header.minzoom}-${header.maxzoom}.`);
}
const metadata = JSON.parse(await capture(pmtilesBin, ["show", archivePath, "--metadata"]));
const identity = parseAviationArchiveMetadata(metadata);
if (identity.dataset !== sources.dataset || identity.obstacleDate !== sources.obstacleDate || identity.suaDate !== sources.suaDate) {
  throw new Error(`Archive is ${identity.dataset}; scripts/data/faa-aviation-sources.json registers ${sources.dataset}. Refusing to upload a different dataset.`);
}
const layers = new Set((metadata.vector_layers ?? []).map((layer) => layer.id));
const missing = AVIATION_LAYERS.filter((layer) => !layers.has(layer));
if (missing.length) throw new Error(`Archive is missing aviation layers: ${missing.join(", ")}.`);

if (verifyOnly) {
  console.log("Verified locally: archive hash, format, registration and layers. No remote changes.");
  process.exit(0);
}
const cloudflare = cloudflareClient(accountId, apiToken);

// Staging is the default. --promote changes a small release pointer only after
// the uploaded object's entire SHA-256 and size have been verified remotely.
await provisionWithReceipt({ accountId, cloudflare, buckets, logicalKey: OBJECT_KEY,
  dataset: sources.dataset, archivePath, sha256: archiveDigest, bytes: archive.size, maxZoom: sources.maxZoom,
  pmtilesBin, run, promote: options.promote });
