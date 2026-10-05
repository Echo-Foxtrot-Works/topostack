import { webMcpTools, type WebMcpHost, type WebMcpTool } from "$lib/studio/webmcp-tools";

/**
 * Registers the studio's tools with the browser's WebMCP model context
 * (`document.modelContext`, formerly `navigator.modelContext`). Chrome ships
 * it behind a flag and an origin trial, and the API is still moving, so only
 * what both shapes share is used: `registerTool`, with removal through an
 * AbortSignal where supported and `unregisterTool` otherwise.
 * Specification: https://webmachinelearning.github.io/webmcp/
 */
export interface ModelContextLike {
  registerTool: (tool: Omit<WebMcpTool, "execute" | "title"> & { title?: string; execute: (input: Record<string, unknown>, client?: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }) => unknown;
  unregisterTool?: (name: string) => unknown;
}

/** Register every tool and return the function that removes them. */
export function connectWebMcp(context: ModelContextLike, host: WebMcpHost): () => void {
  const lifetime = new AbortController();
  const registered: string[] = [];
  for (const tool of webMcpTools(host)) {
    try {
      context.registerTool({ ...tool, execute: (input) => tool.execute(input && typeof input === "object" ? input : {}) }, { signal: lifetime.signal });
      registered.push(tool.name);
    } catch (error) {
      // A tool of the same name from an earlier registration is not fatal; the rest still register.
      console.warn(`TopoStack could not register the ${tool.name} agent tool.`, error);
    }
  }
  return () => {
    lifetime.abort();
    for (const name of registered) {
      try { context.unregisterTool?.(name); } catch { /* Already removed with the signal. */ }
    }
  };
}
