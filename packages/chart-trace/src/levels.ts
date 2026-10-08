// Contour levels from topology. A chart labels only some of its lines; the
// rest follow from the rule that the space between neighbouring contours is
// a band spanning exactly one interval. Two views of that rule work together:
//
// - Regions: rasterize the lines, flood the space between them, and solve for
//   bands. Exact on clean vector charts, but one gap in a line merges two
//   bands, and scans are full of gaps.
// - The facing graph: rays cast sideways from each line record which lines it
//   faces across open water. Rules over it are local, so a gap elsewhere does
//   not matter; each needs a clear majority of samples, and propagation needs
//   the lines to see each other both ways, so rays that slip through gaps do
//   not decide. Lines the shore faces on its land side (frames, roads, the
//   legend of a scan) never take a level.

import type { Point2 } from "./local-frame.ts";

export interface LevelLine {
  points: Point2[];
  closed: boolean;
  /** A labelled level, when known. */
  value?: number;
}

export interface LevelInput {
  lines: LevelLine[];
  /** The shoreline and the level it stands for (depth 0, or the surface elevation). */
  shoreline?: { rings: Point2[][]; value: number };
  interval: number;
  /** +1 when values grow away from the shore (depths), -1 when they shrink (elevations). */
  inward: 1 | -1;
  /**
   * The water surface, which no contour lies beyond: depths are at least 0,
   * elevations at most the pool. Lines that would fall outside it (roads,
   * frames, the shore of a scan) are left without a level.
   */
  surface?: number;
  width: number;
  height: number;
  /** Raster cell size in page units; defaults so the longer side is at most 2048 cells. */
  cellSize?: number;
}

export interface LevelResult {
  values: (number | undefined)[];
  /** Lines whose level was inferred rather than labelled. */
  inferred: boolean[];
  /** Labelled lines that no band around them agrees with. */
  conflicts: number[];
  /** Spaces between lines: how many were settled into a band, and how many touch levels no single band can hold. */
  regions: { total: number; banded: number; contradictory: number };
}

const EPSILON = 1e-6;
/** Samples per line for the facing graph, how far a ray looks as a share of the page, and what counts as a decision. */
const RAY_SAMPLES = 80;
const RAY_REACH_SHARE = 0.15;
const MIN_VOTES = 3;
const MIN_SHARE = 0.75;
const LEFT = 0;
const RIGHT = 1;

/** What one line faces: tallies per side, and the pair of lines hit left and right at each sample. */
interface Facing {
  sides: [Map<number, number>, Map<number, number>];
  pairs: [number | undefined, number | undefined][];
}

function decisive(best: number, total: number): boolean {
  return best >= MIN_VOTES && best >= total * MIN_SHARE;
}

/** The heaviest entry of a tally. */
function strongest(tally: Map<number, number>): [number, number] | undefined {
  let best: [number, number] | undefined;
  for (const entry of tally) if (!best || entry[1] > best[1]) best = entry;
  return best;
}
/** Regions smaller than this are pockets left by drawing, not the space between lines. */
const MIN_SIDE_CELLS = 16;

/** The raster the regions and rays are read from: which line, if any, owns each cell. */
interface LineRaster {
  owner: Int32Array;
  width: number;
  height: number;
  cellSize: number;
}

function neighbours(cell: number, width: number, height: number): [number, number, number, number] {
  const row = Math.floor(cell / width);
  const column = cell % width;
  return [row > 0 ? cell - width : -1, row < height - 1 ? cell + width : -1, column > 0 ? cell - 1 : -1, column < width - 1 ? cell + 1 : -1];
}

