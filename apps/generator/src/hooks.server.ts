import { themeScript } from "@loidolt/theme-svelte";
import type { Handle } from "@sveltejs/kit/hooks";
import { THEME_OPTIONS } from "$lib/site/theme";

const initialThemeScript = themeScript(THEME_OPTIONS);

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replace("%loidolt.theme%", initialThemeScript).replace("%topostack.atomm%", import.meta.env.VITE_SITE_ENV === "atomm" ? '<script async src="https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js"></script>' : ""),
  });
