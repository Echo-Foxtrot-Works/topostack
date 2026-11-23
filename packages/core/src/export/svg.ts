import { ARTWORK_CATEGORIES, ASSEMBLY, ASSEMBLY_CATEGORIES, CUT, CUT_LINE, ENGRAVE, SCORE, escapeXml, layerCutPaths, markingGroups, pathData, svgDocument } from "./svg-primitives.js";
import { type FabricationPanel, fabricationPanels } from "./panel-layout.js";
import { labelFootprint } from "../annotate/label-placement.js";
import { formatNumber as format } from "../primitives/format.js";
import { boundsOverlap, pointInPolygon, ringBounds, type Bounds2D } from "../primitives/geometry2d.js";
import { markingClearances, markingsWithin } from "../pipeline/marking-clip.js";
import { omittedNestHoles, paintStencil } from "../pipeline/paint-regions.js";
import { DEFAULT_TEXT_STYLE, PAINT_REGION_LABELS, type GeometryIRV1, type LayerIR, type LineStyleV1, type PaintRegionKind, type ProjectConfigV1 } from "../types.js";

/*
 * Every SVG is written part by part (Atomm's SVG export grouping spec): one
 * root-level <g> per cut piece holding its outline, holes, engraving, score
 * lines and assembly marks, so moving a piece in xTool Studio moves all of it
 * and nothing else. Inside a part, one container per operation carries the
 * operation's colour and stroke width (`data-operation` for LightBurn); a
 * part never contains another part, and no group wraps a whole sheet.
 */

export type Operation = "cut" | "score" | "engrave" | "assembly";
export const OPERATIONS: readonly Operation[] = ["engrave", "assembly", "score", "cut"];
export const ENGRAVE_ONLY: readonly Operation[] = ["engrave", "assembly"];

/** One cut piece's paths per operation, in panel coordinates. */
export interface PartBody {
  /** Unique within a document; operation containers append `-CUT`, `-SCORE` and so on. */
  id: string;
  /** Readable name Studio shows in its object list (`data-name`). */
  name: string;
  /** Places the part, applied inside any offset the document adds (sheet placement). */
  transform?: string;
  /** Extra attributes for the part group, already escaped, each starting with a space. */
  attributes?: string;
  bodies: Partial<Record<Operation, string>>;
}

/** A panel's parts, built once and shared by every file that shows the panel. */
export type PanelBodies = PartBody[];

/** Extent of a marking, its text and stroke included, used only to skip markings far from a piece. */
function markingBounds(mark: LayerIR["markings"][number]): Bounds2D | undefined {
  const first = mark.points[0];
  if (!first) return undefined;
  if (mark.label) {
    try {
      // 1 mm covers half the widest line a project allows.
      return ringBounds(labelFootprint(mark.label, first, mark.labelRotationRad ?? 0, mark.textStyle ?? DEFAULT_TEXT_STYLE, 1));
    } catch {
      // A font that is not loaded cannot be measured; a generous box only costs clipping time.
      return { minX: first.x - 50, minY: first.y - 50, maxX: first.x + 50, maxY: first.y + 50 };
    }
  }
  return ringBounds(mark.points);
}

const boundsCache = new WeakMap<LayerIR, Array<Bounds2D | undefined>>();
export function layerMarkingBounds(layer: LayerIR): Array<Bounds2D | undefined> {
  let bounds = boundsCache.get(layer);
  if (!bounds) boundsCache.set(layer, bounds = layer.markings.map(markingBounds));
  return bounds;
}

/**
 * One sheet's share of a layer's markings.
 *
 * Routing clips markings against the union of a layer's pieces, and
 * `clipPolyline` rejoins intervals that meet at a shared coordinate, so a road
 * crossing a seam stays one continuous path in the IR - which is what the
 * preview and the master layout want. A single sheet must not engrave past its
 * own pieces, so narrow the geometry here instead (`markingsWithin`). A halo
 * stays in drawing order until its gap has been cut out of earlier artwork.
 */
