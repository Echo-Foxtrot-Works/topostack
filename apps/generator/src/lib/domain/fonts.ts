import { decodeFontGlyphs, fontEntry, isFontLoaded, registerFont, type TextFont } from "@topostack/core";
import { networkSignal } from "$lib/domain/network";

/**
 * Glyph files for the curated typefaces, built by scripts/build/build-font-glyphs.mjs.
 * They ship as static assets fetched on first use, so a font costs nothing
 * until a project picks it and none of it counts toward the JavaScript budgets.
 */
const glyphUrls = import.meta.glob<string>("./font-glyphs/*.json", { query: "?url", import: "default" });

type FetchJson = (url: string) => Promise<unknown>;

const fetchJson: FetchJson = async (url) => {
  // Shared by every caller waiting on this font, so only the deadline ends it.
  const response = await fetch(url, { signal: networkSignal() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const loading = new Map<TextFont, Promise<void>>();

export class FontLoadError extends Error {
  constructor(readonly font: TextFont, cause: unknown) {
    super(`Couldn't load the ${fontEntry(font).name} font. Check your connection and try again.`, { cause });
    this.name = "FontLoadError";
  }
}

/**
 * Registers every font in `fonts` with the geometry engine in this realm (the
 * page or the geometry worker), fetching each once. A failed fetch is
 * forgotten so the next attempt retries it.
 */
export function ensureFonts(fonts: readonly TextFont[], fetcher: FetchJson = fetchJson): Promise<void> {
  return Promise.all(fonts.filter((font) => !isFontLoaded(font)).map((font) => {
    let pending = loading.get(font);
    if (!pending) {
      pending = (async () => {
        const url = glyphUrls[`./font-glyphs/${font}.json`];
        if (!url) throw new Error(`No glyph data ships for ${font}.`);
        registerFont(decodeFontGlyphs(await fetcher(await url())));
      })().catch((error: unknown) => {
        loading.delete(font);
        throw new FontLoadError(font, error);
      });
      loading.set(font, pending);
    }
    return pending;
  })).then(() => undefined);
}

/** Test support: forget in-flight loads so a test can start over. */
export function resetFontLoads(): void {
  loading.clear();
}
