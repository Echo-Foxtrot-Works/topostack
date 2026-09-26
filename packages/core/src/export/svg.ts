import { ARTWORK_CATEGORIES, ASSEMBLY, ASSEMBLY_CATEGORIES, CUT, CUT_LINE, ENGRAVE, SCORE, escapeXml, layerCutPaths, layerMarkingPaths, pathData, svgDocument } from "./svg-primitives.js";
import { type FabricationPanel, fabricationPanels } from "./panel-layout.js";
import { formatNumber as format } from "../primitives/format.js";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { clipPolyline, normalizeMultiPolygon, pointInPreparedPolygons, preparePolygons, toMultiPolygon, toRing } from "../primitives/geometry2d.js";
import { labelGeometry } from "../annotate/labels.js";
import { omittedNestHoles, paintStencil } from "../pipeline/paint-regions.js";
import type { GeometryIRV1, LayerIR, LineStyleV1, PaintRegionKind, Point2D, ProjectConfigV1 } from "../types.js";

export function layerToSvg(ir: GeometryIRV1, layer: LayerIR): string {
  const width = ir.widthMm + ir.laserKerfMm;
  const height = ir.heightMm + ir.laserKerfMm;
  const assembly = layerMarkingPaths(layer, "engrave", ir.lineStyle, ASSEMBLY_CATEGORIES);
  const body = `<g id="ENGRAVE" data-operation="ENGRAVE" fill="none" stroke="${ENGRAVE}" stroke-width="${format(ir.lineStyle.annotationMm)}"><g id="${layer.id}-ENGRAVE">${layerMarkingPaths(layer, "engrave", ir.lineStyle)}</g></g>${assembly ? `<g id="ASSEMBLY" data-operation="ENGRAVE" fill="none" stroke="${ASSEMBLY}" stroke-width="${format(ir.lineStyle.annotationMm)}"><g id="${layer.id}-ASSEMBLY">${assembly}</g></g>` : ""}<g id="SCORE" data-operation="SCORE" fill="none" stroke="${SCORE}" stroke-width="${format(ir.lineStyle.waterMm)}"><g id="${layer.id}-SCORE">${layerMarkingPaths(layer, "score", ir.lineStyle)}</g></g><g id="CUT" data-operation="CUT" fill="none" stroke="${CUT}" stroke-width="0.1" fill-rule="evenodd"><g id="${layer.id}-CUT">${layerCutPaths(layer, ir.laserKerfMm)}</g></g>`;
  return svgDocument(width, height, body, `${ir.projectName} — ${layer.id}`);
}

export type Operation = "cut" | "score" | "engrave" | "assembly";
export const OPERATIONS: readonly Operation[] = ["engrave", "assembly", "score", "cut"];
export const ENGRAVE_ONLY: readonly Operation[] = ["engrave", "assembly"];
/** A panel's per-operation layer groups in panel coordinates, built once and shared by every file that shows the panel. */
export type PanelBodies = Record<Operation, string>;

/**
 * One sheet's share of a layer's markings.
 *
 * Routing clips markings against the union of a layer's pieces, and
 * `clipPolyline` rejoins intervals that meet at a shared coordinate, so a road
 * crossing a seam stays one continuous path in the IR - which is what the
 * preview and the master layout want. A single sheet must not engrave past its
 * own pieces, so narrow the geometry here instead. A label whose every stroke
 * lies on this sheet ships whole; one a seam cuts through is exploded into its
 * strokes and each stroke clipped, so both sheets carry their share of the
 * glyph. Closed marker artwork and typeface letters are intersected as
 * polygons so a fill stays a closed region rather than an open arc.
 */
