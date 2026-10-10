import { ringBounds } from "../primitives/geometry2d.js";
import { clipPolygons, offsetPolygons } from "../primitives/offset.js";
import { airspacePanelGroups } from "../pipeline/airspace-panels.js";
import { panelBounds, type FabricationPanel } from "./panel-layout.js";
import type { AirspacePieceIR, AirspaceStackIR, AirspaceTint, GeometryIRV1, LayerIR, LayerPieceV1, OperationPath, ProjectConfigV1 } from "../types.js";

/**
 * Airspace pieces as geometries of their own, so the panel, SVG and master
 * writers cut acrylic exactly as they cut wood (docs/plans/airspace-acrylic.md).
 * One layer per level and tint, `airspace-<tint>-NN`, each polygon a piece
 * keeping its `A` id. The acrylic kerf replaces the wood's. Pieces are cut at
 * their nominal size: nothing fits into them.
 */

const TINTS: AirspaceTint[] = ["clear", "blue", "magenta"];
export const AIRSPACE_TINT_NAMES: Record<AirspaceTint, string> = { clear: "clear", blue: "blue tinted", magenta: "magenta tinted" };

const pieceBounds = (piece: Pick<AirspacePieceIR, "polygons">) => ringBounds(piece.polygons.flatMap((polygon) => polygon.outer));

/** Clear acrylic left around a rod outline inside frost, so the outline still reads. */
const LOCATOR_WINDOW_MM = 1;

/**
 * What is engraved on a piece's top face: frosted shelves, sector edges in
 * their chart style, and rod locators. Frost stops a millimetre short of every
 * locator, which would otherwise vanish into it.
 */
export function airspacePieceMarkings(piece: AirspacePieceIR): OperationPath[] {
  const windows = piece.locators?.length ? offsetPolygons(piece.locators.map((ring) => ({ outer: ring, holes: [] })), LOCATOR_WINDOW_MM, "round") : [];
  const frost = piece.frost?.length && windows.length ? clipPolygons(piece.frost, windows, "difference") : piece.frost ?? [];
  return [
    ...(piece.markings ?? []),
    ...frost.map((polygon, index): OperationPath => ({ id: `${piece.id}-frost-${index + 1}`, operation: "engrave", kind: "marker", points: polygon.outer, holes: polygon.holes, filled: true })),
    ...(piece.edges ?? []).map((edge, index): OperationPath => ({ id: `${piece.id}-edge-${index + 1}`, operation: "engrave", kind: "aviation", aviationClass: edge.aviationClass, points: edge.points })),
    ...(piece.locators ?? []).map((ring, index): OperationPath => ({ id: `${piece.id}-rod-${index + 1}`, operation: "engrave", kind: "marker", points: ring })),
  ];
}

/** One stand-in layer per level and tint, in level order. */
export function airspaceLayers(stack: AirspaceStackIR, { markings = true }: { markings?: boolean } = {}): Array<{ layer: LayerIR; tint: AirspaceTint; levelIndex: number; pieces: AirspacePieceIR[] }> {
  const out: Array<{ layer: LayerIR; tint: AirspaceTint; levelIndex: number; pieces: AirspacePieceIR[] }> = [];
  for (const level of stack.levels) {
    for (const tint of TINTS) {
      const pieces = level.pieces.filter((piece) => piece.tint === tint);
      if (!pieces.length) continue;
      const polygons: LayerIR["polygons"] = [];
      const layerPieces: LayerPieceV1[] = [];
      for (const piece of pieces) {
        for (const polygon of piece.polygons) {
          const bounds = ringBounds(polygon.outer);
          layerPieces.push({ polygonIndex: polygons.length, id: piece.id, column: 0, row: 0, exempt: false, widthMm: bounds.maxX - bounds.minX, heightMm: bounds.maxY - bounds.minY });
          polygons.push(polygon);
        }
      }
      out.push({
        tint, levelIndex: level.index, pieces,
        layer: {
          id: `airspace-${tint}-${String(level.index + 1).padStart(2, "0")}`,
          index: out.length,
          elevationM: level.altitudeFt * 0.3048,
          materialThicknessMm: stack.thicknessMm,
          polygons,
          markings: markings ? pieces.flatMap(airspacePieceMarkings) : [],
          pieces: layerPieces,
        },
      });
    }
  }
  return out;
}

