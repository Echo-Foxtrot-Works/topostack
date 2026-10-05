/**
 * Write a Markdown twin beside every prerendered site page (index.html →
 * index.md) for agents that ask for `Accept: text/markdown`. The Worker serves
 * them through content negotiation; see workers/map-api/src/routes/pages.ts.
 * The Atomm package is the studio alone and is never served by the Worker, so
 * it gets none.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { markdownFile, pageMarkdown } from "../lib/markdown-pages.mjs";

if (process.env.VITE_SITE_ENV !== "atomm") {
  const dist = new URL("../../apps/generator/dist/", import.meta.url);
  let written = 0;
  for (const file of await readdir(dist, { recursive: true })) {
    const target = markdownFile(file);
    if (!target) continue;
    const markdown = pageMarkdown(await readFile(new URL(file, dist), "utf8"));
    if (!markdown) continue;
    await writeFile(new URL(target, dist), markdown);
    written += 1;
  }
  console.log(`Wrote ${written} Markdown pages`);
}
