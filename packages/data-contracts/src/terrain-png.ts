import { unzlibSync } from "fflate";

export const TERRAIN_STATUS_HEADER = "x-topostack-terrain-status";
export const TERRAIN_NO_DATA = "no-data";

export class TerrainTileNoDataError extends Error {
  constructor() {
    super("Terrain tile contains no elevation samples.");
    this.name = "TerrainTileNoDataError";
  }
}

const TILE_SIZE = 256;
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const a = Math.abs(estimate - left), b = Math.abs(estimate - up), c = Math.abs(estimate - corner);
  return a <= b && a <= c ? left : b <= c ? up : corner;
}

/**
 * Decode the service's 256px, 8-bit RGB/RGBA, non-interlaced Terrarium PNGs.
 * These channels are numbers, not display colors: canvas color management,
 * alpha compositing and fingerprint protection must never alter them.
 * PNG filters: https://www.w3.org/TR/png-3/#9Filters
 */
export function decodeTerrainPng(bytes: Uint8Array, allowNoData = false): Float32Array {
  const invalid = () => new Error("Terrain service returned an invalid or unsupported elevation PNG. Try generating again.");
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte)) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let channels = 0, compressedSize = 0, ended = false, dataEnded = false;
  let transparent: number[] | undefined;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw invalid();
    const length = view.getUint32(offset);
    const end = offset + 8 + length;
    if (end + 4 > bytes.length) throw invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, end)) !== view.getUint32(end)) throw invalid();
    const start = offset + 8;
    if (offset === 8 && type !== "IHDR") throw invalid();
    if (parts.length && type !== "IDAT") dataEnded = true;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13 || view.getUint32(start) !== TILE_SIZE || view.getUint32(start + 4) !== TILE_SIZE ||
          bytes[start + 8] !== 8 || ![2, 6].includes(bytes[start + 9]!) ||
          bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] !== 0) throw invalid();
      channels = bytes[start + 9] === 2 ? 3 : 4;
    } else if (type === "IDAT") {
      if (dataEnded) throw invalid();
      parts.push(bytes.subarray(start, end));
      compressedSize += length;
    } else if (type === "tRNS") {
      if (channels !== 3 || length !== 6 || parts.length || transparent) throw invalid();
      transparent = [view.getUint16(start), view.getUint16(start + 2), view.getUint16(start + 4)];
    } else if (type === "IEND") {
      if (length !== 0 || end + 4 !== bytes.length) throw invalid();
      ended = true;
      break;
    } else if (type !== "PLTE" && (bytes[offset + 4]! & 32) === 0) {
      throw invalid();
    }
    offset = end + 4;
  }
  if (!ended || !compressedSize) throw invalid();
  const compressed = new Uint8Array(compressedSize);
  let position = 0;
  for (const part of parts) { compressed.set(part, position); position += part.length; }
  const stride = TILE_SIZE * channels;
  const expectedSize = (stride + 1) * TILE_SIZE;
  let filtered: Uint8Array;
  try {
    // Bound decompression to the validated tile dimensions, with one spare
    // byte so an oversized stream is rejected instead of silently truncated.
    filtered = unzlibSync(compressed, { out: new Uint8Array(expectedSize + 1) });
  } catch { throw invalid(); }
  if (filtered.length !== expectedSize) throw invalid();
  const pixels = new Uint8Array(stride * TILE_SIZE);
  for (let row = 0; row < TILE_SIZE; row += 1) {
    const filter = filtered[row * (stride + 1)]!;
    if (filter > 4) throw invalid();
    for (let column = 0; column < stride; column += 1) {
      const index = row * stride + column;
      const left = column >= channels ? pixels[index - channels]! : 0;
      const up = row > 0 ? pixels[index - stride]! : 0;
      const corner = row > 0 && column >= channels ? pixels[index - stride - channels]! : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, corner);
      pixels[index] = filtered[row * (stride + 1) + column + 1]! + predictor;
    }
  }
  const values = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let index = 0; index < values.length; index += 1) {
    const pixel = index * channels;
    // Missing samples must not become -32768m pits or blended coastal cliffs.
    if ((channels === 4 && pixels[pixel + 3] !== 255) ||
        transparent?.every((channel, i) => pixels[pixel + i] === channel)) {
      if (!allowNoData) throw invalid();
      values[index] = Number.NaN;
      continue;
    }
    const elevation = pixels[pixel]! * 256 + pixels[pixel + 1]! + pixels[pixel + 2]! / 256 - 32768;
    if (elevation === -32768) {
      // A valid, completely empty Mapzen tile encodes the sentinel in every
      // pixel. A partial sentinel tile still fails strict validation.
      if (index === 0 && pixels.every((byte, offset) => byte === (channels === 4 && offset % 4 === 3 ? 255 : 0))) {
        throw new TerrainTileNoDataError();
      }
      throw invalid();
    }
    values[index] = elevation;
  }
  return values;
}
