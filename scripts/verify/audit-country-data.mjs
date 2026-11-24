/** Sample the deploy's real non-lake terrain and basemap bytes near pinned sites. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { decodeTerrainPng, TERRAIN_NO_DATA, TERRAIN_STATUS_HEADER } from "@topostack/data-contracts/terrain-png";
import { PbfReader } from "pbf";
import { Compression, PMTiles, ResolvedValueCache, TileType } from "pmtiles";
import { classifyTransportation } from "../../apps/generator/src/lib/domain/transportation-classification.ts";
import { sha256Hex } from "../lib/hash.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_SITES = resolve(ROOT, "docs/reports/data/non-lake-country-sites.json");
const METERS_PER_WORLD = 2 * Math.PI * 6_378_137;
const MERCATOR_MAX_LAT = 85.0511;
const TILE_PIXELS = 256;
const DEFAULT_RADIUS_M = 2_500;
const MAX_TILES = 9;
const MAX_ARCHIVE_RANGE = 4 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_TERRAIN_BYTES = 2_000_000;
const MAX_VECTOR_FEATURES = 150_000;
const MAX_VECTOR_POINTS = 1_000_000;
const ARCHIVE_PATH = "/v1/osm.pmtiles";
const VECTOR_CLASSES = ["majorRoad", "localRoad", "trail", "rail", "waterway", "ocean", "building", "regionBoundary", "protectedArea"];
const PROTECTED_KINDS = new Set(["national_park", "nature_reserve", "protected_area", "military"]);

const toWorldX = (lon) => (lon + 180) / 360;
const toWorldY = (lat) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
const toLon = (x) => x * 360 - 180;
const toLat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
const roundM = (meters) => Math.round(meters * 100) / 100;

function siteCrop({ lat, lon, radiusM = DEFAULT_RADIUS_M }) {
  const worldRadius = radiusM / (METERS_PER_WORLD * Math.cos(lat * Math.PI / 180));
  const x = toWorldX(lon), y = toWorldY(lat);
  return { radiusM, worldRadius, west: x - worldRadius, east: x + worldRadius, north: y - worldRadius, south: y + worldRadius };
}

function cropTiles(crop, zoom) {
  const size = 2 ** zoom;
  const west = crop.west * size, east = crop.east * size;
  const north = Math.max(0, crop.north * size), south = Math.min(size, crop.south * size);
  const cols = Math.ceil(east) - Math.floor(west), rows = Math.ceil(south) - Math.floor(north);
  if (cols * rows > MAX_TILES) throw new Error(`Crop exceeds the ${MAX_TILES}-tile audit bound at zoom ${zoom}`);
  const tiles = [];
  for (let y = Math.floor(north); y < Math.ceil(south); y += 1) {
    for (let worldX = Math.floor(west); worldX < Math.ceil(east); worldX += 1) {
      tiles.push({
        z: zoom, x: (worldX % size + size) % size, y,
        box: { minX: Math.max(0, west - worldX), maxX: Math.min(1, east - worldX), minY: Math.max(0, north - y), maxY: Math.min(1, south - y) },
      });
    }
  }
  return tiles;
}

function tileId({ z, x, y }) { return `${z}/${x}/${y}`; }

class ProbeError extends Error {
  constructor(kind, message, httpStatus, retryAfter) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.retryAfter = retryAfter;
  }
}

function failure(error) {
  if (error instanceof ProbeError) return { status: error.kind, httpStatus: error.httpStatus, error: error.message };
  return { status: "unavailable", error: error instanceof Error ? error.message : String(error) };
}

async function readBounded(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new ProbeError("unavailable", `Response exceeds ${limit} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProbeError("unavailable", "Response has no body");
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(parts, size);
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ProbeError("unavailable", `Response exceeds ${limit} bytes`);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function makeFetcher(api, origin, paceMs) {
  let nextTerrainRequest = 0;
  return async function get(path, { headers = {}, limit, expected = 200, signal, terrain = false }) {
    for (let attempt = 0; ; attempt += 1) {
      if (terrain) {
        const slot = Math.max(nextTerrainRequest, Date.now());
        nextTerrainRequest = slot + paceMs;
        if (slot > Date.now()) await delay(slot - Date.now());
      }
      const timeout = AbortSignal.timeout(15_000);
      try {
        const response = await fetch(new URL(path, api), {
          headers: { ...(origin ? { origin } : {}), ...headers },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          redirect: "error",
        });
        if (response.status !== expected) {
          await response.body?.cancel();
          const noData = terrain && response.status === 404 && response.headers.get(TERRAIN_STATUS_HEADER) === TERRAIN_NO_DATA;
          const kind = noData ? TERRAIN_NO_DATA : response.status === 404 ? "missing" : "unavailable";
          const retryAfter = Number(response.headers.get("retry-after")) || 0;
          throw new ProbeError(kind, `HTTP ${response.status}${noData ? " (no elevation data)" : ""} for ${path}`, response.status, retryAfter);
        }
        return { headers: response.headers, bytes: await readBounded(response, limit) };
      } catch (error) {
        const status = error.httpStatus;
        const retryable = !(error instanceof ProbeError) || status === 408 || status === 429 || status >= 500;
        if (attempt || !retryable || signal?.aborted) {
          if (error instanceof ProbeError) throw error;
          throw new ProbeError("unavailable", `${timeout.aborted ? "Request timed out" : (error.cause?.code ?? error.message)} for ${path}`);
        }
        const coolOff = Math.max(500, Math.min(error.retryAfter || 0, 60) * 1_000);
        if (terrain && status === 429) nextTerrainRequest = Math.max(nextTerrainRequest, Date.now() + coolOff);
        await delay(coolOff);
      }
    }
  };
}

function toArrayBuffer(bytes) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }

async function decompress(data, compression) {
  if (compression === Compression.None || compression === Compression.Unknown) return data;
  if (compression === Compression.Gzip) return toArrayBuffer(gunzipSync(data, { maxOutputLength: MAX_DECOMPRESSED_BYTES }));
  throw new Error(`Unsupported PMTiles compression ${compression}`);
}

function archiveReader(get, url) {
  let release, archiveSize;
  const source = {
    getKey: () => url,
    async getBytes(offset, length, signal) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > MAX_ARCHIVE_RANGE) {
        throw new Error("PMTiles requested a range outside safety bounds");
      }
      const end = offset + length - 1;
      const response = await get(ARCHIVE_PATH, { headers: { range: `bytes=${offset}-${end}`, "accept-encoding": "identity" }, limit: length, expected: 206, signal });
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
      const size = Number(range?.[3]);
      const expectedEnd = Math.min(end, size - 1);
      if (!range || !Number.isSafeInteger(size) || (archiveSize && archiveSize !== size) || Number(range[1]) !== offset || Number(range[2]) !== expectedEnd || response.bytes.length !== expectedEnd - offset + 1) {
        throw new Error("PMTiles archive returned an invalid Content-Range");
      }
      const etag = response.headers.get("etag");
      if (!/^"[^"]+"$/.test(etag ?? "")) throw new Error("PMTiles archive did not return a strong ETag");
      if (release && etag !== release) throw new Error("PMTiles archive changed during the audit");
      release = etag;
      archiveSize = size;
      return { data: toArrayBuffer(response.bytes), etag };
    },
  };
  return new PMTiles(source, new ResolvedValueCache(256, true, decompress), decompress);
}

function terrainTileSamples(values, { minX, maxX, minY, maxY }, heights = []) {
  let samplePixels = 0, validPixels = 0, positivePixels = 0, minM = Infinity, maxM = -Infinity;
  for (let row = Math.ceil(minY * TILE_PIXELS - 0.5); row < Math.ceil(maxY * TILE_PIXELS - 0.5); row += 1) {
    for (let col = Math.ceil(minX * TILE_PIXELS - 0.5); col < Math.ceil(maxX * TILE_PIXELS - 0.5); col += 1) {
      samplePixels += 1;
      const m = values[row * TILE_PIXELS + col];
      if (!Number.isFinite(m)) continue;
      heights.push(m);
      validPixels += 1;
      if (m > 0) positivePixels += 1;
      minM = Math.min(minM, m);
      maxM = Math.max(maxM, m);
    }
  }
  return { samplePixels, validPixels, positivePixels, minM: validPixels ? minM : null, maxM: validPixels ? maxM : null };
}

function summarizeTiles(tiles, emptyStatus) {
  const decoded = tiles.filter(({ status }) => status === "available").length;
  const unavailable = tiles.some(({ status }) => status === "unavailable");
  if (tiles.length && tiles.every(({ status }) => status === TERRAIN_NO_DATA)) return "no-valid-data";
  if (!decoded) return unavailable ? "unavailable" : "missing";
  if (decoded !== tiles.length) return "partial";
  return emptyStatus ?? "available";
}

// Pool the pixels across seams so a small tile intersection carries its actual weight.
function elevationPercentiles(heights) {
  const ordered = Float32Array.from(heights).sort();
  const at = (fraction) => ordered.length ? roundM(ordered[Math.floor((ordered.length - 1) * fraction)]) : null;
  return { p05M: at(0.05), p50M: at(0.50), p95M: at(0.95) };
}

async function sampleTerrain(crop, get) {
  // Fit approximately one tile width, reading at most four neighbors at ordinary latitudes.
  const zoom = Math.min(15, Math.max(0, Math.floor(Math.log2(1 / (2 * crop.worldRadius)))));
  const tiles = [];
  const heights = [];
  for (const tile of cropTiles(crop, zoom)) {
    const key = tileId(tile);
    try {
      const { headers, bytes } = await get(`/v1/terrain/${key}.png`, { headers: { accept: "image/png" }, limit: MAX_TERRAIN_BYTES, terrain: true });
      const dataset = headers.get("x-topostack-dataset");
      if (!headers.get("content-type")?.includes("image/png") || !dataset) throw new Error("Terrain response lacks elevation tile metadata");
      const stats = terrainTileSamples(decodeTerrainPng(bytes, true), tile.box, heights);
      tiles.push({ tile: key, status: "available", sha256: sha256Hex(bytes), dataset, cache: headers.get("x-topostack-cache"), imagerySources: headers.get("x-topostack-imagery-sources"), ...stats });
    } catch (error) {
      tiles.push({ tile: key, ...failure(error) });
    }
  }
  const totals = { samplePixels: 0, validPixels: 0, positivePixels: 0 };
  let min = Infinity, max = -Infinity;
  for (const tile of tiles) {
    if (tile.status !== "available") continue;
    for (const key of Object.keys(totals)) totals[key] += tile[key];
    if (tile.validPixels) { min = Math.min(min, tile.minM); max = Math.max(max, tile.maxM); }
  }
  return { status: summarizeTiles(tiles, totals.validPixels ? undefined : "no-valid-data"), zoom, ...totals, ...elevationPercentiles(heights),
    minM: totals.validPixels ? roundM(min) : null, maxM: totals.validPixels ? roundM(max) : null,
    reliefM: totals.validPixels ? roundM(max - min) : null,
    variation: totals.validPixels ? (max === min ? "flat" : "variable") : null, tiles };
}

// Liang–Barsky segment clipping, with positive length required inside the crop.
function segmentIntersectsBox(a, b, box) {
  let start = 0, end = 1;
  for (const [distance, delta] of [[a.x - box.minX, b.x - a.x], [box.maxX - a.x, a.x - b.x], [a.y - box.minY, b.y - a.y], [box.maxY - a.y, a.y - b.y]]) {
    if (delta === 0 && distance < 0) return false;
    if (delta > 0) start = Math.max(start, -distance / delta);
    if (delta < 0) end = Math.min(end, -distance / delta);
    if (end <= start) return false;
  }
  if (a.x === b.x && a.y === b.y) return false;
  const midX = a.x + (b.x - a.x) * (start + end) / 2;
  const midY = a.y + (b.y - a.y) * (start + end) / 2;
  return midX > box.minX && midX < box.maxX && midY > box.minY && midY < box.maxY;
}

function lineIntersectsBox(line, box) {
  return line.some((point, i) => i > 0 && segmentIntersectsBox(line[i - 1], point, box));
}

function ringContains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

function polygonIntersectsBox([outer, ...holes], box) {
  if (!outer) return false;
  if ([outer, ...holes].some((ring) => lineIntersectsBox(ring, box))) return true;
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  return ringContains(outer, center) && !holes.some((hole) => ringContains(hole, center));
}

function featureClass(layer, { type, properties }) {
  if (type === 2) {
    if (layer === "roads" || layer === "transportation") {
      const transport = classifyTransportation(properties);
      return { "major-road": "majorRoad", "local-road": "localRoad", trail: "trail", rail: "rail", "covered-rail": "rail" }[transport];
    }
    if (layer === "water" || layer === "waterway" || layer === "waterways") return "waterway";
    if ((layer === "boundaries" || layer === "boundary") && properties.kind === "region") return "regionBoundary";
  }
  if (type !== 3) return undefined;
  if (layer === "water" && properties.kind === "ocean") return "ocean";
  if (layer === "buildings" && properties.kind === "building") return "building";
  if (layer === "landuse" && PROTECTED_KINDS.has(properties.kind)) return "protectedArea";
  return undefined;
}

function blankCounts() { return Object.fromEntries(VECTOR_CLASSES.map((kind) => [kind, 0])); }

function countVectors(data, { box }) {
  const tile = new VectorTile(new PbfReader(new Uint8Array(data)));
  const counts = blankCounts();
  let points = 0, features = 0;
  for (const name of ["roads", "transportation", "boundaries", "boundary", "water", "waterway", "waterways", "buildings", "landuse"]) {
    const layer = tile.layers[name];
    if (!layer) continue;
    features += layer.length;
    if (features > MAX_VECTOR_FEATURES) throw new Error("Vector tile exceeds audit feature limit");
    const local = Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value * layer.extent]));
    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      const kind = featureClass(name, feature);
      if (!kind) continue;
      const geometry = feature.loadGeometry();
      points += geometry.reduce((total, part) => total + part.length, 0);
      if (points > MAX_VECTOR_POINTS) throw new Error("Vector tile exceeds audit geometry limit");
      counts[kind] += feature.type === 3
        ? classifyRings(geometry).filter((polygon) => polygonIntersectsBox(polygon, local)).length
        : geometry.filter((line) => lineIntersectsBox(line, local)).length;
    }
  }
  return counts;
}

async function sampleVectors(crop, archive, header) {
  const counts = blankCounts();
  const zoom = Math.min(header.maxZoom, Math.max(header.minZoom, Math.floor(Math.log2(1 / crop.worldRadius))));
  const tiles = [];
  for (const tile of cropTiles(crop, zoom)) {
    const key = tileId(tile);
    try {
      const result = await archive.getZxy(tile.z, tile.x, tile.y);
      if (!result) { tiles.push({ tile: key, status: "missing" }); continue; }
      const tileCounts = countVectors(result.data, tile);
      for (const kind of VECTOR_CLASSES) counts[kind] += tileCounts[kind];
      tiles.push({ tile: key, status: "available", mvtSha256: sha256Hex(new Uint8Array(result.data)), counts: tileCounts });
    } catch (error) {
      tiles.push({ tile: key, ...failure(error) });
    }
  }
  return { status: summarizeTiles(tiles, Object.values(counts).some(Boolean) ? undefined : "no-features"), zoom, counts, tiles };
}

function validatedSite(site, index) {
  const radius = site?.radiusM ?? DEFAULT_RADIUS_M;
  if (typeof site?.code !== "string" || !/^[A-Z]{2}$/.test(site.code) || typeof site.name !== "string" || !site.name.trim() ||
    typeof site.site !== "string" || !site.site.trim() || !Number.isFinite(site.lat) || Math.abs(site.lat) > 90 ||
    !Number.isFinite(site.lon) || Math.abs(site.lon) > 180 || !Number.isFinite(radius) || radius < 10 || radius > 5_000) {
    throw new Error(`Invalid code, names, coordinates or radiusM at roster entry ${index + 1}`);
  }
  return site;
}

function webOrigin(value, label) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an HTTP(S) origin`);
  }
  return url.origin;
}

function positiveInteger(value, low, high, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < low || number > high) throw new Error(`${label} must be an integer from ${low} through ${high}`);
  return number;
}

async function selectSites(path, codeFilter, groupFilter) {
  const bytes = await readFile(path);
  const all = JSON.parse(bytes);
  if (!Array.isArray(all) || !all.length || all.length > 2_000) throw new Error("Sites file must contain a roster of 1–2,000 entries");
  const codes = codeFilter ? new Set(codeFilter.split(",").map((code) => code.trim().toUpperCase())) : null;
  const group = /^(\d+)\/(\d+)$/.exec(groupFilter);
  if (!group) throw new Error("--group must be written as INDEX/COUNT");
  const groups = positiveInteger(group[2], 1, all.length, "Group count");
  const index = positiveInteger(group[1], 1, groups, "Group index");
  const sites = all.map(validatedSite);
  if (codes) for (const code of codes) if (!sites.some((site) => site.code === code)) throw new Error(`Country code ${code} is absent from the roster`);
  const selected = sites.filter((site, i) => i % groups === index - 1 && (!codes || codes.has(site.code)));
  if (!selected.length) throw new Error("No audit sites match the filters");
  return { rosterSha256: sha256Hex(bytes), rosterCount: all.length, selected };
}

async function probeManifest(get) {
  try {
    const { bytes } = await get("/v1/manifest", { headers: { accept: "application/json" }, limit: 128 * 1024 });
    const manifest = JSON.parse(bytes);
    if (manifest?.schemaVersion !== 1 || typeof manifest.datasetVersion !== "string" || !Array.isArray(manifest.sources)) throw new Error("Unrecognized TopoStack data manifest");
    const sources = manifest.sources.filter((source) =>
      !source.archive?.startsWith("/v1/bathymetry/") && !["HydroLAKES v1.0", "GLOBathy"].includes(source.name));
    return { status: "available", sha256: sha256Hex(bytes), datasetVersion: manifest.datasetVersion, coverage: manifest.coverage, sources };
  } catch (error) { return failure(error); }
}

async function probeArchive(archive, api) {
  const url = new URL(ARCHIVE_PATH, api).href;
  try {
    const header = await archive.getHeader();
    if (header.tileType !== TileType.Mvt) throw new Error(`Expected PMTiles MVT archive, received tile type ${header.tileType}`);
    if (header.minZoom < 0 || header.maxZoom > 26 || header.minZoom > header.maxZoom) throw new Error("Archive has an invalid zoom range");
    return { header, evidence: { status: "available", url, etag: header.etag, minZoom: header.minZoom, maxZoom: header.maxZoom } };
  } catch (error) { return { evidence: { url, ...failure(error) } }; }
}

async function visitSite(site, get, archive, metadata) {
  if (Math.abs(site.lat) > MERCATOR_MAX_LAT) {
    return { ...site, crop: null, terrain: { status: "outside-projection" }, vectors: { status: "outside-projection" } };
  }
  const crop = siteCrop(site);
  const extent = { radiusM: crop.radiusM, west: toLon(crop.west), east: toLon(crop.east), south: toLat(Math.min(1, crop.south)), north: toLat(Math.max(0, crop.north)) };
  const [terrain, vectors] = await Promise.all([
    sampleTerrain(crop, get),
    metadata.header ? sampleVectors(crop, archive, metadata.header) : { status: metadata.evidence.status, counts: null, tiles: [], error: metadata.evidence.error },
  ]);
  return { ...site, crop: extent, terrain, vectors };
}

async function run() {
  const { values } = parseArgs({ options: {
    api: { type: "string", default: "https://topostack.app" },
    origin: { type: "string" },
    sites: { type: "string", default: DEFAULT_SITES },
    codes: { type: "string" },
    group: { type: "string", default: "1/1" },
    concurrency: { type: "string", default: "4" },
    "pace-ms": { type: "string", default: "350" },
    output: { type: "string", default: ".topostack/non-lake-data-audit/results.json" },
    help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("node scripts/verify/audit-country-data.mjs [--api ORIGIN] [--origin ORIGIN] [--sites ROSTER.json] [--codes US,CA,JP] [--group INDEX/COUNT] [--concurrency 4] [--pace-ms 350] [--output OUTPUT.json]");
    return;
  }
  const startedAt = new Date().toISOString();
  const api = webOrigin(values.api, "--api");
  const origin = values.origin ? webOrigin(values.origin, "--origin") : null;
  const concurrency = positiveInteger(values.concurrency, 1, 8, "--concurrency");
  const paceMs = positiveInteger(values["pace-ms"], 0, 10_000, "--pace-ms");
  const output = resolve(values.output);
  const { rosterSha256, rosterCount, selected } = await selectSites(values.sites, values.codes, values.group);
  const get = makeFetcher(api, origin, paceMs);
  const archive = archiveReader(get, new URL(ARCHIVE_PATH, api).href);
  const [manifest, archiveMetadata] = await Promise.all([probeManifest(get), probeArchive(archive, api)]);
  const results = Array(selected.length);
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (next < selected.length) {
      const index = next++;
      const site = selected[index];
      const result = await visitSite(site, get, archive, archiveMetadata);
      results[index] = result;
      completed += 1;
      console.log(`[${completed}/${selected.length}] ${site.code} ${site.site} – terrain ${result.terrain.status}, vectors ${result.vectors.status}`);
    }
  }));
  const audit = {
    schemaVersion: 1, startedAt, completedAt: new Date().toISOString(), api, origin,
    source: { manifest, vectorArchive: archiveMetadata.evidence },
    coverage: { rosterSha256, rosterCount, selectedCount: selected.length, codes: values.codes ?? null, group: values.group, paceMs, defaultRadiusM: DEFAULT_RADIUS_M },
    sites: results,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(audit, null, 2) + "\n");
  console.log(`Saved ${results.length} samples to ${output}`);
}

if (import.meta.main) await run();

export { countVectors, cropTiles, elevationPercentiles, polygonIntersectsBox, segmentIntersectsBox, siteCrop, summarizeTiles, terrainTileSamples };
