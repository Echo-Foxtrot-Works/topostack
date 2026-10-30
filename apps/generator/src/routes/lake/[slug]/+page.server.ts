import { error } from "@sveltejs/kit";
import { LAKE_PLACES, lakeLocator, lakePreview } from "$lib/site/lake-pages.server";
import { LAKE_PLACE_HOME } from "$lib/site/lake-places";
import type { EntryGenerator, PageServerLoad } from "./$types";

// Plain HTML like the lake lists: nothing to hydrate, and no inline bootstrap
// script, so these pages share the site CSP instead of needing _headers rules.
export const csr = false;

// The Atomm package is the studio alone (see sveltekit.config.ts), so it prerenders none of these pages.
export const entries: EntryGenerator = () => import.meta.env.VITE_SITE_ENV === "atomm" ? [] : [...LAKE_PLACES.keys()].map((path) => ({ slug: path.slice(LAKE_PLACE_HOME.length + 1) }));

export const load: PageServerLoad = ({ params }) => {
  const place = LAKE_PLACES.get(`${LAKE_PLACE_HOME}/${params.slug}`);
  if (!place) error(404, "Not found");
  return { lakePlace: place, locator: lakeLocator(place.id), preview: lakePreview(params.slug) };
};
