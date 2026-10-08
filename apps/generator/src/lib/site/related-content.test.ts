import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES } from "$lib/site/seo";
import { EXAMPLES } from "$lib/site/examples";
import { starterById } from "$lib/site/starters";
import { relatedContent } from "$lib/site/related-content";

describe("contextual project links", () => {
  it("links only to published pages, examples and known starters", () => {
    const paths = [...Object.keys(PUBLIC_PAGES), "/lake/pelican-crow-wing-county-minnesota", "/lakes/minnesota", ...EXAMPLES.map((example) => `/examples/${example.slug}`)];
    for (const path of paths) {
      const links = relatedContent(path);
      expect(new Set(links.map((link) => link.path)).size).toBe(links.length);
      for (const link of links) {
        expect(link.path).not.toBe(path);
        const url = new URL(link.path, "https://topostack.app");
        if (url.pathname === "/studio") expect(starterById(url.searchParams.get("starter"))).toBeDefined();
        else expect(paths).toContain(url.pathname);
      }
    }
  });
  it("matches the workflow and leaves policy pages without project recommendations", () => {
    expect(relatedContent("/guides/topographic-map-engraving")[0]!.path).toBe("/studio?starter=engraving");
    expect(relatedContent("/lake/pelican").map((link) => link.path)).toContain("/examples/lake-tahoe");
    expect(relatedContent("/privacy")).toEqual([]);
  });
});
