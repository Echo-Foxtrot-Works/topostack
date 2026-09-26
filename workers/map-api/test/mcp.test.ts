import { afterEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { parseProject } from "@topostack/core/project";
import { decodeShareFragment } from "@topostack/data-contracts/share-link";
import worker from "../src/index";
import { elevationPng } from "./terrain-fixture";

const env = { ...workerEnv, PUBLIC_ORIGIN: "https://topostack.test", GEOCODER_API_KEY: "test-provider-key" } as unknown as Env;
const jobs: Promise<unknown>[] = [];
const context = { waitUntil: (job: Promise<unknown>) => { jobs.push(job); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
const ENDPOINT = "https://api.topostack.test/mcp";

/** The SDK's own client, talking to the Worker in process. */
async function connect(testEnv: Env = env) {
  const client = new Client({ name: "topostack-test", version: "1.0.0" }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: (input, init) => worker.fetch(new Request(input, init) as Request<unknown, IncomingRequestCfProperties>, testEnv, context),
  });
  await client.connect(transport);
  return client;
}

const rpc = (body: unknown, headers: Record<string, string> = {}) => worker.fetch(new Request(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
}), env, context);

function stubTerrain() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("terrarium")) return new Response(elevationPng((column, row) => 600 + column * 4 + row), { headers: { "content-type": "image/png" } });
    if (url.includes("geoapify")) return Response.json({ results: [{ place_id: "tahoe", formatted: `Lake Tahoe${String.fromCharCode(0x202e)}, United States`, lat: 39.0968, lon: -120.0324, result_type: "amenity" }] });
    return new Response("unexpected", { status: 500 });
  }));
}

