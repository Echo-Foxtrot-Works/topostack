import { removeTinyRing } from "./contours.js";
import { groundWidthMFor } from "./stack-plan.js";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { clipPolyline, normalizeMultiPolygon, pointInPreparedPolygons, pointInRing, type PreparedPolygons, preparePolygons, toMultiPolygon } from "../primitives/geometry2d.js";
import { labelDimensions, labelGeometry } from "../annotate/labels.js";
import { placeElevationLabelStack, type CoordinatedElevationLabel } from "../annotate/label-placement.js";
import { geoPointToMapPoint, longitudeInBounds, markerCenterForAnchor, markerPolygons } from "../annotate/markers.js";
import { markerLayerPolygons } from "../annotate/marker-placement.js";
import { GRAPHIC_CLEARANCE_MM, placedGraphicMarkingPrefix, placedGraphicPolygons } from "../annotate/graphics.js";
import { offsetClosedRing } from "../primitives/offset.js";
import { northArrowMarkings } from "../annotate/north-arrow.js";
import { scaleBarMarkings } from "../annotate/scale-bar.js";
import { plaqueFootprint, plaqueMarkings } from "../annotate/plaque.js";
import { displayElevation, elevationUnit } from "../primitives/units.js";
import { MAP_MARKER_CLEARANCE_MM, MAP_MARKER_SIZE_MM, type LayerIR, type Point2D, type OperationPath, type Polygon2D, type UnitSystem } from "../types.js";
import type { GenerationContext } from "./generation-context.js";
import type { LayerClip } from "./layer-clips.js";

interface AnnotationPlacer {
  /** Whether every marking fits inside the crop; pushes a LABEL_OMITTED warning naming `name` when not. */
  fits(markings: OperationPath[], name: string): boolean;
  /** Adds markings to the base layer, or routes them onto the exposed surface of the stack. */
  push(markings: OperationPath[], followSurface: boolean): void;
}

const INSET_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/** Whether a square `inset` either side of every point stays inside the crop, so a stroke that wide drawn through them is not cut off. */
function insetFits(points: Point2D[], inset: number, clip: Point2D[]): boolean {
  return points.every(({ x, y }) => INSET_CORNERS.every(([dx, dy]) => pointInRing({ x: x + dx * inset, y: y + dy * inset }, clip)));
}

export function annotationPlacer({ config, clip, warnings, flatEngraving }: GenerationContext, clips: LayerClip[]): AnnotationPlacer {
  const baseLayer = clips[0]!.layer;
  return {
    // All crop boundaries are convex, so endpoint/label-box checks suffice.
    fits(markings, name) {
      const fits = markings.every((marking) => {
        const points = [...marking.points];
        if (marking.label && marking.points[0]) {
          const { x, y } = marking.points[0];
          const { width, height } = labelDimensions(marking.label, marking.textStyle);
          points.push({ x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height });
        }
        return insetFits(points, config.lineStyle.annotationMm / 2, clip);
      });
      if (!fits) warnings.push({ code: "LABEL_OMITTED", message: `${name} was omitted because it does not fit the material. Increase the output size or reduce the annotation size.` });
      return fits;
    },
    push(markings, followSurface) {
      if (!followSurface || flatEngraving) {
        baseLayer.markings.push(...markings);
        return;
      }
      // Route the complete design onto final material, excluding every sheet above.
      // Letters use the same strokes as preview/SVG text so they remain complete
      // even when a contour passes through a glyph.
      for (const marking of markings) {
        const text = marking.label && marking.points[0]
          ? labelGeometry(marking.label, marking.points[0], 0, 0, marking.labelRotationRad, marking.textStyle)
          : undefined;
        const paths = text ? text.strokes : [marking.points];
        // Typeface letters are areas: each piece belongs to the sheet it is exposed on.
        text?.fills.forEach((fill, fillIndex) => markerLayerPolygons(fill.outer, clips.map(({ material }) => material), fill.holes).forEach(({ layerIndex, polygon }, pieceIndex) => clips[layerIndex]!.layer.markings.push({
          id: `${marking.id}-${layerIndex}-fill-${fillIndex}-${pieceIndex}`,
          operation: marking.operation,
          kind: marking.kind,
          points: polygon.outer,
          ...(polygon.holes.length ? { holes: polygon.holes } : {}),
          filled: true,
        })));
        for (const { layer, material, covering } of clips) {
          paths.forEach((path, pathIndex) => {
            clipPolyline(path, material, covering).forEach((points, clipIndex) => layer.markings.push({
              id: `${marking.id}-${layer.index}-${pathIndex}-${clipIndex}`,
              operation: marking.operation,
              kind: marking.kind,
              points,
            }));
          });
        }
      }
    },
  };
}

