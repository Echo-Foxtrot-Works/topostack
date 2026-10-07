import { formatNumber as format } from "../primitives/format.js";
import { rotatedPoint } from "../primitives/geometry2d.js";
import { DEFAULT_TEXT_STYLE, type Point2D, type Polygon2D, type TextFont, type TextStyleV1 } from "../types.js";
import { fontEntry, isBitmapFont, loadedFont, missingGlyphs } from "./font-data.js";

const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
  "C": ["011", "100", "100", "100", "011"], "D": ["110", "101", "101", "101", "110"],
  "E": ["111", "100", "110", "100", "111"], "F": ["111", "100", "110", "100", "100"],
  "G": ["011", "100", "101", "101", "011"], "H": ["101", "101", "111", "101", "101"],
  "I": ["111", "010", "010", "010", "111"], "J": ["001", "001", "001", "101", "010"],
  "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
  "M": ["10001", "11011", "10101", "10101", "10101"], "N": ["1001", "1101", "1011", "1001", "1001"],
  "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
  "Q": ["010", "101", "101", "011", "001"], "R": ["110", "101", "110", "101", "101"],
  "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
  "U": ["101", "101", "101", "101", "111"], "V": ["101", "101", "101", "101", "010"],
  "W": ["10101", "10101", "10101", "10101", "01010"], "X": ["101", "101", "010", "101", "101"],
  "Y": ["101", "101", "010", "010", "010"], "Z": ["111", "001", "010", "100", "111"],
  "m": ["00000", "11011", "10101", "10101", "10101"],
  "f": ["011", "010", "111", "010", "010"], "t": ["010", "111", "010", "010", "011"], "i": ["1", "0", "1", "1", "1"],
  "k": ["100", "101", "110", "101", "101"], "-": ["000", "000", "111", "000", "000"],
  "·": ["000", "000", "010", "000", "000"], ".": ["000", "000", "000", "000", "010"],
  ":": ["000", "010", "000", "010", "000"], "/": ["001", "001", "010", "100", "100"],
  "_": ["000", "000", "000", "000", "111"], "+": ["000", "010", "111", "010", "000"],
  " ": ["0", "0", "0", "0", "0"], "?": ["111", "001", "010", "000", "010"],
  ",": ["00", "00", "00", "01", "10"], "'": ["1", "1", "0", "0", "0"], "!": ["1", "1", "1", "0", "1"],
  "(": ["01", "10", "10", "10", "01"], ")": ["10", "01", "01", "01", "10"],
  "&": ["0100", "1010", "0100", "1011", "0110"], "#": ["01010", "11111", "01010", "11111", "01010"],
  "°": ["111", "101", "111", "000", "000"],
};

/**
 * Characters in `text` that `font` cannot draw; they would engrave as "?".
 * A curated typeface reports nothing until its glyph data has loaded.
 */
export function unsupportedLabelCharacters(text: string, font: TextFont = DEFAULT_TEXT_STYLE.font): string[] {
  if (!isBitmapFont(font)) return missingGlyphs(text, font);
  return [...new Set([...text].filter((character) => character !== "\n" && !GLYPHS[character] && !GLYPHS[character.toUpperCase()]))];
}

/** Whether text strokes take round caps and joins: the rounded style and single-line typefaces, which read as a pen line. */
export function roundText(style: TextStyleV1 | undefined): boolean {
  return style !== undefined && (style.font === "rounded" || fontEntry(style.font).kind === "single-line");
}

/** Whether a font engraves filled areas rather than strokes. */
function isFilledFont(font: TextFont | undefined): boolean {
  return font !== undefined && fontEntry(font).kind === "outline";
}

function glyphFor(character: string): string[] {
  return GLYPHS[character] ?? GLYPHS[character.toUpperCase()] ?? GLYPHS["?"]!;
}

function metrics(style: TextStyleV1): { cell: number; widthScale: number } {
  return { cell: style.sizeMm / 5, widthScale: style.font === "rounded" ? 1.14 : style.font === "stencil" ? 0.84 : 1 };
}

/**
 * The text box from the origin at its top-left: width to the last advance,
 * height from the cap line to the lowest descender. `sizeMm` is the cap
 * height for every font.
 */
