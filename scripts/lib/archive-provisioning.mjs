import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { parseArchiveRelease } from "@topostack/data-contracts/archive-release";
import { writeJsonAtomic } from "./files.mjs";
import { verifyPromotionGateway } from "./gateway.mjs";
import { bucketDeployment } from "./r2-buckets.mjs";
import { temporaryR2Client, verifyParentToken } from "./r2-s3.mjs";

export async function verifyArchiveResponse(response, expectedBytes, expectedDigest) {
  if (response.status !== 200 || !response.body) throw new Error(`Archive verification GET failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) !== expectedBytes) {
    await response.body.cancel();
    throw new Error("Remote archive size mismatch.");
  }
  const etag = response.headers.get("etag");
  if (!etag || !/^"[^"\r\n]+"$/.test(etag)) { await response.body.cancel(); throw new Error("Remote archive needs a strong ETag."); }
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > expectedBytes) throw new Error("Remote archive exceeds expected size.");
      hash.update(part.value);
    }
    if (bytes !== expectedBytes || hash.digest("hex") !== expectedDigest) throw new Error("Remote archive SHA-256/size verification failed.");
    return etag;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

/** Stage and fully verify before a conditional, atomic pointer promotion. */
export async function stageArchive({ logicalKey, dataset, bytes, sha256, upload, request, promote = false, id = randomUUID(), checkpoint = async () => {} }) {
  const objectKey = `archives/${sha256}/${id}.pmtiles`;
  const pointerKey = `releases/${logicalKey}.json`;
  // R2 gzips JSON pointers for clients that accept it and then returns a weak
  // etag, which never satisfies the strong If-Match comparison on promotion.
  const previous = await request(pointerKey, { method: "GET", headers: { "accept-encoding": "identity" } });
  let previousEtag, previousRelease = null;
  if (previous.status === 200) {
    previousEtag = previous.headers.get("etag");
    if (!previousEtag || previousEtag.startsWith("W/") || Number(previous.headers.get("content-length")) > 16_384) { await previous.body?.cancel(); throw new Error("Invalid existing release pointer."); }
    previousRelease = parseArchiveRelease(await previous.json(), logicalKey);
  } else if (previous.status !== 404) {
    await previous.body?.cancel(); throw new Error(`Release lookup failed (${previous.status}).`);
  } else await previous.body?.cancel();
  await upload(objectKey);
  const downloaded = await request(objectKey, { method: "GET", signal: AbortSignal.timeout(2 * 60 * 60 * 1000) });
  const etag = await verifyArchiveResponse(downloaded, bytes, sha256);
  // Recording the predecessor lets archive pruning keep exactly one rollback
  // target. Re-promoting the same object inherits its predecessor instead.
  const previousObjectKey = previousRelease?.objectKey === objectKey ? previousRelease.previousObjectKey : previousRelease?.objectKey ?? null;
  const release = parseArchiveRelease({ schemaVersion: 1, logicalKey, objectKey, dataset, bytes, sha256, etag, verifiedAt: new Date().toISOString(),
    ...(previousObjectKey === undefined ? {} : { previousObjectKey }) }, logicalKey);
  const receipt = { release, previousRelease, previousEtag: previousEtag ?? null, promoted: false };
  // Retain rollback information even if promotion or a subsequent bucket fails.
  await checkpoint(receipt);
  if (promote) {
    const result = await request(pointerKey, { method: "PUT", headers: {
      "content-type": "application/json", "cache-control": "no-store",
      ...(previousEtag ? { "if-match": previousEtag } : { "if-none-match": "*" }),
    }, body: JSON.stringify(release) });
    if (!result.ok) { await result.body?.cancel(); throw new Error(`Release promotion failed (${result.status}); inspect the current pointer before retrying.`); }
    await result.body?.cancel();
    receipt.promoted = true;
    await checkpoint(receipt);
  }
  return receipt;
}

export async function provisionVerifiedArchives({ accountId, cloudflare, buckets, logicalKey, dataset, archivePath, sha256, bytes, pmtilesBin, run, promote, checkpoint }) {
  if (promote) {
    for (const bucket of buckets) await verifyPromotionGateway(bucketDeployment(bucket).origin);
  }
  const parentAccessKeyId = await verifyParentToken(cloudflare);
  const receipts = [];
  for (const bucket of buckets) {
    const id = randomUUID();
    const objectKey = `archives/${sha256}/${id}.pmtiles`;
    const { credentials, endpoint, request } = await temporaryR2Client({ cloudflare, accountId, bucket, parentAccessKeyId,
      permission: "object-read-write", ttlSeconds: 86400, objects: [objectKey, `releases/${logicalKey}.json`] });
    console.log(`Staging and verifying ${logicalKey} in ${bucket}.`);
    const receipt = await stageArchive({ logicalKey, dataset, bytes, sha256, id, request, promote,
      upload: (key) => run(pmtilesBin, ["upload", archivePath, key, `--bucket=s3://${bucket}?endpoint=${endpoint}&region=auto&use_path_style=true`, "--max-concurrency=8"], {
        AWS_ACCESS_KEY_ID: credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey, AWS_SESSION_TOKEN: credentials.sessionToken,
      }),
      checkpoint: (receipt) => checkpoint({ bucket, ...receipt }),
    });
    receipts.push({ bucket, ...receipt });
  }
  return receipts;
}

