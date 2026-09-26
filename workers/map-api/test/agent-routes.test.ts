import { afterEach, describe, expect, it, vi } from "vitest";
import { Validator } from "@cfworker/json-schema";
import { env as workerEnv } from "cloudflare:workers";
import { DEFAULT_PROJECT, parseProject } from "@topostack/core/project";
import { decodeShareFragment } from "@topostack/data-contracts/share-link";
import worker from "../src/index";
import { AGENT_ROUTES, openApiDocument } from "../src/agent/openapi";
import { elevationPng } from "./terrain-fixture";

const env = { ...workerEnv, PUBLIC_ORIGIN: "https://topostack.test" } as unknown as Env;
const jobs: Promise<unknown>[] = [];
const context = { waitUntil: (job: Promise<unknown>) => { jobs.push(job); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
const deny = () => ({ limit: vi.fn(async (_options: RateLimitOptions) => ({ success: false })) });

const rainier = { requestVersion: 1, area: { center: { lat: 46.8523, lon: -121.7603 }, widthKm: 20 }, placeLabel: "Mount Rainier, Washington" };

function post(path: string, body: unknown, init: { contentType?: string; raw?: string } = {}) {
  return new Request(`https://api.topostack.test${path}`, {
    method: "POST",
    headers: { "content-type": init.contentType ?? "application/json", "cf-connecting-ip": "203.0.113.9" },
    body: init.raw ?? JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(jobs.splice(0));
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("POST /v1/projects/resolve", () => {
  it("expands a request and links to the studio, which generates on open", async () => {
    const response = await worker.fetch(post("/v1/projects/resolve", rainier), env, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json<{ project: { id: string; name: string; outputMode: string }; studioUrl: string; attribution: { text: string } }>();
    expect(body.project).toMatchObject({ name: "Mount Rainier", outputMode: "stack" });
    const link = new URL(body.studioUrl);
    expect(`${link.origin}${link.pathname}${link.search}`).toBe("https://topostack.test/studio?generate=1");
    const { explodedPreview: _preview, ...design } = parseProject(decodeShareFragment(link.hash));
    const { explodedPreview: _bodyPreview, ...expected } = body.project as unknown as typeof DEFAULT_PROJECT;
    expect(design).toEqual(expected);
    expect(body.attribution.text).toContain("OpenStreetMap");
  });

  it("names every invalid field", async () => {
    const response = await worker.fetch(post("/v1/projects/resolve", { requestVersion: 1, area: { center: { lat: 46, lon: 500 }, widthKm: 5 }, output: "3d" }), env, context);
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json<{ errors: Array<{ path: string }> }>();
    expect(body.errors.map(({ path }) => path).sort()).toEqual(["area.center.lon", "output"]);
  });

  it("refuses bodies that are not JSON, not labelled JSON, or too large", async () => {
    expect((await worker.fetch(post("/v1/projects/resolve", rainier, { contentType: "text/plain" }), env, context)).status).toBe(415);
    expect((await worker.fetch(post("/v1/projects/resolve", undefined, { raw: "{not json" }), env, context)).status).toBe(400);
    expect((await worker.fetch(post("/v1/projects/resolve", undefined, { raw: `{"pad":"${"x".repeat(130_000)}"}` }), env, context)).status).toBe(413);
  });

  it("accepts only POST and answers preflights for any origin", async () => {
    const get = await worker.fetch(new Request("https://api.topostack.test/v1/projects/resolve"), env, context);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST,OPTIONS");
    const preflight = await worker.fetch(new Request("https://api.topostack.test/v1/projects/plan", { method: "OPTIONS", headers: { origin: "https://claude.ai", "access-control-request-method": "POST" } }), env, context);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST,OPTIONS");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("uses the agent budget, separate from the browser's", async () => {
    const limited = { ...env, AGENT_LIMITER: deny() } as unknown as Env;
    const response = await worker.fetch(post("/v1/projects/resolve", rainier), limited, context);
    expect(response.status).toBe(429);
    const global = deny();
    const busy = { ...env, AGENT_GLOBAL_LIMITER: global } as unknown as Env;
    expect((await worker.fetch(post("/v1/projects/link", rainier), busy, context)).status).toBe(429);
    expect(global.limit).toHaveBeenCalledWith({ key: "agent-global" });
  });
});

describe("POST /v1/projects/plan", () => {
  it("estimates the stack from sampled terrain and says it is an estimate", async () => {
    const upstream = vi.fn(async () => new Response(elevationPng((column, row) => 1000 + column * 6 + row * 2), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(post("/v1/projects/plan", { ...rainier, materialThicknessMm: 3 }), env, context);
    expect(response.status).toBe(200);
    const body = await response.json<{ plan: { sheetCount: number; estimate: boolean; reliefM: number; output: string }; relief: { tiles: number }; notes: string[]; studioUrl: string; coverage: object }>();
    expect(body.plan).toMatchObject({ estimate: true, output: "layered" });
    expect(body.plan.reliefM).toBeGreaterThan(0);
    expect(body.plan.sheetCount).toBeGreaterThanOrEqual(2);
    expect(body.relief.tiles).toBeLessThanOrEqual(4);
    expect(upstream).toHaveBeenCalledTimes(body.relief.tiles);
    expect(body.notes[0]).toMatch(/studio's count/);
    expect(body.studioUrl).toMatch(/^https:\/\/topostack\.test\/studio\?generate=1#p=1\./);
  });

  it("reports nearly flat ground and plans flat output as one sheet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(elevationPng(() => 12), { headers: { "content-type": "image/png" } })));
    const response = await worker.fetch(post("/v1/projects/plan", { ...rainier, area: { center: { lat: 41.9, lon: -93.6 }, widthKm: 5 }, output: "flat" }), env, context);
    const body = await response.json<{ plan: { sheetCount: number; output: string }; notes: string[] }>();
    expect(body.plan).toMatchObject({ sheetCount: 1, output: "flat" });
    expect(body.notes.join(" ")).toMatch(/nearly flat/);
  });

  it("passes on a terrain outage and an exhausted terrain budget", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const outage = await worker.fetch(post("/v1/projects/plan", { ...rainier, area: { center: { lat: -33.9, lon: 18.4 }, widthKm: 7 } }), env, context);
    expect(outage.status).toBe(502);
    const noBudget = { ...env, TERRAIN_GLOBAL_LIMITER: deny() } as unknown as Env;
    const refused = await worker.fetch(post("/v1/projects/plan", { ...rainier, area: { center: { lat: -34.9, lon: 138.6 }, widthKm: 7 } }), noBudget, context);
    expect(refused.status).toBe(429);
  });
});

describe("POST /v1/projects/link", () => {
  it("links a request or a saved project", async () => {
    const fromRequest = await (await worker.fetch(post("/v1/projects/link", rainier), env, context)).json<{ url: string; length: number }>();
    expect(fromRequest.length).toBe(fromRequest.url.length);
    const fromProject = await (await worker.fetch(post("/v1/projects/link", { project: DEFAULT_PROJECT }), env, context)).json<{ url: string }>();
    expect(parseProject(decodeShareFragment(new URL(fromProject.url).hash)).name).toBe(DEFAULT_PROJECT.name);
  });

  it("refuses an invalid project and one too large for a link", async () => {
    expect((await worker.fetch(post("/v1/projects/link", { project: { ...DEFAULT_PROJECT, widthMm: -1 } }), env, context)).status).toBe(422);
    const points = Array.from({ length: 2000 }, (_, index) => ({ lat: 40 + Math.sin(index * 7.1) * 0.3, lon: -105 + Math.cos(index * 3.7) * 0.3 }));
    const huge = { ...DEFAULT_PROJECT, customLines: [{ id: "big", kind: "trail", points }] };
    const response = await worker.fetch(post("/v1/projects/link", { project: huge }), env, context);
    expect(response.status).toBe(413);
    expect((await response.json<{ error: string }>()).error).toMatch(/project file/);
  });
});

describe("GET /v1/coverage", () => {
  it("lists the high-resolution terrain that covers an area", async () => {
    const response = await worker.fetch(new Request("https://api.topostack.test/v1/coverage?bbox=-78.96,46.45,-78.92,46.48"), env, context);
    expect(response.status).toBe(200);
    const body = await response.json<{ terrain: { highResolution: Array<{ id: string }> }; attribution: { sources: Array<{ name: string }> } }>();
    expect(body.terrain.highResolution.map(({ id }) => id)).toContain("nrcan-hrdem-alexander-v1");
    expect(body.attribution.sources.length).toBeGreaterThan(4);
  });

  it("accepts a center and width, and refuses anything else", async () => {
    expect((await worker.fetch(new Request("https://api.topostack.test/v1/coverage?lat=46.85&lon=-121.76&widthKm=10"), env, context)).status).toBe(200);
    for (const query of ["", "bbox=1,2,3", "bbox=10,0,5,1", "lat=91&lon=0&widthKm=1"]) {
      expect((await worker.fetch(new Request(`https://api.topostack.test/v1/coverage?${query}`), env, context)).status).toBe(400);
    }
  });
});

describe("GET /v1/openapi.json", () => {
  it("documents exactly the agent routes, each of which answers", async () => {
    const response = await worker.fetch(new Request("https://api.topostack.test/v1/openapi.json"), env, context);
    const document = await response.json<{ openapi: string; servers: Array<{ url: string }>; paths: Record<string, Record<string, unknown>>; components: { schemas: { ProjectRequestV1: { required: string[] } } } }>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers[0]!.url).toBe("https://api.topostack.test");
    expect(Object.keys(document.paths).sort()).toEqual([...AGENT_ROUTES].sort());
    expect(document.components.schemas.ProjectRequestV1.required).toEqual(["requestVersion", "area"]);
    for (const [path, operations] of Object.entries(document.paths)) {
      const method = Object.keys(operations)[0]!.toUpperCase();
      const answer = await worker.fetch(new Request(`https://api.topostack.test${path}`, { method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) }), env, context);
      expect(answer.status, path).not.toBe(404);
      await answer.body?.cancel();
    }
  });

  const document = openApiDocument("https://api.topostack.test", "https://topostack.test", "0.0.0");
  /** Validates a body against a component, resolving `#/components/...` refs inside the document. */
  const conforms = (component: string, body: unknown) => new Validator({ ...document, $ref: `#/components/schemas/${component}` } as never, "2020-12", false).validate(body);

  it("describes the bodies the routes return", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(elevationPng((column, row) => 1000 + column * 6 + row * 2), { headers: { "content-type": "image/png" } })));
    const plan = await (await worker.fetch(post("/v1/projects/plan", rainier), env, context)).json();
    expect(conforms("ProjectPlan", plan).errors).toEqual([]);
    expect(conforms("ProjectPlan", { plan: {} }).valid).toBe(false);
    const coverage = await (await worker.fetch(new Request("https://api.topostack.test/v1/coverage?bbox=-78.96,46.45,-78.92,46.48"), env, context)).json();
    expect(conforms("CoverageResult", coverage).errors).toEqual([]);
    const invalid = await (await worker.fetch(post("/v1/projects/resolve", { requestVersion: 1 }), env, context)).json();
    expect(conforms("Error", invalid).errors).toEqual([]);
  });

  it("lists the 429 every route answers once its budget is spent", async () => {
    const limited = { ...env, REQUEST_LIMITER: deny(), AGENT_LIMITER: deny() } as unknown as Env;
    for (const [path, operations] of Object.entries(document.paths)) {
      const [method, operation] = Object.entries(operations as Record<string, { responses: Record<string, unknown> }>)[0]!;
      const post = method === "post";
      const query = path === "/v1/geocode" ? "?q=Lake%20Tahoe" : path === "/v1/coverage" ? "?bbox=-78.96,46.45,-78.92,46.48" : "";
      const answer = await worker.fetch(new Request(`https://api.topostack.test${path}${query}`, { method: method.toUpperCase(), ...(post ? { headers: { "content-type": "application/json" }, body: JSON.stringify(rainier) } : {}) }), limited, context);
      expect(answer.status, path).toBe(429);
      await answer.body?.cancel();
      expect(Object.keys(operation.responses), path).toContain("429");
    }
  });

  it("lists every status the routes are tested to return", () => {
    const statuses = (path: string) => Object.keys(Object.values(document.paths[path as keyof typeof document.paths])[0]!.responses);
    for (const path of ["/v1/projects/resolve", "/v1/projects/plan", "/v1/projects/link"]) expect(statuses(path), path).toEqual(expect.arrayContaining(["200", "400", "413", "415", "422", "429"]));
    expect(statuses("/v1/projects/plan")).toContain("502");
    expect(statuses("/v1/coverage")).toEqual(expect.arrayContaining(["200", "400", "429"]));
    expect(statuses("/v1/geocode")).toEqual(expect.arrayContaining(["200", "400", "429", "502", "503", "504"]));
  });
});
