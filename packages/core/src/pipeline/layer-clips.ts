import polygonClipping from "polygon-clipping";
import { normalizeMultiPolygon, type PreparedPolygons, preparePolygons, toMultiPolygon } from "../primitives/geometry2d.js";
import type { LayerIR } from "../types.js";

/** Each layer's material and the material stacked above it, indexed once for routing many markings. */
export interface LayerClip {
  layer: LayerIR;
  material: PreparedPolygons;
  covering: PreparedPolygons;
}

/** Preserve the original rings when no union is needed or near-coincident edges defeat the boolean library. */
function concatPrepared(upper: PreparedPolygons, lower: PreparedPolygons): PreparedPolygons {
  return {
    polygons: [...upper.polygons, ...lower.polygons],
    outerBounds: [...upper.outerBounds, ...lower.outerBounds],
    rings: [...upper.rings, ...lower.rings],
    polygonRings: [...upper.polygonRings, ...lower.polygonRings],
    bounds: {
      minX: Math.min(upper.bounds.minX, lower.bounds.minX), minY: Math.min(upper.bounds.minY, lower.bounds.minY),
      maxX: Math.max(upper.bounds.maxX, lower.bounds.maxX), maxY: Math.max(upper.bounds.maxY, lower.bounds.maxY),
    },
  };
}

/** Merge overlapping covering material once, instead of rechecking every buried contour per road segment. */
function unionPrepared(upper: PreparedPolygons, lower: PreparedPolygons): PreparedPolygons {
  if (!upper.polygons.length) return lower;
  if (!lower.polygons.length) return upper;
  try {
    return preparePolygons(normalizeMultiPolygon(polygonClipping.union(toMultiPolygon(upper.polygons), toMultiPolygon(lower.polygons))));
  } catch {
    // This is only an acceleration structure. The original rings remain a
    // complete, exact covering set if a union cannot resolve coincident edges.
    return concatPrepared(upper, lower);
  }
}

/**
 * Built top-down: each layer's covering is the layer above's material plus
 * that layer's covering. `reuse` hands over clips built for the same layers
 * above `reuse.below`, which then carry over as they are rather than being
 * prepared and merged again.
 */
export function layerClips(layers: LayerIR[], mergeCovering: boolean, reuse?: { clips: LayerClip[]; below: number }): LayerClip[] {
  const clips: LayerClip[] = new Array(layers.length);
  let covering = preparePolygons([]);
  let top = layers.length - 1;
  if (reuse && reuse.below < top) {
    for (let layerIndex = reuse.below + 1; layerIndex <= top; layerIndex += 1) clips[layerIndex] = reuse.clips[layerIndex]!;
    covering = reuse.clips[reuse.below]!.covering;
    top = reuse.below;
  }
  for (let layerIndex = top; layerIndex >= 0; layerIndex -= 1) {
    const layer = layers[layerIndex]!;
    const material = preparePolygons(layer.polygons);
    clips[layerIndex] = { layer, material, covering };
    covering = mergeCovering ? unionPrepared(material, covering) : concatPrepared(material, covering);
  }
  return clips;
}
