import { escapeXml } from "./svg-primitives.js";
import { formatNumber as format } from "../primitives/format.js";
import { pointInPolygon, ringBounds, simplifyClosedRing } from "../primitives/geometry2d.js";
import { displayElevation, displayLength, elevationUnit, lengthUnit } from "../primitives/units.js";
import { PAINT_BLEED_MM } from "../pipeline/paint-regions.js";
import type { GeometryIRV1, LayerIR, PaintRegionKind, Point2D, Polygon2D, ProjectConfigV1 } from "../types.js";

/**
 * A web font to embed in the guide, as WOFF2 bytes in base64. The core cannot
 * load files itself, so the caller passes the site's own faces in; without
 * them the guide falls back to system fonts.
 */
export interface GuideFont {
  family: string;
  weight: number;
  woff2Base64: string;
}

/** One exported sheet, as the guide refers to it: the file to cut and what it holds. */
export interface GuideSheet {
  filename: string;
  layerIndexes: number[];
  cellName?: string;
  /** Polygon indexes per layer on this sheet; absent when the project is cut whole. */
  included?: Map<number, Set<number>>;
  /** Paint templates actually written for this sheet. */
  paintTemplates?: Array<{ kind: PaintRegionKind; filename: string }>;
  /** Where each piece sits on a nested stock sheet, drawn so unlabelled pieces can be told apart. */
  map?: GuideSheetMap;
}

export interface GuideSheetMap {
  widthMm: number;
  heightMm: number;
  /**
   * Every piece cut from the sheet, in sheet coordinates: its own terrain
   * polygon moved and turned exactly as the sheet SVG places it, so islands
   * of a group and pieces cut from inside another show as they are cut.
   */
  pieces: Array<{ label: string; layerIndex: number; polygon: Polygon2D }>;
}

/**
 * A nested sheet as it comes off the laser: each piece outlined where it was
 * placed and named at a point inside it. Lower layers are drawn first, so a
 * piece cut from inside another shows within its hole.
 */
function sheetMapFigure(sheet: GuideSheet, map: GuideSheetMap): string {
  const fontSize = Math.max(3, Math.min(map.widthMm, map.heightMm) / 28);
  const tolerance = Math.max(map.widthMm, map.heightMm) / DIAGRAM_RESOLUTION;
  const pieces = [...map.pieces].sort((left, right) => left.layerIndex - right.layerIndex);
  // Alternate layers take alternate tints, so a piece cut from inside another stands out from it.
  const outlines = pieces.map(({ label, layerIndex, polygon }) => `<path data-piece="${escapeXml(label)}"${layerIndex % 2 ? " fill=\"#d3c8ab\"" : ""} d="${polygonPath(polygon, tolerance)}"><title>${escapeXml(label)}</title></path>`).join("");
  const labels = pieces.map(({ label, polygon }) => {
    const point = labelPoint(polygon);
    // A small piece gets a smaller name, so neighbouring names do not run together.
    const bounds = ringBounds(polygon.outer);
    const size = Math.max(fontSize / 2, Math.min(fontSize, (bounds.maxX - bounds.minX) / (label.length * 0.62), (bounds.maxY - bounds.minY) * 0.8));
    return `<text data-piece="${escapeXml(label)}" x="${format(point.x)}" y="${format(point.y)}"${size < fontSize ? ` font-size="${format(size)}"` : ""}>${escapeXml(label)}</text>`;
  }).join("");
  return `<figure class="sheet-map"><svg class="diagram" viewBox="0 0 ${format(map.widthMm)} ${format(map.heightMm)}" role="img" aria-label="Pieces on ${escapeXml(sheet.filename)}"><rect width="${format(map.widthMm)}" height="${format(map.heightMm)}" fill="#fbfaf6" stroke="#8d8b83" stroke-width="${format(fontSize / 8)}"/><g fill="#e8e1cf" fill-rule="evenodd" stroke="#20231d" stroke-width="${format(fontSize / 10)}">${outlines}</g><g fill="#20231d" text-anchor="middle" dominant-baseline="middle" font-size="${format(fontSize)}">${labels}</g></svg><figcaption><code>${escapeXml(sheet.filename)}</code></figcaption></figure>`;
}