/** The airspace as a geometry the panel and SVG writers can cut; undefined when there is nothing to cut. */
export function airspaceGeometry(ir: GeometryIRV1, options: { markings?: boolean } = {}): GeometryIRV1 | undefined {
  const stack = ir.airspaceStack;
  if (!stack?.levels.length) return undefined;
  return {
    ...ir,
    projectName: `${ir.projectName} airspace`,
    laserKerfMm: stack.kerfMm,
    layers: airspaceLayers(stack, options).map(({ layer }) => layer),
    waterSurfaces: [],
    fabricationNests: [],
    paintRegions: [],
    waterInserts: undefined,
    waterInsertMaterial: undefined,
    airspaceStack: undefined,
    splitPlan: undefined,
  };
}

/**
 * Unnested airspace panels, grouped as `airspacePanelGroups` says: every piece
 * of a level and tint on one canvas just large enough for them, or each piece
 * on its own panel when together they outgrow the machine. A piece is never
 * split: a seam would show in clear acrylic.
 */
export function airspacePanels(ir: GeometryIRV1, airspace: GeometryIRV1, config: Pick<ProjectConfigV1, "workAreaWidthMm" | "workAreaHeightMm">): FabricationPanel[] {
  const stack = ir.airspaceStack;
  if (!stack) return [];
  const layers = airspaceLayers(stack, { markings: false });
  return airspacePanelGroups(stack, config).map((group) => {
    const layerIndex = layers.findIndex((entry) => entry.levelIndex === group.levelIndex && entry.tint === group.tint);
    const layer = airspace.layers[layerIndex]!;
    const ids = new Set(group.pieces.map((piece) => piece.id));
    const included = new Map([[layerIndex, new Set(layer.pieces.filter((piece) => ids.has(piece.id)).map((piece) => piece.polygonIndex))]]);
    const whole = group.pieces.length === layers[layerIndex]!.pieces.length;
    return { rootLayerIndex: layerIndex, layerIndexes: [layerIndex], ...(whole ? {} : { cellName: group.pieces[0]!.id }), included, ...panelBounds(airspace, [layerIndex], included) };
  });
}

/**
 * The plain sheet glued under the model that rods socketed through the bottom
 * sheet stand on: the bottom sheet's outline with no holes. A model split for
 * the work area gets the bottom sheet's pieces, so every part fits the machine.
 */
export function backingGeometry(ir: GeometryIRV1): GeometryIRV1 | undefined {
  if (!ir.airspaceStack?.backingSheet) return undefined;
  const bottom = ir.layers[0]!;
  const polygons = bottom.polygons.map((polygon) => ({ outer: polygon.outer, holes: [] }));
  return {
    ...ir,
    projectName: `${ir.projectName} backing`,
    layers: [{ ...bottom, id: "airspace-backing", index: 0, markings: [], polygons, pieces: bottom.pieces.map((piece) => ({ ...piece, id: piece.id.replace(/^L\d+-/, "") })) }],
    waterSurfaces: [],
    fabricationNests: [],
    paintRegions: [],
    waterInserts: undefined,
    waterInsertMaterial: undefined,
    airspaceStack: undefined,
  };
}

/** Backing panels: the whole crop canvas, or one panel per bottom-sheet piece of a split model. */
export function backingPanels(backing: GeometryIRV1): FabricationPanel[] {
  const layer = backing.layers[0]!;
  if (!backing.splitPlan || layer.polygons.length <= 1) return [{ rootLayerIndex: 0, layerIndexes: [0], ...panelBounds(backing, [0]) }];
  return layer.polygons.map((_, index): FabricationPanel => {
    const included = new Map([[0, new Set([index])]]);
    return { rootLayerIndex: 0, layerIndexes: [0], cellName: layer.pieces.find((piece) => piece.polygonIndex === index)?.id ?? String(index + 1), included, ...panelBounds(backing, [0], included) };
  });
}

/** Acrylic stock each tint needs: the sum of its pieces' bounding boxes, in square millimetres. */
export function airspaceAcrylicArea(stack: AirspaceStackIR): Partial<Record<AirspaceTint, number>> {
  const totals: Partial<Record<AirspaceTint, number>> = {};
  for (const level of stack.levels) for (const piece of level.pieces) {
    const bounds = pieceBounds(piece);
    totals[piece.tint] = (totals[piece.tint] ?? 0) + (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  }
  return totals;
}
