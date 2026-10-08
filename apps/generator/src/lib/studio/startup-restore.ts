import { DEFAULT_PROJECT, MAX_PROJECT_NAME_LENGTH, parseProject, type ProjectConfigV1 } from "@topostack/core";
import { UnreadableSavedProjectError } from "$lib/storage/storage";
import { starterById, type StarterId } from "$lib/site/starters";

/** Example slugs are lowercase words joined by hyphens; anything else never reaches the network. */
const EXAMPLE_SLUG = /^[a-z0-9-]+$/;
/** The Crater Lake example has no project file: it is the project a new browser starts with. */
const DEFAULT_EXAMPLE_SLUG = "crater-lake";

export interface StartupRestoreHost {
  loadProject: () => Promise<ProjectConfigV1 | undefined>;
  /** `window.location.search` at startup. */
  search: string;
  loadLakeLocation: () => Promise<typeof import("$lib/site/lake-location")>;
  /** Consumes the `lake` and `bounds` parameters so a refresh restores later edits instead. */
  consumeLakeLink: () => Promise<void>;
  /** `window.location.hash` at startup. */
  hash: string;
  loadShareLink: () => Promise<typeof import("$lib/studio/share-link")>;
  /** Clears the share fragment (and its `generate` flag) so a refresh restores later edits instead. */
  consumeShareLink: () => Promise<void>;
  /** The published `examples/<slug>.json` file, parsed; undefined when there is no such example. */
  loadExample: (slug: string) => Promise<unknown>;
  /** Consumes the `example` parameter so a refresh restores later edits instead. */
  consumeExampleLink: () => Promise<void>;
  consumeStarterLink: () => Promise<void>;
  onStarterOpened: (id: StarterId) => void;
  isCancelled: () => boolean;
  currentProject: () => ProjectConfigV1;
  /** Swap in the saved project as the new baseline (no undo into the default project). */
  restoreSaved: (saved: ProjectConfigV1) => void;
  /** Open a directory lake as an undoable change of `previous`. */
  openLinkedLake: (next: ProjectConfigV1, previous: ProjectConfigV1) => void;
  /** Start terrain generation for the project now open; it reports its own progress. */
  generate: () => void;
  /** Open a shared design as an undoable change of `previous`, so Undo returns to the saved project. */
  openSharedProject: (next: ProjectConfigV1, previous: ProjectConfigV1) => void;
  /** Open a published example as an undoable change of `previous`. */
  openExample: (next: ProjectConfigV1, previous: ProjectConfigV1) => void;
  setStatus: (message: string) => void;
}

export interface StartupRestoreResult {
  /** False only when autosave would overwrite an unreadable saved project that could not be backed up. */
  autosave: boolean;
}

/**
 * Restore the autosaved project, then apply a shared design (`#p=`), an
 * `?starter=`, `?example=` or `?lake=` link on top of it, in that order of
 * precedence. A saved project that cannot be read still lets the link open.
 * Starters wait for a review of size/material and an explicit Generate.
 * Examples and directory lakes are generated on arrival; a shared design waits
 * for Generate unless its link carries `?generate=1`, as the links assistants
 * make do.
 */