/** Lines (and the shore, as id `lines.length`) drawn into cells; the first line to reach a cell owns it. */
function rasterizeLines(input: LevelInput): LineRaster {
  const { lines } = input;
  const cellSize = input.cellSize ?? Math.max(input.width, input.height) / 2048;
  const width = Math.max(1, Math.ceil(input.width / cellSize));
  const height = Math.max(1, Math.ceil(input.height / cellSize));
  const owner = new Int32Array(width * height).fill(-1);
  // Lines are drawn 8-connected, which a 4-connected flood cannot cross.
  const draw = (points: readonly Point2[], closed: boolean, id: number) => {
    const ring = closed ? [...points, points[0]!] : points;
    for (let index = 0; index < ring.length; index += 1) {
      const [x1, y1] = ring[Math.max(0, index - 1)]!;
      const [x2, y2] = ring[index]!;
      const steps = Math.max(1, Math.ceil((Math.hypot(x2 - x1, y2 - y1) / cellSize) * 2));
      for (let step = 0; step <= steps; step += 1) {
        const column = Math.floor((x1 + ((x2 - x1) * step) / steps) / cellSize);
        const row = Math.floor((y1 + ((y2 - y1) * step) / steps) / cellSize);
        if (row < 0 || column < 0 || row >= height || column >= width) continue;
        const cell = row * width + column;
        if (owner[cell] === -1) owner[cell] = id;
      }
    }
  };
  for (const ring of input.shoreline?.rings ?? []) draw(ring, true, lines.length);
  lines.forEach((line, index) => draw(line.points, line.closed, index));
  return { owner, width, height, cellSize };
}

/** The open spaces between lines, flooded 4-connected, and which lines border each. */
interface Regions {
  /** Region of each open cell, -1 under a line. */
  region: Int32Array;
  size: number[];
  count: number;
  /** For each line (and the shore last), the regions beside it. */
  lineRegions: Set<number>[];
  /** For each region, the lines beside it. */
  regionLines: Set<number>[];
}

function floodRegions({ owner, width, height }: LineRaster, lineCount: number): Regions {
  const region = new Int32Array(width * height).fill(-1);
  const size: number[] = [];
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < owner.length; start += 1) {
    if (owner[start] !== -1 || region[start] !== -1) continue;
    region[start] = count;
    size.push(0);
    stack.push(start);
    while (stack.length) {
      const cell = stack.pop()!;
      size[count]! += 1;
      for (const next of neighbours(cell, width, height)) {
        if (next < 0 || owner[next] !== -1 || region[next] !== -1) continue;
        region[next] = count;
        stack.push(next);
      }
    }
    count += 1;
  }

  const lineRegions = Array.from({ length: lineCount + 1 }, () => new Set<number>());
  const regionLines = Array.from({ length: count }, () => new Set<number>());
  for (let cell = 0; cell < owner.length; cell += 1) {
    const id = owner[cell]!;
    if (id < 0) continue;
    for (const next of neighbours(cell, width, height)) {
      if (next < 0 || owner[next] !== -1) continue;
      lineRegions[id]!.add(region[next]!);
      regionLines[region[next]!]!.add(id);
    }
  }
  return { region, size, count, lineRegions, regionLines };
}

/**
 * For each line, how often each side faces each other line across open
 * water: rays cast left and right from samples along it, stopping at the
 * first other line within reach. Local, so leaks between regions do not
 * matter. Index `lines.length` is the shoreline, which is only ever faced.
 */
function facingGraph(lines: readonly LevelLine[], { owner, width, height, cellSize }: LineRaster, pageSize: number): Facing[] {
  const reach = Math.ceil((pageSize * RAY_REACH_SHARE) / cellSize);
  return lines.map((line, id) => {
    const sides: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
    const pairs: [number | undefined, number | undefined][] = [];
    const ring = line.closed ? [...line.points, line.points[0]!] : line.points;
    let total = 0;
    for (let index = 1; index < ring.length; index += 1) total += Math.hypot(ring[index]![0] - ring[index - 1]![0], ring[index]![1] - ring[index - 1]![1]);
    const spacing = Math.max(cellSize * 3, total / RAY_SAMPLES);
    let travelled = 0;
    let nextSample = spacing / 2;
    for (let index = 1; index < ring.length; index += 1) {
      const [x1, y1] = ring[index - 1]!;
      const [x2, y2] = ring[index]!;
      const span = Math.hypot(x2 - x1, y2 - y1);
      if (!span) continue;
      // Left of the direction of travel, with y down.
      const normal: Point2 = [(y2 - y1) / span, -(x2 - x1) / span];
      while (nextSample <= travelled + span) {
        const t = (nextSample - travelled) / span;
        const x = x1 + t * (x2 - x1);
        const y = y1 + t * (y2 - y1);
        const hits = [LEFT, RIGHT].map((side) => {
          const sign = side === LEFT ? 1 : -1;
          let cleared = false;
          for (let k = 1; k <= reach; k += 1) {
            const column = Math.floor((x + sign * normal[0] * k * cellSize) / cellSize);
            const row = Math.floor((y + sign * normal[1] * k * cellSize) / cellSize);
            if (row < 0 || column < 0 || row >= height || column >= width) return undefined;
            const other = owner[row * width + column]!;
            if (other === -1) {
              cleared = true;
              continue;
            }
            // Still inside this line's own stroke, or it looped back on itself.
            if (other === id) {
              if (cleared) return undefined;
              continue;
            }
            sides[side]!.set(other, (sides[side]!.get(other) ?? 0) + 1);
            return other;
          }
          return undefined;
        });
        pairs.push([hits[LEFT], hits[RIGHT]]);
        nextSample += spacing;
      }
      travelled += span;
    }
    return { sides, pairs };
  });
}

