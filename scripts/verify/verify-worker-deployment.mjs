// No external dependencies: the hourly production monitor runs this file
// straight from a checkout, so it must not need an
// `npm ci`; the jsdom-based SEO checks run separately (scripts/verify/verify-seo-http.mjs).
import { gunzipSync } from "node:zlib";
import { fetchWithRetry as fetchDeploymentResponse } from "../lib/deployment-fetch.mjs";

const deploymentTarget = process.env.WORKER_URL;
const publicAppUrl = process.env.PUBLIC_APP_URL ?? deploymentTarget;
const expectedEnvironment = process.env.EXPECTED_WORKER_ENVIRONMENT;

if (!deploymentTarget) throw new Error("WORKER_URL was not returned by the deployment action.");
if (!publicAppUrl) throw new Error("PUBLIC_APP_URL was not configured and no deployment URL is available.");
if (!expectedEnvironment || !["development", "production"].includes(expectedEnvironment)) throw new Error("EXPECTED_WORKER_ENVIRONMENT must be development or production.");

// Wrangler prints custom-domain routes as a hostname with a display suffix,
// while workers.dev targets are already URLs. Normalize only that known form.
const customDomain = deploymentTarget.trim().match(/^([a-z0-9.-]+) \(custom domain\)$/i)?.[1];
const deploymentBase = new URL(customDomain ? `https://${customDomain}` : deploymentTarget);
const publicBase = new URL(publicAppUrl);
if ([deploymentBase, publicBase].some((url) => url.protocol !== "https:" || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)) throw new Error("Deployment and public app URLs must be HTTPS origins without credentials, paths, queries, or fragments.");

const fetchWithRetry = (base, path, init) => fetchDeploymentResponse(base, path, init, {
  allowRolloutStatuses: process.env.DEPLOYMENT_ROLLOUT === "1",
});

async function fetchJson(base, path) {
  return await (await fetchWithRetry(base, path, { headers: { accept: "application/json" } })).json();
}

const deploymentHealth = await fetchJson(deploymentBase, "/health");
if (deploymentHealth?.service !== "topostack-map-api" || deploymentHealth?.status !== "ok" || deploymentHealth?.environment !== expectedEnvironment) throw new Error(`Unexpected deployment-target health response: ${JSON.stringify(deploymentHealth)}`);

// Verify both public entry points so a healthy homepage cannot hide a missing editor.
for (const path of ["/", "/studio"]) {
  const appResponse = await fetchWithRetry(publicBase, path, { headers: { accept: "text/html" } });
  const contentType = appResponse.headers.get("content-type") ?? "";
  const appHtml = await appResponse.text();
  if (!contentType.includes("text/html") || !appHtml.includes("data-sveltekit-preload-data")
    || (path === "/studio" && !appHtml.includes("static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js"))
    || (path === "/" && !/href=["'][^"']*studio["']/.test(appHtml))) {
    throw new Error(`The public deployment did not return the TopoStack frontend at ${path}.`);
  }
  if (!appResponse.headers.get("content-security-policy")?.includes("default-src 'self'")
    || appResponse.headers.get("x-content-type-options") !== "nosniff"
    || !appResponse.headers.get("strict-transport-security")?.includes("max-age=31536000")) {
    throw new Error(`The public frontend at ${path} is missing required browser security headers.`);
  }
}

// Assistant crawlers read the prerendered HTML; they are how the site is
// described in AI answers. Cloudflare's AI-scraper blocking matches on the
// user agent, so sending these agents is a faithful probe of that setting and
// of any WAF rule that starts filtering by user agent. Googlebot is
// deliberately not spoofed here: Cloudflare verifies it by reverse DNS, so a
// request from a runner would be judged an impostor and prove nothing.
const assistantCrawlers = [
  "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  // Anthropic publishes this string with an unbalanced parenthesis. It is
  // copied verbatim on purpose; tidying it would stop probing the real agent.
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
];
for (const userAgent of assistantCrawlers) {
  const crawled = await fetchWithRetry(publicBase, "/", { headers: { accept: "text/html", "user-agent": userAgent } });
  const crawledHtml = await crawled.text();
  if (crawled.status !== 200 || !(crawled.headers.get("content-type") ?? "").includes("text/html") || !crawledHtml.includes("data-sveltekit-preload-data")) {
    throw new Error(`The homepage was not served to ${userAgent.match(/[A-Za-z]+Bot/)?.[0] ?? userAgent} (HTTP ${crawled.status}). Check Cloudflare's AI scraper blocking, Bot Fight Mode and WAF rules.`);
  }
}

