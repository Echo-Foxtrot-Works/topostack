import type { PreviewUpdateKind } from "$lib/studio/status-messages";

// Sheet nesting only arranges finished parts at export, so it never touches generation.
const COSMETIC_KEYS: ReadonlySet<string> = new Set(["name", "explodedPreview", "sheetNesting", "waterInsertSheetNesting"]);
/** Keys whose edits refresh the preview as custom data rather than a fabrication change. */
const CUSTOM_DATA_KEYS: ReadonlySet<string> = new Set(["markers", "markerIcons", "customLines", "customGraphics", "placedGraphics"]);
// Stroke and text styling never changes the terrain request, so a running
// Generate keeps going and re-renders with the latest style when it finishes.
const GENERATION_STYLE_KEYS: ReadonlySet<string> = new Set(["lineStyle", "textStyle"]);

/** Whether an edit to `keys` can leave in-flight generation and preview work running. */
export function keepsPendingWork(keys: readonly string[], generating: boolean): boolean {
  // `[].every` is true, so an empty patch used to keep pending work running
  // at an unchanged revision, and a second refresh could then replace the
  // first one's debounce while sharing its revision guard.
  if (!keys.length) return false;
  return keys.every((key) => COSMETIC_KEYS.has(key) || (generating && GENERATION_STYLE_KEYS.has(key)));
}

/**
 * How the preview catches up after the project moved by `changedFromSource`
 * (keys differing from the project the preview was built from): not at all
 * when only cosmetic keys changed, otherwise as a map-detail, custom-data or
 * fabrication refresh.
 */
export function refreshKindFor(changedFromSource: readonly string[]): PreviewUpdateKind | undefined {
  if (!changedFromSource.some((key) => !COSMETIC_KEYS.has(key))) return undefined;
  if (changedFromSource.some((key) => key.startsWith("show"))) return "details";
  return changedFromSource.every((key) => CUSTOM_DATA_KEYS.has(key)) ? "customData" : "fabrication";
}