/**
 * The rungs levels may take: every interval, aligned to the labels, plus the
 * surface, which need not fall on it (a reservoir at 322 ft with 5 ft contours).
 */
class Ladder {
  private readonly offset: number;
  private readonly interval: number;
  private readonly inward: 1 | -1;

  constructor(offset: number, interval: number, inward: 1 | -1) {
    this.offset = offset;
    this.interval = interval;
    this.inward = inward;
  }

  same(a: number, b: number): boolean {
    return Math.abs(a - b) < EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  }

  private step(value: number): number {
    return (value - this.offset) / this.interval;
  }

  /** Whether a and b are neighbouring rungs, the two edges of one band. */
  adjacent(a: number, b: number): boolean {
    if (this.same(a, b)) return false;
    const [low, high] = a < b ? [a, b] : [b, a];
    const firstRungAbove = Math.floor(this.step(low) + 1e-6) + 1;
    return this.offset + firstRungAbove * this.interval >= high - EPSILON * Math.max(1, Math.abs(high));
  }

  /** The next rung inward from a level. */
  inwardOf(value: number): number {
    const rung = this.step(value);
    const next = this.inward > 0 ? Math.floor(rung + 1e-6) + 1 : Math.ceil(rung - 1e-6) - 1;
    return this.offset + next * this.interval;
  }

  /** The rung on the far side of `level` from `other`. */
  beyond(level: number, other: number): number {
    const rung = this.step(level);
    return this.offset + (other < level ? Math.floor(rung + 1e-6) + 1 : Math.ceil(rung - 1e-6) - 1) * this.interval;
  }

  rungAbove(value: number): number {
    return this.offset + (Math.floor(this.step(value) + 1e-6) + 1) * this.interval;
  }

  rungBelow(value: number): number {
    return this.offset + (Math.ceil(this.step(value) - 1e-6) - 1) * this.interval;
  }
}

type Band = { low: number; high: number } | "bad" | undefined;

/** The levels, region bands and line orientations settled so far, and the rules that settle more. */
class LevelSolver {
  readonly values: (number | undefined)[];
  readonly inferred: boolean[];
  readonly bands: Band[];
  /** Which side of each known line faces higher values, once its neighbours tell. */
  private readonly higher: (number | undefined)[];
  /** Lines found beyond the shore; they never take a level. */
  private readonly land: boolean[];
  private readonly shoreId: number;
  /** The water surface: no level lies beyond it. */
  private readonly bound: number | undefined;

  private readonly input: LevelInput;
  private readonly regions: Regions;
  private readonly facing: Facing[];
  private readonly ladder: Ladder;

  constructor(input: LevelInput, regions: Regions, facing: Facing[], ladder: Ladder) {
    this.input = input;
    this.regions = regions;
    this.facing = facing;
    this.ladder = ladder;
    const { lines } = input;
    this.shoreId = lines.length;
    this.values = [...lines.map((line) => line.value), input.shoreline?.value];
    this.inferred = new Array<boolean>(lines.length).fill(false);
    this.bands = new Array(regions.count).fill(undefined);
    this.higher = new Array(lines.length).fill(undefined);
    this.land = new Array<boolean>(lines.length).fill(false);
    this.bound = input.surface ?? input.shoreline?.value;
  }

