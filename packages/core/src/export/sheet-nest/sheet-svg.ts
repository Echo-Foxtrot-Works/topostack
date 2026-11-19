import { boundsOverlap, type Bounds2D } from "../../primitives/geometry2d.js";
import { PAINT_REGION_LABELS, type GeometryIRV1, type PaintRegionKind, type ProjectConfigV1 } from "../../types.js";
import { escapeXml } from "../svg-primitives.js";
import { layerMarkingBounds, paintTemplateDocument, paintTemplateParts, panelBodies, type PanelBodies, type PartBody } from "../svg.js";
import { placementMatrix, suffixIds, type NestedPart, type NestedSheet } from "./apply.js";

/**
 * The IR as one part sees it: its layers keep only the markings near it.
 * Clipping a marking to a part is the expensive step, and without this every
 * part on a sheet would clip every marking of its layers.
 */
function partView(ir: GeometryIRV1, nested: NestedPart): GeometryIRV1 {
  const reach: Bounds2D = { minX: nested.panel.minX, minY: nested.panel.minY, maxX: nested.panel.maxX, maxY: nested.panel.maxY };
  const members = new Set(nested.panel.layerIndexes);
  return {
    ...ir,
    layers: ir.layers.map((layer) => {
      if (!members.has(layer.index)) return layer;
      const bounds = layerMarkingBounds(layer);
      return { ...layer, markings: layer.markings.filter((_, index) => !bounds[index] || boundsOverlap(bounds[index]!, reach)) };
    }),
  };
}

/**
 * A placed part's groups on the sheet: each piece's usual panel paths,
 * unchanged, in its own root-level group that rotates and moves it onto the
 * sheet. Kerf offsets do not depend on orientation, so the path data needs no
 * rework. Ids take a per-placement suffix so a sheet never repeats one.
 */
function placed(ir: GeometryIRV1, nested: NestedPart, index: number, parts: PanelBodies): PanelBodies {
  const suffix = `--p${index + 1}`;
  const layerIds = nested.panel.layerIndexes.map((layerIndex) => ir.layers[layerIndex]?.id).filter(Boolean).join(" ");
  return parts.map((part): PartBody => ({
    ...part,
    id: `${part.id}${suffix}`,
    attributes: `${part.attributes ?? ""} data-part="${escapeXml(nested.part.label)}" data-layers="${escapeXml(layerIds)}"`,
    transform: [placementMatrix(nested.placement), part.transform].filter(Boolean).join(" "),
    bodies: Object.fromEntries(Object.entries(part.bodies).map(([operation, body]) => [operation, suffixIds(body ?? "", suffix)])),
  }));
}

/** A sheet's parts: every placed piece as its own group in sheet coordinates. */
export function nestedSheetBodies(ir: GeometryIRV1, sheet: NestedSheet): PanelBodies {
  return sheet.parts.flatMap((nested, index) => placed(ir, nested, index, panelBodies(partView(ir, nested), nested.panel)));
}

/** A paper stencil registered to a stock sheet; undefined when no part on it keeps paper. */
export function nestedPaintTemplateSvg(ir: GeometryIRV1, config: ProjectConfigV1, sheet: NestedSheet, kind: PaintRegionKind): string | undefined {
  const parts = sheet.parts.flatMap((nested, index) => placed(ir, nested, index, paintTemplateParts(ir, config, nested.panel, kind) ?? []));
  if (!parts.length) return undefined;
  const layerIds = sheet.panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean).join(", ");
  return paintTemplateDocument(ir, sheet.panel, parts, `${ir.projectName} — ${PAINT_REGION_LABELS[kind]} paint template — sheet ${(sheet.panel.sheetIndex ?? 0) + 1} — ${layerIds}`);
}
