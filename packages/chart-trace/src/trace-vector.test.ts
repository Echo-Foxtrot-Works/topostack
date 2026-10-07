import { describe, expect, it } from "vitest";
import { ring, syntheticChart } from "./fixtures/synthetic-chart.ts";
import { traceVectorChart } from "./trace-vector.ts";

const mapArea = { left: 100, top: 100, right: 1100, bottom: 900 };

describe("traceVectorChart", () => {
  it("recovers every level of a fragmented GIS chart with two contours labelled", () => {
    const chart = syntheticChart({ levels: [5, 10, 15, 20, 25], fractions: [0.84, 0.67, 0.5, 0.33, 0.16], labelled: [1, 3], indexEvery: 2 });
    const trace = traceVectorChart(chart.page, { contourStyles: chart.contourStyles, shorelineStyles: [chart.shorelineStyle], labels: "depth", mapArea });
    expect(trace.interval).toBe(10);
    // The labels alone suggest a 10 ft interval; the maker can correct it.
    const corrected = traceVectorChart(chart.page, { contourStyles: chart.contourStyles, shorelineStyles: [chart.shorelineStyle], labels: "depth", interval: 5, mapArea });
    expect(corrected.contours).toHaveLength(5);
    expect(corrected.contours.every((contour) => contour.closed)).toBe(true);
    // Each traced contour sits where its level was drawn.
    for (const contour of corrected.contours) {
      const index = chart.levels.indexOf(contour.value);
      const [x, y] = ring([0.84, 0.67, 0.5, 0.33, 0.16][index]!)[0]!;
      expect(contour.points.some(([px, py]) => Math.hypot(px - x, py - y) < 1)).toBe(true);
    }
    expect(corrected.diagnostics).toMatchObject({ labels: 4, labelled: 2, inferred: 3, unresolved: 0, labelDisagreements: 0, contradictoryRegions: 0 });
    expect(corrected.diagnostics.coverage).toBe(1);
    expect(corrected.shoreline).toHaveLength(1);
  });

  it("reads a reservoir chart labelled in elevations against its pool level", () => {
    const chart = syntheticChart({ levels: [320, 315, 310, 305], fractions: [0.9, 0.7, 0.5, 0.3], labelled: [1, 2], seed: 4 });
    const trace = traceVectorChart(chart.page, { contourStyles: chart.contourStyles, shorelineStyles: [chart.shorelineStyle], labels: "elevation", surface: 322, mapArea });
    expect(trace.interval).toBe(5);
    expect(trace.contours.map((contour) => contour.value).sort()).toEqual([305, 310, 315, 320]);
  });

  it("reads legend and grid text only when no map area excludes it, and needs its inputs", () => {
    const chart = syntheticChart({ levels: [5, 10], fractions: [0.7, 0.35], labelled: [0, 1] });
    const everywhere = traceVectorChart(chart.page, { contourStyles: chart.contourStyles, labels: "depth" });
    expect(everywhere.diagnostics.labels).toBe(5);
    expect(() => traceVectorChart(chart.page, { contourStyles: [], labels: "depth" })).toThrow(/contour style/);
    expect(() => traceVectorChart(chart.page, { contourStyles: chart.contourStyles, labels: "elevation" })).toThrow(/surface elevation/);
    const unlabelled = syntheticChart({ levels: [5, 10], fractions: [0.7, 0.35], labelled: [] });
    expect(() => traceVectorChart(unlabelled.page, { contourStyles: chart.contourStyles, labels: "depth" })).toThrow(/contour interval/);
  });
  it("keeps only labels on the chart's ladder once the interval is known", () => {
    const chart = syntheticChart({ levels: [5, 10], fractions: [0.7, 0.35], labelled: [0, 1] });
    // An OCR misread lying on the outer contour.
    const [x, y] = ring(0.7)[120]!;
    chart.page.texts.push({ text: "7", x, y, angle: 0, size: 9, width: 7 });
    const trace = traceVectorChart(chart.page, { contourStyles: chart.contourStyles, labels: "depth", interval: 5, mapArea });
    expect(trace.diagnostics.labels).toBe(4);
    expect(trace.diagnostics.labelDisagreements).toBe(0);
    expect(trace.contours.map((contour) => contour.value).sort((a, b) => a - b)).toEqual([5, 10]);
  });

  it("stops after chaining when only the geometry is wanted, needing no labels", () => {
    const chart = syntheticChart({ levels: [5, 10], fractions: [0.7, 0.35], labelled: [] });
    const trace = traceVectorChart(chart.page, { contourStyles: chart.contourStyles, labels: "depth", mapArea, geometryOnly: true });
    expect(trace.selectionContours).toHaveLength(2);
    expect(trace.selectionContours!.every((contour) => contour.closed)).toBe(true);
    expect(trace).toMatchObject({ contours: [], shoreline: [], interval: 0 });
    expect(trace.diagnostics).toMatchObject({ chains: 2, labels: 0, unresolved: 2 });
  });

  it("drops long ruler-straight lines in contour ink only when asked", () => {
    const chart = syntheticChart({ levels: [5, 10], fractions: [0.7, 0.35], labelled: [] });
    const line = (points: [number, number][]) => chart.page.paths.push({ stroke: "#9c9c9c", lineWidth: 0.48, dashed: false, points, closed: false });
    line([[150, 130], [600, 133], [1050, 136]]); // a section line
    line([[150, 870], [175, 870]]); // too short to call straight
    line([[150, 160], [600, 200], [1050, 160]]); // bows 40 units over 900
    const chains = (dropStraightLines: boolean) => traceVectorChart(chart.page, { contourStyles: chart.contourStyles, labels: "depth", mapArea, geometryOnly: true, dropStraightLines }).selectionContours!;
    expect(chains(false)).toHaveLength(5);
    const kept = chains(true);
    expect(kept).toHaveLength(4);
    expect(kept.some((chain) => chain.points.some(([, y]) => y === 133))).toBe(false);
  });
});
