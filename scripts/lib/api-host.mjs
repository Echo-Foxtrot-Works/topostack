// Shared by scripts/release/validate-submission-env.mjs (pre-build gate) and
// scripts/verify/verify-atomm-dist.mjs (built-artifact scan) so both reject the same
// placeholder and development endpoint families.
const FORBIDDEN_SUFFIXES = [".localhost", ".invalid", ".test", ".local", ".example", ".workers.dev"];

/** True for hosts that can never be a deployed production map API endpoint. */
export function isForbiddenApiHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  // Reserved/special-use TLDs (RFC 2606/6761) and Workers preview hosts are
  // never valid production endpoints for a submitted artifact.
  if (FORBIDDEN_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) return true;
  if (host.includes("example.")) return true;
  return false;
}

/**
 * Hosts a bundled library writes into its own code without ever calling them,
 * each tied to a string only that library's chunk contains. An entry here says
 * why the host is not an endpoint; everything else found in a script still
 * fails the scan.
 */
const LIBRARY_HOSTS = [
  // pdf.js tells absolute URLs from relative ones by parsing against this base
  // (`new URL(url, "http://example.com")`). It is never requested.
  { host: "example.com", marker: "GlobalWorkerOptions" },
  // MapLibre parses attribution URLs against this base to inspect their protocol.
  // The base is never requested or copied into the sanitized markup.
  { host: "maplibre.invalid", marker: "setRTLTextPlugin" },
];

/** The forbidden hosts named in one built file, less those a bundled library only writes. */
export function forbiddenHostsIn(text) {
  const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1].toLowerCase());
  const allowed = new Set(LIBRARY_HOSTS.filter((entry) => text.includes(entry.marker)).map((entry) => entry.host));
  return [...new Set(hosts.filter((host) => isForbiddenApiHost(host) && !allowed.has(host)))];
}
