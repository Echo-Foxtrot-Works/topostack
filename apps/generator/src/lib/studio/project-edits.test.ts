import { describe, expect, it } from "vitest";
import { DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, parseProject, MAX_CUSTOM_DATA_NAME_LENGTH, MAX_CUSTOM_DATA_POINTS, projectFingerprint, MAX_CUSTOM_LINE_POINTS, MAX_MAP_MARKERS, NORTH_ARROW_MAX_SIZE_MM, NORTH_ARROW_MIN_SIZE_MM, type CustomLineFeatureV1, type ProjectConfigV1 } from "@topostack/core";
import { retainAirspaceThickness, addCustomGraphic, addPlacedGraphic, graphicMaximumMm, removeCustomGraphic, removePlacedGraphic, renameCustomGraphic, updatePlacedGraphic, addMarkerIcon, removeMarkerIcon, renameMarkerIcon, setMarkerIconAnchor, addCustomLine, addCustomLinePoint, addDrawnCustomLine, canExtendDrawnLine, renameCustomLine, renameMarker, addMarker, addMarkerAt, appendCustomData, canAddCustomLine, clampPlaqueSize, customDataCapacity, plaqueSettings, plaqueText, plaqueWithFont, northArrowMaximumMm, removeCustomLine, removeCustomLinePoint, removeMarker, updateCustomLine, updateCustomLinePoint, updateMarker, withLiveNames } from "$lib/studio/project-edits";

const line = (id: string, count = 2): CustomLineFeatureV1 => ({ id, kind: "trail", points: Array.from({ length: count }, (_, index) => ({ lat: 40, lon: -105 + index * 0.01 })) });
const withData = (patch: Partial<ProjectConfigV1>): ProjectConfigV1 => ({ ...DEFAULT_PROJECT, ...patch });

describe("terrain and acrylic stock edits", () => {
  const project = withData({ materialThicknessMm: 4, airspaceStack: DEFAULT_AIRSPACE_STACK });

  it.each([0.5, 12, 25])("keeps 4 mm acrylic when wood changes to %s mm", (materialThicknessMm) => {
    const patch = retainAirspaceThickness(project, { materialThicknessMm });
    const next = parseProject({ ...project, ...patch });
    expect(next.materialThicknessMm).toBe(materialThicknessMm);
    expect(next.airspaceStack?.thicknessMm).toBe(4);
    expect(project.airspaceStack?.thicknessMm).toBeUndefined();
  });

  it("keeps supported inheritance, explicit acrylic choices, and turning airspace off", () => {
    for (const materialThicknessMm of [1, 3, 10]) {
      const patch = { materialThicknessMm };
      expect(retainAirspaceThickness(project, patch)).toBe(patch);
    }
    const explicit = { materialThicknessMm: 12, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, thicknessMm: 2 } };
    expect(retainAirspaceThickness(project, explicit)).toBe(explicit);
    const off = { materialThicknessMm: 12, airspaceStack: undefined };
    expect(retainAirspaceThickness(project, off)).toBe(off);
    const patch = { materialThicknessMm: 12 };
    expect(retainAirspaceThickness({ ...project, airspaceStack: explicit.airspaceStack }, patch)).toBe(patch);
    expect(retainAirspaceThickness(DEFAULT_PROJECT, patch)).toBe(patch);
  });
});

describe("north arrow size limit", () => {
  it("scales with the shorter side within the absolute bounds", () => {
    expect(northArrowMaximumMm(100, 60)).toBeCloseTo(27);
    expect(northArrowMaximumMm(10, 10)).toBe(NORTH_ARROW_MIN_SIZE_MM);
    expect(northArrowMaximumMm(2000, 2000)).toBe(NORTH_ARROW_MAX_SIZE_MM);
  });
});

