// A scanned chart to contours with levels. The scan is reduced to one-pixel
// ink lines, the lines become paths with their stroke width, and from there
// it is the vector route: chaining, label gaps, labels, and level inference.
// Depths come from the maker: words placed by hand in the batch manifest or
// read from a vector PDF's text layer, and marks clicked in the studio. No
// label is read by machine; see raster-labels.

import { pathLength } from "./geometry.ts";
import type { Point2 } from "./local-frame.ts";
import { close, colourMask, darkMask, downsample, eraseBoxes, inkDistance, otsu, removeSmall, thin, type Mask, type RgbaImage, type Rgb } from "./raster.ts";
import { bulgeCandidates, labelCandidates, mergeCandidates, type LabelCandidate } from "./raster-labels.ts";
import { traceVectorChart, type VectorTrace } from "./trace-vector.ts";
import { styleKey } from "./vector-chart.ts";
import type { VectorPath, VectorText } from "./vector-page.ts";

/** A label and the box of ink it is printed in, which is erased before tracing. */
export interface ChartWord {
  text: string;
  /** Box in original image pixels. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Reading direction in radians, y down; 0 for upright text, NaN when unknown. */
  angle?: number;
  /** Extent along and across the reading direction; the box alone overstates or understates both for turned text. */
  length?: number;
  height?: number;
}

/**
 * A depth the maker placed by clicking the contour it belongs to, in original
 * image pixels. Unlike a word it covers no ink, so nothing is erased under it:
 * erasing a box around a point on the line cuts the line there, and on a
 * diagonal the cut ends can fall out of reach. A mark has no reading direction
 * and binds to the traced line nearest it within `reach`.
 */
export interface PlacedMark {
  x: number;
  y: number;
  value: number;
  /** How far from a line the click may land and still count, in original pixels. */
  reach: number;
}

export interface SkeletonLine {
  points: Point2[];
  closed: boolean;
  /** Mean stroke width along the line in pixels. */
  width: number;
  /** Stroke width at each point, while the line is still pixel by pixel. */
  widths?: number[];
}

export interface RasterTraceOptions {
  /** Extract joined contour paths without requiring labels or an interval. */
  geometryOnly?: boolean;
  /** Ink to trace: chosen swatches, or everything darker than a threshold (Otsu when absent). */
  ink?: { colours: Rgb[]; tolerance?: number } | { threshold?: number };
  words?: ChartWord[];
  /** Depths placed by clicking lines; see PlacedMark. */
  marks?: PlacedMark[];
  labels: "depth" | "elevation";
  surface?: number;
  interval?: number;
  /** Map rectangle in original image pixels. */
  mapArea?: { left: number; top: number; right: number; bottom: number };
  /** Longest side the scan is traced at. */
  maxSide?: number;
  /**
   * How to find the shoreline. "none" (the default) treats every line as a
   * contour; the shore is then inferred as depth 0 from the band beside it.
   * "auto" takes a clearly heavier class of lines, for charts that draw the
   * shore bold; a width in original pixels splits lines at it. Frames, roads
   * and lettering are often heavier too, so "auto" wants a map area.
   */
  shoreline?: "auto" | "none" | { minWidth: number };
}

export interface RasterTrace extends VectorTrace {
  /** Traced lines before chaining, in original pixels, with the width class each was given. */
  lines: (SkeletonLine & { shoreline: boolean })[];
  /** Pixel scale the scan was traced at: original pixels per traced pixel. */
  scale: number;
}

const NEIGHBOURS: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * Walks a one-pixel skeleton into lines. A pixel's role comes from how many
 * separate branches leave it (0-to-1 transitions around it), not from its
 * neighbour count, so thinning's staircase corners stay inside lines.
 * Branches shorter than `minSpur` that dead-end are pruned first.
 */
export function skeletonLines(skeleton: Mask, width: Float32Array | undefined, minSpur = 6): SkeletonLine[] {
  const mask: Mask = { ...skeleton, data: new Uint8Array(skeleton.data) };
  for (let pass = 0; pass < 3; pass += 1) {
    const lines = walk(mask, width);
    let pruned = false;
    for (const line of lines) {
      if (line.line.closed || line.pixels.length >= minSpur) continue;
      const [first, last] = [line.pixels[0]!, line.pixels.at(-1)!];
      const ends = [branches(mask, first), branches(mask, last)];
      // A spur runs from a junction to a dead end; an isolated short line is noise too.
      if (!ends.includes(1)) continue;
      for (const pixel of line.pixels) if (branches(mask, pixel) < 3) mask.data[pixel] = 0;
      pruned = true;
    }
    if (!pruned) return lines.filter((line) => line.pixels.length >= 2).map((line) => line.line);
  }
  return walk(mask, width).filter((line) => line.pixels.length >= 2).map((line) => line.line);
}

