/**
 * Repair narrow downward DEM artifacts before resampling spreads them. Mapzen's
 * West Point tiles contain kilometer-deep streaks beside near-sea-level pixels.
 * Use a local median/MAD (median absolute deviation), never a sea-level clamp or
 * crop-wide percentile: continuous ocean floors and land depressions survive.
 */
export function repairElevationSpikes(values: Float32Array, width: number, height: number, terrainOwners?: Uint16Array, zoom = 0): number {
  const repairs: Array<[number, number]> = [];
  const neighbors: number[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const value = values[index]!;
      // Find deep negative spikes before checking isolated residuals at fine zooms.
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
  const blockSize = 8;
  const blockColumns = Math.ceil(width / blockSize);
  const blockRows = Math.ceil(height / blockSize);
  const suspectBlocks = new Set<number>();
  for (const [index, median] of repairs) {
    // A severe defect on elevated land can leave shallower pits nearby. At
    // z14 and finer an individual native pixel is under 10 metres wide.
    if (zoom >= 14 && median >= 30 && median - values[index]! > 400) {
      const bx = Math.floor((index % width) / blockSize);
      const by = Math.floor(Math.floor(index / width) / blockSize);
      for (let y = Math.max(0, by - 1); y <= Math.min(blockRows - 1, by + 1); y += 1) {
        for (let x = Math.max(0, bx - 1); x <= Math.min(blockColumns - 1, bx + 1); x += 1) {
          suspectBlocks.add(y * blockColumns + x);
        }
      }
    }
    values[index] = median;
  }
  if (!suspectBlocks.size) return repairs.length;

  // Require a fully enclosing, nearly level ring of land. Read all rings
  // before writing so a continuous depression cannot be filled successively.
  const isolated: Array<[number, number]> = [];
  const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  for (const block of suspectBlocks) {
    const left = (block % blockColumns) * blockSize;
    const top = Math.floor(block / blockColumns) * blockSize;
    for (let y = Math.max(1, top); y < Math.min(top + blockSize, height - 1); y += 1) {
      for (let x = Math.max(1, left); x < Math.min(left + blockSize, width - 1); x += 1) {
        const index = y * width + x;
        const value = values[index]!;
        if (terrainOwners?.[index] || value < -100 || values[index - 1]! - value <= 100) continue;
        const rimHeight = isolatedPitRim(values, terrainOwners, index, offsets);
        if (rimHeight !== undefined) isolated.push([index, rimHeight]);
      }
    }
  }
  for (const [index, height] of isolated) values[index] = height;
  return repairs.length + isolated.length;
}

/** All eight base-terrain neighbors must agree within 20 m and stand above the pit. */
function isolatedPitRim(values: Float32Array, owners: Uint16Array | undefined, index: number, offsets: number[]): number | undefined {
  let minimum = Infinity, maximum = -Infinity, sum = 0;
  for (const offset of offsets) {
    const neighbor = index + offset;
    const height = values[neighbor]!;
    if (owners?.[neighbor] || height < 30 || height - values[index]! <= 100) return undefined;
    minimum = Math.min(minimum, height);
    maximum = Math.max(maximum, height);
    sum += height;
  }
  return maximum - minimum <= 20 ? sum / offsets.length : undefined;
}
