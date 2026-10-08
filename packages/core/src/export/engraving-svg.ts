import { ARTWORK_CATEGORIES, ENGRAVE, ENGRAVE_LINE, type MarkerClearance, categoryStrokeAttributes, clearLineData, engravingCategory, markerClearance, markingPath, pathData, svgDocument } from "./svg-primitives.js";
import { CIRCLE_CROP_SEGMENTS, cropRadiusMm } from "../primitives/crop.js";
import { formatNumber as format } from "../primitives/format.js";
import { CONTOUR_SIMPLIFICATION_TOLERANCE_MM } from "../pipeline/contours.js";
import { pointAt } from "../primitives/geometry2d.js";
import { waterPatternStrokes } from "../water/water-pattern.js";
import type { GeometryIRV1, Point2D, ProjectConfigV1 } from "../types.js";


function segmentOnCropBoundary(start: Point2D, end: Point2D, config: ProjectConfigV1): boolean {
  const epsilon = 0.02;
  if (config.cropShape === "circle") {
    // Contours are clipped to a polygon, not a true circle, and simplified
    // afterwards. A vertex on the crop can therefore sit up to one chord
    // sagitta inside the radius, and a simplified run of crop edges bows
    // inward by up to the simplification tolerance as well. A fixed epsilon
    // smaller than that sagitta let whole arcs through as engraved stubs.
    const radius = cropRadiusMm(config);
    const sagitta = radius * (1 - Math.cos(Math.PI / CIRCLE_CROP_SEGMENTS));
    const inner = radius - sagitta - CONTOUR_SIMPLIFICATION_TOLERANCE_MM - epsilon;
    const onBoundary = (point: Point2D) => {
      const distance = Math.hypot(point.x, point.y);
      return distance >= inner && distance <= radius + epsilon;
    };
    return onBoundary(start) && onBoundary(end) && onBoundary(pointAt(start, end, 0.5));
  }
  const halfWidth = config.widthMm / 2;
  const halfHeight = config.heightMm / 2;
  return (Math.abs(start.x - halfWidth) <= epsilon && Math.abs(end.x - halfWidth) <= epsilon) ||
    (Math.abs(start.x + halfWidth) <= epsilon && Math.abs(end.x + halfWidth) <= epsilon) ||
    (Math.abs(start.y - halfHeight) <= epsilon && Math.abs(end.y - halfHeight) <= epsilon) ||
    (Math.abs(start.y + halfHeight) <= epsilon && Math.abs(end.y + halfHeight) <= epsilon);
}

/**
 * Filled contour polygons include pieces of the crop edge whenever terrain
 * continues beyond the artwork. Remove those edge-following pieces so a flat
 * topographic line terminates naturally at the optional border.
 */
function openContourPath(points: Point2D[], config: ProjectConfigV1): string {
  let result = "";
  let connected = false;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (segmentOnCropBoundary(start, end, config)) {
      connected = false;
      continue;
    }
    if (!connected) result += `M${format(start.x)} ${format(start.y)}`;
    result += `L${format(end.x)} ${format(end.y)}`;
    connected = true;
  }
  return result;
}

function flatContourPaths(ir: GeometryIRV1, config: ProjectConfigV1, indexContour: boolean, clearance?: MarkerClearance): string {
  return ir.layers.slice(1)
    .filter((layer) => (layer.index % config.engravingIndexInterval === 0) === indexContour)
    .flatMap((layer) => layer.polygons.flatMap((polygon, polygonIndex) => [polygon.outer, ...polygon.holes].map((ring, ringIndex) => {
      const data = clearLineData(openContourPath(ring, config), clearance);
      return data ? `<path id="contour-${layer.index}-${polygonIndex}-${ringIndex}" data-elevation-m="${format(layer.elevationM)}" d="${data}" ${ENGRAVE_LINE}/>` : "";
    })))
    .join("");
}

function flatMarkingPaths(ir: GeometryIRV1, clearance?: MarkerClearance): string {
  // Score paths in layered projects (notably water) become ordinary engraved
  // lines in a flat project; the output deliberately has one operation only.
  const markings = ir.layers.flatMap((layer) => layer.markings)
    .filter((mark) => !mark.id.startsWith("alignment-") && !mark.id.startsWith("piece-"));
  return ARTWORK_CATEGORIES.map((category) => {
    const paths = markings.filter((mark) => engravingCategory(mark) === category).map((mark) => markingPath(mark, clearance)).join("");
    return paths ? `<g id="ENGRAVE-${category}"${categoryStrokeAttributes(category, ir.lineStyle)}>${paths}</g>` : "";
  }).join("");
}

function engravingWaterPatternPaths(ir: GeometryIRV1, config: ProjectConfigV1, clearance?: MarkerClearance): string {
  const strokes = waterPatternStrokes(config.waterFillPattern, ir.waterPatternAreas, config.widthMm, config.heightMm, ir.lineStyle.waterMm);
  if (!strokes.length) return "";
  const paths = strokes.map((points, index) => `<path id="water-fill-${config.waterFillPattern}-${index + 1}" d="${clearLineData(pathData(points), clearance)}" ${ENGRAVE_LINE}/>`).join("");
  return `<g id="ENGRAVE-water-fill" data-water-pattern="${config.waterFillPattern}" stroke-width="${format(ir.lineStyle.waterMm)}">${paths}</g>`;
}

function engravingBorder(config: ProjectConfigV1): string {
  if (!config.showEngravingBorder) return "";
  if (config.cropShape === "circle") return `<circle id="engraving-border" cx="0" cy="0" r="${format(cropRadiusMm(config))}" ${ENGRAVE_LINE}/>`;
  return `<rect id="engraving-border" x="${format(-config.widthMm / 2)}" y="${format(-config.heightMm / 2)}" width="${format(config.widthMm)}" height="${format(config.heightMm)}" ${ENGRAVE_LINE}/>`;
}

/** One physical-size, engrave-only artwork with no cut or score operations. */
export function engravingToSvg(ir: GeometryIRV1, config: ProjectConfigV1): string {
  const clearance = markerClearance(ir.layers);
  const minor = flatContourPaths(ir, config, false, clearance);
  const index = flatContourPaths(ir, config, true, clearance);
  const style = ir.lineStyle;
  const body = `<g id="ENGRAVE" data-operation="ENGRAVE" fill="none" stroke="${ENGRAVE}" stroke-linecap="round" stroke-linejoin="round">${engravingWaterPatternPaths(ir, config, clearance)}<g id="ENGRAVE-contours-minor" stroke-width="${format(style.contourMm)}">${minor}</g><g id="ENGRAVE-contours-index" stroke-width="${format(style.indexContourMm)}">${index}</g><g id="ENGRAVE-map-details" stroke-width="${format(style.annotationMm)}">${flatMarkingPaths(ir, clearance)}</g><g id="ENGRAVE-border" stroke-width="${format(style.borderMm)}">${engravingBorder(config)}</g></g>`;
  return svgDocument(config.widthMm, config.heightMm, body, `${ir.projectName} — flat topographic engraving`);
}
