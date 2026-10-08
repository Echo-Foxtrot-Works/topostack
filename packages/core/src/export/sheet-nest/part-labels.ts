import { addLabelObstacles, indexLabelLayer, type LabelLayerIndex } from "../../annotate/label-placement.js";
import { gluedLabelPoint, hiddenLabelMarking } from "../../pipeline/hidden-marks.js";
import { preparePolygons, type PreparedPolygons } from "../../primitives/geometry2d.js";
import type { GeometryIRV1, NestPartV1, ProjectConfigV1 } from "../../types.js";
import { polygonLabel } from "./parts.js";

/**
 * Nested sheets mix pieces of many layers, so every piece needs an id the
 * maker can read. Seam pieces already carry one from generation; this engraves
 * the rest (`L03`, `L03-2`) the same way, as a green assembly mark where the
 * layer above hides it. Pieces with no covered room, the top layer above all,
 * are named on the guide's sheet map instead. The IR is copied, not changed.
 */
export function withPartLabels(ir: GeometryIRV1, config: ProjectConfigV1, parts: NestPartV1[]): { ir: GeometryIRV1; omitted: string[] } {
  if (!config.showAssemblyLabels) return { ir, omitted: [] };
  const aboves = new Map<number, PreparedPolygons>();
  // The sheet glued on top, as generation reads it for piece ids.
  const aboveOf = (layerIndex: number) => {
    if (!aboves.has(layerIndex)) aboves.set(layerIndex, preparePolygons(ir.layers[layerIndex + 1]?.polygons ?? []));
    return aboves.get(layerIndex)!;
  };
  const layers = [...ir.layers];
  const indexes = new Map<number, LabelLayerIndex>();
  const omitted: string[] = [];
  const members = parts.flatMap((part) => part.members.flatMap(({ layerIndex, polygonIndexes }) => polygonIndexes.map((polygonIndex) => ({ layerIndex, polygonIndex }))));
  for (const { layerIndex, polygonIndex } of members) {
    const source = ir.layers[layerIndex];
    const polygon = source?.polygons[polygonIndex];
    if (!source || !polygon || source.pieces.some((piece) => piece.polygonIndex === polygonIndex)) continue;
    const text = polygonLabel(ir, layerIndex, polygonIndex);
    const layer = layers[layerIndex] === source ? (layers[layerIndex] = { ...source, markings: [...source.markings] }) : layers[layerIndex]!;
    let index = indexes.get(layerIndex);
    if (!index) indexes.set(layerIndex, index = indexLabelLayer(layer.polygons, layer.markings));
    const point = gluedLabelPoint(text, config, index, polygon, aboveOf(layerIndex));
    if (!point) {
      omitted.push(text);
      continue;
    }
    const marking = hiddenLabelMarking(`piece-${text}-label`, text, point, config);
    layer.markings.push(marking);
    addLabelObstacles(index, [marking]);
  }
  return { ir: { ...ir, layers }, omitted };
}
