import release from "../../../../scripts/data/lake-outlines-release.json";

import { json } from "../http";
import { immutableObjectResponse } from "./immutable-object";

export const OUTLINE_PATH = /^\/v1\/lake-outlines\/([a-f0-9]{24}|[a-f0-9]{64})\.json$/;
export const OUTLINE_INDEX_FILE = release.index.file;
export const OUTLINE_INDEX_KEY = `lake-outlines/${release.index.file}`;
const MAX_BYTES = 5_000_000;

export async function outlineReadiness(bucket: R2Bucket): Promise<boolean> {
  const head = await bucket.head(OUTLINE_INDEX_KEY);
  return head?.size === release.index.bytes && head.customMetadata?.sha256 === release.index.sha256;
}

/** Content-addressed URLs remain valid across app releases; no mutable latest pointer. */
export async function outlineResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const match = OUTLINE_PATH.exec(new URL(request.url).pathname);
  if (!match) return json({ error: "Invalid outline path." }, { status: 404 });
  return immutableObjectResponse(request, env, ctx, { key: `lake-outlines/${match[1]}.json`, hashPrefix: match[1]!, contentType: "application/json",
    maxBytes: MAX_BYTES, missing: "Lake outlines have not been provisioned.", invalid: "Invalid lake outline object." });
}
