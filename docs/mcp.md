# MCP server, in-chat preview and WebMCP

AI assistants reach TopoStack in three ways. Each one ends at a studio link that generates the model in a browser.

- **A remote MCP server** at `/mcp` on the map-api Worker. Chat clients such as Claude, ChatGPT, VS Code and Cursor connect to it. Scripts use the same operations over REST at `/v1/projects/*`.
- **An MCP App**, `ui://topostack/terrain-preview.html`. It is an interactive preview that the chat host frames beside a `preview_model` result. It runs the real geometry engine inside the chat's iframe.
- **WebMCP tools in the studio**, for agents that drive a browser tab. They edit the design that is open in the studio.

All three read one contract: `ProjectRequestV1` in `packages/core/src/project/`. The server never generates geometry, stores designs, or makes files. It validates requests, estimates the stack from a coarse terrain sample, and mints links. [The plan](plans/agent-api.md) records why it is built this way and what phase 2 adds: server-side files, OAuth, and API keys. The public contract, for people who connect, is published as guides on the site:

- [MCP server reference](../apps/generator/src/routes/guides/mcp-server/+page.svelte) (`/guides/mcp-server`)
- [Project request and HTTP API reference](../apps/generator/src/routes/guides/agent-api/+page.svelte) (`/guides/agent-api`)
- [Use a browser agent in the studio](../apps/generator/src/routes/guides/browser-agents/+page.svelte) (`/guides/browser-agents`)
- [Use TopoStack with AI assistants](../apps/generator/src/routes/guides/use-with-ai-assistants/+page.svelte) (`/guides/use-with-ai-assistants`), which covers connecting clients

This page is for people who change the code.

## Where the code lives

| Path | Holds |
| --- | --- |
| `packages/core/src/project/` | The request contract: `parseProjectRequest`, `expandProjectRequest`, `requestPatch`, `describeProject` (`request.ts`); the JSON Schemas built from the same limits (`schema.ts`); `planFromRelief` (`plan.ts`); and the crop helpers (`bounds.ts`). The Worker imports only the `@topostack/core/project` subpath. |
| `packages/data-contracts/src/share-link.ts` | The `#p=1.` share-link codec and the 8,000-character limit |
| `workers/map-api/src/agent/` | Operations that REST and MCP share. `projects.ts` covers resolve, plan, link and body reading. `relief.ts` samples at most four Terrarium tiles. The other files are `coverage.ts`, `links.ts`, `attribution.ts`, `schemas.ts` (the response JSON Schemas) and `openapi.ts` (the OpenAPI 3.1 document). |
| `workers/map-api/src/mcp/server.ts` | Transport, method dispatch, server `INSTRUCTIONS` and the server card |
| `workers/map-api/src/mcp/protocol.ts` | Supported protocol versions, JSON-RPC error codes and message helpers |
| `workers/map-api/src/mcp/tools.ts` | The five tools, their input and output schemas, and their text summaries |
| `workers/map-api/src/mcp/resources.ts`, `prompts.ts` | The text resources and the two prompts |
| `workers/map-api/src/mcp/app-resource.ts` | The `ui://` preview resource: tool `_meta`, CSP metadata, and the read from `ASSETS` |
| `apps/generator/src/mcp-app/` | The preview page. `main.ts` runs the page, `host.ts` is the postMessage bridge, `preview.ts` decodes the tool result and trims the config, and `render.ts` draws the SVG. It is built by `apps/generator/vite.mcp-app.config.ts`. |
| `apps/generator/src/lib/studio/webmcp-tools.ts` | The seven WebMCP tools, written against the `WebMcpHost` interface |
| `apps/generator/src/lib/studio/webmcp.ts` | Detecting `document.modelContext`, and registering and unregistering tools |
| `apps/generator/src/lib/studio/App.svelte` | `webMcpHost()`, `applyAgentPatch`, and the lazy import of `webmcp.ts` |
| `apps/generator/src/lib/studio/startup-restore.ts` | Opening `?generate=1#p=…` links as an undoable change and generating them on arrival |
| `apps/generator/src/routes/llms.txt/+server.ts` | `llms.txt`, whose agent section names the MCP endpoint and tools |
| `apps/generator/src/routes/guides/{use-with-ai-assistants,browser-agents,mcp-server,agent-api}/` | The public guides, listed in the "AI agents and API" section of `lib/site/docs.ts` |

