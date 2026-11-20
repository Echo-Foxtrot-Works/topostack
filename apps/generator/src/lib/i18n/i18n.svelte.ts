import { formatMessage, formatNumber as formatNumberFor, type MessageParams } from "$lib/i18n/format";
import { en, type MessageKey } from "$lib/i18n/messages/en/index";

export type { MessageKey, MessageParams };

/**
 * The 18 languages Atomm can run the generator in, in the order
 * `atomm.app.getLocale()` documents them. Inside the platform every string
 * must exist in each of them: review switches through all 18 and an English
 * fallback is a rejection (dev.atomm.com/docs/atomm#language-atommapp).
 */
export const LOCALES = ["zh", "en", "zh-hant", "de", "es", "fr", "it", "ja", "ko", "ru", "uk", "sl", "th", "pl", "cs", "id", "vi", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * A pseudo-locale for tests only: every message is accented and bracketed
 * (`⟦Ŵàţéŕ⟧`), so any English left on screen is copy that never went
 * through `t()`. Atomm never returns it.
 */
export const PSEUDO_LOCALE = "qps-ploc";

type Catalog = Record<string, string>;

// Each locale is one file per area, loaded only when that locale is used.
const catalogs = import.meta.glob<Catalog>(["./messages/*/*.json", "!./messages/en/*.json"], { import: "default" });

const state = $state<{ locale: string; catalog: Catalog }>({ locale: "en", catalog: en });

/** The supported locale a host code names, matched case-insensitively; `pt` and `zh-tw` map to the regional forms. */
export function supportedLocale(code: string | undefined): Locale | typeof PSEUDO_LOCALE | undefined {
  if (!code) return undefined;
  const lower = code.trim().toLowerCase().replace("_", "-");
  if (lower === PSEUDO_LOCALE) return PSEUDO_LOCALE;
  const exact = LOCALES.find((locale) => locale.toLowerCase() === lower);
  if (exact) return exact;
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower.startsWith("zh-hant")) return "zh-hant";
  if (lower.startsWith("zh")) return "zh";
  if (lower === "pt" || lower.startsWith("pt-")) return "pt-BR";
  const base = lower.split("-")[0];
  return LOCALES.find((locale) => locale === base);
}

const ACCENTS: Record<string, string> = { a: "à", b: "ƀ", c: "ç", d: "đ", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ", n: "ñ", o: "ö", p: "þ", r: "ŕ", s: "š", t: "ţ", u: "û", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "À", B: "Ɓ", C: "Ç", D: "Đ", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Î", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ", N: "Ñ", O: "Ö", P: "Þ", R: "Ŕ", S: "Š", T: "Ţ", U: "Û", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž" };

/** Accent the letters outside `{…}` arguments, keeping plural and select keywords intact. */
export function pseudo(message: string): string {
  // A "{" opens an argument at text level, and an option body inside an
  // argument; only text and option bodies are copy.
  const stack: Array<"argument" | "body"> = [];
  let out = "";
  for (const char of message) {
    if (char === "{") { stack.push(stack.at(-1) === "argument" ? "body" : "argument"); out += char; continue; }
    if (char === "}") { stack.pop(); out += char; continue; }
    out += stack.at(-1) === "argument" ? char : ACCENTS[char] ?? char;
  }
  return `⟦${out}⟧`;
}

/**
 * Switch the studio's copy to `code` before the first render. Unsupported or
 * missing codes keep English, which is only right outside the platform.
 * Resolves to the locale in use.
 */
export async function setLocale(code: string | undefined): Promise<string> {
  const locale = supportedLocale(code) ?? "en";
  if (locale === "en") { state.locale = "en"; state.catalog = en; return "en"; }
  if (locale === PSEUDO_LOCALE) {
    state.locale = "en";
    state.catalog = Object.fromEntries(Object.entries(en).map(([key, value]) => [key, pseudo(value)]));
    return PSEUDO_LOCALE;
  }
  const files = Object.entries(catalogs).filter(([path]) => path.startsWith(`./messages/${locale}/`));
  const parts = await Promise.all(files.map(async ([path, load]) => {
    const prefix = path.slice(path.lastIndexOf("/") + 1, -".json".length);
    const messages = await load();
    return Object.entries(messages).map(([key, value]) => [`${prefix}.${key}`, value] as const);
  }));
  // A key a translation lacks keeps its English text; the catalog test fails the build first.
  state.catalog = { ...en, ...Object.fromEntries(parts.flat()) };
  state.locale = locale;
  return locale;
}

/** The locale formatting uses: a BCP 47 tag for Intl. */
export function currentLocale(): string {
  return state.locale === "zh-hant" ? "zh-Hant" : state.locale;
}

/** The translated message for `key`, with `{placeholders}`, plurals and numbers filled in. */
export function t(key: MessageKey, params?: MessageParams): string {
  const message = state.catalog[key] ?? (en as Catalog)[key] ?? key;
  return formatMessage(message, params, currentLocale());
}

/** Whether a key exists, for copy whose key is built at runtime (warning codes, option values). */
export function hasMessage(key: string): key is MessageKey {
  return key in en;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return formatNumberFor(value, currentLocale(), options);
}