afterEach(async () => {
  await Promise.all(jobs.splice(0));
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("MCP server through the SDK client", () => {
  it("initializes with tools, resources, prompts and instructions", async () => {
    const client = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: "topostack", title: "TopoStack" });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    expect(client.getInstructions()).toMatch(/plan_model/);
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual(["search_places", "check_coverage", "plan_model", "preview_model", "create_studio_link"]);
    expect(tools.find(({ name }) => name === "preview_model")?._meta).toMatchObject({ ui: { resourceUri: "ui://topostack/terrain-preview.html" } });
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.outputSchema?.type).toBe("object");
    }
    await client.close();
  });

  it("plans a model with structured content that matches its output schema", async () => {
    stubTerrain();
    const client = await connect();
    const result = await client.callTool({ name: "plan_model", arguments: { area: { center: { lat: 46.8523, lon: -121.7603 }, widthKm: 20 }, placeLabel: "Mount Rainier", materialThicknessMm: 3 } });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { plan: { sheetCount: number; estimate: boolean }; studioUrl: string; attribution: { text: string } };
    expect(structured.plan.estimate).toBe(true);
    expect(structured.plan.sheetCount).toBeGreaterThanOrEqual(2);
    expect(structured.studioUrl).toMatch(/^https:\/\/topostack\.test\/studio\?generate=1#p=1\./);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/Mount Rainier: layered, 300 × 200 mm, about \d+ sheets of 3 mm/);
    expect(text).toContain(structured.studioUrl);
    expect(text).toContain("OpenStreetMap");
    await client.close();
  });

  it("returns fixable request problems as a tool error the model can read", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "create_studio_link", arguments: { area: { center: { lat: 46.85, lon: 400 }, widthKm: 20 }, output: "3d" } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("area.center.lon");
    expect(text).toContain("output");
    await client.close();
  });

  it("creates a studio link that reopens the same design", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "create_studio_link", arguments: { area: { bounds: { west: -120.15, south: 38.9, east: -119.9, north: 39.27 } }, placeLabel: "Lake Tahoe", output: "flat", title: "Lake Tahoe" } });
    const { url, project } = result.structuredContent as { url: string; project: { name: string; output: string } };
    expect(project).toMatchObject({ name: "Lake Tahoe", output: "flat" });
    const opened = parseProject(decodeShareFragment(new URL(url).hash));
    expect(opened).toMatchObject({ name: "Lake Tahoe", outputMode: "engraving", plaque: { enabled: true, text: "Lake Tahoe" } });
    await client.close();
  });

  it("searches places, cleaning labels and suggesting an area", async () => {
    stubTerrain();
    const client = await connect();
    const result = await client.callTool({ name: "search_places", arguments: { query: "Lake Tahoe", limit: 1 } });
    const { places, attribution } = result.structuredContent as { places: Array<{ label: string; area: { widthKm: number }; surveyedLake: boolean }>; attribution: { text: string } };
    expect(places).toHaveLength(1);
    expect(places[0]!.label).toBe("Lake Tahoe, United States");
    expect(places[0]!.area.widthKm).toBeGreaterThan(0);
    expect(attribution.text).toContain("Geoapify");
    await client.close();
  });

  it("checks coverage for an area", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "check_coverage", arguments: { area: { bounds: { west: -78.96, south: 46.45, east: -78.92, north: 46.48 } } } });
    const coverage = result.structuredContent as { terrain: { highResolution: Array<{ id: string }> } };
    expect(coverage.terrain.highResolution.map(({ id }) => id)).toContain("nrcan-hrdem-alexander-v1");
    const unknown = await client.callTool({ name: "check_coverage", arguments: { area: { center: { lat: 1, lon: 1 }, widthKm: 5 }, zoom: 3 } });
    expect(unknown.isError).toBe(true);
    await client.close();
  });

  it("serves the guide, the data sources and the request schema", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources.map(({ uri }) => uri)).toEqual(["topostack://guide/making-a-model", "topostack://data/sources", "topostack://schema/project-request-v1", "ui://topostack/terrain-preview.html"]);
    const guide = await client.readResource({ uri: "topostack://guide/making-a-model" });
    expect((guide.contents[0] as { text: string }).text).toMatch(/## Layered or flat/);
    const schema = await client.readResource({ uri: "topostack://schema/project-request-v1" });
    expect(JSON.parse((schema.contents[0] as { text: string }).text)).toMatchObject({ required: ["requestVersion", "area"] });
    await expect(client.readResource({ uri: "topostack://nothing" })).rejects.toThrow(/not found/i);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
    await client.close();
  });

  it("serves the in-chat preview with the map API as its only connection", async () => {
    const page = `<meta name="topostack-api-origin" content="%TOPOSTACK_API_ORIGIN%"><script type="module">/* preview */</script>`;
    const assets = { fetch: vi.fn(async (request: Request) => new URL(request.url).pathname === "/mcp-app/terrain-preview.html" ? new Response(page) : new Response("missing", { status: 404 })) };
    const client = await connect({ ...env, ASSETS: assets } as unknown as Env);
    const { resources } = await client.listResources();
    const listed = resources.find(({ uri }) => uri.startsWith("ui://"));
    expect(listed).toMatchObject({ mimeType: "text/html;profile=mcp-app", _meta: { ui: { csp: { connectDomains: ["https://api.topostack.test"] } } } });
    const read = await client.readResource({ uri: "ui://topostack/terrain-preview.html" });
    const content = read.contents[0] as unknown as { text: string; mimeType: string; _meta: { ui: { csp: { connectDomains: string[] } } } };
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain('content="https://api.topostack.test"');
    expect(content._meta.ui.csp.connectDomains).toEqual(["https://api.topostack.test"]);
    await client.close();
    const unbuilt = await connect({ ...env, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } } as unknown as Env);
    await expect(unbuilt.readResource({ uri: "ui://topostack/terrain-preview.html" })).rejects.toThrow(/not built/);
    await unbuilt.close();
  });

  it("previews a model with the same plan as plan_model", async () => {
    stubTerrain();
    const client = await connect();
    const args = { area: { center: { lat: 46.8523, lon: -121.7603 }, widthKm: 20 }, placeLabel: "Mount Rainier" };
    const preview = await client.callTool({ name: "preview_model", arguments: args });
    const plan = await client.callTool({ name: "plan_model", arguments: args });
    expect(preview.structuredContent).toEqual(plan.structuredContent);
    await client.close();
  });

  it("fills prompts from the person's arguments", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map(({ name }) => name)).toEqual(["design_topo_map", "plan_for_my_laser"]);
    const prompt = await client.getPrompt({ name: "design_topo_map", arguments: { place: "Mount Hood", style: "flat" } });
    expect((prompt.messages[0]!.content as { text: string }).text).toMatch(/flat engraved topographic model of Mount Hood/);
    await expect(client.getPrompt({ name: "plan_for_my_laser", arguments: {} })).rejects.toThrow(/required/);
    await client.close();
  });
});

