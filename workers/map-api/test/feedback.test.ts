import { describe, it, expect, vi, afterEach } from "vitest";
import { env, exports } from "cloudflare:workers";
import worker from "../src/index";
import { feedbackEmail, feedbackResponse } from "../src/routes/feedback";

const submission = { kind: "lake", summary: "Depths look flat\r\nBcc: x@example.com", details: "Crater Lake is missing its deep basin." };
const request = (body: unknown = submission, headers: Record<string, string> = {}) => new Request("http://localhost:5273/v1/feedback", {
  method: "POST", headers: { origin: "http://localhost:5273", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const allow = () => ({ limit: vi.fn(async () => ({ success: true })) });
function feedbackEnv(overrides: Partial<Env> = {}) {
  const send = vi.fn(async () => ({ messageId: "msg-1" }));
  return { send, env: { ...env, FEEDBACK_EMAIL_TO: "maintainer@example.com", FEEDBACK_EMAIL: { send }, FEEDBACK_LIMITER: allow(), FEEDBACK_GLOBAL_LIMITER: allow(), ...overrides } as unknown as Env };
}

afterEach(() => vi.restoreAllMocks());
describe("feedback email", () => {
  it("emails a plain-text report to the configured recipient with the reporter as reply-to", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { send, env: testEnv } = feedbackEnv();
    const response = await feedbackResponse(request({ ...submission, replyTo: "maker@example.com", context: { lakeCount: 1 } }), testEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(send).toHaveBeenCalledOnce();
    const message = (send.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(message).toMatchObject({ from: { email: "feedback@topostack.app" }, to: "maintainer@example.com", replyTo: "maker@example.com", subject: "[TopoStack development Lake data] Depths look flat Bcc: x@example.com" });
    expect(message.text).toContain("Crater Lake is missing its deep basin.");
    expect(message.text).toContain('"lakeCount": 1');
    expect(message).not.toHaveProperty("html");
  });
  it("sends anonymous reports without a reply-to and labels production subjects plainly", () => {
    const { subject, text } = feedbackEmail({ kind: "bug", summary: "Broken", details: "Details" }, "production");
    expect(subject).toBe("[TopoStack Bug] Broken");
    expect(text).toContain("not provided (anonymous)");
    expect(text).not.toContain("Diagnostic context");
  });
  it("accepts a valid report through the complete Worker route with the allowlisted origin echoed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { send, env: testEnv } = feedbackEnv();
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    const response = await worker.fetch(request(), testEnv, ctx);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5273");
    expect(send).toHaveBeenCalledOnce();
  });
  it("silently discards honeypot submissions", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { send, env: testEnv } = feedbackEnv();
    expect((await feedbackResponse(request({ ...submission, website: "https://spam.example" }), testEnv)).status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, non-JSON, oversized and invalid bodies without sending", async () => {
    const { send, env: testEnv } = feedbackEnv();
    expect((await feedbackResponse(request(submission, { origin: "https://www.atomm.com" }), testEnv)).status).toBe(403);
    expect((await feedbackResponse(request(submission, { "content-type": "text/plain" }), testEnv)).status).toBe(415);
    expect((await feedbackResponse(request(submission, { "content-length": "50000" }), testEnv)).status).toBe(413);
    expect((await feedbackResponse(request({ ...submission, details: "x".repeat(30_000) }), testEnv)).status).toBe(413);
    expect((await feedbackResponse(request("{"), testEnv)).status).toBe(400);
    expect((await feedbackResponse(request({ ...submission, kind: "spam" }), testEnv)).status).toBe(400);
    expect((await feedbackResponse(request({ ...submission, replyTo: "a@b.com\nBcc: c@d.com" }), testEnv)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it("rate limits per client before the shared ceiling", async () => {
    const perClient = { limit: vi.fn(async () => ({ success: false })) };
    const global = allow();
    const { send, env: testEnv } = feedbackEnv({ FEEDBACK_LIMITER: perClient, FEEDBACK_GLOBAL_LIMITER: global } as unknown as Partial<Env>);
    const response = await feedbackResponse(request(), testEnv);
    expect(response.status).toBe(429);
    expect(perClient.limit).toHaveBeenCalledWith({ key: "anonymous" });
    expect(global.limit).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const busy = feedbackEnv({ FEEDBACK_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: false })) } } as unknown as Partial<Env>);
    expect((await feedbackResponse(request(), busy.env)).status).toBe(429);
    expect(send).not.toHaveBeenCalled();
  });
  it("reports missing configuration and send failures without leaking details in responses or logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unconfigured = feedbackEnv({ FEEDBACK_EMAIL_TO: "" } as Partial<Env>);
    expect((await feedbackResponse(request(), unconfigured.env)).status).toBe(503);
    const privateReport = { ...submission, replyTo: "maker@example.com", context: { lakeCount: 1 } };
    const send = vi.fn(async () => { throw Object.assign(new Error(privateReport.details), { code: privateReport.replyTo }); });
    const failing = feedbackEnv({ FEEDBACK_EMAIL: { send } } as unknown as Partial<Env>);
    const response = await feedbackResponse(request(privateReport), failing.env);
    expect(send).toHaveBeenCalledOnce();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Feedback could not be sent." });
    expect(log.mock.calls).toEqual([
      [JSON.stringify({ message: "feedback_unconfigured" })],
      [JSON.stringify({ message: "feedback_send_failed" })],
    ]);
  });
  it("only accepts POST and answers preflights with POST", async () => {
    expect((await exports.default.fetch(new Request("http://localhost:5273/v1/feedback"))).status).toBe(405);
    const preflight = await exports.default.fetch(new Request("http://localhost:5273/v1/feedback", { method: "OPTIONS", headers: { origin: "http://localhost:5273" } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST,OPTIONS");
  });
});
