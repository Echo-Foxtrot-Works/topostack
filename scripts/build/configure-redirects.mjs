import { DEVELOPMENT_ORIGIN, PRODUCTION_ORIGIN } from "../lib/r2-buckets.mjs";
import { CLOUDFLARE_TIMEOUT_MS } from "../lib/cloudflare-client.mjs";
import { isMainModule } from "../lib/main-module.mjs";

// Hostname redirects that belong to the zone rather than to the Worker: a
// Single Redirect rule runs before the Worker and its static assets, so the
// `_headers` policy (CSP, HSTS) still applies to every page the canonical host
// serves.
//
// TopoStack moved from echofoxtrot.works to topostack.app. The legacy hosts
// stay attached to the Worker so published Atomm packages keep reaching the
// API there (CORS preflights cannot follow a redirect); every other request on
// them is redirected. `www` has no Worker Custom Domain at all, so all of it
// is redirected to the apex.
export const LEGACY_ZONE = "echofoxtrot.works";
export const CANONICAL_ZONE = "topostack.app";
export const WWW_HOST = `www.${CANONICAL_ZONE}`;
export const LEGACY_HOSTS = Object.freeze({
  "topostack.echofoxtrot.works": PRODUCTION_ORIGIN,
  "dev-topostack.echofoxtrot.works": DEVELOPMENT_ORIGIN,
});
const PHASE = "http_request_dynamic_redirect";
const REF_PREFIX = "topostack_";
// Mirrors run_worker_first in workers/map-api/wrangler.jsonc: these paths are
// served in place on the legacy host instead of redirected.
const API_EXCLUSION = 'not http.request.uri.path in {"/health" "/ready" "/v1"}'
  + ' and not starts_with(http.request.uri.path, "/v1/")'
  + ' and not starts_with(http.request.uri.path, "/data/lake-outlines/")';
// Redirect-only hostnames need a proxied DNS record to reach the ruleset
// engine at all. The documented placeholder is the discard-prefix address
// 100::, which is never connected to because the redirect answers first.
export const WWW_DNS_RECORD = Object.freeze({
  type: "AAAA",
  name: "www",
  content: "100::",
  proxied: true,
  comment: "Redirect-only placeholder for www; see scripts/build/configure-redirects.mjs",
});

function redirectRule({ ref, host, origin, condition = "" }) {
  return {
    ref,
    description: `TopoStack: redirect ${host} to ${new URL(origin).host}`,
    expression: `(http.host eq "${host}"${condition})`,
    action: "redirect",
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: { expression: `concat("${origin}", http.request.uri.path)` },
        preserve_query_string: true,
      },
    },
    enabled: true,
  };
}

/** The redirect rules this script owns, grouped by the zone that holds them. */
export function redirectRulesByZone() {
  return {
    [LEGACY_ZONE]: Object.entries(LEGACY_HOSTS).map(([host, origin]) => redirectRule({
      ref: `${REF_PREFIX}legacy_${host.replaceAll(/[^a-z0-9]/g, "_")}`,
      host,
      origin,
      condition: ` and ${API_EXCLUSION}`,
    })),
    [CANONICAL_ZONE]: [redirectRule({ ref: `${REF_PREFIX}www`, host: WWW_HOST, origin: PRODUCTION_ORIGIN })],
  };
}

/** Replaces this script's rules and keeps every other rule in the zone's redirect phase untouched. */
export function mergeRedirectRules(existing = [], desired = []) {
  const kept = existing
    .filter((rule) => !rule.ref?.startsWith(REF_PREFIX))
    .map(({ id, ref, description, expression, action, action_parameters, enabled }) => ({ id, ref, description, expression, action, action_parameters, enabled }));
  return [...kept, ...desired];
}

// Zone-scoped, and a missing ruleset (404) is an answer here, so this does not
// use the account-scoped lib/cloudflare-client.mjs; it shares its deadline.
async function cloudflare(path, token, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function zoneId(zone, token) {
  const zones = await cloudflare(`/zones?name=${zone}`, token);
  const id = zones.body.result?.[0]?.id;
  if (!id) throw new Error(`Zone ${zone} is not visible to this token: ${JSON.stringify(zones.body.errors)}`);
  return id;
}

async function applyZoneRules(zone, desired, token, apply) {
  const id = await zoneId(zone, token);
  const entrypoint = await cloudflare(`/zones/${id}/rulesets/phases/${PHASE}/entrypoint`, token);
  if (entrypoint.status !== 200 && entrypoint.status !== 404) throw new Error(`Reading ${zone} redirect rules failed: ${JSON.stringify(entrypoint.body.errors)}`);
  const rules = mergeRedirectRules(entrypoint.status === 200 ? entrypoint.body.result.rules : [], desired);
  if (!apply) {
    console.log(`# ${zone}\n${JSON.stringify(rules, null, 2)}`);
    console.log(`Dry run: ${zone} would keep ${rules.length - desired.length} other rule(s) and carry ${desired.length} TopoStack rule(s).`);
    return id;
  }
  const written = await cloudflare(`/zones/${id}/rulesets/phases/${PHASE}/entrypoint`, token, { method: "PUT", body: JSON.stringify({ rules }) });
  if (!written.body.success) throw new Error(`Writing ${zone} redirect rules failed: ${JSON.stringify(written.body.errors)}`);
  console.log(`Applied ${desired.length} TopoStack redirect rule(s) to ${zone}.`);
  return id;
}

// A redirect rule only sees traffic for a hostname that resolves and is
// proxied, so `www` needs its placeholder record before the rule does anything.
// An existing record is left alone: it may be a real service.
async function ensureWwwRecord(id, token, apply) {
  const existing = await cloudflare(`/zones/${id}/dns_records?name=${WWW_HOST}`, token);
  if (!existing.body.success) throw new Error(`Reading ${WWW_HOST} DNS records failed: ${JSON.stringify(existing.body.errors)}`);
  const record = existing.body.result[0];
  if (record) {
    console.log(`${WWW_HOST}: ${record.type} record already exists (proxied: ${record.proxied}); leaving it in place.`);
    if (!record.proxied) console.warn(`${WWW_HOST} is not proxied, so the redirect rule will never run for it.`);
    return;
  }
  if (!apply) {
    console.log(`Dry run: would create ${WWW_DNS_RECORD.type} ${WWW_HOST} -> ${WWW_DNS_RECORD.content} (proxied).`);
    return;
  }
  const created = await cloudflare(`/zones/${id}/dns_records`, token, { method: "POST", body: JSON.stringify(WWW_DNS_RECORD) });
  if (!created.body.success) throw new Error(`Creating the ${WWW_HOST} record failed: ${JSON.stringify(created.body.errors)}`);
  console.log(`Created the proxied ${WWW_DNS_RECORD.type} placeholder for ${WWW_HOST}.`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error(`Set CLOUDFLARE_API_TOKEN (Zone Read and Single Redirect Edit on ${LEGACY_ZONE} and ${CANONICAL_ZONE}, plus DNS Edit on ${CANONICAL_ZONE}).`);
  }
  const byZone = redirectRulesByZone();
  const canonicalId = await applyZoneRules(CANONICAL_ZONE, byZone[CANONICAL_ZONE], token, apply);
  await ensureWwwRecord(canonicalId, token, apply);
  await applyZoneRules(LEGACY_ZONE, byZone[LEGACY_ZONE], token, apply);
  if (!apply) console.log("Re-run with --apply to write them.");
}

if (isMainModule(import.meta.url)) await main();
