import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, GRAPHIC_MIN_SIZE_MM, generateGeometry, groundWidthMFor, MAX_PLACED_GRAPHICS, PLAQUE_MIN_SIZE_MM, validateProject, type Point2D, type ProjectConfigV1 } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";
import { addGraphicToSession, availablePlaceables, canPlace, draftProject, graphicPlaceableId, hiddenByPrefix, hiddenMarkingPrefixes, movePlaceable, placeableFor, placementContext, placementPatch, PLACEABLES, PLACEABLE_ORDER, removePlaceable, resizePlaceable, rotatePlaceable, setPlaceableOperation, type PlacementSession } from "./placeables";

const context = { groundWidthM: 20_000 };
import { placementFrustum, placementViewBox } from "./viewport";

const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, plaque: { enabled: true, text: "Crater Lake", sizeMm: 6, placement: { anchor: "bottom-left", offset: { x: 0, y: 0 } } } };

describe("placeables", () => {
  it("keeps resized values valid at fractional maximum sizes", () => {
    for (const dimension of [101, 101.1, 101.23]) {
      const small = { ...project, widthMm: dimension, heightMm: dimension };
      const session = resizePlaceable(small, { selected: "north", draft: {} }, "north", 999, context);
      expect(() => validateProject(draftProject(small, session))).not.toThrow();
    }
  });

  it("merges only edited title fields over live text, font, and visibility", () => {
    let session = movePlaceable(project, { selected: "plaque", draft: {} }, "plaque", { x: 0, y: 0 }, context);
    session = resizePlaceable(project, session, "plaque", 7, context);
    session = movePlaceable(project, session, "plaque", { x: 1, y: 2 }, context);
    expect(Object.keys(session.draft.plaque!).sort()).toEqual(["placement", "sizeMm"]);
    const live = { ...project, plaque: { ...project.plaque!, text: "Updated", font: "rounded" as const, enabled: false } };
    expect(draftProject(live, session).plaque).toMatchObject({ text: "Updated", font: "rounded", enabled: false, sizeMm: 7 });
    expect(draftProject(live, session).plaque?.placement).toEqual(session.draft.plaque?.placement);
  });

  it("moves each placeable to the dropped center and draws it there", () => {
    for (const id of PLACEABLE_ORDER) {
      const session = movePlaceable(project, { selected: id, draft: {} }, id, { x: 12, y: -9 }, context);
      const moved = draftProject(project, session);
      const center = PLACEABLES[id].center(moved, context);
      expect(center.x).toBeCloseTo(12, 4);
      expect(center.y).toBeCloseTo(-9, 4);
      const points = PLACEABLES[id].markings(moved, context).flatMap((marking) => marking.points);
      const mean = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
      expect(Math.abs(mean.x - 12)).toBeLessThan(id === "north" ? 3 : 40);
      expect(Math.abs(mean.y + 9)).toBeLessThan(10);
    }
  });

  it("merges moves into one draft and leaves the project alone", () => {
    let session: PlacementSession = { selected: "north", draft: {} };
    session = movePlaceable(project, session, "north", { x: 5, y: 5 }, context);
    session = movePlaceable(project, session, "plaque", { x: -5, y: 0 }, context);
    expect(Object.keys(session.draft).sort()).toEqual(["northArrowPlacement", "plaque"]);
    expect(session.selected).toBe("plaque");
    expect(project.northArrowPlacement).toEqual(DEFAULT_PROJECT.northArrowPlacement);
    expect(draftProject(project, session).plaque?.text).toBe("Crater Lake");
  });

  it("resizes about the current center, within each item's range", () => {
    let session: PlacementSession = movePlaceable(project, { selected: "north", draft: {} }, "north", { x: 20, y: -10 }, context);
    session = resizePlaceable(project, session, "north", 40, context);
    let draft = draftProject(project, session);
    expect(draft.northArrowSizeMm).toBe(40);
    expect(PLACEABLES.north.center(draft, context).x).toBeCloseTo(20, 4);
    expect(PLACEABLES.north.center(draft, context).y).toBeCloseTo(-10, 4);
    session = resizePlaceable(project, session, "north", 1, context);
    expect(draftProject(project, session).northArrowSizeMm).toBe(12);
    session = resizePlaceable(project, session, "plaque", 99, context);
    draft = draftProject(project, session);
    expect(draft.plaque?.sizeMm).toBe(30);
    expect(draft.plaque?.text).toBe("Crater Lake");
    // The scale bar's length follows the map scale, so it only moves.
    expect(PLACEABLES.scale.resize).toBeUndefined();
    expect(resizePlaceable(project, session, "scale", 50, context)).toBe(session);
  });

  it("offers only switched-on placeables", () => {
    expect(availablePlaceables(project).map((placeable) => placeable.id)).toEqual(["north", "plaque", "scale"]);
    expect(availablePlaceables({ ...project, showNorthArrow: false, showScaleBar: false, plaque: { ...project.plaque!, enabled: false } })).toEqual([]);
    expect(availablePlaceables({ ...project, showScaleBar: false, plaque: { ...project.plaque!, text: "  " } }).map((placeable) => placeable.id)).toEqual(["north"]);
  });

  it("hides exactly the generated markings of the placeables", () => {
    const geometry = generateGeometry({ ...project, outputMode: "engraving" }, createSamplePreviewSource());
    const prefixes = hiddenMarkingPrefixes(project);
    const markings = geometry.layers.flatMap((layer) => layer.markings);
    const hidden = markings.filter((marking) => hiddenByPrefix(marking.id, prefixes));
    expect(hidden.some((marking) => marking.id.startsWith("north-"))).toBe(true);
    expect(hidden.some((marking) => marking.id.startsWith("plaque-"))).toBe(true);
    expect(hidden.some((marking) => marking.id.startsWith("scale-"))).toBe(true);
    expect(markings.filter((marking) => !hiddenByPrefix(marking.id, prefixes)).some((marking) => /north|plaque|scale/.test(marking.id))).toBe(false);
  });
});

