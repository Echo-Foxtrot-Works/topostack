import { describe, expect, it } from "vitest";
import { airspaceStackTint, DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, generateGeometry, parseProject, type AirspaceStackSettingsV1, type Polygon2D } from "../index.js";
import { clipPolygons } from "../primitives/offset.js";
import { signedArea } from "../primitives/geometry2d.js";
import { exportBlockReason } from "../export/export-policy.js";
import { projectFingerprint } from "./fingerprint.js";
import { circleRing, gridSource, scaledForLayers } from "../test-support/sources.js";
import { base, build, CEILING, core, FEET, inside, plain, project, SHELF, sheetsUp, shelf, square, stepM, t, tower, volume, withAirspace, zOf } from "../test-support/airspace.js";

describe("airspace stack settings", () => {
  it("round-trips through parseProject and rejects what cannot be built", () => {
    const settings = { ...DEFAULT_AIRSPACE_STACK, ceilingCapFt: 12_000 };
    expect(parseProject(JSON.parse(JSON.stringify({ ...DEFAULT_PROJECT, airspaceStack: settings }))).airspaceStack).toEqual(settings);
    expect(parseProject(JSON.parse(JSON.stringify(DEFAULT_PROJECT))).airspaceStack).toBeUndefined();
    const invalid = (patch: Record<string, unknown>) => () => parseProject({ ...DEFAULT_PROJECT, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, ...patch } });
    expect(invalid({ form: "cones" })).toThrow("form");
    expect(invalid({ tint: "amber" })).toThrow("chart tints or clear");
    const clearTiers = { ...DEFAULT_AIRSPACE_STACK, form: "tiers" as const, tint: "clear" as const };
    expect(parseProject(JSON.parse(JSON.stringify({ ...DEFAULT_PROJECT, airspaceStack: clearTiers }))).airspaceStack).toEqual(clearTiers);
    expect(invalid({ classes: { B: false, C: false, D: false, specialUse: false } })).toThrow("at least one");
    expect(invalid({ ceilingCapFt: 500 })).toThrow("ceiling cap");
    expect(invalid({ thicknessMm: 0.5 })).toThrow("acrylic thickness");
    expect(invalid({ thicknessMm: 12 })).toThrow("acrylic thickness");
    expect(invalid({ rod: { ...DEFAULT_AIRSPACE_STACK.rod, sizeMm: 20 } })).toThrow("rod size");
    expect(invalid({ rod: { ...DEFAULT_AIRSPACE_STACK.rod, joint: "welded" } })).toThrow("segments");
    expect(invalid({ rod: undefined })).toThrow("rod settings");
  });

  it("leaves existing fingerprints alone", () => {
    expect(projectFingerprint(DEFAULT_PROJECT)).toBe(projectFingerprint({ ...DEFAULT_PROJECT, airspaceStack: undefined }));
    expect(projectFingerprint({ ...DEFAULT_PROJECT, airspaceStack: DEFAULT_AIRSPACE_STACK })).not.toBe(projectFingerprint(DEFAULT_PROJECT));
  });

  it.each([0.5, 0.99, 10.01, 12, 25])("rejects inherited %s mm acrylic in imports and generation", (materialThicknessMm) => {
    const config = { ...project, materialThicknessMm, airspaceStack: DEFAULT_AIRSPACE_STACK };
    expect(() => parseProject(config)).toThrow("Airspace acrylic thickness");
    expect(() => generateGeometry(config, withAirspace([core, shelf]))).toThrow("Airspace acrylic thickness");
    // These wood thicknesses remain valid without airspace, or with separate acrylic stock.
    expect(parseProject({ ...config, airspaceStack: undefined }).materialThicknessMm).toBe(materialThicknessMm);
    expect(parseProject({ ...config, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, thicknessMm: 3 } }).airspaceStack?.thicknessMm).toBe(3);
  });

  it.each([1, 10])("builds inherited %s mm acrylic at the supported boundary", (materialThicknessMm) => {
    const config = parseProject({ ...project, materialThicknessMm, airspaceStack: DEFAULT_AIRSPACE_STACK });
    expect(generateGeometry(config, withAirspace([core, shelf])).airspaceStack?.thicknessMm).toBe(materialThicknessMm);
  });
});

