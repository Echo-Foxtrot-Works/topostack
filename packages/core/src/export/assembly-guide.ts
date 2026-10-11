import { escapeXml } from "./svg-primitives.js";
import { assemblyGuideStyles } from "./assembly-guide-styles.js";
import { formatNumber as format } from "../primitives/format.js";
import { pointInPolygon, ringBounds, simplifyClosedRing } from "../primitives/geometry2d.js";
import { displayElevation, displayLength, elevationUnit, lengthUnit } from "../primitives/units.js";
import { PAINT_BLEED_MM } from "../pipeline/paint-regions.js";
import { airspaceFact, airspaceNeeds, airspaceSection, type GuideAirspace } from "./assembly-guide-airspace.js";
import type { GeometryIRV1, LayerIR, PaintRegionKind, Point2D, Polygon2D, ProjectConfigV1, WaterInsertIR } from "../types.js";

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

/** The acrylic water inserts, as the guide refers to them: the files actually written and what each holds. */
export interface GuideAcrylic {
  thicknessMm: number;
  ledgeMm: number;
  inserts: WaterInsertIR[];
  sheets: Array<{ filename: string; insertIds: string[]; map?: GuideSheetMap }>;
  /** Stock sheet size when the acrylic was nested. */
  sheetSize?: { widthMm: number; heightMm: number };
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
export function assemblyGuideToHtml(ir: GeometryIRV1, config: ProjectConfigV1, sheets: GuideSheet[], fonts: readonly GuideFont[] = [], acrylic?: GuideAcrylic, airspace?: GuideAirspace): string {
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

  // Acrylic inserts by the wood layer they sit in; they go in once that layer is glued.
  const inserts = acrylic?.inserts ?? [];
  const insertsOn = (layerIndex: number) => inserts.filter((insert) => insert.layerIndex === layerIndex);
  const insertName = (insert: WaterInsertIR) => `<strong>${escapeXml(insert.id)}</strong>${insert.name ? ` (${escapeXml(insert.name)})` : ""}`;
  const acrylicSheetsFor = (insert: WaterInsertIR) => (acrylic?.sheets ?? []).filter((sheet) => sheet.insertIds.some((id) => id === insert.id || id.startsWith(`${insert.id}-`)));
  const defs = layers.map((layer) => `<path id="g-${layer.id}" d="${layer.polygons.map((polygon) => polygonPath(polygon, tolerance)).join("")}"/>`).join("")
    + layers.filter((layer) => insertsOn(layer.index).length).map((layer) => `<path id="g-acrylic-${layer.id}" d="${insertsOn(layer.index).flatMap((insert) => insert.polygons).map((polygon) => polygonPath(polygon, tolerance)).join("")}"/>`).join("");
  const acrylicUse = (layer: LayerIR) => insertsOn(layer.index).length ? `<use href="#g-acrylic-${layer.id}" class="acrylic"/>` : "";
  const stack = (upTo: number) => layers.slice(0, upTo).map((layer, index) => `<use href="#g-${layer.id}" fill="${tone(index, count)}"/>${acrylicUse(layer)}`).join("");
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
    const insertCallouts = insertsOn(layer.index).map((insert) => {
      const point = labelPoint(insert.polygons[0]!);
      return `<text x="${format(point.x)}" y="${format(point.y)}" class="piece-id insert-id">${escapeXml(insert.id)}</text>`;
    }).join("");
    return diagram(`${stack(layer.index)}<use href="#g-${layer.id}" class="current"/>${acrylicUse(layer)}${callouts}${insertCallouts}`, `Stack after adding layer ${layerNumber(layer)}`);
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
    const covering = insertsOn(index + 1);
    if (covering.length) notes.push(`<strong>Under the water.</strong> Its lake bed shows through acrylic ${covering.length === 1 ? "insert" : "inserts"} ${covering.map(insertName).join(", ")}, set in at step ${index + 2}. The ${length(acrylic!.ledgeMm)} rim just inside the opening above is the ledge ${covering.length === 1 ? "it rests" : "they rest"} on${painted ? "" : "; tint the bed now if you want coloured water"}. Keep glue off the bed: it shows.`);
    for (const insert of insertsOn(index)) {
      const files = acrylicSheetsFor(insert);
      notes.push(`<strong>Set in acrylic ${insertName(insert)}</strong>${files.length ? ` from ${files.map((sheet) => `<code>${escapeXml(sheet.filename)}</code>`).join(", ")}` : ""} once this layer${insert.polygons.some((polygon) => polygon.holes.length) ? " and the islands inside its opening are" : " is"} glued and set. Peel the film from its underside, dry-fit it in the opening, then lift it out, put a few dots of clear acrylic-safe glue (not superglue, which fogs acrylic) on the ledge and press it home. Peel the top film when the model is finished.`);
    }
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
  const acrylicSheets = acrylic?.sheets ?? [];
  const acrylicRows = acrylicSheets.map((sheet) => `<tr><td><input type="checkbox" aria-label="Cut ${escapeXml(sheet.filename)}"></td><td><code>${escapeXml(sheet.filename)}</code></td><td>${sheet.insertIds.map(escapeXml).join(", ")}</td></tr>`).join("");
  const acrylicMaps = acrylicSheets.map((sheet) => sheet.map ? sheetMapFigure({ filename: sheet.filename, layerIndexes: [] }, sheet.map) : "").join("");
  const acrylicCut = acrylicSheets.length ? `
<h3 style="margin-top:24px">Acrylic</h3>
<p class="muted">Cut these as a separate job with your acrylic settings, film left on. The last column names the inserts on each file; acrylic carries no engraved ids${acrylicMaps ? ", so the maps below name them" : ", so keep each with its file"}.</p>
<table><tbody>${acrylicRows}</tbody></table>${acrylicMaps ? `\n<div class="sheet-maps">${acrylicMaps}</div>` : ""}` : "";

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
    inserts.length ? `<li><span class="swatch swatch-acrylic"></span>Acrylic water insert, named W1, W2…</li>` : "",
  ].filter(Boolean).join("");

