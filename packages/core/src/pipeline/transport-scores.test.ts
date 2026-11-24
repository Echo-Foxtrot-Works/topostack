import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type MarkingFeature, type Point2D } from "../types.js";
import { generateGeometry } from "./generate.js";
import { transportScorePaths } from "./transport-scores.js";
import { uniqueRoadCenterlines } from "./road-junctions.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { svgToLightBurn } from "../export/lightburn.js";
import { parsePathPoints, realSource } from "../test-support/sources.js";
import { distanceToSegment, pointAt } from "../primitives/geometry2d.js";

const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, showRail: true, showEngravingContours: false, showNorthArrow: false, showScaleBar: false };
const p = (x: number, y: number): Point2D => ({ x, y });
function road(id: string, points: Point2D[], tags: Partial<MarkingFeature> = {}): MarkingFeature {
  return { id, kind: "road", operation: "engrave", transportationClass: "local-road", points, ...tags };
}

describe("score-only transport geometry", () => {
  it("rounds free bends within 0.30 mm and retains junctions, nearby crossings and open ends", () => {
    const street = road("street", [p(-20, -8), p(-12, 0), p(0, 0), p(7, 5), p(18, 5)]);
    const side = road("side", [p(0, 0), p(0, 10)]);
    // This crossing has no shared source vertex on either line.
    const crosses = road("crosses", [p(6.9, -2), p(6.9, 10)]);
    const paths = transportScorePaths([street, side, crosses], project);
    const rounded = paths.get(street)![0]!;
    expect(rounded[0]).toEqual(street.points[0]);
    expect(rounded.at(-1)).toEqual(street.points.at(-1));
    expect(rounded).toContainEqual(p(0, 0));
    expect(rounded).toContainEqual(p(7, 5));
    const corner = street.points[1]!;
    const shift = Math.min(...rounded.slice(1).map((v, i) => distanceToSegment(corner, rounded[i]!, v)));
    expect(shift).toBeGreaterThan(0.2);
    expect(shift).toBeLessThanOrEqual(0.3000001);
    expect(rounded.length).toBeGreaterThan(street.points.length + 2);
    expect(street.points).toHaveLength(5);
  });

  it("keeps the crossing and both underpass ends fixed while rounding the rest of a bridge", () => {
    const upper = road("bridge", [p(-12, 0), p(0, 0), p(5, 2), p(12, 2)], { isBridge: true });
    const lower = road("lower", [p(1, -10), p(1, 10), p(8, 14)]);
    const paths = transportScorePaths([lower, upper], project);
    const [before, after] = paths.get(lower)!;
    const halfGap = 0.6 * Math.hypot(1, 0.4);
    expect(before!.at(-1)!.y).toBeCloseTo(0.4 - halfGap, 9);
    expect(after![0]!.y).toBeCloseTo(0.4 + halfGap, 9);
    const deck = paths.get(upper)![0]!;
    expect(Math.min(...deck.slice(1).map((v, i) => distanceToSegment(p(1, 0.4), deck[i]!, v)))).toBeLessThan(1e-9);
    expect(deck).not.toContainEqual(p(5, 2));
  });

  it("retains a whole diagonal through a distant T so SVG rounding cannot open the junction", () => {
    const a = p(-9.1284, -7.5126), b = p(10.8492, 4.1352);
    const main = road("diagonal", [p(-13, -3), a, b, p(15, -2), p(20, -2)]);
    const side = road("branch", [pointAt(a, b, 0.5), p(2, -9)]);
    const mainPath = transportScorePaths([main, side], project).get(main)![0]!;
    expect(mainPath[mainPath.indexOf(a) + 1]).toBe(b);
    expect(mainPath).not.toContainEqual(p(15, -2));
  });

  it("scores a shared junction approach once and keeps the named branches and distinct levels", () => {
    const through = road("A", [p(-10, 0), p(0, 0), p(8, 4)], { transportationClass: "major-road" });
    const branch = road("B", [p(2, -8), p(0, 0), p(-10, 0)]);
    const elevated = road("C", branch.points, { transportLevel: 2, isBridge: true });
    const paths = transportScorePaths([branch, through, elevated], project);
    expect(paths.get(branch)).toEqual([[p(2, -8), p(0, 0)]]);
    expect(paths.has(through)).toBe(false);
    expect(paths.has(elevated)).toBe(false);
    const outlined = transportScorePaths([branch, through], { ...project, lineStyle: { ...project.lineStyle, roadStyle: "outlined" } });
    expect(outlined.get(branch)).toHaveLength(1);
    expect(outlined.get(branch)![0]![0]).toEqual(p(2, -8));
    expect(outlined.get(branch)!.flat().every(v => v.x >= 0)).toBe(true);
  });

  it("cuts only the lower path, including at a shared interior vertex, with actual machine moves", () => {
    const lower = road("lower", [p(-20, 0), p(0, 0), p(20, 0)]);
    const bridge = road("upper", [p(0, -20), p(0, 0), p(0, 20)], { isBridge: true, transportLevel: 1 });
    const source = { ...realSource(project), markings: [lower, bridge] };
    const ir = generateGeometry(project, source);
    const runs = ir.layers.flatMap(l => l.markings).filter(m => m.id.startsWith("lower-"));
    expect(runs).toHaveLength(2);
    expect(runs[0]!.points.at(-1)!.x).toBeCloseTo(-0.6);
    expect(runs[1]!.points[0]!.x).toBeCloseTo(0.6);
    expect(ir.layers.flatMap(l => l.markings).filter(m => m.id.startsWith("upper-"))).toHaveLength(1);
    const svg = engravingToSvg(ir, project);
    const group = svg.match(/<g id="ENGRAVE-local-roads"[^>]*>([\s\S]*?)<\/g>/)![1]!;
    expect(group).not.toMatch(/fill="(?!none)/);
    const machine = svgToLightBurn(`<svg width="100mm" height="100mm" viewBox="-50 -50 100 100"><g data-operation="ENGRAVE">${group}</g></svg>`)!;
    expect(machine.match(/<Shape Type="Path"/g)).toHaveLength(3);
    expect(machine).not.toContain('type="Scan"');
    const stacked = generateGeometry({ ...project, outputMode: "stack" }, source);
    const lowerRuns = stacked.layers.flatMap(l => l.markings.filter(m => m.id.startsWith("lower-")));
    expect(lowerRuns.length).toBeGreaterThan(1);
    expect(lowerRuns.every(m => m.points.every(v => v.x <= -0.5999) || m.points.every(v => v.x >= 0.5999))).toBe(true);
  });

  it("preserves at-grade, same-deck, tangential and endpoint connections", () => {
    const upper = road("upper", [p(0, -20), p(0, 20)], { isBridge: true, transportLevel: 1 });
    const atGrade = road("surface", [p(0, -20), p(0, 20)]);
    const crosses = road("cross", [p(-10, 0), p(10, 0)]);
    expect(transportScorePaths([atGrade, crosses], project).has(crosses)).toBe(false);
    for (const lower of [
      { ...crosses, isBridge: true as const, transportLevel: 1 },
      road("joins", [p(-10, 20), p(10, 20)]),
      road("approach", [p(0, -25), p(0, -20)]),
      road("touches", [p(-5, -5), p(0, 0), p(-5, 5)]),
    ]) expect(transportScorePaths([upper, lower], project).has(lower)).toBe(false);
  });

  it("joins both outline edges across a bent bridge approach and keeps unrelated grades separate", () => {
    const config = { ...project, lineStyle: { ...project.lineStyle, roadStyle: "outlined" as const } };
    const approach = road("approach", [p(-12, 0), p(0, 0)], { transportationClass: "major-road", label: "Main" });
    const deck = road("deck", [p(0, 0), p(12, 3)], { transportationClass: "major-road", label: "Main", isBridge: true });
    const paths = transportScorePaths([approach, deck], config);
    expect(paths.get(approach)!.map(edge => edge.at(-1))).toEqual(paths.get(deck)!.map(edge => edge[0]));
    const other = { ...deck, label: "Other" };
    const distinct = transportScorePaths([approach, other], config);
    expect(distinct.get(approach)!.map(edge => edge.at(-1))).not.toEqual(distinct.get(other)!.map(edge => edge[0]));
  });

  it("clears both edges of an outlined underpass for the full deck width", () => {
    const config = { ...project, lineStyle: { ...project.lineStyle, roadStyle: "outlined" as const, majorRoadSpacingMm: 2 } };
    const lower = road("lower", [p(-10, 0), p(10, 0)], { transportationClass: "major-road" });
    const upper = road("upper", [p(0, -10), p(0, 10)], { transportationClass: "major-road", isBridge: true });
    const paths = transportScorePaths([lower, upper], config);
    expect(paths.get(upper)).toHaveLength(2);
    expect(paths.get(lower)).toHaveLength(4);
    expect(paths.get(lower)!.flat().every(v => Math.abs(v.x) >= 1.5999)).toBe(true);
  });

  it("spaces ties along the whole track and leaves switches, parallel tracks and covered rail clear", () => {
    const rail = road("track", [p(0, 0), p(3, 0), p(3, 9)], { transportationClass: "rail" });
    const paths = transportScorePaths([rail], project).get(rail)!;
    expect(paths.slice(1)).toHaveLength(3);
    expect(paths[1]![0]!.x).toBeCloseTo(1.9);
    expect(paths[2]![0]!.y).toBeCloseTo(2.7);
    expect(Math.abs(paths[2]![0]!.x - paths[2]![1]!.x)).toBeCloseTo(1.2);
    const track = paths[0]!;
    expect(track).not.toContainEqual(rail.points[1]);
    for (const [a, b] of paths.slice(1)) {
      const center = pointAt(a!, b!, 0.5);
      expect(track.slice(1).some((v, i) => distanceToSegment(center, track[i]!, v) < 1e-9 &&
        Math.abs((v.x - track[i]!.x) * (b!.x - a!.x) + (v.y - track[i]!.y) * (b!.y - a!.y)) < 1e-9)).toBe(true);
    }
    const parallel = road("adjacent", [p(3.75, 0), p(3.75, 10)], { transportationClass: "rail" });
    const crowded = transportScorePaths([rail, parallel], project);
    expect(crowded.get(rail)!.slice(1)).toEqual([paths[1]]);
    expect(crowded.get(parallel)).toBeUndefined();
    const straight = road("straight", [p(0, -10), p(0, 10)], { transportationClass: "rail" });
    const adjacent = { ...straight, id: "adjacent", points: [p(1.2, -10), p(1.2, 10)] };
    const closeTracks = transportScorePaths([straight, adjacent], project);
    expect(closeTracks.has(straight)).toBe(false);
    expect(closeTracks.has(adjacent)).toBe(false);
    const crossing = road("street", [p(-5, 2.7), p(8, 2.7)]);
    expect(transportScorePaths([rail, crossing], project).get(rail)).not.toContainEqual(paths[2]);
    const covered = { ...rail, transportationClass: "covered-rail" as const };
    expect(transportScorePaths([covered], project).get(covered)!.flat().every(v => v.x === 3 || v.y === 0)).toBe(true);
  });
});

it("preserves the direction and owners of separated intervals on a shared road", () => {
  const first = road("island", [p(2, 2), p(4, 4)]);
  const second = road("second island", [p(6, 6), p(7, 7)]);
  const reverse = road("reversed", [p(10, 10), p(0, 0)]);
  expect(uniqueRoadCenterlines([first, second, reverse]).get(reverse)).toEqual([
    [p(10, 10), p(7, 7)], [p(6, 6), p(4, 4)], [p(2, 2), p(0, 0)],
  ]);
});

it("emits each interval just once across thousands of nested, coincident source legs", () => {
  const roads = Array.from({ length: 5000 }, (_, index) => {
    const length = 5000 - index;
    return road(String(index), [p(-length, 0), p(length, 0)]);
  });
  const owned = uniqueRoadCenterlines(roads);
  expect(owned.get(roads[0]!)?.[0]).toHaveLength(10_000);
  expect(roads.slice(1).every(road => owned.get(road)?.length === 0)).toBe(true);
});

it.each([0, 1])("scores the physical union of subdivided, overlapping roads on level %i", level => {
  const routes = [road("first", [p(-20, 0), p(20, 0)]),
    road("second", [p(30, 0), p(0, 0), p(-10, 0)], { transportLevel: level })];
  const ir = generateGeometry(project, { ...realSource(project), markings: routes });
  const markings = ir.layers.flatMap(l => l.markings).filter(m => m.kind === "road");
  const length = markings.flatMap(m => m.points.slice(1).map((b, i) => Math.hypot(b.x - m.points[i]!.x, b.y - m.points[i]!.y))).reduce((a, b) => a + b, 0);
  expect(length).toBeCloseTo(level ? 80 : 50);
  const svg = engravingToSvg(ir, project);
  const ids = new Set(markings.map(mark => mark.id));
  const paths = [...svg.matchAll(/<path id="([^"]+)" d="([^"]+)"/g)].filter(path => ids.has(path[1]!));
  expect(paths).toHaveLength(markings.length);
  let cutLength = 0;
  for (const path of paths) for (const subpath of path[2]!.split(/(?=M)/)) {
    const points = parsePathPoints(subpath);
    for (let i = 1; i < points.length; i++) cutLength += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  expect(cutLength).toBeCloseTo(level ? 80 : 50);
});