function panelMarkings(layer: LayerIR, included?: Set<number>): LayerIR["markings"] {
  if (!included) return layer.markings;
  const polygons = layer.polygons.filter((_, index) => included.has(index));
  if (!polygons.length) return [];
  return markingsWithin(layer.markings, polygons, "inside", { keepKnockouts: true });
}

/** Up to eight points spread along a marking, used to decide which piece owns it. */
function samplePoints(mark: LayerIR["markings"][number]) {
  const points = mark.points;
  if (mark.label || points.length <= 8) return mark.label ? points.slice(0, 1) : points;
  return Array.from({ length: 8 }, (_, index) => points[Math.floor((index * (points.length - 1)) / 7)]!);
}

/**
 * Each marking to the piece it lies on. Routing already clipped markings to
 * the layer's pieces, which are disjoint, so a marking belongs to exactly one
 * of them; it is assigned whole, never clipped again, so an engraving that
 * runs along a piece edge keeps every point. The piece with the most sampled
 * points inside wins; a marking with none inside (every point on an edge)
 * goes to the first piece whose bounds it overlaps.
 */
function markingOwners(layer: LayerIR, markings: LayerIR["markings"], pieces: number[]): Map<number, LayerIR["markings"]> {
  const owners = new Map<number, LayerIR["markings"]>(pieces.map((index) => [index, []]));
  if (pieces.length === 1) { owners.set(pieces[0]!, markings); return owners; }
  const pieceBounds = pieces.map((index) => ({ index, bounds: ringBounds(layer.polygons[index]!.outer) }));
  for (const mark of markings) {
    const bounds = markingBounds(mark);
    const candidates = bounds ? pieceBounds.filter((piece) => boundsOverlap(piece.bounds, bounds)) : pieceBounds;
    if (!candidates.length) continue;
    let best = candidates[0]!.index;
    if (candidates.length > 1) {
      const samples = samplePoints(mark);
      let bestScore = -1;
      for (const candidate of candidates) {
        const polygon = layer.polygons[candidate.index]!;
        const score = samples.filter((point) => pointInPolygon(point, polygon)).length;
        if (score > bestScore) { bestScore = score; best = candidate.index; }
      }
    }
    owners.get(best)!.push(mark);
  }
  return owners;
}

function pieceId(layer: LayerIR, polygonIndex: number): string {
  return layer.pieces.find((piece) => piece.polygonIndex === polygonIndex)?.id ?? `${layer.id}-piece-${polygonIndex + 1}`;
}

function markingBodies(groupId: string, style: LineStyleV1, markings: LayerIR["markings"], clearance: ReturnType<typeof markingClearances>): Pick<Record<Operation, string>, "engrave" | "assembly" | "score"> {
  const engraved = markings.filter(mark => mark.operation === "engrave");
  return {
    engrave: markingGroups(`${groupId}-ENGRAVE`, style, ARTWORK_CATEGORIES, engraved, clearance),
    assembly: markingGroups(`${groupId}-ENGRAVE`, style, ASSEMBLY_CATEGORIES, engraved, clearance),
    score: markingGroups(`${groupId}-SCORE`, style, ARTWORK_CATEGORIES, markings.filter(mark => mark.operation === "score"), clearance),
  };
}

