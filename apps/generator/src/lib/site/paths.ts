import { resolve } from "$app/paths";

/**
 * The prefix for site paths, as `base` from `$app/paths` was before SvelteKit 3:
 * "" in the browser, and "." or ".." while prerendering, because the site uses
 * relative paths so the Atomm package works from any folder. The relative form
 * depends on the page being rendered, so call this while rendering, not at module load.
 */
export function basePath(): string {
  return resolve("/").replace(/\/$/, "");
}
