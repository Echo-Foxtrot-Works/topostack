import { MediaQuery } from "svelte/reactivity";

/** Where the workspace stacks the preview above the sidebar; keep in step with styles/responsive.css. */
const STACKED_WORKSPACE = "(max-width: 1000px), (max-width: 1100px) and (orientation: portrait)";

/**
 * The orientation for a sidebar rail: a column beside its panels, or a row of
 * tabs above them where the workspace stacks, so arrow keys follow the layout.
 * Without matchMedia (a test DOM) the rail stays vertical.
 */
export function railOrientation(): { readonly current: "horizontal" | "vertical" } {
  const stacked = typeof matchMedia === "function" ? new MediaQuery(STACKED_WORKSPACE, false) : undefined;
  return { get current() { return stacked?.current ? "horizontal" : "vertical"; } };
}

/** The phone layout, where the settings become a bottom sheet (portrait phones at least 600px tall; shorter screens scroll instead); keep in step with styles/responsive.css. */
const PHONE_LAYOUT = "(max-width: 760px) and (min-height: 600px)";

/** Whether the studio is in its phone layout. Without matchMedia (a test DOM) it is not. */
export function phoneLayout(): { readonly current: boolean } {
  const phone = typeof matchMedia === "function" ? new MediaQuery(PHONE_LAYOUT, false) : undefined;
  return { get current() { return phone?.current ?? false; } };
}