function branches(mask: Mask, cell: number): number {
  const x = cell % mask.width;
  const y = Math.floor(cell / mask.width);
  const ring = NEIGHBOURS.map(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < mask.width && ny < mask.height ? mask.data[ny * mask.width + nx]! : 0;
  });
  let count = 0;
  for (let index = 0; index < 8; index += 1) if (!ring[index] && ring[(index + 1) % 8]) count += 1;
  // A pixel whose whole ring is ink is inside a blob, which thinning leaves as a junction.
  return count === 0 && ring.every(Boolean) ? 3 : count;
}

function walk(mask: Mask, width: Float32Array | undefined): { pixels: number[]; line: SkeletonLine }[] {
  const { width: w, height: h, data } = mask;
  const node = new Uint8Array(data.length);
  for (let cell = 0; cell < data.length; cell += 1) if (data[cell] && branches(mask, cell) !== 2) node[cell] = 1;
  const visited = new Uint8Array(data.length);
  const out: { pixels: number[]; line: SkeletonLine }[] = [];
  const neighbours = (cell: number) => {
    const x = cell % w;
    const y = Math.floor(cell / w);
    const found: number[] = [];
    // Orthogonal neighbours first, so a walk follows a staircase step by step.
    for (const index of [0, 2, 4, 6, 1, 3, 5, 7]) {
      const [dx, dy] = NEIGHBOURS[index]!;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && data[ny * w + nx]) found.push(ny * w + nx);
    }
    return found;
  };
  const edgeSeen = new Set<string>();
  const trace = (start: number, first: number): number[] => {
    const pixels = [start, first];
    if (!node[first]) visited[first] = 1;
    let previous = start;
    let current = first;
    while (!node[current]) {
      const options = neighbours(current).filter((next) => next !== previous && (node[next] ? next !== start || pixels.length > 2 : !visited[next]));
      const next = options.find((candidate) => node[candidate]) ?? options[0];
      if (next === undefined) break;
      if (!node[next]) visited[next] = 1;
      pixels.push(next);
      previous = current;
      current = next;
    }
    return pixels;
  };
  const record = (pixels: number[], closed: boolean) => {
    const widths = pixels.map((pixel) => (width ? 2 * width[pixel]! : 1));
    out.push({
      pixels,
      line: {
        points: pixels.map((pixel): Point2 => [(pixel % w) + 0.5, Math.floor(pixel / w) + 0.5]),
        closed,
        width: widths.reduce((sum, value) => sum + value, 0) / pixels.length,
        widths,
      },
    });
  };
  for (let cell = 0; cell < data.length; cell += 1) {
    if (!node[cell]) continue;
    for (const next of neighbours(cell)) {
      // Adjacent junction pixels are one junction, not an edge between two.
      if (node[next]) continue;
      if (visited[next]) continue;
      const pixels = trace(cell, next);
      const key = `${Math.min(pixels[0]!, pixels.at(-1)!)}:${Math.max(pixels[0]!, pixels.at(-1)!)}:${pixels.length}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      record(pixels, false);
    }
    if (branches(mask, cell) === 0 && !neighbours(cell).length) record([cell], false);
  }
  // Whatever is left has no junction or end: closed loops.
  for (let cell = 0; cell < data.length; cell += 1) {
    if (!data[cell] || node[cell] || visited[cell]) continue;
    visited[cell] = 1;
    const pixels = [cell];
    let previous = -1;
    let current = cell;
    for (;;) {
      const next = neighbours(current).find((candidate) => candidate !== previous && !visited[candidate] && !node[candidate]);
      if (next === undefined) break;
      visited[next] = 1;
      pixels.push(next);
      previous = current;
      current = next;
    }
    record(pixels, pixels.length > 2);
  }
  return out;
}

/** Douglas-Peucker; keeps the first and last point. */
export function simplify(points: readonly Point2[], tolerance: number): Point2[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [x1, y1] = points[first]!;
    const [x2, y2] = points[last]!;
    const length = Math.hypot(x2 - x1, y2 - y1);
    let farthest = -1;
    let distance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const [x, y] = points[index]!;
      const d = length ? Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / length : Math.hypot(x - x1, y - y1);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * Splits lines into a thin and a heavy class by Otsu over their length-weighted
 * widths, and returns the split when the heavy class is clearly heavier and
 * carries a real share of the ink; otherwise every line is thin.
 */
export function heavyWidth(lines: readonly SkeletonLine[]): number | undefined {
  const lengths = lines.map((line) => pathLength(line.points));
  const widest = Math.max(0, ...lines.map((line) => line.width));
  if (!(widest > 0)) return undefined;
  const histogram = new Float64Array(256);
  lines.forEach((line, index) => {
    const bin = Math.min(255, Math.round((line.width / widest) * 255));
    histogram[bin] = histogram[bin]! + lengths[index]!;
  });
  const split = ((otsu(histogram) + 0.5) / 255) * widest;
  let thinSum = 0;
  let thinLength = 0;
  let heavySum = 0;
  let heavyLength = 0;
  lines.forEach((line, index) => {
    if (line.width > split) {
      heavySum += line.width * lengths[index]!;
      heavyLength += lengths[index]!;
    } else {
      thinSum += line.width * lengths[index]!;
      thinLength += lengths[index]!;
    }
  });
  if (!thinLength || !heavyLength) return undefined;
  const ratio = heavySum / heavyLength / (thinSum / thinLength);
  return ratio >= 1.5 && heavyLength / (heavyLength + thinLength) >= 0.03 ? split : undefined;
}

const CONTOUR_INK = "#000000";
const SHORE_INK = "#000001";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The scan shrunk to tracing size and its ink. */
function inkOf(image: RgbaImage, options: RasterTraceOptions): { small: RgbaImage; scale: number; mask: Mask; side: number } {
  const { image: small, scale } = downsample(image, options.maxSide ?? 4096);
  const ink = options.ink ?? {};
  const mask = "colours" in ink ? colourMask(small, ink.colours, ink.tolerance) : darkMask(small, ink.threshold);
  return { small, scale, mask, side: Math.max(small.width, small.height) };
}

/**
 * One-pixel lines of the ink, in traced pixels, with text boxes (traced
 * pixels) erased first: simplified for tracing, and raw, pixel by pixel with
 * the stroke width at each, for the label search.
 */
function linesOf(mask: Mask, side: number, erase: readonly Box[]): { lines: SkeletonLine[]; raw: SkeletonLine[] } {
  let clean = erase.length ? eraseBoxes(mask, erase, 1) : mask;
  // Specks, dots and lone digits OCR missed are too small to be contours.
  clean = close(removeSmall(clean, 12, Math.max(8, Math.round(side / 400))), 1);
  const raw = skeletonLines(thin(clean), inkDistance(clean), Math.max(6, Math.round(side / 600)));
  const lines = raw
    .map(({ widths: _pixelWidths, ...line }) => ({ ...line, points: simplify(line.points, 0.7) }))
    .filter((line) => line.points.length >= 2);
  return { lines, raw };
}

/** The ink with every line longer than `minLength` removed, stroke and a pixel of margin included. */
export function withoutLines(mask: Mask, lines: readonly SkeletonLine[], minLength: number): Mask {
  const data = new Uint8Array(mask.data);
  for (const line of lines) {
    if (pathLength(line.points) < minLength) continue;
    const radius = line.width / 2 + 1;
    const ring = line.closed ? [...line.points, line.points[0]!] : line.points;
    for (let index = 1; index < ring.length; index += 1) {
      const [x1, y1] = ring[index - 1]!;
      const [x2, y2] = ring[index]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
      for (let step = 0; step <= steps; step += 1) {
        const cx = x1 + ((x2 - x1) * step) / steps;
        const cy = y1 + ((y2 - y1) * step) / steps;
        for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
          for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
            if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) continue;
            if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) data[y * mask.width + x] = 0;
          }
        }
      }
    }
  }
  return { ...mask, data };
}

export function traceRasterChart(image: RgbaImage, options: RasterTraceOptions): RasterTrace {
  const { scale, mask, side } = inkOf(image, options);
  const words = options.words ?? [];
  const { lines } = linesOf(mask, side, words.map((word) => ({ left: word.left / scale, top: word.top / scale, right: word.right / scale, bottom: word.bottom / scale })));
  return finish(image, lines, scale, words, options);
}

export interface ScannedTraceOptions extends RasterTraceOptions {
  /** Glyph size range in original pixels; defaults scale with the scan. */
  glyph?: { min: number; max: number };
}

/**
 * The scanned-chart route with its printed labels erased: find label-sized
 * ink, then trace the lines without it, so numbers do not trace as scraps of
 * line and gaps they sat in bridge cleanly. Levels come from `words` and
 * `marks`, as in traceRasterChart; the labels found are returned, unread.
 */
export function traceScannedChart(image: RgbaImage, options: ScannedTraceOptions): RasterTrace & { candidates: LabelCandidate[] } {
  const { scale, mask, side } = inkOf(image, options);
  const minGlyph = options.glyph ? options.glyph.min / scale : Math.max(4, side / 1000);
  const maxGlyph = options.glyph ? options.glyph.max / scale : Math.max(12, side / 120);
  const given = (options.words ?? []).map((word) => ({ left: word.left / scale, top: word.top / scale, right: word.right / scale, bottom: word.bottom / scale }));
  // Labels sit in their contour's gap. Loose ones are small ink components;
  // ones filling the gap fuse into the line and swell its stroke. Look for
  // both, then trace again without them.
  const provisional = linesOf(mask, side, given);
  const residual = withoutLines(mask, provisional.lines, maxGlyph * 3);
  const bulges = bulgeCandidates(provisional.raw, minGlyph, maxGlyph);
  const found = mergeCandidates(bulges, labelCandidates(residual, provisional.lines, minGlyph, maxGlyph));
  const traced = linesOf(mask, side, [...found, ...given]).lines;
  // Loose labels take their reading direction from lines traced without labels in them.
  const candidates = mergeCandidates(bulges, labelCandidates(residual, traced, minGlyph, maxGlyph));
  return { ...finish(image, traced, scale, options.words ?? [], options), candidates };
}

function finish(image: RgbaImage, tracedPixels: readonly SkeletonLine[], scale: number, words: readonly ChartWord[], options: RasterTraceOptions): RasterTrace {
  const traced = tracedPixels.map((line) => ({ ...line, points: line.points.map(([x, y]): Point2 => [x * scale, y * scale]), width: line.width * scale }));
  const split = options.shoreline === undefined || options.shoreline === "none" ? undefined : options.shoreline === "auto" ? heavyWidth(traced) : options.shoreline.minWidth;
  const lines = traced.map((line) => ({ ...line, shoreline: split !== undefined && line.width > split }));
  const paths: VectorPath[] = lines.map((line) => ({ stroke: line.shoreline ? SHORE_INK : CONTOUR_INK, lineWidth: 1, dashed: false, points: line.points, closed: line.closed }));
  const texts: VectorText[] = words.map((word) => {
    // A word with no known direction (NaN) is placed by distance alone.
    const angle = word.angle ?? Number.NaN;
    const boxWidth = word.right - word.left;
    const boxHeight = word.bottom - word.top;
    // Without a direction, the shorter side of the box is the text height.
    const upright = Number.isFinite(angle) ? Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle)) : boxWidth >= boxHeight;
    return {
      text: word.text,
      x: (word.left + word.right) / 2,
      y: (word.top + word.bottom) / 2,
      angle,
      size: word.height ?? (upright ? boxHeight : boxWidth),
      width: word.length ?? (upright ? boxWidth : boxHeight),
    };
  });
  for (const mark of options.marks ?? []) {
    // labelChains reaches 0.9 of a label's size from its centre.
    const size = mark.reach / 0.9;
    texts.push({ text: String(mark.value), x: mark.x, y: mark.y, angle: Number.NaN, size, width: size });
  }
  const contourStyle = styleKey({ stroke: CONTOUR_INK, lineWidth: 1, dashed: false });
  const shoreStyle = styleKey({ stroke: SHORE_INK, lineWidth: 1, dashed: false });
  const trace = traceVectorChart({ width: image.width, height: image.height, paths, texts }, {
    contourStyles: [contourStyle],
    ...(options.geometryOnly ? { geometryOnly: true } : {}),
    ...(split === undefined ? {} : { shorelineStyles: [shoreStyle] }),
    labels: options.labels,
    continueThroughJunctions: true,
    dropStraightLines: true,
    ...(options.surface === undefined ? {} : { surface: options.surface }),
    ...(options.interval === undefined ? {} : { interval: options.interval }),
    ...(options.mapArea ? { mapArea: options.mapArea } : {}),
  });
  return { ...trace, lines, scale };
}
