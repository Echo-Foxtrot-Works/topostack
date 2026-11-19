# Localization

Inside Atomm, TopoStack runs in the platform's language. Atomm supports 18
languages (`zh`, `en`, `zh-hant`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `ru`, `uk`,
`sl`, `th`, `pl`, `cs`, `id`, `vi`, `pt-BR`) and its review switches through
all of them: every user-visible string, including aria-labels, tooltips,
placeholders, warnings and errors, must be translated, and an English
fallback is a rejection ([platform docs](https://dev.atomm.com/docs/atomm#language-atommapp)).

The standalone site stays English and has no language switcher. Downloaded
files (README, assembly guide, SVG titles) stay English for now.

## How it works

- `$lib/i18n/i18n.svelte.ts` holds the locale and `t(key, params)`. English
  is bundled; every other locale is loaded with `import()` once, before the
  workbench renders (`readAtommLocale` in `$lib/atomm/atomm-locale.ts`).
- Catalogs are one JSON file per area: `apps/generator/src/lib/i18n/messages/<locale>/<area>.json`.
  A key is `<area>.<name>`, e.g. `water.acrylicInserts`. English
  (`messages/en/`) is the source; new areas are registered in
  `messages/en/index.ts`.
- `$lib/i18n/format.ts` formats ICU-style messages: `{name}`,
  `{count, plural, one {# piece} other {# pieces}}`, `{kind, select, … other {…}}`.
  Numbers in params are formatted for the locale (`0,15` in German), and
  string arrays are joined as a list ("A, B and C").
- `catalog.test.ts` fails when a locale misses a key, when a translation's
  placeholders differ from English, when code uses a key English lacks, or
  when an English key is unused.
- The pseudo-locale `qps-ploc` (tests only) renders every message as
  `⟦Àççéñţéđ⟧`. The Atomm e2e opens the embed in it with every section
  expanded and fails on English left on screen.

## Writing copy

- Never put user-visible English in a component or in copy the embed shows.
  Use `t("area.key")`, including in `aria-label`, `title` and `placeholder`.
- Keep the English text exactly as it was when moving it into a catalog: the
  tests read the English copy.
- Pass values as params, never by concatenating translated fragments:
  `t("terrain.layerOf", { index, count })` with `"Layer {index} of {count}"`.
  Word order differs between languages.
- Use plurals for counts: `"{count, plural, one {# sheet} other {# sheets}}"`.
  Pass numbers as numbers so they are formatted for the locale; put the unit in
  the message (`"{value} mm"`).
- Keys for option values built at runtime use a shared prefix:
  `t(\`features.roadStyle.${value}\` as MessageKey)`.
- Core (`@topostack/core`) stays English: its warnings carry a `messageKey`
  and `params` beside the English `message`. The studio shows
  `warningText(warning)` (`$lib/i18n/warnings.ts`); agents and the REST/MCP
  API keep using `message`.
- Do not translate place names, data names (lakes, parks, airports), file
  names, `TopoStack`, or data source names (OpenStreetMap, FAA, PAD-US,
  GLOBathy, HydroLAKES, USGS, NOAA, Copernicus).

## Translating

`messages/glossary.json` fixes the laser and mapping terms per language (cut,
score, engrave, kerf, layer, sheet, nesting, airspace class names, public
land kinds). Translations follow it; xTool Studio's own wording wins where
the platform already uses a term. Keep translations about as short as the
English where they sit in the 320 px rail.