describe("marker edits", () => {
  it("adds a pin at the map center until the marker limit", () => {
    expect(addMarker(DEFAULT_PROJECT, "m1")?.markers).toEqual([{ id: "m1", lat: DEFAULT_PROJECT.location.lat, lon: DEFAULT_PROJECT.location.lon, symbol: "pin", sizeMm: 8 }]);
    const full = withData({ markers: Array.from({ length: MAX_MAP_MARKERS }, (_, index) => ({ id: `m${index}`, lat: 0, lon: 0, symbol: "pin" as const })) });
    expect(addMarker(full, "extra")).toBeUndefined();
  });

  it("resizes only the chosen marker and rejects invalid sizes", () => {
    const project = withData({ markers: [{ id: "a", lat: 1, lon: 2, symbol: "pin" }, { id: "b", lat: 3, lon: 4, symbol: "star", sizeMm: 20 }] });
    expect(updateMarker(project, "a", { sizeMm: 12.5 })?.markers).toEqual([{ ...project.markers[0], sizeMm: 12.5 }, project.markers[1]]);
    for (const sizeMm of [0, -1, 201, NaN, Infinity]) expect(updateMarker(project, "a", { sizeMm })).toBeUndefined();
  });

  it("updates only valid coordinates and removes by id", () => {
    const project = withData({ markers: [{ id: "a", lat: 1, lon: 2, symbol: "pin" }, { id: "b", lat: 3, lon: 4, symbol: "star" }] });
    expect(updateMarker(project, "a", { lat: 45, symbol: "cross" })?.markers[0]).toEqual({ id: "a", lat: 45, lon: 2, symbol: "cross" });
    expect(updateMarker(project, "a", { lat: 86 })).toBeUndefined();
    expect(updateMarker(project, "a", { lon: Number.NaN })).toBeUndefined();
    expect(updateMarker(project, "missing", { lat: 1 })).toBeUndefined();
    expect(removeMarker(project, "a").markers.map((marker) => marker.id)).toEqual(["b"]);
  });
});

describe("marker icon edits", () => {
  const icon = { id: "icon-0001", name: "Cabin", shapes: [{ outer: [-500, 500, 500, 500, 0, -500] }] };
  const project = withData({ markers: [{ id: "a", lat: 1, lon: 2, symbol: "pin" }, { id: "b", lat: 3, lon: 4, symbol: "star" }] });

  it("adds an icon once, reusing the same drawing when it is uploaded again", () => {
    const added = addMarkerIcon(project, icon)!;
    expect(added).toEqual({ iconId: icon.id, patch: { markers: project.markers, markerIcons: [icon] } });
    const withIcon = { ...project, ...added.patch };
    expect(addMarkerIcon(withIcon, { ...icon, id: "icon-0002", name: "Again" })?.iconId).toBe(icon.id);
    expect(addMarkerIcon(withIcon, { ...icon, id: "icon-0002", anchor: "bottom" })?.iconId).toBe("icon-0002");
    const full = { ...project, markerIcons: Array.from({ length: 24 }, (_, index) => ({ ...icon, id: `icon-${String(index).padStart(4, "0")}`, shapes: [{ outer: [index, 0, 1, 1, 2, 0] }] })) };
    expect(addMarkerIcon(full, { ...icon, id: "icon-9999" })).toBeUndefined();
  });

  it("gives markers only icons the project has, and drops the icon with the symbol", () => {
    const withIcon = { ...project, markerIcons: [icon] };
    const custom = updateMarker(withIcon, "a", { symbol: "custom", iconId: icon.id })!;
    expect(custom.markers[0]).toEqual({ id: "a", lat: 1, lon: 2, symbol: "custom", iconId: icon.id });
    expect(updateMarker(withIcon, "a", { symbol: "custom", iconId: "missing" })).toBeUndefined();
    expect(updateMarker(project, "a", { symbol: "custom", iconId: icon.id })).toBeUndefined();
    // Resizing a custom marker keeps its icon; choosing a built-in lets it go.
    const resized = updateMarker({ ...withIcon, ...custom }, "a", { sizeMm: 12 })!;
    expect(resized.markers[0]).toMatchObject({ symbol: "custom", iconId: icon.id, sizeMm: 12 });
    expect(updateMarker({ ...withIcon, ...custom }, "a", { symbol: "circle" })?.markers[0]).toEqual({ id: "a", lat: 1, lon: 2, symbol: "circle" });
  });

  it("renames and re-anchors icons, and removing one turns its markers into pins", () => {
    const withIcon = { ...project, markerIcons: [icon], markers: [{ id: "a", lat: 1, lon: 2, symbol: "custom" as const, iconId: icon.id }, project.markers[1]!] };
    expect(renameMarkerIcon(withIcon, icon.id, "  Hut ")?.markerIcons?.[0]!.name).toBe("Hut");
    expect(renameMarkerIcon(withIcon, icon.id, "  ")).toBeUndefined();
    expect(setMarkerIconAnchor(withIcon, icon.id, "bottom")?.markerIcons?.[0]).toEqual({ ...icon, anchor: "bottom" });
    expect(setMarkerIconAnchor({ ...withIcon, markerIcons: [{ ...icon, anchor: "bottom" }] }, icon.id, "center")?.markerIcons?.[0]).toEqual(icon);
    const removed = removeMarkerIcon(withIcon, icon.id);
    expect(removed.markerIcons).toBeUndefined();
    expect(removed.markers[0]).toEqual({ id: "a", lat: 1, lon: 2, symbol: "pin" });
    expect(removed.markers[1]).toBe(project.markers[1]);
  });
});

