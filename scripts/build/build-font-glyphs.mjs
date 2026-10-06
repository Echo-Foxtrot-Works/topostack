// Run `node scripts/build/build-font-glyphs.mjs` after adding or replacing a font in assets/fonts/.
// Converts each curated typeface into the compact glyph JSON the studio loads lazily
// (FontGlyphsV1 in packages/core/src/annotate/font-data.ts) and the picker's sample
// paths. The output is committed; scripts/test/font-glyphs.test.mjs fails when it is stale.
// Glyph data for a font id is immutable once released: docs/fonts.md explains why.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import opentype from "opentype.js";
import { isMainModule } from "../lib/main-module.mjs";

const root = new URL("../../", import.meta.url);
export const GLYPH_DIRECTORY = new URL("apps/generator/src/lib/domain/font-glyphs/", root);
export const SAMPLES_FILE = new URL("apps/generator/src/lib/studio/font-samples.ts", root);

/** Every curated typeface. Ids are stored in projects, so they never change meaning. */
export const FONT_SOURCES = [
  { id: "hershey-sans", kind: "single-line", file: "hershey-sans/HersheySans1.svg" },
  { id: "hershey-serif", kind: "single-line", file: "hershey-serif/HersheySerifMed.svg" },
  { id: "hershey-script", kind: "single-line", file: "hershey-script/HersheyScript1.svg" },
  { id: "relief", kind: "single-line", file: "relief/ReliefSingleLineSVG-Regular.svg" },
  { id: "jost", kind: "outline", file: "jost/Jost[wght].ttf" },
  { id: "oswald", kind: "outline", file: "oswald/Oswald[wght].ttf" },
  { id: "lora", kind: "outline", file: "lora/Lora[wght].ttf" },
  { id: "roboto-slab", kind: "outline", file: "roboto-slab/RobotoSlab[wght].ttf" },
];

const SAMPLE_TEXT = "Aa 123";
const SAMPLE_CAP_HEIGHT = 20;
/** Kerning is kept for pairs of these characters; the rest of the subset rarely meets in a label. */
const KERNING_CHARACTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,-'"];

/** Basic Latin, Latin-1, Latin Extended-A, and the typographic marks a map title uses. */
export function subsetCharacters() {
  const codes = [];
  for (let code = 0x20; code <= 0x7e; code += 1) codes.push(code);
  for (let code = 0xa0; code <= 0x17f; code += 1) codes.push(code);
  codes.push(0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2032, 0x2033, 0x20ac);
  return codes.map((code) => String.fromCodePoint(code));
}

const round = (value) => Math.round(value);

/** Absolute commands [type, ...numbers] to the compact integer form: "M1 2L3 4Q...Z". */
function serialise(commands) {
  return commands.map(([type, ...values]) => type + values.map(round).join(" ")).join("");
}

