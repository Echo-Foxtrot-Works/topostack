/**
 * Run every unit the public lands builder wrote through the browser's contract
 * parser, so the archive never carries a unit, or an optional property, the
 * studio would drop, and check that every class has units.
 *
 * Usage: node scripts/data-build/check-lands-features.mjs <lands.geojsonl>
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { LAND_CLASSES, parseLandProperties } from "@topostack/data-contracts/land-tiles";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/data-build/check-lands-features.mjs <lands.geojsonl>");

const counts = new Map(LAND_CLASSES.map((cls) => [cls, 0]));
const units = new Set();
let rejected;
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  if (!line) continue;
  const feature = JSON.parse(line);
  const parsed = parseLandProperties(feature.properties);
  const whole = parsed !== undefined && Object.keys(parsed).length === Object.keys(feature.properties).length;
  if (!whole || !["Polygon", "MultiPolygon"].includes(feature.geometry?.type) || units.has(parsed.unit)) {
    rejected ??= feature.properties;
    continue;
  }
  units.add(parsed.unit);
  counts.set(parsed.class, counts.get(parsed.class) + 1);
}
if (rejected) throw new Error(`A unit breaks the lands contract or repeats a unit id, e.g. ${JSON.stringify(rejected)}`);
const empty = [...counts].filter(([, count]) => !count).map(([cls]) => cls);
if (empty.length) throw new Error(`No units for ${empty.join(", ")}`);
console.log(`${units.size} units satisfy the lands contract: ${[...counts].map(([cls, count]) => `${cls} ${count}`).join(", ")}.`);
