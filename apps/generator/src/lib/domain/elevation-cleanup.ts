/**
 * Repair narrow downward DEM artifacts before resampling spreads them. Mapzen's
 * West Point tiles contain kilometer-deep streaks beside near-sea-level pixels.
 * Use a local median/MAD (median absolute deviation), never a sea-level clamp or
 * crop-wide percentile: continuous ocean floors and land depressions survive.
 */
export function repairElevationSpikes(values: Float32Array, width: number, height: number, terrainOwners?: Uint16Array): number {
  const repairs: Array<[number, number]> = [];
  const neighbors: number[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const value = values[index]!;
      // Keep shallow bathymetry and all above-sea-level terrain untouched.
      if (value >= -100 || terrainOwners?.[index]) continue;
      neighbors.length = 0;
      let maximumNeighbor = -Infinity;
      for (let dy = -8; dy <= 8; dy += 4) {
        for (let dx = -8; dx <= 8; dx += 4) {
          if ((!dx && !dy) || row + dy < 0 || row + dy >= height || column + dx < 0 || column + dx >= width) continue;
          const neighborIndex = (row + dy) * width + column + dx;
          if (terrainOwners?.[neighborIndex]) continue;
          const neighbor = values[neighborIndex]!;
          neighbors.push(neighbor);
          maximumNeighbor = Math.max(maximumNeighbor, neighbor);
        }
      }
      if (neighbors.length < 8 || maximumNeighbor - value <= 100) continue;
      neighbors.sort((a, b) => a - b);
      const middle = Math.floor(neighbors.length / 2);
      const median = (neighbors[middle]! + neighbors[Math.floor((neighbors.length - 1) / 2)]!) / 2;
      if (median - value <= 100) continue;
      for (let i = 0; i < neighbors.length; i += 1) neighbors[i] = Math.abs(neighbors[i]! - median);
      neighbors.sort((a, b) => a - b);
      const mad = (neighbors[middle]! + neighbors[Math.floor((neighbors.length - 1) / 2)]!) / 2;
      if (median - value > Math.max(100, 8 * mad)) repairs.push([index, median]);
    }
  }
  // Read only the original neighborhood so repair order cannot affect results.
  for (const [index, value] of repairs) values[index] = value;
  return repairs.length;
}
