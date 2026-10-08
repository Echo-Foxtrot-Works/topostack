import { describe, it, expect, vi, afterEach } from "vitest";
import { env, exports } from "cloudflare:workers";
import worker from "../src/index";
import { collectUsage } from "../src/usage-events";

const event = { event: "export_prepared", landing: "/examples/crater-lake", source: "github", device: "large", output: "stack", delivery: "browser" };
const request = (body: unknown = event, headers: Record<string, string> = {}) => new Request("http://localhost:5273/v1/events", { method: "POST", headers: { origin: "http://localhost:5273", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

afterEach(() => vi.restoreAllMocks());
describe("usage collection", () => {
  it("accepts a valid event through the complete Worker route", async () => {
    const response = await exports.default.fetch(request());
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5273");
  });
  it("logs only the bounded, fixed schema and returns no-store", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await collectUsage(request(), "development");
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ message: "usage_event", environment: "development", ...event });
  });
  it("logs campaign and medium when the page sends them", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const attributed = { ...event, campaign: "launch", medium: "forum", channel: "lightburn-forum" };
    expect((await collectUsage(request(attributed), "production")).status).toBe(204);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ message: "usage_event", environment: "production", ...attributed });
  });
  it.each([
    { ...event, name: "Private project" },
    { ...event, source: "private search query" },
    { ...event, landing: "/studio?coordinates=private" },
    { ...event, output: "unknown" },
    { ...event, event: "arbitrary" },
    { ...event, campaign: "launch" },
    { ...event, campaign: "private campaign", medium: "forum" },
    { ...event, channel: "private-person" },
    null, [], {},
  ])("rejects unrecognized or private fields: %j", async (payload) => {
    const log = vi.spyOn(console, "log");
    expect((await collectUsage(request(payload), "production")).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });
  it("requires same-origin JSON and bounds bodies even without Content-Length", async () => {
    expect((await collectUsage(request(event, { origin: "https://www.atomm.com" }), "production")).status).toBe(403);
    expect((await collectUsage(request(event, { "content-type": "text/plain" }), "production")).status).toBe(415);
    expect((await collectUsage(request(event, { "content-length": "2000" }), "production")).status).toBe(413);
    expect((await collectUsage(request("x".repeat(2000)), "production")).status).toBe(413);
    const malformed = new Request("http://localhost:5273/v1/events", { method: "POST", headers: { origin: "http://localhost:5273", "content-type": "application/json" }, body: "{" });
    expect((await collectUsage(malformed, "production")).status).toBe(400);
  });
  it("rate limits the new endpoint and leaves other API methods restricted", async () => {
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    const limit = vi.fn(async () => ({ success: false }));
    const response = await worker.fetch(request(), { ...env, REQUEST_LIMITER: { limit } }, ctx);
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "anonymous:events" });
    const get = await worker.fetch(new Request("http://localhost:5273/v1/events"), env, ctx);
    expect(get.status).toBe(405);
    const post = await worker.fetch(new Request("http://localhost:5273/v1/manifest", { method: "POST" }), env, ctx);
    expect(post.status).toBe(405);
  });
});