describe("fixed placeable outlines and controls", () => {
  const extent = (ring: Point2D[]) => ({ minX: Math.min(...ring.map(({ x }) => x)), maxX: Math.max(...ring.map(({ x }) => x)), minY: Math.min(...ring.map(({ y }) => y)), maxY: Math.max(...ring.map(({ y }) => y)) });

  it("sizes the scale bar from the generated map's ground width", () => {
    const bounds = { west: -122.3, south: 42.8, east: -121.9, north: 43.1 };
    expect(placementContext({ bounds })).toEqual({ groundWidthM: groundWidthMFor(bounds) });
  });

  it("outlines the title's text block with the edge clearance, as a closed ring around its center", () => {
    const outline = PLACEABLES.plaque.outline(project, context);
    expect(outline).toHaveLength(5);
    expect(outline[0]).toEqual(outline[4]);
    const box = extent(outline);
    const center = PLACEABLES.plaque.center(project, context);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(center.x, 6);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(center.y, 6);
    // Small letters get half their height as clearance rather than the full 3 mm.
    const small = { ...project, plaque: { ...project.plaque!, sizeMm: 4 } };
    const large = extent(PLACEABLES.plaque.outline(project, context));
    const tight = extent(PLACEABLES.plaque.outline(small, context));
    expect(tight.maxY - tight.minY).toBeLessThan(large.maxY - large.minY);
  });

  it("gives a switched-off title no outline and no move", () => {
    const off = { ...project, plaque: { ...project.plaque!, enabled: false } };
    expect(PLACEABLES.plaque.outline(off, context)).toEqual([]);
    expect(PLACEABLES.plaque.center(off, context)).toEqual({ x: 0, y: 0 });
    expect(PLACEABLES.plaque.moveTo(off, { x: 10, y: 10 }, context)).toEqual({});
    expect(PLACEABLES.plaque.resize!.value(DEFAULT_PROJECT)).toBe(PLAQUE_MIN_SIZE_MM);
    expect(PLACEABLES.plaque.resize!.value(project)).toBe(6);
  });

  it("outlines the scale bar around where it is drawn", () => {
    const box = extent(PLACEABLES.scale.outline(project, context));
    const center = PLACEABLES.scale.center(project, context);
    expect(center.x).toBeGreaterThan(box.minX);
    expect(center.x).toBeLessThan(box.maxX);
    expect(center.y).toBeGreaterThanOrEqual(box.minY);
    expect(center.y).toBeLessThanOrEqual(box.maxY);
  });

  it("reads the north arrow's diameter and caps it by the material", () => {
    expect(PLACEABLES.north.resize!.value(project)).toBe(project.northArrowSizeMm);
    expect(PLACEABLES.north.resize!.range({ ...project, widthMm: 60, heightMm: 300 }).max).toBeLessThan(PLACEABLES.north.resize!.range(project).max);
  });

  it("leaves the session alone for controls a fixed annotation does not have", () => {
    const session: PlacementSession = { selected: "north", draft: {} };
    expect(rotatePlaceable(project, session, "north", 45)).toBe(session);
    expect(setPlaceableOperation(project, session, "scale", "cut")).toBe(session);
    expect(removePlaceable(project, session, "plaque")).toBe(session);
    expect(resizePlaceable(project, session, "north", Number.NaN, context)).toBe(session);
  });
});

