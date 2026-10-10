import { describe, expect, it } from "vitest";
import { labelFootprint } from "../annotate/label-placement.js";
import { ringFitsInsidePolygon } from "../primitives/geometry2d.js";
import { clipPolygons } from "../primitives/offset.js";
import { airspaceAltitudeText, annotateAirspace } from "./airspace-annotations.js";
import { airspaceLayers } from "../export/airspace.js";
import { build, core, shelf, project, square, CEILING, SHELF } from "../test-support/airspace.js";

describe("airspace chart engraving", () => {
  it("keeps chart altitude references explicit", () => {
    expect(airspaceAltitudeText({ ref: "sfc", ft: 0 })).toBe("SFC");
    expect(airspaceAltitudeText({ ref: "msl", ft: 6000 })).toBe("6000 FT MSL");
    expect(airspaceAltitudeText({ ref: "agl", ft: 500 })).toBe("500 FT AGL");
    expect(airspaceAltitudeText({ ref: "fl", ft: 18000 })).toBe("FL180");
    expect(airspaceAltitudeText({ ref: "unlimited" })).toBe("UNLIMITED");
  });

  it("retains original limits when a cap trims a sector and engraves the distinction", () => {
    const stack = build({ form: "plates", ceilingCapFt: CEILING - 500 }, [core, shelf]).airspaceStack!;
    expect(stack.sectors!.find((sector) => sector.id === shelf.id)).toMatchObject({ floor: { ref: "msl", ft: SHELF }, ceiling: { ref: "msl", ft: CEILING }, ceilingCapped: true });
    const labels = stack.levels.flatMap((level) => level.pieces.flatMap((piece) => piece.markings ?? [])).flatMap((mark) => mark.label ?? []);
    expect(labels).toContain("SHELF");
    expect(labels).toContain(`${CEILING} FT MSL`);
    expect(labels).toContain(`MODEL CAP ${CEILING - 500} FT MSL`);
    expect(labels).toContain("NOT FOR NAVIGATION");
  });

  it("fits label ink inside cut material and clear of rod locators and frost", () => {
    const stack = build({ form: "plates" }, [core, shelf]).airspaceStack!;
    let count = 0;
    for (const level of stack.levels) for (const piece of level.pieces) for (const mark of piece.markings ?? []) {
      const footprint = labelFootprint(mark.label!, mark.points[0]!, mark.labelRotationRad ?? 0, mark.textStyle!);
      expect(piece.polygons.some((polygon) => ringFitsInsidePolygon(footprint, polygon, 0))).toBe(true);
      for (const locator of piece.locators ?? []) expect(clipPolygons([{ outer: footprint, holes: [] }], [{ outer: locator, holes: [] }], "intersection")).toEqual([]);
      if (piece.frost?.length) expect(clipPolygons([{ outer: footprint, holes: [] }], piece.frost, "intersection")).toEqual([]);
      count += 1;
    }
    expect(count).toBeGreaterThan(4);
    expect(airspaceLayers(stack).flatMap(({ layer }) => layer.markings).filter((mark) => mark.label)).toHaveLength(count);
  });

  it("turns the navigation notice to fit a narrow lowest piece", () => {
    const stack = build({ form: "tiers" }, [core]).airspaceStack!;
    const piece = { id: "A1-1", tint: "blue" as const, sectorIds: [], polygons: [{ outer: square(0, -55, 8, 55), holes: [] }] };
    stack.levels = [{ ...stack.levels[0]!, pieces: [piece] }];
    stack.cycle = "2026-10-01";
    annotateAirspace(stack, [], project, []);
    const markings = stack.levels[0]!.pieces[0]!.markings!;
    expect(markings.some((mark) => mark.label === "FAA 2026-10-01")).toBe(true);
    expect(markings.every((mark) => mark.labelRotationRad === Math.PI / 2)).toBe(true);
    for (const mark of markings) expect(ringFitsInsidePolygon(labelFootprint(mark.label!, mark.points[0]!, mark.labelRotationRad!, mark.textStyle!), piece.polygons[0]!, 0)).toBe(true);
  });

  it("engraves coincident same-class sector edges once", () => {
    const geometry = build({ form: "tiers" }, [core, { ...core, id: "other-core" }]);
    for (const level of geometry.airspaceStack!.levels) for (const piece of level.pieces) {
      const segments = (piece.edges ?? []).flatMap((edge) => edge.points.slice(1).map((point, index) => [edge.points[index]!, point].map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).sort().join(";")));
      expect(new Set(segments).size).toBe(segments.length);
    }
  });

  it("does not repeat hidden labels through a solid stack", () => {
    const stack = build({ form: "volumes" }, [core]).airspaceStack!;
    expect(stack.levels.flatMap((level) => level.pieces.flatMap((piece) => piece.markings ?? [])).filter((mark) => mark.label === core.name)).toHaveLength(1);
  });
});
