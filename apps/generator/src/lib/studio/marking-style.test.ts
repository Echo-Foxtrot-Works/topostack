import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, landStroke } from "@topostack/core";
import { markingColor, markingDash, markingStyleKey, markingWidth } from "$lib/studio/marking-style";

const style = DEFAULT_PROJECT.lineStyle;

describe("marking style", () => {
  it("classifies score operations before road classes and kinds", () => {
    expect(markingStyleKey({ operation: "score", kind: "road", transportationClass: "major-road" })).toBe("score");
    expect(markingStyleKey({ operation: "engrave", kind: "road", transportationClass: "local-road" })).toBe("local-road");
    expect(markingStyleKey({ operation: "engrave", kind: "boundary" })).toBe("boundary");
    expect(markingStyleKey({ operation: "engrave", kind: "label" as never })).toBe("engrave");
    expect(markingColor({ operation: "engrave", kind: "grid" })).toBe("#34404b");
  });

  it("uses the line style for widths and dashes", () => {
    expect(markingWidth({ kind: "trail", transportationClass: "trail" }, style)).toBe(style.trailMm);
    expect(markingWidth({ kind: "water" }, style)).toBe(style.waterMm);
    expect(markingDash({ kind: "road", transportationClass: "major-road" }, style)).toBeUndefined();
    expect(markingDash({ kind: "boundary" }, style)).toBe(`${Math.max(style.boundaryMm * 8, 1.6)} ${Math.max(style.boundaryMm * 5, 1)}`);
    expect(markingDash({ kind: "trail", transportationClass: "trail" }, { ...style, trailPattern: "solid" })).toBeUndefined();
    expect(markingDash({ kind: "trail", transportationClass: "trail" }, { ...style, trailPattern: "dotted" })).toBe(`0.01 ${Math.max(style.trailMm * 4, 0.7)}`);
  });

  it("draws public land boundaries with their class's stroke, as the export does", () => {
    expect(markingStyleKey({ operation: "engrave", kind: "land", landClass: "blm" })).toBe("land");
    expect(markingWidth({ kind: "land", landClass: "national-park" }, style)).toBe(landStroke("national-park", style).widthMm);
    expect(markingDash({ kind: "land", landClass: "national-park" }, style)).toBeUndefined();
    expect(markingDash({ kind: "land", landClass: "blm" }, style)).toBe(landStroke("blm", style).dash!.join(" "));
  });
});
