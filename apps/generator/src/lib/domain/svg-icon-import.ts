import { buildMarkerIcon, flattenSvgPath, MAX_CUSTOM_DATA_NAME_LENGTH, MAX_CUSTOM_GRAPHIC_POINTS, type CustomGraphicV1, type MarkerIconPaint, type MarkerIconV1, type PathPolyline } from "@topostack/core";

/**
 * Reading an SVG the maker uploads as a marker icon. The file is parsed as
 * XML and reduced to the region it paints; nothing from it is ever put in the
 * page, so scripts, links and external references in it do nothing.
 */

/** Icons are small drawings; anything larger is almost certainly not one. */
const MAX_SVG_ICON_BYTES = 1_000_000;

export interface SvgIconImport {
  icon: MarkerIconV1;
  /** What the icon leaves out of the SVG, for the maker to check. */
  warnings: string[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply([a1, b1, c1, d1, e1, f1]: Matrix, [a2, b2, c2, d2, e2, f2]: Matrix): Matrix {
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

/** An SVG `transform` list, composed left to right as SVG applies it. */
export function parseTransform(value: string | null): Matrix {
  let matrix = IDENTITY;
  if (!value) return matrix;
  for (const [, name, args] of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const n = (args!.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let next: Matrix = IDENTITY;
    if (name === "matrix" && n.length === 6) next = n as Matrix;
    else if (name === "translate") next = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (name === "scale") next = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (name === "rotate") {
      const angle = (n[0] ?? 0) * Math.PI / 180;
      const rotation: Matrix = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      const [cx = 0, cy = 0] = n.slice(1);
      next = multiply(multiply([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]);
    } else if (name === "skewX") next = [1, 0, Math.tan((n[0] ?? 0) * Math.PI / 180), 1, 0, 0];
    else if (name === "skewY") next = [1, Math.tan((n[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0];
    matrix = multiply(matrix, next);
  }
  return matrix;
}

/** Paint properties that pass from a group to what it contains. */
interface Style {
  fill: string;
  fillRule: "nonzero" | "evenodd";
  stroke: string;
  strokeWidth: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  color: string;
  fillOpacity: number;
  strokeOpacity: number;
  visible: boolean;
}

const DEFAULT_STYLE: Style = { fill: "black", fillRule: "nonzero", stroke: "none", strokeWidth: 1, cap: "butt", join: "miter", color: "black", fillOpacity: 1, strokeOpacity: 1, visible: true };

type Declarations = Map<string, string>;

function parseDeclarations(text: string): Declarations {
  const declarations: Declarations = new Map();
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon > 0) declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).replace(/!important/i, "").trim());
  }
  return declarations;
}

/**
 * Simple selectors from the file's own `<style>` (`.class`, `#id`, `tag`),
 * which design tools write for every colour. Anything more elaborate is
 * skipped; SVG icons rarely need it.
 */
function parseStylesheet(document: Document): Array<{ selector: string; declarations: Declarations }> {
  const rules: Array<{ selector: string; declarations: Declarations }> = [];
  for (const style of document.getElementsByTagName("style")) {
    const text = (style.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selectors, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = parseDeclarations(body!);
      for (const selector of selectors!.split(",").map((item) => item.trim())) {
        if (/^[.#]?[\w-]+$/.test(selector)) rules.push({ selector, declarations });
      }
    }
  }
  return rules;
}

function matches(element: Element, selector: string): boolean {
  if (selector.startsWith(".")) return (element.getAttribute("class") ?? "").split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith("#")) return element.getAttribute("id") === selector.slice(1);
  return element.localName === selector;
}

/** Near-white paint is the paper colour on a black icon: it erases what lies under it. */
function isWhite(color: string): boolean {
  const value = color.trim().toLowerCase();
  if (value === "white") return true;
  let rgb: number[] | undefined;
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) rgb = [...hex.slice(0, 3)].map((digit) => parseInt(digit + digit, 16));
  else if (hex && (hex.length === 6 || hex.length === 8)) rgb = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const functional = /^rgba?\(([^)]*)\)$/.exec(value)?.[1];
  if (functional) rgb = functional.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((part) => part.endsWith("%") ? parseFloat(part) * 2.55 : parseFloat(part));
  return !!rgb && rgb.every((channel) => channel >= 235);
}

function number(value: string | null | undefined, fallback = 0): number {
  const parsed = parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

const IGNORED = new Set(["defs", "clipPath", "mask", "symbol", "marker", "pattern", "linearGradient", "radialGradient", "filter", "title", "desc", "metadata", "style", "script"]);
const UNSUPPORTED: Record<string, string> = {
  text: "Text is left out; convert it to outlines first.",
  image: "Embedded images are left out; only vector shapes are used.",
  foreignObject: "Embedded HTML is left out.",
};

/** A basic shape as path data, so every shape flattens the same way. */
function shapePath(element: Element): string | undefined {
  const attribute = (name: string) => number(element.getAttribute(name));
  switch (element.localName) {
    case "path": return element.getAttribute("d") ?? undefined;
    case "rect": {
      const x = attribute("x"); const y = attribute("y"); const width = attribute("width"); const height = attribute("height");
      if (!(width > 0 && height > 0)) return undefined;
      let rx = element.hasAttribute("rx") ? attribute("rx") : element.hasAttribute("ry") ? attribute("ry") : 0;
      let ry = element.hasAttribute("ry") ? attribute("ry") : rx;
      rx = Math.min(Math.max(rx, 0), width / 2); ry = Math.min(Math.max(ry, 0), height / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
      return `M${x + rx} ${y}H${x + width - rx}A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}V${y + height - ry}A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case "circle":
    case "ellipse": {
      const cx = attribute("cx"); const cy = attribute("cy");
      const rx = element.localName === "circle" ? attribute("r") : attribute("rx");
      const ry = element.localName === "circle" ? rx : attribute("ry");
      if (!(rx > 0 && ry > 0)) return undefined;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case "line": return `M${attribute("x1")} ${attribute("y1")}L${attribute("x2")} ${attribute("y2")}`;
    case "polyline":
    case "polygon": {
      const values = (element.getAttribute("points") ?? "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
      if (values.length < 4) return undefined;
      const pairs = [];
      for (let index = 0; index + 1 < values.length; index += 2) pairs.push(`${values[index]} ${values[index + 1]}`);
      return `M${pairs.join("L")}${element.localName === "polygon" ? "Z" : ""}`;
    }
    default: return undefined;
  }
}

/** The drawing's size, so curves flatten finely enough whatever units it uses. */
function drawingExtent(root: Element): number {
  const viewBox = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) return Math.max(viewBox[2]!, viewBox[3]!);
  const size = Math.max(number(root.getAttribute("width")), number(root.getAttribute("height")));
  return size > 0 ? size : 24;
}

/**
 * Reads SVG text into a marker icon, or throws with a message for the maker.
 * `maxPoints` and `noun` let custom graphics share the reader with a larger budget.
 */
export function svgIconFromText(text: string, options: { id: string; name: string; maxPoints?: number; noun?: string }): SvgIconImport {
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg" || document.getElementsByTagName("parsererror").length) throw new Error("This file is not a readable SVG.");
  const rules = parseStylesheet(document);
  const warnings = new Set<string>();
  const paints: MarkerIconPaint[] = [];
  const tolerance = drawingExtent(root) / 4000;
  const byId = new Map<string, Element>();
  for (const element of document.getElementsByTagName("*")) {
    const id = element.getAttribute("id");
    if (id && !byId.has(id)) byId.set(id, element);
  }

  const declarationsFor = (element: Element): Declarations => {
    const merged: Declarations = new Map();
    for (const attribute of element.attributes) merged.set(attribute.name.toLowerCase(), attribute.value.trim());
    // Stylesheet rules beat presentation attributes; tag, then class, then id.
    for (const kind of ["tag", ".", "#"]) {
      for (const { selector, declarations } of rules) {
        const ruleKind = selector.startsWith(".") ? "." : selector.startsWith("#") ? "#" : "tag";
        if (ruleKind === kind && matches(element, selector)) for (const [key, value] of declarations) merged.set(key, value);
      }
    }
    for (const [key, value] of parseDeclarations(element.getAttribute("style") ?? "")) merged.set(key, value);
    return merged;
  };

  const styleFor = (element: Element, parent: Style): Style | undefined => {
    const declared = declarationsFor(element);
    const value = (name: string) => {
      const found = declared.get(name);
      return found === undefined || found === "inherit" ? undefined : found;
    };
    if (value("display") === "none" || number(value("opacity"), 1) <= 0) return undefined;
    const color = value("color") ?? parent.color;
    const paint = (name: "fill" | "stroke") => {
      const declaredPaint = value(name) ?? parent[name];
      return declaredPaint === "currentColor" || declaredPaint === "currentcolor" ? color : declaredPaint;
    };
    const visibility = value("visibility");
    const cap = value("stroke-linecap"); const join = value("stroke-linejoin"); const rule = value("fill-rule");
    return {
      fill: paint("fill"),
      fillRule: rule === "evenodd" || rule === "nonzero" ? rule : parent.fillRule,
      stroke: paint("stroke"),
      strokeWidth: value("stroke-width") === undefined ? parent.strokeWidth : number(value("stroke-width"), 1),
      cap: cap === "round" || cap === "square" || cap === "butt" ? cap : parent.cap,
      join: join === "round" || join === "bevel" ? join : join === "miter" || join === "miter-clip" || join === "arcs" ? "miter" : parent.join,
      color,
      fillOpacity: value("fill-opacity") === undefined ? parent.fillOpacity : number(value("fill-opacity"), 1),
      strokeOpacity: value("stroke-opacity") === undefined ? parent.strokeOpacity : number(value("stroke-opacity"), 1),
      visible: visibility === "hidden" || visibility === "collapse" ? false : visibility === "visible" ? true : parent.visible,
    };
  };

  const transformed = (polylines: PathPolyline[], [a, b, c, d, e, f]: Matrix): PathPolyline[] =>
    polylines.map(({ points, closed }) => ({ closed, points: points.map(({ x, y }) => ({ x: a * x + c * y + e, y: b * x + d * y + f })) }));

  const paintKind = (color: string, opacity: number): "none" | "ink" | "erase" => {
    const value = color.trim();
    if (!value || value === "none" || value === "transparent" || opacity <= 0) return "none";
    if (value.startsWith("url(")) warnings.add("Gradients and patterns are engraved as solid shapes.");
    return isWhite(value) ? "erase" : "ink";
  };

  const walk = (element: Element, parentStyle: Style, parentMatrix: Matrix, depth: number): void => {
    if (depth > 32) return;
    const name = element.localName;
    if (IGNORED.has(name)) return;
    if (UNSUPPORTED[name]) { warnings.add(UNSUPPORTED[name]!); return; }
    const style = styleFor(element, parentStyle);
    if (!style) return;
    if (element.hasAttribute("clip-path") || element.hasAttribute("mask")) warnings.add("Clipping paths and masks are ignored; the whole shape is used.");
    let matrix = multiply(parentMatrix, parseTransform(element.getAttribute("transform")));
    if (name === "svg" && element !== root) matrix = multiply(matrix, [1, 0, 0, 1, number(element.getAttribute("x")), number(element.getAttribute("y"))]);
    if (name === "svg" || name === "g" || name === "a" || name === "switch") {
      for (const child of element.children) walk(child, style, matrix, depth + 1);
      return;
    }
    if (name === "use") {
      const reference = (element.getAttribute("href") ?? element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "").trim();
      const target = reference.startsWith("#") ? byId.get(reference.slice(1)) : undefined;
      if (!target) { if (reference) warnings.add("References to other files are ignored."); return; }
      const placed = multiply(matrix, [1, 0, 0, 1, number(element.getAttribute("x")), number(element.getAttribute("y"))]);
      // A referenced symbol draws its children, like a group.
      if (target.localName === "symbol") for (const child of target.children) walk(child, style, placed, depth + 1);
      else walk(target, style, placed, depth + 1);
      return;
    }
    const data = shapePath(element);
    if (!data || !style.visible) return;
    const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1;
    const polylines = transformed(flattenSvgPath(data, tolerance / scale), matrix);
    if (!polylines.length) return;
    const fill = paintKind(style.fill, style.fillOpacity);
    // A line encloses nothing, so only its stroke paints.
    if (fill !== "none" && name !== "line") {
      paints.push({ kind: "fill", polylines, rule: style.fillRule, ...(fill === "erase" ? { erase: true } : {}) });
    }
    const stroke = paintKind(style.stroke, style.strokeOpacity);
    if (stroke !== "none" && style.strokeWidth > 0) {
      paints.push({ kind: "stroke", polylines, width: style.strokeWidth * scale, cap: style.cap, join: style.join, ...(stroke === "erase" ? { erase: true } : {}) });
    }
  };
  walk(root, DEFAULT_STYLE, IDENTITY, 0);

  // A white-only icon (drawn for dark backgrounds) is still the icon: engrave its paint.
  const drawn = paints.every((paint) => paint.erase) ? paints.map(({ erase: _erase, ...paint }) => paint as MarkerIconPaint) : paints;
  return { icon: buildMarkerIcon(drawn, options), warnings: [...warnings] };
}

/** The name an icon gets from its file: the file name without its extension. */
export function iconNameFromFile(fileName: string, fallback = "Icon"): string {
  const base = fileName.replace(/\.[^.]*$/, "").replace(/[-_]+/g, " ").trim();
  return (base || fallback).slice(0, MAX_CUSTOM_DATA_NAME_LENGTH);
}

/** Reads an uploaded file into a marker icon, or throws with a message for the maker. */
export async function importSvgIcon(file: Pick<File, "size" | "name" | "text">, id: string): Promise<SvgIconImport> {
  if (file.size > MAX_SVG_ICON_BYTES) throw new Error("SVG icons must be 1 MB or smaller.");
  return svgIconFromText(await file.text(), { id, name: iconNameFromFile(file.name) });
}

export interface SvgGraphicImport {
  graphic: CustomGraphicV1;
  warnings: string[];
}

/** Reads an uploaded file into a custom graphic: the same reading as an icon, with a logo's point budget. */
export async function importSvgGraphic(file: Pick<File, "size" | "name" | "text">, id: string): Promise<SvgGraphicImport> {
  if (file.size > MAX_SVG_ICON_BYTES) throw new Error("SVG graphics must be 1 MB or smaller.");
  const { icon, warnings } = svgIconFromText(await file.text(), { id, name: iconNameFromFile(file.name, "Graphic"), maxPoints: MAX_CUSTOM_GRAPHIC_POINTS, noun: "a graphic" });
  return { graphic: { id: icon.id, name: icon.name, shapes: icon.shapes }, warnings };
}
