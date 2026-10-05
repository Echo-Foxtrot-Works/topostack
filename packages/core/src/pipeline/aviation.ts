import { aviationSymbolPaths, aviationSymbolRadius, aviationSymbolStandsOnAnchor } from "../annotate/aviation-symbols.js";
import { DEFAULT_AVIATION_MM, DEFAULT_AVIATION_SYMBOL_MM, type AviationClass, type AviationDetailsV1, type AviationSymbol, type LineStyleV1, type MarkingFeature, type Point2D, type ProjectConfigV1 } from "../types.js";

/**
 * FAA aviation detail: which classes a project draws, how each is stroked, and
 * how source features become engraving paths. Source features arrive already
 * projected to millimetres (see SourceBundleV1.aviationMarkings); symbols and
 * runway outlines are built here so their size follows the line style rather
 * than whatever scale the source was loaded at.
 */

const DETAIL_FOR_CLASS: Record<AviationClass, Exclude<keyof AviationDetailsV1, "labels">> = {
  "class-b": "airspace", "class-c": "airspace", "class-d": "airspace",
  "special-use": "specialUse", runway: "runways", airport: "airports", navaid: "navaids", obstacle: "obstacles",
};

/** Aviation groups that need data loaded; labels alone draw nothing. */
export const AVIATION_DATA_DETAILS = ["airspace", "specialUse", "runways", "airports", "navaids", "obstacles"] as const satisfies ReadonlyArray<keyof AviationDetailsV1>;

export const NO_AVIATION: AviationDetailsV1 = { airspace: false, specialUse: false, runways: false, airports: false, navaids: false, obstacles: false, labels: false };

export function aviationClassEnabled(aviationClass: AviationClass, config: Pick<ProjectConfigV1, "aviation">): boolean {
  return config.aviation?.[DETAIL_FOR_CLASS[aviationClass]] === true;
}

/** True when any aviation data must be loaded. */
export function aviationRequested(config: Pick<ProjectConfigV1, "aviation">): boolean {
  return AVIATION_DATA_DETAILS.some((detail) => config.aviation?.[detail] === true);
}

export interface AviationStroke {
  widthMm: number;
  /** Dash and gap lengths in millimetres; absent for a solid line. */
  dash?: number[];
}

/**
 * The single-colour stand-in for the sectional's blue and magenta: Class B is
 * the heaviest solid line, Class C solid, Class D dashed. Special use airspace
 * is a solid line whose inside hatching is drawn as geometry (see
 * `specialUseHatching`). Shared by the machine SVG and every studio preview.
 */
export function aviationStroke(aviationClass: AviationClass, style: Pick<LineStyleV1, "aviationMm">): AviationStroke {
  const width = style.aviationMm ?? DEFAULT_AVIATION_MM;
  if (aviationClass === "class-b") return { widthMm: width * 1.5 };
  if (aviationClass === "class-d") return { widthMm: width, dash: [Math.max(width * 8, 1.6), Math.max(width * 5, 1)] };
  return { widthMm: width };
}

export function aviationSymbolSize(style: Pick<LineStyleV1, "aviationSymbolMm">): number {
  return style.aviationSymbolMm ?? DEFAULT_AVIATION_SYMBOL_MM;
}

/** Symbol widths per stroke below which rings, letters and knockouts close up (the defaults give 13). */
const MIN_SYMBOL_STROKES = 10;

/** True when symbols are too small for their stroke to keep their inner detail open. */
export function aviationSymbolsFillIn(style: Pick<LineStyleV1, "aviationMm" | "aviationSymbolMm">): boolean {
  return aviationSymbolSize(style) < MIN_SYMBOL_STROKES * (style.aviationMm ?? DEFAULT_AVIATION_MM);
}

/**
 * A runway as engraved: its true-width outline when that is at least three
 * strokes wide at this scale, otherwise its centerline.
 */
