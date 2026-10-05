import { EARTH_RADIUS_M } from "@topostack/core";
import { decodeChartDepths, type ChartGridV1 } from "@topostack/data-contracts/chart-bathymetry";

/** Cell centres in a local metre frame, normalized uniformly. North is -Z;
 * depths go below Y=0. Never fill islands or bridge missing samples. */
export function chartSurface(grid: ChartGridV1) {
  const depths = decodeChartDepths(grid);
  const { width, height } = grid;
  const { spanX, spanZ, scale } = chartFrame(grid);
  const positions = new Float32Array(depths.length * 3);
  const colors = new Float32Array(depths.length * 3);
  let deepest = 0;
  for (const depth of depths) if (Number.isFinite(depth)) deepest = Math.max(deepest, depth);
  for (let i = 0; i < depths.length; i++) {
    const depth = Number.isFinite(depths[i]) ? depths[i]! : 0;
    positions.set([((i % width + 0.5) / width - 0.5) * spanX * scale, -depth * scale, ((Math.floor(i / width) + 0.5) / height - 0.5) * spanZ * scale], i * 3);
    const t = deepest ? depth / deepest : 0;
    colors.set([0.72 * (1 - t) + 0.03 * t, 0.87 * (1 - t) + 0.18 * t, 1 * (1 - t) + 0.48 * t], i * 3);
  }
  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let count = 0;
  function triangle(a: number, b: number, c: number) {
    if (![a, b, c].every((i) => Number.isFinite(depths[i]))) return;
    indices[count++] = a; indices[count++] = b; indices[count++] = c;
  }
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col;
      triangle(a, a + width, a + 1);
      triangle(a + 1, a + width, a + width + 1);
    }
  }
  return { positions, colors, indices: indices.subarray(0, count), deepest, scale };
}

/** Make shallow basins legible without changing the stored data. */
export function automaticDepthExaggeration(deepest: number, scale: number): number {
  return deepest > 0 && scale > 0 ? Math.max(1, 0.6 / (deepest * scale)) : 1;
}

export function chartFrame(grid: ChartGridV1) {
  const { bounds } = grid;
  const metresPerDegree = Math.PI * EARTH_RADIUS_M / 180;
  const spanX = (bounds.east - bounds.west) * metresPerDegree * Math.cos((bounds.north + bounds.south) * Math.PI / 360);
  const spanZ = (bounds.north - bounds.south) * metresPerDegree;
  const scale = 2 / Math.max(spanX, spanZ);
  return { spanX, spanZ, scale };
}
