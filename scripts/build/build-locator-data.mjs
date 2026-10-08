import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { locatorWindow } from "../../apps/generator/src/lib/site/lake-locator.ts";

// Builds apps/generator/src/lib/site/locator-data.json, the map behind the
// locator on each /lake/<slug> page: Natural Earth 1:50m land, lakes, country
// borders and state/province lines (public domain), kept only where some lake's
// locator window reaches, simplified and rounded to about 100 m.
//
//   node scripts/build/build-locator-data.mjs [--from <dir with the .geojson files>]
//
// Run after the lake directory reaches a new area. It downloads about 4 MB from
// the natural-earth-vector repository unless --from names a local copy.
const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson";
const FILES = { land: "ne_50m_land", lakes: "ne_50m_lakes", countries: "ne_50m_admin_0_boundary_lines_land", states: "ne_50m_admin_1_states_provinces_lines" };
/** Douglas–Peucker tolerance in degrees; a locator shows 400 km or more in 400 units, so this is under half a unit. */
const TOLERANCE = 0.01;
const directoryUrl = new URL("../../apps/generator/static/data/lake-depth-directory.json", import.meta.url);
const outputUrl = new URL("../../apps/generator/src/lib/site/locator-data.json", import.meta.url);

const { values: { from: localDir } } = parseArgs({ options: { from: { type: "string" } } });

async function load(name) {
  if (localDir) return JSON.parse(await readFile(join(localDir, `${name}.geojson`), "utf8"));
  const response = await fetch(`${SOURCE}/${name}.geojson`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

/** Every ring or line of a feature, as [lon, lat] points. */
function parts(geometry) {
  switch (geometry.type) {
    case "Polygon": return geometry.coordinates;
    case "MultiPolygon": return geometry.coordinates.flat();
    case "LineString": return [geometry.coordinates];
    case "MultiLineString": return geometry.coordinates;
    default: return [];
  }
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay);
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > worst) { worst = distance; index = i; }
    }
    if (worst > tolerance) { keep[index] = 1; stack.push([first, index], [index, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

const directory = JSON.parse(await readFile(directoryUrl, "utf8"));
const windows = directory.lakes.map((lake) => locatorWindow(lake.bounds));
const touches = (points) => {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lon, lat] of points) { west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat); }
  return windows.some(([w, s, e, n]) => east >= w && west <= e && north >= s && south <= n);
};

const layers = {};
for (const [layer, file] of Object.entries(FILES)) {
  const collection = await load(file);
  const closed = layer === "land" || layer === "lakes";
  layers[layer] = collection.features
    .flatMap((feature) => parts(feature.geometry))
    .filter(touches)
    .map((points) => simplify(points, TOLERANCE))
    .filter((points) => points.length >= (closed ? 4 : 2))
    .map((points) => points.flatMap(([lon, lat]) => [Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000]));
  console.log(`${layer}: ${layers[layer].length} parts, ${layers[layer].reduce((sum, part) => sum + part.length / 2, 0)} points`);
}
const data = { source: "Natural Earth 1:50m v5.1.2 (public domain), naturalearthdata.com", layers };
await writeFile(outputUrl, JSON.stringify(data) + "\n");
console.log(`Wrote ${outputUrl.pathname}`);