export function runwayPaths(points: Point2D[], widthM: number | undefined, mmPerMeter: number, style: Pick<LineStyleV1, "aviationMm">): Point2D[][] {
  const [start, end] = [points[0], points.at(-1)];
  const widthMm = (widthM ?? 0) * mmPerMeter;
  const stroke = style.aviationMm ?? DEFAULT_AVIATION_MM;
  if (!start || !end || points.length !== 2 || widthMm < stroke * 3) return [points];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length <= widthMm) return [points];
  const half = widthMm / 2;
  const normal = { x: -(end.y - start.y) / length * half, y: (end.x - start.x) / length * half };
  const corner = (point: Point2D, sign: number) => ({ x: point.x + normal.x * sign, y: point.y + normal.y * sign });
  const outline = [corner(start, 1), corner(end, 1), corner(end, -1), corner(start, -1)];
  return [[...outline, { ...outline[0]! }]];
}

/**
 * The sectional's special use airspace border: short ticks at right angles to
 * the boundary, on its inside. The archive writes every ring with its area on
 * the left (holes included) and tile stitching keeps that direction, so the
 * ticks go to the left of travel, even on a piece clipped open by the crop.
 */
export function specialUseHatching(points: Point2D[], style: Pick<LineStyleV1, "aviationMm">): Point2D[][] {
  const width = style.aviationMm ?? DEFAULT_AVIATION_MM;
  const spacing = Math.max(width * 3, 0.6);
  const length = Math.max(width * 5, 1.1);
  const ticks: Point2D[][] = [];
  let next = spacing / 2;
  let travelled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment <= 0) continue;
    // Left of travel on a y-down page is (dy, -dx).
    const normal = { x: (b.y - a.y) / segment * length, y: -(b.x - a.x) / segment * length };
    while (next <= travelled + segment) {
      const t = (next - travelled) / segment;
      const base = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      ticks.push([base, { x: base.x + normal.x, y: base.y + normal.y }]);
      next += spacing;
    }
    travelled += segment;
  }
  return ticks;
}

export interface AviationLabelCandidate {
  id: string;
  label: string;
  aviationClass: AviationClass;
  anchor: Point2D;
  /** Distance from the anchor that the symbol occupies. */
  clearanceMm: number;
  /** Lower places first when labels compete for space. */
  priority: number;
}

/** Label order by symbol; a towered field also outranks every untowered one. */
const LABEL_PRIORITY: Partial<Record<AviationSymbol, number>> = {
  "airport-pattern": 1, "airport-hard": 1, "airport-joint": 1, "airport-military": 1, airport: 2, "seaplane-base": 3,
  vortac: 3, "vor-dme": 3, vor: 3, tacan: 4, ndb: 5, "ndb-dme": 5, dme: 5, heliport: 6,
};

/**
 * Symbols a crowded area may leave out, first left out last: the sectional
 * charts every public field and navaid, but only selected private fields,
 * heliports and obstacles where they would overlap. Symbols not listed are
 * always drawn.
 */
const OPTIONAL_SYMBOL_RANK: Partial<Record<AviationSymbol, number>> = {
  "airport-private": 0, heliport: 1, "obstacle-tall": 2, "obstacle-group-tall": 2,
  obstacle: 3, "obstacle-group": 3, "wind-turbine": 3, "wind-turbine-group": 3,
};

/** Millimetre bounds on the page, y down. */
export interface AviationSymbolBox { left: number; top: number; right: number; bottom: number }
type Box = AviationSymbolBox;

/** The area a symbol covers; obstacles stand on their position, everything else centers on it. */
function symbolBox(symbol: AviationSymbol, anchor: Point2D, sizeMm: number): Box {
  if (aviationSymbolStandsOnAnchor(symbol)) return { left: anchor.x - sizeMm * 0.35, right: anchor.x + sizeMm * 0.35, top: anchor.y - sizeMm, bottom: anchor.y };
  const radius = sizeMm * 0.4;
  return { left: anchor.x - radius, right: anchor.x + radius, top: anchor.y - radius, bottom: anchor.y + radius };
}

/**
 * The point features to leave out so optional symbols never print over another
 * symbol. Every always-drawn symbol is placed first; then optional ones in rank
 * order, keeping the source order within a rank (the loader lists the tallest
 * obstacles first), each kept only where it overlaps nothing already kept.
 */
