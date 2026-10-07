import { json } from "../http";
import { immutableObjectResponse } from "./immutable-object";

/** Lake-page depth previews, named by the first 24 hex digits of their SHA-256 (scripts/provision/provision-lake-previews.mjs). */
export const PREVIEW_PATH = /^\/v1\/lake-previews\/([a-f0-9]{24})\.webp$/;
const MAX_BYTES = 1_000_000;

export async function previewResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const match = PREVIEW_PATH.exec(new URL(request.url).pathname);
  if (!match) return json({ error: "Invalid preview path." }, { status: 404 });
  return immutableObjectResponse(request, env, ctx, { key: `lake-previews/${match[1]}.webp`, hashPrefix: match[1]!, contentType: "image/webp",
    maxBytes: MAX_BYTES, missing: "Lake preview not found.", invalid: "Invalid lake preview object." });
}
