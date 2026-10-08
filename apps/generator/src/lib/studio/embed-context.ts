import { getContext, setContext } from "svelte";
import type { AutomaticNesting } from "$lib/atomm/automatic-nesting";

// String keys: component tests mount pieces of the studio with
// `context: new Map([["atomm-embedded", () => true]])`.
const EMBEDDED_KEY = "atomm-embedded";
const AUTOMATIC_NESTING_KEY = "atomm-nesting";

/** App.svelte: whether the studio runs inside the Atomm platform, read live. */
export function provideEmbedded(isEmbedded: () => boolean): void {
  setContext(EMBEDDED_KEY, isEmbedded);
}

/** Whether the studio runs inside the Atomm platform; false outside App.svelte. */
export function getEmbedded(): () => boolean {
  return getContext<(() => boolean) | undefined>(EMBEDDED_KEY) ?? (() => false);
}

/** App.svelte: the Atomm embed's automatic sheet nesting. */
export function provideAutomaticNesting(nesting: AutomaticNesting): void {
  setContext(AUTOMATIC_NESTING_KEY, nesting);
}

export function getAutomaticNesting(): AutomaticNesting | undefined {
  return getContext<AutomaticNesting | undefined>(AUTOMATIC_NESTING_KEY);
}
