import { describe, expect, it } from "vitest";
import type { MarkingFeature } from "@topostack/core";
import { classifyRail, stationPassages, type RailContext } from "$lib/domain/covered-rail";

const point = (x: number, y = 0) => ({ x, y });
const points = (...xs: number[]) => xs.map(x => point(x));
const part = (id: string, xs: number[]): MarkingFeature => ({
  id, label: "Local", kind: "road", transportationClass: "covered-rail", operation: "engrave", points: points(...xs),
});

describe("covered railway passages", () => {
  it("honors explicit cover independently of any station and keeps service and underground exclusions", () => {
    expect(classifyRail({ covered: "yes" })).toBe("covered-rail");
    expect(classifyRail({ is_tunnel: true, is_covered: true })).toBe("covered-rail");
    expect(classifyRail({ tunnel: "building_passage" })).toBe("covered-rail");
    expect(classifyRail({ is_tunnel: true })).toBe("rail-tunnel");
    expect(classifyRail({ is_tunnel: true, covered: "no" })).toBeUndefined();
    expect(classifyRail({ is_tunnel: true, is_covered: "no" })).toBeUndefined();
    expect(classifyRail({ is_tunnel: true, is_covered: false })).toBeUndefined();
    expect(classifyRail({ is_tunnel: true, level: "-2" })).toBeUndefined();
    expect(classifyRail({ is_tunnel: true, kind_detail: "subway" })).toBeUndefined();
    expect(classifyRail({ covered: "yes", location: "underground" })).toBeUndefined();
    expect(classifyRail({ covered: "yes", service: "siding" })).toBeUndefined();
    expect(classifyRail({ is_bridge: true })).toBe("rail");
  });

  it("joins station tunnel tile pieces before testing the real portals in ground metres", () => {
    const west: RailContext = { tunnels: [part("west", [-112, 0])], surface: [{ label: "Local", points: points(-140, -112) }], stations: [] };
    const east: RailContext = { tunnels: [part("east", [0, 112])], surface: [{ label: "Local", points: points(112, 180) }], stations: [point(0, 120)] };
    expect(stationPassages([west, east], 1).map(f => f.points)).toEqual([points(-112, 0, 112)]);
    expect(stationPassages([west, { ...east, stations: [point(0, 161)] }], 1)).toEqual([]);
    expect(stationPassages([west, { ...east, surface: [] }], 1)).toEqual([]);
    expect(stationPassages([west, { ...east, surface: [{ label: "Metro", points: points(112, 180) }] }], 1)).toEqual([]);
    expect(stationPassages([west, { ...east, stations: [point(0)] }], 0.25)).toEqual([]);
    expect(stationPassages([west, { ...east, stations: [] }], 1)).toEqual([]);
  });

  it("requires a plausible, unambiguous continuation for unnamed tunnels", () => {
    const context = (length: number, distance: number): RailContext => ({
      tunnels: [{ ...part("passage", [0, length]), label: undefined }], stations: [point(length / 2, distance)],
      surface: [{ points: points(-50, 0) }, { points: points(length, length + 50) }],
    });
    expect(stationPassages([context(600, 160)], 1)).toHaveLength(1);
    expect(stationPassages([context(600.01, 160)], 1)).toEqual([]);
    expect(stationPassages([context(600, 160.01)], 1)).toEqual([]);
    const rail = context(300, 0);
    const crossing = { points: [point(0, -50), point(0), point(0, 50)] };
    expect(stationPassages([{ ...rail, surface: [crossing, rail.surface[1]!] }], 1)).toEqual([]);
    expect(stationPassages([{ ...rail, surface: rail.surface.map((line, i) => ({ ...line, label: i ? "East" : "West" })) }], 1)).toEqual([]);
    expect(stationPassages([{ ...rail, surface: [...rail.surface, { points: [point(0), point(-50, 20)] }] }], 1)).toEqual([]);
    expect(stationPassages([{ ...rail, surface: [rail.surface[0]!, { points: [point(300, 1), point(350, 1)] }] }], 1)).toEqual([]);
  });
});
