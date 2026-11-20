import { cloudflareClient } from "../lib/cloudflare-client.mjs";
import { assertDigestPinPolicy, parseArchiveFlags, provisionWithReceipt, statArchive, verifyArchiveDigest, verifyPmtilesHeader } from "../lib/archive-provisioning.mjs";
/**
 * Upload registered lake bathymetry or additional terrain archives.
 *
 * Uses the same staged upload, full remote verification, and conditional
 * release-pointer promotion as provision-vector-data.mjs.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { processRunner } from "../lib/process.mjs";
import { validateTerrainPublication, validateTerrainRegistrySnapshot } from "../lib/terrain-publication.mjs";

import { validateSurveyCatalog, validateTerrainCatalog } from "@topostack/data-contracts/source-catalog";
const catalogArgument = process.argv.find((argument) => argument.startsWith("--terrain-catalog="))?.slice("--terrain-catalog=".length);
const terrainCatalogUrl = catalogArgument ? pathToFileURL(resolve(catalogArgument)) : new URL("../data/terrain-sources.json", import.meta.url);
const rawTerrainCatalog = JSON.parse(await readFile(terrainCatalogUrl, "utf8"));
if (rawTerrainCatalog.registryVersion !== undefined) {
  if (!/^terrain-releases\/[a-f0-9]{64}\.json$/.test(rawTerrainCatalog.releaseManifest ?? "")) throw new Error("Invalid terrain manifest reference.");
  validateTerrainRegistrySnapshot(rawTerrainCatalog, await readFile(new URL(rawTerrainCatalog.releaseManifest, terrainCatalogUrl)));
}
const terrainCatalog = validateTerrainCatalog(rawTerrainCatalog);

const catalog = validateSurveyCatalog(JSON.parse(await readFile(new URL("../data/lake-bathymetry.json", import.meta.url), "utf8")));
const sourceFlag = process.argv.find((argument) => argument.startsWith("--source="))?.slice(9) ?? "globathy";
const sourceId = sourceFlag === "noaa" ? "noaa-great-lakes-v1" : sourceFlag;
const terrain = terrainCatalog.sources.find((source) => source.id === sourceId);
const raster = terrain ?? catalog.sources.find((source) => source.id === sourceId);
if (!raster && sourceId !== "globathy") throw new Error("Unknown source; use globathy, noaa, or an ID from scripts/data/lake-bathymetry.json or terrain-sources.json.");
const DATASET_SNAPSHOT = raster?.id ?? "hydrolakes-v10+globathy-2022";
const EXPECTED_MAX_ZOOM = raster?.maxZoom ?? 12;
const OBJECT_KEY = terrain ? `terrain-sources/${terrain.id}.pmtiles` : raster ? `bathymetry/${raster.id}.pmtiles` : "lakes/current.pmtiles";

const options = parseArchiveFlags(process.argv.slice(2));
// A source still waiting on its publisher's approval may reach the development
// bucket only; the catalog flips it to "all" once the approval reference exists.
if (raster?.availability === "development" && options.flags.includes("--prod")) {
  throw new Error(`${raster.id} is registered for development only${raster.approval?.required ? " until its publisher's approval is recorded" : ""}; refusing --prod.`);
}
const { flags, archivePath, buckets } = options;
const verifyOnly = flags.includes("--verify-only");
if (verifyOnly && (flags.includes("--provision") || flags.includes("--promote") || flags.includes("--prod"))) throw new Error("--verify-only cannot be combined with publication flags.");
if (!archivePath || (!verifyOnly && !flags.includes("--provision"))) {
  throw new Error("Usage: node scripts/provision/provision-lake-data.mjs <archive.pmtiles> (--provision | --verify-only) [--source=globathy|noaa|<dataset-id>] [--prod] [--promote] [--expected-sha256=<hex> | EXPECTED_ARCHIVE_SHA256=<hex>] [--skip-digest-check]");
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
if ((!raster && header.minzoom !== 0) || !Number.isInteger(header.minzoom) || header.minzoom < 0 || header.minzoom > (terrain?.minZoom ?? EXPECTED_MAX_ZOOM) || header.maxzoom !== EXPECTED_MAX_ZOOM) {
  throw new Error(`Expected a zoom 0-${EXPECTED_MAX_ZOOM} archive; received zoom ${header.minzoom}-${header.maxzoom}.`);
}

if (raster) {
  const metadata = JSON.parse(await capture(pmtilesBin, ["show", archivePath, "--metadata"]));
  if (header.tile_type !== "png" || metadata.topostack_dataset !== DATASET_SNAPSHOT || metadata.topostack_encoding !== raster.encoding || (terrain && metadata.topostack_vertical_datum !== terrain.verticalDatum)) {
    throw new Error("Expected the registered numeric PNG archive. Refusing to upload a different dataset.");
  }
  if (terrain) {
    const legacyBuilds = JSON.parse(await readFile(new URL("../data/hrdem-builds.json", import.meta.url), "utf8")).builds;
    const legacyPins = JSON.parse(await readFile(new URL("../data/hrdem-sources.json", import.meta.url), "utf8"));
    const record = rawTerrainCatalog.records?.[terrain.id];
    const legacyReceipt = legacyBuilds.find((entry) => entry.dataset === terrain.id);
    const buildReceipt = record?.receipt ?? legacyReceipt;
    validateTerrainPublication({ source: terrain, header, metadata, receipt: buildReceipt,
      sha256: archiveDigest, bytes: archive.size, pin: record?.pin ?? legacyPins[terrain.id],
      legacy: legacyReceipt?.sha256 === archiveDigest });
  }
}

if (verifyOnly) {
  console.log("Verified locally: archive hash, format, registration and build receipt. No remote changes.");
  process.exit(0);
}
const cloudflare = cloudflareClient(accountId, apiToken);

// Staging is the default. --promote changes a small release pointer only after
// the uploaded object's entire SHA-256 and size have been verified remotely.
await provisionWithReceipt({ accountId, cloudflare, buckets, logicalKey: OBJECT_KEY,
  dataset: DATASET_SNAPSHOT, archivePath, sha256: archiveDigest, bytes: archive.size, maxZoom: EXPECTED_MAX_ZOOM,
  pmtilesBin, run, promote: options.promote });
