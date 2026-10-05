const UPSTREAM_TIMEOUT_MS = 10_000;
const DEFAULT_ALLOWED_ORIGIN_SUFFIXES = ".atomm.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export interface OriginPolicyEnv {
  ALLOWED_ORIGINS: string;
  // Comma-separated host suffixes allowed over HTTPS (default ".atomm.com").
  // Set to an empty string to disable suffix-based origins entirely.
  ALLOWED_ORIGIN_SUFFIXES?: string;
  ENVIRONMENT?: string;
}

// The local dev server moves to another port whenever its default is taken, so
// pinning exact loopback origins would break `npm run dev` at the first
// collision. Only the development Worker accepts a floating port this way;
// staging and production keep the exact ALLOWED_ORIGINS list.
function isDevelopmentLoopbackOrigin(origin: string, env: OriginPolicyEnv): boolean {
  if (env.ENVIRONMENT !== "development") return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// CORS is a browser policy, not access control: requests without an Origin
// (curl, servers) are always allowed. Upstream-cost routes rely on rate limits.
export function isAllowedOrigin(origin: string | null, env: OriginPolicyEnv): boolean {
  if (!origin) return true;
  if (env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).includes(origin)) return true;
  if (isDevelopmentLoopbackOrigin(origin, env)) return true;
  if (!origin.startsWith("https://")) return false;
  const suffixes = (env.ALLOWED_ORIGIN_SUFFIXES ?? DEFAULT_ALLOWED_ORIGIN_SUFFIXES)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    // A leading dot keeps the label boundary: ".atomm.com" matches
    // https://runtime.atomm.com but not https://evil-atomm.com.
    .map((suffix) => (suffix.startsWith(".") ? suffix : `.${suffix}`));
  return suffixes.some((suffix) => origin.endsWith(suffix));
}

export function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("origin");
  const pathname = new URL(request.url).pathname;
  const isEvent = pathname === "/v1/events" || pathname === "/v1/feedback";
  // Agent routes take public POSTs with no side effects and no credentials, so
  // they stay open to every origin like the read-only data.
  // The MCP endpoint is the same kind of route, and browser-based MCP clients
  // send its protocol headers.
  const isAgentPost = pathname.startsWith("/v1/projects/") || pathname === "/mcp";
  const headers = new Headers({
    "access-control-allow-methods": isEvent || isAgentPost ? "POST,OPTIONS" : "GET,HEAD,OPTIONS",
    "access-control-allow-headers": pathname === "/mcp" ? "content-type,accept,authorization,mcp-protocol-version,mcp-session-id,last-event-id" : "range,content-type,if-none-match",
    // retry-after is readable so browser clients can back off after a 429.
    "access-control-expose-headers": pathname === "/mcp" ? "mcp-session-id,mcp-protocol-version,retry-after" : "content-length,content-range,etag,retry-after,x-topostack-dataset,x-topostack-cache,x-topostack-imagery-sources,x-topostack-r2-reads",
    "access-control-max-age": "86400",
    "vary": "Origin",
  });
  // Read-only data is public and carries no browser credentials. Keep event
  // collection and feedback on the allowlist and same-origin POST validation.
  if (!isEvent) headers.set("access-control-allow-origin", "*");
  else if (origin && isAllowedOrigin(origin, env)) headers.set("access-control-allow-origin", origin);
  return headers;
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders(request, env)) headers.set(name, value);
  headers.set("content-security-policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  if (response.status >= 400) headers.set("cache-control", "no-store");
  if (request.method === "HEAD") {
    void response.body?.cancel().catch(() => {});
    return new Response(null, { status: response.status, statusText: response.statusText, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function upstreamSignal(request: Request): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
}

export function upstreamFailure(error: unknown, service: string): Response {
  const timedOut = error instanceof DOMException && error.name === "TimeoutError";
  console.warn(JSON.stringify({ message: "upstream_failed", service, reason: timedOut ? "timeout" : "network" }));
  return json({ error: timedOut ? `${service} timed out` : `${service} unavailable` }, { status: timedOut ? 504 : 502 });
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(text: string): number[] | null {
  const match = IPV4.exec(text);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Expands an IPv6 address (compressed `::`, embedded IPv4, zone id) into 8 hextets. */
function parseIpv6(text: string): number[] | null {
  let address = text.toLowerCase().replace(/%.*$/, "");
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = parseIpv4(tail);
    if (!octets) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0] ?? "");
  const tailGroups = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  const missing = 8 - head.length - tailGroups.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tailGroups];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/**
 * Rate-limit identity for a client address. IPv6 hosts routinely receive a
 * whole /64 and can rotate through it at will, so v6 clients are keyed by
 * their /64 prefix; IPv4-mapped v6 addresses collapse to the IPv4 address.
 */
export function normalizeClientAddress(address: string): string {
  const trimmed = address.trim();
  if (parseIpv4(trimmed)) return trimmed;
  const groups = trimmed.includes(":") ? parseIpv6(trimmed) : null;
  if (!groups) return trimmed.toLowerCase();
  const isMappedV4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMappedV4) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

export function clientKey(request: Request): string {
  const address = request.headers.get("cf-connecting-ip");
  return address ? normalizeClientAddress(address) : "anonymous";
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((candidate) => normalize(candidate) === normalize(etag));
}

export function methodNotAllowed(allow: string): Response {
  return json({ error: "Method not allowed." }, { status: 405, headers: { allow } });
}

export function rateLimitExceeded(message = "Rate limit exceeded. Try again shortly."): Response {
  return json({ error: message }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
}