  /** Repeats every rule until none settles anything more. */
  solve(): void {
    for (let changed = true; changed;) {
      changed = false;
      for (let index = 0; index < this.regions.count; index += 1) changed = this.assign(index, this.settleBand(index)) || changed;
      changed = this.crossKnownLines() || changed;
      changed = this.inferFromBands() || changed;
      // Regions on a real chart leak through gaps and merge where lines crowd
      // closer than a cell, so also reason locally, over the facing graph.
      changed = this.faceStep() || changed;
    }
  }

  /** Whether a level lies on the water side of the surface. */
  private allowed(value: number): boolean {
    const { bound } = this;
    return bound === undefined || (this.input.inward > 0 ? value >= bound - EPSILON : value <= bound + EPSILON);
  }

  private settleBand(index: number): Band {
    const { ladder, input } = this;
    const known: number[] = [];
    for (const id of this.regions.regionLines[index]!) {
      const value = this.values[id];
      if (value !== undefined && !known.some((other) => ladder.same(other, value))) known.push(value);
    }
    if (known.length > 2) return "bad";
    if (known.length === 2) {
      const [a, b] = known as [number, number];
      return ladder.adjacent(a, b) ? { low: Math.min(a, b), high: Math.max(a, b) } : "bad";
    }
    // A band on the shore reaches the next rung inward from it.
    if (known.length === 1 && this.regions.regionLines[index]!.has(this.shoreId) && input.shoreline && ladder.same(known[0]!, input.shoreline.value)) {
      const inner = ladder.inwardOf(input.shoreline.value);
      return { low: Math.min(input.shoreline.value, inner), high: Math.max(input.shoreline.value, inner) };
    }
    return undefined;
  }

  /** Records what a region must be; evidence that disagrees makes it contradictory. */
  private assign(index: number, band: Band): boolean {
    const { bands, ladder } = this;
    const current = bands[index];
    if (current === "bad" || band === undefined) return false;
    if (band === "bad") {
      bands[index] = "bad";
      return true;
    }
    if (current === undefined) {
      bands[index] = band;
      return true;
    }
    if (ladder.same(current.low, band.low) && ladder.same(current.high, band.high)) return false;
    bands[index] = "bad";
    return true;
  }

  /** A contour at level L parts the band below L from the band above it, so knowing one side of a known line gives the other side. */
  private crossKnownLines(): boolean {
    const { regions, bands, ladder } = this;
    let changed = false;
    for (let id = 0; id <= this.input.lines.length; id += 1) {
      const level = this.values[id];
      if (level === undefined) continue;
      // Drawing a curve leaves pockets of a cell or two along it; they are not sides.
      const sides = [...regions.lineRegions[id]!].filter((side) => regions.size[side]! >= MIN_SIDE_CELLS);
      if (sides.length !== 2) continue;
      for (const [from, to] of [[sides[0]!, sides[1]!], [sides[1]!, sides[0]!]] as const) {
        const band = bands[from];
        if (!band || band === "bad" || bands[to] !== undefined) continue;
        const other = ladder.same(band.low, level) ? band.high : ladder.same(band.high, level) ? band.low : undefined;
        if (other === undefined) continue;
        const far = ladder.beyond(level, other);
        if (!this.allowed(far)) continue;
        changed = this.assign(to, { low: Math.min(level, far), high: Math.max(level, far) }) || changed;
      }
    }
    return changed;
  }

  /** An unknown line takes the one level every band beside it allows. */
  private inferFromBands(): boolean {
    const { regions, bands, ladder, values } = this;
    let changed = false;
    this.input.lines.forEach((_, id) => {
      if (values[id] !== undefined || this.land[id]) return;
      const sides = [...regions.lineRegions[id]!];
      // A line with the same region on both sides is a dangling fragment; it bounds nothing.
      if (sides.length < 2) return;
      let candidates: number[] | undefined;
      for (const side of sides) {
        const band = bands[side];
        if (!band || band === "bad") continue;
        const pair = [band.low, band.high];
        candidates = candidates ? candidates.filter((value) => pair.some((other) => ladder.same(other, value))) : pair;
      }
      // A band whose known lines all lie on one edge, with this as its only
      // unknown line, has this line as its other edge. (An unlabelled hump
      // ring of the same level would be misread here; charts label those.)
      if (candidates?.length !== 1) candidates = this.soleUnknownEdge(id, sides) ?? candidates;
      candidates = candidates?.filter((value) => this.allowed(value));
      if (candidates?.length === 1) {
        values[id] = candidates[0];
        this.inferred[id] = true;
        changed = true;
      }
    });
    return changed;
  }

