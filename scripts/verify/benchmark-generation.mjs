/** Run after npm run build -w @topostack/core. See docs/generation-performance.md. */
import { sha256Hex } from '../lib/hash.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const engineUrl = pathToFileURL(resolve(option('--engine', 'packages/core/dist/index.js'))).href;
const engine = await import(engineUrl);
const size = Number(option('--grid', '768'));
const roads = Number(option('--roads', '300'));
const runs = Number(option('--runs', '3'));
if (![size, roads, runs].every(Number.isInteger) || size < 64 || size > 2048 || roads < 0 || roads > 4000 || runs < 1 || runs > 20) throw new Error('Invalid grid, roads, or runs.');
const bounds = { west: -110.94, east: -110.65, south: 43.63, north: 43.84 };
const config = {
  ...engine.DEFAULT_PROJECT, widthMm: 3000, heightMm: 3000, materialThicknessMm: 3,
  location: { lat: 43.735, lon: -110.795, label: 'Grand Teton stress test', zoom: 11, bounds },
};
if (args.includes('--no-annotations')) Object.assign(config, { showAlignmentGuides: false, showAssemblyLabels: false, showElevationLabels: false, showNorthArrow: false, showScaleBar: false });
if (args.includes('--no-nesting')) config.optimizeMaterialUse = false;
const source = engine.createSyntheticSource(config, size);

// Public Terrarium tiles, cached outside the repository. Elevation is real;
// roads below are deterministic stress paths, not surveyed roads or OSM data.
if (args.includes('--teton')) {
  const zoom = 12, worldSize = 256 * 2 ** zoom;
  const worldX = lon => (lon + 180) / 360 * worldSize;
  const worldY = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * worldSize;
  const west = worldX(bounds.west) - 0.5, east = worldX(bounds.east) - 0.5;
  const north = worldY(bounds.north) - 0.5, south = worldY(bounds.south) - 0.5;
  const directory = join(tmpdir(), 'topostack-generation-tiles');
  await mkdir(directory, { recursive: true });
  const tiles = new Map();
  for (let y = Math.floor(north / 256); y <= Math.floor((south + 1) / 256); y++) {
    for (let x = Math.floor(west / 256); x <= Math.floor((east + 1) / 256); x++) {
      const path = join(directory, `${zoom}-${x}-${y}.png`);
      let bytes = await readFile(path).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (!bytes) {
        const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Terrain download: ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        PNG.sync.read(bytes);
        await writeFile(path, bytes);
      }
      tiles.set(`${x}/${y}`, PNG.sync.read(bytes));
    }
  }
  const sample = (x, y) => {
    const tile = tiles.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
    const offset = ((y % 256) * 256 + x % 256) * 4;
    return tile.data[offset] * 256 + tile.data[offset + 1] + tile.data[offset + 2] / 256 - 32768;
  };
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const x = west + (east - west) * column / (size - 1), y = north + (south - north) * row / (size - 1);
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const value = (sample(ix, iy) * (1 - fx) + sample(ix + 1, iy) * fx) * (1 - fy) +
      (sample(ix, iy + 1) * (1 - fx) + sample(ix + 1, iy + 1) * fx) * fy;
    source.elevation.values[row * size + column] = value;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  source.elevation.min = min; source.elevation.max = max;
  source.datasetVersion = 'grand-teton-terrarium-z12-benchmark';
}
source.markings = Array.from({ length: roads }, (_, road) => ({
  id: `stress-road-${road}`, kind: 'road', operation: 'engrave', transportationClass: 'local-road',
  points: Array.from({ length: 80 }, (_, i) => ({ x: -1500 + i * 3000 / 79, y: -1400 + road * 2800 / Math.max(1, roads - 1) + 30 * Math.sin(i / 8 + road) })),
}));
const normalize = geometry => { const copy = { ...geometry }; delete copy.generatedAt; return copy; };
const hash = value => sha256Hex(JSON.stringify(value));
const workers = Number(option('--workers', '0'));
if (!Number.isInteger(workers) || workers < 0 || workers > 4) throw new Error('Workers must be 0–4.');
const fallbackErrors = [];
const pool = workers ? await (await import('./generation-pool.mjs')).benchmarkPool(workers, engineUrl, error => { fallbackErrors.push(String(error)); }) : undefined;
const controller = new AbortController();
const results = [];
try {
for (let run = 0; run < runs; run++) {
  const generate = pool ? engine.createParallelGeometryGenerator() : engine.createGeometryGenerator?.() ?? engine.generateGeometry;
  for (const [kind, project] of [['cold', config], ['annotation-edit', { ...config, showElevationLabels: false }]]) {
    const stages = {};
    const started = performance.now();
    const geometry = await generate(project, source, { ...(pool ? { execute: batch => pool.run(batch, controller.signal) } : {}), onStage: (stage, ms) => { stages[stage] = ms; console.error(`${kind}: ${stage} ${ms.toFixed(1)} ms`); } });
    const ms = performance.now() - started;
    const result = { run, kind, ms, stages, layers: geometry.layers.length, markings: geometry.layers.reduce((n, l) => n + l.markings.length, 0), outputHash: hash(normalize(geometry)) };
    results.push(result);
    console.error(JSON.stringify(result));
  }
}
} finally { pool?.dispose(); }
const report = { workers, fallbackErrors, terrain: args.includes('--teton') ? 'Grand Teton Terrarium z12' : 'synthetic', bounds, widthMm: 3000, heightMm: 3000, materialThicknessMm: 3, verticalExaggeration: config.verticalExaggeration, annotations: !args.includes('--no-annotations'), nesting: config.optimizeMaterialUse, grid: size, roads, sourceHash: hash({ values: [...source.elevation.values], markings: source.markings }), node: process.version, results };
console.log(JSON.stringify(report, null, 2));
