import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PMTiles } from "pmtiles";
import Pbf from "pbf";
import polygonClipping from "polygon-clipping";

const API_BASE = (process.env.VITE_MAP_API_URL ?? "https://topostack.app").replace(/\/$/, "");
const VECTOR_ARCHIVE_URL = "https://build.protomaps.com/20260905.pmtiles";
const LAKE_ARCHIVE_URL = `${API_BASE}/v1/lakes.pmtiles`;
const OUTPUT = new URL("../../apps/generator/src/lib/domain/sample-preview.generated.ts", import.meta.url);
const TILE_SIZE = 256;
const MAJOR_ROAD_DETAILS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const LOCAL_ROAD_DETAILS = new Set(["tertiary", "tertiary_link", "residential", "service", "unclassified", "road", "raceway", "driveway", "parking_aisle", "alley", "drive-through", "emergency_access"]);
const TRAIL_DETAILS = new Set(["pedestrian", "track", "path", "cycleway", "bridleway", "steps", "corridor", "sidewalk", "crossing"]);
const EXCLUDED_TRANSPORT_KINDS = new Set(["rail", "aerialway", "ferry", "pier", "aeroway"]);
const zoom = 11;
const config = { widthMm: 300, heightMm: 200, minimumFeatureMm: 0.8, lat: 42.9446, lon: -122.109 };

const worldSize = TILE_SIZE * 2 ** zoom;
const lonToWorldX = (lon) => ((lon + 180) / 360) * worldSize;
const latToWorldY = (lat) => ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2) * worldSize;
const worldXToLon = (x) => (x / worldSize) * 360 - 180;
const worldYToLat = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldSize))) * 180 / Math.PI;
const centerX = lonToWorldX(config.lon);
const centerY = latToWorldY(config.lat);
const bounds = {
  west: worldXToLon(centerX - 210),
  south: worldYToLat(centerY + 140),
  east: worldXToLon(centerX + 210),
  north: worldYToLat(centerY - 140),
};
const westX = lonToWorldX(bounds.west);
const eastX = lonToWorldX(bounds.east);
const northY = latToWorldY(bounds.north);
const southY = latToWorldY(bounds.south);
const tiles = [];
for (let y = Math.floor(northY / TILE_SIZE); y <= Math.floor((southY - 1e-6) / TILE_SIZE); y += 1) {
  for (let x = Math.floor(westX / TILE_SIZE); x <= Math.floor((eastX - 1e-6) / TILE_SIZE); x += 1) tiles.push({ x, y, z: zoom });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`${API_BASE}/studio`, { waitUntil: "domcontentloaded" });
const elevation = await page.evaluate(async ({ apiBase, tiles, westX, eastX, northY, southY, tileSize }) => {
  const decoded = await Promise.all(tiles.map(async (tile) => {
    const response = await fetch(`${apiBase}/v1/terrain/${tile.z}/${tile.x}/${tile.y}.png`);
    if (!response.ok) throw new Error(`Terrain request failed: ${response.status}`);
    return { tile, bitmap: await createImageBitmap(await response.blob()) };
  }));
  // Decode terrarium tiles to elevations at native resolution first, then
  // resample the elevation field. Scaling the PNGs directly interpolates the
  // R/G/B channels independently and blends tile edges into the empty canvas,
  // both of which fabricate elevations (see loadElevation in elevation-loader.ts).
  const width = 66;
  const height = 44;
  const minTileX = Math.min(...tiles.map((tile) => tile.x));
  const minTileY = Math.min(...tiles.map((tile) => tile.y));
  const mosaicWidth = (Math.max(...tiles.map((tile) => tile.x)) - minTileX + 1) * tileSize;
  const mosaicHeight = (Math.max(...tiles.map((tile) => tile.y)) - minTileY + 1) * tileSize;
  const canvas = new OffscreenCanvas(mosaicWidth, mosaicHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas context unavailable");
  context.imageSmoothingEnabled = false;
  for (const { tile, bitmap } of decoded) {
    context.drawImage(bitmap, (tile.x - minTileX) * tileSize, (tile.y - minTileY) * tileSize);
    bitmap.close();
  }
  const rgba = context.getImageData(0, 0, mosaicWidth, mosaicHeight).data;
  const mosaic = new Float32Array(mosaicWidth * mosaicHeight);
  for (let index = 0; index < mosaic.length; index += 1) {
    const pixel = index * 4;
    mosaic[index] = rgba[pixel] * 256 + rgba[pixel + 1] + rgba[pixel + 2] / 256 - 32768;
  }
  const sampleMosaic = (x, y) => mosaic[Math.max(0, Math.min(mosaicHeight - 1, y)) * mosaicWidth + Math.max(0, Math.min(mosaicWidth - 1, x))];
  const values = [];
  for (let row = 0; row < height; row += 1) {
    const worldY = northY + ((southY - northY) * row) / (height - 1) - minTileY * tileSize - 0.5;
    const y0 = Math.floor(worldY);
    const fy = worldY - y0;
    for (let column = 0; column < width; column += 1) {
      const worldX = westX + ((eastX - westX) * column) / (width - 1) - minTileX * tileSize - 0.5;
      const x0 = Math.floor(worldX);
      const fx = worldX - x0;
      const top = sampleMosaic(x0, y0) * (1 - fx) + sampleMosaic(x0 + 1, y0) * fx;
      const bottom = sampleMosaic(x0, y0 + 1) * (1 - fx) + sampleMosaic(x0 + 1, y0 + 1) * fx;
      values.push(Math.round(top * (1 - fy) + bottom * fy));
    }
  }
  return { width, height, values };
}, { apiBase: API_BASE, tiles, westX, eastX, northY, southY, tileSize: TILE_SIZE });
await browser.close();

function simplify(points, minimumDistance = 3) {
  if (points.length <= 2) return points;
  const output = [points[0]];
  let previous = points[0];
  for (const point of points.slice(1, -1)) {
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistance) {
      output.push(point);
      previous = point;
    }
  }
  output.push(points.at(-1));
  return output;
}

