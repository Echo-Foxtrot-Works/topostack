import { error } from "@sveltejs/kit";
import { PUBLISHED_EXAMPLES } from "$lib/site/examples.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

// The Atomm package is the studio alone (see sveltekit.config.ts), so it prerenders none of these pages.
export const entries: EntryGenerator = () => import.meta.env.VITE_SITE_ENV === "atomm" ? [] : PUBLISHED_EXAMPLES.map((example) => ({ slug: example.slug }));

export const load: PageServerLoad = ({ params }) => {
  const example = PUBLISHED_EXAMPLES.find((entry) => entry.slug === params.slug);
  if (!example) error(404, "Not found");
  const others = PUBLISHED_EXAMPLES.filter((entry) => entry.slug !== example.slug).map(({ slug, place }) => ({ slug, place }));
  return { example, others };
};
