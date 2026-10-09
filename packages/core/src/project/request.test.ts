import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { DEFAULT_PROJECT, NORTH_ARROW_MIN_SIZE_MM, northArrowMaximumMm, type ProjectConfigV1 } from "../types.js";
import { DEFAULT_AIRSPACE_STACK } from "../pipeline/airspace-settings.js";
import { boundsForProject, isMercatorBounds } from "./bounds.js";
import { cleanRequestText, describeProject, expandProjectRequest, parseProjectRequest, parseProjectRequestPatch, requestPatch, type ProjectRequestV1 } from "./request.js";
import { PROJECT_REQUEST_PATCH_SCHEMA, PROJECT_REQUEST_SCHEMA } from "./schema.js";

const rainier: ProjectRequestV1 = { requestVersion: 1, area: { center: { lat: 46.8523, lon: -121.7603 }, widthKm: 20 }, placeLabel: "Mount Rainier, Washington, United States" };

function parsed(value: unknown): ProjectRequestV1 {
  const result = parseProjectRequest(value);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe("project requests", () => {
  it("expands a minimal request onto the studio defaults", () => {
    const project = expandProjectRequest(parsed(rainier));
    expect(project).toMatchObject({ schemaVersion: 1, name: "Mount Rainier", outputMode: "stack", widthMm: 300, heightMm: 200, materialThicknessMm: 3, verticalExaggeration: 2 });
    expect(project.location.label).toBe(rainier.placeLabel);
    expect(project).not.toHaveProperty("plaque");
    // The crop is centered on the point, spans the asked ground width, and keeps the cut's proportions.
    const bounds = boundsForProject(project);
    expect((bounds.west + bounds.east) / 2).toBeCloseTo(-121.7603, 6);
    const kmAcross = (bounds.east - bounds.west) * Math.PI / 180 * 6371.0088 * Math.cos(46.8523 * Math.PI / 180);
    expect(kmAcross).toBeCloseTo(20, 1);
    expect(project.location.bounds).toEqual(bounds);
  });

  it("gives the same request the same project id, and a different one another", () => {
    expect(expandProjectRequest(rainier).id).toBe(expandProjectRequest({ ...rainier }).id);
    expect(expandProjectRequest(rainier).id).toMatch(/^agent-[0-9a-f]{8}$/);
    expect(expandProjectRequest({ ...rainier, widthMm: 400 }).id).not.toBe(expandProjectRequest(rainier).id);
  });

  it("keeps a whole bounding box in view at the cut's proportions", () => {
    const area = { bounds: { west: -120.1, south: 38.9, east: -119.9, north: 39.3 } };
    const project = expandProjectRequest(parsed({ requestVersion: 1, area, widthMm: 300, heightMm: 200 }));
    const bounds = boundsForProject(project);
    expect(bounds.west).toBeLessThanOrEqual(area.bounds.west);
    expect(bounds.east).toBeGreaterThanOrEqual(area.bounds.east);
    expect(bounds.south).toBeLessThanOrEqual(area.bounds.south + 1e-9);
    expect(bounds.north).toBeGreaterThanOrEqual(area.bounds.north - 1e-9);
    expect(project.name).toBe("Terrain model");
  });

  it("maps flat output, details, title, laser and markers onto project fields", () => {
    const project = expandProjectRequest(parsed({
      ...rainier,
      output: "flat", contourCount: 20, shape: "circle", units: "imperial",
      details: { roads: false, trails: false, coordinateGrid: true, waterDepth: false },
      title: "Mount Rainier\n14,411 ft",
      laser: { kerfMm: 0.1, workAreaWidthMm: 400, workAreaHeightMm: 0 },
      markers: [{ lat: 46.8523, lon: -121.7603, symbol: "star", name: "Summit" }],
    }));
    expect(project).toMatchObject({
      outputMode: "engraving", engravingContourCount: 20, cropShape: "circle", units: "imperial",
      showRoads: false, showTrails: false, showCoordinateGrid: true, showWaterDepth: false, showWater: true,
      laserKerfMm: 0.1, workAreaWidthMm: 400, workAreaHeightMm: 0,
      plaque: { enabled: true, text: "Mount Rainier\n14,411 ft", sizeMm: 6, placement: { anchor: "bottom-left", offset: { x: 0, y: 0 } } },
      markers: [{ id: "marker-1", lat: 46.8523, lon: -121.7603, symbol: "star", sizeMm: 8, name: "Summit" }],
    });
  });

  it("keeps the north arrow within what a small model allows", () => {
    const project = expandProjectRequest(parsed({ ...rainier, widthMm: 40, heightMm: 30 }));
    expect(project.northArrowSizeMm).toBe(northArrowMaximumMm(40, 30));
    expect(project.northArrowSizeMm).toBeGreaterThanOrEqual(NORTH_ARROW_MIN_SIZE_MM);
  });

  it("reports every problem with the path of the field that caused it", () => {
    const result = parseProjectRequest({ requestVersion: 2, area: { center: { lat: 95, lon: 0 }, widthKm: 0 }, widthMm: "wide", output: "3d", details: { lakes: true, roads: "yes" }, colour: "red", markers: [{ lat: 0 }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(({ path }) => path).sort()).toEqual([
      "area.center.lat", "area.widthKm", "colour", "details.lakes", "details.roads", "markers[0].lon", "output", "requestVersion", "widthMm",
    ]);
  });

  it("requires an area and rejects boxes that are empty or upside down", () => {
    const missing = parseProjectRequest({ requestVersion: 1 });
    expect(missing.ok || missing.errors).toEqual([{ path: "area", message: expect.stringMatching(/required/i) }]);
    const empty = parseProjectRequest({ requestVersion: 1, area: { bounds: { west: 179, south: -17, east: 179, north: -16 } } });
    expect(empty.ok || empty.errors[0]!.path).toBe("area.bounds");
    const upsideDown = parseProjectRequest({ requestVersion: 1, area: { bounds: { west: 1, south: 2, east: 2, north: 1 } } });
    expect(upsideDown.ok || upsideDown.errors[0]!.message).toMatch(/south/i);
  });

  it("crosses the antimeridian when west is greater than east, as GeoJSON does", () => {
    const fiji = expandProjectRequest(parsed({ requestVersion: 1, area: { bounds: { west: 177, south: -19.2, east: -178, north: -16 } } }));
    const bounds = fiji.location.bounds!;
    expect(bounds.west).toBeLessThanOrEqual(177);
    expect(bounds.east).toBeGreaterThanOrEqual(182);
    expect(fiji.location.lon).toBeCloseTo(179.5, 9);
    expect(isMercatorBounds(boundsForProject(fiji))).toBe(true);
    // A center beside the antimeridian frames ground on both sides of it.
    const taveuni = expandProjectRequest(parsed({ requestVersion: 1, area: { center: { lat: -16.8, lon: -179.95 }, widthKm: 60 } }));
    expect(taveuni.location.bounds!.west).toBeLessThan(-180);
    expect(taveuni.location.lon).toBe(-179.95);
    // Requests that never cross keep the bounds they always had.
    expect(expandProjectRequest(parsed(rainier)).location.bounds!.east).toBeLessThan(180);
  });

  it("refuses an area that, once fitted to the cut, leaves the mapped world", () => {
    const result = parseProjectRequest({ requestVersion: 1, area: { center: { lat: 84, lon: 0 }, widthKm: 1500 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.message).toMatch(/beyond the mapped world/);
  });

  it("limits titles to three lines of forty characters", () => {
    expect(parseProjectRequest({ ...rainier, title: "a\nb\nc\nd" }).ok).toBe(false);
    expect(parseProjectRequest({ ...rainier, title: "x".repeat(41) }).ok).toBe(false);
    expect(parseProjectRequest({ ...rainier, title: "x".repeat(40) }).ok).toBe(true);
  });

  it("strips hidden and control characters from text", () => {
    const hidden = [0x202e, 0x200b, 0x0007].map((code) => String.fromCharCode(code));
    expect(cleanRequestText(`Lake${hidden[0]} Tahoe${hidden[1]}\t ${hidden[2]}`, 240)).toBe("Lake Tahoe");
    expect(cleanRequestText("  One \r\n  Two  ", 240, true)).toBe("One\nTwo");
    expect(cleanRequestText("One\nTwo", 240)).toBe("One Two");
    expect(parsed({ ...rainier, placeLabel: `Crater ${hidden[0]}Lake${hidden[1]}` }).placeLabel).toBe("Crater Lake");
  });
});

describe("request patches", () => {
  it("edits a design without touching what the change leaves out", () => {
    const change = parseProjectRequestPatch({ materialThicknessMm: 6, details: { roads: false } });
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(requestPatch(DEFAULT_PROJECT, change.value)).toEqual({ materialThicknessMm: 6, showRoads: false });
  });

  it("keeps the stored zoom when only the place label changes", () => {
    const withBounds: ProjectConfigV1 = { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, bounds: boundsForProject(DEFAULT_PROJECT) } };
    const patch = requestPatch(withBounds, { placeLabel: "Crater Lake National Park" });
    expect(patch.location).toEqual({ ...withBounds.location, label: "Crater Lake National Park" });
  });

  it("switches a title off without forgetting its placement", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, plaque: { enabled: true, text: "Old", sizeMm: 9, placement: { anchor: "top", offset: { x: 0, y: 0 } } } };
    expect(requestPatch(project, { title: "" }).plaque).toEqual({ ...project.plaque, enabled: false });
    expect(requestPatch(project, { title: "New" }).plaque).toEqual({ ...project.plaque, text: "New" });
  });

  it("turns aviation groups on and off, dropping the setting once all are off", () => {
    const on = parseProjectRequestPatch({ aviation: { airspace: true, labels: true } });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const patch = requestPatch(DEFAULT_PROJECT, on.value);
    expect(patch.aviation).toEqual({ airspace: true, specialUse: false, runways: false, airports: false, navaids: false, obstacles: false, labels: true });
    const withAirspace: ProjectConfigV1 = { ...DEFAULT_PROJECT, aviation: patch.aviation };
    expect(requestPatch(withAirspace, { aviation: { runways: true } }).aviation).toMatchObject({ airspace: true, runways: true });
    expect(requestPatch(withAirspace, { aviation: { airspace: false, labels: false } })).toEqual({ aviation: undefined });
    const invalid = parseProjectRequestPatch({ aviation: { airspace: "yes", tfr: true } });
    expect(invalid.ok || invalid.errors.map(({ path }) => path).sort()).toEqual(["aviation.airspace", "aviation.tfr"]);
  });

  it("turns airspace in acrylic on from the defaults, changes only the fields given, and turns it off", () => {
    const on = parseProjectRequestPatch({ airspaceStack: { form: "tiers", rod: { joint: "through" } } });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const patch = requestPatch(DEFAULT_PROJECT, on.value);
    expect(patch.airspaceStack).toEqual({ ...DEFAULT_AIRSPACE_STACK, form: "tiers", rod: { ...DEFAULT_AIRSPACE_STACK.rod, joint: "through" } });
    const withStack: ProjectConfigV1 = { ...DEFAULT_PROJECT, airspaceStack: patch.airspaceStack };
    expect(requestPatch(withStack, { airspaceStack: { classes: { D: true }, ceilingCapFt: 12_000 } }).airspaceStack).toMatchObject({ form: "tiers", classes: { B: true, D: true }, ceilingCapFt: 12_000, rod: { joint: "through" } });
    expect(requestPatch(withStack, { airspaceStack: false })).toEqual({ airspaceStack: undefined });
    // Every kind off drops the setting, as aviation detail does.
    expect(requestPatch(withStack, { airspaceStack: { classes: { B: false, C: false, specialUse: false } } })).toEqual({ airspaceStack: undefined });
    expect(expandProjectRequest(parsed({ ...rainier, airspaceStack: {} })).airspaceStack).toEqual(DEFAULT_AIRSPACE_STACK);
  });

  it("checks airspace settings against the limits the studio keeps", () => {
    const invalid = parseProjectRequestPatch({ airspaceStack: { form: "cones", classes: { E: true, B: "yes" }, ceilingCapFt: 500, rod: { sizeMm: 20, shape: "hex", length: 3 } } });
    expect(invalid.ok || invalid.errors.map(({ path }) => path).sort()).toEqual([
      "airspaceStack.ceilingCapFt", "airspaceStack.classes.B", "airspaceStack.classes.E", "airspaceStack.form", "airspaceStack.rod.length", "airspaceStack.rod.shape", "airspaceStack.rod.sizeMm",
    ]);
    const notObject = parseProjectRequestPatch({ airspaceStack: true });
    expect(notObject.ok || notObject.errors).toEqual([{ path: "airspaceStack", message: "Must be false, or an object of airspace settings." }]);
  });

  it("rejects unknown fields and a version, which only a new request carries", () => {
    const result = parseProjectRequestPatch({ requestVersion: 1, thickness: 3 });
    expect(result.ok || result.errors.map(({ path }) => path)).toEqual(["requestVersion", "thickness"]);
  });
});

describe("describing a project", () => {
  it("round-trips through a request to the same design", () => {
    const original = expandProjectRequest(parsed({ ...rainier, output: "flat", title: "Rainier", aviation: { airspace: true, airports: true }, airspaceStack: { form: "volumes", thicknessMm: 2, rod: { shape: "square" } }, markers: [{ lat: 46.85, lon: -121.76 }] }));
    const described = describeProject(original);
    const again = expandProjectRequest(parsed(described));
    // A box's point is its middle latitude, a hair from the Mercator center the request named.
    const { id: _id, location: { lat, ...location }, ...rest } = again;
    const { id: _originalId, location: { lat: originalLat, ...originalLocation }, ...originalRest } = original;
    expect(rest).toEqual(originalRest);
    expect(location).toEqual(originalLocation);
    expect(lat).toBeCloseTo(originalLat, 3);
    expect(isMercatorBounds(boundsForProject(again))).toBe(true);
  });

  it("describes a design across the antimeridian as a request it accepts again", () => {
    for (const bounds of [{ west: 179.5, south: -17.2, east: 180.5, north: -16.5 }, { west: -180.5, south: -17.2, east: -179.5, north: -16.5 }]) {
      const fiji: ProjectConfigV1 = { ...DEFAULT_PROJECT, location: { lat: -16.85, lon: 180, label: "Fiji", zoom: 9, bounds } };
      const described = describeProject(fiji).area;
      expect(described).toEqual({ bounds: { west: 179.5, south: expect.any(Number), east: -179.5, north: expect.any(Number) } });
      const again = boundsForProject(expandProjectRequest(parsed(describeProject(fiji))));
      const original = boundsForProject(fiji);
      const shift = original.west < -180 ? 360 : 0;
      expect(again.west).toBeCloseTo(original.west + shift, 9);
      expect(again.east).toBeCloseTo(original.east + shift, 9);
      expect(again.south).toBeCloseTo(original.south, 9);
    }
    // A point-only design beside the antimeridian, or one a whole world wide.
    for (const location of [{ lat: -16.8, lon: 179.9, label: "Taveuni", zoom: 9 }, { lat: 10, lon: -10, label: "World", zoom: 0 }]) {
      expect(() => expandProjectRequest(parsed(describeProject({ ...DEFAULT_PROJECT, location })))).not.toThrow();
    }
  });

  it("describes a point-only project at the pole as a request it accepts again", () => {
    const polar: ProjectConfigV1 = { ...DEFAULT_PROJECT, location: { lat: 89, lon: 0, label: "Pole", zoom: 11 } };
    const again = expandProjectRequest(parsed(describeProject(polar)));
    expect(isMercatorBounds(boundsForProject(again))).toBe(true);
  });
});

describe("request schema", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(PROJECT_REQUEST_SCHEMA);
  const validatePatch = ajv.compile(PROJECT_REQUEST_PATCH_SCHEMA);

  const cases: Array<[string, unknown]> = [
    ["minimal", rainier],
    ["bounds", { requestVersion: 1, area: { bounds: { west: 8, south: 46, east: 8.2, north: 46.1 } } }],
    ["everything", { ...rainier, name: "R", widthMm: 450, heightMm: 450, shape: "circle", units: "imperial", output: "flat", materialThicknessMm: 1.5, verticalExaggeration: 3, contourCount: 16, details: { water: false, scaleBar: false }, title: "R", laser: { kerfMm: 0, workAreaWidthMm: 0, workAreaHeightMm: 300 }, markers: [{ lat: 1, lon: 2, symbol: "cross", name: "x" }] }],
    ["wrong version", { ...rainier, requestVersion: 2 }],
    ["no area", { requestVersion: 1 }],
    ["both area forms", { requestVersion: 1, area: { center: { lat: 1, lon: 1 }, widthKm: 5, bounds: { west: 0, south: 0, east: 1, north: 1 } } }],
    ["unknown field", { ...rainier, colour: "red" }],
    ["thin material", { ...rainier, materialThicknessMm: 0.2 }],
    ["fractional contours", { ...rainier, contourCount: 12.5 }],
    ["tiny work area", { ...rainier, laser: { workAreaWidthMm: 5 } }],
    ["bad symbol", { ...rainier, markers: [{ lat: 1, lon: 1, symbol: "flag" }] }],
    ["too many markers", { ...rainier, markers: Array.from({ length: 21 }, () => ({ lat: 1, lon: 1 })) }],
    ["airspace", { ...rainier, airspaceStack: { form: "tiers", classes: { D: true }, ceilingCapFt: 12_000, thicknessMm: 3, kerfMm: 0.1, rod: { shape: "square", sizeMm: 5, fitClearanceMm: 0.2, socketDepthMm: 9, joint: "through" } } }],
    ["airspace off", { ...rainier, airspaceStack: false }],
    ["airspace on", { ...rainier, airspaceStack: true }],
    ["airspace form", { ...rainier, airspaceStack: { form: "cones" } }],
    ["airspace rod", { ...rainier, airspaceStack: { rod: { sizeMm: 1 } } }],
    ["airspace field", { ...rainier, airspaceStack: { colour: "blue" } }],
  ];

  it.each(cases)("agrees with the parser on %s", (_label, value) => {
    expect(validate(value)).toBe(parseProjectRequest(value).ok);
  });

  it("describes patches the patch parser accepts", () => {
    for (const value of [{}, { materialThicknessMm: 4 }, { area: { center: { lat: 1, lon: 1 }, widthKm: 3 } }, { output: "print" }, { requestVersion: 1 }]) {
      expect(validatePatch(value)).toBe(parseProjectRequestPatch(value).ok);
    }
  });
});
