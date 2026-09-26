import { describe, expect, it } from "vitest";
import { compareVersions, inlineTokens, isValidDate, latestRelease, parseFragment, releaseAnchor, releaseBump, sortEntries, validateChangelog } from "./changelog";

const fragment = (front: string, body = "Paths from GPX, KML and GeoJSON files land on the map.") => `---\n${front}\n---\n${body}\n`;
const entry = { type: "feature", title: "Import tracks", body: "Tracks land on the map." };

describe("parseFragment", () => {
  it("reads the front matter and folds the body to one paragraph", () => {
    expect(parseFragment(fragment("type: feature\ntitle: \"Import GPX tracks\"\npr: 54"), "a.md")).toEqual({
      type: "feature", title: "Import GPX tracks", pr: 54,
      body: "Paths from GPX, KML and GeoJSON files land on the map.",
    });
    expect(parseFragment(`\uFEFF---\r\ntype: fix\r\ntitle: Fix\r\n---\r\nLine one\r\nline two`, "b.md")).toEqual({ type: "fix", title: "Fix", body: "Line one line two" });
  });

  it("names the file in every error", () => {
    expect(() => parseFragment("no front matter", "x.md")).toThrow(/^x\.md: expected front matter/);
    expect(() => parseFragment(fragment("type: chore\ntitle: T"), "x.md")).toThrow(/type must be one of/);
    expect(() => parseFragment(fragment("type: fix"), "x.md")).toThrow(/title/);
    expect(() => parseFragment(fragment("type: fix\ntitle: T", ""), "x.md")).toThrow(/body/);
    expect(() => parseFragment(fragment("type: fix\ntitle: T\ntitle: U"), "x.md")).toThrow(/duplicate field title/);
    expect(() => parseFragment(fragment("type: fix\ntitle: T\nNot a field"), "x.md")).toThrow(/cannot read/);
    expect(() => parseFragment(fragment("type: fix\ntitle: T\nauthor: me"), "x.md")).toThrow(/unknown field author/);
    expect(() => parseFragment(fragment("type: fix\ntitle: T\npr: abc"), "x.md")).toThrow(/pr must be/);
    expect(() => parseFragment(fragment(`type: fix\ntitle: ${"a".repeat(101)}`), "x.md")).toThrow(/title is longer/);
    expect(() => parseFragment(fragment("type: fix\ntitle: T", "b".repeat(601)), "x.md")).toThrow(/body is longer/);
    expect(() => parseFragment(fragment("type: fix\ntitle: T", "See [this](javascript:alert(1))"), "x.md")).toThrow(/site path or https/);
  });
});

describe("validateChangelog", () => {
  const release = (version: string, date: string) => ({ version, date, entries: [entry] });

  it("accepts newest-first releases and drops nothing", () => {
    const value = { schemaVersion: 1, releases: [release("0.2.0", "2026-09-01"), release("0.1.2", "2026-09-01"), release("0.1.0", "2026-06-01")] };
    expect(validateChangelog(value)).toEqual(value);
    expect(latestRelease(validateChangelog(value))).toEqual({ version: "0.2.0", date: "2026-09-01" });
    expect(latestRelease({ schemaVersion: 1, releases: [] })).toBeUndefined();
  });

  it("rejects bad shapes, order, and dates", () => {
    expect(() => validateChangelog(null)).toThrow(/must be an object/);
    expect(() => validateChangelog({ schemaVersion: 2, releases: [] })).toThrow(/schemaVersion/);
    expect(() => validateChangelog({ schemaVersion: 1 })).toThrow(/releases must be an array/);
    expect(() => validateChangelog({ schemaVersion: 1, releases: [null] })).toThrow(/release 0: must be an object/);
    expect(() => validateChangelog({ schemaVersion: 1, releases: [release("1.0", "2026-01-01")] })).toThrow(/SemVer/);
    expect(() => validateChangelog({ schemaVersion: 1, releases: [release("1.0.0", "2026-02-30")] })).toThrow(/date/);
    expect(() => validateChangelog({ schemaVersion: 1, releases: [{ version: "1.0.0", date: "2026-01-01", entries: [] }] })).toThrow(/at least one entry/);
    expect(() => validateChangelog({ schemaVersion: 1, releases: [{ version: "1.0.0", date: "2026-01-01", entries: ["x"] }] })).toThrow(/entry must be an object/);
    expect(() => validateChangelog({ schemaVersion: 1, releases: [release("0.1.0", "2026-01-01"), release("0.2.0", "2025-01-01")] })).toThrow(/must be newer/);
    expect(() => validateChangelog({ schemaVersion: 1, releases: [release("0.2.0", "2025-01-01"), release("0.1.0", "2026-01-01")] })).toThrow(/dated before/);
  });
});

describe("versions and helpers", () => {
  it("orders versions, including prereleases", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.2")).toBe(-1);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.1")).toBe(1);
    // SemVer 11.4: numeric identifiers compare as numbers, before text, and more identifiers win a tie.
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    expect(() => compareVersions("1.0", "1.0.0")).toThrow(/1\.0/);
  });

  it("picks the bump the largest change calls for", () => {
    expect(releaseBump([{ type: "fix" }, { type: "improvement" }])).toBe("patch");
    expect(releaseBump([{ type: "fix" }, { type: "feature" }])).toBe("minor");
    expect(releaseBump([{ type: "feature" }, { type: "breaking" }])).toBe("major");
  });

  it("sorts entries by type, then pull request", () => {
    const sorted = sortEntries([{ type: "fix", pr: 2 }, { type: "feature" }, { type: "feature", pr: 9 }, { type: "fix", pr: 1 }]);
    expect(sorted).toEqual([{ type: "feature", pr: 9 }, { type: "feature" }, { type: "fix", pr: 1 }, { type: "fix", pr: 2 }]);
  });

  it("builds anchors and checks dates", () => {
    expect(releaseAnchor("0.2.0")).toBe("v0-2-0");
    expect(releaseAnchor("1.0.0-rc.1")).toBe("v1-0-0-rc-1");
    expect(isValidDate("2026-09-21")).toBe(true);
    expect(isValidDate("2026-9-21")).toBe(false);
    expect(isValidDate(20260921)).toBe(false);
  });

  it("tokenizes code, bold and links, leaving everything else as text", () => {
    expect(inlineTokens("Choose **Done** or *cancel* **")).toEqual([
      { kind: "text", text: "Choose " }, { kind: "strong", text: "Done" }, { kind: "text", text: " or *cancel* **" },
    ]);
    expect(inlineTokens("Use `Ctrl+S` or read [the guide](/guides) <b>now</b>.")).toEqual([
      { kind: "text", text: "Use " }, { kind: "code", text: "Ctrl+S" }, { kind: "text", text: " or read " },
      { kind: "link", text: "the guide", href: "/guides" }, { kind: "text", text: " <b>now</b>." },
    ]);
    expect(inlineTokens("[docs](https://example.com)")).toEqual([{ kind: "link", text: "docs", href: "https://example.com" }]);
    expect(() => inlineTokens("[x](//evil.test)")).toThrow(/site path or https/);
    expect(() => inlineTokens("[x](http://a.test)")).toThrow(/site path or https/);
  });
});
