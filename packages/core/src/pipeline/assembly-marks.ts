import { alignmentGuideMarkings } from "./alignment.js";
import { addLabelObstacles, indexLabelLayer } from "../annotate/label-placement.js";
import { coveredLabelPoint } from "./piece-labels.js";
import type { OperationPath, Polygon2D, ProjectConfigV1 } from "../types.js";
import type { GenerationContext } from "./generation-context.js";
import type { LayerClip } from "./layer-clips.js";

export function addAlignmentGuides(config: ProjectConfigV1, clips: LayerClip[], outlines: Polygon2D[][]): void {
  for (let index = 0; index < clips.length - 1; index += 1) {
    const layer = clips[index]!.layer;
    layer.markings.push(...alignmentGuideMarkings(config, layer, clips[index + 1]!.layer, outlines[index + 1]));
  }
}

/**
 * Engrave each cut piece's assembly id where the stack above hides it.
 *
 * A visible id would survive glue-up as a blemish, so a piece with no covered
 * room keeps none - which is also why the top layer and flat engravings get
 * none at all, their covering being empty. `placeLabel` already requires the
 * label box to sit inside both the layer's material and `requiredPolygons`,
 * so passing the covered sub-region is the whole "prefer covered" filter.
 */
export function addPieceLabels({ config, flatEngraving, warnings }: GenerationContext, clips: LayerClip[]): void {
  // A flat artwork has nothing stacked over it - its "layers" are contour
  // lines on one face - so no id could ever be hidden. Its pieces are named
  // by panel filename instead.
  if (!config.showAssemblyLabels || flatEngraving) return;
  const omitted: string[] = [];
  for (const { layer, covering } of clips) {
    if (!layer.pieces.length) continue;
    const labelIndex = indexLabelLayer(layer.polygons, layer.markings);
    for (const piece of layer.pieces) {
      const polygon = layer.polygons[piece.polygonIndex];
      if (!polygon) continue;
      const point = coveredLabelPoint(piece.id, config, labelIndex, polygon, covering);
      if (!point) {
        omitted.push(piece.id);
        continue;
      }
      const marking: OperationPath = {
        id: `piece-${piece.id}-label`,
        operation: "engrave",
        kind: "guide",
        points: [point],
        label: piece.id,
        textStyle: config.textStyle,
      };
      layer.markings.push(marking);
      addLabelObstacles(labelIndex, [marking]);
    }
  }
  if (omitted.length) warnings.push({
    code: "LABEL_OMITTED",
    message: `Assembly ids were omitted from ${omitted.length} piece${omitted.length === 1 ? "" : "s"} (${omitted.slice(0, 4).join(", ")}) because no position stayed hidden under the layer above.`,
  });
}
