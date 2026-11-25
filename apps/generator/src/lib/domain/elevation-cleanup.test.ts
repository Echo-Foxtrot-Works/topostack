import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeTerrainPng } from "@topostack/data-contracts/terrain-png";
import { repairElevationSpikes } from "$lib/domain/elevation-cleanup";

describe("elevation spike repair", () => {
  it.each([12, 15])("repairs the original West Point shoreline artifacts at zoom %s", (zoom) => {
    const values = decodeTerrainPng(readFileSync(new URL(`./fixtures/west-point-z${zoom}.png`, import.meta.url)));
    const original = values.slice();
    expect(Math.min(...values)).toBeLessThan(-2000);
    expect(repairElevationSpikes(values, 256, 256)).toBeGreaterThan(100);
    expect(Math.min(...values)).toBeGreaterThan(-100);
    expect(Math.max(...values)).toBe(Math.max(...original));
    // The correction must not flatten surrounding land or shallow river depths.
    for (let i = 0; i < values.length; i += 1) if (original[i]! >= -100) expect(values[i]).toBe(original[i]);
  });

  it.each(["ocean", "depression", "cliff", "mountain"])("preserves continuous %s terrain", (kind) => {
    const size = 64;
    const values = Float32Array.from({ length: size * size }, (_, index) => {
      const x = index % size, y = Math.floor(index / size);
      if (kind === "ocean") return -9000 + 2 * x + 3 * y;
      if (kind === "depression") return -430 + 0.2 * ((x - 32) ** 2 + (y - 32) ** 2);
      if (kind === "cliff") return x < 32 ? -1500 : 100;
      return 100 + 8000 * Math.exp(-((x - 32) ** 2 + (y - 32) ** 2) / 80);
    });
    const original = values.slice();
    expect(repairElevationSpikes(values, size, size)).toBe(0);
    expect(values).toEqual(original);
  });

  it("repairs the up-and-down overshoot on the Pinellas barrier islands at zoom 10", () => {
    // Mapzen 10/276/429: flat coast under 40 m with pixels from -336 m to +341 m.
    const values = decodeTerrainPng(readFileSync(new URL("./fixtures/pinellas-z10.png", import.meta.url)));
    const original = values.slice();
    expect(Math.max(...values)).toBeGreaterThan(300);
    expect(Math.min(...values)).toBeLessThan(-300);
    const repaired = repairElevationSpikes(values, 256, 256, undefined, 10);
    expect(repaired).toBeGreaterThan(100);
    expect(repaired).toBeLessThan(250);
    expect(Math.max(...values)).toBeLessThan(60);
    expect(Math.min(...values)).toBeGreaterThan(-100);
    let changed = 0;
    for (let i = 0; i < values.length; i += 1) if (values[i] !== original[i]) changed += 1;
    expect(changed).toBe(repaired);
  });

  it.each(["hill", "pit", "butte", "sea stack", "quarry"])("leaves a one-sided or wide %s on level ground alone", (kind) => {
    const size = 64, center = 32 * size + 32;
    const values = new Float32Array(size * size).fill(5);
    if (kind === "hill") for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) values[center + dy * size + dx] = 90;
    if (kind === "pit") values[center] = -60;
    if (kind === "butte") for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) values[center + dy * size + dx] = 300;
    if (kind === "sea stack") { values[center] = 80; values[center + 1] = 70; values[center + size] = 60; }
    // A pit beside its spoil heap swings both ways, but over far more pixels than overshoot does.
    if (kind === "quarry") for (let dy = -3; dy <= 3; dy += 1) for (let dx = -6; dx <= 6; dx += 1) values[center + dy * size + dx] = dx < 0 ? -90 : 70;
    const original = values.slice();
    expect(repairElevationSpikes(values, size, size, undefined, 10)).toBe(0);
    expect(values).toEqual(original);
  });

  it("levels a single pixel standing over 100 m above flat ground, and nothing lower", () => {
    const size = 64;
    const values = new Float32Array(size * size).fill(1);
    values[20 * size + 20] = 195;
    values[40 * size + 40] = 95;
    expect(repairElevationSpikes(values, size, size, undefined, 12)).toBe(1);
    expect(values[20 * size + 20]).toBe(1);
    expect(values[40 * size + 40]).toBe(95);
  });

  it("repairs one-sided lobes only beside a confirmed severe defect", () => {
    const size = 64;
    const build = (withDefect: boolean) => {
      const values = new Float32Array(size * size).fill(2);
      for (const [offset, value] of [[0, 85], [1, 70], [size, 64]] as const) values[30 * size + 36 + offset] = value;
      if (withDefect) { values[30 * size + 30] = 340; values[30 * size + 31] = -330; }
      return values;
    };
    const alone = build(false);
    expect(repairElevationSpikes(alone, size, size, undefined, 10)).toBe(0);
    const beside = build(true);
    expect(repairElevationSpikes(beside, size, size, undefined, 10)).toBe(5);
    expect(Math.max(...beside)).toBe(2);
    expect(Math.min(...beside)).toBe(2);
  });

  it("leaves the uncovered rim of a channel under a bluff alone", () => {
    // Carquinez Strait at z11: an ocean grid owns the channel, a few base
    // pixels remain along its rim, and a 68 m bluff stands beside them.
    const size = 64;
    const values = new Float32Array(size * size).fill(4);
    const owners = new Uint16Array(values.length);
    for (let y = 28; y < 34; y += 1) for (let x = 8; x < 56; x += 1) { values[y * size + x] = -65; owners[y * size + x] = 1; }
    for (const x of [30, 31, 32]) { values[27 * size + x] = -55; values[26 * size + x] = -30; }
    for (let y = 22; y < 25; y += 1) for (const x of [30, 31, 32]) values[y * size + x] = 62;
    values[23 * size + 31] = 68;
    const original = values.slice();
    expect(repairElevationSpikes(values, size, size, owners, 11)).toBe(0);
    expect(values).toEqual(original);
    // The same swing made severe is overshoot again, wherever it sits.
    values[26 * size + 31] = -330; values[25 * size + 31] = 340;
    expect(repairElevationSpikes(values, size, size, owners, 11)).toBeGreaterThan(0);
  });

  it("leaves preferred-source pixels out of the overshoot repair", () => {
    const size = 64;
    const values = new Float32Array(size * size).fill(2);
    const owners = new Uint16Array(values.length);
    values[30 * size + 30] = 340; values[30 * size + 31] = -330;
    owners[30 * size + 30] = 1; owners[30 * size + 31] = 1;
    expect(repairElevationSpikes(values, size, size, owners, 10)).toBe(0);
  });

  it("keeps a trench axis that an ocean grid draws at the base zoom", () => {
    // A V-shaped trench 7,000 m deep with 10° walls at about 250 m per pixel
    // (z9 near 35°N, where GEBCO_2026 is sampled), like the Japan Trench.
    const width = 64, height = 32, metresPerPixel = 250;
    const values = Float32Array.from({ length: width * height }, (_, index) =>
      -7000 + Math.abs((index % width) - 32) * metresPerPixel * Math.tan(10 * Math.PI / 180));
    const original = values.slice();
    expect(repairElevationSpikes(values, width, height)).toBe(0);
    expect(values).toEqual(original);
  });

  it.each([13, 15])("checks isolated shallow remnants at fine zoom only (z%s)", (zoom) => {
    // Rounded native elevations at Kyiv: a shallow pit between two confirmed
    // negative spikes. Copernicus GLO-30 measures 95.8 m at the pit center.
    const width = 64, center = 24 * width + 24;
    const values = new Float32Array(width * width).fill(98);
    values[center - width] = -549;
    values[center + 1] = -568;
    values[center] = -36;
    values[42 * width + 48] = -36; // a distant pit has no confirmed local defect
    expect(repairElevationSpikes(values, width, width, undefined, zoom)).toBe(zoom >= 14 ? 3 : 2);
    expect(values[center]).toBe(zoom >= 14 ? 98 : -36);
    expect(values[42 * width + 48]).toBe(-36);
  });

  it.each(["coastal", "sloping", "two-pixel depression", "preferred center", "preferred neighbor"])("preserves %s terrain near an unrelated deep defect", (kind) => {
    const width = 48, center = 24 * width + 24;
    const values = new Float32Array(width * width).fill(200);
    const owners = new Uint16Array(values.length);
    values[center - 5] = -800;
    values[center] = kind === "coastal" ? -98 : 24;
    if (kind === "coastal") {
      for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) if (dx || dy) values[center + dy * width + dx] = 12;
    }
    if (kind === "sloping") values[center - width] = 230;
    if (kind === "two-pixel depression") values[center - width] = 24;
    if (kind === "preferred center") owners[center] = 1;
    if (kind === "preferred neighbor") owners[center - width] = 1;
    const original = values.slice();
    expect(repairElevationSpikes(values, width, width, owners, 15)).toBe(1);
    original[center - 5] = 200;
    expect(values).toEqual(original);
  });

  it("repairs streaks crossing a tile seam using neighbors on both sides", () => {
    const values = new Float32Array(512 * 32).fill(5);
    for (let y = 10; y < 14; y += 1) for (let x = 246; x < 265; x += 1) values[y * 512 + x] = -6000;
    expect(repairElevationSpikes(values, 512, 32)).toBe(4 * 19);
    expect(Math.min(...values)).toBe(5);
  });
});