export const DEVELOPMENT_BUCKET = "topostack-vector-data-development";
export const PRODUCTION_BUCKET = "topostack-vector-data";

/** Shared CLI flags of the archive provisioning scripts; usage checks stay with each script. */
export function parseArchiveFlags(argv, env = process.env) {
  const flags = argv.filter((argument) => argument.startsWith("--"));
  const includeProduction = flags.includes("--prod");
  return {
    flags,
    archivePath: argv.find((argument) => !argument.startsWith("--")),
    includeProduction,
    promote: flags.includes("--promote"),
    skipDigestCheck: flags.includes("--skip-digest-check"),
    expectedDigest: (flags.find((flag) => flag.startsWith("--expected-sha256="))?.slice("--expected-sha256=".length)
      ?? env.EXPECTED_ARCHIVE_SHA256 ?? "").trim().toLowerCase(),
    // Stage in development by default. Production staging and activation are explicit.
    buckets: includeProduction ? [DEVELOPMENT_BUCKET, PRODUCTION_BUCKET] : [DEVELOPMENT_BUCKET],
  };
}

export function assertDigestPinPolicy({ includeProduction, skipDigestCheck, expectedDigest }) {
  if (includeProduction && !expectedDigest) throw new Error("Production provisioning requires a pinned SHA-256 digest; --skip-digest-check is development-only.");
  if (skipDigestCheck && expectedDigest) throw new Error("Choose either a pinned SHA-256 digest or --skip-digest-check, not both.");
  if (expectedDigest && !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error("The expected SHA-256 digest must contain exactly 64 hexadecimal characters.");
}

export async function statArchive(archivePath) {
  await access(archivePath);
  const archive = await stat(archivePath);
  if (!archive.isFile()) throw new Error(`${archivePath} is not a file.`);
  return archive;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** Hashes the archive and enforces the pinned digest before anything is uploaded. */
export async function verifyArchiveDigest(archivePath, { expectedDigest, skipDigestCheck }, log = console) {
  const archiveDigest = await sha256File(archivePath);
  log.log(`Archive SHA-256: ${archiveDigest}`);
  if (expectedDigest) {
    if (archiveDigest !== expectedDigest) throw new Error(`Archive digest mismatch: expected ${expectedDigest}, computed ${archiveDigest}. Refusing to upload.`);
    log.log("Archive digest matches the pinned SHA-256.");
  } else if (skipDigestCheck) {
    log.warn("Digest pin check skipped (--skip-digest-check). Record the SHA-256 above and pin it for future runs.");
  } else {
    throw new Error("No pinned digest provided. Pass --expected-sha256=<hex> (or set EXPECTED_ARCHIVE_SHA256), or use --skip-digest-check for a first-time pin capture.");
  }
  return archiveDigest;
}

/** Validate the fields used by the lake and basemap readers before assigning a release identity. */
export function verifyVectorSchema(header, metadata, dataset) {
  const fields = dataset === "globathy"
    ? { lakes: { hylak_id: "Number", area_km2: "Number", dmax_m: "Number" } }
    : { roads: { kind: "String" }, water: { kind: "String" }, boundaries: { kind: "String" } };
  if (header.tile_type !== "mvt" || !Array.isArray(metadata?.vector_layers)) throw new Error(`Expected the ${dataset} MVT archive.`);
  for (const [id, expected] of Object.entries(fields)) {
    const layer = metadata.vector_layers.find((item) => item?.id === id);
    for (const [field, type] of Object.entries(expected)) {
      if (layer?.fields?.[field] !== type) throw new Error(`Expected ${dataset} layer ${id} with ${type} field ${field}.`);
    }
  }
}

/** Runs `pmtiles verify` and returns the archive header. */
export async function verifyPmtilesHeader({ run, capture, pmtilesBin, archivePath }) {
  await run(pmtilesBin, ["verify", archivePath]);
  return JSON.parse(await capture(pmtilesBin, ["show", archivePath, "--header-json"]));
}

/**
 * Stages (and optionally promotes) a verified archive, keeping a receipt beside
 * it. The receipt holds rollback information, so each checkpoint replaces it
 * atomically: an interrupted write never leaves a truncated record.
 */
export async function provisionWithReceipt({ archivePath, dataset, logicalKey, maxZoom, sha256, bytes, buckets, promote, provision = provisionVerifiedArchives, writeReceipt = writeJsonAtomic, ...options }) {
  const receiptPath = `${archivePath}.provisioning.json`;
  const receipt = { schemaVersion: 2, dataset, key: logicalKey, buckets, sha256, bytes, maxZoom, releases: [] };
  await provision({ ...options, buckets, logicalKey, dataset, archivePath, sha256, bytes, promote,
    checkpoint: async (entry) => {
      receipt.releases = [...receipt.releases.filter((item) => item.bucket !== entry.bucket), entry];
      await writeReceipt(receiptPath, receipt);
    },
  });
  console.log(`Verified ${logicalKey}. ${promote ? "Release pointer promoted." : "Staged only; rerun with --promote to activate after the gateway supports release pointers."} Receipt: ${receiptPath}`);
  return { receiptPath, receipt };
}