// The printed diagram is about 7.5 in wide, so detail finer than a few hundred
// segments across the model is invisible and only bloats the file.
const DIAGRAM_RESOLUTION = 900;

function ringPath(ring: Point2D[]): string {
  const round = (value: number) => Number(value.toFixed(1)).toString();
  return `M${ring.slice(0, -1).map((point) => `${round(point.x)} ${round(point.y)}`).join("L")}Z`;
}

function polygonPath(polygon: Polygon2D, tolerance: number): string {
  return [polygon.outer, ...polygon.holes]
    .filter((ring) => {
      const bounds = ringBounds(ring);
      return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) > tolerance * 2;
    })
    .map((ring) => ringPath(simplifyClosedRing(ring, tolerance))).join("");
}

/** A point inside the piece near its bounding-box centre, for a label or a callout. */
function labelPoint(polygon: Polygon2D): Point2D {
  const bounds = ringBounds(polygon.outer);
  const centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  if (pointInPolygon(centre, polygon)) return centre;
  let best: Point2D | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const steps = 9;
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      const point = { x: bounds.minX + (bounds.maxX - bounds.minX) * column / steps, y: bounds.minY + (bounds.maxY - bounds.minY) * row / steps };
      const distance = Math.hypot(point.x - centre.x, point.y - centre.y);
      if (distance < bestDistance && pointInPolygon(point, polygon)) {
        best = point;
        bestDistance = distance;
      }
    }
  }
  return best ?? polygon.outer[0] ?? centre;
}

