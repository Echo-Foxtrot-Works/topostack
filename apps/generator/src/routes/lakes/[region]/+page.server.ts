import { error } from "@sveltejs/kit";
import { LAKE_PAGES } from "$lib/site/lake-pages.server";
import { LAKES_HOME } from "$lib/site/lake-pages";
import type { EntryGenerator, PageServerLoad } from "./$types";

// Plain HTML: these pages have nothing to hydrate, and with no inline
// bootstrap script they share the site CSP instead of needing _headers rules.
export const csr = false;

// The Atomm package is the studio alone (see sveltekit.config.ts), so it prerenders none of these pages.
export const entries: EntryGenerator = () => import.meta.env.VITE_SITE_ENV === "atomm" ? [] : [...LAKE_PAGES.keys()].map((path) => path.split("/")).filter((parts) => parts.length === 3).map(([, , region]) => ({ region: region! }));

export const load: PageServerLoad = ({ params }) => {
  const page = LAKE_PAGES.get(`${LAKES_HOME}/${params.region}`);
  if (!page) error(404, "Not found");
  return { lakePage: page };
};
