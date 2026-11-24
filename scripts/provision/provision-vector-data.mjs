import { cloudflareClient } from "../lib/cloudflare-client.mjs";
import { assertDigestPinPolicy, parseArchiveFlags, provisionWithReceipt, statArchive, verifyArchiveDigest, verifyPmtilesHeader, verifyVectorSchema } from "../lib/archive-provisioning.mjs";
import { PROTOMAPS_SNAPSHOT } from "../lib/dataset-version.mjs";
import { processRunner } from "../lib/process.mjs";

// The snapshot the worker advertises; kept in one module so a basemap refresh
// cannot leave the manifest, the cache keys and this upload disagreeing.
const DATASET_SNAPSHOT = PROTOMAPS_SNAPSHOT;
const EXPECTED_MAX_ZOOM = 12;
const OBJECT_KEY = "osm/current.pmtiles";

const options = parseArchiveFlags(process.argv.slice(2));
const { flags, archivePath, buckets } = options;
const verifyOnly = flags.includes("--verify-only");
if (verifyOnly && (flags.includes("--provision") || flags.includes("--promote") || flags.includes("--prod"))) throw new Error("--verify-only cannot be combined with publication flags.");
if (!archivePath || (!verifyOnly && !flags.includes("--provision"))) {
  throw new Error("Usage: node scripts/provision/provision-vector-data.mjs <archive.pmtiles> (--provision | --verify-only) [--prod] [--promote] [--expected-sha256=<hex> | EXPECTED_ARCHIVE_SHA256=<hex>] [--skip-digest-check]");
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

console.log(`Verifying ${archivePath} (${(archive.size / 1_000_000_000).toFixed(2)} GB).`);
const archiveDigest = await verifyArchiveDigest(archivePath, options);
const header = await verifyPmtilesHeader({ run, capture, pmtilesBin, archivePath });
if (header.minzoom !== 0 || header.maxzoom !== EXPECTED_MAX_ZOOM) {
  throw new Error(`Expected a global zoom 0-${EXPECTED_MAX_ZOOM} archive; received zoom ${header.minzoom}-${header.maxzoom}.`);
}

const metadata = JSON.parse(await capture(pmtilesBin, ["show", archivePath, "--metadata"]));
verifyVectorSchema(header, metadata, "protomaps");

if (verifyOnly) {
  console.log("Verified the local Protomaps archive digest, zoom range and vector schema.");
  process.exit(0);
}
const cloudflare = cloudflareClient(accountId, apiToken);

// Staging is the default. --promote changes a small release pointer only after
// the uploaded object's entire SHA-256 and size have been verified remotely.
await provisionWithReceipt({ accountId, cloudflare, buckets, logicalKey: OBJECT_KEY,
  dataset: DATASET_SNAPSHOT, archivePath, sha256: archiveDigest, bytes: archive.size, maxZoom: EXPECTED_MAX_ZOOM,
  pmtilesBin, run, promote: options.promote });
