/**
 * Where the map-api Worker lives. The studio is served by the same Worker, so
 * the default is its own origin; builds and local development can name
 * another, and an embedded preview (the in-chat MCP App, whose document has no
 * origin of its own) sets one at startup with `configureApiBase`.
 */
function normalizeApiBase(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("VITE_MAP_API_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.");
  }
  return url.origin;
}

const configuredApiBase = normalizeApiBase(import.meta.env.VITE_MAP_API_URL as string | undefined);
// Wrangler's default 8787 is often taken, so `npm run dev` (and a standalone
// `npm run dev:web`) can retarget the local API with VITE_MAP_API_PORT.
const developmentApiPort = (import.meta.env.VITE_MAP_API_PORT as string | undefined) || "8787";
const developmentApiBase = import.meta.env.DEV ? `http://localhost:${developmentApiPort}` : undefined;
// Standalone deployments serve the app and API from the same Worker. Atomm
// packages still inject an explicit API URL during their build.
let current = configuredApiBase ?? developmentApiBase ?? "";

export function apiBase(): string {
  return current;
}

/** Point every loader at `origin` from now on. */
export function configureApiBase(origin: string): void {
  const normalized = normalizeApiBase(origin);
  if (!normalized) throw new Error("An API origin is required.");
  current = normalized;
}