describe("custom line edits", () => {
  it("adds a two-point trail that stays inside the antimeridian", () => {
    const edge = withData({ location: { ...DEFAULT_PROJECT.location, lon: 180 } });
    const added = addCustomLine(edge, "l1")!.customLines[0]!;
    expect(added.kind).toBe("trail");
    expect(added.points.map((point) => point.lon)).toEqual([180, 179.998]);
  });

  it("respects the total point budget", () => {
    // One point short of the total budget, with l0 and l5 far below the per-line limit.
    const counts = [1000, MAX_CUSTOM_LINE_POINTS, MAX_CUSTOM_LINE_POINTS, MAX_CUSTOM_LINE_POINTS, MAX_CUSTOM_LINE_POINTS, MAX_CUSTOM_DATA_POINTS - 1000 - 4 * MAX_CUSTOM_LINE_POINTS - 1];
    const lines = counts.map((count, index) => line(`l${index}`, count));
    const nearlyFull = withData({ customLines: lines });
    expect(canAddCustomLine(nearlyFull)).toBe(false);
    expect(addCustomLine(nearlyFull, "extra")).toBeUndefined();
    expect(addCustomLinePoint(nearlyFull, "l0")).toBeDefined();
    expect(addCustomLinePoint(nearlyFull, "l1")).toBeUndefined();
    expect(addCustomLinePoint(withData(addCustomLinePoint(nearlyFull, "l0")!), "l0")).toBeUndefined();
  });

  it("edits, duplicates, and removes points while keeping at least two", () => {
    const project = withData({ customLines: [line("a", 3), line("b")] });
    expect(updateCustomLine(project, "b", { kind: "boundary" }).customLines[1]?.kind).toBe("boundary");
    expect(updateCustomLinePoint(project, "a", 1, { lat: 41 })?.customLines[0]?.points[1]).toEqual({ lat: 41, lon: -104.99 });
    expect(updateCustomLinePoint(project, "a", 1, { lon: 181 })).toBeUndefined();
    expect(updateCustomLinePoint(project, "a", 9, { lat: 1 })).toBeUndefined();
    expect(addCustomLinePoint(project, "a")?.customLines[0]?.points.at(-1)).toEqual(project.customLines[0]?.points.at(-1));
    expect(removeCustomLinePoint(project, "a", 0)?.customLines[0]?.points).toHaveLength(2);
    expect(removeCustomLinePoint(project, "b", 0)).toBeUndefined();
    expect(removeCustomLine(project, "a").customLines.map((item) => item.id)).toEqual(["b"]);
  });
});

describe("title plaque edits", () => {
  it("limits text to the accepted lines and length and starts from the project name", () => {
    expect(plaqueText(`${"A".repeat(50)}\nB\nC\nD`)).toBe(`${"A".repeat(40)}\nB\nC`);
    expect(clampPlaqueSize(1)).toBe(3);
    expect(clampPlaqueSize(99)).toBe(30);
    const first = plaqueSettings({ name: "Crater Lake", plaque: undefined }, { enabled: true });
    expect(first).toEqual({ enabled: true, text: "Crater Lake", sizeMm: 6, placement: { anchor: "bottom-left", offset: { x: 0, y: 0 } } });
    expect(plaqueSettings({ name: "Other", plaque: first }, { enabled: false })).toEqual({ ...first, enabled: false });
    const lettered = plaqueWithFont({ name: "Other", plaque: first }, "jost");
    expect(lettered).toEqual({ ...first, font: "jost" });
    expect("font" in plaqueWithFont({ name: "Other", plaque: lettered }, undefined)).toBe(false);
  });
});

describe("imported custom data", () => {
  it("reports the remaining allowance and appends pins and paths with fresh ids", () => {
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, markers: [{ id: "m", lat: 1, lon: 1, symbol: "star", sizeMm: 5 }], customLines: [{ id: "l", kind: "boundary", points: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, { lat: 3, lon: 3 }] }] };
    expect(customDataCapacity(project)).toEqual({ markers: MAX_MAP_MARKERS - 1, lines: 249, points: MAX_CUSTOM_DATA_POINTS - 3 });
    let id = 0;
    const patch = appendCustomData(project, { markers: [{ lat: 4, lon: 5 }], lines: [{ kind: "trail", points: [{ lat: 4, lon: 5 }, { lat: 6, lon: 7 }] }] }, () => `new-${id += 1}`);
    expect(patch.markers).toEqual([project.markers[0], { id: "new-1", lat: 4, lon: 5, symbol: "pin", sizeMm: 8 }]);
    expect(patch.customLines).toEqual([project.customLines[0], { id: "new-2", kind: "trail", points: [{ lat: 4, lon: 5 }, { lat: 6, lon: 7 }] }]);
  });
});