function panelMarkings(layer: LayerIR, included?: Set<number>): LayerIR["markings"] {
  if (!included) return layer.markings;
  const polygons = layer.polygons.filter((_, index) => included.has(index));
  if (!polygons.length) return [];
  const prepared = preparePolygons(polygons);
  const inside = (point: Point2D) => pointInPreparedPolygons(point, prepared);
  const parted = (mark: LayerIR["markings"][number], parts: Point2D[][], whole: boolean): LayerIR["markings"] => {
    if (whole && parts.length === 1) return [{ ...mark, points: parts[0]! }];
    return parts.map((points, index) => ({ ...mark, id: `${mark.id}-part-${index + 1}`, points }));
  };
  const clippedFill = (mark: LayerIR["markings"][number]): LayerIR["markings"] => {
    const first = mark.points[0]!;
    if (mark.points.every(inside) && (mark.holes ?? []).every((hole) => hole.every(inside))) return [mark];
    try {
      const clipped = normalizeMultiPolygon(polygonClipping.intersection(
        [[toRing(mark.points), ...(mark.holes ?? []).map(toRing)]] as MultiPolygon,
        toMultiPolygon(polygons),
      ) as MultiPolygon);
      if (clipped.length === 1) return [{ ...mark, points: clipped[0]!.outer, holes: clipped[0]!.holes }];
      return clipped.map((polygon, index) => ({ ...mark, id: `${mark.id}-part-${index + 1}`, points: polygon.outer, holes: polygon.holes }));
    } catch {
      // A degenerate ring the clipper refuses is not worth losing the sheet over.
      return inside(first) ? [mark] : [];
    }
  };
  return layer.markings.flatMap((mark) => {
    const first = mark.points[0];
    if (!first) return [];
    if (mark.label) {
      const { strokes, fills } = labelGeometry(mark.label, first, 0, 0, mark.labelRotationRad, mark.textStyle);
      if ([...strokes, ...fills.flatMap((fill) => [fill.outer, ...fill.holes])].every((line) => line.every(inside))) return [mark];
      const { label: _label, labelRotationRad: _rotation, textStyle: _style, ...plain } = mark;
      return [
        ...parted(plain, strokes.flatMap((stroke) => clipPolyline(stroke, prepared)), false),
        ...fills.flatMap((fill, index) => clippedFill({ ...plain, id: `${mark.id}-fill-${index + 1}`, points: fill.outer, holes: fill.holes, filled: true })),
      ];
    }
    // A halo is a clearance gap, resolved against the whole layer by
    // `markerClearance`; it never serializes, so no sheet needs a copy.
    if (mark.knockout) return [];
    if (mark.points.length < 2) return inside(first) ? [mark] : [];
    if (mark.filled) return clippedFill(mark);
    return parted(mark, clipPolyline(mark.points, prepared), true);
  });
}

export function panelBodies(ir: GeometryIRV1, panel: FabricationPanel): PanelBodies {
  const layers = panel.layerIndexes.map((index) => ir.layers[index]).filter((layer): layer is LayerIR => Boolean(layer));
  const body = (operation: Operation) => layers.map((layer) => {
    const included = panel.included?.get(layer.index);
    if (panel.included && !included?.size) return "";
    const paths = operation === "cut"
      ? layerCutPaths(layer, ir.laserKerfMm, omittedNestHoles(ir.fabricationNests, layer.index), included)
      : layerMarkingPaths(layer, operation === "assembly" ? "engrave" : operation, ir.lineStyle,
        operation === "assembly" ? ASSEMBLY_CATEGORIES : ARTWORK_CATEGORIES, panelMarkings(layer, included));
    // An unsplit package keeps the empty per-layer groups it always had, so
    // turning the work area off leaves every existing export byte-identical.
    return paths || (!panel.included && operation !== "assembly") ? `<g id="${layer.id}-${operation.toUpperCase()}">${paths}</g>` : "";
  }).join("");
  return { engrave: body("engrave"), assembly: body("assembly"), score: body("score"), cut: body("cut") };
}

function panelId(panel: FabricationPanel): string {
  if (panel.sheetIndex !== undefined) return `fabrication-sheet-${String(panel.sheetIndex + 1).padStart(2, "0")}`;
  return `fabrication-panel-${panel.rootLayerIndex + 1}${panel.cellName ? `-${panel.cellName.toLowerCase()}` : ""}`;
}

