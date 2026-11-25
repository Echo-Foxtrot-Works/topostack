// The setup guide a first visit to the studio opens: four steps in the
// sidebar, in the order a new maker decides them. Its progress is one
// localStorage value, so a reload resumes the step and a finished or skipped
// guide never returns on its own.

export const START_GUIDE_KEY = "topostack-studio-guide-v1";

export const GUIDE_STEPS = ["type", "place", "look", "make"] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number];

const DONE = "done";

type GuideStore = Pick<Storage, "getItem" | "setItem">;

/**
 * The step the guide opens on at startup, or undefined to leave the studio as
 * it is. A guide left part-way resumes. Otherwise it opens only for a browser
 * with nothing to restore: a saved project means the maker has been here
 * before, and a link (a shared design, an example, a starter, a lake) already
 * says what to open.
 */
export function guideStepAtStartup(storage: GuideStore, startup: { restoredProject: boolean; openedLink: boolean }): GuideStep | undefined {
  if (startup.openedLink) return undefined;
  let saved: string | null;
  try { saved = storage.getItem(START_GUIDE_KEY); } catch { return undefined; }
  if (saved === DONE) return undefined;
  const resumed = GUIDE_STEPS.find((step) => step === saved);
  if (resumed) return resumed;
  return startup.restoredProject ? undefined : GUIDE_STEPS[0];
}

/** Remember the step the guide is on, so a reload returns to it. */
export function rememberGuideStep(storage: GuideStore, step: GuideStep): void {
  try { storage.setItem(START_GUIDE_KEY, step); } catch { /* The guide is optional. */ }
}

/** Finished or skipped: the guide opens again only from the studio menu. */
export function rememberGuideDone(storage: GuideStore): void {
  try { storage.setItem(START_GUIDE_KEY, DONE); } catch { /* The guide is optional. */ }
}
