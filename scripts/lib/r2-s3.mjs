import { AwsClient } from "aws4fetch";

/** The account token that signs temporary R2 credentials; it must be active. */
export async function verifyParentToken(cloudflare) {
  const parent = await cloudflare("/tokens/verify");
  if (!parent?.id || parent.status !== "active") throw new Error("The account API token is not active.");
  return parent.id;
}

export function encodeObjectKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * Short-lived S3 credentials for one bucket. Omitting `objects` and `prefixes`
 * scopes them to the whole bucket, which listing requires.
 */
export async function temporaryR2Client({ cloudflare, accountId, bucket, parentAccessKeyId, permission, objects, prefixes, ttlSeconds = 3600 }) {
  const credentials = await cloudflare("/r2/temp-access-credentials", { method: "POST", body: JSON.stringify({
    bucket, parentAccessKeyId, permission, ttlSeconds, ...(objects ? { objects } : {}), ...(prefixes ? { prefixes } : {}),
  }) });
  if (!credentials?.accessKeyId || !credentials.secretAccessKey || !credentials.sessionToken) throw new Error("Missing temporary R2 credentials.");
  const client = new AwsClient({ ...credentials, service: "s3", region: "auto", retries: 0 });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const send = (url, init) => client.fetch(url, { signal: AbortSignal.timeout(30_000), ...init });
  const request = async (key, init) => retryReads(() => send(`${endpoint}/${bucket}/${encodeObjectKey(key)}`, init), init?.method);
  const list = (options) => listObjects((query) => retryReads(() => send(`${endpoint}/${bucket}?${query}`)), options);
  return { credentials, endpoint, request, list };
}

/**
 * Retries a read whose connection failed or timed out; a deploy preflight
 * makes thousands of them. Writes are never retried here, and an HTTP error
 * response is returned unchanged.
 */
export async function retryReads(send, method = "GET", { attempts = 3, delayMs = 2_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (!["GET", "HEAD"].includes(method.toUpperCase()) || attempt >= attempts) throw error;
      console.warn(`R2 ${method} failed (${error.name}: ${error.message}); retrying.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity) => {
    if (entity[0] !== "#") return XML_ENTITIES[entity.toLowerCase()];
    return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  });
}

function element(xml, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decodeXml(match[1]) : undefined;
}

/** Parses one ListObjectsV2 page; R2 returns the standard S3 XML shape. */
export function parseListObjectsXml(xml) {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, entry]) => {
    const key = element(entry, "Key"), size = Number(element(entry, "Size")), uploaded = new Date(element(entry, "LastModified") ?? "");
    if (!key || !Number.isSafeInteger(size) || !Number.isFinite(uploaded.getTime())) throw new Error("Unexpected R2 listing entry.");
    return { key, size, uploaded };
  });
  const prefixes = [...xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)].map(([, entry]) => element(entry, "Prefix"));
  const truncated = element(xml, "IsTruncated") === "true";
  const nextToken = element(xml, "NextContinuationToken");
  if (truncated && !nextToken) throw new Error("Truncated R2 listing has no continuation token.");
  return { objects, prefixes, nextToken: truncated ? nextToken : undefined };
}

/** Lists every page under a prefix; with a delimiter, `prefixes` holds the next path segment. */
export async function listObjects(fetchPage, { prefix = "", delimiter } = {}) {
  const objects = [], prefixes = [];
  let token;
  do {
    const query = new URLSearchParams({ "list-type": "2", prefix, ...(delimiter ? { delimiter } : {}), ...(token ? { "continuation-token": token } : {}) });
    const response = await fetchPage(query.toString());
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(`R2 listing failed (${response.status}).`); }
    const page = parseListObjectsXml(await response.text());
    objects.push(...page.objects); prefixes.push(...page.prefixes);
    token = page.nextToken;
  } while (token);
  return { objects, prefixes };
}
