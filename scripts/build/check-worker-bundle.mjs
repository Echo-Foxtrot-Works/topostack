import { appendFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

// The map-api Worker streams data and answers agent requests; it never
// generates geometry. It imports only `@topostack/core/project`, and this check
// fails when the dry-run bundle (`npm run build -w @topostack/map-api`) grows
// past its budget or picks up the contour engine through some import chain.
// Raise the budget in the pull request that needs it, with the measured number.
const bundle = new URL("../../workers/map-api/dist/index.js", import.meta.url);

// Gzipped Worker script. 62,815 when set (2026-09-25, agent REST routes and
// the MCP server); 69,056 when raised 2026-09-29 (the FAA aviation archive
// route, its registration and coverage, and the aviation request contract);
// 77,263 when raised 2026-10-09 (the airspace-in-acrylic request field, its
// schema, plan estimate and notes, and the guide paragraph).
const BUDGET_GZIP = 85_000;

// Identifiers that only exist in the geometry engine and its dependencies.
const FORBIDDEN = ["ClipperLib", "contourDensity", "polygon-clipping", "generateGeometry", "buildFabricationPackage", "planSheets"];

let source;
try {
  source = await readFile(bundle, "utf8");
} catch {
  console.error("workers/map-api/dist/index.js is missing. Run `npm run build -w @topostack/map-api` first.");
  process.exit(1);
}

const gzip = gzipSync(source).byteLength;
const leaks = FORBIDDEN.filter((marker) => source.includes(marker));
const lines = [
  `Worker script: ${source.length.toLocaleString("en-US")} bytes, ${gzip.toLocaleString("en-US")} gzip (budget ${BUDGET_GZIP.toLocaleString("en-US")})`,
  ...leaks.map((marker) => `Geometry code in the Worker bundle: ${marker}`),
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Worker bundle\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`);

if (gzip > BUDGET_GZIP || leaks.length) {
  if (gzip > BUDGET_GZIP) console.error(`The Worker script is over its budget by ${(gzip - BUDGET_GZIP).toLocaleString("en-US")} gzip bytes.`);
  if (leaks.length) console.error("The Worker may import only @topostack/core/project; find the import chain that reached the geometry engine.");
  process.exit(1);
}
