import assert from "node:assert/strict";
import test from "node:test";
import { renderIdentity, verifyListingProvenance } from "../lib/listing-provenance.mjs";

test("a second checkout can recompose old pixels but cannot package them as a fresh capture", () => {
  const sourceCommit = "a".repeat(40);
  const capture = { sourceCommit, sourceDiffSha256: "b".repeat(64), capturedAt: "2026-01-01T00:00:00Z", version: "1.2.3", origin: "http://localhost:5273" };
  const media = [{ file: "cover.png", sourceCommit }];
  verifyListingProvenance({ ...capture, media, reusedRenders: false });
  const cached = JSON.parse(JSON.stringify({ captureIdentity: capture }));
  const second = { ...renderIdentity(cached.captureIdentity), media, composition: { ...capture, sourceCommit: "c".repeat(40) }, reusedRenders: true };
  assert.equal(second.sourceCommit, sourceCommit);
  assert.throws(() => verifyListingProvenance(second), /fresh capture/);
  assert.throws(() => renderIdentity(undefined), /no capture identity/);
  assert.throws(() => verifyListingProvenance({ ...second, sourceCommit: second.composition.sourceCommit, reusedRenders: false }), /another capture/);
});
