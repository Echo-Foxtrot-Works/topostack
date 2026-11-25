/**
 * Repair narrow DEM artifacts before resampling spreads them. Mapzen's
 * West Point tiles contain kilometer-deep streaks beside near-sea-level pixels.
 * Use a local median/MAD (median absolute deviation), never a sea-level clamp or
 * crop-wide percentile: continuous ocean floors and land depressions survive.
 * Paired up-and-down overshoot is handled last; see repairPairedSpikes.
 */
export function repairElevationSpikes(values: Float32Array, width: number, height: number, terrainOwners?: Uint16Array, zoom = 0): number {
  // Overshoot first: the deep pass below would remove its downward half and
  // leave the upward half looking like a summit.
  const paired = repairPairedSpikes(values, width, height, terrainOwners);
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
  if (!suspectBlocks.size) return paired + repairs.length;

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
  return paired + repairs.length + isolated.length;
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

const PAIRED_SPIKE_STRONG_M = 40;
const PAIRED_SPIKE_WEAK_M = 20;
const PAIRED_SPIKE_REACH = 2;
const PAIRED_SPIKE_MAX_PIXELS = 32;
const SEVERE_SPIKE_M = 100;
const LONE_SPIKE_MAX_PIXELS = 2;
const DEFECT_BLOCK = 8;

/**
 * Repair resampling overshoot in the coarser Mapzen levels: a few pixels that
 * swing hundreds of metres above and below flat ground side by side (the
 * Pinellas barrier islands at z10 to z12 read +341 m beside -336 m; z13 has
 * neither). One such pixel sets the whole layer ladder.
 *
 * A defect is a small cluster that departs strongly from its surroundings in
 * both directions at once, which a real summit, pit, cliff or sea stack does
 * not do. One-sided clusters, and mild pairs at the edge of a preferred
 * source, are repaired only beside a severe confirmed defect, where the same
 * overshoot leaves smaller lobes, or when they are a
 * spike of one or two pixels over 100 m above level ground, narrower than
 * anything the model can cut. Lone pits are the deep pass's to judge, and
 * anything wider than a few pixels is left alone.
 */
function repairPairedSpikes(values: Float32Array, width: number, height: number, owners?: Uint16Array): number {
  // Deviation from the local median, kept only where it is at least "weak".
  const deviations = new Map<number, { median: number; deviation: number; strong: boolean }>();
  const ring: number[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (owners?.[index]) continue;
      const value = values[index]!;
      // Overshoot is a step of tens of metres between adjacent pixels; skipping
      // smoother ground keeps the median off almost every pixel.
      const step = Math.max(
        column > 0 ? Math.abs(value - values[index - 1]!) : 0,
        column < width - 1 ? Math.abs(value - values[index + 1]!) : 0,
        row > 0 ? Math.abs(value - values[index - width]!) : 0,
        row < height - 1 ? Math.abs(value - values[index + width]!) : 0,
      );
      if (step <= PAIRED_SPIKE_WEAK_M) continue;
      ring.length = 0;
      for (let dy = -8; dy <= 8; dy += 4) {
        for (let dx = -8; dx <= 8; dx += 4) {
          if ((!dx && !dy) || row + dy < 0 || row + dy >= height || column + dx < 0 || column + dx >= width) continue;
          const neighbor = (row + dy) * width + column + dx;
          if (!owners?.[neighbor]) ring.push(values[neighbor]!);
        }
      }
      if (ring.length < 8) continue;
      ring.sort((a, b) => a - b);
      const middle = Math.floor(ring.length / 2), lower = Math.floor((ring.length - 1) / 2);
      const median = (ring[middle]! + ring[lower]!) / 2;
      for (let i = 0; i < ring.length; i += 1) ring[i] = Math.abs(ring[i]! - median);
      ring.sort((a, b) => a - b);
      const mad = (ring[middle]! + ring[lower]!) / 2;
      const deviation = value - median;
      if (Math.abs(deviation) > Math.max(PAIRED_SPIKE_WEAK_M, 4 * mad)) deviations.set(index, { median, deviation, strong: Math.abs(deviation) > Math.max(PAIRED_SPIKE_STRONG_M, 8 * mad) });
    }
  }
  if (!deviations.size) return 0;

  const blockColumns = Math.ceil(width / DEFECT_BLOCK);
  const blockRows = Math.ceil(height / DEFECT_BLOCK);
  const blockOf = (index: number) => Math.floor(Math.floor(index / width) / DEFECT_BLOCK) * blockColumns + Math.floor((index % width) / DEFECT_BLOCK);
  const defectBlocks = new Set<number>();
  const repairs: number[] = [];
  const oneSided: number[][] = [];
  const visited = new Set<number>();
  for (const start of deviations.keys()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const cluster = [start];
    let strongAbove = false, strongBelow = false, highest = 0, largest = 0, besidePreferred = false;
    for (let next = 0; next < cluster.length; next += 1) {
      const index = cluster[next]!;
      const entry = deviations.get(index)!;
      if (entry.strong && entry.deviation > 0) strongAbove = true;
      if (entry.strong && entry.deviation < 0) strongBelow = true;
      highest = Math.max(highest, entry.deviation);
      largest = Math.max(largest, Math.abs(entry.deviation));
      const column = index % width, row = Math.floor(index / width);
      for (let y = Math.max(0, row - PAIRED_SPIKE_REACH); y <= Math.min(height - 1, row + PAIRED_SPIKE_REACH); y += 1) {
        for (let x = Math.max(0, column - PAIRED_SPIKE_REACH); x <= Math.min(width - 1, column + PAIRED_SPIKE_REACH); x += 1) {
          const neighbor = y * width + x;
          if (owners?.[neighbor]) besidePreferred = true;
          if (visited.has(neighbor) || !deviations.has(neighbor)) continue;
          visited.add(neighbor);
          cluster.push(neighbor);
        }
      }
    }
    if (cluster.length > PAIRED_SPIKE_MAX_PIXELS || (!strongAbove && !strongBelow)) continue;
    // Beside a preferred source the cluster is only what that source left
    // uncovered: the rim of a channel under a bluff looks like a small pair
    // (Carquinez Strait, -68 m beside +68 m). Only a severe swing counts there.
    if (strongAbove && strongBelow && (!besidePreferred || largest > SEVERE_SPIKE_M)) {
      repairs.push(...cluster);
      if (largest <= SEVERE_SPIKE_M) continue;
      for (const index of cluster) {
        const block = blockOf(index), bx = block % blockColumns, by = Math.floor(block / blockColumns);
        for (let y = Math.max(0, by - 1); y <= Math.min(blockRows - 1, by + 1); y += 1) {
          for (let x = Math.max(0, bx - 1); x <= Math.min(blockColumns - 1, bx + 1); x += 1) defectBlocks.add(y * blockColumns + x);
        }
      }
    } else if (strongAbove && cluster.length <= LONE_SPIKE_MAX_PIXELS && highest > SEVERE_SPIKE_M) {
      repairs.push(...cluster);
    } else {
      oneSided.push(cluster);
    }
  }
  for (const cluster of oneSided) if (cluster.some((index) => defectBlocks.has(blockOf(index)))) repairs.push(...cluster);
  // Medians were read before any write, so repair order cannot matter.
  for (const index of repairs) values[index] = deviations.get(index)!.median;
  return repairs.length;
}