/** A layer's parts: one per cut piece (all, or those in `included`), each with the markings on it. */
function layerParts(ir: GeometryIRV1, layer: LayerIR, included?: Set<number>, omittedHoles = new Map<number, Set<number>>()): PartBody[] {
  const markings = panelMarkings(layer, included);
  const clearance = markingClearances(markings);
  const pieces = layer.polygons.map((_, index) => index).filter((index) => !included || included.has(index));
  if (!pieces.length) {
    // A layer with nothing to cut still engraves: its markings form one design unit.
    const bodies = markingBodies(layer.id, ir.lineStyle, markings, clearance);
    return Object.values(bodies).some(Boolean) ? [{ id: layer.id, name: layer.id, attributes: ` data-layer="${escapeXml(layer.id)}"`, bodies }] : [];
  }
  const owners = markingOwners(layer, markings, pieces);
  return pieces.map((polygonIndex) => {
    const id = pieceId(layer, polygonIndex);
    const partId = `${layer.id}-part-${polygonIndex + 1}`;
    return {
      id: partId,
      name: id,
      attributes: ` data-layer="${escapeXml(layer.id)}" data-piece="${escapeXml(id)}"`,
      bodies: { ...markingBodies(partId, ir.lineStyle, owners.get(polygonIndex) ?? [], clearance), cut: layerCutPaths(layer, ir.laserKerfMm, omittedHoles, new Set([polygonIndex])) },
    };
  });
}

export function panelBodies(ir: GeometryIRV1, panel: FabricationPanel): PanelBodies {
  return panel.layerIndexes.flatMap((index) => {
    const layer = ir.layers[index];
    if (!layer) return [];
    const included = panel.included?.get(layer.index);
    if (panel.included && !included?.size) return [];
    const parts = layerParts(ir, layer, included, omittedNestHoles(ir.fabricationNests, layer.index));
    return panel.cellName ? parts.map((part) => ({ ...part, attributes: `${part.attributes ?? ""} data-cell="${escapeXml(panel.cellName!)}"` })) : parts;
  });
}

function operationContainer(partId: string, operation: Operation, body: string | undefined, style: LineStyleV1): string {
  // Empty operations are left out: an empty process would still show up as a
  // layer to configure in the machine's software.
  if (!body || !/<(path|text|image|circle|rect)/.test(body)) return "";
  const name = operation.toUpperCase();
  if (operation === "assembly") return `<g id="${partId}-${name}" data-operation="ENGRAVE" fill="none" stroke="${ASSEMBLY}" stroke-width="${format(style.annotationMm)}">${body}</g>`;
  const color = operation === "cut" ? CUT : operation === "score" ? SCORE : ENGRAVE;
  const width = operation === "cut" ? "0.1" : format(operation === "score" ? style.waterMm : style.annotationMm);
  return `<g id="${partId}-${name}" data-operation="${name}" fill="none" stroke="${color}" stroke-width="${width}"${operation === "cut" ? ' fill-rule="evenodd"' : ""}>${body}</g>`;
}

/** One part as a root-level group; empty when it has nothing for these operations. */
export function partGroup(part: PartBody, operations: readonly Operation[], style: LineStyleV1, offset?: string): string {
  const inner = operations.map((operation) => operationContainer(part.id, operation, part.bodies[operation], style)).join("");
  if (!inner) return "";
  const transform = [offset, part.transform].filter(Boolean).join(" ");
  return `<g id="${part.id}" data-name="${escapeXml(part.name)}"${part.attributes ?? ""}${transform ? ` transform="${transform}"` : ""}>${inner}</g>`;
}

export function layerToSvg(ir: GeometryIRV1, layer: LayerIR): string {
  const width = ir.widthMm + ir.laserKerfMm;
  const height = ir.heightMm + ir.laserKerfMm;
  const body = layerParts(ir, layer).map((part) => partGroup(part, OPERATIONS, ir.lineStyle)).join("");
  return svgDocument(width, height, body, `${ir.projectName} — ${layer.id}`);
}

export function panelToSvg(ir: GeometryIRV1, panel: FabricationPanel, bodies: PanelBodies, operations: readonly Operation[], kind: string): string {
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  const body = bodies.map((part) => partGroup(part, operations, ir.lineStyle)).join("");
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
  const parts = paintTemplateParts(ir, config, panel, kind);
  if (!parts) return undefined;
  const layerIds = panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  const cell = panel.cellName ? ` — cell ${panel.cellName}` : "";
  return paintTemplateDocument(ir, panel, parts, `${ir.projectName} — ${PAINT_REGION_LABELS[kind]} paint template${cell} — ${layerIds}`);
}

