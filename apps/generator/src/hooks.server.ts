import { themeScript } from "@loidolt/theme-svelte";
import type { Handle } from "@sveltejs/kit/hooks";
import { THEME_OPTIONS } from "$lib/site/theme";
import { ATOMM_SDK_URL } from "$lib/atomm/sdk";

const initialThemeScript = themeScript(THEME_OPTIONS);

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replace("%loidolt.theme%", initialThemeScript).replace("%topostack.atomm%", import.meta.env.VITE_SITE_ENV === "atomm" ? `<script async src="${ATOMM_SDK_URL}"></script>` : ""),
  });
