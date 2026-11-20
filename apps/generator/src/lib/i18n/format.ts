/**
 * A small ICU-style message formatter: `{name}` placeholders, and
 * `{count, plural, one {# piece} other {# pieces}}` /
 * `{kind, select, round {…} other {…}}` blocks, nestable. Numbers are
 * formatted for the locale; `#` inside a plural is the formatted count.
 * `{value, number, ::.0}` fixes the decimals (`.00`, `.0#` …) and
 * `::group-off` drops thousands separators. A string array is a locale list
 * ("A, B and C"); `{names, list, series}` joins every item with the locale's
 * list comma ("A, B, C") and `{names, list, and}` with its "and"
 * ("A and B and C"). Strings are compiled once per message and cached.
 */
export type MessageParams = Record<string, string | number | readonly string[] | undefined>;

type Part = string | { name: string; style?: { kind: "number" | "list"; value: string } } | { name: string; kind: "plural" | "select"; offset: number; options: Record<string, Part[]>; trailing?: string } | { pound: true };

const cache = new Map<string, Part[]>();

function parse(source: string, inPlural = false): Part[] {
  const parts: Part[] = [];
  let index = 0;
  let text = "";
  const flush = () => { if (text) { parts.push(text); text = ""; } };
  while (index < source.length) {
    const char = source[index]!;
    if (char === "'" && source[index + 1] === "'") { text += "'"; index += 2; continue; }
    if (char === "'" && (source[index + 1] === "{" || source[index + 1] === "}" || source[index + 1] === "#")) {
      // Quoted literal up to the next single quote.
      const end = source.indexOf("'", index + 1);
      text += source.slice(index + 1, end === -1 ? undefined : end);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (char === "#" && inPlural) { flush(); parts.push({ pound: true }); index += 1; continue; }
    if (char !== "{") { text += char; index += 1; continue; }
    flush();
    const close = matching(source, index);
    const body = source.slice(index + 1, close);
    index = close + 1;
    const comma = body.indexOf(",");
    if (comma === -1) { parts.push({ name: body.trim() }); continue; }
    const name = body.slice(0, comma).trim();
    const rest = body.slice(comma + 1);
    const second = rest.indexOf(",");
    const kind = (second === -1 ? rest : rest.slice(0, second)).trim();
    if (kind === "number" || kind === "list") { parts.push({ name, style: { kind, value: second === -1 ? "" : rest.slice(second + 1).trim() } }); continue; }
    if (kind !== "plural" && kind !== "select") { parts.push({ name }); continue; }
    let optionsSource = rest.slice(second + 1).trim();
    let offset = 0;
    const offsetMatch = /^offset:(\d+)\s*/.exec(optionsSource);
    if (offsetMatch) { offset = Number(offsetMatch[1]); optionsSource = optionsSource.slice(offsetMatch[0].length); }
    const options: Record<string, Part[]> = {};
    let cursor = 0;
    while (cursor < optionsSource.length) {
      const open = optionsSource.indexOf("{", cursor);
      if (open === -1) break;
      const key = optionsSource.slice(cursor, open).trim();
      const end = matching(optionsSource, open);
      options[key] = parse(optionsSource.slice(open + 1, end), inPlural || kind === "plural");
      cursor = end + 1;
    }
    const trailing = optionsSource.slice(cursor).trim();
    parts.push({ name, kind, offset, options, ...(trailing ? { trailing } : {}) });
  }
  flush();
  return parts;
}

function matching(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") { depth -= 1; if (depth === 0) return index; }
  }
  throw new Error(`Unbalanced braces in message: ${source}`);
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();
const listFormats = new Map<string, Intl.ListFormat>();

export function formatNumber(value: number, locale: string, options: Intl.NumberFormatOptions = { maximumFractionDigits: 3 }): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) numberFormats.set(key, format = new Intl.NumberFormat(locale, options));
  return format.format(value);
}

function formatList(values: readonly string[], locale: string): string {
  let format = listFormats.get(locale);
  if (!format) listFormats.set(locale, format = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }));
  return format.format(values);
}

const DEFAULT_NUMBER: Intl.NumberFormatOptions = { maximumFractionDigits: 3 };

