import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { sha256Hex } from "./hash.mjs";

/** Actual Terrarium heights on a crop's Mercator grid, with hashes of every input tile. */
export async function terrariumGrid(bounds, size, directory, zoom = 10) {
  const world = 256 * 2 ** zoom;
  const worldX = (lon) => (lon + 180) / 360 * world;
  const worldY = (lat) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * world;
  const west = worldX(bounds.west) - 0.5, east = worldX(bounds.east) - 0.5;
  const north = worldY(bounds.north) - 0.5, south = worldY(bounds.south) - 0.5;
  const tiles = new Map(), inputs = [];
  await mkdir(directory, { recursive: true });
  for (let y = Math.floor(north / 256); y <= Math.floor((south + 1) / 256); y += 1) {
    for (let x = Math.floor(west / 256); x <= Math.floor((east + 1) / 256); x += 1) {
      const path = join(directory, `${zoom}-${x}-${y}.png`);
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
      let bytes = await readFile(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
      if (!bytes) {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Terrain tile ${zoom}/${x}/${y}: HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        PNG.sync.read(bytes);
        await writeFile(path, bytes);
      }
      const tile = PNG.sync.read(bytes);
      if (tile.width !== 256 || tile.height !== 256) throw new Error(`Invalid terrain tile dimensions: ${path}`);
      tiles.set(`${x}/${y}`, tile);
      inputs.push({ url, sha256: sha256Hex(bytes) });
    }
  }
  const sample = (x, y) => {
    const tile = tiles.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
    const offset = ((y % 256) * 256 + x % 256) * 4;
    if (tile.data[offset + 3] === 0) throw new Error("Terrain fixture contains missing elevation.");
    return tile.data[offset] * 256 + tile.data[offset + 1] + tile.data[offset + 2] / 256 - 32768;
  };
  const values = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
    const x = west + (east - west) * column / (size - 1), y = north + (south - north) * row / (size - 1);
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const value = (sample(ix, iy) * (1 - fx) + sample(ix + 1, iy) * fx) * (1 - fy) + (sample(ix, iy + 1) * (1 - fx) + sample(ix + 1, iy + 1) * fx) * fy;
    values[row * size + column] = value;
    min = Math.min(min, values[row * size + column]); max = Math.max(max, values[row * size + column]);
  }
  return { elevation: { width: size, height: size, values, min, max }, inputs };
}