describe("graphic placeables", () => {
  const graphic = { id: "graphic-0001", name: "Badge", shapes: [{ outer: [-500, -250, 500, -250, 500, 250, -500, 250] }] };
  const withLibrary: ProjectConfigV1 = { ...project, customGraphics: [graphic] };
  const added = addGraphicToSession(withLibrary, undefined, graphic.id, "placed-0001")!;
  const id = graphicPlaceableId("placed-0001");

  it("adds a graphic to the draft, not the project, and selects it", () => {
    expect(added.selected).toBe(id);
    expect(withLibrary.placedGraphics).toBeUndefined();
    const draft = draftProject(withLibrary, added);
    expect(availablePlaceables(draft).map((placeable) => placeable.id)).toEqual(["north", "plaque", "scale", id]);
    expect(placeableFor(id).name?.(draft)).toBe("Badge, engraved");
    expect(addGraphicToSession(withLibrary, added, "graphic-9999", "placed-0002")).toBeUndefined();
    expect(() => validateProject(draft)).not.toThrow();
  });

  it("moves, resizes and turns a graphic about its center, and changes what the laser does", () => {
    let session = movePlaceable(withLibrary, added, id, { x: 20, y: 10 }, context);
    session = resizePlaceable(withLibrary, session, id, 30, context);
    session = rotatePlaceable(withLibrary, session, id, 90);
    session = setPlaceableOperation(withLibrary, session, id, "score");
    const draft = draftProject(withLibrary, session);
    const center = placeableFor(id).center(draft, context);
    expect(center.x).toBeCloseTo(20, 4);
    expect(center.y).toBeCloseTo(10, 4);
    expect(draft.placedGraphics![0]).toMatchObject({ sizeMm: 30, rotationDeg: 90, operation: "score" });
    // Turned a quarter, the 2:1 badge stands 30 mm tall and 15 mm wide.
    const outline = placeableFor(id).outline(draft, context);
    const ys = outline.map(({ y }) => y); const xs = outline.map(({ x }) => x);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30, 4);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(15, 4);
    expect(draftProject(withLibrary, rotatePlaceable(withLibrary, session, id, -30)).placedGraphics![0]!.rotationDeg).toBe(330);
    expect(() => validateProject(draft)).not.toThrow();
  });

  it("removes a graphic and keeps the session open while the library can add another", () => {
    const removed = removePlaceable(withLibrary, added, id);
    const draft = draftProject(withLibrary, removed);
    expect(draft.placedGraphics).toBeUndefined();
    expect(canPlace({ ...draft, showNorthArrow: false, showScaleBar: false, plaque: undefined })).toBe(true);
    expect(canPlace({ ...draft, showNorthArrow: false, showScaleBar: false, plaque: undefined, customGraphics: undefined })).toBe(false);
  });

  it("draws a placed graphic's markings where it is placed", () => {
    const draft = draftProject(withLibrary, added);
    const markings = placeableFor(id).markings(draft, context);
    expect(markings.length).toBeGreaterThan(0);
    expect(markings.every((marking) => hiddenByPrefix(marking.id, placeableFor(id).bakedMarkingPrefixes))).toBe(true);
  });

  it("treats a graphic missing from the project as an inert placeholder", () => {
    const ghost = placeableFor(graphicPlaceableId("placed-gone"));
    expect(ghost.available(withLibrary)).toBe(false);
    expect(ghost.name?.(withLibrary)).toBe("Graphic");
    expect(ghost.center(withLibrary, context)).toEqual({ x: 0, y: 0 });
    expect(ghost.outline(withLibrary, context)).toEqual([]);
    expect(ghost.markings(withLibrary, context)).toEqual([]);
    expect(ghost.resize!.value(withLibrary)).toBe(GRAPHIC_MIN_SIZE_MM);
    expect(ghost.rotate!.value(withLibrary)).toBe(0);
    expect(ghost.operation!.value(withLibrary)).toBe("engrave");
    expect(ghost.rotate!.set(withLibrary, 90)).toEqual({});
    // A graphic whose artwork left the library is not offered either.
    const orphaned = { ...draftProject(withLibrary, added), customGraphics: undefined };
    expect(placeableFor(id).available(orphaned)).toBe(false);
    expect(placeableFor(id).name?.(orphaned)).toBe("Graphic");
  });

  it("ignores a turn to an angle that is not a number", () => {
    expect(rotatePlaceable(withLibrary, added, id, Number.POSITIVE_INFINITY)).toBe(added);
  });

  it("keeps the selection when removing the only item leaves nothing to select", () => {
    const bare = { ...withLibrary, showNorthArrow: false, showScaleBar: false, plaque: undefined };
    const session = addGraphicToSession(bare, undefined, graphic.id, "placed-0001")!;
    const removed = removePlaceable(bare, session, id);
    expect(removed.selected).toBe(id);
    expect(availablePlaceables(draftProject(bare, removed))).toEqual([]);
  });

  it("selects the next item after removing a graphic from the middle", () => {
    let session = addGraphicToSession(withLibrary, added, graphic.id, "placed-0002")!;
    session = addGraphicToSession(withLibrary, session, graphic.id, "placed-0003")!;
    expect(removePlaceable(withLibrary, session, graphicPlaceableId("placed-0002")).selected).toBe(graphicPlaceableId("placed-0003"));
  });

  it("refuses another graphic once the piece holds the most it can", () => {
    const placed = draftProject(withLibrary, added).placedGraphics![0]!;
    const full = { ...withLibrary, placedGraphics: Array.from({ length: MAX_PLACED_GRAPHICS }, (_, index) => ({ ...placed, id: `placed-${index}` })) };
    expect(addGraphicToSession(full, undefined, graphic.id, "placed-extra")).toBeUndefined();
  });

  it("drops drafts of artwork removed from the library before committing", () => {
    expect(placementPatch({ ...withLibrary, customGraphics: undefined }, added.draft)).toEqual({ placedGraphics: undefined });
  });

  it("hides every generated graphic marking while placing", () => {
    const committed = { ...withLibrary, outputMode: "engraving" as const, ...placementPatch(withLibrary, added.draft) };
    const geometry = generateGeometry(committed, createSamplePreviewSource());
    const prefixes = hiddenMarkingPrefixes(committed);
    const graphics = geometry.layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("graphic-"));
    expect(graphics.length).toBeGreaterThan(0);
    expect(graphics.every((marking) => hiddenByPrefix(marking.id, prefixes))).toBe(true);
    expect(graphics.every((marking) => hiddenByPrefix(marking.id, placeableFor(id).bakedMarkingPrefixes))).toBe(true);
  });
});

describe("placement viewport", () => {
  it("frames the artwork like an SVG viewBox with xMidYMid meet", () => {
    const box = placementViewBox(200, 100, 10);
    expect(box).toEqual({ x: -110, y: -60, width: 220, height: 120 });
    // A tall stage fits the width; the height gains room.
    expect(placementFrustum(box, 440, 600)).toEqual({ halfWidth: 110, halfHeight: 150 });
    // A wide stage fits the height.
    expect(placementFrustum(box, 1200, 240)).toEqual({ halfWidth: 300, halfHeight: 60 });
  });
});