  private soleUnknownEdge(id: number, sides: number[]): number[] | undefined {
    const { regions, bands, ladder, values } = this;
    for (const side of sides) {
      const band = bands[side];
      if (!band || band === "bad" || regions.size[side]! < MIN_SIDE_CELLS) continue;
      const members = [...regions.regionLines[side]!];
      if (members.some((other) => other !== id && values[other] === undefined)) continue;
      const edges = new Set(members.filter((other) => other !== id).map((other) => (ladder.same(values[other]!, band.low) ? "low" : ladder.same(values[other]!, band.high) ? "high" : "neither")));
      if (edges.size !== 1 || edges.has("neither")) continue;
      return [edges.has("low") ? band.high : band.low];
    }
    return undefined;
  }

  /**
   * How strongly two lines face each other: only as much as each sees the
   * other. A long line (a frame, a road) collects rays that slip through
   * gaps in the lines between; it does not see the far line back.
   */
  private mutual(id: number, other: number, count: number): number {
    if (other === this.shoreId) return count;
    let back = 0;
    for (const side of this.facing[other]!.sides) back += side.get(id) ?? 0;
    return Math.min(count, back);
  }

  /**
   * One round over the facing graph. Each rule weighs its evidence by how
   * many samples agree, and a line takes a level only on a clear majority,
   * so a stray ray through an unbridged gap outvotes nothing.
   * - Between: a line whose sides face known levels two rungs apart is the rung between.
   * - Orientation: a known line facing a known neighbour one rung away learns its higher side.
   * - Propagation: a known, oriented line gives the rung above to what faces
   *   its higher side, and the rung below to what faces its lower side.
   */
  private faceStep(): boolean {
    let changed = this.orientKnownLines();
    changed = this.markLandBeyondShore() || changed;
    const candidates = new Map<number, Map<number, number>>();
    const propose = (id: number, level: number, weight: number) => {
      if (!this.allowed(level) || this.land[id]) return;
      const tally = candidates.get(id) ?? new Map<number, number>();
      const key = Math.round(level * 1e6) / 1e6;
      tally.set(key, (tally.get(key) ?? 0) + weight);
      candidates.set(id, tally);
    };
    this.proposeFromOrientedLines(propose);
    this.proposeBetweenNeighbours(propose);
    for (const [id, tally] of candidates) {
      const best = strongest(tally);
      let total = 0;
      for (const weight of tally.values()) total += weight;
      if (!best || !decisive(best[1], total)) continue;
      this.values[id] = best[0];
      this.inferred[id] = true;
      changed = true;
    }
    return changed;
  }

  private orientKnownLines(): boolean {
    const { values, higher, facing, ladder } = this;
    let changed = false;
    this.input.lines.forEach((_, id) => {
      const level = values[id];
      if (level === undefined || higher[id] !== undefined) return;
      const votes = [0, 0];
      for (const side of [LEFT, RIGHT]) {
        for (const [other, count] of facing[id]!.sides[side]!) {
          const neighbour = values[other];
          if (neighbour === undefined || !ladder.adjacent(neighbour, level)) continue;
          votes[neighbour > level ? side : 1 - side]! += this.mutual(id, other, count);
        }
      }
      const side = votes[LEFT]! >= votes[RIGHT]! ? LEFT : RIGHT;
      if (decisive(votes[side]!, votes[LEFT]! + votes[RIGHT]!)) {
        higher[id] = side;
        changed = true;
      }
    });
    return changed;
  }