export function labelDimensions(label: string, style: TextStyleV1 = DEFAULT_TEXT_STYLE): { width: number; height: number } {
  if (!isBitmapFont(style.font)) return glyphLayout(label, style).dimensions;
  const { cell, widthScale } = metrics(style);
  const advances = [...label].map((character) => ((glyphFor(character)[0]?.length ?? 1) + 1) * cell * widthScale);
  return {
    width: Math.max(0, advances.reduce((total, advance) => total + advance, 0) - cell * widthScale),
    height: style.sizeMm,
  };
}

export interface LabelLineSegment { start: Point2D; end: Point2D }

function occupied(glyph: string[], row: number, column: number): boolean {
  return glyph[row]?.[column] === "1";
}

function connectedGlyphSegments(glyph: string[], cursor: number, originY: number, cellX: number, cellY: number): LabelLineSegment[] {
  const segments: LabelLineSegment[] = [];
  glyph.forEach((row, rowIndex) => [...row].forEach((pixel, columnIndex) => {
    if (pixel !== "1") return;
    const center = { x: cursor + (columnIndex + 0.5) * cellX, y: originY + (rowIndex + 0.5) * cellY };
    let connected = false;
    if (occupied(glyph, rowIndex, columnIndex + 1)) {
      segments.push({ start: center, end: { x: center.x + cellX, y: center.y } });
      connected = true;
    }
    const nextColumns = occupied(glyph, rowIndex + 1, columnIndex)
      ? [columnIndex]
      : [columnIndex - 1, columnIndex + 1].filter((column) => occupied(glyph, rowIndex + 1, column));
    nextColumns.forEach((column) => {
      segments.push({ start: center, end: { x: cursor + (column + 0.5) * cellX, y: center.y + cellY } });
      connected = true;
    });
    const hasIncoming = occupied(glyph, rowIndex, columnIndex - 1) || occupied(glyph, rowIndex - 1, columnIndex) ||
      occupied(glyph, rowIndex - 1, columnIndex - 1) || occupied(glyph, rowIndex - 1, columnIndex + 1);
    if (!connected && !hasIncoming) segments.push({ start: { x: center.x - cellX * 0.12, y: center.y }, end: { x: center.x + cellX * 0.12, y: center.y } });
  }));
  return segments;
}

function splitForStencil(segment: LabelLineSegment): LabelLineSegment[] {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  return [
    { start: segment.start, end: { x: segment.start.x + dx * 0.38, y: segment.start.y + dy * 0.38 } },
    { start: { x: segment.start.x + dx * 0.62, y: segment.start.y + dy * 0.62 }, end: segment.end },
  ];
}

interface GlyphPlacement { character: string; x: number }

/** Pen positions in millimeters from the origin, kerned; shared by measurement and drawing. */
function glyphLayout(label: string, style: TextStyleV1): { font: ReturnType<typeof loadedFont>; scale: number; placements: GlyphPlacement[]; dimensions: { width: number; height: number } } {
  const font = loadedFont(style.font);
  const { capHeight, descender, kerning } = font.data;
  const scale = style.sizeMm / capHeight;
  const characters = [...label];
  const placements: GlyphPlacement[] = [];
  let cursor = 0;
  characters.forEach((character, index) => {
    placements.push({ character, x: cursor });
    const next = characters[index + 1];
    cursor += (font.glyph(character).advance + (next ? kerning[character + next] ?? 0 : 0)) * scale;
  });
  return { font, scale, placements, dimensions: { width: Math.max(0, cursor), height: (capHeight - descender) * scale } };
}

/** Text drawn at the origin: stroke polylines, and filled regions for outline typefaces. */
export interface LabelGeometry { strokes: Point2D[][]; fills: Polygon2D[] }