describe("MCP transport", () => {
  it("negotiates the protocol version", async () => {
    const initialize = (protocolVersion: string) => rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "raw", version: "1" } } });
    expect((await (await initialize("2025-06-18")).json<{ result: { protocolVersion: string } }>()).result.protocolVersion).toBe("2025-06-18");
    expect((await (await initialize("2031-01-01")).json<{ result: { protocolVersion: string } }>()).result.protocolVersion).toBe("2025-11-25");
    const unsupported = await rpc({ jsonrpc: "2.0", id: 2, method: "ping" }, { "mcp-protocol-version": "1999-01-01" });
    expect(unsupported.status).toBe(400);
  });

  it("accepts notifications without a reply and answers batches", async () => {
    const notification = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
    const batch = await rpc([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b", method: "nope" }]);
    const replies = await batch.json<Array<{ id: string; result?: object; error?: { code: number } }>>();
    expect(replies).toEqual([{ jsonrpc: "2.0", id: "a", result: {} }, { jsonrpc: "2.0", id: "b", error: { code: -32601, message: "Method not found: nope." } }]);
  });

  it("reports parse errors, invalid messages and unknown tools", async () => {
    const parse = await rpc("{oops");
    expect(parse.status).toBe(400);
    expect((await parse.json<{ error: { code: number } }>()).error.code).toBe(-32700);
    expect((await (await rpc({ id: 1, method: "ping" })).json<{ error: { code: number } }>()).error.code).toBe(-32600);
    expect((await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_everything" } })).json<{ error: { code: number } }>()).error.code).toBe(-32602);
  });

  it("offers no stream or session, and answers preflights from browser clients", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await worker.fetch(new Request(ENDPOINT, { method }), env, context);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST,OPTIONS");
    }
    const preflight = await worker.fetch(new Request(ENDPOINT, { method: "OPTIONS", headers: { origin: "https://inspector.example", "access-control-request-headers": "mcp-protocol-version" } }), env, context);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
  });

  it("charges the agent budget", async () => {
    const limited = { ...env, AGENT_LIMITER: { limit: vi.fn(async () => ({ success: false })) } } as unknown as Env;
    const response = await worker.fetch(new Request(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }), limited, context);
    expect(response.status).toBe(429);
  });

  it("keeps batches short", async () => {
    const response = await rpc(Array.from({ length: 9 }, (_, index) => ({ jsonrpc: "2.0", id: index, method: "ping" })));
    expect(response.status).toBe(400);
    expect((await response.json<{ error: { code: number; message: string } }>()).error).toEqual({ code: -32600, message: "A batch holds at most 8 messages." });
  });

  it("charges the agent budget for every tool call in a batch past the first", async () => {
    const limit = vi.fn(async () => ({ success: limit.mock.calls.length <= 2 }));
    const limited = { ...env, AGENT_LIMITER: { limit } } as unknown as Env;
    const call = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "create_studio_link", arguments: { area: { center: { lat: 46.85, lon: -121.76 }, widthKm: 20 } } } });
    const response = await worker.fetch(new Request(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([call(1), { jsonrpc: "2.0", id: "p", method: "ping" }, call(2), call(3)]) }), limited, context);
    const replies = await response.json<Array<{ id: number | string; result: { isError?: boolean; content?: Array<{ text: string }> } }>>();
    // One charge for the request, one for each tool call after the first.
    expect(limit).toHaveBeenCalledTimes(3);
    expect(replies.map(({ id, result }) => [id, result.isError ?? false])).toEqual([[1, false], ["p", false], [2, false], [3, true]]);
    expect(replies[3]?.result.content?.[0]?.text).toMatch(/agent budget for this client is used up/);
  });

  it("publishes a server card", async () => {
    const response = await worker.fetch(new Request("https://api.topostack.test/.well-known/mcp/server-card.json"), env, context);
    const card = await response.json<{ remotes: Array<{ type: string; url: string }>; tools: Array<{ name: string }>; authentication: { required: boolean } }>();
    expect(card.remotes).toEqual([{ type: "streamable-http", url: ENDPOINT }]);
    expect(card.authentication.required).toBe(false);
    expect(card.tools.map(({ name }) => name)).toContain("plan_model");
  });
});