describe("placing markers on the map", () => {
  it("adds a pin at the clicked point unless it is unsupported or the list is full", () => {
    const patch = addMarkerAt(DEFAULT_PROJECT, "placed", { lat: 42.95, lon: -122.1 });
    expect(patch?.markers).toEqual([{ id: "placed", lat: 42.95, lon: -122.1, symbol: "pin", sizeMm: 8 }]);
    expect(addMarkerAt(DEFAULT_PROJECT, "polar", { lat: 89, lon: 0 })).toBeUndefined();
    const full = { ...DEFAULT_PROJECT, markers: Array.from({ length: MAX_MAP_MARKERS }, (_, index) => ({ id: String(index), lat: 1, lon: 1, symbol: "pin" as const, sizeMm: 8 })) };
    expect(addMarkerAt(full, "extra", { lat: 1, lon: 1 })).toBeUndefined();
  });
});

describe("drawing a path on the map", () => {
  const drawn = [{ lat: 42.95, lon: -122.1 }, { lat: 42.96, lon: -122.09 }, { lat: 42.96, lon: -122.11 }];

  it("adds an open path as a trail", () => {
    const patch = addDrawnCustomLine(DEFAULT_PROJECT, "drawn", drawn.slice(0, 2), false);
    expect(patch?.customLines).toEqual([{ id: "drawn", kind: "trail", points: drawn.slice(0, 2) }]);
  });

  it("closes a path back to where it started, as a boundary", () => {
    const patch = addDrawnCustomLine(DEFAULT_PROJECT, "drawn", drawn, true);
    // Geometry draws the points it is given and closes nothing itself.
    expect(patch?.customLines[0]).toEqual({ id: "drawn", kind: "boundary", points: [...drawn, drawn[0]] });
  });

  it("refuses a path too short to be one, or off the supported map", () => {
    expect(addDrawnCustomLine(DEFAULT_PROJECT, "drawn", drawn.slice(0, 1), false), "a trail needs two points").toBeUndefined();
    expect(addDrawnCustomLine(DEFAULT_PROJECT, "drawn", drawn.slice(0, 2), true), "a boundary needs three").toBeUndefined();
    expect(addDrawnCustomLine(DEFAULT_PROJECT, "drawn", [{ lat: 89, lon: 0 }, { lat: 88, lon: 0 }], false)).toBeUndefined();
  });

  it("stops the drawing at the point limits, counting the draft that is not in the project yet", () => {
    expect(canExtendDrawnLine(DEFAULT_PROJECT, 2)).toBe(true);
    // One point is held back so a full-length drawing can still be closed.
    expect(canExtendDrawnLine(DEFAULT_PROJECT, MAX_CUSTOM_LINE_POINTS - 2)).toBe(true);
    expect(canExtendDrawnLine(DEFAULT_PROJECT, MAX_CUSTOM_LINE_POINTS - 1)).toBe(false);
    expect(addDrawnCustomLine(DEFAULT_PROJECT, "full", Array.from({ length: MAX_CUSTOM_LINE_POINTS - 1 }, (_, index) => ({ lat: 40, lon: -105 + index * 1e-4 })), true), "the most a drawing can hold still closes").toBeDefined();
    const nearlyFull = withData({ customLines: [line("existing", MAX_CUSTOM_DATA_POINTS - 4)] });
    expect(canExtendDrawnLine(nearlyFull, 2)).toBe(true);
    expect(canExtendDrawnLine(nearlyFull, 3)).toBe(false);
  });
});

