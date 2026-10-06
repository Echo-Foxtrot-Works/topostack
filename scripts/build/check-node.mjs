/**
 * Fail fast when the local Node.js release cannot run the script tests.
 *
 * Several script tests import TypeScript sources directly and rely on native
 * type stripping, which older Node 22 releases lack (ERR_UNKNOWN_FILE_EXTENSION).
 * Supported ranges come from package.json `engines.node` (`^x.y.z` / `>=x.y.z`).
 */
import { readFileSync } from "node:fs";
import { isMainModule } from "../lib/main-module.mjs";

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) throw new Error(`Unrecognized version: ${value}`);
  return match.slice(1, 4).map(Number);
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function satisfiesEngines(version, engines) {
  const current = parseVersion(version);
  return engines.split("||").some((range) => {
    const clause = range.trim();
    if (clause.startsWith(">=")) return compare(current, parseVersion(clause.slice(2))) >= 0;
    if (clause.startsWith("^")) {
      const minimum = parseVersion(clause.slice(1));
      return current[0] === minimum[0] && compare(current, minimum) >= 0;
    }
    throw new Error(`Unsupported engines.node clause: ${clause}`);
  });
}

if (isMainModule(import.meta.url)) {
  const engines = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).engines.node;
  const minimum = engines.split("||")[0].trim().replace(/^[\^>=]+/, "");
  if (!satisfiesEngines(process.version, engines)) {
    console.error(`Node >=${minimum} required (found ${process.version}; supported: ${engines}); run \`nvm use\`.`);
    process.exit(1);
  }
}
