/** Activate a pre-staged FAA archive together with the production registration. */
import { readFile } from "node:fs/promises";
import { parseArchiveRelease } from "@topostack/data-contracts/archive-release";
import { validateAviationSources } from "@topostack/data-contracts/aviation-tiles";
import { PRODUCTION_BUCKET, stageArchive, verifyArchiveResponse } from "../lib/archive-provisioning.mjs";
import { cloudflareClient } from "../lib/cloudflare-client.mjs";
import { writeJsonAtomic } from "../lib/files.mjs";
import { fetchGatewayJson } from "../lib/gateway.mjs";
import { isMainModule } from "../lib/main-module.mjs";
import { bucketDeployment } from "../lib/r2-buckets.mjs";
import { temporaryR2Client, verifyParentToken } from "../lib/r2-s3.mjs";

const logicalKey = "aviation/current.pmtiles";

export async function activateAviationRelease({ candidate, dataset, request, manifest, promote = false, checkpoint }) {
  const release = parseArchiveRelease(candidate, logicalKey);
  if (release.dataset !== dataset) throw new Error("Staged FAA release differs from the committed registration.");
  if (promote && (manifest?.capabilities?.archiveReleases !== 1
    || !manifest.sources?.some(source => source.archive === "/v1/aviation.pmtiles" && source.id === dataset))) {
    throw new Error("Deploy the registered FAA dataset before activating its archive.");
  }
  if (promote && typeof checkpoint !== "function") throw new Error("FAA promotion requires a rollback checkpoint.");
  const currentResponse = await request(`releases/${logicalKey}.json`, { method: "GET", headers: { "accept-encoding": "identity" } });
  if (currentResponse.status !== 200) { await currentResponse.body?.cancel(); throw new Error(`FAA release lookup failed (${currentResponse.status}).`); }
  const current = parseArchiveRelease(await currentResponse.json(), logicalKey);
  const alreadyActive = current.dataset === release.dataset && current.objectKey === release.objectKey
    && current.sha256 === release.sha256 && current.bytes === release.bytes && current.etag === release.etag;
  if (!promote || alreadyActive) {
    await verifyArchiveResponse(await request(release.objectKey, { method: "GET" }), release.bytes, release.sha256);
    return { release, previousRelease: current, promoted: false, alreadyActive };
  }
  // Reuse the immutable object. stageArchive freshly hashes the full remote
  // body and uses the current pointer's strong ETag for a conditional PUT.
  const id = release.objectKey.split("/").at(-1).slice(0, -".pmtiles".length);
  return stageArchive({ ...release, id, request, promote: true, upload: async () => {}, checkpoint });
}

async function deployedManifest(origin, dataset) {
  const deadline = Date.now() + 180_000;
  do {
    try {
      const manifest = await fetchGatewayJson(origin, "/v1/manifest");
      if (manifest.sources?.some(source => source.archive === "/v1/aviation.pmtiles" && source.id === dataset)) return manifest;
    } catch (error) {
      console.warn(`Waiting for the deployed FAA registration: ${error.message}`);
    }
    if (Date.now() + 3000 >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  } while (Date.now() < deadline);
  throw new Error("The deployed Worker does not advertise the registered FAA dataset; archive unchanged.");
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--prod", "--promote", "--verify-only"].includes(arg) && !arg.startsWith("--receipt="))
    || !args.includes("--prod") || args.includes("--promote") === args.includes("--verify-only")) {
    throw new Error("Usage: node scripts/provision/activate-aviation-release.mjs --prod (--verify-only | --promote) [--receipt=<path>]");
  }
  const sources = validateAviationSources(JSON.parse(await readFile(new URL("../data/faa-aviation-sources.json", import.meta.url))));
  const candidate = parseArchiveRelease(JSON.parse(await readFile(new URL("../data/faa-aviation-production-release.json", import.meta.url))), logicalKey);
  if (candidate.dataset !== sources.dataset) throw new Error("Stage and register the production FAA archive before deploying this registration.");
  const promote = args.includes("--promote");
  const receiptPath = args.find(arg => arg.startsWith("--receipt="))?.slice("--receipt=".length);
  if (promote && !receiptPath) throw new Error("Promotion requires --receipt to retain rollback information.");
  const cloudflare = cloudflareClient();
  const parentAccessKeyId = await verifyParentToken(cloudflare);
  const { request } = await temporaryR2Client({ cloudflare, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, bucket: PRODUCTION_BUCKET, parentAccessKeyId,
    permission: promote ? "object-read-write" : "object-read-only", objects: [candidate.objectKey, `releases/${logicalKey}.json`] });
  const manifest = promote ? await deployedManifest(bucketDeployment(PRODUCTION_BUCKET).origin, sources.dataset) : undefined;
  const result = await activateAviationRelease({ candidate, dataset: sources.dataset, request, manifest, promote,
    checkpoint: receipt => writeJsonAtomic(receiptPath, { bucket: PRODUCTION_BUCKET, ...receipt }) });
  if (receiptPath) await writeJsonAtomic(receiptPath, { bucket: PRODUCTION_BUCKET, ...result });
  console.log(`${result.promoted ? "Activated" : "Verified"} ${sources.dataset} in production${result.alreadyActive ? " (already active)" : ""}.`);
}
