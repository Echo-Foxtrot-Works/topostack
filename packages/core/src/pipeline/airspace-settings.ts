import type { AirspaceStackIR, AirspaceStackSettingsV1, AirspaceTint, AirspaceVolumeV1, GeometryWarning, LayerIR, Point2D, ProjectConfigV1, SourceBundleV1, WaterInsertIR } from "../types.js";
import type { ElevationLadder } from "./generation-context.js";

/**
 * The light half of airspace in acrylic: defaults and colours the studio needs
 * on first paint, and the hook the heavy stage registers through. The stage
 * itself (`@topostack/core/airspace`) is loaded only by a host whose project
 * builds airspace, as typefaces are registered only when used.
 */

/** Ceiling cap when the crop has no Class B or C to take it from. */
export const AIRSPACE_DEFAULT_CAP_FT = 10_000;
/** What turning airspace on starts from: plates of Class B, C and special use airspace on 4 mm round rods glued in segments. */
export const DEFAULT_AIRSPACE_STACK: AirspaceStackSettingsV1 = {
  form: "plates",
  classes: { B: true, C: true, D: false, specialUse: true },
  rod: { shape: "round", sizeMm: 4, fitClearanceMm: 0.1, socketDepthMm: 6, joint: "segments" },
};

/** The acrylic as the project resolves it, every optional value filled from the wood. */
export function airspaceMaterial(config: ProjectConfigV1): { thicknessMm: number; kerfMm: number } | undefined {
  const settings = config.airspaceStack;
  if (!settings) return undefined;
  return { thicknessMm: settings.thicknessMm ?? config.materialThicknessMm, kerfMm: settings.kerfMm ?? config.laserKerfMm };
}

/** Acrylic colour after the sectional: blue for Class B and D and the prohibited, restricted and warning areas; magenta for Class C, MOAs and alert areas. */
export function airspaceTint(volume: Pick<AirspaceVolumeV1, "aviationClass" | "specialUseKind">): Exclude<AirspaceTint, "clear"> {
  if (volume.aviationClass === "class-c") return "magenta";
  if (volume.aviationClass === "special-use") return volume.specialUseKind === "moa" || volume.specialUseKind === "alert" ? "magenta" : "blue";
  return "blue";
}

/** The airspace stage's signature, as `@topostack/core/airspace` exports it. */
export type AirspaceStage = (config: ProjectConfigV1, source: SourceBundleV1, layers: LayerIR[], ladder: ElevationLadder, clip: Point2D[], inserts: WaterInsertIR[], warnings: GeometryWarning[]) => AirspaceStackIR | undefined;

let registered: AirspaceStage | undefined;

/** Install the airspace stage in this JavaScript realm; a host does this before generating a project that builds airspace. */
export function registerAirspaceStage(stage: AirspaceStage): void {
  registered = stage;
}

/** The stage this realm registered, if any. */
export function registeredAirspaceStage(): AirspaceStage | undefined {
  return registered;
}