/** Stack tones from the site's pale panel at the base to a deeper stone at the summit. */
function tone(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  const mix = (from: number, to: number) => Math.round(from + (to - from) * t);
  return `rgb(${mix(245, 170)} ${mix(242, 160)} ${mix(233, 134)})`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function layerNumber(layer: LayerIR): string {
  return layer.id.replace("layer-", "");
}

/**
 * A printable (US Letter), step-by-step assembly booklet: a cover with the
 * finished dimensions, a cutting checklist, the routine every layer follows
 * stated once, and one illustrated step per layer that adds only what is
 * particular to it - where its pieces come from, nesting, painting - beside a
 * picture of the stack so far with the new layer highlighted. Styled with the
 * site's tokens and whichever of its fonts the caller embeds. Self-contained
 * HTML with no network requests - it opens in any browser, offline too, and
 * prints from there - and each layer's outline is written once and reused by every step
 * through `<use>`, so the file grows with the layer count rather than its square.
 */
export function assemblyGuideToHtml(ir: GeometryIRV1, config: ProjectConfigV1, sheets: GuideSheet[], fonts: readonly GuideFont[] = []): string {
  const units = config.units;
  const unit = lengthUnit(units);
  const amount = (valueMm: number) => format(Number(displayLength(valueMm, units).toFixed(units === "imperial" ? 2 : 1)));
  const length = (valueMm: number) => `${amount(valueMm)} ${unit}`;
  const elevation = (valueM: number) => `${Math.round(displayElevation(valueM, units)).toLocaleString("en-US")} ${elevationUnit(units)}`;
  const layers = ir.layers;
  const count = layers.length;
  const thickness = layers[0]?.materialThicknessMm ?? config.materialThicknessMm;
  const tolerance = Math.max(ir.widthMm, ir.heightMm) / DIAGRAM_RESOLUTION;
  const pad = Math.max(ir.widthMm, ir.heightMm) * 0.03;
  const viewBox = `${format(-ir.widthMm / 2 - pad)} ${format(-ir.heightMm / 2 - pad)} ${format(ir.widthMm + pad * 2)} ${format(ir.heightMm + pad * 2)}`;
  const pieceTotal = layers.reduce((total, layer) => total + (layer.pieces.length || layer.polygons.length), 0);
  const split = ir.splitPlan;
  const nests = ir.fabricationNests;
  const labelsOn = Boolean(split) && config.showAssemblyLabels;
  // Painting is driven by the templates actually written, not the setting:
  // a project with no visible water writes none, and the guide must not ask for them.
  const templates = sheets.flatMap((sheet) => (sheet.paintTemplates ?? []).map((template) => ({ ...template, sheet })));
  const painted = templates.length > 0;
  const paintKinds = [...new Set(templates.map((template) => template.kind))];
  const paintWhat = paintKinds.join(" and ");
  /** Templates holding a stencil for one of this layer's pieces, grouped by kind. */
  const templatesFor = (layerIndex: number) => paintKinds.flatMap((kind) => {
    const polygons = new Set((ir.paintRegions ?? []).filter((region) => region.kind === kind && region.layerIndex === layerIndex).map((region) => region.polygonIndex));
    const files = templates.filter((template) => template.kind === kind && template.sheet.layerIndexes.includes(layerIndex)
      && [...polygons].some((polygon) => !template.sheet.included || template.sheet.included.get(layerIndex)?.has(polygon)));
    return files.length ? [{ kind, files }] : [];
  });

  const sheetsByLayer = new Map<number, GuideSheet[]>();
  for (const sheet of sheets) for (const index of sheet.layerIndexes) sheetsByLayer.set(index, [...(sheetsByLayer.get(index) ?? []), sheet]);
  const donorsOf = (index: number) => [...new Set(nests.filter((nest) => nest.nestedLayerIndex === index).map((nest) => nest.donorLayerIndex))];
  const nestedIn = (index: number) => [...new Set(nests.filter((nest) => nest.donorLayerIndex === index).map((nest) => nest.nestedLayerIndex))];

  const defs = layers.map((layer) => `<path id="g-${layer.id}" d="${layer.polygons.map((polygon) => polygonPath(polygon, tolerance)).join("")}"/>`).join("");
  const stack = (upTo: number) => layers.slice(0, upTo).map((layer, index) => `<use href="#g-${layer.id}" fill="${tone(index, count)}"/>`).join("");
  const diagram = (body: string, label: string) => `<svg class="diagram" viewBox="${viewBox}" role="img" aria-label="${escapeXml(label)}">${body}</svg>`;

  const stepFigure = (layer: LayerIR): string => {
    const small = Math.max(ir.widthMm, ir.heightMm) * 0.06;
    const callouts = layer.polygons.map((polygon, polygonIndex) => {
      const bounds = ringBounds(polygon.outer);
      const point = labelPoint(polygon);
      const piece = layer.pieces.find((entry) => entry.polygonIndex === polygonIndex);
      const text = labelsOn && piece ? `<text x="${format(point.x)}" y="${format(point.y)}" class="piece-id">${escapeXml(piece.id.replace(/^L\d+-/, ""))}</text>` : "";
      const ring = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) < small ? `<circle cx="${format(point.x)}" cy="${format(point.y)}" r="${format(small * 0.7)}" class="callout"/>` : "";
      return ring + text;
    }).join("");
    return diagram(`${stack(layer.index)}<use href="#g-${layer.id}" class="current"/>${callouts}`, `Stack after adding layer ${layerNumber(layer)}`);
  };

  const nestedSheet = sheets.find((sheet) => sheet.map)?.map;
  /** On a nested sheet, which of the layer's pieces it holds: pieces of many layers share one. */
  const piecesOn = (sheet: GuideSheet, layerIndex: number) => {
    const labels = sheet.map?.pieces.filter((piece) => piece.layerIndex === layerIndex).map((piece) => piece.label) ?? [];
    return labels.length ? ` <span class="muted">(${labels.map(escapeXml).join(", ")})</span>` : "";
  };

  const steps = layers.map((layer, index) => {
    const number = layerNumber(layer);
    const pieces = layer.pieces.length || layer.polygons.length;
    const layerSheets = sheetsByLayer.get(index) ?? [];
    const donors = donorsOf(index).map((donor) => layers[donor]).filter((entry): entry is LayerIR => Boolean(entry));
    // Only what differs from the routine stated once above the steps.
    const notes: string[] = [];
    if (index === 0) notes.push("<strong>Base layer.</strong> Lay it on a flat board, engraved side up. No glue under this one.");
    if (nestedIn(index).length) notes.push(`<strong>Keep its cutouts.</strong> The pieces that drop out of it belong to layer ${nestedIn(index).map((nested) => layers[nested]).filter((entry): entry is LayerIR => Boolean(entry)).map(layerNumber).join(" and ")}.`);
    if (donors.length) notes.push(`<strong>Nested.</strong> ${pieces === 1 ? "This piece was" : "These pieces were"} cut from inside layer ${donors.map(layerNumber).join(" and ")}; look among that sheet's cutouts.`);
    for (const { kind, files } of templatesFor(index)) notes.push(`<strong>Paint the ${kind} first</strong> with ${files.map(({ filename }) => `<code>${escapeXml(filename)}</code>`).join(", ")}.`);
    if (index === count - 1 && count > 1) notes.push(`<strong>Top layer.</strong> ${(labelsOn || (nestedSheet && config.showAssemblyLabels)) && pieces > 1 ? `Its pieces carry no id; ${nestedSheet ? "find them on the sheet maps and " : ""}place them by the picture.` : "The last one."}`);
    const facts = [
      ["Cut from", layerSheets.length ? layerSheets.map((sheet) => `<code>${escapeXml(sheet.filename)}</code>${piecesOn(sheet, index)}`).join(" ") : "—"],
      ["Pieces", String(pieces)],
      ["Elevation", `${elevation(layer.elevationM)} and up`],
    ].map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("");
    return `<article class="step" id="step-${index + 1}">
<header><span class="badge">${index + 1}</span><div class="step-title"><p class="label">Step ${index + 1} of ${count}</p><h3>Layer ${number}</h3></div><label class="done"><input type="checkbox"> Done</label></header>
<figure>${stepFigure(layer)}</figure>
<div class="step-body"><dl class="step-facts">${facts}</dl>${notes.length ? `<ul class="notes">${notes.map((note) => `<li>${note}</li>`).join("")}</ul>` : ""}</div>
</article>`;
  }).join("\n");

  const sheetRows = sheets.map((sheet) => {
    const ids = sheet.layerIndexes.map((index) => layers[index]).filter((entry): entry is LayerIR => Boolean(entry)).map(layerNumber);
    return `<tr><td><input type="checkbox" aria-label="Cut ${escapeXml(sheet.filename)}"></td><td><code>${escapeXml(sheet.filename)}</code></td><td>${ids.join(", ")}${sheet.cellName ? ` <span class="muted">· cell ${escapeXml(sheet.cellName)}</span>` : ""}</td></tr>`;
  }).join("");

  const sheetMaps = sheets.map((sheet) => sheet.map ? sheetMapFigure(sheet, sheet.map) : "").join("");

  const templateRows = templates.map(({ filename, sheet }) => `<tr><td><input type="checkbox" aria-label="Cut ${escapeXml(filename)}"></td><td><code>${escapeXml(filename)}</code></td><td>for <code>${escapeXml(sheet.filename)}</code></td></tr>`).join("");
  const paintSection = painted ? `<section class="page">
<p class="label">Section 2</p>
<h2>Paint before you glue</h2>
<p class="lede">${plural(templates.length, "sheet has", "sheets have")} a paper template for painting the ${paintWhat} that stays visible. Painted pieces are much harder to reach once the stack is built, so do this first.</p>
<ol class="numbered">
<li>Cut each template from paper or stencil film <strong>with kerf compensation turned off</strong>: it is the piece at its nominal size, with the ${paintWhat} cut away as windows.</li>
<li>Lay the template flush on its cut piece and line it up on the piece edges and tabs it keeps. Where the ${paintWhat} reaches the piece edge the template stops short of it.</li>
<li>Spray, lift the template off, and let the paint dry.</li>
<li>The windows reach ${length(PAINT_BLEED_MM)} under the layer above so no bare edge shows. That strip is glued, so wipe or lightly sand a thick paint film there to keep the next layer flat.</li>
</ol>
<table><tbody>${templateRows}</tbody></table>
</section>` : "";

  const routine = [
    "Find the layer's pieces. The step says which sheet they came from.",
    split ? `Lay them out as in the picture${labelsOn ? ", matching the green id engraved on each piece (B2 in the picture is <code>Lnn-B2</code> on the wood)" : ""}, and butt them together.${config.seamTabs ? " The jigsaw tabs only fit their true neighbour; press them home." : ""}` : "",
    painted ? "If the step says to paint, do that first and let it dry." : "",
    "Spread a thin layer of glue on the underside, a little way in from the edges so squeeze-out stays hidden.",
    config.showAlignmentGuides
      ? "Set it on the layer below so its edges sit on the engraved outline there, then press it flat."
      : "Line it up with the terrain below as shown in the picture, then press it flat.",
    "Wipe off any squeeze-out before it cures.",
  ].filter(Boolean);

  const legend = [
    `<li><span class="swatch swatch-current"></span>The layer you are adding</li>`,
    `<li><span class="swatch swatch-below"></span>Layers already glued</li>`,
    labelsOn ? `<li><span class="swatch swatch-id">B2</span>Piece id, also engraved on the piece</li>` : "",
    `<li><span class="swatch swatch-ring"></span>A small piece, circled so it is not missed</li>`,
  ].filter(Boolean).join("");

  const marks = [
    config.showAlignmentGuides ? `<li><strong>Outline and Lxx label.</strong> Each layer carries an engraved outline showing exactly where the next layer sits, plus its layer number. Both end up hidden.</li>` : "",
    labelsOn ? `<li><strong>Piece ids.</strong> Each layer is cut in ${split!.columns} × ${split!.rows} parts. Every piece has a green id like <code>L03-B2</code> (layer 03, column B, row 2) where the next layer will cover it. Top-layer pieces have none.</li>` : "",
    // Nested sheets mix layers, so the export engraves an id on every covered piece, split or not.
    nestedSheet && config.showAssemblyLabels && !split ? `<li><strong>Piece ids.</strong> Pieces from different layers share each sheet, so every piece carries a green id like <code>L05</code> or <code>L05-2</code> (layer 05, island 2) where the next layer will cover it. Pieces with no covered room, the top layer's among them, are named on the sheet maps.</li>` : "",
    split && !labelsOn ? `<li><strong>Split layers.</strong> Each layer is cut in ${split.columns} × ${split.rows} parts. Use the step pictures to place them.</li>` : "",
    `<li><strong>Everything else</strong> engraved on the pieces (contours, roads, labels) is part of the artwork.</li>`,
  ].filter(Boolean).join("");

  const width = length(ir.widthMm);
  const height = length(ir.heightMm);
  const facts = [
    ["Finished size", `${amount(ir.widthMm)} × ${amount(ir.heightMm)} × ${length(count * thickness)}`],
    ["Layers", `${count} × ${length(thickness)}`],
    ["Pieces", String(pieceTotal)],
    ["Sheets to cut", String(sheets.length)],
    ["Elevation", `${elevation(ir.minElevationM)} – ${elevation(ir.maxElevationM)}`],
    ["Vertical exaggeration", `${ir.verticalExaggeration.toFixed(1)}×`],
  ].map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("");
  const buildSection = painted ? 3 : 2;

  const title = `${escapeXml(ir.projectName)}: assembly guide`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${fonts.map((font) => `@font-face{font-family:"${font.family.replace(/["\\<>;{}]/g, "")}";src:url(data:font/woff2;base64,${font.woff2Base64.replace(/[^A-Za-z0-9+/=]/g, "")}) format("woff2");font-weight:${Math.round(font.weight)};font-style:normal;font-display:swap}`).join("\n")}
:root{color-scheme:light;--bg:#ebe7dc;--surface:#f5f2e9;--surface-alt:#efebe1;--text:#20231d;--muted:#5f5b50;--line:#c8c1b1;--line-soft:#ddd7c9;--line-strong:#847d6a;--accent:#c65224;--accent-text:#a9441d;--on-accent:#fff;--canvas:#d8d3c7;--display:"Jost","Avenir Next","Segoe UI",sans-serif;--utility:"Archivo","Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media screen and (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#161814;--surface:#1e211c;--surface-alt:#24271f;--text:#ebe7dc;--muted:#a8a394;--line:#3a3d34;--line-soft:#2b2e26;--line-strong:#6a6e5f;--accent:#e0672f;--accent-text:#f0895c;--on-accent:#161814;--canvas:#d8d3c7}}
*,::before,::after{box-sizing:border-box}
html{background:var(--bg);color:var(--text);font:400 16px/1.6 var(--display);-webkit-font-smoothing:antialiased}
body{margin:0;padding:0 16px 80px}
main{max-width:8.5in;margin:0 auto}
h1,h2,h3{font-weight:500;line-height:1.15;margin:0}
h1{font-size:clamp(34px,6vw,52px);letter-spacing:-.035em;margin:10px 0 12px}
h2{font-size:26px;letter-spacing:-.02em;margin-bottom:14px}
h3{font-size:22px;letter-spacing:-.01em}
p{margin:0 0 12px}
strong{font-weight:700}
code{font:12.5px var(--mono);background:var(--surface-alt);border:1px solid var(--line-soft);padding:1px 5px;overflow-wrap:anywhere;white-space:normal}
.label{font:11px/1.4 var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.muted{color:var(--muted)}
.lede{font-size:18px;line-height:1.6;color:var(--muted);max-width:40em}
.masthead{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;margin-bottom:24px;border-bottom:1px solid var(--line)}
.wordmark{font:500 20px var(--display);letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
.wordmark svg{width:26px;height:26px}
.masthead .label{margin:0}
.page{background:var(--surface);border:1px solid var(--line);padding:32px;margin-bottom:24px}
.cover{padding:36px 32px}
.cover figure{margin:24px 0 28px}
.facts{display:grid;grid-template-columns:repeat(3,1fr);margin:0;border-top:1px solid var(--line)}
.facts>div{padding:12px 16px 12px 0;border-bottom:1px solid var(--line-soft)}
.facts dt{font:11px var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.facts dd{margin:4px 0 0;font-size:18px;font-weight:500}
figure{margin:0;background:var(--canvas);padding:14px;box-shadow:0 18px 23px rgb(32 35 29/.12)}
.diagram{display:block;width:100%;height:auto;max-height:118mm}${sheetMaps ? `
.sheet-maps{display:grid;grid-template-columns:repeat(auto-fill,minmax(3in,1fr));gap:14px;margin-top:10px}
.sheet-map figcaption{margin-top:6px}` : ""}
.diagram use{stroke:#847d6a;stroke-width:.6;vector-effect:non-scaling-stroke;fill-rule:evenodd}
.diagram use.current{fill:#c65224;stroke:#6e2a10;stroke-width:1.4}
.diagram .callout{fill:none;stroke:#c65224;stroke-width:1.8;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
.diagram .piece-id{font:600 ${format(Math.max(ir.widthMm, ir.heightMm) * 0.035)}px "Archivo","Helvetica Neue",sans-serif;fill:#fff;stroke:#6e2a10;stroke-width:.35em;paint-order:stroke;text-anchor:middle;dominant-baseline:central}
.two{display:grid;grid-template-columns:1fr 1fr;gap:32px}
ul,ol{margin:0;padding-left:1.3em}
li{margin-bottom:8px}
.numbered{counter-reset:n;list-style:none;padding:0}
.numbered>li{counter-increment:n;position:relative;padding-left:40px;min-height:28px;margin-bottom:12px}
.numbered>li::before{content:counter(n);position:absolute;left:0;top:0;width:26px;height:26px;display:grid;place-items:center;background:var(--text);color:var(--bg);font:600 12px var(--utility)}
table{width:100%;border-collapse:collapse;font-size:15px;margin-top:16px}
td{border-bottom:1px solid var(--line);padding:9px 12px 9px 0;vertical-align:top}
td:first-child{width:32px}
input[type=checkbox]{appearance:none;-webkit-appearance:none;width:18px;height:18px;margin:2px 0 0;border:1.5px solid var(--line-strong);background:var(--surface);display:inline-grid;place-content:center;cursor:pointer;vertical-align:-3px}
input[type=checkbox]:checked{background:var(--accent);border-color:var(--accent)}
input[type=checkbox]:checked::after{content:"";width:9px;height:5px;border:2px solid var(--on-accent);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
input[type=checkbox]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.legend{list-style:none;padding:0}
.legend li{display:flex;align-items:center;gap:12px}
.swatch{flex:none;width:28px;height:18px;display:grid;place-items:center;font:600 10px var(--utility)}
.swatch-current{background:#c65224;border:1.5px solid #6e2a10}
.swatch-below{background:#d4ccbb;border:1px solid #847d6a}
.swatch-id{background:#c65224;color:#fff}
.swatch-ring{border:1.8px dashed #c65224;border-radius:50%;width:22px;height:22px;margin:0 3px}
.build-intro h3{margin:0 0 12px}
.step{background:var(--surface);border:1px solid var(--line);padding:24px;margin-bottom:20px;break-inside:avoid}
.step header{display:flex;gap:16px;align-items:center;margin-bottom:16px}
.step-title{flex:1}
.step-title .label{margin:0 0 2px}
.badge{flex:none;width:48px;height:48px;background:var(--accent);color:var(--on-accent);font:500 24px var(--display);display:grid;place-items:center}
.done{display:flex;gap:8px;align-items:center;font:11px var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);cursor:pointer}
.step-body{margin-top:16px}
.step-facts{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0}
.step-facts>div{display:contents}
.step-facts dt{font:11px/2 var(--utility);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.step-facts dd{margin:0}
.notes{list-style:none;padding:12px 0 0;margin:12px 0 0;border-top:1px solid var(--line-soft)}
.notes li{padding-left:14px;border-left:3px solid var(--accent);margin-bottom:10px}
.print{position:fixed;right:16px;bottom:16px;border:0;min-height:44px;background:var(--accent);color:var(--on-accent);padding:10px 18px;font:500 15px var(--display);cursor:pointer;box-shadow:0 12px 30px rgb(32 35 29/.18)}
.print:hover{background:var(--accent-text)}
footer{font:12px/1.8 var(--utility);color:var(--muted);margin-top:24px;padding-top:16px;border-top:1px solid var(--line)}
@media (max-width:640px){.two{grid-template-columns:1fr;gap:20px}.page,.step{padding:20px}.facts{grid-template-columns:1fr 1fr}.badge{width:40px;height:40px;font-size:20px}}
@page{size:letter;margin:.5in}
@media print{
html{background:#fff;font-size:10pt}
body{padding:0}
.print{display:none}
.page,.step{background:none;border:0;padding:0;margin:0 0 .3in}
.masthead{padding-top:0}
.cover{break-after:page}
.cover .diagram{max-height:5.2in}
h2,h3,.label{break-after:avoid}
tr{break-inside:avoid}
.build-intro{break-before:page}
figure{background:#efebe1;box-shadow:none;padding:.06in}
.step{display:grid;grid-template-columns:1.25fr 1fr;grid-template-areas:"fig head" "fig body";grid-template-rows:auto 1fr;gap:0 .25in;align-items:start;border-top:1.5px solid var(--text);padding-top:.12in;margin:0 0 .14in}
.step header{grid-area:head;margin-bottom:.1in}
.step figure{grid-area:fig}
.step-body{grid-area:body;margin-top:0}
.diagram{max-height:2.6in}
.badge{width:.45in;height:.45in;font-size:18pt}
code{font-size:8pt}
figure,code,.badge,.diagram,.swatch,.numbered>li::before,input{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>
<main>
<header class="masthead"><span class="wordmark"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" fill="#20231d"/><g fill="none" stroke="#f0895c" stroke-width="1.6" stroke-linejoin="round"><path d="M5 22c3-3 8-2 11-4s9-1 11 1c-2 3-8 3-11 4s-8 1-11-1z"/><path d="M8 17c3-2 6-1 8-3s7 0 8 1c-2 2-6 2-8 3s-6 0-8-1z"/><path d="M12 12c2-1 3-1 4-2s4 0 5 1c-1 1-3 1-5 2s-3 0-4-1z"/></g></svg>TopoStack</span><span class="label">Assembly guide</span></header>
<section class="page cover">
<p class="label">Layered relief · ${plural(count, "layer")}</p>
<h1>${escapeXml(ir.projectName)}</h1>
<p class="lede">Build it from the bottom up, one layer per step. Every layer goes on the same way; each step only adds what is particular to it.</p>
<figure>${diagram(stack(count), "The finished relief seen from above")}</figure>
<dl class="facts">${facts}</dl>
</section>
<section class="page">
<h2>Before you start</h2>
<div class="two">
<div>
<p class="label">You will need</p>
<ul>
<li>${plural(sheets.length, "sheet")} of ${length(thickness)} material${nestedSheet ? `, each ${length(nestedSheet.widthMm)} × ${length(nestedSheet.heightMm)}` : split ? ` that fit your ${length(config.workAreaWidthMm)} × ${length(config.workAreaHeightMm)} work area` : `, each at least ${width} × ${height}`}</li>
<li>Glue suited to the material (wood glue for plywood or MDF)</li>
<li>A flat board to build on and some weights or clamps</li>
<li>A small bag or tray per layer, and a pencil</li>
${painted ? `<li>Paper or stencil film for ${plural(templates.length, "paint template")}, and paint</li>` : ""}
</ul>
</div>
<div>
<p class="label">Tips</p>
<ul>
<li>Do a test cut first to check power, speed, and kerf.</li>
<li>As each sheet finishes, bag its pieces by layer number. Pencil the number on the back of any piece without one.</li>
${nests.length ? `<li><strong>Keep every cutout.</strong> Some small pieces of higher layers are cut from inside lower layers' sheets.</li>` : ""}
<li>Dry-fit each layer before gluing it.</li>
</ul>
</div>
</div>
</section>
<section class="page">
<p class="label">Section 1</p>
<h2>Cut the sheets</h2>
<p class="muted">Tick each file off as it comes off the laser. The last column says which layers are on that sheet.</p>
<table><tbody>${sheetRows}</tbody></table>${sheetMaps ? `\n<p class="muted">Pieces from different layers share each sheet. Each map shows every piece where the laser cuts it, named by its id; use it for any piece without an engraved id.</p>\n<div class="sheet-maps">${sheetMaps}</div>` : ""}
</section>
${paintSection}
<section class="page build-intro">
<p class="label">Section ${buildSection}</p>
<h2>Build the stack</h2>
<div class="two">
<div>
<h3>For every layer</h3>
<ol class="numbered">${routine.map((item) => `<li>${item}</li>`).join("")}</ol>
</div>
<div>
<h3>Reading the pictures</h3>
<ul class="legend">${legend}</ul>
<h3 style="margin-top:20px">Marks on the pieces</h3>
<ul>${marks}</ul>
</div>
</div>
</section>
${steps}
<section class="page">
<h2>Finish</h2>
<ul>
<li>Leave the stack flat under even weight until the glue has fully cured.</li>
<li>Clean laser smoke marks off the edges with a damp cloth or fine sandpaper.</li>
<li>Frame or mount it as you like.</li>
</ul>
<footer>Terrain data is decorative, not survey or engineering data. Made with TopoStack · topostack.app</footer>
</section>
</main>
<button class="print" type="button" onclick="window.print()">Print guide</button>
</body>
</html>
`;
}
