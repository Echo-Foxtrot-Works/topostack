import { addLabelObstacles, indexLabelLayer } from "../annotate/label-placement.js";
import { clipPolyline, preparePolygons } from "../primitives/geometry2d.js";
import { offsetClosedRing } from "../primitives/offset.js";
import { alignmentOutlineInsetMm, hiddenLabelMarking, placeHiddenLabel } from "./hidden-marks.js";
import type { LayerIR, OperationPath, Polygon2D, ProjectConfigV1 } from "../types.js";

/** One layer's guides; read-only inputs make this safe to retry or execute in another worker. */
export function alignmentGuideMarkings(config: ProjectConfigV1, layer: LayerIR, nextLayer: Pick<LayerIR, "index" | "polygons" | "pieces">, outlines?: Polygon2D[]): OperationPath[] {
  const markings: OperationPath[] = [];
  if (!nextLayer.polygons.length) return markings;
  const material = preparePolygons(layer.polygons);
  const layerNumber = String(layer.index + 1).padStart(2, "0");
  const nextLayerNumber = String(nextLayer.index + 1).padStart(2, "0");
  const labelIndex = indexLabelLayer(layer.polygons, layer.markings);
  const inset = alignmentOutlineInsetMm(config);
  const outline = (polygon: Polygon2D, polygonIndex: number) => {
    const guides: OperationPath[] = [];
    offsetClosedRing(polygon.outer, -inset, "round").forEach((ring, insetIndex) => {
      clipPolyline(ring, material).forEach((points, clipIndex) => guides.push({
        id: `alignment-layer-${layerNumber}-to-${nextLayerNumber}-${polygonIndex}-inset-${insetIndex}-outline-${clipIndex}`,
        operation: "engrave",
        kind: "guide",
        points,
      }));
    });
    addLabelObstacles(labelIndex, guides);
    markings.push(...guides);
  };
  const label = (polygon: Polygon2D, polygonIndex: number) => {
    // After a work-area split the next layer is many pieces, so a repeated
    // "L03" on one sheet says nothing; name the piece that belongs here.
    const text = nextLayer.pieces[polygonIndex]?.id ?? `L${nextLayerNumber}`;
    // The piece above glues down onto exactly this region, so it hides the id.
    const point = placeHiddenLabel(text, config, labelIndex, [polygon]);
    if (!point) return;
    const guideLabel = hiddenLabelMarking(`alignment-layer-${layerNumber}-to-${nextLayerNumber}-${polygonIndex}-label`, text, point, config);
    addLabelObstacles(labelIndex, [guideLabel]);
    markings.push(guideLabel);
  };
  if (!nextLayer.pieces.length) {
    nextLayer.polygons.forEach((polygon, polygonIndex) => {
      outline(polygon, polygonIndex);
      label(polygon, polygonIndex);
    });
    return markings;
  }
  (outlines ?? nextLayer.polygons).forEach(outline);
  nextLayer.polygons.forEach(label);
  return markings;
}
