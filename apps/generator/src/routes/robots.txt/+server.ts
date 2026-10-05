import { SITE_ORIGIN } from "$lib/site/seo";
export const prerender = true;

// Content signals (https://contentsignals.org/) say how crawlers may use what
// they fetch: search indexing and answering questions in AI tools are welcome,
// training models is not. They state a preference; they block nothing.
const CONTENT_SIGNAL = "Content-Signal: search=yes, ai-input=yes, ai-train=no";
const SIGNAL_NOTE = "# Content-Signal: search=yes allows search indexing and links; ai-input=yes allows using pages to answer questions in AI tools; ai-train=no asks that pages not be used to train or fine-tune AI models.";

export function GET(): Response {
  const sitemap = import.meta.env.VITE_SITE_ENV === "production" ? "\nSitemap: " + SITE_ORIGIN + "/sitemap.xml\n" : "";
  return new Response("User-agent: *\nAllow: /\n" + CONTENT_SIGNAL + "\n" + sitemap + "\n" + SIGNAL_NOTE + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
