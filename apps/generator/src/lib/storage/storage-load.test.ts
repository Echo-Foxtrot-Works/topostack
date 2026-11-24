import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMany } from "idb-keyval";
import { DEFAULT_PROJECT } from "@topostack/core";

const store = vi.hoisted(() => new Map<string, unknown>());
const failWrites = vi.hoisted(() => ({ enabled: false }));
const failReads = vi.hoisted(() => ({ enabled: false }));
vi.mock("idb-keyval", () => ({
  getMany: vi.fn(async (keys: string[]) => { if (failReads.enabled) throw new Error("Storage is blocked"); return keys.map((key) => store.get(key)); }),
  set: vi.fn(async (key: string, value: unknown) => { if (failWrites.enabled) throw new Error("Quota exceeded"); store.set(key, value); }),
  setMany: vi.fn(async (entries: [string, unknown][]) => { if (failWrites.enabled) throw new Error("Quota exceeded"); for (const [key, value] of entries) store.set(key, value); }),
}));

import { loadProject, PROJECT_BACKUP_KEY, PROJECT_UNLOAD_COPY_KEY, saveProject, saveProjectUnloadCopy, UnreadableSavedProjectError } from "$lib/storage/storage";

const local = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => { if (failWrites.enabled) throw new DOMException("Quota exceeded", "QuotaExceededError"); local.set(key, String(value)); },
  removeItem: (key: string) => { local.delete(key); },
};

describe("saved project restore", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", localStorageStub); });
  afterEach(() => { store.clear(); local.clear(); failWrites.enabled = false; failReads.enabled = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("restores a valid saved project and returns nothing when none is saved", async () => {
    await expect(loadProject()).resolves.toBeUndefined();
    store.set("topostack:project:v1", { ...DEFAULT_PROJECT, name: "Saved" });
    await expect(loadProject()).resolves.toMatchObject({ name: "Saved" });
  });

  it("backs up an unparseable saved project before reporting it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = { ...DEFAULT_PROJECT, widthMm: "wide" };
    store.set("topostack:project:v1", raw);
    const error = await loadProject().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UnreadableSavedProjectError);
    expect((error as UnreadableSavedProjectError).backupKey).toBe(PROJECT_BACKUP_KEY);
    expect(store.get(PROJECT_BACKUP_KEY)).toMatchObject({ value: raw });
    // The original stays in place until the next autosave.
    expect(store.get("topostack:project:v1")).toBe(raw);
  });

  it("reports a missing backup so autosave can stay paused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    store.set("topostack:project:v1", { schemaVersion: 99 });
    failWrites.enabled = true;
    const error = await loadProject().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UnreadableSavedProjectError);
    expect((error as UnreadableSavedProjectError).backupKey).toBeUndefined();
  });

  it("restores an edit whose IndexedDB write the unloading page abandoned", async () => {
    await saveProject({ ...DEFAULT_PROJECT, name: "Before" });
    // The page hides: the unload copy lands, the IndexedDB write never does.
    expect(saveProjectUnloadCopy({ ...DEFAULT_PROJECT, name: "Just edited" })).toBe(true);
    await expect(loadProject()).resolves.toMatchObject({ name: "Just edited" });
    // It stays until IndexedDB holds something at least as new.
    expect(local.has(PROJECT_UNLOAD_COPY_KEY)).toBe(true);
    await saveProject({ ...DEFAULT_PROJECT, name: "Just edited" });
    expect(local.has(PROJECT_UNLOAD_COPY_KEY)).toBe(false);
  });

  it("prefers the unload copy over an IndexedDB copy written before save times existed", async () => {
    store.set("topostack:project:v1", { ...DEFAULT_PROJECT, name: "Legacy" });
    saveProjectUnloadCopy({ ...DEFAULT_PROJECT, name: "Copy" });
    await expect(loadProject()).resolves.toMatchObject({ name: "Copy" });
  });

  it("ignores and removes an unload copy older than the IndexedDB copy", async () => {
    await saveProject({ ...DEFAULT_PROJECT, name: "Newer save" });
    // A copy another tab left behind before this save.
    local.set(PROJECT_UNLOAD_COPY_KEY, JSON.stringify({ savedAt: 1, value: { ...DEFAULT_PROJECT, name: "Older copy" } }));
    await expect(loadProject()).resolves.toMatchObject({ name: "Newer save" });
    expect(local.has(PROJECT_UNLOAD_COPY_KEY)).toBe(false);
  });

  it("keeps a newer unload copy when an older IndexedDB save completes after it", async () => {
    const pending = saveProject({ ...DEFAULT_PROJECT, name: "Debounced" });
    saveProjectUnloadCopy({ ...DEFAULT_PROJECT, name: "Edited after" });
    await pending;
    expect(local.has(PROJECT_UNLOAD_COPY_KEY)).toBe(true);
    await expect(loadProject()).resolves.toMatchObject({ name: "Edited after" });
  });

  it("falls back to IndexedDB when the unload copy is corrupt or no longer parses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    store.set("topostack:project:v1", { ...DEFAULT_PROJECT, name: "Saved" });
    local.set(PROJECT_UNLOAD_COPY_KEY, "{not json");
    await expect(loadProject()).resolves.toMatchObject({ name: "Saved" });
    local.set(PROJECT_UNLOAD_COPY_KEY, JSON.stringify({ savedAt: Number.MAX_SAFE_INTEGER, value: { schemaVersion: 99 } }));
    await expect(loadProject()).resolves.toMatchObject({ name: "Saved" });
  });

  it("restores the unload copy alone when IndexedDB is empty or unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    saveProjectUnloadCopy({ ...DEFAULT_PROJECT, name: "Only copy" });
    await expect(loadProject()).resolves.toMatchObject({ name: "Only copy" });
    failReads.enabled = true;
    await expect(loadProject()).rejects.toMatchObject({ recovery: { name: "Only copy" }, backupKey: undefined });
  });

  it("retries an interrupted read before enabling writes to an existing project", async () => {
    await saveProject({ ...DEFAULT_PROJECT, name: "Original design" });
    vi.mocked(getMany).mockRejectedValueOnce(new DOMException("Interrupted", "AbortError"));
    await expect(loadProject()).resolves.toMatchObject({ name: "Original design" });
    failReads.enabled = true;
    await expect(loadProject()).rejects.toMatchObject({ backupKey: undefined });
    expect(store.get("topostack:project:v1")).toMatchObject({ name: "Original design" });
  });

  it("still backs up an unreadable IndexedDB copy when a newer unload copy exists", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = { ...DEFAULT_PROJECT, widthMm: "wide" };
    store.set("topostack:project:v1", raw);
    saveProjectUnloadCopy({ ...DEFAULT_PROJECT, name: "Copy" });
    await expect(loadProject()).resolves.toMatchObject({ name: "Copy" });
    expect(store.get(PROJECT_BACKUP_KEY)).toMatchObject({ value: raw });
  });

  it("skips the unload copy when storage is full, missing, or the project is oversized", () => {
    failWrites.enabled = true;
    expect(saveProjectUnloadCopy(DEFAULT_PROJECT)).toBe(false);
    failWrites.enabled = false;
    expect(saveProjectUnloadCopy({ ...DEFAULT_PROJECT, name: "x".repeat(1_000_001) })).toBe(false);
    expect(local.has(PROJECT_UNLOAD_COPY_KEY)).toBe(false);
    vi.stubGlobal("localStorage", undefined);
    expect(saveProjectUnloadCopy(DEFAULT_PROJECT)).toBe(false);
  });
});
