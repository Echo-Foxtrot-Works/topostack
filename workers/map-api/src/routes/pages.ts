import { discoveryLinks } from "./discovery";

/**
 * The public site's pages, which the Worker sees before the static-asset
 * handler (`assets.run_worker_first` in wrangler.jsonc lists the same paths)
 * so it can answer `Accept: text/markdown` with the page's Markdown twin. The
 * build writes one beside every page (scripts/build/write-markdown-pages.mjs).
 *
 * Both variants are read through `env.ASSETS`, which applies `_headers`, so
 * the pages keep their own Content Security Policy. They must not pass through
 * `withCors`, whose API policy would stop the pages from running.
 */
const SITE_PAGE = /^\/(?:|guides|examples|lakes|attribution|changelog|privacy)(?:\/.*)?$|^\/lake\/.+$/;

export function isSitePage(pathname: string): boolean {
  return SITE_PAGE.test(pathname);
}

/**
 * Whether the client asked for Markdown at least as strongly as HTML. Only an
 * explicit `text/markdown` counts: browsers send `text/html` and wildcards.
 */
export function prefersMarkdown(accept: string | null): boolean {
  let markdown = 0;
  let html = 0;
  for (const range of (accept ?? "").toLowerCase().split(",")) {
    const [type = "", ...parameters] = range.split(";").map((part) => part.trim());
    const q = parameters.find((parameter) => parameter.startsWith("q="));
    const weight = q ? Number(q.slice(2)) : 1;
    if (!Number.isFinite(weight)) continue;
    if (type === "text/markdown") markdown = Math.max(markdown, weight);
    else if (type === "text/html") html = Math.max(html, weight);
  }
  return markdown > 0 && markdown >= html;
}

/** `/` → `/index.md`, `/guides/agent-api` → `/guides/agent-api.md`; null for files. */
export function markdownPath(pathname: string): string | null {
  const page = pathname.replace(/\/+$/, "");
  if (!page) return "/index.md";
  return /\.[^/]*$/.test(page) ? null : `${page}.md`;
}

function withHeaders(response: Response, update: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  update(headers);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function sitePageResponse(request: Request, env: Pick<Env, "ASSETS">): Promise<Response> {
  const url = new URL(request.url);
  const twin = request.method === "GET" || request.method === "HEAD" ? markdownPath(url.pathname) : null;
  if (twin && prefersMarkdown(request.headers.get("accept"))) {
    const markdown = await env.ASSETS.fetch(new Request(new URL(twin, url), request));
    if (markdown.status === 200 || markdown.status === 304) {
      return withHeaders(markdown, (headers) => {
        headers.set("content-type", "text/markdown; charset=utf-8");
        headers.append("vary", "Accept");
        headers.set("link", discoveryLinks(twin));
      });
    }
    await markdown.body?.cancel();
  }
  const response = await env.ASSETS.fetch(request);
  if (!(response.headers.get("content-type") ?? "").startsWith("text/html")) return response;
  return withHeaders(response, (headers) => {
    headers.append("vary", "Accept");
    headers.set("link", discoveryLinks(response.status === 200 ? twin : null));
  });
}
