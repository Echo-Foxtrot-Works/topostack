/// <reference types="node" />
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeTerrainPng, TerrainTileNoDataError } from "./terrain-png";

function chunk(type: string, data: Uint8Array): Buffer {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function terrainPng(options: { filter?: number; rgba?: boolean; alpha?: number; noData?: boolean | "first-pixel"; width?: number; transparency?: boolean; extraBytes?: number } = {}): Buffer {
  const channels = options.rgba ? 4 : 3;
  const stride = 256 * channels;
  const raw = Buffer.alloc((stride + 1) * 256 + (options.extraBytes ?? 0));
  const pixels = Buffer.alloc(stride * 256);
  for (let y = 0; y < 256; y += 1) for (let x = 0; x < 256; x += 1) {
    const offset = y * stride + x * channels;
    // Exercise byte carries, negative depths, fractional meters and all filters.
    const missing = options.noData === true || (options.noData === "first-pixel" && x === 0 && y === 0);
    pixels[offset] = missing ? 0 : 100 + Math.floor(x / 8);
    pixels[offset + 1] = missing ? 0 : (x * 3 + y * 7) % 256;
    pixels[offset + 2] = missing ? 0 : (x + y) % 256;
    if (channels === 4) pixels[offset + 3] = options.alpha ?? 255;
  }
  for (let y = 0; y < 256; y += 1) {
    const filter = options.filter ?? y % 5;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x;
      const a = x >= channels ? pixels[index - channels]! : 0;
      const b = y ? pixels[index - stride]! : 0;
      const c = y && x >= channels ? pixels[index - stride - channels]! : 0;
      const p = a + b - c;
      const choices = [a, b, c];
      const distances = choices.map((value) => Math.abs(p - value));
      const paeth = choices[distances.indexOf(Math.min(...distances))]!;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth][filter] ?? 0;
      raw[y * (stride + 1) + x + 1] = (pixels[index]! - prediction + 256) % 256;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(options.width ?? 256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = channels === 3 ? 2 : 6;
  const compressed = deflateSync(raw);
  const transparency = Buffer.alloc(6); transparency.writeUInt16BE(100);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    // Color metadata is intentionally ignored for numerical terrain data.
    chunk("gAMA", Buffer.from([0, 1, 134, 160])),
    ...(options.transparency ? [chunk("tRNS", transparency)] : []),
    chunk("IDAT", compressed.subarray(0, 20)), chunk("IDAT", compressed.subarray(20)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("numeric Terrarium PNG decoding", () => {
  it.each([false, true])("decodes every PNG filter and split IDAT with RGBA=%s", (rgba) => {
    const values = decodeTerrainPng(terrainPng({ rgba }));
    expect(values).toHaveLength(256 * 256);
    for (const [x, y] of [[0, 0], [1, 1], [7, 2], [8, 3], [125, 4], [255, 255]]) {
      expect(values[y! * 256 + x!]).toBe((100 + Math.floor(x! / 8)) * 256 + (x! * 3 + y! * 7) % 256 + ((x! + y!) % 256) / 256 - 32768);
    }
  });

  it.each([{ width: 512 }, { filter: 5 }, { rgba: true, alpha: 0 }, { rgba: true, alpha: 128 }, { transparency: true }, { noData: "first-pixel" as const }, { extraBytes: 5 }])("rejects unsupported or missing data: %j", (options) => {
    expect(() => decodeTerrainPng(terrainPng(options))).toThrow(/elevation PNG/);
  });

  it.each([false, true])("distinguishes a completely empty sentinel tile with RGBA=%s", (rgba) => {
    expect(() => decodeTerrainPng(terrainPng({ rgba, noData: true }))).toThrow(TerrainTileNoDataError);
  });

  it("preserves transparent bathymetry as missing without weakening terrain validation", () => {
    const bytes = terrainPng({ rgba: true, alpha: 0 });
    expect(() => decodeTerrainPng(bytes)).toThrow();
    expect(decodeTerrainPng(bytes, true).every(Number.isNaN)).toBe(true);
  });

  it("rejects damaged and truncated PNGs", () => {
    const png = terrainPng();
    expect(() => decodeTerrainPng(png.subarray(0, -1))).toThrow(/elevation PNG/);
    png[50] = png[50]! ^ 1;
    expect(() => decodeTerrainPng(png)).toThrow(/elevation PNG/);
  });
});
