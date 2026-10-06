import { FEEDBACK_LIMITS, parseFeedbackSubmission, type FeedbackKind, type FeedbackSubmission } from "@topostack/data-contracts/feedback";
import { BodyTooLargeError, readBounded } from "../body";
import { clientKey, json, rateLimitExceeded } from "../http";

const FEEDBACK_GLOBAL_LIMIT_KEY = "feedback-global";
const KIND_LABELS: Record<FeedbackKind, string> = { bug: "Bug", feature: "Feature", terrain: "Terrain data", lake: "Lake data" };

type FeedbackEnv = Pick<Env, "ENVIRONMENT" | "FEEDBACK_EMAIL" | "FEEDBACK_EMAIL_FROM" | "FEEDBACK_EMAIL_TO" | "FEEDBACK_LIMITER" | "FEEDBACK_GLOBAL_LIMITER">;

// Plain text only, so reporter text is never rendered as markup in a mail
// client. Line breaks are stripped from the subject; the binding builds the
// headers, but a summary should still read as one line.
export function feedbackEmail(submission: FeedbackSubmission, environment: string): { subject: string; text: string } {
  const summary = submission.summary.replace(/[\r\n\t]+/g, " ");
  const tag = environment === "production" ? "TopoStack" : `TopoStack ${environment}`;
  const lines = [
    `Type: ${KIND_LABELS[submission.kind]}`,
    `Reply to: ${submission.replyTo ?? "not provided (anonymous)"}`,
    "",
    submission.details,
  ];
  if (submission.context) lines.push("", "Diagnostic context (shared by reporter):", JSON.stringify(submission.context, null, 2));
  return { subject: `[${tag} ${KIND_LABELS[submission.kind]}] ${summary}`, text: lines.join("\n") };
}

export async function feedbackResponse(request: Request, env: FeedbackEnv): Promise<Response> {
  const respond = (status: number, error?: string) => error ? json({ error }, { status, headers: { "cache-control": "no-store" } }) : new Response(null, { status, headers: { "cache-control": "no-store" } });
  // Same-origin browser POSTs only, like usage events: the form lives on the
  // app's own pages and the Atomm workbench offers no feedback entry point.
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond(403, "Origin is not allowed.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return respond(415, "Send feedback as JSON.");
  if (Number(request.headers.get("content-length")) > FEEDBACK_LIMITS.bodyBytes) return respond(413, "Feedback is too long.");
  // Per-client first so one client over its budget cannot drain the shared ceiling.
  if (!(await env.FEEDBACK_LIMITER.limit({ key: clientKey(request) })).success) return rateLimitExceeded("Too much feedback at once. Try again in a minute.");
  if (!(await env.FEEDBACK_GLOBAL_LIMITER.limit({ key: FEEDBACK_GLOBAL_LIMIT_KEY })).success) {
    console.warn(JSON.stringify({ message: "feedback_global_budget_exceeded" }));
    return rateLimitExceeded("Feedback is busy right now. Try again in a minute.");
  }
  let submission: FeedbackSubmission | undefined;
  try {
    const bytes = await readBounded(request.body, FEEDBACK_LIMITS.bodyBytes);
    submission = parseFeedbackSubmission(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return respond(413, "Feedback is too long.");
  }
  if (!submission) return respond(400, "Feedback is incomplete or invalid.");
  // Pretend success to bots that fill the hidden field, so they learn nothing.
  if (submission.website) {
    console.log(JSON.stringify({ message: "feedback_discarded", reason: "honeypot" }));
    return respond(204);
  }
  if (!env.FEEDBACK_EMAIL_TO) {
    console.error(JSON.stringify({ message: "feedback_unconfigured" }));
    return respond(503, "Feedback email is not configured.");
  }
  const { subject, text } = feedbackEmail(submission, env.ENVIRONMENT);
  try {
    const { messageId } = await env.FEEDBACK_EMAIL.send({
      from: { email: env.FEEDBACK_EMAIL_FROM, name: "TopoStack feedback" },
      to: env.FEEDBACK_EMAIL_TO,
      ...(submission.replyTo ? { replyTo: submission.replyTo } : {}),
      subject,
      text,
    });
    console.log(JSON.stringify({ message: "feedback_sent", kind: submission.kind, withReply: Boolean(submission.replyTo), withContext: Boolean(submission.context), messageId }));
    return respond(204);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    console.error(JSON.stringify({ message: "feedback_send_failed", code, error: error instanceof Error ? error.message : String(error) }));
    return respond(502, "Feedback could not be sent.");
  }
}
