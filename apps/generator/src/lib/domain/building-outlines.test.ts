import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, polylineLength, ringBounds, type Point2D } from "@topostack/core";
import { buildingMarkings, buildingSeams, type BuildingFragment } from "./building-outlines";

const point = (x: number, y: number) => ({ x, y });
const rect = (x: number, y: number, w: number, h: number) => [point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h), point(x, y)];
const project = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100, minimumFeatureMm: 2 };
const fragment = (outer: Point2D[], holes: Point2D[][] = []): BuildingFragment => ({ polygon: { outer, holes }, spans: [] });

describe("building engravings", () => {
  it("retains one copy of a shared wall even with different segmentation", async () => {
    const first = rect(0, 0, 10, 10);
    const second = rect(10, 0, 10, 10);
    second.splice(4, 0, point(10, 5));
    const lines = await buildingMarkings([fragment(first), fragment(second)], project);
    expect(lines.reduce((length, line) => length + polylineLength(line.points), 0)).toBeCloseTo(70);
    const shared = lines.flatMap(line => line.points.slice(1).map((b, i) => [line.points[i]!, b] as const))
      .filter(([a, b]) => a.x === 10 && b.x === 10);
    expect(shared.reduce((length, [a, b]) => length + Math.abs(a.y - b.y), 0)).toBeCloseTo(10);
  });

  it("measures rotated footprints and courtyards at their physical minimum", async () => {
    const rotate = (ring: Point2D[]) => ring.map(({ x, y }) => point((x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2));
    const narrow = rect(0, 0, 10, 0.2);
    const wide = rotate(rect(-12, -1, 10, 2));
    const lines = await buildingMarkings([fragment(narrow), fragment(rotate(narrow)), fragment(wide),
      fragment(rect(2, 2, 30, 30), [rotate(narrow).map(p => point(p.x + 10, p.y + 10)), rect(21, 21, 3, 3)])], project);
    expect(lines.map(line => line.id)).toEqual(["building-2-0", "building-3-0", "building-3-2"]);
  });

  it("rejoins a buffered courtyard crossing two tiles without drawing a seam", async () => {
    const left = [[-10, -10], [2, -10], [2, -4], [-4, -4], [-4, 4], [2, 4], [2, 10], [-10, 10], [-10, -10]].map(([x, y]) => point(x!, y!));
    const right = left.map(({ x, y }) => point(-x, y));
    const pieces = [left, right].map((outer, i) => {
      const local = outer.map(({ x, y }) => point(i ? x : x + 256, y + 100));
      return { ...fragment(outer), spans: buildingSeams([local], ringBounds(local), { x: i, worldX: i, y: 0, z: 12 }, 256) };
    });
    const lines = await buildingMarkings(pieces, project);
    expect(lines.map(line => polylineLength(line.points)).sort((a, b) => a - b)).toEqual([32, 80]);
  });

  it("clips boundary strokes to a circular crop without adding a wall on its edge", async () => {
    const lines = await buildingMarkings([fragment(rect(-49, -49, 5, 5)), fragment(rect(48, -2, 6, 4))], { ...project, cropShape: "circle" });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) for (const [i, b] of line.points.slice(1).entries()) {
      const a = line.points[i]!;
      expect((a.x === 48 && b.x === 48) || (a.y === b.y && Math.abs(a.y) === 2)).toBe(true);
      expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(50.000001);
    }
  });
});
