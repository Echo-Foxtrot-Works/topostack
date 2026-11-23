import { formatNumber as format } from "../primitives/format.js";
import { dashPolyline } from "../primitives/dash.js";
import { clipPolyline, preparePolygons, type PreparedPolygons } from "../primitives/geometry2d.js";
import { labelSvgPaths, roundText } from "../annotate/labels.js";
import { offsetClosedRing } from "../primitives/offset.js";
import { aviationStroke } from "../pipeline/aviation.js";
import { landStroke } from "../pipeline/lands.js";
import { coveredRailWidthMm, DEFAULT_BUILDING_WIDTH_MM, LAND_CLASSES, type AviationClass, type LandClass, type LayerIR, type OperationPath, type LineStyleV1, type Point2D } from "../types.js";


export const CUT = "#FE0002";
export const SCORE = "#2366FF";
export const ENGRAVE = "#2366FF";
const ENGRAVE_FILL = "#000000";
// Keep processing intent on each leaf shape: importers may flatten SVG groups.
export const CUT_LINE = `fill="none" stroke="${CUT}"`;
export const ENGRAVE_LINE = `fill="none" stroke="${ENGRAVE}"`;
/**
 * Assembly ids get their own colour and group so the machine treats them as a
 * separate process: they are guidance for the person gluing the stack, not
 * part of the artwork, and are hidden by the layer above once assembled.
 */
export const ASSEMBLY = "#00A651";
export const MAX_EXPORT_PACKAGE_BYTES = 100_000_000;
/** Engraving groups in output order; `engravingCategory` maps each marking to one. */
const LAND_CATEGORIES = LAND_CLASSES.map((landClass) => `land-${landClass}` as const);
const ENGRAVING_CATEGORIES = ["buildings", "major-roads", "local-roads", "trails", "rail", "covered-rail", "transport-labels", "water", "boundaries", ...LAND_CATEGORIES, "airspace-b", "airspace-c", "airspace-d", "special-use-airspace", "runways", "aviation-symbols", "aviation-labels", "coordinate-grid", "annotations", "assembly-labels", "general"] as const;
type EngravingCategory = (typeof ENGRAVING_CATEGORIES)[number];
/** Assembly ids ride in their own top-level group, so the artwork categories exclude them. */
export const ARTWORK_CATEGORIES = ENGRAVING_CATEGORIES.filter((category) => category !== "assembly-labels");
export const ASSEMBLY_CATEGORIES = ["assembly-labels"] as const satisfies readonly EngravingCategory[];

export function safeName(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return value || "topostack-project";
}

export function pathData(points: Point2D[], offsetX = 0, offsetY = 0, closePath = false): string {
  const commands = points.map((point, index) => `${index === 0 ? "M" : "L"}${format(point.x + offsetX)} ${format(point.y + offsetY)}`);
  if (closePath) commands.push("Z");
  return commands.join(" ");
}

export function layerCutPaths(layer: LayerIR, laserKerfMm: number, omittedHoles = new Map<number, Set<number>>(), included?: Set<number>): string {
  const compensationMm = laserKerfMm / 2;
  return layer.polygons.flatMap((polygon, polygonIndex) => {
    if (included && !included.has(polygonIndex)) return [];
    const omittedHoleIndexes = omittedHoles.get(polygonIndex) ?? new Set<number>();
    return [
      ...offsetClosedRing(polygon.outer, compensationMm, "miter").map((ring, offsetIndex) => `<path id="${layer.id}-cut-${polygonIndex + 1}-offset-${offsetIndex + 1}" d="${pathData(ring, 0, 0, true)}" ${CUT_LINE}/>`),
      ...polygon.holes.flatMap((hole, holeIndex) => omittedHoleIndexes.has(holeIndex) ? [] : [
        ...offsetClosedRing(hole, -compensationMm, "miter").map((ring, offsetIndex) => `<path id="${layer.id}-cut-${polygonIndex + 1}-hole-${holeIndex + 1}-offset-${offsetIndex + 1}" d="${pathData(ring, 0, 0, true)}" ${CUT_LINE}/>`),
      ]),
    ];
  }).join("");
}

