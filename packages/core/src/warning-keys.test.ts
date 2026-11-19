import { describe, expect, it } from "vitest";

// The studio translates a warning by its `messageKey` (apps/generator
// src/lib/i18n/messages/en/warnings.json); a warning without one shows English
// in every language. This scan keeps every warning core writes keyed.

// Core has no Node types; Vite reads the sources for the test.
declare global {
  interface ImportMeta {
    glob(patterns: string[], options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
  }
}
const files = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./test-support/**"], { query: "?raw", import: "default", eager: true });

const codes = new Set([...files["./types.ts"]!.match(/export type GeometryWarningCode =([^;]+);/)![1]!.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]!));

/** The `{ … }` object literal around `index`, by brace depth (template `${…}` braces balance). */
function enclosingObject(text: string, index: number): string {
  let depth = 0;
  let start = index;
  for (; start >= 0; start -= 1) {
    if (text[start] === "}") depth += 1;
    else if (text[start] === "{") { if (depth === 0) break; depth -= 1; }
  }
  depth = 0;
  let end = index;
  for (; end < text.length; end += 1) {
    if (text[end] === "{") depth += 1;
    else if (text[end] === "}") { if (depth === 0) break; depth -= 1; }
  }
  return text.slice(start, end + 1);
}

describe("generation warnings", () => {
  const sites = Object.entries(files).flatMap(([file, text]) => [...text.matchAll(/\bcode: "([A-Z_]+)"/g)]
    .filter((match) => codes.has(match[1]!))
    .map((match) => ({ where: `${file}:${text.slice(0, match.index).split("\n").length}`, object: enclosingObject(text, match.index!) })));

  it("finds the warning sites", () => {
    expect(codes.size).toBeGreaterThan(30);
    expect(sites.length).toBeGreaterThan(50);
  });

  it("gives every warning a message key for the studio's catalog", () => {
    expect(sites.filter((site) => !/\bmessageKey\b/.test(site.object)).map((site) => site.where)).toEqual([]);
  });

  it("passes params wherever the English fills in values", () => {
    // An interpolated message needs its values as params, or the catalog cannot say them.
    const missing = sites.filter((site) => /message: `[^`]*\$\{/.test(site.object) && !/\bparams\b/.test(site.object)).map((site) => site.where);
    expect(missing).toEqual([]);
  });
});
