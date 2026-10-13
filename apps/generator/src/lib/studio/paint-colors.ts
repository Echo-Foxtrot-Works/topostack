import type { LAND_CLASSES, LandClass, PaintRegionKind } from "@topostack/core";

/**
 * Suggested paint per stencil kind: the swatch beside its switch, the window
 * fill in the cut preview and the tint in the 3D preview. Close to the colours
 * agency maps use (BLM sand, Forest Service green), and apart enough to tell
 * neighbours on one sheet.
 */
export const PAINT_COLORS: Record<PaintRegionKind, string> = {
  water: "#2f7fb0",
  "national-park": "#4f9a58",
  "national-monument": "#c07a3c",
  "national-forest": "#8bbf6a",
  wilderness: "#2f6f4f",
  blm: "#e2c27a",
  "wildlife-refuge": "#5aa69a",
  "state-park": "#9ccf63",
  preserve: "#b6d3a5",
  tribal: "#c98b6b",
  military: "#a7a7a7",
};

/** The land kinds in the order the Features panel lists them, labelled for a switch. */
export const LAND_PAINT_OPTIONS: Array<{ value: LandClass; label: string }> = [
  { value: "national-park", label: "National parks" },
  { value: "national-monument", label: "National monuments" },
  { value: "national-forest", label: "National forests" },
  { value: "wilderness", label: "Wilderness" },
  { value: "blm", label: "BLM land" },
  { value: "wildlife-refuge", label: "Wildlife refuges" },
  { value: "state-park", label: "State parks" },
  { value: "preserve", label: "Preserves" },
  { value: "tribal", label: "Tribal land" },
  { value: "military", label: "Military land" },
] satisfies Array<{ value: (typeof LAND_CLASSES)[number]; label: string }>;

/** `kinds` with `kind` turned on or off, keeping the others as they were. */
export function withPaintKind(kinds: readonly PaintRegionKind[], kind: PaintRegionKind, on: boolean): PaintRegionKind[] {
  const others = kinds.filter((entry) => entry !== kind);
  return on ? [...others, kind] : others;
}
