/**
 * Remove the public site's static files from an Atomm build.
 *
 * The Atomm package is the studio alone (apps/generator/sveltekit.config.ts prerenders only its
 * pages), but SvelteKit still copies every file in `static/`. The marketing and
 * guide images and the example project files (SITE_ONLY_PATHS) are only
 * reached from site pages, so they are dropped here. Everything the studio
 * fetches at runtime stays: `data/` (place search's lake directory), icons,
 * and licence texts.
 * Outside the Atomm build this does nothing.
 */
import { rm } from "node:fs/promises";
import { SITE_ONLY_PATHS } from "../lib/atomm-site-only.mjs";

if (process.env.VITE_SITE_ENV === "atomm") {
  const dist = new URL("../../apps/generator/dist/", import.meta.url);
  await Promise.all(SITE_ONLY_PATHS.map((path) => rm(new URL(path, dist), { recursive: true, force: true })));
}