## The MCP server

### Routing

`route()` in `workers/map-api/src/index.ts` handles `/mcp` in this order:

1. **`OPTIONS`** answers `204` with CORS headers for every path, before any budget is charged.
2. **The agent budget.** `withinAgentBudget` charges `AGENT_LIMITER` under the key `<client>:agent`, then `AGENT_GLOBAL_LIMITER`. A refusal answers `429` with `retry-after: 60`. That header is in `access-control-expose-headers`, so browser clients can read it.
3. **`mcpResponse`** (`src/mcp/server.ts`) handles the request.

The method check happens inside `mcpResponse`, so a stray `GET` still spends one agent token before it gets `405`.

`/.well-known/mcp/server-card.json` has its own `mcp-card` bucket on `REQUEST_LIMITER` and is cached for an hour. `wrangler.jsonc` lists both paths in `assets.run_worker_first`, so the static-asset handler never answers them.

### Transport

The server speaks stateless Streamable HTTP. It has no runtime dependencies. `@modelcontextprotocol/sdk` is a dev dependency, used only by the tests.

- **POST only.** Other methods answer `405` with `allow: POST,OPTIONS` and a message explaining that the server has no session and no event stream. The server never issues an `Mcp-Session-Id`, and never answers with `text/event-stream`.
- **Protocol versions.** The supported versions are `SUPPORTED_PROTOCOL_VERSIONS` in `protocol.ts`, newest first. `initialize` echoes the client's version when it is supported and otherwise answers with the newest. An `MCP-Protocol-Version` header is checked only when present: an unsupported value answers HTTP `400` with JSON-RPC `-32600`.
- **Bodies.** `readJsonBody` (shared with REST) wants `content-type: application/json`, or it answers `415`. It caps the body at 128,000 bytes, or it answers `413`. Both of these are plain `{ "error": … }` bodies, not JSON-RPC. Invalid JSON answers `400` with JSON-RPC `-32700`. The `Accept` header is not checked.
- **Batches.** An array of messages is answered with an array of replies. An empty batch, or one holding more than `MAX_BATCH_MESSAGES` (8), answers `400` with `-32600`. The entries run concurrently. The request's own agent token pays for the first `tools/call`. Each further `tools/call` charges `withinAgentBudget` again, through `AgentContext.admitAgentCall`. A refused call is a tool result with `isError: true` ("The agent budget for this client is used up"), so one POST cannot run more tool calls than the budget allows.
- **Notifications.** A notification, or a batch that holds only notifications and client responses, answers `202` with no body.
- **Methods.** The server handles `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list` (always empty), `resources/read`, `prompts/list` and `prompts/get`. Anything else is `-32601`.
- **Errors.**
  - An unknown tool or prompt, or params that are not an object, is a JSON-RPC `-32602`.
  - A request the model can fix is a tool **result** with `isError: true` and one `path: message` line per problem. This covers a bad argument, a 422 from the contract, a busy geocoder, a spent terrain budget, and a link that is too long. `callTool` in `tools.ts` makes this split, because models read tool results and usually cannot see protocol errors.
  - An unexpected exception is logged as `mcp_failed` and answers `-32603 "Internal error."`.
- **CORS.** Responses to `/mcp` allow any origin and the MCP headers (`mcp-protocol-version`, `mcp-session-id`, `last-event-id`); see `corsHeaders` in `src/http.ts`. `/mcp` does not check `Origin`: the tools only read, take no credentials, and are metered per address.
- **Origins.** `siteOrigin` is `PUBLIC_ORIGIN`, falling back to the request's origin. Links, attribution and `websiteUrl` are built from it. `apiOrigin` is always the request's origin, and the preview connects to it. `PUBLIC_ORIGIN` is `https://topostack.app` in production and `https://dev.topostack.app` in development. `npm run dev` sets it to the local generator.