export async function restoreStartupProject(host: StartupRestoreHost): Promise<StartupRestoreResult> {
  let autosave = true;
  try {
    let saved: ProjectConfigV1 | undefined;
    try {
      saved = await host.loadProject();
    } catch (error) {
      if (!(error instanceof UnreadableSavedProjectError)) throw error;
      if (host.isCancelled()) return { autosave };
      console.error("TopoStack could not restore the saved project.", error);
      host.setStatus(`${error.message} · starting from the sample preview`);
      autosave = error.backupKey !== undefined;
    }
    if (host.isCancelled()) return { autosave };
    if (saved) {
      host.restoreSaved(saved);
      host.setStatus("Local project restored · generate to refresh terrain");
    }
    // Checked without the share module so ordinary visits never load it.
    if (/^#?p=/.test(host.hash)) {
      const { projectFromShareLink } = await host.loadShareLink();
      if (host.isCancelled()) return { autosave };
      let shared: ProjectConfigV1 | undefined;
      try { shared = projectFromShareLink(host.hash); }
      catch (error) { host.setStatus(`${error instanceof Error ? error.message : "Share link could not be opened."} · your saved project is unchanged`); }
      await host.consumeShareLink();
      if (host.isCancelled() || !shared) return { autosave };
      host.openSharedProject(shared, host.currentProject());
      if (new URLSearchParams(host.search).get("generate") === "1") {
        host.setStatus("Shared design opened · generating its terrain · Undo returns to your previous project");
        host.generate();
      } else {
        host.setStatus("Shared design opened · generate terrain to preview it · Undo returns to your previous project");
      }
      return { autosave };
    }
    const starter = new URLSearchParams(host.search).get("starter");
    if (starter !== null) {
      const { starterProject } = await import("$lib/studio/starter-project");
      if (host.isCancelled()) return { autosave };
      const next = starterProject(starter);
      await host.consumeStarterLink();
      if (host.isCancelled()) return { autosave };
      if (!next) { host.setStatus("Starter not found · your project is unchanged"); return { autosave }; }
      host.openExample(next, host.currentProject());
      host.onStarterOpened(starterById(starter)!.id);
      host.setStatus("Starter opened · review the size and material, then generate terrain · Undo returns to your previous project");
      return { autosave };
    }
    const example = new URLSearchParams(host.search).get("example");
    if (example !== null) {
      await openExampleLink(host, example);
      return { autosave };
    }
    if (!new URLSearchParams(host.search).has("lake")) return { autosave };
    const current = host.currentProject();
    const linkedLake = (await host.loadLakeLocation()).lakeLocationFromSearch(host.search, current.widthMm, current.heightMm);
    if (host.isCancelled() || !linkedLake) return { autosave };
    await host.consumeLakeLink();
    if (host.isCancelled()) return { autosave };
    const previous = host.currentProject();
    const next: ProjectConfigV1 = { ...previous, name: linkedLake.label.slice(0, MAX_PROJECT_NAME_LENGTH), location: linkedLake, outputMode: "stack", showWaterDepth: true };
    host.openLinkedLake(next, previous);
    host.setStatus("Lake selected from the depth directory · loading survey data");
    // A directory link promises that lake's terrain, so build it on arrival.
    host.generate();
  } catch (error) {
    if (host.isCancelled()) return { autosave };
    console.error("TopoStack could not restore the saved project.", error);
    host.setStatus("Saved project could not be restored · starting from the sample preview");
  }
  return { autosave };
}

/**
 * Open a published example from its committed project file, the same file the
 * example page offers as a download. A link that names no example leaves the
 * current project alone.
 */
async function openExampleLink(host: StartupRestoreHost, slug: string): Promise<void> {
  let example: ProjectConfigV1 | undefined;
  let failure = "Example not found · your project is unchanged";
  if (slug === DEFAULT_EXAMPLE_SLUG) example = DEFAULT_PROJECT;
  else if (EXAMPLE_SLUG.test(slug) && slug.length <= 80) {
    try {
      const file = await host.loadExample(slug);
      if (file !== undefined) example = parseProject(file && typeof file === "object" && "project" in file ? file.project : file);
    } catch (error) {
      if (host.isCancelled()) return;
      console.error("TopoStack could not open the example.", error);
      failure = "Example could not be opened · your project is unchanged";
    }
  }
  if (host.isCancelled()) return;
  await host.consumeExampleLink();
  if (host.isCancelled()) return;
  if (!example) { host.setStatus(failure); return; }
  host.openExample(example, host.currentProject());
  host.setStatus("Example opened · loading its terrain · Undo returns to your previous project");
  // Like a directory lake, the link promises the pictured terrain, so build it on arrival.
  host.generate();
}
