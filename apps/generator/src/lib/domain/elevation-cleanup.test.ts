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
