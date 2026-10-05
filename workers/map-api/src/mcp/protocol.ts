/**
 * The parts of the Model Context Protocol this server speaks: JSON-RPC 2.0 over
 * Streamable HTTP, stateless, answering each POST with one `application/json`
 * body. Version strings and error codes live here so a protocol revision is a
 * change to one file.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** MCP: the resource URI does not name a resource. */
  resourceNotFound: -32002,
} as const;

export type JsonRpcId = string | number;

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message); this.name = "RpcError"; }
}

/** The version to speak: the client's when this server supports it, otherwise the latest this server knows. */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

export function isSupportedVersion(version: string): boolean {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return !!value && typeof value === "object" && !Array.isArray(value) && (value as JsonRpcMessage).jsonrpc === "2.0";
}

export function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

export function rpcError(id: JsonRpcId | null, error: RpcError) {
  return { jsonrpc: "2.0" as const, id, error: { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) } };
}

/** An object's params, or an empty object when the method sent none. */
export function paramsRecord(params: unknown): Record<string, unknown> {
  if (params === undefined) return {};
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new RpcError(RPC_ERRORS.invalidParams, "Params must be an object.");
  return params as Record<string, unknown>;
}
