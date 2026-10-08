/** State shared by the generation stages in generate.ts and its sibling stage modules. */
import type { AviationAltitudeCandidate, AviationLabelCandidate, AviationSymbolBox } from "./aviation.js";
import type { CarvedWater } from "../water/water.js";
import type { ElevationGrid, GeometryWarning, MarkingFeature, Point2D, ProjectConfigV1, SourceBundleV1, TerrainStackPlan } from "../types.js";

/** Inputs and accumulators shared by every generation phase. */
export interface GenerationContext {
  config: ProjectConfigV1;
  source: SourceBundleV1;
  flatEngraving: boolean;
  /** Stack-only: flat engravings ignore water depth entirely. */
  usesWaterDepth: boolean;
  /** Closed crop outline in artwork millimeters. */
  clip: Point2D[];
  warnings: GeometryWarning[];
  /** Enabled aviation detail as line features, and the identifier labels placed after routing. */
  aviation: { lines: MarkingFeature[]; labels: AviationLabelCandidate[]; altitudes: AviationAltitudeCandidate[]; symbols: AviationSymbolBox[] };
}

/** The elevation ladder every layer is contoured from, plus the grid it is cut from. */
export interface ElevationLadder {
  landMin: number;
  landMax: number;
  visibleMin: number;
  visibleMax: number;
  depthBelowLandM: number;
  stack: TerrainStackPlan;
  ladderBase: number;
  /** Layer base elevations; trimmed when empty circular caps are dropped. */
  thresholds: number[];
  /** Carved water after any fit to the ladder floor. */
  water: CarvedWater;
  /** The carved, fitted, and floor-clamped grid actually contoured. */
  modelGrid: ElevationGrid;
}