export function labelGeometry(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0, style: TextStyleV1 = DEFAULT_TEXT_STYLE): LabelGeometry {
  if (isBitmapFont(style.font)) return { strokes: labelLineSegments(label, origin, offsetX, offsetY, rotationRad, style).map(({ start, end }) => [start, end]), fills: [] };
  const { font, scale, placements } = glyphLayout(label, style);
  const { capHeight } = font.data;
  const rotationOrigin = { x: origin.x + offsetX, y: origin.y + offsetY };
  const strokes: Point2D[][] = [];
  const fills: Polygon2D[] = [];
  for (const { character, x } of placements) {
    const glyph = font.glyph(character);
    // Font units are y-up from the baseline; the label box is y-down from the cap line.
    const place = (points: Point2D[]) => points.map((point) => rotatedPoint({
      x: rotationOrigin.x + x + point.x * scale,
      y: rotationOrigin.y + (capHeight - point.y) * scale,
    }, rotationOrigin, rotationRad));
    glyph.strokes.forEach((stroke) => strokes.push(place(stroke)));
    glyph.fills.forEach((fill) => fills.push({ outer: place(fill.outer), holes: fill.holes.map(place) }));
  }
  return { strokes, fills };
}

/**
 * Text as straight segments for renderers that only draw lines. Outline
 * typefaces contribute their outlines; use `labelGeometry` to fill them.
 */
export function labelLineSegments(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0, style: TextStyleV1 = DEFAULT_TEXT_STYLE): LabelLineSegment[] {
  if (!isBitmapFont(style.font)) {
    const { strokes, fills } = labelGeometry(label, origin, offsetX, offsetY, rotationRad, style);
    return [...strokes, ...fills.flatMap((fill) => [fill.outer, ...fill.holes])]
      .flatMap((line) => line.slice(1).map((end, index) => ({ start: line[index]!, end })));
  }
  const { cell, widthScale } = metrics(style);
  let cursor = origin.x + offsetX;
  const segments: LabelLineSegment[] = [];
  for (const character of label) {
    const glyph = glyphFor(character);
    const width = glyph[0]?.length ?? 1;
    const rotationOrigin = { x: origin.x + offsetX, y: origin.y + offsetY };
    const glyphSegments = style.font === "technical"
      ? glyph.flatMap((row, rowIndex) => [...row].flatMap((pixel, columnIndex) => pixel === "1" ? [{
          start: { x: cursor + columnIndex * cell * widthScale, y: origin.y + offsetY + rowIndex * cell },
          end: { x: cursor + (columnIndex + 0.72) * cell * widthScale, y: origin.y + offsetY + rowIndex * cell },
        }] : []))
      : connectedGlyphSegments(glyph, cursor, origin.y + offsetY, cell * widthScale, cell)
        .flatMap((segment) => style.font === "stencil" ? splitForStencil(segment) : [segment]);
    glyphSegments.forEach(({ start, end }) => segments.push({ start: rotatedPoint(start, rotationOrigin, rotationRad), end: rotatedPoint(end, rotationOrigin, rotationRad) }));
    cursor += (width + 1) * cell * widthScale;
  }
  return segments;
}

/** Stroke path data (absolute M/L only). Outline typefaces give their outlines; see `labelSvgPaths`. */
export function labelPathData(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0, style: TextStyleV1 = DEFAULT_TEXT_STYLE): string {
  if (!isBitmapFont(style.font)) {
    const { strokes, fills } = labelGeometry(label, origin, offsetX, offsetY, rotationRad, style);
    return [...strokes, ...fills.flatMap((fill) => [fill.outer, ...fill.holes])].map(polylineData).join(" ");
  }
  return labelLineSegments(label, origin, offsetX, offsetY, rotationRad, style)
    .map(({ start, end }) => `M${format(start.x)} ${format(start.y)}L${format(end.x)} ${format(end.y)}`)
    .join(" ");
}

function polylineData(points: Point2D[]): string {
  return points.map((point, index) => `${index ? "L" : "M"}${format(point.x)} ${format(point.y)}`).join("");
}

/**
 * Text as SVG path data: `stroke` for lines to engrave (M/L only, so clearance
 * clipping can parse it), `fill` for areas to fill with the even-odd rule.
 * Exactly one is non-empty for any font with ink.
 */
export function labelSvgPaths(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0, style: TextStyleV1 = DEFAULT_TEXT_STYLE): { stroke: string; fill: string } {
  if (!isFilledFont(style.font)) return { stroke: labelPathData(label, origin, offsetX, offsetY, rotationRad, style), fill: "" };
  const { fills } = labelGeometry(label, origin, offsetX, offsetY, rotationRad, style);
  return { stroke: "", fill: fills.flatMap((fill) => [fill.outer, ...fill.holes]).map((ring) => `${polylineData(ring)}Z`).join("") };
}
