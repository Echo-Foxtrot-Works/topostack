import { describe, expect, it } from "vitest";
import { DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, generateGeometry, parseProject, type AirspaceStackSettingsV1 } from "../index.js";
import { clipPolygons } from "../primitives/offset.js";
import { exportBlockReason } from "../export/export-policy.js";
import { projectFingerprint } from "./fingerprint.js";
import { gridSource, scaledForLayers } from "../test-support/sources.js";
import { base, build, CEILING, core, FEET, inside, plain, project, SHELF, sheetsUp, shelf, square, stepM, t, tower, volume, zOf } from "../test-support/airspace.js";

describe("airspace stack settings", () => {
  it("round-trips through parseProject and rejects what cannot be built", () => {
    const settings = { ...DEFAULT_AIRSPACE_STACK, ceilingCapFt: 12_000 };
    expect(parseProject(JSON.parse(JSON.stringify({ ...DEFAULT_PROJECT, airspaceStack: settings }))).airspaceStack).toEqual(settings);
    expect(parseProject(JSON.parse(JSON.stringify(DEFAULT_PROJECT))).airspaceStack).toBeUndefined();
    const invalid = (patch: Record<string, unknown>) => () => parseProject({ ...DEFAULT_PROJECT, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, ...patch } });
    expect(invalid({ form: "cones" })).toThrow("form");
    expect(invalid({ classes: { B: false, C: false, D: false, specialUse: false } })).toThrow("at least one");
    expect(invalid({ ceilingCapFt: 500 })).toThrow("ceiling cap");
    expect(invalid({ rod: { ...DEFAULT_AIRSPACE_STACK.rod, sizeMm: 20 } })).toThrow("rod size");
    expect(invalid({ rod: { ...DEFAULT_AIRSPACE_STACK.rod, joint: "welded" } })).toThrow("segments");
    expect(invalid({ rod: undefined })).toThrow("rod settings");
  });

  it("leaves existing fingerprints alone", () => {
    expect(projectFingerprint(DEFAULT_PROJECT)).toBe(projectFingerprint({ ...DEFAULT_PROJECT, airspaceStack: undefined }));
    expect(projectFingerprint({ ...DEFAULT_PROJECT, airspaceStack: DEFAULT_AIRSPACE_STACK })).not.toBe(projectFingerprint(DEFAULT_PROJECT));
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
    // Below its ceiling the tower is not in the cross-section; the core around it is.
    expect(lidded.levels[0]!.pieces.flatMap((entry) => entry.sectorIds)).not.toContain("tower");
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

describe("airspace volumes", () => {
  it("stacks every acrylic sheet from the floor to the ceiling", () => {
    const stack = build({ form: "volumes" }, [shelf]).airspaceStack!;
    const expected = Math.ceil((zOf(CEILING) - zOf(SHELF)) / t - 1e-6);
    expect(stack.levels).toHaveLength(expected);
    stack.levels.forEach((level, index) => expect(level.zMm).toBeCloseTo(zOf(SHELF) + index * t, 6));
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
