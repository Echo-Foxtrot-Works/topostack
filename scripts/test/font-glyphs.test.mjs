import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { absoluteCommands, buildFontGlyphs, FONT_SOURCES } from "../build/build-font-glyphs.mjs";

import { fontNotices } from "../lib/font-notices.mjs";

test("each shipped engraving family has a packaged license file", () => {
  assert.deepEqual(fontNotices.map(path => path.split("/")[2]).sort(), FONT_SOURCES.map(font => font.id).sort());
});

test("committed glyph files and picker samples match their font sources", async () => {
  const outputs = await buildFontGlyphs();
  assert.ok(outputs.size > 1);
  for (const [href, content] of outputs) {
    const committed = await readFile(new URL(href), "utf8").catch(() => "");
    assert.equal(committed, content, `${href} is stale: run node scripts/build/build-font-glyphs.mjs`);
  }
});

test("SVG font paths become absolute commands", () => {
  assert.deepEqual(absoluteCommands("M10 20h5v-5l-5 0zM0 0c1 1 2 2 3 3s1 1 2 2"), [
    ["M", 10, 20], ["L", 15, 20], ["L", 15, 15], ["L", 10, 15], ["Z"],
    ["M", 0, 0], ["C", 1, 1, 2, 2, 3, 3], ["C", 4, 4, 4, 4, 5, 5],
  ]);
  assert.deepEqual(absoluteCommands("M0 0q5 5 10 0t10 0"), [["M", 0, 0], ["Q", 5, 5, 10, 0], ["Q", 15, -5, 20, 0]]);
});
