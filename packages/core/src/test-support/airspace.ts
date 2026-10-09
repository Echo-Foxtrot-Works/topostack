import { DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, generateGeometry, type AirspaceStackSettingsV1, type AirspaceVolumeV1, type GeometryIRV1, type Point2D, type Polygon2D, type ProjectConfigV1, type SourceBundleV1 } from "../index.js";
import { pointInPolygon } from "../primitives/geometry2d.js";
import { circleRing, gridSource, scaledForLayers } from "./sources.js";
import { registerAirspaceStage } from "../pipeline/airspace-settings.js";
import { buildAirspaceStack } from "../pipeline/airspace-stack.js";

registerAirspaceStage(buildAirspaceStack);

/**
 * A synthetic stack for airspace tests: flat ground with one round hill near
 * the west edge, 12 sheets of relief, and a Class B wedding cake over it.
 */
export const FEET = 0.3048;
export const square = (x0: number, y0: number, x1: number, y1: number): Point2D[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
export const inside = (point: Point2D, polygons: Polygon2D[]) => polygons.some((polygon) => pointInPolygon(point, polygon));

/** Flat ground with one round hill near the west edge, 12 sheets of relief. */
export const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false, showWaterDepth: false, showRoads: false, showTrails: false, showElevationLabels: false, showAlignmentGuides: false, showAssemblyLabels: false, showNorthArrow: false, showScaleBar: false };
const terrain = gridSource(base, 64, (nx, ny) => 1000 + Math.max(0, 600 - Math.hypot((nx + 0.6) * 150, ny * 150) * 20));
const [scaled, source] = scaledForLayers(base, terrain, 12);
export const project = scaled;
export const plain = generateGeometry(project, source);
const baseM = plain.layers[0]!.elevationM;
export const stepM = plain.layers[1]!.elevationM - baseM;
export const t = project.materialThicknessMm;
/** An altitude `sheets` sheet-steps above the land base, in feet as charted. */
export const sheetsUp = (sheets: number) => Math.round((baseM + sheets * stepM) / FEET);
export const zOf = (feet: number) => t + ((feet * FEET - baseM) / stepM) * t;

export function volume(id: string, aviationClass: AirspaceVolumeV1["aviationClass"], outer: Point2D[], floor: AirspaceVolumeV1["floor"], ceiling: AirspaceVolumeV1["ceiling"], extra: Partial<AirspaceVolumeV1> = {}): AirspaceVolumeV1 {
  return { id, aviationClass, name: id.toUpperCase(), floor, ceiling, polygons: [{ outer, holes: [] }], ...extra };
}

// A wedding cake: a core from the surface over the flat east, a shelf around it reaching over the hill, whose inner
// edge misses the core by a hair. The shelf starts below the hilltop, so the hill rises through it.
export const CEILING = sheetsUp(20);
export const SHELF = sheetsUp(6);
export const core = volume("core", "class-b", square(20, -30, 80, 30), { ref: "sfc", ft: 0 }, { ref: "msl", ft: CEILING });
export const shelf: AirspaceVolumeV1 = {
  ...volume("shelf", "class-b", square(-140, -60, 110, 60), { ref: "msl", ft: SHELF }, { ref: "msl", ft: CEILING }),
  polygons: [{ outer: square(-140, -60, 110, 60), holes: [square(19.98, -30.02, 80.02, 30.02).reverse()] }],
};
export const tower = volume("tower", "class-d", circleRing(50, 0, 12), { ref: "sfc", ft: 0 }, { ref: "msl", ft: sheetsUp(16) });

export function build(settings: Partial<AirspaceStackSettingsV1>, volumes: AirspaceVolumeV1[] | undefined, config: Partial<ProjectConfigV1> = {}): GeometryIRV1 {
  const airspaceStack = { ...DEFAULT_AIRSPACE_STACK, ...settings, classes: { ...DEFAULT_AIRSPACE_STACK.classes, ...settings.classes } };
  const withVolumes: SourceBundleV1 = volumes ? { ...source, airspaceVolumes: volumes } : source;
  return generateGeometry({ ...project, ...config, airspaceStack }, withVolumes);
}