function outlineGlyphs(buffer, characters) {
  const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const glyphs = {};
  for (const character of characters) {
    const index = font.charToGlyphIndex(character);
    if (!index && character !== " ") continue;
    const glyph = font.glyphs.get(index);
    const commands = glyph.path.commands.map((command) => {
      switch (command.type) {
        case "M": case "L": return [command.type, command.x, command.y];
        case "Q": return ["Q", command.x1, command.y1, command.x, command.y];
        case "C": return ["C", command.x1, command.y1, command.x2, command.y2, command.x, command.y];
        default: return ["Z"];
      }
    });
    glyphs[character] = [round(glyph.advanceWidth ?? 0), serialise(commands)];
  }
  const kerning = {};
  for (const left of KERNING_CHARACTERS) {
    for (const right of KERNING_CHARACTERS) {
      if (!glyphs[left] || !glyphs[right]) continue;
      const value = round(font.getKerningValue(font.charToGlyph(left), font.charToGlyph(right)));
      if (value) kerning[left + right] = value;
    }
  }
  return {
    unitsPerEm: font.unitsPerEm,
    capHeight: round(font.charToGlyph("H").getBoundingBox().y2),
    descender: round(Math.min(...["g", "p", "y"].map((character) => font.charToGlyph(character).getBoundingBox().y1))),
    glyphs,
    kerning,
  };
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeEntities(match[1]) : undefined;
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Parses SVG path data into absolute M/L/Q/C/Z commands. SVG fonts are y-up like font units. */
export function absoluteCommands(data) {
  const tokens = [...data.matchAll(/[MmLlHhVvCcSsQqTtZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g)].map((match) => match[0]);
  const commands = [];
  let index = 0;
  let command = "";
  let x = 0; let y = 0; let startX = 0; let startY = 0;
  let controlX = 0; let controlY = 0; let previous = "";
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const dx = relative ? x : 0;
    const dy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        x = number() + dx; y = number() + dy; startX = x; startY = y;
        commands.push(["M", x, y]);
        command = relative ? "l" : "L";
        break;
      case "L": x = number() + dx; y = number() + dy; commands.push(["L", x, y]); break;
      case "H": x = number() + dx; commands.push(["L", x, y]); break;
      case "V": y = number() + dy; commands.push(["L", x, y]); break;
      case "C": {
        const x1 = number() + dx; const y1 = number() + dy; controlX = number() + dx; controlY = number() + dy;
        x = number() + dx; y = number() + dy;
        commands.push(["C", x1, y1, controlX, controlY, x, y]);
        break;
      }
      case "S": {
        const x1 = /[CS]/.test(previous) ? 2 * x - controlX : x;
        const y1 = /[CS]/.test(previous) ? 2 * y - controlY : y;
        controlX = number() + dx; controlY = number() + dy; x = number() + dx; y = number() + dy;
        commands.push(["C", x1, y1, controlX, controlY, x, y]);
        break;
      }
      case "Q":
        controlX = number() + dx; controlY = number() + dy; x = number() + dx; y = number() + dy;
        commands.push(["Q", controlX, controlY, x, y]);
        break;
      case "T":
        controlX = /[QT]/.test(previous) ? 2 * x - controlX : x;
        controlY = /[QT]/.test(previous) ? 2 * y - controlY : y;
        x = number() + dx; y = number() + dy;
        commands.push(["Q", controlX, controlY, x, y]);
        break;
      case "Z": x = startX; y = startY; commands.push(["Z"]); break;
      default: throw new Error(`Unsupported path command ${command}`);
    }
    previous = command.toUpperCase();
  }
  return commands;
}

function commandsBounds(commands) {
  const ys = commands.flatMap(([, ...values]) => values.filter((_, position) => position % 2 === 1));
  return ys.length ? { min: Math.min(...ys), max: Math.max(...ys) } : undefined;
}

function svgFontGlyphs(source, characters) {
  const fontTag = /<font\b[^>]*>/.exec(source)[0];
  const faceTag = /<font-face\b[^>]*>/.exec(source)[0];
  const defaultAdvance = Number(attribute(fontTag, "horiz-adv-x") ?? 0);
  const wanted = new Set(characters);
  const glyphs = {};
  const names = new Map();
  const parsed = {};
  for (const [tag] of source.matchAll(/<glyph\b[^>]*>/g)) {
    const unicode = attribute(tag, "unicode");
    const name = attribute(tag, "glyph-name");
    if (unicode === undefined || [...unicode].length !== 1) continue;
    if (name) names.set(name, unicode);
    if (!wanted.has(unicode) || glyphs[unicode]) continue;
    const commands = absoluteCommands(attribute(tag, "d") ?? "");
    parsed[unicode] = commands;
    glyphs[unicode] = [round(Number(attribute(tag, "horiz-adv-x") ?? defaultAdvance)), serialise(commands)];
  }
  const kerning = {};
  const members = (tag, unicodeName, glyphName) => [
    ...(attribute(tag, unicodeName)?.split(",") ?? []),
    ...(attribute(tag, glyphName)?.split(",").map((name) => names.get(name)).filter(Boolean) ?? []),
  ].filter((character) => [...character].length === 1);
  const kernable = new Set(KERNING_CHARACTERS);
  for (const [tag] of source.matchAll(/<hkern\b[^>]*>/g)) {
    const value = -Number(attribute(tag, "k"));
    for (const left of members(tag, "u1", "g1")) {
      for (const right of members(tag, "u2", "g2")) {
        if (kernable.has(left) && kernable.has(right) && glyphs[left] && glyphs[right] && value) kerning[left + right] = round(value);
      }
    }
  }
  const capBounds = commandsBounds(parsed.H ?? []);
  const descender = Math.min(0, ...["g", "p", "y"].map((character) => commandsBounds(parsed[character] ?? [])?.min ?? 0));
  return {
    unitsPerEm: Number(attribute(faceTag, "units-per-em") ?? 1000),
    capHeight: round(capBounds?.max ?? Number(attribute(faceTag, "cap-height"))),
    descender: round(descender),
    glyphs,
    kerning,
  };
}