/** Aviation line groups, each with the stroke of the class it holds; symbols share one group. */
const AVIATION_CATEGORIES: Record<AviationClass, EngravingCategory> = {
  "class-b": "airspace-b", "class-c": "airspace-c", "class-d": "airspace-d", "special-use": "special-use-airspace",
  runway: "runways", airport: "aviation-symbols", navaid: "aviation-symbols", obstacle: "aviation-symbols",
};
const CATEGORY_AVIATION_CLASS: Partial<Record<EngravingCategory, AviationClass>> = {
  "airspace-b": "class-b", "airspace-c": "class-c", "airspace-d": "class-d", "special-use-airspace": "special-use", runways: "runway", "aviation-symbols": "airport",
};

function engravingCategory(mark: LayerIR["markings"][number]): EngravingCategory {
  if (mark.id.startsWith("piece-")) return "assembly-labels";
  if (mark.id.startsWith("transport-label-")) return "transport-labels";
  if (mark.id.startsWith("aviation-label-")) return "aviation-labels";
  if (mark.kind === "aviation" && mark.aviationClass) return AVIATION_CATEGORIES[mark.aviationClass];
  if (mark.kind === "land" && mark.landClass) return `land-${mark.landClass}`;
  if (mark.transportationClass === "major-road") return "major-roads";
  if (mark.transportationClass === "local-road") return "local-roads";
  if (mark.transportationClass === "trail") return "trails";
  if (mark.transportationClass === "rail" || mark.transportationClass === "covered-rail") return mark.transportationClass;
  if (mark.kind === "building") return "buildings";
  if (mark.kind === "water") return "water";
  if (mark.kind === "boundary") return "boundaries";
  if (mark.kind === "grid") return "coordinate-grid";
  if (mark.kind === "label" || mark.kind === "guide") return "annotations";
  return "general";
}

interface CategoryStroke {
  widthMm: number;
  dash?: number[];
  cap?: "round" | "butt" | "square";
  roundJoin?: boolean;
}

function categoryStroke(category: EngravingCategory, style: LineStyleV1): CategoryStroke {
  const width = category === "major-roads" ? style.majorRoadMm :
    category === "covered-rail" ? coveredRailWidthMm(style) :
    category === "buildings" ? (style.buildingMm ?? DEFAULT_BUILDING_WIDTH_MM) :
    category === "local-roads" || category === "rail" ? style.localRoadMm :
    category === "trails" ? style.trailMm :
    category === "water" ? style.waterMm :
    category === "boundaries" ? style.boundaryMm :
    category === "coordinate-grid" ? style.coordinateGridMm : style.annotationMm;
  const aviationClass = CATEGORY_AVIATION_CLASS[category];
  if (aviationClass || category.startsWith("land-")) {
    const stroke = aviationClass ? aviationStroke(aviationClass, style) : landStroke(category.slice("land-".length) as LandClass, style);
    return { ...stroke, cap: stroke.dash ? "round" : undefined, roundJoin: true };
  }
  if (category === "boundaries") return { widthMm: width, dash: [Math.max(width * 8, 1.6), Math.max(width * 5, 1)], cap: "round" };
  if (category === "coordinate-grid") return { widthMm: width, dash: [0.01, Math.max(width * 5, 0.9)], cap: "round" };
  if (category === "rail" || category === "covered-rail") return { widthMm: width, cap: "round", roundJoin: true };
  if (category === "major-roads" || category === "local-roads") return { widthMm: width, cap: style.roadCap, roundJoin: true };
  if (category !== "trails" || style.trailPattern === "solid") return { widthMm: width };
  const dash = style.trailPattern === "dotted" ? [0.01, Math.max(width * 4, 0.7)] : [Math.max(width * 6, 1.2), Math.max(width * 4, 0.8)];
  return { widthMm: width, dash, cap: "round" };
}

/** White preview halos are empty material, never a laser operation. Resolve
 * them into gaps in the actual line geometry before serialization. */
