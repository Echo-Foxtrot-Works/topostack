/**
 * Build the lake bathymetry archive.
 *
 * GLOBathy publishes 16.7 GB of per-lake TIFFs, but its own generation script
 * shows those rasters are a derived product of exactly two inputs: a HydroLAKES
 * polygon and a maximum depth, combined by a proximity-to-shore pass and
 * `D = l * Dmax / L`. TopoStack reproduces that in the browser at whatever
 * resolution the model needs, so all this archive has to carry is the polygon
 * and a handful of numbers per lake.
 *
 * Run once per dataset refresh; the output is uploaded by provision-lake-data.mjs.
 *
 *   curl -LO https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip
 *   curl -L -o globathy.zip https://ndownloader.figshare.com/files/28919991
 *   unzip -q HydroLAKES_polys_v10_shp.zip && unzip -q globathy.zip
 *   node scripts/provision/build-lake-data.mjs \
 *     --lakes=HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp \
 *     --globathy="GLOBathy_basic_parameters/GLOBathy_basic_parameters(ALL_LAKES).csv" \
 *     --out=lakes.pmtiles
 *
 * Requires `tippecanoe` and `pmtiles` on PATH (brew install tippecanoe pmtiles). The shapefile is read
 * in-process, so GDAL is not needed.
 *
 * Sources:
 *   HydroLAKES v1.0 - CC BY 4.0 - Messager et al. (2016) https://www.hydrosheds.org/products/hydrolakes
 *   GLOBathy        - CC0 1.0   - Khazaei et al. (2022)  https://doi.org/10.1038/s41597-022-01132-9
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { open as openShapefile } from "shapefile";
import { maximumInscribedRadiusM, toLocalMeters } from "../lib/inscribed-circle.mjs";
import { assertExecutable, writeTilesetArchive } from "../lib/lake-archive.mjs";

const MAX_ZOOM = 12;
// HydroLAKES starts at 0.1 km2. Below roughly a hectare a lake is under a
// millimetre on a 300 mm model, so it cannot show a basin at any sheet count.
const MIN_LAKE_AREA_KM2 = 0.05;

const flags = Object.fromEntries(process.argv.slice(2)
  .filter((argument) => argument.startsWith("--"))
  .map((argument) => {
    const separator = argument.indexOf("=");
    return separator === -1 ? [argument.slice(2), "true"] : [argument.slice(2, separator), argument.slice(separator + 1)];
  }));

const lakesPath = flags.lakes;
const globathyPath = flags.globathy;
const outputPath = flags.out ?? "lakes.pmtiles";
if (!lakesPath || !globathyPath) {
  throw new Error("Usage: node scripts/provision/build-lake-data.mjs --lakes=<HydroLAKES_polys_v10.shp> --globathy=<GLOBathy_basic_parameters(ALL_LAKES).csv> [--out=lakes.pmtiles]");
}

/** Split one CSV line, honouring the quoted lake names GLOBathy ships. */
function splitCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else current += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { fields.push(current); current = ""; }
    else current += character;
  }
  fields.push(current);
  return fields;
}

/**
 * `Dmax_use_m` per lake, keyed by HydroLAKES id.
 *
 * GLOBathy documents this column as the "suggested/best" estimate, and it
 * prefers a surveyed depth wherever one exists - Crater Lake reads 594 m,
 * Tahoe 501 m, Baikal 1642 m - falling back to its random forest only for
 * waterbodies nobody has sounded.
 */
async function readMaximumDepths(path) {
  const depths = new Map();
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let idColumn = -1;
  let depthColumn = -1;
  for await (const line of reader) {
    if (!line) continue;
    const fields = splitCsvLine(line);
    if (idColumn === -1) {
      idColumn = fields.indexOf("Hylak_id");
      depthColumn = fields.indexOf("Dmax_use_m");
      if (idColumn === -1 || depthColumn === -1) throw new Error("GLOBathy CSV is missing Hylak_id or Dmax_use_m.");
      continue;
    }
    const id = Number(fields[idColumn]);
    const depth = Number(fields[depthColumn]);
    if (Number.isFinite(id) && Number.isFinite(depth) && depth > 0) depths.set(id, depth);
  }
  return depths;
}

// The CSV pass takes minutes. Check both build tools before reading it.
assertExecutable(process.env.PMTILES_BIN ?? "pmtiles", { install: "brew install pmtiles" });
assertExecutable("tippecanoe", { install: "brew install tippecanoe" });

