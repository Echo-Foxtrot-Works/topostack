import { describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import worker from "../src/index";
import { markdownPath, prefersMarkdown } from "../src/routes/pages";

const PAGE_CSP = "default-src 'self'; script-src 'self' 'sha256-page'";
const context = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** A stand-in for the static-asset handler: the built files, each with the headers `_headers` would give it. */
function assets(files: Record<string, { body: string; type: string }>) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input);
    const file = files[new URL(request.url).pathname];
    if (!file) return new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP } });
    return new Response(request.method === "HEAD" ? null : file.body, { headers: { "content-type": file.type, "content-security-policy": PAGE_CSP, etag: `"${file.body.length}"` } });
  });
  return { fetch } as unknown as Fetcher & { fetch: typeof fetch };
}

const SITE = assets({
  "/": { body: "<!doctype html><title>TopoStack</title>", type: "text/html; charset=utf-8" },
  "/index.md": { body: "---\ntitle: \"TopoStack\"\n---\n\n# Turn real terrain into maps\n", type: "text/markdown" },
  "/guides/mcp-server": { body: "<!doctype html><title>MCP</title>", type: "text/html; charset=utf-8" },
  "/guides/mcp-server.md": { body: "---\ntitle: \"MCP\"\n---\n", type: "text/markdown" },
  "/lake/no-twin": { body: "<!doctype html><title>Lake</title>", type: "text/html; charset=utf-8" },
  "/examples/crater-lake.json": { body: "{}", type: "application/json" },
});
const env = { ...workerEnv, PUBLIC_ORIGIN: "https://topostack.test", ASSETS: SITE } as unknown as Env;
const get = (path: string, headers: Record<string, string> = {}, method = "GET") => worker.fetch(new Request(`https://api.topostack.test${path}`, { method, headers }), env, context);

describe("content negotiation", () => {
  it("prefers Markdown only when it is asked for at least as strongly as HTML", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.9, */*;q=0.8")).toBe(true);
    expect(prefersMarkdown("text/html, text/markdown")).toBe(true);
    expect(prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
    expect(prefersMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
    expect(prefersMarkdown("text/markdown;q=0")).toBe(false);
    expect(prefersMarkdown("*/*")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });

  it("maps a page to its Markdown twin", () => {
    expect(markdownPath("/")).toBe("/index.md");
    expect(markdownPath("/guides/agent-api")).toBe("/guides/agent-api.md");
    expect(markdownPath("/guides/")).toBe("/guides.md");
    expect(markdownPath("/examples/crater-lake.json")).toBeNull();
  });

  it("serves the Markdown twin of the home page to agents, keeping the page's own headers", async () => {
    const response = await get("/", { accept: "text/markdown" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("vary")).toMatch(/Accept/);
    expect(response.headers.get("content-security-policy")).toBe(PAGE_CSP);
    expect(response.headers.get("link")).toContain('</index.md>; rel="alternate"; type="text/markdown"');
    expect(await response.text()).toMatch(/^---\ntitle: "TopoStack"/);
  });

  it("serves browsers the HTML untouched apart from Vary and discovery links", async () => {
    const response = await get("/guides/mcp-server", { accept: "text/html,*/*;q=0.8" });
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    // The page's policy, not the API's `default-src 'none'`, or the page would not run.
    expect(response.headers.get("content-security-policy")).toBe(PAGE_CSP);
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("vary")).toMatch(/Accept/);
    const link = response.headers.get("link") ?? "";
    expect(link).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    expect(link).toContain('rel="service-desc"');
    expect(link).toContain('</guides/mcp-server.md>; rel="alternate"');
    expect(await response.text()).toContain("<title>MCP</title>");
  });

  it("answers HEAD for the Markdown twin without a body", async () => {
    const response = await get("/", { accept: "text/markdown" }, "HEAD");
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("falls back to the HTML when a page has no twin", async () => {
    const response = await get("/lake/no-twin", { accept: "text/markdown" });
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(response.headers.get("link")).toContain('rel="alternate"');
  });

  it("passes files and missing pages through", async () => {
    const file = await get("/examples/crater-lake.json", { accept: "text/markdown" });
    expect(file.headers.get("content-type")).toBe("application/json");
    expect(file.headers.get("link")).toBeNull();
    const missing = await get("/guides/missing", { accept: "text/markdown" });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("link")).not.toContain('rel="alternate"');
  });

  it("leaves API routes to the API", async () => {
    const response = await get("/v1/missing", { accept: "text/markdown" });
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
  });
});

describe("discovery documents", () => {
  it("publishes an RFC 9727 API catalog for the HTTP API and the MCP server", async () => {
    const response = await get("/.well-known/api-catalog");
    expect(response.headers.get("content-type")).toMatch(/^application\/linkset\+json/);
    const { linkset } = await response.json<{ linkset: Array<Record<string, unknown> & { anchor: string }> }>();
    expect(linkset.map(({ anchor }) => anchor)).toEqual(["https://api.topostack.test/v1/projects", "https://api.topostack.test/mcp"]);
    for (const entry of linkset) expect(Object.keys(entry)).toEqual(expect.arrayContaining(["service-desc", "service-doc", "status"]));
    expect(linkset[0]?.["service-doc"]).toEqual([{ href: "https://topostack.test/guides/agent-api", type: "text/html" }]);
  });

  it("indexes the agent skill with the digest of the file it serves", async () => {
    const index = await (await get("/.well-known/agent-skills/index.json")).json<{ $schema: string; skills: Array<{ name: string; type: string; url: string; digest: string }> }>();
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    const [skill] = index.skills;
    expect(skill).toMatchObject({ name: "plan-topostack-model", type: "skill-md" });
    const file = await get(skill!.url);
    expect(file.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const text = await file.text();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    expect(skill!.digest).toBe(`sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
    // Front matter the skill format requires, with the colon-bearing description quoted.
    expect(text).toMatch(/^---\nname: plan-topostack-model\ndescription: "[^"\n]+"\n---\n/);
    expect(text).toContain("https://api.topostack.test/mcp");
    expect(text).toContain("# Making a TopoStack model");
  });

  it("publishes one ARD and AI Catalog manifest anchored to the site's domain", async () => {
    for (const path of ["/.well-known/ard.json", "/.well-known/ai-catalog.json"]) {
      const manifest = await (await get(path)).json<{ specVersion: string; entries: Array<{ identifier: string; type: string; url: string; representativeQueries: string[] }> }>();
      expect(manifest.specVersion).toBe("1.0");
      expect(manifest.entries.map(({ type }) => type)).toEqual(["application/mcp-server-card+json", "application/vnd.oai.openapi+json;version=3.1", "application/agent-skills+md"]);
      for (const entry of manifest.entries) {
        expect(entry.identifier).toMatch(/^urn:air:topostack\.test:[a-z]+:[a-z-]+$/);
        expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