  const marks = [
    config.showAlignmentGuides ? `<li><strong>Outline and Lxx label.</strong> Each layer carries an engraved outline showing exactly where the next layer sits, plus its layer number. Both end up hidden.</li>` : "",
    labelsOn ? `<li><strong>Piece ids.</strong> Each layer is cut in ${split!.columns} × ${split!.rows} parts. Every piece has a green id like <code>L03-B2</code> (layer 03, column B, row 2) where the next layer will cover it. Top-layer pieces have none.</li>` : "",
    // Nested sheets mix layers, so the export engraves an id on every covered piece, split or not.
    nestedSheet && config.showAssemblyLabels && !split ? `<li><strong>Piece ids.</strong> Pieces from different layers share each sheet, so every piece carries a green id like <code>L05</code> or <code>L05-2</code> (layer 05, island 2) where the next layer will cover it. Pieces with no covered room, the top layer's among them, are named on the sheet maps.</li>` : "",
    split && !labelsOn ? `<li><strong>Split layers.</strong> Each layer is cut in ${split.columns} × ${split.rows} parts. Use the step pictures to place them.</li>` : "",
    inserts.some((insert) => insert.markings.some((mark) => !mark.knockout)) ? `<li><strong>On the acrylic.</strong> Map detail that crosses the water is engraved on the inserts' top face.</li>` : "",
    `<li><strong>Everything else</strong> engraved on the pieces (contours, roads, labels) is part of the artwork.</li>`,
  ].filter(Boolean).join("");

  const width = length(ir.widthMm);
  const height = length(ir.heightMm);
  const facts = [
    ["Finished size", `${amount(ir.widthMm)} × ${amount(ir.heightMm)} × ${length(count * thickness)}`],
    ["Layers", `${count} × ${length(thickness)}`],
    ["Pieces", String(pieceTotal)],
    ["Sheets to cut", String(sheets.length)],
    ...(inserts.length ? [["Acrylic inserts", `${inserts.length} × ${length(acrylic!.thicknessMm)}`]] : []),
    ...(airspace ? [airspaceFact(airspace)] : []),
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
${assemblyGuideStyles({ fonts, sheetMaps: Boolean(sheetMaps), acrylic: inserts.length > 0, pieceIdSizePx: Math.max(ir.widthMm, ir.heightMm) * 0.035 })}
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
${inserts.length ? `<li>${plural(acrylicSheets.length, "sheet")} of ${length(acrylic!.thicknessMm)} clear or tinted cast acrylic${acrylic!.sheetSize ? `, each ${length(acrylic!.sheetSize.widthMm)} × ${length(acrylic!.sheetSize.heightMm)}` : ""}, for ${plural(inserts.length, "water insert")}</li>
<li>Clear, acrylic-safe glue for the inserts (not superglue: it leaves a white haze on acrylic)</li>` : ""}
${airspace ? airspaceNeeds(airspace, length) : ""}
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
<table><tbody>${sheetRows}</tbody></table>${sheetMaps ? `\n<p class="muted">Pieces from different layers share each sheet. Each map shows every piece where the laser cuts it, named by its id; use it for any piece without an engraved id.</p>\n<div class="sheet-maps">${sheetMaps}</div>` : ""}${acrylicCut}
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
${airspace ? airspaceSection(airspace, {
    length,
    diagram,
    polygonPath: (polygon) => polygonPath(polygon, tolerance),
    outlineId: `g-${layers[0]!.id}`,
    sectionNumber: buildSection + 1,
    labelSizeMm: Math.max(ir.widthMm, ir.heightMm) * 0.025,
  }) : ""}
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