function panelOperationGroup(ir: GeometryIRV1, panel: FabricationPanel, operation: Operation, body: string, offsetX = 0, offsetY = 0): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(" ");
  const transform = offsetX || offsetY ? ` transform="translate(${format(offsetX)} ${format(offsetY)})"` : "";
  const cell = panel.cellName ? ` data-cell="${escapeXml(panel.cellName)}"` : "";
  return `<g id="${panelId(panel)}-${operation.toUpperCase()}" data-layers="${escapeXml(layerIds)}"${cell}${transform}>${body}</g>`;
}

export function operationGroup(operation: Operation, body: string, style: LineStyleV1): string {
  if (operation === "assembly") {
    // Omitted entirely when empty: an empty process would still show up as a
    // layer to configure in the machine's software.
    return /<path/.test(body) ? `<g id="ASSEMBLY" data-operation="ENGRAVE" fill="none" stroke="${ASSEMBLY}" stroke-width="${format(style.annotationMm)}">${body}</g>` : "";
  }
  const name = operation.toUpperCase();
  const color = operation === "cut" ? CUT : operation === "score" ? SCORE : ENGRAVE;
  const width = operation === "cut" ? "0.1" : format(operation === "score" ? style.waterMm : style.annotationMm);
  return `<g id="${name}" data-operation="${name}" fill="none" stroke="${color}" stroke-width="${width}"${operation === "cut" ? ' fill-rule="evenodd"' : ""}>${body}</g>`;
}

export function panelToSvg(ir: GeometryIRV1, panel: FabricationPanel, bodies: PanelBodies, operations: readonly Operation[], kind: string): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  const body = operations.map((operation) => operationGroup(operation, panelOperationGroup(ir, panel, operation, bodies[operation]), ir.lineStyle)).join("");
  return svgDocument(panel.maxX - panel.minX, panel.maxY - panel.minY, body, `${ir.projectName} — ${panelTitle(panel, kind)} — ${layerIds}`, panel.minX, panel.minY);
}

function panelTitle(panel: FabricationPanel, kind: string): string {
  if (panel.sheetIndex !== undefined) return `${kind} sheet ${panel.sheetIndex + 1}`;
  return `${kind} panel${panel.cellName ? ` — cell ${panel.cellName}` : ""}`;
}

/**
 * A paper stencil registered to one fabrication panel: the same canvas, and
 * for each included piece the stencil as it is cut - the piece at nominal
 * size (paper takes no kerf) less its paint windows for `kind`, as one
 * outline. A window on the piece edge reshapes the edge rather than doubling
 * the cut there. Undefined when no piece on the panel keeps any paper: a dry
 * sheet, or one whose pieces are painted edge to edge, gets no template.
 */
export function paintTemplateSvg(ir: GeometryIRV1, config: ProjectConfigV1, panel: FabricationPanel, kind: PaintRegionKind): string | undefined {
  const groups = paintTemplateGroups(ir, config, panel, kind);
  if (!groups) return undefined;
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  const cell = panel.cellName ? ` — cell ${panel.cellName}` : "";
  return paintTemplateDocument(ir, panel, kind, groups, `${ir.projectName} — ${kind} paint template${cell} — ${layerIds}`);
}

/** The stencil shell shared by panel and sheet templates: one CUT group holding `groups`. */
export function paintTemplateDocument(ir: GeometryIRV1, panel: FabricationPanel, kind: PaintRegionKind, groups: string, title: string): string {
  const body = `<g id="CUT" data-operation="CUT" fill="none" stroke="${CUT}" stroke-width="0.1" fill-rule="evenodd"><g id="${panelId(panel)}-PAINT-${kind.toUpperCase()}" data-layers="${escapeXml(panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(" "))}"${panel.cellName ? ` data-cell="${escapeXml(panel.cellName)}"` : ""} data-paint-kind="${kind}">${groups}</g></g>`;
  return svgDocument(panel.maxX - panel.minX, panel.maxY - panel.minY, body, title, panel.minX, panel.minY);
}

