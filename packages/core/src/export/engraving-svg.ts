import { ARTWORK_CATEGORIES, ENGRAVE, ENGRAVE_LINE, type MarkerClearance, clearLineData, markerClearance, markingGroups, pathData, escapeXml, svgDocument } from "./svg-primitives.js";
import { flatArtworkMarkings, markingClearances } from "../pipeline/marking-clip.js";
import { cropRadiusMm } from "../primitives/crop.js";
import { formatNumber as format } from "../primitives/format.js";
import { openContourPath } from "../pipeline/contours.js";
import { waterPatternStrokes } from "../water/water-pattern.js";
import type { GeometryIRV1, ProjectConfigV1 } from "../types.js";


function flatContourPaths(ir: GeometryIRV1, config: ProjectConfigV1, indexContour: boolean, clearance?: MarkerClearance): string {
  return ir.layers.slice(1)
    .filter((layer) => (layer.index % config.engravingIndexInterval === 0) === indexContour)
    .flatMap((layer) => layer.polygons.flatMap((polygon, polygonIndex) => [polygon.outer, ...polygon.holes].map((ring, ringIndex) => {
      const data = clearLineData(openContourPath(ring, config), clearance);
      return data ? `<path id="contour-${layer.index}-${polygonIndex}-${ringIndex}" data-elevation-m="${format(layer.elevationM)}" d="${data}" ${ENGRAVE_LINE}/>` : "";
    })))
    .join("");
}

function flatMarkingPaths(ir: GeometryIRV1): string {
  // Score paths in layered projects (notably water) become ordinary engraved
  // lines in a flat project; the output deliberately has one operation only.
  const markings = flatArtworkMarkings(ir.layers);
  return markingGroups("ENGRAVE", ir.lineStyle, ARTWORK_CATEGORIES, markings, markingClearances(markings));
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
  const body = `<g id="ENGRAVE" data-operation="ENGRAVE" fill="none" stroke="${ENGRAVE}" stroke-linecap="round" stroke-linejoin="round">${engravingWaterPatternPaths(ir, config, clearance)}<g id="ENGRAVE-contours-minor" stroke-width="${format(style.contourMm)}">${minor}</g><g id="ENGRAVE-contours-index" stroke-width="${format(style.indexContourMm)}">${index}</g><g id="ENGRAVE-map-details" stroke-width="${format(style.annotationMm)}">${flatMarkingPaths(ir)}</g><g id="ENGRAVE-border" stroke-width="${format(style.borderMm)}">${engravingBorder(config)}</g></g>`;
  // The whole plate is one design unit, so it is one part (Atomm's grouping spec): it moves as one in Studio.
  const part = `<g id="engraving" data-name="${escapeXml(ir.projectName)} engraving">${body}</g>`;
  return svgDocument(config.widthMm, config.heightMm, part, `${ir.projectName} — flat topographic engraving`);
}