function classifyTransportation(properties) {
  const kind = typeof properties.kind === "string" ? properties.kind : "";
  const detail = typeof properties.kind_detail === "string" ? properties.kind_detail : "";
  if (EXCLUDED_TRANSPORT_KINDS.has(kind)) return undefined;
  if (kind === "path" || TRAIL_DETAILS.has(detail)) return "trail";
  if (kind === "highway" || kind === "major_road" || MAJOR_ROAD_DETAILS.has(detail)) return "major-road";
  if (kind === "minor_road" || LOCAL_ROAD_DETAILS.has(detail)) return "local-road";
  return undefined;
}

const archive = new PMTiles(VECTOR_ARCHIVE_URL);
const header = await archive.getHeader();
const vectorZoom = Math.max(header.minZoom, Math.min(header.maxZoom, zoom + 1));
const vectorScale = TILE_SIZE * 2 ** vectorZoom;
const vectorWestX = ((bounds.west + 180) / 360) * vectorScale;
const vectorEastX = ((bounds.east + 180) / 360) * vectorScale;
const vectorNorthY = ((1 - Math.asinh(Math.tan(bounds.north * Math.PI / 180)) / Math.PI) / 2) * vectorScale;
const vectorSouthY = ((1 - Math.asinh(Math.tan(bounds.south * Math.PI / 180)) / Math.PI) / 2) * vectorScale;
const markings = [];
const waterPolygons = [];
const projectPoint = (tileX, tileY, extent, point) => ({
  x: Number(((((tileX + point.x / extent) * TILE_SIZE - vectorWestX) / (vectorEastX - vectorWestX) - 0.5) * config.widthMm).toFixed(3)),
  y: Number(((((tileY + point.y / extent) * TILE_SIZE - vectorNorthY) / (vectorSouthY - vectorNorthY) - 0.5) * config.heightMm).toFixed(3)),
});
for (let y = Math.floor(vectorNorthY / TILE_SIZE); y <= Math.floor((vectorSouthY - 1e-6) / TILE_SIZE); y += 1) {
  for (let x = Math.floor(vectorWestX / TILE_SIZE); x <= Math.floor((vectorEastX - 1e-6) / TILE_SIZE); x += 1) {
    const response = await archive.getZxy(vectorZoom, x, y);
    if (!response) continue;
    const vectorTile = new VectorTile(new Pbf(new Uint8Array(response.data)));
    for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
      const lowered = layerName.toLowerCase();
      const isRoad = lowered.includes("road") || lowered.includes("transportation");
      const isWater = lowered === "water" || lowered.includes("waterway");
      if (!isRoad && !isWater) continue;
      for (let featureIndex = 0; featureIndex < layer.length && markings.length < 1800; featureIndex += 1) {
        const feature = layer.feature(featureIndex);
        if (feature.type !== 2 && !(isWater && feature.type === 3)) continue;
        const transportationClass = isRoad ? classifyTransportation(feature.properties) : undefined;
        if (isRoad && !transportationClass) continue;
        const label = isRoad ? [feature.properties.name, feature.properties.ref, feature.properties.shield_text].find((value) => typeof value === "string" && value.trim())?.trim() : undefined;
        const geometry = feature.loadGeometry();
        if (isWater && feature.type === 3) {
          classifyRings(geometry).forEach((polygon) => waterPolygons.push([polygon.map((ring) => ring.map((point) => {
            const projected = projectPoint(x, y, feature.extent, point);
            return [projected.x, projected.y];
          }))]));
          continue;
        }
        geometry.forEach((line, lineIndex) => {
          if (line.length < 2) return;
          const points = simplify(line.map((point) => projectPoint(x, y, feature.extent, point)));
          const xs = points.map((point) => point.x);
          const ys = points.map((point) => point.y);
          if (Math.max(...xs) < -config.widthMm / 2 || Math.min(...xs) > config.widthMm / 2 || Math.max(...ys) < -config.heightMm / 2 || Math.min(...ys) > config.heightMm / 2) return;
          markings.push({ id: `preview-${layerName}-${feature.id ?? featureIndex}-${x}-${y}-${lineIndex}`, kind: transportationClass === "trail" ? "trail" : isRoad ? "road" : "water", operation: isRoad ? "engrave" : "score", ...(transportationClass ? { transportationClass } : {}), ...(label ? { label } : {}), points });
        });
      }
    }
  }
}

