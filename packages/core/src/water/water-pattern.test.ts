import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, waterPatternStrokes, type ProjectConfigV1 } from "../index.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { pointInRing, realSource } from "../test-support/sources.js";

describe("water fill patterns", () => {
  it("adds optional laser-ready vector patterns inside flat water areas", () => {
    const area = {
      outer: [{ x: -60, y: -35 }, { x: 60, y: -35 }, { x: 60, y: 35 }, { x: -60, y: 35 }, { x: -60, y: -35 }],
      holes: [[{ x: -12, y: -8 }, { x: -12, y: 8 }, { x: 12, y: 8 }, { x: 12, y: -8 }, { x: -12, y: -8 }]],
    };
    const source = { ...realSource(), waterPatternAreas: [area] };

    for (const waterFillPattern of ["lines", "ripples", "dots"] as const) {
      const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving", waterFillPattern };
      const result = generateGeometry(project, source);
      const strokes = waterPatternStrokes(waterFillPattern, result.waterPatternAreas, project.widthMm, project.heightMm, project.lineStyle.waterMm);
      const svg = engravingToSvg(result, project);

      expect(result.waterPatternAreas).toHaveLength(1);
      expect(strokes.length).toBeGreaterThan(0);
      expect(svg).toContain(`id="ENGRAVE-water-fill" data-water-pattern="${waterFillPattern}"`);
      expect(svg).toContain(`id="water-fill-${waterFillPattern}-1"`);
      expect(svg).not.toContain("<pattern");
      expect(svg).not.toContain("<clipPath");
    }

    const none = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, waterFillPattern: "none" as const };
    expect(engravingToSvg(generateGeometry(none, source), none)).not.toContain("ENGRAVE-water-fill");
    const hidden = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, showWater: false, waterFillPattern: "ripples" as const };
    expect(engravingToSvg(generateGeometry(hidden, source), hidden)).not.toContain("ENGRAVE-water-fill");
  });

  it("alternates the dot offset on every row regardless of accumulated rounding", () => {
    for (const [heightMm, strokeWidthMm] of [[150, 1], [400, 0.5], [200, 0.3]] as const) {
      const widthMm = 120;
      const dotSpacing = Math.max(2.5, strokeWidthMm * 8) * 1.35;
      const everywhere = { outer: [{ x: -61, y: -heightMm }, { x: 61, y: -heightMm }, { x: 61, y: heightMm }, { x: -61, y: heightMm }, { x: -61, y: -heightMm }], holes: [] };
      const rows = new Map<number, number>();
      for (const [dot] of waterPatternStrokes("dots", [everywhere], widthMm, heightMm, strokeWidthMm)) {
        const key = Math.round(dot!.y * 1e6);
        rows.set(key, Math.min(rows.get(key) ?? Infinity, dot!.x + 0.001));
      }
      const firstX = [...rows].sort(([left], [right]) => left - right).map(([, x]) => x);
      expect(firstX.length).toBeGreaterThan(10);
      firstX.forEach((x, row) => expect(x).toBeCloseTo(-widthMm / 2 + dotSpacing / 2 + (row % 2 === 0 ? dotSpacing / 2 : 0), 9));
    }
  });

  it("places water dots only inside fill areas and outside their holes", () => {
    const square = (cx: number, cy: number, half: number) => [{ x: cx - half, y: cy - half }, { x: cx + half, y: cy - half }, { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half }, { x: cx - half, y: cy - half }];
    const areas = [{ outer: square(-40, 0, 30), holes: [square(-40, 0, 10).reverse()] }, { outer: square(50, 20, 15), holes: [] }];
    const inside = ({ x, y }: { x: number; y: number }) => areas.some((area) => pointInRing({ x, y }, area.outer) && !area.holes.some((hole) => pointInRing({ x, y }, hole)));
    const dots = waterPatternStrokes("dots", areas, 200, 120, 0.3);
    const centers = dots.map(([left]) => ({ x: left!.x + 0.001, y: left!.y }));
    expect(centers.length).toBeGreaterThan(20);
    expect(centers.every(inside)).toBe(true);
    expect(centers.some(({ x, y }) => Math.abs(x + 40) < 10 && Math.abs(y) < 10)).toBe(false);
    expect(centers.some(({ x }) => x > 30)).toBe(true);
  });
});