describe("airspace plates", () => {
  const result = build({ form: "plates" }, [core, shelf]);
  const stack = result.airspaceStack!;

  it("puts a plate at each floor and ceiling, on the terrain's own vertical scale", () => {
    expect(stack.levels.map((level) => level.altitudeFt)).toEqual([SHELF, CEILING]);
    for (const level of stack.levels) expect(level.zMm).toBeCloseTo(zOf(level.altitudeFt), 6);
    expect(stack.mmPerMeter).toBeCloseTo(t / stepM, 9);
    expect(stack.topMm).toBeCloseTo(zOf(CEILING) + t, 6);
    expect(stack.ceilingCapFt).toBe(CEILING); // the highest Class B ceiling in the crop
  });

  it("cuts the cross-section, frosts the shelf that starts there, and engraves the core it passes", () => {
    const [plate] = stack.levels[0]!.pieces;
    expect(stack.levels[0]!.pieces).toHaveLength(1);
    expect(plate!.tint).toBe("clear");
    expect(inside({ x: 50, y: 0 }, plate!.polygons)).toBe(true); // core passes through
    expect(inside({ x: 0, y: 50 }, plate!.polygons)).toBe(true); // shelf starts here
    expect(inside({ x: 0, y: 50 }, plate!.frost!)).toBe(true);
    expect(inside({ x: 50, y: 0 }, plate!.frost!)).toBe(false);
    expect(plate!.edges!.length).toBeGreaterThan(0);
    expect(plate!.edges!.every((edge) => edge.aviationClass === "class-b")).toBe(true);
    expect(new Set(plate!.sectorIds)).toEqual(new Set(["core", "shelf"]));
  });

  it("leaves no slot where the shelf misses the core", () => {
    for (const level of stack.levels) {
      for (const entry of level.pieces) for (const polygon of entry.polygons) {
        // Any hole left is the hill rising through, west of x = -50; none runs along the core's edge.
        for (const hole of polygon.holes) expect(Math.max(...hole.map((point) => point.x))).toBeLessThan(-50);
      }
    }
  });

  it("cuts the plate back where the hill rises through it", () => {
    const hillTop = { x: -0.6 * (project.widthMm / 2), y: 0 };
    expect(inside(hillTop, stack.levels[0]!.pieces[0]!.polygons)).toBe(false);
    expect(inside({ x: hillTop.x, y: 55 }, stack.levels[0]!.pieces[0]!.polygons)).toBe(true);
  });

  it("builds Class D only as a lid at its ceiling, and only when asked", () => {
    expect(build({ form: "plates" }, [core, shelf, tower]).airspaceStack!.levels.map((level) => level.altitudeFt)).toEqual([SHELF, CEILING]);
    const lidded = build({ form: "plates", classes: { D: true } as AirspaceStackSettingsV1["classes"] }, [core, shelf, tower]).airspaceStack!;
    expect(lidded.levels.map((level) => level.altitudeFt)).toEqual([SHELF, sheetsUp(16), CEILING]);
    const lid = lidded.levels[1]!;
    expect(lid.pieces.flatMap((entry) => entry.sectorIds)).toContain("tower");
    // The shelf carries on through the lid's height: the plate crosses it there, but only the lid outside it is a shelf.
    const frost = lid.pieces.flatMap((entry) => entry.frost ?? []);
    expect(inside({ x: 128, y: 0 }, frost)).toBe(true);
    expect(inside({ x: 100, y: 0 }, frost)).toBe(false);
    // Below its ceiling the tower is not in the cross-section; the shelf around it is.
    expect(lidded.levels[0]!.pieces.flatMap((entry) => entry.sectorIds)).not.toContain("tower");
  });

  it("leaves out a Class D lid that other airspace swallows whole", () => {
    const inner = volume("inner", "class-d", circleRing(50, 0, 10), { ref: "sfc", ft: 0 }, { ref: "msl", ft: sheetsUp(16) });
    const stack = build({ form: "plates", classes: { D: true } as AirspaceStackSettingsV1["classes"] }, [core, shelf, inner]).airspaceStack!;
    expect(stack.levels.map((level) => level.altitudeFt)).toEqual([SHELF, CEILING]);
    expect(stack.levels.flatMap((level) => level.pieces.flatMap((entry) => entry.sectorIds))).not.toContain("inner");
  });

  it("merges levels too close for a rod between them, and says so", () => {
    const close = volume("close", "class-b", square(85, -60, 100, 60), { ref: "msl", ft: SHELF + Math.round((0.3 * stepM) / FEET) }, { ref: "msl", ft: CEILING });
    const merged = build({ form: "plates" }, [core, shelf, close]);
    expect(merged.airspaceStack!.levels.map((level) => level.altitudeFt)).toEqual([SHELF, CEILING]);
    expect(merged.airspaceStack!.levels[0]!.mergedFt).toHaveLength(1);
    expect(merged.warnings.map((warning) => warning.code)).toContain("AIRSPACE_LEVELS_MERGED");
  });
});