/** Number options for an ICU skeleton: `::.0` / `::.00` / `::.0#` decimals, `::group-off`. */
function skeletonOptions(skeleton: string): Intl.NumberFormatOptions {
  const options: Intl.NumberFormatOptions = { ...DEFAULT_NUMBER };
  for (const token of skeleton.replace(/^::/, "").split(/\s+/).filter(Boolean)) {
    const fraction = /^\.(0*)(#*)$/.exec(token);
    if (fraction) {
      options.minimumFractionDigits = fraction[1]!.length;
      options.maximumFractionDigits = fraction[1]!.length + fraction[2]!.length;
    } else if (token === "group-off") options.useGrouping = false;
  }
  return options;
}

const listSeparators = new Map<string, { series: string; and: string }>();

/** The locale's own list comma and "and", taken from its conjunction list pattern. */
function separators(locale: string): { series: string; and: string } {
  let found = listSeparators.get(locale);
  if (!found) {
    const format = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    const literal = (items: string[]) => format.formatToParts(items).find((part) => part.type === "literal")?.value ?? ", ";
    listSeparators.set(locale, found = { series: literal(["a", "b", "c"]), and: literal(["a", "b"]) });
  }
  return found;
}

function formatValue(value: string | number | readonly string[], locale: string, style?: { kind: "number" | "list"; value: string }): string {
  if (typeof value === "number") return formatNumber(value, locale, style?.kind === "number" ? skeletonOptions(style.value) : DEFAULT_NUMBER);
  if (!Array.isArray(value)) return String(value);
  const items = value as readonly string[];
  if (style?.kind === "list" && (style.value === "series" || style.value === "and")) return items.join(separators(locale)[style.value]);
  return formatList(items, locale);
}

function render(parts: Part[], params: MessageParams, locale: string, count?: number): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "string") { out += part; continue; }
    if ("pound" in part) { out += count === undefined ? "#" : formatNumber(count, locale); continue; }
    const value = params[part.name];
    if (!("kind" in part)) {
      out += value === undefined ? `{${part.name}}` : formatValue(value, locale, "style" in part ? part.style : undefined);
      continue;
    }
    if (part.kind === "select") {
      out += render(part.options[String(value)] ?? part.options.other ?? [], params, locale, count);
      continue;
    }
    const number = Number(value ?? 0) - part.offset;
    let rules = pluralRules.get(locale);
    if (!rules) pluralRules.set(locale, rules = new Intl.PluralRules(locale));
    const option = part.options[`=${number + part.offset}`] ?? part.options[rules.select(number)] ?? part.options.other ?? [];
    out += render(option, params, locale, number);
  }
  return out;
}

export function formatMessage(message: string, params: MessageParams = {}, locale = "en"): string {
  if (!message.includes("{") && !message.includes("'")) return message;
  let parts = cache.get(message);
  if (!parts) cache.set(message, parts = parse(message));
  return render(parts, params, locale);
}

/** Every placeholder and plural/select argument a message uses, for catalog checks. */
export function messageArguments(message: string): string[] {
  const names = new Set<string>();
  const walk = (parts: Part[]) => {
    for (const part of parts) {
      if (typeof part === "string" || "pound" in part) continue;
      names.add(part.name);
      if ("options" in part) Object.values(part.options).forEach(walk);
    }
  };
  walk(parse(message));
  return [...names].sort();
}

const PLURAL_KEY = /^(=\d+|zero|one|two|few|many|other)$/;
const SELECT_KEY = /^[\w-]+$/;

/**
 * What is wrong with a message's structure, for catalog checks: a plural or
 * select option key that is not a key (text left between options), text after
 * the last option, or a missing `other`. Empty when the message is sound.
 */
export function messageProblems(message: string): string[] {
  const problems: string[] = [];
  const walk = (parts: Part[]) => {
    for (const part of parts) {
      if (typeof part === "string" || "pound" in part || !("options" in part)) continue;
      for (const key of Object.keys(part.options)) {
        if (!(part.kind === "plural" ? PLURAL_KEY : SELECT_KEY).test(key)) problems.push(`{${part.name}} has a malformed option key "${key}"`);
      }
      if (!("other" in part.options)) problems.push(`{${part.name}} has no other option`);
      if (part.trailing) problems.push(`{${part.name}} has text after its last option: "${part.trailing}"`);
      Object.values(part.options).forEach(walk);
    }
  };
  try {
    walk(parse(message));
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return problems;
}


export type ArgumentKind = { kind: "text" } | { kind: "number" } | { kind: "list" } | { kind: "plural" } | { kind: "select"; options: string[] };

/** How each argument of a message is used, so tests can render it with fitting sample values. */
export function messageArgumentKinds(message: string): Record<string, ArgumentKind> {
  const kinds: Record<string, ArgumentKind> = {};
  const walk = (parts: Part[]) => {
    for (const part of parts) {
      if (typeof part === "string" || "pound" in part) continue;
      if ("options" in part) {
        kinds[part.name] = part.kind === "plural" ? { kind: "plural" } : { kind: "select", options: Object.keys(part.options) };
        Object.values(part.options).forEach(walk);
      } else if (part.style) kinds[part.name] = { kind: part.style.kind };
      else kinds[part.name] ??= { kind: "text" };
    }
  };
  walk(parse(message));
  return kinds;
}
