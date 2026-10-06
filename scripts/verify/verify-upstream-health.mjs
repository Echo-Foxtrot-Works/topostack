import { fetchGatewayJson, gatewayOrigin } from "../lib/gateway.mjs";
import { isMainModule } from "../lib/main-module.mjs";

/**
 * Hourly monitor for the Worker's cache-miss probes.
 *
 * The probe result is only meaningful as JSON; an outage or a WAF block answers
 * with a Cloudflare HTML page, which `fetchGatewayJson` reports as an HTTP
 * status instead of letting it surface as a SyntaxError from a JSON parse.
 */
export async function verifyUpstreamHealth(origin, request = fetch) {
  const result = await fetchGatewayJson(origin, "/v1/upstream-health", request);
  if (result?.status !== "healthy" || result.fresh !== true || result.ok !== true) {
    throw new Error(`Upstream cache-miss probes are unhealthy, missing, or older than two hours: ${JSON.stringify(result)}`);
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  console.log(JSON.stringify(await verifyUpstreamHealth(gatewayOrigin(process.env.WORKER_URL))));
}