describe("airspace tiers", () => {
  const stack = build({ form: "tiers" }, [core, shelf]).airspaceStack!;

  it("cuts only where a shelf starts or ends, in the chart's blue", () => {
    expect(stack.levels.map((level) => level.altitudeFt)).toEqual([SHELF, CEILING]);
    expect(stack.levels.every((level) => level.pieces.every((entry) => entry.tint === "blue"))).toBe(true);
    expect(stack.levels.every((level) => level.pieces.every((entry) => entry.frost === undefined && entry.edges!.length > 0))).toBe(true);
  });

  it("gives a core that starts at the surface a floor above the ground under it", () => {
    // The core stands on flat ground at the land base; its floor snaps up to the first level.
    expect(inside({ x: 50, y: 0 }, stack.levels[0]!.pieces.flatMap((entry) => entry.polygons))).toBe(true);
    expect(stack.levels[0]!.pieces.flatMap((entry) => entry.sectorIds)).toContain("core");
  });

  it("tints Class C and MOAs magenta, restricted areas blue", () => {
    const moa = volume("moa", "special-use", square(-140, -90, -90, -70), { ref: "msl", ft: SHELF }, { ref: "msl", ft: CEILING }, { specialUseKind: "moa" });
    const restricted = volume("range", "special-use", square(-140, 70, -90, 90), { ref: "msl", ft: SHELF }, { ref: "msl", ft: CEILING }, { specialUseKind: "restricted" });
    const tints = build({ form: "tiers" }, [moa, restricted]).airspaceStack!.levels[0]!.pieces.map((entry) => [entry.sectorIds[0], entry.tint]);
    expect(Object.fromEntries(tints)).toEqual({ moa: "magenta", range: "blue" });
  });
});

