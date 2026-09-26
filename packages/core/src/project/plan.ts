import type { ProjectConfigV1 } from "../types.js";
import { groundWidthMFor, planTerrainStack } from "../pipeline/stack-plan.js";
import { EARTH_RADIUS_M } from "../primitives/units.js";
import { boundsForProject } from "./bounds.js";

/** The lowest and highest ground in a crop, from a coarse sample of the terrain. */
export interface ReliefSample { minM: number; maxM: number }

/**
 * What a design will come out as, worked out from its settings and a relief
 * sample rather than from generated geometry. The studio's count is the
 * authoritative one: a coarse sample smooths peaks, and lake depth adds
 * sheets below the land that only generation can count.
 */
export interface ModelPlan {
  output: "layered" | "flat";
  widthMm: number;
  heightMm: number;
  /** Sheets of material; always 1 for flat output. */
  sheetCount: number;
  materialThicknessMm: number;
  /** The height of the finished stack, or one sheet for flat output. */
  heightOfModelMm: number;
  requestedVerticalExaggeration: number;
  /** The exaggeration after rounding to whole sheets. */
  fittedVerticalExaggeration: number;
  /** Elevation covered by one sheet, or between two engraved contours. */
  metersPerStep: number;
  /** One model millimetre stands for this many on the ground. */
  scaleDenominator: number;
  groundWidthKm: number;
  groundHeightKm: number;
  minElevationM: number;
  maxElevationM: number;
  reliefM: number;
}


export function planFromRelief(config: ProjectConfigV1, relief: ReliefSample): ModelPlan {
  const bounds = boundsForProject(config);
  const reliefM = Math.max(0, relief.maxM - relief.minM);
  const groundWidthM = groundWidthMFor(bounds);
  const groundHeightM = (bounds.north - bounds.south) * Math.PI / 180 * EARTH_RADIUS_M;
  const stack = planTerrainStack(config, reliefM, bounds);
  const flat = config.outputMode === "engraving";
  return {
    output: flat ? "flat" : "layered",
    widthMm: config.widthMm,
    heightMm: config.heightMm,
    sheetCount: flat ? 1 : stack.layerCount,
    materialThicknessMm: config.materialThicknessMm,
    heightOfModelMm: flat ? config.materialThicknessMm : stack.stackHeightMm,
    requestedVerticalExaggeration: config.verticalExaggeration,
    fittedVerticalExaggeration: flat ? config.verticalExaggeration : stack.verticalExaggeration,
    metersPerStep: flat ? reliefM / config.engravingContourCount : stack.metersPerLayer,
    scaleDenominator: groundWidthM > 0 ? Math.round(groundWidthM * 1000 / config.widthMm) : 0,
    groundWidthKm: groundWidthM / 1000,
    groundHeightKm: groundHeightM / 1000,
    minElevationM: relief.minM,
    maxElevationM: relief.maxM,
    reliefM,
  };
}