console.log("Reading GLOBathy maximum depths…");
const depths = await readMaximumDepths(globathyPath);
console.log(`Loaded ${depths.size.toLocaleString()} maximum-depth estimates.`);

console.log("Streaming lake polygons into tippecanoe…");

const { kept, skipped } = await writeTilesetArchive({
  outputPath,
  args: [
    "--layer", "lakes",
    "--minimum-zoom", "0", "--maximum-zoom", String(MAX_ZOOM),
    // Low zooms cannot carry every pond on Earth. Drop the physically smallest
    // first, matching the client's minimum-fabricable-area filter, instead of
    // deleting arbitrary lakes merely because their region is water-dense.
    "--drop-smallest-as-needed", "--no-tiny-polygon-reduction", "--simplification", "4",
  ],
  emit: async (write) => {
    let kept = 0;
    let skipped = 0;
    const source = await openShapefile(lakesPath, lakesPath.replace(/\.shp$/i, ".dbf"));
    while (true) {
      const { done, value: feature } = await source.read();
      if (done) break;
      const properties = feature?.properties ?? {};
      const hylakId = Number(properties.Hylak_id);
      const maxDepthM = depths.get(hylakId);
      const areaKm2 = Number(properties.Lake_area);
      if (!Number.isFinite(hylakId) || !(areaKm2 >= MIN_LAKE_AREA_KM2)) { skipped += 1; continue; }

      const geometry = feature.geometry;
      const polygons = geometry?.type === "MultiPolygon" ? geometry.coordinates : geometry?.type === "Polygon" ? [geometry.coordinates] : [];
      if (!polygons.length) { skipped += 1; continue; }

      // A multipolygon lake's basin belongs to its largest part; L is measured there.
      let originLon = 0;
      let originLat = 0;
      let widest = null;
      let widestSpan = -1;
      for (const rings of polygons) {
        const outer = rings[0];
        if (!outer?.length) continue;
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lon, lat] of outer) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        const span = (maxLon - minLon) * (maxLat - minLat);
        if (span > widestSpan) {
          widestSpan = span;
          widest = rings;
          originLon = (maxLon + minLon) / 2;
          originLat = (maxLat + minLat) / 2;
        }
      }
      if (!widest) { skipped += 1; continue; }
      const lmaxM = maximumInscribedRadiusM(toLocalMeters(widest, originLat, originLon));

      const meanDepthM = Number(properties.Depth_avg);
      const elevationM = Number(properties.Elevation);
      const name = typeof properties.Lake_name === "string" ? properties.Lake_name.trim() : "";
      await write({
        type: "Feature",
        geometry,
        properties: {
          hylak_id: hylakId,
          ...(maxDepthM ? { dmax_m: Number(maxDepthM.toFixed(1)) } : {}),
          ...(lmaxM > 0 ? { lmax_m: Number(lmaxM.toFixed(1)) } : {}),
          area_km2: Number(areaKm2.toFixed(4)),
          ...(Number.isFinite(meanDepthM) && meanDepthM > 0 ? { davg_m: Number(meanDepthM.toFixed(2)) } : {}),
          ...(Number.isFinite(elevationM) ? { elev_m: Math.round(elevationM) } : {}),
          // HydroLAKES only names waterbodies of 500 km2 and up, so most lakes
          // reach the client unnamed and the UI falls back to the OSM name.
          ...(name ? { name } : {}),
        },
      });
      kept += 1;
      if (kept % 100000 === 0) console.log(`  ${kept.toLocaleString()} lakes written…`);
    }
    return { kept, skipped };
  },
});

// A lake with no GLOBathy depth is kept - its outline still carries area, Lmax
// and HydroLAKES' mean depth. Only unusable records are dropped.
console.log(`Wrote ${outputPath}: ${kept.toLocaleString()} lakes (depth estimates where GLOBathy has one), ${skipped.toLocaleString()} dropped (below ${MIN_LAKE_AREA_KM2} km2, missing Hylak_id, or degenerate geometry).`);
console.log(`Development pin capture: node scripts/provision/provision-lake-data.mjs ${outputPath} --provision --skip-digest-check`);
console.log("Record the printed SHA-256, then pass --expected-sha256=<hex> on every subsequent run and whenever --prod is used.");
