/**
 * Run every feature the aviation builder wrote through the browser's contract
 * parsers, so the archive never carries a feature, or an optional property,
 * the studio would drop.
 *
 * Usage: node scripts/data-build/check-aviation-features.mjs <directory of <layer>.geojson>
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AIRSPACE_VOLUME_LAYERS, AIRSPACE_VOLUME_MAX_ZOOM, AVIATION_LAYERS, AVIATION_LAYER_GEOMETRY, parseAviationProperties } from "@topostack/data-contracts/aviation-tiles";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node scripts/data-build/check-aviation-features.mjs <directory>");

const expectedGeometry = { point: ["Point"], line: ["LineString"], polygon: ["Polygon", "MultiPolygon"] };
for (const layer of AVIATION_LAYERS) {
  const { features } = JSON.parse(await readFile(join(directory, `${layer}.geojson`), "utf8"));
  const kept = (feature) => {
    const parsed = parseAviationProperties(layer, feature.properties);
    return parsed !== undefined && Object.keys(parsed).length === Object.keys(feature.properties).length;
  };
  // Volumes must stop at the zoom the browser reads them at.
  const maxZoom = AIRSPACE_VOLUME_LAYERS.includes(layer) ? AIRSPACE_VOLUME_MAX_ZOOM : undefined;
  const deep = features.filter((feature) => feature.tippecanoe?.maxzoom !== maxZoom);
  if (deep.length) throw new Error(`${deep.length} ${layer} features have maxzoom ${deep[0].tippecanoe?.maxzoom}, expected ${maxZoom}`);
  const rejected = features.filter((feature) => !expectedGeometry[AVIATION_LAYER_GEOMETRY[layer]].includes(feature.geometry?.type) || !kept(feature));
  if (rejected.length) throw new Error(`${rejected.length} of ${features.length} ${layer} features break the aviation contract, e.g. ${JSON.stringify(rejected[0].properties)}`);
  console.log(`${layer}: ${features.length} features satisfy the contract.`);
}
