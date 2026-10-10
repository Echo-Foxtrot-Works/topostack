/** Exercise the production loader and core with a local FAA archive and actual terrain. */
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createServer } from "vite";
import { sha256Hex } from "../lib/hash.mjs";
import { terrariumGrid } from "../lib/terrarium-grid.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const archivePath = resolve(option("--archive", ".topostack/faa/faa-aviation-2026-10-01-v2.pmtiles"));
const output = resolve(option("--output", ".topostack/airspace-acceptance/results.json"));
const grid = Number(option("--grid", "192")), runs = Number(option("--runs", "3"));
assert(Number.isInteger(grid) && grid >= 64 && grid <= 768 && Number.isInteger(runs) && runs >= 1 && runs <= 10, "Grid must be 64–768 and runs 1–10.");
const crops = [
  { name: "denver-class-b", bounds: { west: -105.372948, south: 39.318289, east: -103.967052, north: 40.397468 }, specialUse: false },
  { name: "las-vegas-mixed-sua", bounds: { west: -116.080118, south: 35.567951, east: -114.519882, north: 36.826987 }, specialUse: true },
  { name: "seattle-rugged-terrain", bounds: { west: -122.974948, south: 46.998417, east: -121.645052, north: 47.897739 }, specialUse: true },
];
const selected = option("--crop");
assert(!selected || crops.some((crop) => crop.name === selected), "Unknown crop.");
const bytes = await readFile(archivePath), digest = sha256Hex(bytes);
const http = createHttpServer((request, response) => {
  const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
  if (request.url !== "/v1/aviation.pmtiles" || !range) { response.writeHead(404).end(); return; }
  const start = Number(range[1]), end = Math.min(Number(range[2]), bytes.length - 1);
  if (start > end || end - start > 8_000_000) { response.writeHead(416).end(); return; }
  response.writeHead(206, { "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1, ETag: `"${digest}"` }).end(bytes.subarray(start, end + 1));
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
const vite = await createServer({ configFile: false, root: resolve("."), server: { middlewareMode: true, watch: null }, resolve: { alias: { "$lib": resolve("apps/generator/src/lib"), "@topostack/core": resolve("packages/core/src/index.ts") } }, logLevel: "error" });
const results = [];
try {
  const core = await vite.ssrLoadModule("/packages/core/src/index.ts");
  const { buildAirspaceStack } = await vite.ssrLoadModule("/packages/core/src/airspace.ts");
  core.registerAirspaceStage(buildAirspaceStack);
  const { configureApiBase } = await vite.ssrLoadModule("/apps/generator/src/lib/domain/api-base.ts");
  configureApiBase(`http://127.0.0.1:${http.address().port}`);
  const { loadAirspaceVolumes } = await vite.ssrLoadModule("/apps/generator/src/lib/domain/airspace-volumes.ts");
  const { clipPolygons } = await vite.ssrLoadModule("/packages/core/src/primitives/offset.ts");
  const { ringBounds, boundsOverlap, ringFitsInsidePolygon } = await vite.ssrLoadModule("/packages/core/src/primitives/geometry2d.ts");
  const { labelFootprint } = await vite.ssrLoadModule("/packages/core/src/annotate/label-placement.ts");
  const area = (polygons) => polygons.reduce((sum, polygon) => sum + Math.abs(core.signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(core.signedArea(hole)), 0), 0);
  for (const crop of crops.filter((crop) => !selected || crop.name === selected)) {
    const config = { ...core.DEFAULT_PROJECT, name: crop.name, widthMm: 300, heightMm: 300, verticalExaggeration: 10, optimizeMaterialUse: false, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false, showElevationLabels: false, showAssemblyLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false, location: { label: crop.name, lat: (crop.bounds.north + crop.bounds.south) / 2, lon: (crop.bounds.east + crop.bounds.west) / 2, zoom: 9, bounds: crop.bounds } };
    const terrain = await terrariumGrid(crop.bounds, grid, resolve(".topostack/faa/terrarium"));
    const loaded = await loadAirspaceVolumes(crop.bounds, 9, config, { classes: true, specialUse: crop.specialUse, classFilter: { B: true, C: true, D: true } });
    assert.equal(loaded.status, "available"); assert(loaded.volumes.length > 0, "Empty real-data acceptance crop.");
    assert(loaded.volumes.some((volume) => volume.aviationClass === "class-b"));
    if (crop.specialUse) assert(loaded.volumes.some((volume) => volume.aviationClass === "special-use"));
    const source = { schemaVersion: 1, elevation: terrain.elevation, bounds: crop.bounds, markings: [], vectorStatus: "available", lakeDataStatus: "available", sourceKind: "real", datasetVersion: digest, attribution: [{ name: "FAA / Terrarium acceptance fixture", url: "https://www.faa.gov/", license: "FAA public domain; terrain attribution in tile inputs" }], imagerySources: [], airspaceVolumes: loaded.volumes, airspaceStatus: loaded.status, airspaceCycle: loaded.cycle };
    for (const form of ["plates", "tiers", "volumes"]) {
      const project = { ...config, airspaceStack: { ...core.DEFAULT_AIRSPACE_STACK, form, classes: { B: true, C: true, D: true, specialUse: crop.specialUse } } };
      const samples = []; let geometry; let fingerprint;
      for (let run = 0; run <= runs; run += 1) {
        const start = performance.now(); geometry = core.generateGeometry(project, source);
        if (run) samples.push(performance.now() - start);
        const hash = sha256Hex(JSON.stringify({ ...geometry, generatedAt: undefined }));
        if (fingerprint) assert.equal(hash, fingerprint, "Generation is nondeterministic.");
        fingerprint = hash;
      }
      assert.equal(core.exportBlockReason(geometry, project), undefined);
      const stack = geometry.airspaceStack; assert(stack.levels.length > 0);
      const pieces = stack.levels.flatMap((level) => level.pieces.map((piece) => ({ level, piece, bounds: ringBounds(piece.polygons.flatMap((polygon) => polygon.outer)) })));
      assert.equal(new Set(pieces.map(({ piece }) => piece.id)).size, pieces.length);
      const sectorIds = new Set(stack.sectors.map((sector) => sector.id));
      for (const { level, piece } of pieces) {
        assert(piece.sectorIds.length && piece.sectorIds.every((id) => sectorIds.has(id)));
        for (const layer of geometry.layers.filter((layer) => (layer.index + 1) * project.materialThicknessMm > level.zMm + 1e-6)) assert(area(clipPolygons(piece.polygons, layer.polygons, "intersection")) < 0.01, "Acrylic intersects terrain.");
        for (const mark of piece.markings ?? []) if (mark.label) assert(piece.polygons.some((polygon) => ringFitsInsidePolygon(labelFootprint(mark.label, mark.points[0], mark.labelRotationRad ?? 0, mark.textStyle), polygon, 0)), "Label leaves material.");
      }
      for (let index = 0; index < pieces.length; index += 1) for (let next = index + 1; next < pieces.length; next += 1) {
        const left = pieces[index], right = pieces[next];
        if (right.level.zMm >= left.level.zMm + stack.thicknessMm - 1e-6) break;
        if (boundsOverlap(left.bounds, right.bounds)) assert(area(clipPolygons(left.piece.polygons, right.piece.polygons, "intersection")) < 0.01, "Acrylic pieces intersect.");
      }
      const ids = new Set(pieces.map(({ piece }) => piece.id));
      for (const column of stack.columns) for (const segment of column.segments) {
        assert(ids.has(segment.headPieceId) && (segment.throughPieceIds ?? []).every((id) => ids.has(id)));
        if (segment.seat.kind === "piece") assert(ids.has(segment.seat.pieceId));
      }
      const packageFiles = core.buildFabricationPackage(geometry, project).files;
      assert(packageFiles.some((file) => file.filename.includes("-airspace-")));
      samples.sort((a, b) => a - b);
      results.push({ crop: crop.name, form, sectors: loaded.volumes.length, levels: stack.levels.length, pieces: pieces.length, columns: stack.columns.length, medianMs: samples[Math.floor(samples.length / 2)], samplesMs: samples, geometrySha256: fingerprint, warnings: geometry.warnings, terrainInputs: terrain.inputs });
      console.log(`${crop.name} ${form}: ${pieces.length} pieces, ${samples[Math.floor(samples.length / 2)].toFixed(1)} ms; invariants passed.`);
    }
  }
} finally {
  await vite.close(); await new Promise((done) => http.close(done));
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ archive: relative(process.cwd(), archivePath), archiveSha256: digest, grid, measuredRuns: runs, results }, null, 2) + "\n");
console.log(`Saved ${output}`);