describe("airspace tint", () => {
  const moa = volume("moa", "special-use", square(-140, -90, -90, -70), { ref: "msl", ft: SHELF }, { ref: "msl", ft: CEILING }, { specialUseKind: "moa" });
  const tints = (stack: { levels: Array<{ pieces: Array<{ tint: string }> }> }) => new Set(stack.levels.flatMap((level) => level.pieces.map((entry) => entry.tint)));

  it("follows the form when the project does not set it", () => {
    expect(airspaceStackTint({ form: "plates" })).toBe("clear");
    expect(airspaceStackTint({ form: "tiers" })).toBe("chart");
    expect(airspaceStackTint({ form: "volumes" })).toBe("chart");
    expect(airspaceStackTint({ form: "plates", tint: "chart" })).toBe("chart");
  });

  it("tints plates after the chart, a piece per colour, each frosted on its own shelves", () => {
    const stack = build({ form: "plates", tint: "chart" }, [core, shelf, moa]).airspaceStack!;
    const level = stack.levels[0]!;
    const blue = level.pieces.filter((entry) => entry.tint === "blue");
    const magenta = level.pieces.filter((entry) => entry.tint === "magenta");
    expect(inside({ x: 50, y: 0 }, blue.flatMap((entry) => entry.polygons))).toBe(true); // the core still passes through a tinted plate
    expect(inside({ x: 0, y: 50 }, blue.flatMap((entry) => entry.frost ?? []))).toBe(true);
    expect(magenta.flatMap((entry) => entry.sectorIds)).toEqual(["moa"]);
    expect(inside({ x: -115, y: -80 }, magenta.flatMap((entry) => entry.frost ?? []))).toBe(true);
  });

  it("cuts tiers and volumes from clear acrylic when asked, one piece across colours", () => {
    const tiers = build({ form: "tiers", tint: "clear" }, [shelf, moa]).airspaceStack!;
    expect(tints(tiers)).toEqual(new Set(["clear"]));
    expect(tiers.levels.every((level) => level.pieces.every((entry) => entry.frost === undefined))).toBe(true);
    const volumes = build({ form: "volumes", tint: "clear" }, [shelf, tower]).airspaceStack;
    const withLid = build({ form: "volumes", tint: "clear", classes: { ...DEFAULT_AIRSPACE_STACK.classes, D: true } }, [shelf, tower]).airspaceStack!;
    expect(volumes && tints(volumes)).toEqual(new Set(["clear"]));
    expect(tints(withLid)).toEqual(new Set(["clear"]));
  });

  it("leaves projects without a tint as they were", () => {
    const fingerprint = (tint?: "chart" | "clear") => projectFingerprint({ ...project, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, ...(tint ? { tint } : {}) } });
    expect(fingerprint()).not.toBe(fingerprint("clear"));
    expect(tints(build({ form: "tiers" }, [shelf, moa]).airspaceStack!)).toEqual(new Set(["blue", "magenta"]));
  });
});

describe("airspace volumes", () => {
  it("stacks every acrylic sheet from the floor to the ceiling", () => {
    const stack = build({ form: "volumes" }, [shelf]).airspaceStack!;
    const expected = Math.ceil((zOf(CEILING) - zOf(SHELF)) / t - 1e-6);
    expect(stack.levels).toHaveLength(expected);
    stack.levels.forEach((level, index) => expect(level.zMm).toBeCloseTo(zOf(SHELF) + index * t, 6));
  });

  it("fits a Class D lid around the solid sheets instead of notching them", () => {
    const area = (polygons: Polygon2D[]) => polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((holes, ring) => holes + Math.abs(signedArea(ring)), 0), 0);
    const sheets = build({ form: "volumes" }, [shelf]).airspaceStack!;
    const lidded = build({ form: "volumes", classes: { D: true } as AirspaceStackSettingsV1["classes"] }, [shelf, tower]).airspaceStack!;
    const lid = lidded.levels.find((level) => level.pieces.some((entry) => entry.sectorIds.includes("tower")))!;
    expect(lid.zMm).toBeCloseTo(zOf(sheetsUp(16)), 6);
    const lidPolygons = lid.pieces.flatMap((entry) => entry.polygons);
    expect(inside({ x: 128, y: 0 }, lidPolygons)).toBe(true);
    expect(inside({ x: 100, y: 0 }, lidPolygons)).toBe(false);
    // Every shelf sheet keeps its whole area, the ones beside the lid included.
    const shelfArea = (stack: typeof sheets) => stack.levels.filter((level) => level !== lid).map((level) => Math.round(area(level.pieces.flatMap((entry) => entry.polygons))));
    expect(shelfArea(lidded)).toEqual(shelfArea(sheets));
  });
});

