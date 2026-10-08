import { describe, expect, it } from "vitest";
import { latToWorldY, lonToWorldX, worldXToLon, worldYToLat } from "@topostack/core/project";
import { MAX_RELIEF_TILES, estimateRelief, reliefTiles, reliefWindow, sampleRelief } from "../src/agent/relief";
import { elevationPng } from "./terrain-fixture";

/** The geographic bounds of one whole tile, inset by `insetPx` pixels on each side. */
function tileBounds(z: number, x: number, y: number, insetPx = 0) {
  return {
    west: worldXToLon(x * 256 + insetPx, z), east: worldXToLon((x + 1) * 256 - insetPx, z),
    north: worldYToLat(y * 256 + insetPx, z), south: worldYToLat((y + 1) * 256 - insetPx, z),
  };
}

describe("relief sampling", () => {
  it("uses the most detailed zoom that needs at most four tiles", () => {
    const rainier = { west: -121.9, south: 46.79, east: -121.62, north: 46.91 };
    const window = reliefWindow(rainier);
    expect(reliefTiles(rainier).length).toBeLessThanOrEqual(MAX_RELIEF_TILES);
    expect(window.zoom).toBeGreaterThan(8);
    const finer = window.zoom + 1;
    const count = (Math.floor(lonToWorldX(rainier.east, finer) / 256) - Math.floor(lonToWorldX(rainier.west, finer) / 256) + 1)
      * (Math.floor(latToWorldY(rainier.south, finer) / 256) - Math.floor(latToWorldY(rainier.north, finer) / 256) + 1);
    if (window.zoom < 12) expect(count).toBeGreaterThan(MAX_RELIEF_TILES);
    expect(reliefWindow({ west: 7.4, south: 46.9, east: 7.41, north: 46.91 }).zoom).toBe(12);
  });

  it("reads the lowest and highest ground inside the crop", () => {
    const tile = { z: 12, x: 655, y: 1415 };
    const png = elevationPng((column) => 100 + column);
    const whole = sampleRelief(tileBounds(12, 655, 1415), false, [{ tile, png }]);
    expect(whole).toMatchObject({ minM: 100, maxM: 355, zoom: 12, tiles: 1, coastal: false });
    const inset = sampleRelief(tileBounds(12, 655, 1415, 64), false, [{ tile, png }]);
    expect(inset.minM).toBe(164);
    expect(inset.maxM).toBe(291);
  });

  it("keeps a circular model to the inscribed circle", () => {
    const tile = { z: 12, x: 655, y: 1415 };
    // A peak in the tile's corner lies outside the circle.
    const png = elevationPng((column, row) => column > 240 && row > 240 ? 4000 : 500);
    expect(sampleRelief(tileBounds(12, 655, 1415), false, [{ tile, png }]).maxM).toBe(4000);
    expect(sampleRelief(tileBounds(12, 655, 1415), true, [{ tile, png }]).maxM).toBe(500);
  });

  it("sizes a coastal crop from the land, not the sea floor", () => {
    const tile = { z: 12, x: 655, y: 1415 };
    const png = elevationPng((column) => column < 128 ? -900 : 300);
    expect(sampleRelief(tileBounds(12, 655, 1415), false, [{ tile, png }])).toMatchObject({ minM: 0, maxM: 300, coastal: true });
  });

  it("ignores small patches of bad samples but keeps a steep real summit", () => {
    const tile = { z: 10, x: 170, y: 390 };
    const bounds = tileBounds(10, 170, 390);
    // Patches shaped like Lake Tahoe's zoom-10 tile: a 1×2 pair and a 2×2 block.
    const bad = new Map([["171,123", 4231], ["171,124", 5492], ["124,124", 3783], ["125,124", 277], ["124,125", -4079], ["125,125", 796]]);
    const artifacts = elevationPng((column, row) => bad.get(`${column},${row}`) ?? 1500 + column);
    expect(sampleRelief(bounds, false, [{ tile, png: artifacts }])).toMatchObject({ minM: 1500, maxM: 1755, coastal: false });
    // A summit 300 m above everything two pixels (about 240 m) away is steep, not an artifact.
    const summit = elevationPng((column, row) => Math.max(Math.abs(column - 128), Math.abs(row - 128)) <= 1 ? 3300 - 150 * Math.max(Math.abs(column - 128), Math.abs(row - 128)) : 3000);
    expect(sampleRelief(bounds, false, [{ tile, png: summit }]).maxM).toBe(3300);
  });

  it("falls back to the ground under the center of a crop narrower than one sample", () => {
    const tile = { z: 12, x: 655, y: 1415 };
    const bounds = tileBounds(12, 655, 1415, 127.9);
    expect(sampleRelief(bounds, false, [{ tile, png: elevationPng(() => 812) }])).toMatchObject({ minM: 812, maxM: 812 });
  });

  it("fetches the far side of a crop across the antimeridian", async () => {
    const bounds = { west: 179.9, south: -16.9, east: 180.1, north: -16.8 };
    const requested: string[] = [];
    await estimateRelief(bounds, false, async (tile) => { requested.push(`${tile.z}/${tile.x}/${tile.y}`); return elevationPng(() => 42); });
    const window = reliefWindow(bounds);
    expect(window.maxX).toBe(2 ** window.zoom);
    expect(requested).toEqual(expect.arrayContaining([`${window.zoom}/0/${window.minY}`, `${window.zoom}/${2 ** window.zoom - 1}/${window.minY}`]));
    expect(requested.every((tile) => Number(tile.split("/")[1]) < 2 ** window.zoom)).toBe(true);
  });

  it("loads each tile the window names", async () => {
    const bounds = tileBounds(12, 655, 1415, 32);
    const requested: string[] = [];
    const relief = await estimateRelief(bounds, false, async (tile) => { requested.push(`${tile.z}/${tile.x}/${tile.y}`); return elevationPng(() => 42); });
    expect(requested).toEqual(["12/655/1415"]);
    expect(relief).toMatchObject({ minM: 42, maxM: 42 });
  });
});
