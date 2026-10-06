import { SHEET_NEST_ROTATIONS, type ProjectConfigV1, type ResolvedSheetNestSettings, type SheetNestRotation, type SheetNestSettingsV1 } from "../../types.js";

export const DEFAULT_SHEET_NESTING: SheetNestSettingsV1 = {
  sheetWidthMm: 0,
  sheetHeightMm: 0,
  marginMm: 3,
  spacingMm: 2,
  rotation: "quarter",
  timeBudgetS: 30,
  seed: 1,
};

export const SHEET_NEST_LIMITS = {
  sheetMm: { min: 20, max: 5000 },
  marginMm: { min: 0, max: 50 },
  spacingMm: { min: 0, max: 20 },
  timeBudgetS: { min: 2, max: 600 },
} as const;

export type SheetNestSettingsResult = { ok: true; settings: ResolvedSheetNestSettings } | { ok: false; error: string };

const clamp = (value: number, limit: { min: number; max: number }, fallback: number) =>
  Number.isFinite(value) ? Math.min(limit.max, Math.max(limit.min, value)) : fallback;

/**
 * The sheet a project nests onto. A sheet axis left at 0 takes the machine
 * work area on that axis; with neither set there is no sheet to fill.
 */
export function resolveSheetNestSettings(config: Pick<ProjectConfigV1, "sheetNesting" | "workAreaWidthMm" | "workAreaHeightMm">): SheetNestSettingsResult {
  const saved = { ...DEFAULT_SHEET_NESTING, ...config.sheetNesting };
  const width = saved.sheetWidthMm > 0 ? saved.sheetWidthMm : config.workAreaWidthMm;
  const height = saved.sheetHeightMm > 0 ? saved.sheetHeightMm : config.workAreaHeightMm;
  if (!(width > 0) || !(height > 0)) {
    return { ok: false, error: "Set a sheet size, or a machine work area, to nest parts onto sheets." };
  }
  const sheetWidthMm = clamp(width, SHEET_NEST_LIMITS.sheetMm, SHEET_NEST_LIMITS.sheetMm.min);
  const sheetHeightMm = clamp(height, SHEET_NEST_LIMITS.sheetMm, SHEET_NEST_LIMITS.sheetMm.min);
  // A margin that would leave no usable sheet is capped at a quarter of the short side.
  const marginMm = Math.min(clamp(saved.marginMm, SHEET_NEST_LIMITS.marginMm, DEFAULT_SHEET_NESTING.marginMm), Math.min(sheetWidthMm, sheetHeightMm) / 4);
  return {
    ok: true,
    settings: {
      sheetWidthMm,
      sheetHeightMm,
      marginMm,
      spacingMm: clamp(saved.spacingMm, SHEET_NEST_LIMITS.spacingMm, DEFAULT_SHEET_NESTING.spacingMm),
      rotation: SHEET_NEST_ROTATIONS.includes(saved.rotation) ? saved.rotation : DEFAULT_SHEET_NESTING.rotation,
      timeBudgetS: clamp(saved.timeBudgetS, SHEET_NEST_LIMITS.timeBudgetS, DEFAULT_SHEET_NESTING.timeBudgetS),
      seed: Number.isInteger(saved.seed) && saved.seed >= 0 ? saved.seed : DEFAULT_SHEET_NESTING.seed,
    },
  };
}

/** The rotations a setting allows, in degrees; undefined means any angle. */
export function allowedOrientations(rotation: SheetNestRotation): number[] | undefined {
  switch (rotation) {
    case "none": return [0];
    case "half": return [0, 180];
    case "quarter": return [0, 90, 180, 270];
    case "free": return undefined;
  }
}
