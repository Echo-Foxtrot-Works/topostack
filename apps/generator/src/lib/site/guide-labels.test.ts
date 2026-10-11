import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_CATALOG } from "@topostack/core";

const src = join(import.meta.dirname, "..", "..");

function pages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? pages(path) : entry.name === "+page.svelte" ? [path] : [];
  });
}

const decode = (text: string): string => text.replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();

/**
 * Words the studio shows: markup text, label/title/placeholder attributes and
 * capitalized string literals (ternary labels and option lists). Matching is
 * exact so a short label such as "Water" cannot hide inside unrelated code.
 */
function studioStrings(): Set<string> {
  const components = (directory: string): string[] => readdirSync(join(src, directory)).filter((file) => file.endsWith(".svelte")).map((file) => `${directory}/${file}`);
  const files = ["lib/studio/App.svelte", ...components("lib/studio/panels"), ...components("lib/studio/customdata"), "lib/studio/customdata/custom-data-nav.svelte.ts", "lib/studio/preview-summary.ts", "lib/studio/customdata/chart-tracing.svelte.ts", "lib/studio/ExportDialog.svelte", "lib/studio/LocationDialog.svelte", "lib/studio/MapCanvas.svelte", "lib/studio/MapStage.svelte", "lib/studio/TwoDPreview.svelte", "lib/studio/placement/PlacementLayer.svelte", "lib/studio/options.ts", "lib/site/FeedbackButton.svelte"];
  const strings = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(src, file), "utf8");
    const patterns = [/>([^<>{}]+)[<{]/g, /}([^<>{}]+)</g, /(?:label|title|placeholder)\s*[=:]\s*["']([^"'\n]+)["']/g, /"([A-Z][^"\n]*)"/g];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        // A label followed by a count, as in "Try another placement (1 of 2)", is still the label.
        const text = decode(match[1]!).replace(/[.:]$/, "").replace(/\s*\($/, "");
        if (text) strings.add(text);
      }
    }
  }
  // The font pickers list the catalog's names.
  for (const entry of FONT_CATALOG) strings.add(entry.name);
  return strings;
}

// Guides bold the studio's own words ("select <strong>Generate terrain</strong>").
// When a control is renamed, those instructions silently go stale.
const guidePages = [...pages(join(src, "routes/guides")), ...pages(join(src, "routes/examples"))];

/** Bold text in guides that is emphasis, a file name or a page's own control, not a studio label. */
const NOT_STUDIO_LABELS = new Set([
  "ATTRIBUTION.txt", "-engraving.svg", "ENGRAVE", "Layered:", "Flat:",
  "Kerf compensation is on by default.", "Use one engraving copy per panel.",
  "Survey data comes first.", "mixed coverage", "whole lake and a margin of surrounding land",
  "Steep banks suggest faster drop-offs; gentle banks suggest broader shallows.",
  "If a lake looks flat:", "Surveyed:", "Modeled or user-adjusted:", "Mixed:",
  "“Some lake depths are estimated rather than surveyed”", "Real surveys, with different levels of detail.",
  "Prepare the published data.", "Fill between measured contours.", "Match your map.", "Keep track of gaps.",
  "Open in studio", "Turn off kerf compensation",
  "Traced from your chart:", "“Some lake floors come from a traced depth chart”",
]);

function boldText(page: string): string[] {
  return [...readFileSync(page, "utf8").matchAll(/<strong>([^<{]+)<\/strong>/g)].map((match) => decode(match[1]!));
}

describe("guide studio labels", () => {
  it("only bolds labels that exist in the studio, or listed emphasis", () => {
    const studio = studioStrings();
    const unknown = guidePages.flatMap((page) => boldText(page)
      .filter((text) => !NOT_STUDIO_LABELS.has(text) && !studio.has(text))
      .map((text) => `${page.slice(src.length + 1)}: ${text}`));
    expect(unknown).toEqual([]);
  });

  it("keeps the emphasis list free of stale entries", () => {
    const studio = studioStrings();
    const used = new Set(guidePages.flatMap(boldText));
    expect([...NOT_STUDIO_LABELS].filter((text) => !used.has(text) || studio.has(text))).toEqual([]);
  });
});
