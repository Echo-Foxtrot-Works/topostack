import { describe, expect, it, vi } from "vitest";
import { connectWebMcp, type ModelContextLike } from "$lib/studio/webmcp";
import type { WebMcpHost } from "$lib/studio/webmcp-tools";

const host = { project: vi.fn(), geometry: vi.fn(), editBlockedBy: () => undefined } as unknown as WebMcpHost;

describe("WebMCP registration", () => {
  it("registers every tool with a lifetime signal and removes them on disconnect", () => {
    const signals: AbortSignal[] = [];
    const context: ModelContextLike = { registerTool: vi.fn((_tool, options) => { signals.push(options!.signal!); }), unregisterTool: vi.fn() };
    const disconnect = connectWebMcp(context, host);
    expect(context.registerTool).toHaveBeenCalledTimes(7);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    disconnect();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(context.unregisterTool).toHaveBeenCalledTimes(7);
  });

  it("keeps registering when one tool is refused", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let calls = 0;
    const context: ModelContextLike = { registerTool: vi.fn(() => { calls += 1; if (calls === 1) throw new Error("Duplicate tool name"); }) };
    const disconnect = connectWebMcp(context, host);
    expect(context.registerTool).toHaveBeenCalledTimes(7);
    expect(warn).toHaveBeenCalledOnce();
    expect(() => disconnect()).not.toThrow();
    warn.mockRestore();
  });

  it("hands the tool a plain object even when the agent sends none", async () => {
    let execute: ((input: Record<string, unknown>) => Promise<unknown>) | undefined;
    const context: ModelContextLike = { registerTool: vi.fn((tool) => { if (tool.name === "topostack_update_design") execute = tool.execute; }) };
    connectWebMcp(context, { ...host, project: () => ({}) } as unknown as WebMcpHost);
    await expect(execute!(undefined as unknown as Record<string, unknown>)).resolves.toMatchObject({ content: [{ text: "Nothing to change." }] });
  });
});
