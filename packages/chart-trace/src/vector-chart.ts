// Turns a vector chart page into contour chains with the depths their labels
// give. GIS exports split one contour into many short paths and break it
// around each label, and the same stroke style is reused for several levels,
// so paths are chained only where exactly two ends meet, bridged only across
// label-sized gaps that continue in the same direction, and labelled only
// where a label lies on and along the line.

import { pathLength } from "./geometry.ts";
import type { Point2 } from "./local-frame.ts";
import type { VectorPage, VectorPath, VectorText } from "./vector-page.ts";

export interface StrokeStyle {
  key: string;
  stroke: string;
  lineWidth: number;
  dashed: boolean;
  paths: number;
  /** Total stroked length in page units. */
  length: number;
}

export interface Chain {
  points: Point2[];
  closed: boolean;
  style: string;
}

export interface DepthLabel {
  value: number;
  x: number;
  y: number;
  angle: number;
  size: number;
  width: number;
}

export interface LabelledChain extends Chain {
  /** The labelled value in chart units, when its labels agree. */
  value?: number;
  labels: number[];
}

/** Cosine of the largest bend (about 25 degrees) still read as a line carrying on through a junction. */
const CONTINUATION = 0.9;
/** How squarely the ends of a gap with a label in it must face it (about 70 degrees). */
const LABELLED_GAP_ALIGNMENT = 0.3;

export function styleKey(path: Pick<VectorPath, "stroke" | "lineWidth" | "dashed">): string {
  return `${path.stroke ?? "none"}/${path.lineWidth.toFixed(2)}${path.dashed ? "/dashed" : ""}`;
}

/** Stroke styles on the page, longest first: the choices a maker (or a batch manifest) picks contours and shoreline from. */
export function strokeStyles(page: VectorPage): StrokeStyle[] {
  const styles = new Map<string, StrokeStyle>();
  for (const path of page.paths) {
    if (!path.stroke || path.points.length < 2) continue;
    const key = styleKey(path);
    const style = styles.get(key) ?? { key, stroke: path.stroke, lineWidth: Number(path.lineWidth.toFixed(2)), dashed: path.dashed, paths: 0, length: 0 };
    style.paths += 1;
    style.length += pathLength(path.points) + (path.closed ? Math.hypot(path.points[0]![0] - path.points.at(-1)![0], path.points[0]![1] - path.points.at(-1)![1]) : 0);
    styles.set(key, style);
  }
  return [...styles.values()].sort((a, b) => b.length - a.length);
}

