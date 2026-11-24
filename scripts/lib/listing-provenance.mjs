export function renderIdentity(identity) {
  if (!identity || !/^[0-9a-f]{40}$/.test(identity.sourceCommit) || !/^[0-9a-f]{64}$/.test(identity.sourceDiffSha256)
    || typeof identity.origin !== "string" || typeof identity.version !== "string" || !Number.isFinite(Date.parse(identity.capturedAt))) {
    throw new Error("Listing renders have no capture identity. Make a fresh capture.");
  }
  return identity;
}

export function verifyListingProvenance(provenance) {
  renderIdentity(provenance);
  if (provenance.reusedRenders !== false) throw new Error("Release listing images require a fresh capture");
  for (const item of provenance.media) {
    if (item.sourceCommit !== provenance.sourceCommit) throw new Error(`${item.file} identifies another capture`);
  }
}