/** Annotations must fit the crop whole; the compass follows the exposed stack surface. */
export function placeAnnotations(context: GenerationContext, clips: LayerClip[]): void {
  const { config, source } = context;
  const placer = annotationPlacer(context, clips);
  const addAnnotation = (markings: OperationPath[], name: string, followSurface = false): void => {
    if (placer.fits(markings, name)) placer.push(markings, followSurface);
  };

  if (config.showNorthArrow) {
    addAnnotation(northArrowMarkings(config), "North arrow", true);
  }
  if (config.showScaleBar) {
    // Like the compass, the bar follows the exposed surface: on the bottom
    // sheet alone, the sheets above covered most of it.
    addAnnotation(scaleBarMarkings(config, groundWidthMFor(source.bounds)), "Scale bar", true);
  }
}

/** A layer's elevation label, longest form first: the placer takes the first that fits. */
export function elevationLabelTexts(layer: LayerIR, units: UnitSystem): string[] {
  const elevation = Math.round(displayElevation(layer.elevationM, units));
  const unit = elevationUnit(units);
  return [`${elevation} ${unit}`, `${elevation}${unit}`, `${elevation}`];
}

export function placeElevationLabels({ config, flatEngraving, warnings }: GenerationContext, layers: LayerIR[], parallelPlacements?: Array<CoordinatedElevationLabel | undefined>): void {
  const omittedLayers: string[] = [];
  const labelsByLayer = layers.map((layer) => elevationLabelTexts(layer, config.units));
  // A flat map labels only its emphasized index contours. Labelling every
  // minor line overwhelms the engraving and implies a label on the base
  // crop boundary, which is not itself a contour.
  const flatLabeled = (layer: LayerIR) => layer.index !== 0 && layer.index % config.engravingIndexInterval === 0;
  const placements = parallelPlacements ?? placeElevationLabelStack(labelsByLayer, config, layers, flatEngraving ? { markings: layers[0]!.markings, labeled: flatLabeled } : undefined);
  layers.forEach((layer, layerIndex) => {
    if (flatEngraving && !flatLabeled(layer)) return;
    const placed = placements[layerIndex];
    if (!placed) {
      omittedLayers.push(String(layer.index + 1));
      return;
    }
    layer.markings.push({
      id: `elevation-${layer.index}`,
      operation: "engrave",
      kind: "label",
      points: [placed.placement.point],
      label: placed.label,
      labelRotationRad: placed.placement.rotationRad,
      textStyle: config.textStyle,
    });
  });
  if (omittedLayers.length) warnings.push({
    code: "LABEL_OMITTED",
    message: `Elevation labels were omitted from layer${omittedLayers.length === 1 ? "" : "s"} ${omittedLayers.join(", ")} because no collision-free position fit the exposed face.`,
  });
}

/**
 * The title is placed after every map detail so its material-colored backing
 * clears contours, roads and labels beneath the letters; only markers, which
 * the user positioned deliberately, are drawn over it.
 */
export function placePlaque(context: GenerationContext, clips: LayerClip[]): void {
  const { config, flatEngraving } = context;
  const markings = plaqueMarkings(config);
  const footprint = plaqueFootprint(config);
  const placer = annotationPlacer(context, clips);
  if (!markings.length || !footprint || !placer.fits(markings, "Title")) return;
  const materials = (flatEngraving ? clips.slice(0, 1) : clips).map(clip => clip.material);
  markerLayerPolygons(footprint, materials).forEach(({ layerIndex, polygon }, pieceIndex) => clips[layerIndex]!.layer.markings.push({
    id: `plaque-backing-${layerIndex}-${pieceIndex}`,
    operation: "engrave",
    kind: "label",
    points: polygon.outer,
    ...(polygon.holes.length ? { holes: polygon.holes } : {}),
    filled: true,
    knockout: true,
  }));
  placer.push(markings, true);
}

/**
 * Engraves filled shapes on whichever sheet each part is exposed on: first a
 * material-coloured knockout halo `clearanceMm` wide around each, so the shape
 * visibly interrupts what lies beneath, then the shape itself. Ids are
 * `prefix` + `halo-<shape>-<ring>` or `<shape>`, then the layer and piece.
 */
function placeFilledWithHalo(clips: LayerClip[], materials: PreparedPolygons[], polygons: Polygon2D[], clearanceMm: number, prefix: string): void {
  const place = (path: Point2D[], id: string, holes: Point2D[][], knockout = false) => {
    markerLayerPolygons(path, materials, holes).forEach(({ layerIndex, polygon }, pieceIndex) => clips[layerIndex]!.layer.markings.push({
      id: `${prefix}${id}-${layerIndex}-${pieceIndex}`,
      operation: "engrave",
      kind: "marker",
      points: polygon.outer,
      ...(polygon.holes.length ? { holes: polygon.holes } : {}),
      filled: true,
      ...(knockout ? { knockout: true } : {}),
    }));
  };
  polygons.forEach(({ outer }, index) => {
    offsetClosedRing(outer, clearanceMm, "round").forEach((halo, haloIndex) => place(halo, `halo-${index}-${haloIndex}`, [], true));
  });
  polygons.forEach(({ outer, holes }, index) => place(outer, String(index), holes));
}

/**
 * Markers are added after every other annotation so their material-colored
 * knockout footprints can visibly interrupt contours, labels, and map
 * details before the solid symbol is drawn on top.
 */