const LABEL = /^((?:\d{1,4}|[1-9],\d{3})(?:\.\d+)?)\s*(?:'|′|ft|m)?$/i;

/** A depth or elevation label such as `15`, `10'`, `2.5 m`, or `1,020`; anything else is not a label. */
export function parseLabel(text: string): number | undefined {
  const match = LABEL.exec(text.trim());
  return match ? Number(match[1]!.replace(",", "")) : undefined;
}

export function depthLabels(texts: readonly VectorText[], within?: (x: number, y: number) => boolean): DepthLabel[] {
  const labels: DepthLabel[] = [];
  for (const text of texts) {
    const value = parseLabel(text.text);
    if (value === undefined || (within && !within(text.x, text.y))) continue;
    labels.push({ value, x: text.x, y: text.y, angle: text.angle, size: text.size, width: text.width });
  }
  return labels;
}

/**
 * Joins paths of one style end to end. Two ends within `tolerance` join only
 * when no third end is there too: on a vector chart a junction of three or
 * more is where lines of different levels touch, and joining through it would
 * mix them. On a scan, junctions are mostly other ink crossing a contour (a
 * section line, a road); `continueThroughJunctions` then pairs the ends at a
 * junction that carry straight on through it.
 */
export function chainPaths(paths: readonly VectorPath[], tolerance: number, continueThroughJunctions = false): Chain[] {
  const chains: Chain[] = [];
  const byStyle = new Map<string, VectorPath[]>();
  for (const path of paths) {
    if (!path.stroke || path.points.length < 2) continue;
    const key = styleKey(path);
    byStyle.set(key, [...(byStyle.get(key) ?? []), path]);
  }
  for (const [style, group] of byStyle) {
    const open: { points: Point2[] }[] = [];
    for (const path of group) {
      if (path.closed) chains.push({ points: [...path.points], closed: true, style });
      else open.push({ points: [...path.points] });
    }
    // Bucket ends on a tolerance grid; each end is (piece, 0 = start | 1 = end).
    const cell = (point: Point2) => `${Math.floor(point[0] / tolerance)},${Math.floor(point[1] / tolerance)}`;
    const buckets = new Map<string, [number, number][]>();
    open.forEach((piece, index) => {
      for (const side of [0, 1] as const) {
        const key = cell(side ? piece.points.at(-1)! : piece.points[0]!);
        buckets.set(key, [...(buckets.get(key) ?? []), [index, side]]);
      }
    });
    const endAt = (index: number, side: number) => (side ? open[index]!.points.at(-1)! : open[index]!.points[0]!);
    const partner = new Map<string, [number, number]>();
    open.forEach((_, index) => {
      for (const side of [0, 1] as const) {
        const here = endAt(index, side);
        const near: [number, number][] = [];
        const [cx, cy] = [Math.floor(here[0] / tolerance), Math.floor(here[1] / tolerance)];
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
              if (other[0] === index && other[1] === side) continue;
              const there = endAt(other[0], other[1]);
              if (Math.hypot(there[0] - here[0], there[1] - here[1]) <= tolerance) near.push(other);
            }
          }
        }
        if (near.length === 1) partner.set(`${index}:${side}`, near[0]!);
        else if (near.length > 1 && continueThroughJunctions) {
          // Ends leave a junction in opposite directions when one line runs through it.
          const out = direction(open[index]!.points, side === 1);
          let best: [number, number] | undefined;
          let straightest = -CONTINUATION;
          for (const other of near) {
            const theirs = direction(open[other[0]]!.points, other[1] === 1);
            const dot = out[0] * theirs[0] + out[1] * theirs[1];
            if (dot < straightest) {
              straightest = dot;
              best = other;
            }
          }
          if (best) partner.set(`${index}:${side}`, best);
        }
      }
    });
    // A join needs both ends to name each other as their only partner.
    const joined = (index: number, side: number) => {
      const other = partner.get(`${index}:${side}`);
      if (!other) return undefined;
      const back = partner.get(`${other[0]}:${other[1]}`);
      return back && back[0] === index && back[1] === side ? other : undefined;
    };
    const used = new Uint8Array(open.length);
    const walk = (startIndex: number, startSide: number): { points: Point2[]; closed: boolean } => {
      // Follow from the end opposite `startSide` onwards, appending pieces.
      const points: Point2[] = startSide ? [...open[startIndex]!.points].reverse() : [...open[startIndex]!.points];
      used[startIndex] = 1;
      let index = startIndex;
      let exit = startSide ? 0 : 1;
      for (;;) {
        const next = joined(index, exit);
        if (!next) return { points, closed: false };
        if (next[0] === startIndex) return { points, closed: true };
        if (used[next[0]]) return { points, closed: false };
        used[next[0]] = 1;
        const piece = next[1] ? [...open[next[0]]!.points].reverse() : open[next[0]]!.points;
        points.push(...piece.slice(1));
        index = next[0];
        exit = next[1] ? 0 : 1;
      }
    };
    // Start from pieces with a free end so open chains are walked from one end.
    open.forEach((_, index) => {
      if (used[index]) return;
      if (!joined(index, 0)) chains.push({ ...walk(index, 0), style });
      else if (!joined(index, 1)) chains.push({ ...walk(index, 1), style });
    });
    // Whatever is left is made only of joined pieces: closed loops.
    open.forEach((_, index) => {
      if (!used[index]) chains.push({ ...walk(index, 0), style });
    });
  }
  return chains;
}

/**
 * The heading out through one end, measured from the point about `reach`
 * back along the line (or three vertices back without one): far enough that
 * a jittery last pixel does not decide it, near enough to follow a curve.
 */
function direction(points: readonly Point2[], atEnd: boolean, reach?: number): Point2 {
  const ordered = atEnd ? [...points].reverse() : points;
  const tip = ordered[0]!;
  let back = ordered[Math.min(ordered.length - 1, 3)]!;
  if (reach !== undefined) {
    back = ordered.at(-1)!;
    for (const point of ordered) {
      if (Math.hypot(point[0] - tip[0], point[1] - tip[1]) >= reach) {
        back = point;
        break;
      }
    }
  }
  const dx = tip[0] - back[0];
  const dy = tip[1] - back[1];
  const size = Math.hypot(dx, dy) || 1;
  return [dx / size, dy / size];
}

/**
 * Joins open chains of one style across the gaps a chart leaves for its
 * labels: the ends must be within `maxGap`, both must point across the gap,
 * and the closest pairs are joined first. Each end needs `minAlignment`
 * with the gap and the two together `minCombined`, which lets one end curve
 * into a bend while the other runs straight across. A label sitting in the
 * gap is the reason it exists, so there the ends need only roughly face.
 */
