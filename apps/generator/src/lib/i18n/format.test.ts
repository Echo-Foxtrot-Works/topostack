import { describe, expect, it } from "vitest";
import { formatMessage, messageArguments, messageProblems } from "$lib/i18n/format";

describe("message format", () => {
  it("fills placeholders and formats numbers for the locale", () => {
    expect(formatMessage("Layer {index} of {count}", { index: 3, count: 12 })).toBe("Layer 3 of 12");
    expect(formatMessage("{value} mm", { value: 0.15 }, "de")).toBe("0,15 mm");
    expect(formatMessage("{value} mm", { value: 1234.5 }, "en")).toBe("1,234.5 mm");
  });

  it("chooses plural forms by the locale's rules, with # as the count", () => {
    const message = "{count, plural, one {# piece} other {# pieces}}";
    expect(formatMessage(message, { count: 1 })).toBe("1 piece");
    expect(formatMessage(message, { count: 4 })).toBe("4 pieces");
    const polish = "{count, plural, one {# arkusz} few {# arkusze} many {# arkuszy} other {# arkusza}}";
    expect(formatMessage(polish, { count: 3 }, "pl")).toBe("3 arkusze");
    expect(formatMessage(polish, { count: 5 }, "pl")).toBe("5 arkuszy");
    expect(formatMessage("{count, plural, =0 {none} other {#}}", { count: 0 })).toBe("none");
  });

  it("selects by value and nests plurals inside selects", () => {
    const message = "{shape, select, round {{count, plural, one {# rod} other {# rods}}} other {{count} posts}}";
    expect(formatMessage(message, { shape: "round", count: 2 })).toBe("2 rods");
    expect(formatMessage(message, { shape: "square", count: 2 })).toBe("2 posts");
  });

  it("joins lists for the locale and keeps quoted braces literal", () => {
    expect(formatMessage("{lakes} stay wood", { lakes: ["Jackson Lake", "Lake 2"] })).toBe("Jackson Lake and Lake 2 stay wood");
    expect(formatMessage("Use '{'braces'}'")).toBe("Use {braces}");
    expect(formatMessage("It''s fine")).toBe("It's fine");
  });

  it("fixes decimals and drops grouping by number skeleton", () => {
    expect(formatMessage("{gap, number, ::.0} mm", { gap: 6 })).toBe("6.0 mm");
    expect(formatMessage("{gap, number, ::.0} mm", { gap: 4.26 }, "de")).toBe("4,3 mm");
    expect(formatMessage("{n, number, ::.0#}", { n: 1.256 })).toBe("1.26");
    expect(formatMessage("{n, number, ::group-off} sheets", { n: 5432 })).toBe("5432 sheets");
    expect(formatMessage("{n} sheets", { n: 5432 })).toBe("5,432 sheets");
  });

  it("joins lists with the locale's comma or its and", () => {
    expect(formatMessage("{names, list, series}", { names: ["A", "B", "C"] })).toBe("A, B, C");
    expect(formatMessage("{names, list, series}", { names: ["A", "B", "C"] }, "zh")).toBe("A、B、C");
    expect(formatMessage("{names, list, and}", { names: ["A", "B", "C"] })).toBe("A and B and C");
    expect(formatMessage("{names, list, and}", { names: ["A", "B"] }, "de")).toBe("A und B");
    expect(formatMessage("{names, list}", { names: ["A", "B", "C"] })).toBe("A, B, and C");
    expect(messageArguments("{names, list, series}{n, number, ::.0}")).toEqual(["n", "names"]);
  });

  it("lists every argument a message uses", () => {
    expect(messageArguments("{a} and {count, plural, one {# {b}} other {# {c}}}")).toEqual(["a", "b", "c", "count"]);
  });

  it("reports malformed plural and select structure", () => {
    expect(messageProblems("{count, plural, one {# sheet} other {# sheets}}")).toEqual([]);
    expect(messageProblems("{source, select, chart {a chart} stray text survey {a survey} other {data}}")).toEqual(['{source} has a malformed option key "stray text survey"']);
    expect(messageProblems("{count, plural, one {# sheet}}")).toEqual(["{count} has no other option"]);
    expect(messageProblems("{count, plural, one {#} other {#} trailing}")).toEqual(['{count} has text after its last option: "trailing"']);
    expect(messageProblems("{count, plural, eins {#} other {#}}")).toEqual(['{count} has a malformed option key "eins"']);
  });
});
