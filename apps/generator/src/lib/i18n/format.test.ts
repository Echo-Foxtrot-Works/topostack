import { describe, expect, it } from "vitest";
import { formatMessage, messageArguments } from "$lib/i18n/format";

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

  it("lists every argument a message uses", () => {
    expect(messageArguments("{a} and {count, plural, one {# {b}} other {# {c}}}")).toEqual(["a", "b", "c", "count"]);
  });
});