describe("airspace tiers with Class D", () => {
  it("stops a lid where a shelf or a restricted area carries on through its height", () => {
    const restricted = volume("restricted", "special-use", square(110, -60, 150, -15), { ref: "sfc", ft: 0 }, { ref: "msl", ft: CEILING }, { specialUseKind: "restricted" });
    const stack = build({ form: "tiers", classes: { D: true, specialUse: true } as AirspaceStackSettingsV1["classes"] }, [shelf, tower, restricted]).airspaceStack!;
    const lid = stack.levels.find((level) => level.altitudeFt === sheetsUp(16))!;
    const lidPolygons = lid.pieces.filter((entry) => entry.sectorIds.includes("tower")).flatMap((entry) => entry.polygons);
    expect(inside({ x: 128, y: 5 }, lidPolygons)).toBe(true);
    expect(inside({ x: 100, y: 5 }, lidPolygons)).toBe(false); // inside the shelf
    expect(inside({ x: 128, y: -22 }, lidPolygons)).toBe(false); // inside the restricted area
    expect(lid.pieces.every((entry) => entry.sectorIds.every((id) => id === "tower"))).toBe(true);
  });
});

describe("airspace given above ground", () => {
  // Ground rising steadily west to east, 12 sheets across the model, so steps over it are wide strips.
  const [rampProject, rampSource] = scaledForLayers(base, gridSource(base, 64, (nx) => 1000 + 300 * (nx + 1)), 12);
  const rampBase = generateGeometry(rampProject, rampSource).layers[0]!.elevationM;

  it("steps a floor given above ground over the terrain and says so", () => {
    // A MOA 0 ft above the ramp up to well above it: its floor follows the ramp in steps.
    const moa = volume("ramp-moa", "special-use", square(-140, -40, 140, 40), { ref: "agl", ft: 0 }, { ref: "msl", ft: Math.round((rampBase + 1_200) / FEET) }, { specialUseKind: "moa" });
    const result = generateGeometry({ ...rampProject, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form: "tiers" } }, { ...rampSource, airspaceVolumes: [moa] });
    const levels = result.airspaceStack!.levels;
    expect(levels.length).toBeGreaterThan(3);
    expect(result.warnings.map((warning) => warning.code)).toContain("AIRSPACE_TERRACED");
    // Higher steps lie further east, over higher ground.
    const middles = levels.slice(0, -1).map((level) => {
      const xs = level.pieces.flatMap((entry) => entry.polygons.flatMap((polygon) => polygon.outer.map((point) => point.x)));
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    });
    expect(middles).toEqual([...middles].sort((a, b) => a - b));
    // No step passes through a sheet whose top is above it.
    for (const level of levels) for (const entry of level.pieces) {
      for (const layer of result.layers.filter((sheet) => (sheet.index + 1) * t > level.zMm + 1e-6)) {
        const overlap = clipPolygons(entry.polygons, layer.polygons, "intersection");
        expect(overlap.reduce((sum, polygon) => sum + Math.abs(polygon.outer.reduce((area, point, index) => {
          const next = polygon.outer[(index + 1) % polygon.outer.length]!;
          return area + point.x * next.y - next.x * point.y;
        }, 0)) / 2, 0)).toBeLessThan(0.01);
      }
    }
  });

  it("drops steps too narrow to build over steep ground", () => {
    const moa = volume("hill-moa", "special-use", square(-150, -40, -30, 40), { ref: "agl", ft: 0 }, { ref: "msl", ft: CEILING }, { specialUseKind: "moa" });
    expect(build({ form: "tiers" }, [moa]).warnings.map((warning) => warning.code)).toContain("AIRSPACE_PIECES_DROPPED");
  });

  it("never snaps a ground-relative ceiling up to another sector's higher level", () => {
    const low = volume("low-ceiling", "special-use", square(20, -30, 80, 30), { ref: "sfc", ft: 0 }, { ref: "agl", ft: Math.round(2 * stepM / FEET) }, { specialUseKind: "moa" });
    const stack = build({ form: "plates" }, [shelf, low]).airspaceStack!;
    const own = stack.levels.filter((level) => level.pieces.some((piece) => piece.sectorIds.includes(low.id)));
    expect(own.length).toBeGreaterThan(0);
    for (const level of own) expect(level.zMm).toBeLessThanOrEqual(t * 3 + 0.05);
  });

  it("caps an unlimited ceiling and drops sectors the class switches leave out", () => {
    const range = volume("range", "special-use", square(-140, 70, -90, 90), { ref: "msl", ft: SHELF }, { ref: "unlimited" }, { specialUseKind: "restricted" });
    const capped = build({ form: "plates", ceilingCapFt: sheetsUp(18) }, [range]).airspaceStack!;
    expect(capped.levels.map((level) => level.altitudeFt)).toEqual([SHELF, sheetsUp(18)]);
    expect(build({ form: "plates", classes: { specialUse: false } as AirspaceStackSettingsV1["classes"] }, [range]).airspaceStack!.levels).toHaveLength(0);
  });
});

