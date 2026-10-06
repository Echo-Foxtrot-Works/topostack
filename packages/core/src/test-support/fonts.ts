import { registerFont, type FontGlyphsV1 } from "../annotate/font-data.js";

/**
 * Tiny stand-ins for the curated typefaces, so core tests never depend on the
 * generated glyph files. Cap height 700, descender -200, 1000 units per em.
 */
const SINGLE_LINE_FIXTURE: FontGlyphsV1 = {
  version: 1,
  id: "hershey-sans",
  kind: "single-line",
  unitsPerEm: 1000,
  capHeight: 700,
  descender: -200,
  glyphs: {
    " ": [300, ""],
    "?": [500, "M100 600L400 600L250 300M250 100L250 0"],
    A: [600, "M0 0L300 700L600 0M100 250L500 250"],
    V: [600, "M0 700L300 0L600 700"],
    c: [500, "M400 400C400 500 100 500 100 250C100 0 400 0 400 100"],
    g: [500, "M400 500L400 -200Q400 -200 100 -200"],
    o: [500, "M250 500Q450 500 450 250Q450 0 250 0Q50 0 50 250Q50 500 250 500Z"],
  },
  kerning: { AV: -100 },
};

export const OUTLINE_FIXTURE: FontGlyphsV1 = {
  version: 1,
  id: "jost",
  kind: "outline",
  unitsPerEm: 1000,
  capHeight: 700,
  descender: -200,
  glyphs: {
    " ": [300, ""],
    "?": [500, "M100 0L400 0L400 700L100 700Z"],
    // A square ring: the inner contour winds the other way, so it is a hole.
    O: [800, "M0 0L0 700L700 700L700 0ZM100 100L600 100L600 600L100 600Z"],
    // Two stems and a bar drawn overlapping; the non-zero rule merges them.
    H: [700, "M0 0L0 700L150 700L150 0ZM450 0L450 700L600 700L600 0ZM0 300L0 400L600 400L600 300Z"],
  },
  kerning: {},
};

export function registerFixtureFonts(): void {
  registerFont(SINGLE_LINE_FIXTURE);
  registerFont(OUTLINE_FIXTURE);
}
