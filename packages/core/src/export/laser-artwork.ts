import { dashPolyline, type Polyline } from "../primitives/dash.js";
import { flattenSvgPath } from "../annotate/svg-path-data.js";
import type { Point2D } from "../types.js";
import { ASSEMBLY, CUT } from "./svg-primitives.js";

export type ArtworkLayer = "engrave-fill" | "engrave" | "assembly-fill" | "assembly" | "score" | "cut";

/** Chord tolerance, in SVG units (mm), when a circle becomes line segments. */
const CIRCLE_TOLERANCE_MM = 0.01;

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface Paint {
  operation?: string;
  stroke?: string;
  fill?: string;
  fillRule?: string;
  dash?: number[];
}

export interface ShapeNode { kind: "shape"; layer: ArtworkLayer; fillRule: string; subpaths: Polyline[] }
interface GroupNode { kind: "group"; children: ArtworkNode[]; piece?: boolean; name?: string }
export type ArtworkNode = ShapeNode | GroupNode;

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
    fillRule: values.get("fill-rule") ?? parent.fillRule,
    dash: dash === undefined ? parent.dash : dash === "none" ? undefined : dash.trim().split(/[\s,]+/).map(Number).filter((length) => Number.isFinite(length) && length >= 0),
  };
}

function isPainted(color: string | undefined): color is string {
  return Boolean(color) && color !== "none" && color !== "transparent";
}

/** The layer a shape belongs on, or undefined for unpainted shapes. Fills win over strokes. */
function layerFor(paint: Paint): { layer: ArtworkLayer; filled: boolean } | undefined {
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

/** Map the viewBox to millimetres in the target editor’s coordinate system. */
function documentMatrix(values: Map<string, string>, yAxis: "up" | "down"): Matrix {
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
  if (yAxis === "down") return [sx, 0, 0, sy, -vx * sx, -vy * sy];
  return [sx, 0, 0, -sy, -vx * sx, (vy + vh) * sy];
}

/** Reads a TopoStack SVG into a tree of layer-tagged polylines in physical millimetres. */
export function readLaserSvg(svg: string, yAxis: "up" | "down"): ArtworkNode[] {
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
      ? documentMatrix(values, yAxis)
      : multiply(parent.matrix, parseTransform(values.get("transform")));
    const paint = inheritPaint(parent.paint, values);
    if (name === "svg" || name === "g") {
      // Ordinary panels have no transform. Their piece owns its cuts and marks just as on a stock sheet.
      let group = parent.group!;
      const part = values.has("data-piece") || values.has("data-name");
      if (name === "g" && (values.has("transform") || part)) {
        const child: GroupNode = { kind: "group", children: [], piece: part, name: values.get("data-name") ?? values.get("data-piece") };
        group.children.push(child);
        group = child;
      }
      if (!selfClosing) stack.push({ group, matrix, paint });
      continue;
    }
    const target = layerFor(paint);
    if (!target) continue;
    const subpaths: Polyline[] = [];
    for (const line of elementPolylines(name, values)) {
      if (line.points.length < (line.closed ? 3 : 2)) continue;
      const dashed = !target.filled && paint.dash?.some((length) => length > 0) ? dashPolyline(line, paint.dash) : [line];
      for (const piece of dashed) subpaths.push({ points: piece.points.map(point => apply(matrix, point)), closed: piece.closed });
    }
    if (subpaths.length) parent.group!.children.push({ kind: "shape", layer: target.layer, fillRule: paint.fillRule ?? "nonzero", subpaths });
  }
  return prune(root.children);
}

/** Drop empty groups and unwrap single-child transform wrappers, retaining every piece. */
function prune(nodes: ArtworkNode[]): ArtworkNode[] {
  return nodes.flatMap((node): ArtworkNode[] => {
    if (node.kind === "shape") return [node];
    const children = prune(node.children);
    if (!children.length) return [];
    return children.length === 1 && !node.piece ? children : [{ ...node, children }];
  });
}