if (waterPolygons.length) {
  const dissolved = polygonClipping.union(waterPolygons[0], ...waterPolygons.slice(1));
  dissolved.forEach((polygon, polygonIndex) => polygon.forEach((ring, ringIndex) => {
    const points = simplify(ring.map(([x, y]) => ({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) })), config.minimumFeatureMm * 0.18);
    if (points[0] && (points[0].x !== points.at(-1)?.x || points[0].y !== points.at(-1)?.y)) points.push({ ...points[0] });
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    if (points.length < 4 || Math.max(...xs) - Math.min(...xs) < config.minimumFeatureMm || Math.max(...ys) - Math.min(...ys) < config.minimumFeatureMm) return;
    markings.push({ id: `preview-water-area-${polygonIndex}-shore-${ringIndex}`, kind: "water", operation: "score", points });
  }));
}

/**
 * Lake outlines with the depth metadata the bundled preview needs to show a
 * carved basin. The archive is optional: until it is provisioned the fixture
 * simply captures flat water, exactly as it does today.
 */
const waterAreas = [];
try {
  const lakeArchive = new PMTiles(LAKE_ARCHIVE_URL);
  await lakeArchive.getHeader();
  const byLake = new Map();
  for (const tile of tiles) {
    const response = await lakeArchive.getZxy(tile.z, tile.x, tile.y);
    if (!response) continue;
    const vectorTile = new VectorTile(new Pbf(new Uint8Array(response.data)));
    for (const layer of Object.values(vectorTile.layers)) {
      for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
        const feature = layer.feature(featureIndex);
        if (feature.type !== 3) continue;
        const hylakId = Number(feature.properties.hylak_id);
        if (!Number.isFinite(hylakId)) continue;
        const entry = byLake.get(hylakId) ?? { properties: feature.properties, rings: [] };
        classifyRings(feature.loadGeometry()).forEach((polygon) => entry.rings.push(polygon.map((ring) => ring.map((point) => [
          Number(((((tile.x + point.x / feature.extent) * TILE_SIZE - westX) / (eastX - westX) - 0.5) * config.widthMm).toFixed(3)),
          Number(((((tile.y + point.y / feature.extent) * TILE_SIZE - northY) / (southY - northY) - 0.5) * config.heightMm).toFixed(3)),
        ]))));
        byLake.set(hylakId, entry);
      }
    }
  }
  for (const [hylakId, entry] of byLake) {
    if (!entry.rings.length) continue;
    const dissolved = polygonClipping.union(entry.rings[0], ...entry.rings.slice(1));
    dissolved.forEach(([outer, ...holes], index) => {
      if (!outer) return;
      const toPoints = (ring) => ring.map(([x, y]) => ({ x, y }));
      waterAreas.push({
        id: `preview-lake-${hylakId}-${index}`,
        kind: "lake",
        hylakId,
        polygon: { outer: toPoints(outer), holes: holes.map(toPoints) },
        ...(entry.properties.name ? { name: String(entry.properties.name) } : {}),
        ...(Number.isFinite(Number(entry.properties.dmax_m)) ? { maxDepthM: Number(entry.properties.dmax_m) } : {}),
        ...(Number.isFinite(Number(entry.properties.davg_m)) ? { meanDepthM: Number(entry.properties.davg_m) } : {}),
        ...(Number.isFinite(Number(entry.properties.lmax_m)) ? { lmaxM: Number(entry.properties.lmax_m) } : {}),
      });
    });
  }
} catch (error) {
  console.warn(`Lake bathymetry archive unavailable (${error.message}); capturing flat water.`);
}

const selectedMarkings = ["major-road", "local-road", "trail", "water"].flatMap((category) => markings
  .filter((marking) => category === "water" ? marking.kind === "water" : marking.transportationClass === category)
  .toSorted((left, right) => Number(Boolean(right.label)) - Number(Boolean(left.label)) || right.points.length - left.points.length)
  .slice(0, 1));
const elevationBytes = Buffer.allocUnsafe(elevation.values.length * 2);
elevation.values.forEach((value, index) => elevationBytes.writeInt16LE(value, index * 2));
const body = `// Generated by scripts/dev/capture-preview-fixture.mjs from the pinned TopoStack datasets.\n` +
`export const SAMPLE_PREVIEW = ${JSON.stringify({ ...elevation, values: elevationBytes.toString("base64"), bounds, markings: selectedMarkings, waterAreas })} as const;\n`;
await writeFile(OUTPUT, body);
console.log(`Wrote ${OUTPUT.pathname}: ${elevation.values.length} elevations, ${selectedMarkings.length} markings, ${waterAreas.length} lakes`);