### Tools, resources and prompts

Every tool is read-only and idempotent. `readOnly()` in `tools.ts` builds the annotations, and `openWorldHint` is `true` only for `search_places`, the one tool that calls a third party. A result carries three things:

- `structuredContent` that matches the tool's `outputSchema`;
- a text summary in `content`, for clients that show only text;
- an `attribution` object built by `agent/attribution.ts` from the sources the result actually used.

| Tool | Runs |
| --- | --- |
| `search_places` | `geocodeResponse` in process, so the geocoder cache and `GEOCODE_LIMITER` apply. It suggests a `widthKm` from the result type (`WIDTH_BY_TYPE`) and flags points inside a lake-survey box (`surveyedLakeAt`). Query and limit bounds are the route's constants (`GEOCODE_QUERY_MAX_CHARS`, `GEOCODE_MAX_RESULTS`). The REST route truncates and clamps out-of-range values, while the tool rejects them so the model can correct its call. |
| `check_coverage` | `areaGround` then `coverageResult`, the same code as the `lat`/`lon`/`widthKm` form of `GET /v1/coverage` |
| `plan_model` | `resolveProjectRequest` then `planProject`, the same code as `POST /v1/projects/plan` |
| `preview_model` | The same as `plan_model`, plus `_meta.ui.resourceUri`, which opens the MCP App |
| `create_studio_link` | `linkFor`, the same code as `POST /v1/projects/link` |

The tool schemas reuse `PROJECT_REQUEST_SCHEMA` and make `requestVersion` optional; `toolRequest` fills in `1`. REST still requires `requestVersion`. The output schemas (plan, coverage, project summary, attribution) live in `agent/schemas.ts`, which the OpenAPI document also reads, so a tool result and the matching REST response are described once.

### How a plan is estimated

`estimateRelief` (`agent/relief.ts`) picks the finest zoom from 12 down whose tiles cover the crop in at most four, and reads them through the Worker's own terrain route and caches. Only samples inside the crop count, and only inside the inscribed ellipse for a circle. A sample that would widen the range is dropped as a tile artifact when it differs from the median of the ring two pixels out by more than the larger of 400 m and a 2.5:1 slope over those two pixels; Lake Tahoe's zoom-10 tile holds such patches. When the crop has samples at or below 0 m as well as land, it is coastal: the minimum becomes 0 and the stack is sized from the land. A crop narrower than one sample uses the sample nearest its centre. `planFromRelief` (core) turns the range into the plan.

`planNotes` (`agent/projects.ts`) adds plain sentences, in this order: always, the sampled zoom and that the studio's count is authoritative; relief under 20 m (worded for flat or layered output); a layered stack over 60 sheets; a coastal crop; surveyed lakes in a layered crop with water depth on; a model larger than the laser bed.

Resources: `topostack://guide/making-a-model` (Markdown advice on materials and sizes), `topostack://data/sources` (the dataset manifest), `topostack://schema/project-request-v1`, and the preview. An unknown URI is `-32002`. Prompts: `design_topo_map` and `plan_for_my_laser`. Their arguments are cleaned with `cleanRequestText` and capped at 160 characters before they are placed in the message.

`serverCard()` builds the server card from the same `TOOLS`, `RESOURCES` and `PROMPTS` arrays, so it cannot drift from the server. The card format follows a draft proposal and may need adjusting.

### Untrusted text

Geocoder labels and anything a client sends are data. `cleanRequestText` (core) strips control and bidirectional characters, removes zero-width marks, and caps lengths. Labels travel only as structured fields or quoted list items. The `search_places` description tells the model to treat them as names, never as instructions.

## The in-chat preview (MCP App)