// A crawl-all robots file is the site's stated policy; a stray Disallow would
// remove pages from search and assistants alike without any other symptom.
const robots = await fetchWithRetry(publicBase, "/robots.txt", { headers: { accept: "text/plain" } });
const robotsBody = await robots.text();
if (!(robots.headers.get("content-type") ?? "").includes("text/plain") || !robotsBody.startsWith("User-agent: *\nAllow: /") || /^Disallow: \S/m.test(robotsBody)) {
  throw new Error(`robots.txt is no longer a permissive plain-text file: ${JSON.stringify(robotsBody.slice(0, 200))}`);
}

const health = await fetchJson(publicBase, "/health");
if (health?.service !== "topostack-map-api" || health?.status !== "ok" || health?.environment !== expectedEnvironment) throw new Error(`Unexpected Worker health response: ${JSON.stringify(health)}`);

const readiness = await fetchJson(publicBase, "/ready");
if (readiness?.service !== "topostack-map-api" || readiness?.status !== "ready" || readiness?.environment !== expectedEnvironment || readiness?.dependencies?.geocoder?.status !== "configured" || readiness?.dependencies?.vectorData?.status !== "available" || readiness?.dependencies?.lakeData?.status !== "available" || readiness?.dependencies?.lakeOutlines?.status !== "available") {
  throw new Error(`Unexpected Worker readiness response: ${JSON.stringify(readiness)}`);
}

// Exercise the actual hosted iframe origin: requests without Origin hid the
// submission's CORS rejection even while every deployment canary was green.
const atommOrigin = "https://topostack.generator.atommapps.com";
function verifyPublicCors(response) {
  if (response.headers.get("access-control-allow-origin") !== "*" || response.headers.has("access-control-allow-credentials")) {
    throw new Error("The public map API must allow credential-free browser reads from any origin.");
  }
}
const preflight = await fetchWithRetry(publicBase, "/v1/osm.pmtiles", { method: "OPTIONS", headers: { origin: atommOrigin, "access-control-request-method": "GET", "access-control-request-headers": "range,if-none-match" } });
verifyPublicCors(preflight);
if (preflight.status !== 204 || !preflight.headers.get("access-control-allow-headers")?.includes("range")) throw new Error("The Atomm archive preflight failed.");

const terrainResponse = await fetchWithRetry(publicBase, "/v1/terrain/0/0/0.png", { headers: { accept: "image/png", origin: atommOrigin } });
if (!terrainResponse.headers.get("content-type")?.includes("image/png") || !terrainResponse.headers.get("x-topostack-dataset")) {
  throw new Error("The terrain proxy returned invalid metadata.");
}
verifyPublicCors(terrainResponse);
const terrainHeader = new Uint8Array((await terrainResponse.arrayBuffer()).slice(0, 8));
if (!terrainHeader.every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
  throw new Error("The terrain proxy did not return a PNG tile.");
}

const geocoder = await fetchJson(publicBase, "/v1/geocode?q=Crater%20Lake&limit=1");
if (!Array.isArray(geocoder) || geocoder.length < 1 || typeof geocoder[0]?.display_name !== "string"
  || !Number.isFinite(geocoder[0]?.lat) || !Number.isFinite(geocoder[0]?.lon)) {
  throw new Error(`The geocoder returned an invalid canary response: ${JSON.stringify(geocoder)}`);
}

