import packageJson from "../../package.json";
import { AgentError, agentErrorResponse, publicOrigin, readJsonBody, type AgentContext } from "../agent/projects";
import { json } from "../http";
import { PREVIEW_URI } from "./app-resource";
import { getPrompt, promptListing, PROMPTS } from "./prompts";
import { isJsonRpcMessage, isSupportedVersion, negotiateVersion, paramsRecord, RPC_ERRORS, rpcError, RpcError, rpcResult, SUPPORTED_PROTOCOL_VERSIONS, type JsonRpcMessage } from "./protocol";
import { readResource, resourceListings, RESOURCES } from "./resources";
import { callTool, toolListing, TOOLS } from "./tools";

/**
 * TopoStack's remote MCP server: stateless Streamable HTTP at `/mcp`. Each POST
 * carries one JSON-RPC message (or a batch) and is answered with one
 * `application/json` body; there is no session and no server-initiated stream,
 * so GET and DELETE are 405. Nothing here needs credentials: the tools only
 * read, and the agent budget limits every call.
 */
export const MCP_PATH = "/mcp";

export const INSTRUCTIONS = [
  "TopoStack plans laser-cut terrain models: layered stacks of sheets or flat engravings.",
  "Workflow: search_places (unless you have coordinates) → plan_model to check sheets, height and scale → adjust and re-plan if impractical → preview_model to show the user the model → create_studio_link, and give the user that link.",
  "Opening the link generates the model in the user's browser, where they review it and export SVG files. Nothing is generated or stored on the server.",
  "Sheet counts are estimates; the studio's count is authoritative. Output is decorative, not survey-grade.",
  "Every result includes attribution; keep it with anything you show.",
  "Read topostack://guide/making-a-model for material and sizing advice.",
].join(" ");

/** Batch entries run concurrently, so a batch is kept short. */
export const MAX_BATCH_MESSAGES = 8;

const AGENT_BUDGET_SPENT = { content: [{ type: "text", text: "The agent budget for this client is used up. Try again in a minute." }], isError: true };

interface ServerContext extends AgentContext {
  siteOrigin: string;
  apiOrigin: string;
  /** Whether a tool call may run: the request paid for its first one, and each further call in a batch charges the agent budget. */
  admitToolCall: () => Promise<boolean>;
}

async function dispatch(message: JsonRpcMessage & { method: string }, context: ServerContext): Promise<unknown> {
  const params = paramsRecord(message.params);
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } },
        serverInfo: {
          name: "topostack",
          title: "TopoStack",
          version: packageJson.version,
          websiteUrl: context.siteOrigin,
          icons: [{ src: new URL("/favicon.svg", context.siteOrigin).toString(), mimeType: "image/svg+xml", sizes: ["any"] }],
        },
        instructions: INSTRUCTIONS,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(toolListing) };
    case "tools/call": {
      if (typeof params.name !== "string") throw new RpcError(RPC_ERRORS.invalidParams, "tools/call needs a tool name.");
      if (!(await context.admitToolCall())) return AGENT_BUDGET_SPENT;
      return callTool(params.name, paramsRecord(params.arguments), context);
    }
    case "resources/list":
      return { resources: resourceListings(context) };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read": {
      if (typeof params.uri !== "string") throw new RpcError(RPC_ERRORS.invalidParams, "resources/read needs a uri.");
      return readResource(params.uri, { siteOrigin: context.siteOrigin, apiOrigin: context.apiOrigin, datasetVersion: context.env.DATASET_VERSION, assets: context.env.ASSETS });
    }
    case "prompts/list":
      return { prompts: PROMPTS.map(promptListing) };
    case "prompts/get": {
      if (typeof params.name !== "string") throw new RpcError(RPC_ERRORS.invalidParams, "prompts/get needs a prompt name.");
      return getPrompt(params.name, params.arguments);
    }
    default:
      throw new RpcError(RPC_ERRORS.methodNotFound, `Method not found: ${message.method}.`);
  }
}