- **Build.** The generator's `build` and `build:e2e` scripts run `vite build --config vite.mcp-app.config.ts` after the site build. The output is one self-contained file, `apps/generator/dist/mcp-app/terrain-preview.html`, with its script inlined. `check-web-budget.mjs` gives it its own gzip budget (`mcpAppHtmlGzip`) and fails if the site's HTML ever references `mcp-app/`. The Atomm package prunes it (`scripts/lib/atomm-site-only.mjs`), and `static/_headers` serves `/mcp-app/*` as `no-cache` and `noindex`.
- **Serving.** `readPreview` fetches the file through the Worker's `ASSETS` binding. It replaces `%TOPOSTACK_API_ORIGIN%` with the origin that served the request, and returns the result as `text/html;profile=mcp-app`. The `_meta.ui.csp.connectDomains` is exactly that origin, `resourceDomains` is empty, and `prefersBorder` is `true`. If no generator build is present, reading the resource answers `-32603` and names the fix.
- **Bridge** (`host.ts`). This is JSON-RPC over `postMessage` for MCP Apps protocol `2026-01-26`. It is written by hand because the reference SDK brings a UI framework with it. It reads messages only when `event.source` is the parent window.

  | Direction | Messages |
  | --- | --- |
  | Sent | `ui/initialize`, then `ui/notifications/initialized`; `ui/open-link`; `ui/notifications/size-changed` |
  | Received | `ui/notifications/tool-result`, `ui/notifications/host-context-changed` (theme), and `ui/notifications/tool-cancelled`. The requests `ping` and `ui/resource-teardown` are acknowledged; any other request gets `-32601`. |

- **Rendering.**
  - `previewInput` decodes the design from the result's `studioUrl` fragment.
  - `previewConfig` strips roads, trails, labels, markers, the title, guides, placed graphics and the laser bed split. They do not change the stack, and they cost most of the generation time.
  - `main.ts` loads terrain through `lib/domain/data-provider.ts`, pointed at the API origin by `configureApiBase`, then runs `generateGeometry`.
  - `render.ts` draws an isometric stack, or contour lines for flat output. It sets untrusted text with `textContent`, and the SVG holds only numbers and fixed markup.
  - If terrain falls back to synthetic data, the preview shows an error instead of a fake model.
- **Open in TopoStack.** A sandboxed frame cannot navigate the chat, so the button asks the host with `ui/open-link`. If the host refuses, the link is shown so it can be copied.

## WebMCP in the studio

- **When it loads.** `App.svelte` imports `lib/studio/webmcp.ts` lazily, and only when all of these hold:
  - the page is not framed;
  - the build is not the Atomm build;
  - `document.modelContext` (or the older `navigator.modelContext`) has a `registerTool` function.

  `check-web-budget.mjs` fails if the module reaches the studio's startup path. In Chrome the API sits behind a flag or an origin trial.
- **Registration.** `connectWebMcp` registers each tool with an `AbortSignal`. If one tool fails to register, it logs a warning and registers the rest. On teardown it aborts the signal and calls `unregisterTool` where that exists.
- **Tools.** Every name carries the `topostack_` prefix, so it cannot collide with another bridge's tools.

  | Tool | Effect |
  | --- | --- |
  | `topostack_get_design` | Reads the design, generation state, status and export readiness. It reports a sheet count only when the geometry matches the current settings. |
  | `topostack_search_places` | Runs the studio's own place search |
  | `topostack_set_area` | Moves the design, as choosing a search result does |
  | `topostack_update_design` | Applies a `PROJECT_REQUEST_PATCH_SCHEMA` patch without `area` or `markers`, as one undo step |
  | `topostack_generate_preview` | Generates, as the Generate button does |
  | `topostack_undo` | Undoes the last change |
  | `topostack_open_export` | Opens the Export dialog. It never downloads; the person does. |

- **Edits.** Every edit goes through the studio's own `updateProject`, `updateMapDetails` and `updateFabrication` (`applyAgentPatch`), so history, view mode and fingerprints behave as they do for a click.
- **Cloudflare's edge WebMCP toggle stays off.** The reasons are in [the plan](plans/agent-api.md#where-webmcp-fits).

## Studio links

`studioLink` (`agent/links.ts`) encodes the expanded `ProjectConfigV1` with the share-link codec, as `<PUBLIC_ORIGIN>/studio?generate=1#p=1.<design>`. The project id is a hash of the request, so the same request always gives the same link. A link longer than 8,000 characters is refused with a 413 or an `isError` result. On arrival, `startup-restore.ts` opens the design as an undoable change and generates it at once. It then removes `?generate=1` and the fragment, so a refresh does not generate again.

