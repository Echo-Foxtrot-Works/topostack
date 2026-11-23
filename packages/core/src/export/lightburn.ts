import { readLaserSvg, type ArtworkLayer, type ArtworkNode as Node } from "./laser-artwork.js";
import { EXPORT_CREDIT } from "./svg-primitives.js";
export { parseTransform } from "./laser-artwork.js";

/**
 * LightBurn project files (.lbrn2) written from TopoStack's own export SVGs.
 *
 * Importing an SVG into LightBurn maps each colour to the nearest palette
 * layer, so the cut, score and engraving work arrives on layers the maker has
 * to identify and rename, SCORE and ENGRAVE share one blue, and dash patterns
 * are dropped. A project file instead carries one named layer per operation,
 * in running order, with the geometry already on it. It sets no speed or
 * power: those belong to the maker's machine and material.
 *
 * The converter reads only the SVG TopoStack writes (absolute M/L/Z paths,
 * rect, circle, translate and matrix transforms, `data-operation` groups),
 * so the SVG stays the single source of geometry and the two files cannot
 * drift apart.
 */

/** One processing layer: LightBurn's palette index, its name, and how it runs. */
export interface LightBurnLayer {
  key: LightBurnLayerKey;
  /** LightBurn colour index (C00–C29); the layer's colour in the Cuts / Layers list. */
  index: number;
  name: string;
  /** "Cut" is LightBurn's Line mode; "Scan" is Fill. */
  mode: "Cut" | "Scan";
}

export type LightBurnLayerKey = ArtworkLayer;

/** Layers in running order: marking first, the through cut last so pieces stay put. */
export const LIGHTBURN_LAYERS: readonly LightBurnLayer[] = [
  { key: "engrave-fill", index: 6, name: "Engrave fill", mode: "Scan" },
  { key: "engrave", index: 1, name: "Engrave lines", mode: "Cut" },
  { key: "assembly-fill", index: 11, name: "Assembly ids fill", mode: "Scan" },
  { key: "assembly", index: 3, name: "Assembly ids", mode: "Cut" },
  { key: "score", index: 5, name: "Score", mode: "Cut" },
  { key: "cut", index: 2, name: "Cut", mode: "Cut" },
];

/** LightBurn's coordinates are saved as written; a tenth of a micron is far below any beam. */
const PRECISION = 4;
function usedLayers(nodes: Node[], used = new Set<LightBurnLayerKey>()): Set<LightBurnLayerKey> {
  for (const node of nodes) {
    if (node.kind === "shape") used.add(node.layer);
    else usedLayers(node.children, used);
  }
  return used;
}

function number(value: number): string {
  const rounded = Number(value.toFixed(PRECISION));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!).replace(/\n/g, "&#10;");
}

function shapeXml(node: Node, layers: ReadonlyMap<LightBurnLayerKey, LightBurnLayer>, indent: string): string {
  if (node.kind === "group") {
    return `${indent}<Shape Type="Group">\n${indent}    <XForm>1 0 0 1 0 0</XForm>\n${indent}    <Children>\n${node.children.map((child) => shapeXml(child, layers, `${indent}        `)).join("\n")}\n${indent}    </Children>\n${indent}</Shape>`;
  }
  const verts: string[] = [];
  const prims: string[] = [];
  // Each SVG move begins an independent chain. A hole closes onto its own
  // first vertex, and a gap between dashes has no connecting primitive.
  for (const { points, closed } of node.subpaths) {
    const first = verts.length;
    for (const point of points) verts.push(`V${number(point.x)} ${number(point.y)}c0x1c1x1`);
    for (let i = first + 1; i < verts.length; i++) prims.push(`L${i - 1} ${i}`);
    if (closed) prims.push(`L${verts.length - 1} ${first}`);
  }
  return `${indent}<Shape Type="Path" CutIndex="${layers.get(node.layer)!.index}">\n${indent}    <XForm>1 0 0 1 0 0</XForm>\n${indent}    <VertList>${verts.join("")}</VertList>\n${indent}    <PrimList>${prims.join("")}</PrimList>\n${indent}</Shape>`;
}

function cutSettingXml(layer: LightBurnLayer, priority: number): string {
  return [
    `    <CutSetting type="${layer.mode}">`,
    `        <index Value="${layer.index}"/>`,
    `        <name Value="${escapeAttribute(layer.name)}"/>`,
    `        <priority Value="${priority}"/>`,
    // TopoStack has already compensated the cut paths for the beam when Laser kerf is set.
    `        <kerf Value="0"/>`,
    `    </CutSetting>`,
  ].join("\n");
}

export interface LightBurnOptions {
  /** Shown by LightBurn when the project opens; defaults to a short reminder to set power and speed. */
  notes?: string;
}

const LIGHTBURN_NOTES = "Made with TopoStack. Layers run top to bottom: engraving, assembly ids, score, then the through cut. Set speed, power and passes for your machine and material on every layer before running. When TopoStack's Laser kerf is set, cut paths are already compensated: leave Kerf Offset at 0.";

/**
 * Converts one TopoStack export SVG into a LightBurn project (.lbrn2 XML), or
 * undefined when the SVG holds nothing to cut, score or engrave.
 */
export function svgToLightBurn(svg: string, options: LightBurnOptions = {}): string | undefined {
  return lightBurnProject([{ name: "", nodes: readLaserSvg(svg, "up") }], options);
}

/** Page zero lives at the root. LightBurn 2.2 stores each later page as a named group. */
export function svgPagesToLightBurn(panels: readonly { name: string; svg: string }[], options: LightBurnOptions = {}): string | undefined {
  const pages = panels.map(({ name, svg }) => ({ name, nodes: readLaserSvg(svg, "up") })).filter(page => page.nodes.length);
  return lightBurnProject(pages, options, true);
}

function lightBurnProject(pages: { name: string; nodes: Node[] }[], options: LightBurnOptions, paged = false): string | undefined {
  const first = pages[0];
  if (!first) return undefined;
  const used = new Set<LightBurnLayerKey>();
  for (const page of pages) usedLayers(page.nodes, used);
  if (!used.size) return undefined;
  const layers = LIGHTBURN_LAYERS.filter((layer) => used.has(layer.key));
  const byKey = new Map(layers.map((layer) => [layer.key, layer]));
  const notes = `${options.notes ?? (paged ? LIGHTBURN_NOTES + " Cut settings are shared across pages. Check the material settings when you switch sheets." : LIGHTBURN_NOTES)}\n${EXPORT_CREDIT}`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<LightBurnProject AppVersion="${paged ? "2.2.01" : "1.7.03"}" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False"${paged ? ` CurrentPage="0" Page0Name="${escapeAttribute(first.name)}"` : ""}>`,
    ...layers.map((layer, priority) => cutSettingXml(layer, priority)),
    ...first.nodes.map((node) => shapeXml(node, byKey, "    ")),
    ...pages.slice(1).map(({ name, nodes }) => [
      `    <Shape Type="Group" SubType="Page" Name="${escapeAttribute(name)}">`,
      "        <XForm>1 0 0 1 0 0</XForm>",
      "        <Children>",
      ...nodes.map(node => shapeXml(node, byKey, "            ")),
      "        </Children>",
      "    </Shape>",
    ].join("\n")),
    `    <Notes ShowOnLoad="1" Notes="${escapeAttribute(notes)}"/>`,
    `</LightBurnProject>`,
    "",
  ].join("\n");
}