export function placeMarkers({ config, source, flatEngraving }: GenerationContext, clips: LayerClip[]): void {
  const materials = (flatEngraving ? clips.slice(0, 1) : clips).map(clip => clip.material);
  config.markers.forEach((marker, markerIndex) => {
    if (!longitudeInBounds(marker.lon, source.bounds) || marker.lat < source.bounds.south || marker.lat > source.bounds.north) return;
    const anchor = geoPointToMapPoint(marker.lat, marker.lon, source.bounds, config.widthMm, config.heightMm);
    if (!materials.some(material => pointInPreparedPolygons(anchor, material))) return;
    const size = marker.sizeMm ?? MAP_MARKER_SIZE_MM;
    const symbolCenter = markerCenterForAnchor(marker, config.markerIcons, anchor, size);
    // Holes (a pin's eye, a letter's counter) are engraved as gaps in the fill.
    const polygons = markerPolygons(marker, config.markerIcons, symbolCenter, size);
    placeFilledWithHalo(clips, materials, polygons, MAP_MARKER_CLEARANCE_MM, `map-marker-${markerIndex}-`);
  });
}

/** Whether every point of a graphic keeps the annotation line inside the crop; warns naming it when not. */
function graphicFits({ config, clip, warnings }: GenerationContext, polygons: Polygon2D[], placedIndex: number): boolean {
  const fits = polygons.length > 0 && polygons.every(({ outer }) => insetFits(outer, config.lineStyle.annotationMm / 2, clip));
  if (!fits && polygons.length) warnings.push({ code: "LABEL_OMITTED", message: `Graphic ${placedIndex + 1} was omitted because it does not fit the material. Make it smaller or move it inward.` });
  return fits;
}

/**
 * Cut graphics remove their shape from whichever sheet is exposed under each
 * part of it, revealing the sheet below. This runs on the raw layers, before
 * work-area seams and material nests: both index into the final material, and
 * nesting already refuses a cavity under a covering sheet's hole, so a cut can
 * never reveal one.
 */
export function cutPlacedGraphics(context: GenerationContext, layers: LayerIR[]): void {
  const { config, flatEngraving, warnings } = context;
  const cutLayers = flatEngraving ? layers.slice(0, 1) : layers;
  let loosePieces = false;
  (config.placedGraphics ?? []).forEach((placed, placedIndex) => {
    if (placed.operation !== "cut") return;
    const polygons = placedGraphicPolygons(config, placed);
    if (!graphicFits(context, polygons, placedIndex)) return;
    // Recomputed per graphic: an earlier cut may already have opened this area.
    const materials = cutLayers.map((layer) => preparePolygons(layer.polygons));
    const cutsByLayer = new Map<number, Polygon2D[]>();
    for (const { outer, holes } of polygons) {
      for (const { layerIndex, polygon } of markerLayerPolygons(outer, materials, holes)) {
        cutsByLayer.set(layerIndex, [...(cutsByLayer.get(layerIndex) ?? []), polygon]);
        // Islands left inside a cut through the bottom sheet have nothing to rest on.
        if (layerIndex === 0 && polygon.holes.length) loosePieces = true;
      }
    }
    for (const [layerIndex, cuts] of cutsByLayer) {
      const layer = cutLayers[layerIndex]!;
      layer.polygons = normalizeMultiPolygon(
        polygonClipping.difference(toMultiPolygon(layer.polygons), toMultiPolygon(cuts)) as MultiPolygon,
        (ring) => (removeTinyRing(ring, config.minimumFeatureMm) ? undefined : ring),
      );
    }
  });
  if (loosePieces) warnings.push({
    code: "GRAPHIC_LOOSE_PIECES",
    message: "A cut graphic goes through the bottom sheet, so the islands inside its shape fall out. Engrave or score it instead, or keep them to glue back by hand.",
  });
}

/**
 * Engraved and scored graphics follow the exposed surface like markers. They
 * are placed after the title and before markers, so a marker still reads on
 * top of a graphic.
 */
export function placeGraphics(context: GenerationContext, clips: LayerClip[]): void {
  const { config, flatEngraving } = context;
  const surface = flatEngraving ? clips.slice(0, 1) : clips;
  const materials = surface.map((clip) => clip.material);
  (config.placedGraphics ?? []).forEach((placed, placedIndex) => {
    if (placed.operation === "cut") return;
    const polygons = placedGraphicPolygons(config, placed);
    if (!graphicFits(context, polygons, placedIndex)) return;
    const prefix = placedGraphicMarkingPrefix(placed.id);
    if (placed.operation === "score") {
      polygons.forEach(({ outer, holes }, index) => [outer, ...holes].forEach((ring, ringIndex) => {
        for (const { layer, material, covering } of surface) {
          clipPolyline(ring, material, flatEngraving ? undefined : covering).forEach((points, clipIndex) => layer.markings.push({
            id: `${prefix}score-${index}-${ringIndex}-${layer.index}-${clipIndex}`,
            operation: "score",
            kind: "marker",
            points,
          }));
        }
      }));
      return;
    }
    placeFilledWithHalo(clips, materials, polygons, GRAPHIC_CLEARANCE_MM, prefix);
  });
}