/** One message's reply, or undefined for notifications and client responses, which get none. */
async function answer(message: unknown, context: ServerContext) {
  if (!isJsonRpcMessage(message)) return rpcError(null, new RpcError(RPC_ERRORS.invalidRequest, "Not a JSON-RPC 2.0 message."));
  if (typeof message.method !== "string") return undefined;
  const id = message.id;
  if (id === undefined || id === null) return undefined;
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, new RpcError(RPC_ERRORS.invalidRequest, "The id must be a string or a number."));
  try {
    return rpcResult(id, await dispatch(message as JsonRpcMessage & { method: string }, context));
  } catch (error) {
    if (error instanceof RpcError) return rpcError(id, error);
    if (error instanceof AgentError) return rpcError(id, new RpcError(RPC_ERRORS.internal, error.message));
    console.error(JSON.stringify({ message: "mcp_failed", method: message.method, error: error instanceof Error ? error.message : String(error) }));
    return rpcError(id, new RpcError(RPC_ERRORS.internal, "Internal error."));
  }
}

export async function mcpResponse(context: AgentContext): Promise<Response> {
  const { request } = context;
  if (request.method !== "POST") {
    return json({ error: "This MCP server is stateless: send JSON-RPC messages with POST. It offers no event stream and no session to end." }, { status: 405, headers: { allow: "POST,OPTIONS" } });
  }
  const version = request.headers.get("mcp-protocol-version");
  if (version && !isSupportedVersion(version)) {
    return json(rpcError(null, new RpcError(RPC_ERRORS.invalidRequest, `Unsupported MCP-Protocol-Version ${version}; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`)), { status: 400 });
  }
  let body: unknown;
  try { body = await readJsonBody(request); }
  catch (error) {
    if (error instanceof AgentError && error.status === 400) return json(rpcError(null, new RpcError(RPC_ERRORS.parse, "Parse error.")), { status: 400 });
    if (error instanceof AgentError) return agentErrorResponse(error);
    throw error;
  }
  let toolCalls = 0;
  const serverContext: ServerContext = {
    ...context,
    siteOrigin: publicOrigin(context),
    apiOrigin: new URL(request.url).origin,
    admitToolCall: async () => toolCalls++ === 0 || context.admitAgentCall(),
  };
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, new RpcError(RPC_ERRORS.invalidRequest, "Empty batch.")), { status: 400 });
    if (body.length > MAX_BATCH_MESSAGES) return json(rpcError(null, new RpcError(RPC_ERRORS.invalidRequest, `A batch holds at most ${MAX_BATCH_MESSAGES} messages.`)), { status: 400 });
    const replies = (await Promise.all(body.map((message) => answer(message, serverContext)))).filter((reply) => reply !== undefined);
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }
  const reply = await answer(body, serverContext);
  return reply === undefined ? new Response(null, { status: 202 }) : json(reply);
}

/**
 * A description of this server for directories and clients that look for one
 * before connecting. The format follows the MCP server-card proposal, which is
 * still a draft; expect to adjust it.
 */
export function serverCard(context: Pick<AgentContext, "env" | "request">) {
  const siteOrigin = publicOrigin(context);
  return {
    name: "app.topostack/topostack",
    title: "TopoStack",
    description: "Plan laser-cut and engraved topographic models of any place, and hand them to the TopoStack studio.",
    version: packageJson.version,
    websiteUrl: siteOrigin,
    remotes: [{ type: "streamable-http", url: new URL(MCP_PATH, new URL(context.request.url).origin).toString() }],
    authentication: { required: false },
    protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities: { tools: {}, resources: {}, prompts: {} },
    tools: TOOLS.map(({ name, title, description }) => ({ name, title, description })),
    resources: [...RESOURCES.map(({ uri, title }) => ({ uri, title })), { uri: PREVIEW_URI, title: "TopoStack model preview" }],
    prompts: PROMPTS.map(({ name, title }) => ({ name, title })),
  };
}
