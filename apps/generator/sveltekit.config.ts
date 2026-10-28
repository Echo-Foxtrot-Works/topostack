import adapter from "@sveltejs/adapter-static";
import type { Config } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

// The Atomm package is the studio alone: its entry page, the studio route and
// the credits page the studio links to. Crawling would pull in the whole
// public site (guides, lake pages, examples), which the platform never shows.
const atommBuild = process.env.VITE_SITE_ENV === "atomm";

// SvelteKit 3 reads its options from the `sveltekit()` Vite plugin, not
// svelte.config.js. The app build and the client tests share them from here.
export const kitConfig: Config = {
  preprocess: vitePreprocess(),
  adapter: adapter({ pages: "dist", assets: "dist", strict: true }),
  alias: {
    // SvelteKit 3 dropped the built-in $lib in favour of #lib subpath imports.
    // Every generator module and the import lint rules still use $lib.
    $lib: "src/lib",
    // The airspace stage is its own entry, loaded only by projects that build airspace.
    "@topostack/core/airspace": fileURLToPath(new URL("../../packages/core/src/airspace.ts", import.meta.url)),
    "@topostack/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
  },
  paths: { relative: true },
  prerender: {
    // /v1/ is the map API, served by the Worker next to the static site (lake
    // depth previews link there). The static build cannot fetch it; any other
    // failed link still fails the build.
    handleHttpError: ({ path, message }) => {
      if (path.startsWith("/v1/")) return;
      throw new Error(message);
    },
    ...(atommBuild ? { crawl: false, entries: ["/", "/studio", "/attribution"], handleUnseenRoutes: "ignore" } : {}),
  },
};
