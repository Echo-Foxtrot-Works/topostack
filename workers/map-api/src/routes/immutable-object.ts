import { edgeCacheKey, matchEdge, teeToEdge } from "../edge-cache";
import { etagMatches, json } from "../http";

/**
 * Serves a content-addressed R2 object: the URL carries the start of its
 * SHA-256, and the object's `sha256` metadata must match, so the response can
 * be cached as immutable at every layer. Used for lake outlines and lake
 * depth previews.
 */
export interface ImmutableObject {
  /** R2 key of the object. */
  key: string;
  /** Hash prefix from the URL; the stored `sha256` must start with it. */
  hashPrefix: string;
  contentType: string;
  maxBytes: number;
  missing: string;
  invalid: string;
}

export async function immutableObjectResponse(request: Request, env: Env, ctx: ExecutionContext, object: ImmutableObject): Promise<Response> {
  const edgeKey = edgeCacheKey(request, object.key);
  const cached = await matchEdge(edgeKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-topostack-cache", "EDGE");
    if (etagMatches(request.headers.get("if-none-match"), headers.get("etag") ?? "")) {
      await cached.body?.cancel();
      return new Response(null, { status: 304, headers });
    }
    if (request.method === "HEAD") { await cached.body?.cancel(); return new Response(null, { headers }); }
    return new Response(cached.body, { headers });
  }
  const stored = request.method === "HEAD" ? await env.VECTOR_DATA.head(object.key) : await env.VECTOR_DATA.get(object.key, {
    onlyIf: request.headers.has("if-none-match") ? new Headers({ "if-none-match": request.headers.get("if-none-match")! }) : undefined,
  });
  if (!stored) return json({ error: object.missing }, { status: 404 });
  const sha256 = stored.customMetadata?.sha256;
  if (stored.size >= object.maxBytes || !sha256 || !/^[a-f0-9]{64}$/.test(sha256) || !sha256.startsWith(object.hashPrefix)) {
    if ("body" in stored) await (stored as R2ObjectBody).body.cancel();
    return json({ error: object.invalid }, { status: 503 });
  }
  const headers = new Headers({ "content-type": object.contentType, "content-length": String(stored.size),
    "cache-control": "public, max-age=31536000, immutable", "etag": stored.httpEtag,
    "x-content-type-options": "nosniff", "x-topostack-cache": "R2" });
  if (etagMatches(request.headers.get("if-none-match"), stored.httpEtag)) {
    if ("body" in stored) await (stored as R2ObjectBody).body.cancel();
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") return new Response(null, { headers });
  if (!("body" in stored)) return new Response(null, { status: 412 });
  return new Response(teeToEdge(ctx, edgeKey, (stored as R2ObjectBody).body, headers), { headers });
}