/** Per-layer stencil groups for the pieces a panel includes, in model coordinates; undefined when none keeps paper. */
export function paintTemplateGroups(ir: GeometryIRV1, config: ProjectConfigV1, panel: FabricationPanel, kind: PaintRegionKind): string | undefined {
  const regions = (ir.paintRegions ?? []).filter((region) => region.kind === kind && panel.layerIndexes.includes(region.layerIndex)
    && (!panel.included || panel.included.get(region.layerIndex)?.has(region.polygonIndex)));
  const stencils = regions.flatMap(({ layerIndex, polygonIndex, polygons, paper }) => {
    const layer = ir.layers[layerIndex];
    const polygon = layer?.polygons[polygonIndex];
    if (!layer || !polygon) return [];
    const omittedHoles = omittedNestHoles(ir.fabricationNests, layerIndex).get(polygonIndex) ?? new Set<number>();
    // IR from before stencils were merged carries windows only: cut the paper here.
    const sheets = paper ?? paintStencil({ outer: polygon.outer, holes: polygon.holes.filter((_, holeIndex) => !omittedHoles.has(holeIndex)) }, polygons, config.minimumFeatureMm);
    return sheets.length ? [{ layer, polygonIndex, sheets }] : [];
  });
  if (!stencils.length) return undefined;
  const groups = panel.layerIndexes.flatMap((layerIndex) => {
    const layer = ir.layers[layerIndex];
    const layerStencils = stencils.filter((stencil) => stencil.layer.index === layerIndex);
    if (!layer || !layerStencils.length) return [];
    const paths = layerStencils.map(({ polygonIndex, sheets }) => {
      const piece = layer.pieces[polygonIndex]?.id ?? layer.id;
      return sheets.map((sheet, sheetIndex) => `<path id="${layer.id}-paint-${kind}-${polygonIndex + 1}${sheets.length > 1 ? `-${sheetIndex + 1}` : ""}" data-role="stencil" data-kind="${kind}" data-piece="${escapeXml(piece)}" d="${[sheet.outer, ...sheet.holes].map((ring) => pathData(ring, 0, 0, true)).join(" ")}" ${CUT_LINE}/>`).join("");
    }).join("");
    return [`<g id="${layer.id}-PAINT-${kind.toUpperCase()}" data-layers="${layer.id}">${paths}</g>`];
  }).join("");
  return groups;
}

export function masterToSvg(ir: GeometryIRV1, panels = fabricationPanels(ir), bodies = panels.map((panel) => panelBodies(ir, panel))): string {
  const gap = 12;
  // Split panels differ in size, so the grid cell is the largest of them.
  const panelWidth = Math.max(...panels.map((panel) => panel.maxX - panel.minX), 1);
  const panelHeight = Math.max(...panels.map((panel) => panel.maxY - panel.minY), 1);
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(panels.length))));
  const rows = Math.ceil(panels.length / columns);
  const width = columns * panelWidth + (columns - 1) * gap;
  const height = rows * panelHeight + (rows - 1) * gap;
  const startX = -width / 2 + panelWidth / 2;
  const startY = -height / 2 + panelHeight / 2;
  // Panels keep panel coordinates and are placed by a group transform, so the
  // master reuses each panel's path data instead of re-offsetting every point.
  const body = OPERATIONS.map((operation) => operationGroup(operation, panels.map((panel, index) => {
    const offsetX = startX + (index % columns) * (panelWidth + gap) - (panel.minX + panel.maxX) / 2;
    const offsetY = startY + Math.floor(index / columns) * (panelHeight + gap) - (panel.minY + panel.maxY) / 2;
    return panelOperationGroup(ir, panel, operation, bodies[index]![operation], offsetX, offsetY);
  }).join(""), ir.lineStyle)).join("");
  return svgDocument(width, height, body, `${ir.projectName} — master layout`, -width / 2, -height / 2);
}