export function bridgeGaps(chains: readonly Chain[], maxGap: number, minAlignment = 0.6, minCombined = 1.5, labels: readonly Point2[] = []): Chain[] {
  const out = chains.map((chain) => ({ ...chain, points: [...chain.points] }));
  // Ends are kept as the point objects themselves, which survive merging.
  const candidates: { a: number; aEnd: boolean; b: number; bEnd: boolean; pa: Point2; pb: Point2; gap: number }[] = [];
  for (let a = 0; a < out.length; a += 1) {
    if (out[a]!.closed) continue;
    // b === a pairs a chain's tail with its own head: a ring broken by one label.
    for (let b = a; b < out.length; b += 1) {
      if (out[b]!.closed || out[b]!.style !== out[a]!.style) continue;
      if (b === a && out[a]!.points.length < 3) continue;
      for (const aEnd of [false, true]) {
        for (const bEnd of [false, true]) {
          if (b === a && (!aEnd || bEnd)) continue;
          const p = aEnd ? out[a]!.points.at(-1)! : out[a]!.points[0]!;
          const q = bEnd ? out[b]!.points.at(-1)! : out[b]!.points[0]!;
          const gap = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (gap > maxGap || gap === 0) continue;
          const across: Point2 = [(q[0] - p[0]) / gap, (q[1] - p[1]) / gap];
          const da = direction(out[a]!.points, aEnd, maxGap);
          const db = direction(out[b]!.points, bEnd, maxGap);
          // Each chain must head out through its own end towards the other.
          const alignA = da[0] * across[0] + da[1] * across[1];
          const alignB = -(db[0] * across[0] + db[1] * across[1]);
          const middle: Point2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const labelled = labels.some(([x, y]) => Math.hypot(x - middle[0], y - middle[1]) <= gap / 2);
          if (labelled ? alignA < LABELLED_GAP_ALIGNMENT || alignB < LABELLED_GAP_ALIGNMENT : alignA < minAlignment || alignB < minAlignment || alignA + alignB < minCombined) continue;
          candidates.push({ a, aEnd, b, bEnd, pa: p, pb: q, gap });
        }
      }
    }
  }
  candidates.sort((x, y) => x.gap - y.gap);
  // Union chains by id; ends become unavailable once used.
  const usedEnds = new Set<string>();
  const owner = out.map((_, index) => index);
  const root = (index: number): number => (owner[index] === index ? index : (owner[index] = root(owner[index]!)));
  for (const { a, aEnd, b, bEnd, pa, pb } of candidates) {
    const keyA = `${a}:${aEnd}`;
    const keyB = `${b}:${bEnd}`;
    if (usedEnds.has(keyA) || usedEnds.has(keyB)) continue;
    const ra = root(a);
    const rb = root(b);
    const chainA = out[ra]!;
    const chainB = out[rb]!;
    const aAtTail = chainA.points.at(-1) === pa;
    const aAtHead = chainA.points[0] === pa;
    const bAtHead = chainB.points[0] === pb;
    const bAtTail = chainB.points.at(-1) === pb;
    usedEnds.add(keyA);
    usedEnds.add(keyB);
    if (ra === rb) {
      if ((aAtTail && bAtHead) || (aAtHead && bAtTail)) chainA.closed = true;
      continue;
    }
    if (!(aAtTail || aAtHead) || !(bAtHead || bAtTail)) continue;
    const first = aAtTail ? chainA.points : [...chainA.points].reverse();
    const second = bAtHead ? chainB.points : [...chainB.points].reverse();
    chainA.points = [...first, ...second];
    owner[rb] = ra;
    chainB.points = [];
  }
  return out.filter((chain, index) => root(index) === index && chain.points.length >= 2);
}

/**
 * Gives each chain the value of the labels lying on it. A label counts when
 * its centre is within about its own height of the chain and it reads along
 * the chain; a chain whose labels disagree gets no value.
 */
export function labelChains(chains: readonly Chain[], labels: readonly DepthLabel[], minAlignment = 0.85): LabelledChain[] {
  const out: LabelledChain[] = chains.map((chain) => ({ ...chain, labels: [] }));
  for (const label of labels) {
    let best: { chain: number; distance: number } | undefined;
    const reach = Math.max(1, label.size * 0.9);
    out.forEach((chain, index) => {
      const ring = chain.closed ? [...chain.points, chain.points[0]!] : chain.points;
      for (let vertex = 1; vertex < ring.length; vertex += 1) {
        const [x1, y1] = ring[vertex - 1]!;
        const [x2, y2] = ring[vertex]!;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const span = Math.hypot(dx, dy);
        if (!span) continue;
        const t = Math.max(0, Math.min(1, ((label.x - x1) * dx + (label.y - y1) * dy) / (span * span)));
        const distance = Math.hypot(label.x - x1 - t * dx, label.y - y1 - t * dy);
        if (distance > reach || (best && distance >= best.distance)) continue;
        // Labels read along the line, in either direction.
        if (Number.isFinite(label.angle) && Math.abs((dx / span) * Math.cos(label.angle) + (dy / span) * Math.sin(label.angle)) < minAlignment) continue;
        best = { chain: index, distance };
      }
    });
    if (best) out[best.chain]!.labels.push(label.value);
  }
  for (const chain of out) {
    const values = new Set(chain.labels);
    if (values.size === 1) chain.value = chain.labels[0];
  }
  return out;
}
