import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { placeLabel, type LabelLayerIndex } from "../annotate/label-placement.js";
import { labelDimensions } from "../annotate/labels.js";
import { boundsOverlap, normalizeMultiPolygon, ringBounds, signedArea, toMultiPolygon, type PreparedPolygons } from "../primitives/geometry2d.js";
import type { Point2D, Polygon2D, ProjectConfigV1 } from "../types.js";
import { polygonCenter } from "./nesting.js";

/** The parts of `polygon` that something stacked above it hides after assembly. */
export function coveredParts(polygon: Polygon2D, covering: PreparedPolygons): Polygon2D[] {
  if (!covering.polygons.length) return [];
  const box = ringBounds(polygon.outer);
  // Layer 0's covering is every layer above it, so filter before clipping.
  const near = covering.polygons.filter((_, index) => boundsOverlap(box, covering.outerBounds[index]!));
  if (!near.length) return [];
  return normalizeMultiPolygon(polygonClipping.intersection(
    toMultiPolygon([polygon]),
    toMultiPolygon(near),
  ) as MultiPolygon);
}

/**
 * Candidate label centres spanning a covered region at label-box spacing. The
 * global grid is 10% of the model, far coarser than one piece's covered area,
 * and the alignment guide usually already owns the region's centre.
 */
export function coveredCandidates(label: string, config: ProjectConfigV1, region: Polygon2D): Point2D[] {
  const { width, height } = labelDimensions(label, config.textStyle);
  const bounds = ringBounds(region.outer);
  const stepX = (width + 1.6) / 2;
  const stepY = height + 1.6;
  const candidates: Point2D[] = [];
  for (let y = bounds.minY + stepY / 2; y <= bounds.maxY - stepY / 2 && candidates.length < 400; y += stepY) {
    for (let x = bounds.minX + stepX / 2; x <= bounds.maxX - stepX / 2 && candidates.length < 400; x += stepX) {
      candidates.push({ x: x / (config.widthMm / 2), y: y / (config.heightMm / 2) });
    }
  }
  return candidates;
}

/**
 * Where to engrave `label` on `polygon` so the stack above hides it, or
 * undefined when no covered spot holds it. `placeLabel` already requires the
 * label box to sit inside both the layer's material and the covered region,
 * so passing the covered sub-region is the whole "prefer covered" filter.
 */
export function coveredLabelPoint(label: string, config: ProjectConfigV1, labelIndex: LabelLayerIndex, polygon: Polygon2D, covering: PreparedPolygons): Point2D | undefined {
  const covered = coveredParts(polygon, covering);
  // Aim at the middle of the largest covered region rather than the middle
  // of the piece: `placeLabel` tries the preferred point first and then
  // falls back to a grid spanning the whole model, whose spacing is far
  // coarser than one cut piece, so a poor first guess loses the label.
  const largest = covered.reduce<Polygon2D | undefined>((best, part) =>
    !best || Math.abs(signedArea(part.outer)) > Math.abs(signedArea(best.outer)) ? part : best, undefined);
  return largest ? placeLabel(label, config, labelIndex, polygonCenter(largest, config), covered, coveredCandidates(label, config, largest)) : undefined;
}