/** Converts every source font; returns file contents keyed by output URL, in a stable order. */
export async function buildFontGlyphs() {
  const characters = subsetCharacters();
  const outputs = new Map();
  const samples = [];
  for (const { id, kind, file } of FONT_SOURCES) {
    const source = await readFile(new URL(`assets/fonts/${file}`, root));
    const data = file.endsWith(".svg") ? svgFontGlyphs(source.toString("utf8"), characters) : outlineGlyphs(source, characters);
    if (!data.glyphs["?"] || !data.glyphs[" "]) throw new Error(`${id} must draw "?" and a space.`);
    const glyphs = Object.fromEntries(Object.entries(data.glyphs).sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0)));
    const kerning = Object.fromEntries(Object.entries(data.kerning).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const json = { version: 1, id, kind, unitsPerEm: data.unitsPerEm, capHeight: data.capHeight, descender: data.descender, glyphs, kerning };
    outputs.set(new URL(`${id}.json`, GLYPH_DIRECTORY).href, `${JSON.stringify(json)}\n`);
    samples.push([id, samplePath(json)]);
  }
  outputs.set(SAMPLES_FILE.href, samplesModule(samples));
  return outputs;
}

/**
 * The picker sample scaled to a cap height of 20, top-left origin, y down, as
 * relative integer commands: at 24 px tall a unit is about a pixel, and the
 * whole table stays a few kilobytes in the studio's startup JavaScript.
 */
function samplePath(font) {
  const scale = SAMPLE_CAP_HEIGHT / font.capHeight;
  let cursor = 0;
  let penX = 0; let penY = 0;
  let start = [0, 0];
  const parts = [];
  for (const character of SAMPLE_TEXT) {
    const glyph = font.glyphs[character] ?? font.glyphs["?"];
    for (const [type, ...values] of absoluteCommands(glyph[1])) {
      // Closing a path returns the pen to where the path started.
      if (type === "Z") { parts.push("z"); [penX, penY] = start; continue; }
      const points = [];
      for (let index = 0; index < values.length; index += 2) points.push([Math.round(cursor + values[index] * scale), Math.round(SAMPLE_CAP_HEIGHT - values[index + 1] * scale)]);
      // Control points are relative to the segment start; the pen moves to the last point.
      const relative = points.map(([x, y]) => [x - penX, y - penY]);
      [penX, penY] = points.at(-1);
      if (type === "M") start = points[0];
      parts.push(type.toLowerCase() + relative.flat().join(" ").replace(/ -/g, "-"));
    }
    cursor += glyph[0] * scale;
  }
  return { d: parts.join("").replace(/^m/, "M"), width: Math.round(cursor) };
}

function samplesModule(samples) {
  const rows = samples.map(([id, { d, width }]) => `  ${JSON.stringify(id)}: { width: ${width}, d: ${JSON.stringify(d)} },`);
  return [
    "// Generated by scripts/build/build-font-glyphs.mjs. Do not edit.",
    `/** "${SAMPLE_TEXT}" per curated font, cap height ${SAMPLE_CAP_HEIGHT}, origin at the cap line, for the font picker. */`,
    "export const FONT_SAMPLES: Readonly<Record<string, { width: number; d: string }>> = {",
    ...rows,
    "};",
    "",
  ].join("\n");
}

if (isMainModule(import.meta.url)) {
  await mkdir(GLYPH_DIRECTORY, { recursive: true });
  for (const [href, content] of await buildFontGlyphs()) await writeFile(new URL(href), content);
}
