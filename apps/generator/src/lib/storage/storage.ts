import { getMany, set, setMany } from "idb-keyval";
import { parseProject, type ProjectConfigV1 } from "@topostack/core";

const PROJECT_KEY = "topostack:project:v1";
/** When the IndexedDB copy was written, stored in the same transaction as the project. */
const PROJECT_SAVED_AT_KEY = "topostack:project:v1:saved-at";
/**
 * A synchronous localStorage copy written as the page hides. IndexedDB writes
 * started from `pagehide` are asynchronous, and an unloading page drops them:
 * an edit followed by an immediate reload was lost every time in Chromium.
 */
export const PROJECT_UNLOAD_COPY_KEY = "topostack:project:v1:unload-copy";
/** localStorage allows about five million characters per origin; stay well clear of it. */
const MAX_UNLOAD_COPY_LENGTH = 1_000_000;
/** Where an unreadable saved project is copied before autosave replaces it. */
export const PROJECT_BACKUP_KEY = "topostack:project:v1:unreadable-backup";

/**
 * Reading or parsing the primary failed. A backup key means its raw value
 * was preserved and autosave can safely resume.
 */
export class UnreadableSavedProjectError extends Error {
  override readonly name = "UnreadableSavedProjectError";
  constructor(readonly backupKey: string | undefined, cause: unknown, readonly recovery?: ProjectConfigV1) {
    super(backupKey ? "Saved project could not be read · a backup copy was kept" : "Saved project could not be read · autosave paused to protect it", { cause });
  }
}

/**
 * Load the autosaved project: the IndexedDB copy, or the unload copy when that
 * is newer. IndexedDB that cannot be read restores only the unload copy. A
 * value that no longer parses (an older or newer build wrote it) is copied to
 * `PROJECT_BACKUP_KEY` and reported, so the next autosave never silently
 * destroys the only copy; that check runs before the unload copy is
 * considered, so a newer unload copy never lets autosave skip the backup.
 */
export async function loadProject(): Promise<ProjectConfigV1 | undefined> {
  const unloadCopy = readUnloadCopy();
  let value: unknown;
  let savedAt: unknown;
  const read = () => getMany<unknown>([PROJECT_KEY, PROJECT_SAVED_AT_KEY]);
  try {
    // A single aborted transaction can be retried on a new transaction.
    [value, savedAt] = await read().catch(read);
  } catch (error) {
    // The primary could be newer than the unload copy. Let the editor open
    // that copy while protecting both storage keys until a successful read.
    throw new UnreadableSavedProjectError(undefined, error, unloadCopy && parseUnloadCopy(unloadCopy));
  }
  if (value === undefined) return unloadCopy ? parseUnloadCopy(unloadCopy) : undefined;
  let saved: ProjectConfigV1;
  try {
    saved = parseProject(value);
  } catch (error) {
    console.warn("TopoStack: the saved project could not be restored.", error);
    try {
      await set(PROJECT_BACKUP_KEY, { backedUpAt: new Date().toISOString(), reason: error instanceof Error ? error.message : String(error), value });
    } catch (backupError) {
      throw new UnreadableSavedProjectError(undefined, backupError, unloadCopy && parseUnloadCopy(unloadCopy));
    }
    const recovered = unloadCopy && parseUnloadCopy(unloadCopy);
    if (recovered) return recovered;
    throw new UnreadableSavedProjectError(PROJECT_BACKUP_KEY, error);
  }
  // An IndexedDB copy without a time predates the unload copy, so the copy wins.
  if (unloadCopy && (typeof savedAt !== "number" || unloadCopy.savedAt > savedAt)) return parseUnloadCopy(unloadCopy) ?? saved;
  if (unloadCopy) removeUnloadCopy();
  return saved;
}

interface UnloadCopy { savedAt: number; value: unknown }

function unloadStorage(): Storage | undefined {
  // Reading `localStorage` itself throws where site data is blocked.
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readUnloadCopy(): UnloadCopy | undefined {
  try {
    const raw = unloadStorage()?.getItem(PROJECT_UNLOAD_COPY_KEY);
    if (!raw) return undefined;
    const record: unknown = JSON.parse(raw);
    if (record && typeof record === "object" && typeof (record as UnloadCopy).savedAt === "number") return record as UnloadCopy;
  } catch { /* An unreadable copy is ignored; IndexedDB stays authoritative. */ }
  return undefined;
}

function removeUnloadCopy(): void {
  try { unloadStorage()?.removeItem(PROJECT_UNLOAD_COPY_KEY); } catch { /* Nothing to protect. */ }
}

/** A copy that no longer parses (another build wrote it) falls back to IndexedDB. */
function parseUnloadCopy(copy: UnloadCopy): ProjectConfigV1 | undefined {
  try {
    return parseProject(copy.value);
  } catch (error) {
    console.warn("TopoStack: the project saved while the page closed could not be restored.", error);
    return undefined;
  }
}

let lastSavedAt = 0;
/** Strictly increasing within a session, so two saves in one millisecond still order. */
function nextSavedAt(): number {
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
  return lastSavedAt;
}


export async function saveProject(project: ProjectConfigV1): Promise<void> {
  const savedAt = nextSavedAt();
  await setMany([[PROJECT_KEY, project], [PROJECT_SAVED_AT_KEY, savedAt]]);
  // IndexedDB now holds everything the unload copy held.
  const copy = readUnloadCopy();
  if (copy && copy.savedAt <= savedAt) removeUnloadCopy();
}

/**
 * Write `project` to localStorage synchronously, for a page that is about to
 * unload before its IndexedDB save can finish. `loadProject` prefers this copy
 * while it is newer than the IndexedDB copy. Returns whether it was written;
 * an oversized project or full storage leaves IndexedDB as the only copy.
 */
export function saveProjectUnloadCopy(project: ProjectConfigV1): boolean {
  const storage = unloadStorage();
  if (!storage) return false;
  const raw = JSON.stringify({ savedAt: nextSavedAt(), value: project } satisfies UnloadCopy);
  if (raw.length > MAX_UNLOAD_COPY_LENGTH) return false;
  try {
    storage.setItem(PROJECT_UNLOAD_COPY_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
