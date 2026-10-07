import { onDestroy } from "svelte";
import { validateProject, type ProjectConfigV1 } from "@topostack/core";
import { saveProject, saveProjectUnloadCopy } from "$lib/storage/storage";

/**
 * Never persist a project that would fail validation on the next load —
 * parse failures there would silently reset the user to the default project.
 */
function canPersist(current: ProjectConfigV1): boolean {
  try { validateProject(current); } catch { return false; }
  return Number.isFinite(current.explodedPreview) && current.explodedPreview >= 0 && current.explodedPreview <= 1;
}

/**
 * Saves every project snapshot once `active()` is true. Call during component
 * setup. Each snapshot is written to IndexedDB after a short pause, and also
 * synchronously to localStorage when the tab hides or unloads.
 */
export function autosaveProject(project: () => ProjectConfigV1, active: () => boolean, onUnavailable: () => void): void {
  /** Persist one snapshot, unless it could not be read back. */
  const persist = (current: ProjectConfigV1) => {
    if (!canPersist(current)) return;
    void saveProject(current).catch(onUnavailable);
  };
  /** The latest snapshot's write, until it runs; leaving the studio in-app fires no `pagehide`. */
  let pending: (() => void) | undefined;
  onDestroy(() => pending?.());
  $effect(() => {
    const current = project();
    if (!active()) return;
    let written = false;
    let timeout = 0;
    const write = () => { if (written) return; written = true; window.clearTimeout(timeout); persist(current); };
    pending = write;
    timeout = window.setTimeout(write, 450);
    // A closing, reloading or backgrounded tab must keep this snapshot, but an
    // unloading page abandons IndexedDB transactions it starts (an edit then
    // an immediate reload was lost every time), and can abandon one the
    // debounce started moments earlier. So the snapshot also goes to
    // localStorage synchronously, even when the debounced write already ran;
    // `loadProject` prefers that copy while it is newer. `pagehide` covers
    // close, reload and back/forward cache; `visibilitychange` covers a mobile
    // tab switch that never unloads, where the IndexedDB write does finish.
    const flush = () => {
      if (canPersist(current)) saveProjectUnloadCopy(current);
      write();
    };
    const onHidden = () => { if (document.hidden) flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  });
}