export interface MarkerClearance { material: PreparedPolygons; excluded: PreparedPolygons }
export function markerClearance(layers: LayerIR[]): MarkerClearance | undefined {
  const halos = layers.flatMap(layer => layer.markings.filter(mark => mark.knockout));
  if (!halos.length) return undefined;
  return {
    material: preparePolygons(layers.flatMap(layer => layer.polygons)),
    excluded: preparePolygons(halos.map(mark => ({ outer: mark.points, holes: mark.holes ?? [] }))),
  };
}

/** All internal line serializers emit absolute M/L coordinates (no curves). */
export function clearLineData(data: string, clearance?: MarkerClearance): string {
  if (!clearance) return data;
  return data.split("M").filter(Boolean).flatMap(subpath => {
    const points = [...subpath.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
    return clipPolyline(points, clearance.material, clearance.excluded).map(points => pathData(points));
  }).join(" ");
}

function markingPath(mark: OperationPath, cleared: ReadonlyMap<OperationPath, OperationPath[]>, dash?: number[], assembly = false): string {
  if (mark.knockout) return "";
  const color = assembly ? ASSEMBLY : mark.operation === "score" ? SCORE : ENGRAVE;
  const fillColor = assembly ? ASSEMBLY : ENGRAVE_FILL;
  const fragments = cleared.get(mark) ?? [mark];
  if (!fragments.length) return "";
  const first = fragments[0]!;
  if (first.label && first.points[0]) {
    const { stroke: strokeData, fill } = labelSvgPaths(first.label, first.points[0], 0, 0, first.labelRotationRad, first.textStyle);
    if (fill) return `<path id="${escapeXml(mark.id)}" d="${fill}" fill="${fillColor}" stroke="none" fill-rule="evenodd"/>`;
    return `<path id="${escapeXml(mark.id)}" d="${strokeData}" fill="none" stroke="${color}"${roundText(first.textStyle) ? ' stroke-linecap="round" stroke-linejoin="round"' : ""}/>`;
  }
  const paint = first.filled ? `fill="${fillColor}" stroke="none"` : `fill="none" stroke="${color}"`;
  // One editable feature, with an SVG move across each physical gap.
  const lineData = (points: Point2D[], closed = false) => dash && !first.filled
    ? dashPolyline({ points, closed }, dash).map(line => pathData(line.points)).join(" ")
    : pathData(points, 0, 0, closed);
  const data = fragments.filter(part => part.points.length > 1).flatMap(part => [
    lineData(part.points, part.filled), ...(part.holes ?? []).map(hole => lineData(hole, true)),
  ]).filter(Boolean).join(" ");
  const attributes = fragments.some(part => part.holes?.length) ? ' fill-rule="evenodd"' :
    mark.label && !first.filled && roundText(mark.textStyle) ? ' stroke-linecap="round" stroke-linejoin="round"' : "";
  return data ? `<path id="${escapeXml(mark.id)}" d="${data}" ${paint}${attributes}/>` : "";
}

export function markingGroups(prefix: string, style: LineStyleV1, categories: readonly EngravingCategory[], markings: OperationPath[], clearance: ReadonlyMap<OperationPath, OperationPath[]>): string {
  return categories.map((category) => {
    const members = markings.filter(mark => engravingCategory(mark) === category);
    if (!members.length) return "";
    const { widthMm, dash, cap, roundJoin } = categoryStroke(category, style);
    const paths = members.map(mark => markingPath(mark, clearance, dash, category === "assembly-labels")).join("");
    return paths ? `<g id="${prefix}-${category}" stroke-width="${format(widthMm)}"${cap ? ` stroke-linecap="${cap}"` : ""}${roundJoin ? ' stroke-linejoin="round"' : ""}>${paths}</g>` : "";
  }).join("");
}

/** Credit every export carries: the SVG <desc> (metadata, never drawn or cut) and the README's closing line. */
export const EXPORT_CREDIT = "Made with TopoStack · https://topostack.app";

export function svgDocument(width: number, height: number, body: string, title: string, viewX = -width / 2, viewY = -height / 2): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${format(width)}mm" height="${format(height)}mm" viewBox="${format(viewX)} ${format(viewY)} ${format(width)} ${format(height)}"><title>${escapeXml(title)}</title><desc>${escapeXml(EXPORT_CREDIT)}</desc>${body}</svg>`;
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}