/** The stencil document shared by panel and sheet templates: one part per stencil piece. */
export function paintTemplateDocument(ir: GeometryIRV1, panel: FabricationPanel, parts: PanelBodies, title: string): string {
  const body = parts.map((part) => partGroup(part, ["cut"], ir.lineStyle)).join("");
  return svgDocument(panel.maxX - panel.minX, panel.maxY - panel.minY, body, title, panel.minX, panel.minY);
}

/** One stencil part per piece a panel includes, in model coordinates; undefined when none keeps paper. */
export function paintTemplateParts(ir: GeometryIRV1, config: ProjectConfigV1, panel: FabricationPanel, kind: PaintRegionKind): PanelBodies | undefined {
  const regions = (ir.paintRegions ?? []).filter((region) => region.kind === kind && panel.layerIndexes.includes(region.layerIndex)
    && (!panel.included || panel.included.get(region.layerIndex)?.has(region.polygonIndex)));
  const parts = panel.layerIndexes.flatMap((layerIndex) => regions.filter((region) => region.layerIndex === layerIndex).flatMap(({ polygonIndex, polygons, paper }): PartBody[] => {
    const layer = ir.layers[layerIndex];
    const polygon = layer?.polygons[polygonIndex];
    if (!layer || !polygon) return [];
    const omittedHoles = omittedNestHoles(ir.fabricationNests, layerIndex).get(polygonIndex) ?? new Set<number>();
    // IR from before stencils were merged carries windows only: cut the paper here.
    const sheets = paper ?? paintStencil({ outer: polygon.outer, holes: polygon.holes.filter((_, holeIndex) => !omittedHoles.has(holeIndex)) }, polygons, config.minimumFeatureMm);
    if (!sheets.length) return [];
    const piece = pieceId(layer, polygonIndex);
    const paths = sheets.map((sheet, sheetIndex) => `<path id="${layer.id}-paint-${kind}-${polygonIndex + 1}${sheets.length > 1 ? `-${sheetIndex + 1}` : ""}" data-role="stencil" data-kind="${kind}" data-piece="${escapeXml(piece)}" d="${[sheet.outer, ...sheet.holes].map((ring) => pathData(ring, 0, 0, true)).join(" ")}" ${CUT_LINE}/>`).join("");
    return [{ id: `${layer.id}-paint-${kind}-part-${polygonIndex + 1}`, name: `${piece} ${PAINT_REGION_LABELS[kind].toLowerCase()} stencil`, attributes: ` data-layer="${escapeXml(layer.id)}" data-piece="${escapeXml(piece)}" data-paint-kind="${kind}"`, bodies: { cut: paths } }];
  }));
  return parts.length ? parts : undefined;
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
  // Parts keep panel coordinates and each carries its panel's offset, so the
  // master reuses the path data instead of re-offsetting every point, and no
  // group wraps a whole panel.
  const body = panels.map((panel, index) => {
    const offsetX = startX + (index % columns) * (panelWidth + gap) - (panel.minX + panel.maxX) / 2;
    const offset = `translate(${format(offsetX)} ${format(startY + Math.floor(index / columns) * (panelHeight + gap) - (panel.minY + panel.maxY) / 2)})`;
    return bodies[index]!.map((part) => {
      const group = partGroup(part, OPERATIONS, ir.lineStyle, offset);
      // One marking can be clipped onto several panels, retaining its source id on each.
      return panel.included ? group.replace(/<path id="([^"]+)"/g, (_, id: string) => `<path id="${id}--panel${index + 1}"`) : group;
    }).join("");
  }).join("");
  return svgDocument(width, height, body, `${ir.projectName} — master layout`, -width / 2, -height / 2);
}