## Rate limits and operations

Limits are counted per Cloudflare location (`wrangler.jsonc`). A chat platform calls from its own servers, so one address stands for many people. That is why agent routes have their own budget, separate from the browser's.

| Limiter | Limit | Charged by |
| --- | --- | --- |
| `AGENT_LIMITER` | 120 a minute per client | Every `/mcp` POST, each `tools/call` after the first in a batch, and every `/v1/projects/*` POST |
| `AGENT_GLOBAL_LIMITER` | 1,200 a minute, shared | The same, after the per-client check passes |
| `GEOCODE_LIMITER` / `GEOCODE_GLOBAL_LIMITER` | 30 / 300 a minute | `search_places`, on geocoder cache misses only |
| `REQUEST_LIMITER` `terrain` bucket + `TERRAIN_GLOBAL_LIMITER` | 240 / 2,400 a minute | Plan tile reads that miss the terrain caches |

- **Client key.** `clientKey` in `src/http.ts` derives it from `cf-connecting-ip`. IPv6 addresses are grouped by `/64`.
- **Log lines.** Watch for `agent_global_budget_exceeded` (the shared ceiling was hit), `mcp_failed` (an unexpected exception inside a method), and the existing `geocode_global_budget_exceeded` and `terrain_global_budget_exceeded`.
- **Messages to the caller.** A refused plan tile becomes "The terrain budget for this client is used up". A refused extra tool call in a batch becomes "The agent budget for this client is used up". A geocoder refusal becomes "Place search is busy". All three reach the model as tool errors it can read.

## Running it locally