const vectorResponse = await fetchWithRetry(publicBase, "/v1/osm.pmtiles", { headers: { range: "bytes=0-126", origin: atommOrigin } });
if (vectorResponse.status !== 206 || !vectorResponse.headers.get("content-range")?.startsWith("bytes 0-126/")) throw new Error("The vector archive did not honor a PMTiles header range request.");
verifyPublicCors(vectorResponse);
const vectorHeader = new Uint8Array(await vectorResponse.arrayBuffer());
if (new TextDecoder().decode(vectorHeader.subarray(0, 7)) !== "PMTiles" || vectorHeader[7] !== 3) throw new Error("The vector archive did not return a PMTiles v3 header.");
if (vectorHeader[101] !== 12) throw new Error("The deployed vector archive has max zoom " + String(vectorHeader[101] ?? "unknown") + "; expected 12.");

if (readiness?.dependencies?.lakeData?.status === "available") {
  const lakeResponse = await fetchWithRetry(publicBase, "/v1/lakes.pmtiles", { headers: { range: "bytes=0-126", origin: atommOrigin } });
  verifyPublicCors(lakeResponse);
  const lakeHeader = new Uint8Array(await lakeResponse.arrayBuffer());
  if (lakeResponse.status !== 206 || new TextDecoder().decode(lakeHeader.subarray(0, 7)) !== "PMTiles" || lakeHeader[7] !== 3) {
    throw new Error("The lake archive did not return a PMTiles v3 header range.");
  }
}

const manifest = await fetchJson(publicBase, "/v1/manifest");
if (manifest?.schemaVersion !== 1 || manifest?.coverage?.vectorMaxZoom !== 12 || typeof manifest?.datasetVersion !== "string" || !Array.isArray(manifest?.sources)) throw new Error("The deployed Worker returned an invalid data manifest.");

// FAA aviation is optional for /ready, so nothing above notices when its
// archive is missing or older than the registration the Worker advertises:
// projects with aviation detail would then fail to load or carry the wrong
// symbols. When the manifest names the archive, it must serve exactly that dataset.
const aviation = manifest.sources.find((source) => source?.archive === "/v1/aviation.pmtiles");
if (aviation) {
  const aviationResponse = await fetchWithRetry(publicBase, "/v1/aviation.pmtiles", { headers: { range: "bytes=0-126", origin: atommOrigin } });
  verifyPublicCors(aviationResponse);
  const aviationHeader = new Uint8Array(await aviationResponse.arrayBuffer());
  if (aviationResponse.status !== 206 || new TextDecoder().decode(aviationHeader.subarray(0, 7)) !== "PMTiles" || aviationHeader[7] !== 3) {
    throw new Error(`The aviation archive did not return a PMTiles v3 header range (HTTP ${aviationResponse.status}). Provision ${aviation.id} with scripts/provision/provision-aviation-data.mjs.`);
  }
  // Header fields are little-endian: JSON metadata offset at byte 24, its length at 32, internal compression at 97 (1 none, 2 gzip).
  const header = new DataView(aviationHeader.buffer);
  const metadataOffset = Number(header.getBigUint64(24, true));
  const metadataLength = Number(header.getBigUint64(32, true));
  const compression = aviationHeader[97];
  if (!metadataLength || metadataLength > 1_000_000 || (compression !== 1 && compression !== 2)) throw new Error("The aviation archive header has unreadable metadata.");
  const metadataResponse = await fetchWithRetry(publicBase, "/v1/aviation.pmtiles", { headers: { range: `bytes=${metadataOffset}-${metadataOffset + metadataLength - 1}`, origin: atommOrigin } });
  const metadataBytes = Buffer.from(await metadataResponse.arrayBuffer());
  const metadata = JSON.parse((compression === 2 ? gunzipSync(metadataBytes) : metadataBytes).toString("utf8"));
  if (metadata?.topostack_dataset !== aviation.id) {
    throw new Error(`The aviation archive serves ${metadata?.topostack_dataset ?? "no dataset"}, but the Worker advertises ${aviation.id}. Provision the pinned archive with scripts/provision/provision-aviation-data.mjs.`);
  }
}

console.log(`Verified ${expectedEnvironment} TopoStack app and API at ${publicBase.origin} (deployment ${deploymentTarget})`);