describe("naming markers and paths", () => {
  const named = withData({
    markers: [{ id: "m1", lat: 40, lon: -105, symbol: "pin" as const, sizeMm: 8 }],
    customLines: [line("l1")],
  });

  it("stores a trimmed name, and drops it again when it is blanked", () => {
    expect(renameMarker(named, "m1", "  Trailhead  ")?.markers[0]).toEqual({ id: "m1", lat: 40, lon: -105, symbol: "pin", sizeMm: 8, name: "Trailhead" });
    const cleared = renameMarker(withData({ markers: [{ ...named.markers[0]!, name: "Trailhead" }] }), "m1", "   ");
    expect(cleared?.markers[0], "an empty name is no name, not an empty one").toEqual({ id: "m1", lat: 40, lon: -105, symbol: "pin", sizeMm: 8 });
    expect(cleared?.markers[0]).not.toHaveProperty("name");
  });

  it("keeps a name within the contract's limit", () => {
    const long = "x".repeat(MAX_CUSTOM_DATA_NAME_LENGTH + 20);
    expect(renameMarker(named, "m1", long)?.markers[0]?.name).toHaveLength(MAX_CUSTOM_DATA_NAME_LENGTH);
    expect(renameCustomLine(named, "l1", long)?.customLines[0]?.name).toHaveLength(MAX_CUSTOM_DATA_NAME_LENGTH);
  });

  it("names a path and leaves everything else about it alone", () => {
    const patch = renameCustomLine(named, "l1", "North boundary");
    expect(patch?.customLines[0]).toEqual({ ...named.customLines[0], name: "North boundary" });
    expect(renameCustomLine(named, "missing", "Nowhere")).toBeUndefined();
    expect(renameMarker(named, "missing", "Nowhere")).toBeUndefined();
  });

  it("leaves the fingerprint alone, because a name carves nothing", () => {
    const renamed = { ...named, ...renameMarker(named, "m1", "Trailhead")!, ...renameCustomLine(named, "l1", "North boundary")! };
    expect(projectFingerprint(renamed)).toBe(projectFingerprint(named));
  });
});

describe("names typed during a generation", () => {
  it("puts the names typed since onto what the run was built from", () => {
    const built = [{ id: "a", name: "Old" }, { id: "b" }, { id: "c", name: "Gone" }];
    const live = [{ id: "a", name: "New" }, { id: "b", name: "Added" }, { id: "c" }];
    expect(withLiveNames(built, live)).toEqual([{ id: "a", name: "New" }, { id: "b", name: "Added" }, { id: "c" }]);
    // Something removed since keeps what it was built with, minus a name.
    expect(withLiveNames([{ id: "x", name: "Kept" }], [])).toEqual([{ id: "x" }]);
  });
});

describe("custom graphic edits", () => {
  const graphic = { id: "graphic-0001", name: "Logo", shapes: [{ outer: [-500, -500, 500, -500, 0, 500] }] };
  const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, cropShape: "rectangle", widthMm: 200, heightMm: 120 };

  it("adds graphics once each and renames them without blanking", () => {
    const added = addCustomGraphic(project, graphic)!;
    expect(added.graphicId).toBe(graphic.id);
    const withGraphic = { ...project, ...added.patch };
    expect(addCustomGraphic(withGraphic, { ...graphic, id: "graphic-0002" })?.graphicId).toBe(graphic.id);
    expect(renameCustomGraphic(withGraphic, graphic.id, "  ")).toBeUndefined();
    expect(renameCustomGraphic(withGraphic, graphic.id, "Badge")?.customGraphics?.[0]!.name).toBe("Badge");
  });

  it("places a graphic centered at a quarter of the shorter side, then edits and removes it", () => {
    const withGraphic = { ...project, customGraphics: [graphic] };
    expect(addPlacedGraphic(project, graphic.id, "placed-0001")).toBeUndefined();
    const placed = { ...withGraphic, ...addPlacedGraphic(withGraphic, graphic.id, "placed-0001")! };
    expect(placed.placedGraphics).toEqual([{ id: "placed-0001", graphicId: graphic.id, placement: { anchor: "center", offset: { x: 0, y: 0 } }, sizeMm: 30, rotationDeg: 0, operation: "engrave" }]);
    expect(updatePlacedGraphic(placed, "placed-0001", { operation: "cut", rotationDeg: -15 })?.placedGraphics?.[0]).toMatchObject({ operation: "cut", rotationDeg: 345 });
    expect(updatePlacedGraphic(placed, "placed-0001", { sizeMm: 1000 })?.placedGraphics?.[0]!.sizeMm).toBe(graphicMaximumMm(200, 120));
    expect(removePlacedGraphic(placed, "placed-0001")).toEqual({ placedGraphics: undefined });
    // Removing artwork removes its uses, and empty lists leave no fields.
    expect(removeCustomGraphic(placed, graphic.id)).toEqual({ customGraphics: undefined, placedGraphics: undefined });
    expect(projectFingerprint({ ...placed, ...removeCustomGraphic(placed, graphic.id) })).toBe(projectFingerprint(project));
  });
});