  /**
   * What the land side of a surface-level line faces is land (a frame, a
   * road, the legend) and takes no level, however rays through gaps in the
   * lines vote. Only what the shore faces directly: spreading further would
   * leak back into the lake through the same gaps.
   */
  private markLandBeyondShore(): boolean {
    const { values, higher, facing, land, bound, ladder, shoreId } = this;
    let changed = false;
    this.input.lines.forEach((_, id) => {
      const level = values[id];
      const up = higher[id];
      if (level === undefined || up === undefined || bound === undefined || !ladder.same(level, bound)) return;
      for (const [other, count] of facing[id]!.sides[1 - up]!) {
        if (other === shoreId || land[other] || values[other] !== undefined || this.mutual(id, other, count) < MIN_VOTES) continue;
        land[other] = true;
        changed = true;
      }
    });
    return changed;
  }

  private proposeFromOrientedLines(propose: (id: number, level: number, weight: number) => void): void {
    const { values, higher, facing, ladder, shoreId } = this;
    this.input.lines.forEach((_, id) => {
      const level = values[id];
      const up = higher[id];
      if (level === undefined || up === undefined) return;
      for (const side of [LEFT, RIGHT]) {
        const next = side === up ? ladder.rungAbove(level) : ladder.rungBelow(level);
        for (const [other, count] of facing[id]!.sides[side]!) if (other !== shoreId && values[other] === undefined) propose(other, next, this.mutual(id, other, count));
      }
    });
  }

  private proposeBetweenNeighbours(propose: (id: number, level: number, weight: number) => void): void {
    const { values, facing, ladder } = this;
    this.input.lines.forEach((_, id) => {
      if (values[id] !== undefined) return;
      // Sample by sample, since a long line faces different neighbours along
      // its length; only neighbours that see this line back count.
      for (const [left, right] of facing[id]!.pairs) {
        if (left === undefined || right === undefined) continue;
        const a = values[left];
        const b = values[right];
        if (a === undefined || b === undefined || ladder.same(a, b)) continue;
        const [low, high] = a < b ? [a, b] : [b, a];
        const between = ladder.rungAbove(low);
        // Exactly one rung strictly between; the surface need not sit on the ladder (320 between 315 and a 322 ft pool).
        if (between < high - EPSILON * Math.max(1, Math.abs(high)) && ladder.rungAbove(between) >= high - EPSILON * Math.max(1, Math.abs(high))) propose(id, between, 1);
      }
    });
  }
}

/**
 * A label is in conflict when a region beside it holds labels no single band
 * can: the labels themselves disagree. Contradictions that involve inferred
 * lines usually mean a leak between regions, not a wrong label.
 */
function labelConflicts(input: LevelInput, regions: Regions, ladder: Ladder): number[] {
  const { lines } = input;
  const shoreId = lines.length;
  const conflicts: number[] = [];
  lines.forEach((line, id) => {
    if (line.value === undefined) return;
    for (const side of regions.lineRegions[id]!) {
      const labelled: number[] = [];
      for (const other of regions.regionLines[side]!) {
        const value = other === shoreId ? input.shoreline?.value : lines[other]!.value;
        if (value !== undefined && !labelled.some((seen) => ladder.same(seen, value))) labelled.push(value);
      }
      const [a, b] = labelled;
      if (labelled.length > 2 || (a !== undefined && b !== undefined && !ladder.adjacent(a, b))) {
        conflicts.push(id);
        return;
      }
    }
  });
  return conflicts;
}

export function inferLevels(input: LevelInput): LevelResult {
  const { lines, interval } = input;
  if (!(interval > 0)) throw new Error("Level inference needs a positive contour interval.");
  const raster = rasterizeLines(input);
  const regions = floodRegions(raster, lines.length);
  const ladder = new Ladder(lines.find((line) => line.value !== undefined)?.value ?? input.shoreline?.value ?? 0, interval, input.inward);
  const solver = new LevelSolver(input, regions, facingGraph(lines, raster, Math.max(input.width, input.height)), ladder);
  solver.solve();
  const { bands } = solver;
  return {
    values: solver.values.slice(0, lines.length),
    inferred: solver.inferred,
    conflicts: labelConflicts(input, regions, ladder),
    regions: { total: regions.count, banded: bands.filter((band) => band && band !== "bad").length, contradictory: bands.filter((band) => band === "bad").length },
  };
}
