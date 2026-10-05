import { EARTH_RADIUS_M } from "../primitives/units.js";
import { MIN_LAYER_COUNT } from "../types.js";
import type { GeoBounds, ProjectConfigV1, TerrainStackPlan } from "../types.js";


/** East-west ground distance across the bounds, measured along their middle latitude. */
export function groundWidthMFor(bounds: GeoBounds): number {
  const radians = Math.PI / 180;
  return Math.abs((bounds.east - bounds.west) * radians) * EARTH_RADIUS_M * Math.cos(((bounds.north + bounds.south) / 2) * radians);
}

/**
 * Resolve a config and its terrain relief into physical stack dimensions.
 *
 * The model's horizontal scale already exists — `widthMm` over the ground width
 * of the mapped bounds — so the true-scale height of the relief is a fact, not
 * a preference. Exaggeration multiplies that height, and the material thickness
 * divides it into sheets. Layer count is therefore always the last term.
 *
 * The sheet count is rounded to whole sheets, with a two-sheet minimum and no
 * upper cap. The exaggeration is refitted to that whole-sheet count, so the
 * reported figure always describes the model that will actually be cut. The
 * refitted value can fall below `MIN_VERTICAL_EXAGGERATION` or rise above
 * `MAX_VERTICAL_EXAGGERATION`; those bounds constrain the request, not the fit.
 */
/** Model millimeters per ground millimeter across the mapped width; 0 when the bounds have no usable width. */
export function horizontalScaleFor(widthMm: number, bounds: GeoBounds): number {
  const groundWidthM = groundWidthMFor(bounds);
  return Number.isFinite(groundWidthM) && groundWidthM > 0 ? widthMm / (groundWidthM * 1000) : 0;
}

export function planTerrainStack(config: ProjectConfigV1, reliefM: number, bounds: GeoBounds, depthBelowLandM = 0): TerrainStackPlan {
  const requested = config.verticalExaggeration;
  const groundWidthM = groundWidthMFor(bounds);
  const flat = {
    layerCount: MIN_LAYER_COUNT,
    depthLayerCount: 0,
    verticalExaggeration: requested,
    stackHeightMm: MIN_LAYER_COUNT * config.materialThicknessMm,
    metersPerLayer: Math.max(0, reliefM) / MIN_LAYER_COUNT,
    horizontalScale: 0,
  };
  if (!Number.isFinite(groundWidthM) || groundWidthM <= 0 || !Number.isFinite(reliefM) || reliefM < 0) return flat;

  const horizontalScale = config.widthMm / (groundWidthM * 1000);
  const hasDepth = Number.isFinite(depthBelowLandM) && depthBelowLandM > 0;
  if (reliefM === 0) {
    if (!hasDepth) return flat;
    // A flat shoreline still has a physical depth scale. Include a top sheet
    // at the waterline as well as the layers covering the bed below it.
    const metersPerLayer = config.materialThicknessMm / (horizontalScale * 1000 * requested);
    const depthLayerCount = Math.min(config.waterDepthLayerLimit ?? Infinity, Math.ceil(depthBelowLandM / metersPerLayer));
    const layerCount = Math.max(MIN_LAYER_COUNT, depthLayerCount + 1);
    return { layerCount, depthLayerCount, metersPerLayer, horizontalScale, verticalExaggeration: requested, stackHeightMm: layerCount * config.materialThicknessMm };
  }
  const trueReliefMm = reliefM * (config.widthMm / groundWidthM);
  if (!(trueReliefMm > 0)) return { ...flat, horizontalScale };

  const landLayerCount = Math.max(MIN_LAYER_COUNT, Math.round((trueReliefMm * requested) / config.materialThicknessMm));
  const depthLimit = config.waterDepthLayerLimit ?? Infinity;
  const requiredDepthLayers = (landLayers: number): number => hasDepth
    ? Math.min(depthLimit, Math.ceil(depthBelowLandM / (reliefM / landLayers)))
    : 0;
  // Water adds sheets at the same interval without compressing the land.
  const metersPerLayer = reliefM / landLayerCount;
  const depthLayerCount = requiredDepthLayers(landLayerCount);
  const layerCount = landLayerCount + depthLayerCount;
  return {
    layerCount,
    depthLayerCount,
    // The refit describes the land, which is the part a reader judges the
    // exaggeration by; depth sheets ride along at the same scale.
    verticalExaggeration: (landLayerCount * config.materialThicknessMm) / trueReliefMm,
    stackHeightMm: layerCount * config.materialThicknessMm,
    metersPerLayer,
    horizontalScale,
  };
}