function crowdedSymbols(points: readonly MarkingFeature[], sizeMm: number): Set<MarkingFeature> {
  const cell = Math.max(sizeMm, 0.5);
  const grid = new Map<string, Box[]>();
  const cells = (box: Box) => {
    const keys: string[] = [];
    for (let x = Math.floor(box.left / cell); x <= Math.floor(box.right / cell); x += 1) for (let y = Math.floor(box.top / cell); y <= Math.floor(box.bottom / cell); y += 1) keys.push(`${x},${y}`);
    return keys;
  };
  const overlaps = (box: Box) => cells(box).some((key) => grid.get(key)?.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top));
  const keep = (box: Box) => cells(box).forEach((key) => { const boxes = grid.get(key); if (boxes) boxes.push(box); else grid.set(key, [box]); });
  const rank = (point: MarkingFeature) => OPTIONAL_SYMBOL_RANK[point.aviationSymbol!] ?? -1;
  const crowded = new Set<MarkingFeature>();
  for (const point of points.map((point, index) => ({ point, index })).sort((left, right) => rank(left.point) - rank(right.point) || left.index - right.index).map(({ point }) => point)) {
    const box = symbolBox(point.aviationSymbol!, point.points[0]!, sizeMm);
    if (rank(point) >= 0 && overlaps(box)) crowded.add(point);
    else keep(box);
  }
  return crowded;
}

/**
 * Enabled aviation features as engraving line features, plus the identifier
 * labels to place once every line is routed and the area each drawn symbol
 * covers, which labels keep clear of. Points become their symbols, less
 * optional ones that would print over another (see `crowdedSymbols`); runways
 * become outlines or centerlines.
 */
export function aviationFeatures(features: readonly MarkingFeature[], config: Pick<ProjectConfigV1, "aviation" | "lineStyle">, mmPerMeter: number): { lines: MarkingFeature[]; labels: AviationLabelCandidate[]; symbols: AviationSymbolBox[] } {
  const lines: MarkingFeature[] = [];
  const labels: AviationLabelCandidate[] = [];
  const symbols: AviationSymbolBox[] = [];
  const symbolMm = aviationSymbolSize(config.lineStyle);
  const strokeMm = config.lineStyle.aviationMm ?? DEFAULT_AVIATION_MM;
  const enabled = features.filter((feature) => feature.kind === "aviation" && feature.aviationClass && aviationClassEnabled(feature.aviationClass, config));
  const crowded = crowdedSymbols(enabled.filter((feature) => feature.aviationSymbol && feature.points[0]), symbolMm);
  for (const feature of enabled) {
    const aviationClass = feature.aviationClass!;
    const line = (points: Point2D[], index: number): MarkingFeature => ({ id: `${feature.id}-${index}`, kind: "aviation", operation: "engrave", aviationClass, points });
    if (feature.aviationSymbol) {
      const anchor = feature.points[0];
      if (!anchor || crowded.has(feature)) continue;
      symbols.push(symbolBox(feature.aviationSymbol, anchor, symbolMm));
      aviationSymbolPaths(feature.aviationSymbol, anchor, symbolMm, feature.aviationDetail, strokeMm).forEach((points, index) => lines.push(line(points, index)));
      // Private fields are symbols only: their identifiers crowd out the ones a reader looks for.
      const priority = LABEL_PRIORITY[feature.aviationSymbol];
      if (config.aviation?.labels && feature.label && priority !== undefined) labels.push({
        id: feature.id, label: feature.label, aviationClass, anchor,
        clearanceMm: aviationSymbolRadius(feature.aviationSymbol, symbolMm),
        priority: feature.aviationDetail?.towered ? 0 : priority,
      });
      continue;
    }
    const paths = aviationClass === "runway" ? runwayPaths(feature.points, feature.widthM, mmPerMeter, config.lineStyle)
      : aviationClass === "special-use" ? [feature.points, ...specialUseHatching(feature.points, config.lineStyle)]
      : [feature.points];
    paths.forEach((points, index) => lines.push(line(points, index)));
  }
  labels.sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  return { lines, labels, symbols };
}
