import registration from "../data/faa-aviation-sources.json" with { type: "json" };
import candidate from "../data/faa-aviation-production-release.json" with { type: "json" };

/** After promotion a registered candidate alone is insufficient for the deployment smoke. */
export function requireActiveAviation(manifest, environment) {
  const source = manifest.sources.find(entry => entry?.archive === "/v1/aviation.pmtiles");
  const release = source?.release;
  if (source?.id !== registration.dataset || manifest.registrations?.aviation?.dataset !== registration.dataset
    || !release || !/^[a-f0-9]{64}$/.test(release.sha256) || !Number.isSafeInteger(release.bytes) || release.bytes < 127 || !release.etag) {
    throw new Error(`The manifest does not serve the registered FAA dataset ${registration.dataset}.`);
  }
  if (environment === "production" && (release.sha256 !== candidate.sha256 || release.etag !== candidate.etag
    || release.bytes !== candidate.bytes || release.objectKey !== candidate.objectKey || candidate.dataset !== source.id
    || manifest.registrations.aviation.sha256 !== candidate.sha256)) {
    throw new Error("The active FAA archive differs from the production release pin.");
  }
  return source;
}

export function verifyAviationRange(response, release, offset, length) {
  if (response.status !== 206 || response.headers.get("etag") !== release.etag
    || response.headers.get("content-range") !== `bytes ${offset}-${offset + length - 1}/${release.bytes}`) {
    throw new Error("The FAA byte range differs from the release in the manifest.");
  }
}
