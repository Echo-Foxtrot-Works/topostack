import { dashPolyline, type Polyline } from "../primitives/dash.js";
import { flattenSvgPath } from "../annotate/svg-path-data.js";
import type { Point2D } from "../types.js";
import { ASSEMBLY, CUT, EXPORT_CREDIT } from "./svg-primitives.js";

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

export type LightBurnLayerKey = "engrave-fill" | "engrave" | "assembly-fill" | "assembly" | "score" | "cut";

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
/** Chord tolerance, in SVG units (mm), when a circle becomes line segments. */
const CIRCLE_TOLERANCE_MM = 0.01;

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface Paint {
  operation?: string;
  stroke?: string;
  fill?: string;
  dash?: number[];
}


interface ShapeNode { kind: "shape"; layer: LightBurnLayerKey; line: Polyline }
interface GroupNode { kind: "group"; children: Node[] }
type Node = ShapeNode | GroupNode;

interface Frame { group?: GroupNode; matrix: Matrix; paint: Paint }

const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function attributes(source: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const [, name, value] of source.matchAll(ATTRIBUTE)) values.set(name!, unescapeXml(value!));
  return values;
}

function unescapeXml(value: string): string {
  return value.replace(/&(lt|gt|quot|apos|amp);/g, (_, entity: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[entity]!);
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** An SVG transform list as one matrix. */
export function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let result = IDENTITY;
  for (const [, name, args] of value.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g)) {
    const n = args!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let next: Matrix = IDENTITY;
    if (name === "matrix" && n.length === 6) next = n as unknown as Matrix;
    else if (name === "translate") next = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (name === "scale") next = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (name === "rotate") {
      const radians = ((n[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const [cx = 0, cy = 0] = [n[1], n[2]];
      next = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
    result = multiply(result, next);
  }
  return result;
}

function apply(matrix: Matrix, point: Point2D): Point2D {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

function inheritPaint(parent: Paint, values: Map<string, string>): Paint {
  const dash = values.get("stroke-dasharray");
  return {
    operation: values.get("data-operation") ?? parent.operation,
    stroke: values.get("stroke") ?? parent.stroke,
    fill: values.get("fill") ?? parent.fill,
    dash: dash === undefined ? parent.dash : dash === "none" ? undefined : dash.trim().split(/[\s,]+/).map(Number).filter((length) => Number.isFinite(length) && length >= 0),
  };
}

function isPainted(color: string | undefined): color is string {
  return Boolean(color) && color !== "none" && color !== "transparent";
}

/** The layer a shape belongs on, or undefined for unpainted shapes. Fills win over strokes. */
function layerFor(paint: Paint): { layer: LightBurnLayerKey; filled: boolean } | undefined {
  // SVG's initial fill is black; TopoStack always states it, so an unstated fill is treated as none.
  const filled = isPainted(paint.fill);
  const color = (filled ? paint.fill : paint.stroke)?.toUpperCase();
  if (!filled && !isPainted(paint.stroke)) return undefined;
  if (color === ASSEMBLY.toUpperCase()) return { layer: filled ? "assembly-fill" : "assembly", filled };
  const operation = paint.operation?.toUpperCase() ?? (color === CUT.toUpperCase() ? "CUT" : "ENGRAVE");
  if (operation === "CUT") return { layer: "cut", filled: false };
  if (operation === "SCORE") return { layer: "score", filled: false };
  return { layer: filled ? "engrave-fill" : "engrave", filled };
}

function circlePoints(cx: number, cy: number, r: number): Point2D[] {
  const steps = Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - CIRCLE_TOLERANCE_MM / r))));
  return Array.from({ length: steps }, (_, step) => {
    const angle = (step / steps) * Math.PI * 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

function elementPolylines(name: string, values: Map<string, string>): Polyline[] {
  const number = (key: string) => Number(values.get(key) ?? 0);
  if (name === "path") {
    return flattenSvgPath(values.get("d") ?? "", 0.01).map(({ points, closed }) => {
      const last = points.at(-1);
      const trimmed = closed && last && points.length > 1 && last.x === points[0]!.x && last.y === points[0]!.y ? points.slice(0, -1) : points;
      return { points: trimmed, closed };
    });
  }
  if (name === "rect") {
    const [x, y, w, h] = [number("x"), number("y"), number("width"), number("height")];
    return w > 0 && h > 0 ? [{ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true }] : [];
  }
  if (name === "circle") {
    const r = number("r");
    return r > 0 ? [{ points: circlePoints(number("cx"), number("cy"), r), closed: true }] : [];
  }
  if (name === "line") return [{ points: [{ x: number("x1"), y: number("y1") }, { x: number("x2"), y: number("y2") }], closed: false }];
  if (name === "polyline" || name === "polygon") {
    const n = (values.get("points") ?? "").trim().split(/[\s,]+/).map(Number);
    const points = Array.from({ length: Math.floor(n.length / 2) }, (_, index) => ({ x: n[index * 2]!, y: n[index * 2 + 1]! }));
    return [{ points, closed: name === "polygon" }];
  }
  return [];
}

/** Maps SVG user units to LightBurn millimetres, Y up, with the canvas's lower-left corner at the origin. */
function documentMatrix(values: Map<string, string>): Matrix {
  const millimetres = (value: string | undefined) => {
    const match = value?.match(/^\s*([\d.]+)\s*(mm|cm|in|px|pt)?\s*$/);
    if (!match) return undefined;
    const factor = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96, pt: 25.4 / 72 }[match[2] ?? "px"]!;
    return Number(match[1]) * factor;
  };
  const view = values.get("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = millimetres(values.get("width"));
  const height = millimetres(values.get("height"));
  const [vx, vy, vw, vh] = view?.length === 4 ? view as [number, number, number, number] : [0, 0, width ?? 0, height ?? 0];
  const sx = width && vw ? width / vw : 1;
  const sy = height && vh ? height / vh : sx;
  return [sx, 0, 0, -sy, -vx * sx, (vy + vh) * sy];
}

/** Reads a TopoStack SVG into a tree of layer-tagged polylines in LightBurn coordinates. */
function readSvg(svg: string): Node[] {
  const root: GroupNode = { kind: "group", children: [] };
  const stack: Frame[] = [{ group: root, matrix: IDENTITY, paint: {} }];
  let skipDepth = 0;
  for (const [, closing, rawName, rawAttributes, selfClosing] of svg.matchAll(TAG)) {
    const name = rawName!.toLowerCase();
    if (closing) {
      if (skipDepth) skipDepth -= 1;
      else if (name === "g" || name === "svg") stack.pop();
      continue;
    }
    if (skipDepth || name === "defs" || name === "title" || name === "desc" || name === "clippath" || name === "mask" || name === "pattern" || name === "symbol") {
      if (!selfClosing) skipDepth += 1;
      continue;
    }
    const values = attributes(rawAttributes ?? "");
    const parent = stack.at(-1)!;
    if (values.get("display") === "none" || values.get("visibility") === "hidden") {
      if (!selfClosing) skipDepth += 1;
      continue;
    }
    const matrix = name === "svg" && stack.length === 1
      ? documentMatrix(values)
      : multiply(parent.matrix, parseTransform(values.get("transform")));
    const paint = inheritPaint(parent.paint, values);
    if (name === "svg" || name === "g") {
      // A transformed group is a placed panel or nested part: keep it movable as one LightBurn group.
      let group = parent.group!;
      if (name === "g" && values.has("transform")) {
        const child: GroupNode = { kind: "group", children: [] };
        group.children.push(child);
        group = child;
      }
      if (!selfClosing) stack.push({ group, matrix, paint });
      continue;
    }
    const target = layerFor(paint);
    if (!target) continue;
    for (const line of elementPolylines(name, values)) {
      if (line.points.length < (line.closed ? 3 : 2)) continue;
      const dashed = !target.filled && paint.dash?.some((length) => length > 0) ? dashPolyline(line, paint.dash) : [line];
      for (const piece of dashed) parent.group!.children.push({ kind: "shape", layer: target.layer, line: { points: piece.points.map((point) => apply(matrix, point)), closed: piece.closed } });
    }
  }
  return prune(root.children);
}

/** Drops empty groups and unwraps groups of one, which LightBurn would show as needless nesting. */
function prune(nodes: Node[]): Node[] {
  return nodes.flatMap((node): Node[] => {
    if (node.kind === "shape") return [node];
    const children = prune(node.children);
    if (!children.length) return [];
    return children.length === 1 ? children : [{ kind: "group", children }];
  });
}

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
  const { points, closed } = node.line;
  const verts = points.map((point) => `V${number(point.x)} ${number(point.y)}c0x1c1x1`).join("");
  const segments = closed ? points.length : points.length - 1;
  const prims = Array.from({ length: segments }, (_, index) => `L${index} ${(index + 1) % points.length}`).join("");
  return `${indent}<Shape Type="Path" CutIndex="${layers.get(node.layer)!.index}">\n${indent}    <XForm>1 0 0 1 0 0</XForm>\n${indent}    <VertList>${verts}</VertList>\n${indent}    <PrimList>${prims}</PrimList>\n${indent}</Shape>`;
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
  const nodes = readSvg(svg);
  const used = usedLayers(nodes);
  if (!used.size) return undefined;
  const layers = LIGHTBURN_LAYERS.filter((layer) => used.has(layer.key));
  const byKey = new Map(layers.map((layer) => [layer.key, layer]));
  const notes = `${options.notes ?? LIGHTBURN_NOTES}\n${EXPORT_CREDIT}`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<LightBurnProject AppVersion="1.7.03" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">`,
    ...layers.map((layer, priority) => cutSettingXml(layer, priority)),
    ...nodes.map((node) => shapeXml(node, byKey, "    ")),
    `    <Notes ShowOnLoad="1" Notes="${escapeAttribute(notes)}"/>`,
    `</LightBurnProject>`,
    "",
  ].join("\n");
}