1. Start the Worker and the site with `npm run dev`. The Worker listens on `http://localhost:8787` by default. Its dev script passes `--local-upstream` and sets `PUBLIC_ORIGIN` to the local generator, so links and the preview's CSP name your machine.
2. For `search_places`, set `GEOCODER_API_KEY` in `workers/map-api/.dev.vars` ([development.md](development.md#frontend-and-local-map-api)). Without it, the tool returns "Place search is unavailable right now". Passing coordinates still works.
3. For the preview resource, build the generator once (`npm run build -w @topostack/generator`). The Worker's `ASSETS` binding serves `apps/generator/dist`, and `resources/read` on the `ui://` URI fails until `dist/mcp-app/terrain-preview.html` exists.
4. Try the server by hand with the MCP Inspector: run `npx @modelcontextprotocol/inspector`, choose the **Streamable HTTP** transport, and connect to `http://localhost:8787/mcp`. Or use curl:

   ```sh
   curl -s http://localhost:8787/mcp -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"plan_model","arguments":{"area":{"center":{"lat":46.8523,"lon":-121.7603},"widthKm":20},"placeLabel":"Mount Rainier"}}}'
   ```

   Stateless means no `initialize` is needed first.
5. To see the preview inside a real chat client, the client must reach your Worker over public HTTPS. Use the development deployment (`https://dev.topostack.app/mcp`) or a tunnel to port 8787. Claude and ChatGPT call connectors from their own servers, not from your machine.
6. To try WebMCP, use a Chrome build with the WebMCP flag or origin trial enabled, open `/studio`, and drive it with a browser agent. Without Chrome, `e2e/agent-studio.spec.ts` shows how to stand in a fake `document.modelContext` with `addInitScript`.

## Adding a tool, resource or prompt

1. Put the logic in `workers/map-api/src/agent/` when REST could use it too, so both surfaces mean the same thing. The Worker may import only `@topostack/core/project` from core. ESLint and `npm run budget:worker` (`scripts/build/check-worker-bundle.mjs`) reject geometry or export code.
2. Add the definition to `TOOLS` in `tools.ts`, `RESOURCES` in `resources.ts`, or `PROMPTS` in `prompts.ts`. A tool needs:
   - an `inputSchema` and an `outputSchema`;
   - `annotations` from `readOnly()`. A tool that changes anything needs a design review first, because every current tool is read-only by contract.
   - a text summary that ends with the attribution.
3. Throw `AgentError` for problems the model can fix. Throw `RpcError` only for protocol misuse.
4. The server card and `tools/list` pick up the new definition by themselves. Update these by hand:
   - the tool-order assertion in `workers/map-api/test/mcp.test.ts`;
   - the tool list in `apps/generator/src/routes/llms.txt/+server.ts`;
   - the MCP section of `workers/map-api/README.md`;
   - the `/guides/mcp-server` or `/guides/agent-api` guide, and `/guides/browser-agents` for a WebMCP tool;
   - `/guides/use-with-ai-assistants`, if people will notice the change. A guide edit also bumps its `updated` date in `lib/site/seo.ts`.
5. A new REST route also needs an entry in `AGENT_ROUTES` and `openApiDocument` (`agent/openapi.ts`). A test checks that the two agree. List every status the route can return in its `responses`, and describe response bodies in `agent/schemas.ts` so the MCP tools and OpenAPI share them.
6. A WebMCP tool goes in `webMcpTools` (`webmcp-tools.ts`). If it needs a new studio action, extend `WebMcpHost` and `webMcpHost()` in `App.svelte`. Keep downloads and other irreversible actions out. Update the tool count in `e2e/agent-studio.spec.ts`.
7. `ProjectRequestV1` is versioned. A field that changes what an existing request means needs `requestVersion: 2` and a migration, never a silent reinterpretation.
8. Add a `changelog/unreleased/` fragment if makers will notice ([changelog.md](changelog.md)).

## Tests

| File | Covers | Run with |
| --- | --- | --- |
| `workers/map-api/test/mcp.test.ts` | The official SDK client against `worker.fetch`: tool listing, schemas and annotations; every tool's structured and text output; `isError` handling; resources, including the preview's CSP and placeholder; prompts; version negotiation, batches, notifications, error codes, `405`, preflight, `429`, and the server card | `npm test -w @topostack/map-api` |
| `workers/map-api/test/agent-routes.test.ts` | The REST routes, their errors and budgets, and OpenAPI agreement: the documented paths, real plan, coverage and error bodies validated against the document's schemas, and every status the route tests provoke being listed | same |
| `packages/core/src/project/*.test.ts` | Request parsing, expansion, schemas and planning | `npm test -w @topostack/core` |
| `apps/generator/src/lib/studio/webmcp*.test.ts` | Tool definitions and registration lifecycle | `npm run test -w @topostack/generator` |
| `apps/generator/src/mcp-app/*.test.ts` | The bridge handshake and origin filtering, result decoding, and SVG rendering | same |
| `e2e/mcp-app.spec.ts` | The built preview framed by a stand-in chat host: handshake, tool result, generation from the fixture, theme, open-link, size reports | `npm run test:e2e` |
| `e2e/agent-studio.spec.ts` | `?generate=1` links, and the WebMCP tools against a stand-in model context (Chromium) | same |

`npm run budget:worker` and `npm run budget:web` guard the Worker bundle, the preview's size, and the rule that WebMCP stays off the studio's startup path.

## Known gaps

Behaviour that is deliberate for now or waiting on a follow-up; clients should not depend on it.

- **Text length.** `parseProjectRequest` truncates text up to four times its limit and rejects only longer strings, while the schema's `maxLength` rejects anything over the limit.
- **Schema `$id`.** `https://topostack.app/schemas/project-request-v1.json` is an identifier; nothing is served there.
- **Batches.** `/mcp` accepts JSON-RPC batches of up to 8 messages for every protocol version, although MCP removed them in 2025-06-18.
- **Headers.** `/mcp` does not check `Accept`, and accepts requests without `MCP-Protocol-Version`.
- **Error shape.** A 413 or 415 from `readJsonBody` on `/mcp` uses the REST `{ error }` shape, not JSON-RPC.
- **Coverage errors.** `/v1/coverage` error paths name request fields (`area.center.lat`), not the query parameters.
- **Usage.** Agent calls are logged per request (`request_completed`) but record no usage events.
