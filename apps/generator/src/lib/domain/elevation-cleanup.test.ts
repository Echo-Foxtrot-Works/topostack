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

  it("repairs streaks crossing a tile seam using neighbors on both sides", () => {
    const values = new Float32Array(512 * 32).fill(5);
    for (let y = 10; y < 14; y += 1) for (let x = 246; x < 265; x += 1) values[y * 512 + x] = -6000;
    expect(repairElevationSpikes(values, 512, 32)).toBe(4 * 19);
    expect(Math.min(...values)).toBe(5);
  });
});
