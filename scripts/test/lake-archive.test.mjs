import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertExecutable, writeTilesetArchive } from "../lib/lake-archive.mjs";

async function withTemporaryDirectory(body) {
  const directory = await mkdtemp(join(tmpdir(), "topostack-lake-archive-"));
  try { return await body(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Stands in for tippecanoe: `--output <path>` plus whatever the script does with stdin. */
async function fakeTippecanoe(directory, body) {
  const command = join(directory, "fake-tippecanoe");
  await writeFile(command, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return command;
}

const missing = async (path) => { await assert.rejects(access(path), { code: "ENOENT" }); };
const feature = (id) => ({ type: "Feature", properties: { hylak_id: id } });

test("a missing build tool is refused before any input is read", () => {
  assert.throws(() => assertExecutable("topostack-tippecanoe-does-not-exist", { install: "brew install tippecanoe" }),
    /topostack-tippecanoe-does-not-exist is required but could not be started \(ENOENT\)\. Install it with: brew install tippecanoe/);
  // Non-zero `--version` exits differ across tippecanoe builds and are not a failure.
  assertExecutable("sh", { args: ["-c", "exit 3"] });
});

test("a completed run replaces the previous archive and leaves no part file", () => withTemporaryDirectory(async (directory) => {
  const outputPath = join(directory, "lakes.pmtiles");
  await writeFile(outputPath, "previous good archive");
  const command = await fakeTippecanoe(directory, 'cat > "$2"');
  const counts = await writeTilesetArchive({
    outputPath, command, args: ["--layer", "lakes"],
    verify: async (path) => assert.match(path, /\.part\.pmtiles$/),
    emit: async (write) => {
      await write(feature(1));
      await write(feature(2));
      return { kept: 2, skipped: 0 };
    },
  });
  assert.deepEqual(counts, { kept: 2, skipped: 0 });
  assert.deepEqual((await readFile(outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line).properties.hylak_id), [1, 2]);
  assert.deepEqual((await readdir(directory)).filter(name => name.includes(".part")), []);
}));

test("a failed run keeps the previous archive instead of a partial one", () => withTemporaryDirectory(async (directory) => {
  const outputPath = join(directory, "lakes.pmtiles");
  await writeFile(outputPath, "previous good archive");
  // Writes a partial archive, then fails the way a full disk or a bad feature would.
  const command = await fakeTippecanoe(directory, 'head -c 5 > "$2"\nexit 1');
  // Which error wins depends on timing: the exit status, or the write that hit
  // the closed pipe (EPIPE, or ECONNRESET on Linux runners).
  await assert.rejects(writeTilesetArchive({
    outputPath, command,
    emit: async (write) => { for (let id = 0; id < 200; id += 1) await write(feature(id)); },
  }), /exited with code 1|exited before the archive was complete|EPIPE|ECONNRESET/);
  assert.equal(await readFile(outputPath, "utf8"), "previous good archive");
  assert.deepEqual((await readdir(directory)).filter(name => name.includes(".part")), []);
}));

test("a failure while producing features never promotes the part file", () => withTemporaryDirectory(async (directory) => {
  const outputPath = join(directory, "lakes.pmtiles");
  await writeFile(outputPath, "previous good archive");
  const command = await fakeTippecanoe(directory, 'cat > "$2"');
  await assert.rejects(writeTilesetArchive({
    outputPath, command,
    emit: async (write) => { await write(feature(1)); throw new Error("shapefile read failed"); },
  }), /shapefile read failed/);
  assert.equal(await readFile(outputPath, "utf8"), "previous good archive");
  assert.deepEqual((await readdir(directory)).filter(name => name.includes(".part")), []);
}));

test("an unusable binary reports the spawn failure instead of crashing unhandled", () => withTemporaryDirectory(async (directory) => {
  const outputPath = join(directory, "lakes.pmtiles");
  await assert.rejects(writeTilesetArchive({
    outputPath, command: join(directory, "not-installed"),
    emit: async (write) => { await write(feature(1)); },
  }), (error) => error.code === "ENOENT");
  assert.deepEqual((await readdir(directory)).filter(name => name.includes(".part")), []);
  await missing(outputPath);
}));


test("a verifier rejection keeps the last good archive", () => withTemporaryDirectory(async (directory) => {
  const outputPath = join(directory, "lakes.pmtiles");
  await writeFile(outputPath, "original");
  const command = await fakeTippecanoe(directory, 'cat > "$2"');
  await assert.rejects(writeTilesetArchive({ outputPath, command, emit: async (write) => write(feature(1)),
    verify: async () => { throw new Error("invalid PMTiles"); } }), /invalid PMTiles/);
  assert.equal(await readFile(outputPath, "utf8"), "original");
  assert.deepEqual((await readdir(directory)).filter(name => name.includes(".part")), []);
}));

const installed = ["tippecanoe", process.env.PMTILES_BIN ?? "pmtiles"].every(command => !spawnSync(command, ["--version"]).error);
test("real Tippecanoe rebuilds a verified PMTiles over a prior archive", { skip: !installed }, () => withTemporaryDirectory(async (directory) => {
  const outputPath = join(directory, "lakes.pmtiles");
  for (const id of [1, 2]) {
    await writeTilesetArchive({ outputPath, args: ["--quiet", "--minimum-zoom", "0", "--maximum-zoom", "0", "--layer", "lakes"],
      emit: async (write) => write({ ...feature(id), geometry: { type: "Polygon", coordinates: [[[-12, 2], [-12, 10], [-3, 10], [-3, 2], [-12, 2]]] } }) });
    assert.equal((await readFile(outputPath)).subarray(0, 8).toString(), "PMTiles\x03");
  }
}));


const hasVerifier = !spawnSync(process.env.PMTILES_BIN ?? "pmtiles", ["version"]).error;
test("both vector provisioners reject a valid 0–12 PNG archive with a matching digest", { skip: !hasVerifier }, () => {
  // One synthetic 256px solid-color PNG at each zoom, packaged with pmtiles convert.
  const archive = fileURLToPath(new URL("./fixtures/raster-z0-z12.pmtiles", import.meta.url));
  for (const script of ["provision-lake-data.mjs", "provision-vector-data.mjs"]) {
    const cli = fileURLToPath(new URL(`../provision/${script}`, import.meta.url));
    const result = spawnSync(process.execPath, [cli, archive, "--verify-only",
      "--expected-sha256=c88eaf22116ad7bf52159154f279f569afb90c631f2ca9b69ca39be5c3de9668"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /digest matches the pinned SHA-256/);
    assert.match(result.stderr, /Expected the (globathy|protomaps) MVT archive/);
  }
});