describe("airspace fabrication limits", () => {
  it("warns about partial source data instead of presenting it as complete", () => {
    const source = gridSource(project, 32, () => 1000);
    const result = generateGeometry({ ...project, airspaceStack: DEFAULT_AIRSPACE_STACK }, { ...source, airspaceVolumes: [shelf], airspaceStatus: "partial" });
    expect(result.airspaceStatus).toBe("partial");
    expect(result.warnings.map((warning) => warning.code)).toContain("AIRSPACE_DATA_PARTIAL");
  });

  it("stops before generating an impractical number of solid sheets", () => {
    const high = volume("high", "class-b", square(20, -30, 80, 30), { ref: "sfc", ft: 0 }, { ref: "msl", ft: 60_000 });
    const result = build({ form: "volumes", thicknessMm: 1, ceilingCapFt: 60_000 }, [high]);
    expect(result.airspaceStack).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("AIRSPACE_TOO_COMPLEX");
  });

  it("partitions coincident tints and preserves every represented sector", () => {
    const overlapping = { ...shelf, id: "class-c", aviationClass: "class-c" as const };
    const result = build({ form: "tiers" }, [shelf, overlapping]);
    expect(result.warnings.map((warning) => warning.code)).not.toContain("AIRSPACE_PIECES_OVERLAP");
    expect(exportBlockReason(result, { ...project, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form: "tiers" } })).toBeUndefined();
    for (const level of result.airspaceStack!.levels) {
      expect(level.pieces).toHaveLength(1);
      expect(level.pieces[0]!.tint).toBe("blue");
      expect(level.pieces[0]!.sectorIds).toEqual(["class-c", "shelf"]);
    }
  });

  it("records only the sectors that intersect each disconnected volume piece", () => {
    const other = volume("other", "class-b", square(120, -60, 145, 60), { ref: "msl", ft: SHELF }, { ref: "msl", ft: CEILING });
    const stack = build({ form: "volumes" }, [core, other]).airspaceStack!;
    expect(stack.levels.some((level) => level.pieces.length === 2)).toBe(true);
    for (const level of stack.levels) for (const piece of level.pieces) expect(piece.sectorIds).toHaveLength(1);
  });
});

describe("airspace without data", () => {
  it("warns and builds nothing when airspace was not loaded", () => {
    const result = build({ form: "plates" }, undefined);
    expect(result.airspaceStack).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("AIRSPACE_NOT_LOADED");
  });

  it("is absent from geometry that never asked for it", () => {
    expect(plain.airspaceStack).toBeUndefined();
  });
});
