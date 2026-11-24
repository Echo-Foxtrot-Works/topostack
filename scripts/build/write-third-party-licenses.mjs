#!/usr/bin/env node
// Both distributions ship these notices alongside the compiled nesting engine and engraving glyphs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fontNotices } from "../lib/font-notices.mjs";

const root = new URL("../../", import.meta.url);
const sources = ["THIRD_PARTY_NOTICES.md", "packages/nest-wasm/THIRD_PARTY_LICENSES.md", ...fontNotices];
const output = new URL("apps/generator/dist/licenses/", root);
mkdirSync(output, { recursive: true });
writeFileSync(new URL("third-party.txt", output), sources.map((source) => source + "\n\n" + readFileSync(new URL(source, root), "utf8").trim()).join("\n\n----------------------------------------\n\n") + "\n");
console.log("Wrote dist/licenses/third-party.txt");
