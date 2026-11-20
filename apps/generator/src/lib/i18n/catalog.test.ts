import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMessage, messageArgumentKinds, messageArguments, messageProblems, type MessageParams } from "$lib/i18n/format";
import { LOCALES, pseudo, setLocale, supportedLocale, t } from "$lib/i18n/i18n.svelte";
import { en } from "$lib/i18n/messages/en/index";

const messagesDir = new URL("./messages/", import.meta.url).pathname;
const srcDir = new URL("../../", import.meta.url).pathname;
const areas = readdirSync(join(messagesDir, "en")).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
const read = (locale: string, areaName: string): Record<string, string> => {
  try { return JSON.parse(readFileSync(join(messagesDir, locale, `${areaName}.json`), "utf8")); } catch { return {}; }
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "messages" ? [] : sourceFiles(path);
    return /\.(svelte|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("message catalogs", () => {
  it("registers every English area file", () => {
    for (const areaName of areas) {
      for (const key of Object.keys(read("en", areaName))) expect(en).toHaveProperty(`${areaName}.${key}`);
    }
  });

  it.each(LOCALES.filter((locale) => locale !== "en"))("%s translates every English message with the same arguments", (locale) => {
    const missing: string[] = [];
    const mismatched: string[] = [];
    const extra: string[] = [];
    for (const areaName of areas) {
      const source = read("en", areaName);
      const translated = read(locale, areaName);
      for (const [key, message] of Object.entries(source)) {
        const value = translated[key];
        if (typeof value !== "string" || !value.trim()) { missing.push(`${areaName}.${key}`); continue; }
        if (messageArguments(value).join() !== messageArguments(message).join()) mismatched.push(`${areaName}.${key}`);
      }
      for (const key of Object.keys(translated)) if (!(key in source)) extra.push(`${areaName}.${key}`);
    }
    expect({ missing, mismatched, extra }).toEqual({ missing: [], mismatched: [], extra: [] });
  });

  it("uses only keys the English catalog defines, and defines none it never uses", () => {
    const used = new Set<string>();
    const unknown: string[] = [];
    // Literal keys: t("area.key"), and keys built from a prefix: t(`area.prefix.${…}`).
    const prefixes: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*["']([a-z][\w-]*\.[\w.-]+)["']/g)) {
        used.add(match[1]!);
        if (!(match[1]! in en)) unknown.push(`${relative(srcDir, file)}: ${match[1]}`);
      }
      for (const match of text.matchAll(/\b(?:t|hasMessage)\(\s*`([a-z][\w-]*\.[\w.-]*)\$\{/g)) prefixes.push(match[1]!);
      for (const match of text.matchAll(/["'`]([a-z][\w-]*\.[\w.-]+)["'`]\s+as\s+MessageKey/g)) used.add(match[1]!);
      // Keys held in tables (e.g. $lib/i18n/errors.ts) count as used wherever they appear as a literal.
      for (const match of text.matchAll(/["']([a-z][\w-]*\.[\w.-]+)["']/g)) if (match[1]! in en) used.add(match[1]!);
    }
    const unused = Object.keys(en).filter((key) => !used.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)));
    expect({ unknown, unused }).toEqual({ unknown: [], unused: [] });
  });
});

describe("locale selection", () => {
  it("maps host codes onto the 18 supported locales", () => {
    expect(supportedLocale("pt-BR")).toBe("pt-BR");
    expect(supportedLocale("pt")).toBe("pt-BR");
    expect(supportedLocale("zh-Hant")).toBe("zh-hant");
    expect(supportedLocale("zh-TW")).toBe("zh-hant");
    expect(supportedLocale("zh-CN")).toBe("zh");
    expect(supportedLocale("DE")).toBe("de");
    expect(supportedLocale("ar")).toBeUndefined();
    expect(supportedLocale(undefined)).toBeUndefined();
  });

  it("accents copy but not arguments in the pseudo-locale", () => {
    expect(pseudo("Layer {index} of {count, plural, one {# sheet} other {# sheets}}")).toBe("⟦Ļàýéŕ {index} öƒ {count, plural, one {# šĥééţ} other {# šĥééţš}}⟧");
  });

  it("falls back to English for unsupported codes", async () => {
    expect(await setLocale("ar")).toBe("en");
    expect(await setLocale(undefined)).toBe("en");
    expect(t).toBeTypeOf("function");
  });
});

describe("every translation renders", () => {
  // Sample values by how English uses each argument: counts 1, 2 and 5 cover
  // every plural category the 18 locales use; every select option is tried.
  const samples = (message: string): MessageParams[] => {
    const kinds = Object.entries(messageArgumentKinds(message));
    const base = (count: number): MessageParams => Object.fromEntries(kinds.map(([name, kind]) => [name,
      kind.kind === "plural" || kind.kind === "number" ? count : kind.kind === "list" ? ["Alpha", "Beta", "Gamma"] : kind.kind === "select" ? kind.options[0] : "Sample"]));
    const selects = kinds.flatMap(([name, kind]) => kind.kind === "select" ? kind.options.map((option) => ({ ...base(2), [name]: option === "other" ? "zzz" : option })) : []);
    return [base(1), base(2), base(5), base(1.5), ...selects];
  };

  it.each(LOCALES)("%s: every message is well formed and renders without leftover syntax", (locale) => {
    const problems: string[] = [];
    for (const areaName of areas) {
      const source = read("en", areaName);
      const messages = locale === "en" ? source : read(locale, areaName);
      for (const [key, message] of Object.entries(messages)) {
        const english = source[key];
        if (english === undefined) continue;
        for (const problem of messageProblems(message)) problems.push(`${areaName}.${key}: ${problem}`);
        for (const params of samples(english)) {
          let out: string;
          try { out = formatMessage(message, params, locale === "zh-hant" ? "zh-Hant" : locale); } catch (error) { problems.push(`${areaName}.${key}: throws ${String(error)}`); break; }
          if (/[{}]/.test(out) || /\bNaN\b|undefined/.test(out)) { problems.push(`${areaName}.${key}: renders "${out}"`); break; }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

