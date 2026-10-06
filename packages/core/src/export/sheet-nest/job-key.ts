import { fnv1aHex, stableStringify } from "../../primitives/hash.js";
import type { NestPartV1, ResolvedSheetNestSettings } from "../../types.js";

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Identifies what a sheet plan was made for: the parts' shapes and the sheet
 * settings. It depends on content, not on when geometry was generated, so
 * regenerating an unchanged design keeps its plan. The time budget is left
 * out: a longer search does not make an earlier plan wrong.
 */
export function sheetNestJobKey(parts: NestPartV1[], settings: ResolvedSheetNestSettings): string {
  const { timeBudgetS: _effortOnly, ...layoutSettings } = settings;
  const content = {
    settings: layoutSettings,
    parts: parts.map((part) => ({
      id: part.id,
      members: part.members,
      outline: part.outline.map((point) => [round(point.x), round(point.y)]),
    })),
  };
  // Two differently salted 32-bit hashes: a cached plan is only reused on a match, so collisions matter here.
  const text = stableStringify(content);
  return `nest1-${fnv1aHex(text)}${fnv1aHex(`#${text}`)}`;
}
