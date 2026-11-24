import { parseArchiveRelease } from "@topostack/data-contracts/archive-release";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_GRACE_DAYS = 30;
export const MINIMUM_GRACE_DAYS = 7;
const ARCHIVE_OBJECT_KEY = /^archives\/[a-f0-9]{64}\/[a-f0-9-]{36}\.pmtiles$/;
const MAX_POINTER_BYTES = 16_384;

/** `releases/osm/current.pmtiles.json` → `osm/current.pmtiles`. */
export function logicalKeyOfPointer(pointerKey) {
  const match = /^releases\/(.+\.pmtiles)\.json$/.exec(pointerKey);
  if (!match) throw new Error(`Unexpected release pointer key: ${pointerKey}`);
  return match[1];
}

/** Reads and validates every pointer; any unreadable pointer aborts, since it might reference anything. */
export async function readReleasePointers(request, pointerKeys) {
  const pointers = [];
  for (const key of [...pointerKeys].sort()) {
    const response = await request(key, { method: "GET" });
    const etag = response.headers.get("etag");
    if (response.status !== 200 || !etag || Number(response.headers.get("content-length")) > MAX_POINTER_BYTES) {
      await response.body?.cancel();
      throw new Error(`Release pointer ${key} could not be read (${response.status}).`);
    }
    pointers.push({ key, etag, release: parseArchiveRelease(await response.json(), logicalKeyOfPointer(key)) });
  }
  return pointers;
}

/**
 * Decides which superseded archives can be deleted. Kept, in priority order:
 * - `active`: the object a release pointer serves;
 * - `rollback`: the predecessor a pointer recorded (one rollback generation);
 * - `deployment`: a pinned candidate for a registered deployment;
 * - `recent`: uploaded within the grace period (staged, in flight, or just replaced);
 * - `unknown-predecessor`: a pointer written before predecessors were recorded
 *   was promoted within the grace period, so this may be its rollback target;
 * - `unrecognized`: anything under `archives/` that is not a provisioned archive key.
 * Legacy logical-key objects shadowed by a pointer are only removable when
 * `includeLegacy` is set and the pointer has served for the whole grace period.
 */
export function planArchivePrune({ archives, legacy = [], pointers, protectedKeys = [], now = Date.now(), graceDays = DEFAULT_GRACE_DAYS, includeLegacy = false }) {
  if (!Number.isFinite(graceDays) || graceDays < MINIMUM_GRACE_DAYS) throw new Error(`The grace period must be at least ${MINIMUM_GRACE_DAYS} days.`);
  // Without pointers every archive looks unreferenced; that is a misconfigured
  // bucket or a failed listing, never a reason to delete everything.
  if (pointers.length === 0) throw new Error("No release pointers found; refusing to prune.");
  const cutoff = now - graceDays * DAY_MS;
  const active = new Set(pointers.map(({ release }) => release.objectKey));
  const reserved = new Set(protectedKeys);
  const rollback = new Set(pointers.map(({ release }) => release.previousObjectKey).filter(Boolean));
  const unknownHistory = pointers.some(({ release }) => release.previousObjectKey === undefined && Date.parse(release.verifiedAt) >= cutoff);
  const keep = [], remove = [];
  for (const object of archives) {
    const reason = !ARCHIVE_OBJECT_KEY.test(object.key) ? "unrecognized"
      : active.has(object.key) ? "active"
        : rollback.has(object.key) ? "rollback"
          : reserved.has(object.key) ? "deployment"
            : object.uploaded.getTime() >= cutoff ? "recent"
              : unknownHistory ? "unknown-predecessor"
                : null;
    (reason ? keep : remove).push({ key: object.key, size: object.size, uploaded: object.uploaded.toISOString(), reason: reason ?? "superseded" });
  }
  for (const object of legacy) {
    const pointer = pointers.find(({ release }) => release.logicalKey === object.key);
    if (!pointer) throw new Error(`Legacy object ${object.key} has no release pointer.`);
    const settled = Date.parse(pointer.release.verifiedAt) < cutoff && object.uploaded.getTime() < cutoff;
    const entry = { key: object.key, size: object.size, uploaded: object.uploaded.toISOString() };
    if (includeLegacy && settled) remove.push({ ...entry, reason: "legacy-shadowed" });
    else keep.push({ ...entry, reason: settled ? "legacy-opt-in" : "legacy-recent" });
  }
  const bytes = (entries) => entries.reduce((total, entry) => total + entry.size, 0);
  return { cutoff: new Date(cutoff).toISOString(), keep, remove, keepBytes: bytes(keep), removeBytes: bytes(remove) };
}

/** Pointers must be unchanged between planning and deletion, or the plan may be stale. */
export function pointersUnchanged(before, after) {
  const summary = (pointers) => JSON.stringify(pointers.map(({ key, etag }) => [key, etag]).sort());
  return summary(before) === summary(after);
}
