import { activePlaque, GRAPHIC_MIN_SIZE_MM, groundWidthMFor, placedGraphicCenter, placedGraphicFootprint, placedGraphicMarkingPrefix, placedGraphicMarkings, placedGraphicPlacementAt, placedGraphicSource, type GraphicOperation, type PlacedGraphicV1, NORTH_ARROW_MIN_SIZE_MM, PLAQUE_MAX_SIZE_MM, PLAQUE_MIN_SIZE_MM, northArrowCenter, northArrowFootprint, northArrowMarkings, northArrowPlacementAt, plaqueBox, plaqueMarkings, plaquePlacementAt, scaleBarCenter, scaleBarFootprint, scaleBarMarkings, scaleBarPlacementAt, type PlaqueV1, MAX_PLACED_GRAPHICS, type GeometryIRV1, type OperationPath, type Point2D, type ProjectConfigV1 } from "@topostack/core";
import { t } from "$lib/i18n/i18n.svelte";
import { graphicMaximumMm, newPlacedGraphic, northArrowMaximumMm, plaqueSettings } from "$lib/studio/project-edits";

/**
 * Everything placement mode can move. Each entry reads and writes its position
 * through ordinary project fields, so a placement session is only a project
 * patch: previews evaluate the entries against the patched project, and Done
 * hands the patch to the normal generation pipeline, which bakes the item into
 * whichever sheets it lands on. See docs/placement.md.
 */
export type FixedPlaceableId = "north" | "plaque" | "scale";
/** The fixed annotations, and each placed graphic by its own id. */
export type PlaceableId = FixedPlaceableId | `graphic:${string}`;

export const graphicPlaceableId = (placedId: string): PlaceableId => `graphic:${placedId}`;
const placedIdOf = (id: PlaceableId): string | undefined => (id.startsWith("graphic:") ? id.slice("graphic:".length) : undefined);

/** Facts from the generated preview that some placeables are sized by. */
export interface PlacementContext {
  /** Ground width of the mapped area, which sets the scale bar's length. */
  groundWidthM: number;
}

export function placementContext(geometry: Pick<GeometryIRV1, "bounds">): PlacementContext {
  return { groundWidthM: groundWidthMFor(geometry.bounds) };
}

export interface Placeable {
  id: PlaceableId;
  label: string;
  /** What the toolbar calls this item when it has its own name, as an uploaded graphic does. */
  name?(project: ProjectConfigV1): string;
  available(project: ProjectConfigV1): boolean;
  /** Center in artwork millimeters, origin at the artwork center, y down. */
  center(project: ProjectConfigV1, context: PlacementContext): Point2D;
  /** Closed ring of the reserved area; the hit and focus target. */
  outline(project: ProjectConfigV1, context: PlacementContext): Point2D[];
  /** The engraving itself, from the same core functions generation uses. */
  markings(project: ProjectConfigV1, context: PlacementContext): OperationPath[];
  /** The patch that puts the center at `center`, kept inside the material. */
  moveTo(project: ProjectConfigV1, center: Point2D, context: PlacementContext): PlacementPatch;
  /** Id prefixes of the generated markings, hidden in the backdrop while a draft is shown. */
  bakedMarkingPrefixes: readonly string[];
  /** Present when the placeable can be resized in place: which size, its range and the patch that sets it. */
  resize?: PlaceableSize;
  /** Present when it can be turned: its clockwise angle in degrees and the patch that sets it. */
  rotate?: { value(project: ProjectConfigV1): number; set(project: ProjectConfigV1, degrees: number): PlacementPatch };
  /** Present when the laser operation is the maker's to choose in place. */
  operation?: { value(project: ProjectConfigV1): GraphicOperation; set(project: ProjectConfigV1, operation: GraphicOperation): PlacementPatch };
  /** Present when it can be taken off the piece during the session. */
  remove?(project: ProjectConfigV1): PlacementPatch;
}

export interface PlaceableSize {
  /** What the size measures, for the toolbar readout ("Diameter", "Letter height"). */
  label: string;
  value(project: ProjectConfigV1): number;
  range(project: ProjectConfigV1): { min: number; max: number };
  /** Keyboard step in millimeters. */
  step: number;
  set(project: ProjectConfigV1, sizeMm: number): PlacementPatch;
}

/** Matches the clearance core keeps between an anchored annotation and the crop edge. */
const PLAQUE_HANDLE_PAD_MM = 3;

export const PLACEABLES: Record<FixedPlaceableId, Placeable> = {
  north: {
    id: "north",
    get label() { return t("app.placeNorthArrow"); },
    available: (project) => project.showNorthArrow,
    center: northArrowCenter,
    outline: northArrowFootprint,
    markings: northArrowMarkings,
    moveTo: (project, center) => ({ northArrowPlacement: northArrowPlacementAt(project, center) }),
    bakedMarkingPrefixes: ["north-"],
    resize: {
      get label() { return t("app.placeDiameter"); },
      value: (project) => project.northArrowSizeMm,
      range: (project) => ({ min: NORTH_ARROW_MIN_SIZE_MM, max: northArrowMaximumMm(project.widthMm, project.heightMm) }),
      step: 1,
      set: (_project, sizeMm) => ({ northArrowSizeMm: sizeMm }),
    },
  },
  plaque: {
    id: "plaque",
    get label() { return t("app.placeTitle"); },
    available: (project) => activePlaque(project) !== undefined,
    center: (project) => plaqueBox(project)?.center ?? { x: 0, y: 0 },
    outline: (project) => {
      // The text block plus the edge clearance placement keeps, not the wider
      // knockout padding, so the handle never pokes past the material.
      const box = plaqueBox(project);
      if (!box) return [];
      const pad = Math.min((project.plaque?.sizeMm ?? 0) * 0.5, PLAQUE_HANDLE_PAD_MM);
      const left = box.center.x - box.width / 2 - pad; const right = box.center.x + box.width / 2 + pad;
      const top = box.center.y - box.height / 2 - pad; const bottom = box.center.y + box.height / 2 + pad;
      return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }];
    },
    markings: plaqueMarkings,
    moveTo: (project, center) => {
      const placement = plaquePlacementAt(project, center);
      return placement ? { plaque: { placement } } : {};
    },
    bakedMarkingPrefixes: ["plaque-"],
    resize: {
      get label() { return t("app.placeLetterHeight"); },
      value: (project) => project.plaque?.sizeMm ?? PLAQUE_MIN_SIZE_MM,
      range: () => ({ min: PLAQUE_MIN_SIZE_MM, max: PLAQUE_MAX_SIZE_MM }),
      step: 0.5,
      set: (_project, sizeMm) => ({ plaque: { sizeMm } }),
    },
  },
  scale: {
    id: "scale",
    get label() { return t("app.placeScaleBar"); },
    available: (project) => project.showScaleBar,
    center: (project, { groundWidthM }) => scaleBarCenter(project, groundWidthM),
    outline: (project, { groundWidthM }) => scaleBarFootprint(project, groundWidthM),
    markings: (project, { groundWidthM }) => scaleBarMarkings(project, groundWidthM),
    moveTo: (project, center, { groundWidthM }) => ({ scaleBarPlacement: scaleBarPlacementAt(project, groundWidthM, center) }),
    bakedMarkingPrefixes: ["scale-"],
  },
};

export const PLACEABLE_ORDER: readonly FixedPlaceableId[] = ["north", "plaque", "scale"];

function withPlaced(project: ProjectConfigV1, placedId: string, change: (placed: PlacedGraphicV1) => PlacedGraphicV1): PlacementPatch {
  return { placedGraphics: (project.placedGraphics ?? []).map((placed) => placed.id === placedId ? change(placed) : placed) };
}

/**
 * One placed graphic as a placeable. Its position, size, angle and operation
 * all live on its entry in `placedGraphics`, so every change is a new list.
 * Turning and resizing keep its center, since both change how far it may travel.
 */
function graphicPlaceable(placedId: string): Placeable {
  const find = (project: ProjectConfigV1) => project.placedGraphics?.find((placed) => placed.id === placedId);
  const recentered = (project: ProjectConfigV1, change: (placed: PlacedGraphicV1) => PlacedGraphicV1): PlacementPatch => {
    const placed = find(project);
    if (!placed) return {};
    const center = placedGraphicCenter(project, placed) ?? { x: 0, y: 0 };
    return withPlaced(project, placedId, (current) => {
      const next = change(current);
      return { ...next, placement: placedGraphicPlacementAt(project, next, center) };
    });
  };
  return {
    id: graphicPlaceableId(placedId),
    get label() { return t("app.placeGraphic"); },
    name: (project) => {
      const placed = find(project);
      const graphic = placed && placedGraphicSource(project, placed);
      return graphic ? t("app.placedGraphicName", { name: graphic.name, operation: placed.operation }) : t("app.placeGraphic");
    },
    available: (project) => {
      const placed = find(project);
      return Boolean(placed && placedGraphicSource(project, placed));
    },
    center: (project) => {
      const placed = find(project);
      return (placed && placedGraphicCenter(project, placed)) ?? { x: 0, y: 0 };
    },
    outline: (project) => {
      const placed = find(project);
      return (placed && placedGraphicFootprint(project, placed)) ?? [];
    },
    markings: (project) => {
      const placed = find(project);
      return placed ? placedGraphicMarkings(project, placed) : [];
    },
    moveTo: (project, center) => withPlaced(project, placedId, (placed) => ({ ...placed, placement: placedGraphicPlacementAt(project, placed, center) })),
    bakedMarkingPrefixes: [placedGraphicMarkingPrefix(placedId)],
    resize: {
      get label() { return t("app.placeSize"); },
      value: (project) => find(project)?.sizeMm ?? GRAPHIC_MIN_SIZE_MM,
      range: (project) => ({ min: GRAPHIC_MIN_SIZE_MM, max: graphicMaximumMm(project.widthMm, project.heightMm) }),
      step: 1,
      set: (project, sizeMm) => withPlaced(project, placedId, (placed) => ({ ...placed, sizeMm })),
    },
    rotate: {
      value: (project) => find(project)?.rotationDeg ?? 0,
      set: (project, degrees) => recentered(project, (placed) => ({ ...placed, rotationDeg: normalizedDegrees(degrees) })),
    },
    operation: {
      value: (project) => find(project)?.operation ?? "engrave",
      set: (project, operation) => withPlaced(project, placedId, (placed) => ({ ...placed, operation })),
    },
    remove: (project) => ({ placedGraphics: (project.placedGraphics ?? []).filter((placed) => placed.id !== placedId) }),
  };
}

/** An angle in [0, 360), to a tenth of a degree. */
function normalizedDegrees(degrees: number): number {
  const rounded = Math.round(degrees * 10) / 10;
  return ((rounded % 360) + 360) % 360;
}

/** The placeable an id names: a fixed annotation, or a placed graphic. */
export function placeableFor(id: PlaceableId): Placeable {
  const placedId = placedIdOf(id);
  return placedId === undefined ? PLACEABLES[id as FixedPlaceableId] : graphicPlaceable(placedId);
}

/** Only fields owned by placement, so unrelated live edits cannot be overwritten. */
export type PlacementPatch = Partial<Pick<ProjectConfigV1, "northArrowPlacement" | "northArrowSizeMm" | "scaleBarPlacement" | "placedGraphics">> & {
  plaque?: Partial<Pick<PlaqueV1, "placement" | "sizeMm">>;
};

export function placementPatch(project: ProjectConfigV1, draft: PlacementPatch): Partial<ProjectConfigV1> {
  const { plaque, placedGraphics, ...rest } = draft;
  return {
    ...rest,
    ...(plaque ? { plaque: plaqueSettings(project, plaque) } : {}),
    // Artwork removed from the library while placing takes its drafts with it; an empty list leaves no field.
    ...(placedGraphics ? { placedGraphics: liveGraphics(project, placedGraphics) } : {}),
  };
}

function liveGraphics(project: ProjectConfigV1, placedGraphics: PlacedGraphicV1[]): PlacedGraphicV1[] | undefined {
  const live = placedGraphics.filter((placed) => placedGraphicSource(project, placed));
  return live.length ? live : undefined;
}

function mergeDraft(draft: PlacementPatch, patch: PlacementPatch): PlacementPatch {
  return { ...draft, ...patch, ...(patch.plaque ? { plaque: { ...draft.plaque, ...patch.plaque } } : {}) };
}

export interface PlacementSession {
  selected: PlaceableId;
  /** Uncommitted position changes, as a project patch. */
  draft: PlacementPatch;
}

export function draftProject(project: ProjectConfigV1, session: PlacementSession): ProjectConfigV1 {
  return { ...project, ...placementPatch(project, session.draft) };
}

/** Placeables shown in a session, in tab order: the fixed annotations, then graphics in project order. */
export function availablePlaceables(project: ProjectConfigV1): Placeable[] {
  const fixed: Placeable[] = PLACEABLE_ORDER.map((id) => PLACEABLES[id]);
  const graphics = (project.placedGraphics ?? []).map((placed) => graphicPlaceable(placed.id));
  return [...fixed, ...graphics].filter((placeable) => placeable.available(project));
}

/** Whether a session has anything to do: an item to move, or a graphic that could be added. */
export function canPlace(project: ProjectConfigV1): boolean {
  return availablePlaceables(project).length > 0 || Boolean(project.customGraphics?.length);
}

/** The session with `id` moved to `center`, merged into the existing draft. */
export function movePlaceable(project: ProjectConfigV1, session: PlacementSession, id: PlaceableId, center: Point2D, context: PlacementContext): PlacementSession {
  const patch = placeableFor(id).moveTo(draftProject(project, session), center, context);
  return { selected: id, draft: mergeDraft(session.draft, patch) };
}

/** The session with `id` turned to `degrees` about its center. */
export function rotatePlaceable(project: ProjectConfigV1, session: PlacementSession, id: PlaceableId, degrees: number): PlacementSession {
  const rotate = placeableFor(id).rotate;
  if (!rotate || !Number.isFinite(degrees)) return session;
  return { selected: id, draft: mergeDraft(session.draft, rotate.set(draftProject(project, session), degrees)) };
}

/** The session with a graphic's laser operation changed. */
export function setPlaceableOperation(project: ProjectConfigV1, session: PlacementSession, id: PlaceableId, operation: GraphicOperation): PlacementSession {
  const control = placeableFor(id).operation;
  if (!control) return session;
  return { selected: id, draft: mergeDraft(session.draft, control.set(draftProject(project, session), operation)) };
}

/** The session with a new use of `graphicId`, centered and selected; undefined when the graphic is unknown or the piece is full. */
export function addGraphicToSession(project: ProjectConfigV1, session: PlacementSession | undefined, graphicId: string, placedId: string): PlacementSession | undefined {
  const draft = session ? draftProject(project, session) : project;
  if (!draft.customGraphics?.some((graphic) => graphic.id === graphicId) || (draft.placedGraphics?.length ?? 0) >= MAX_PLACED_GRAPHICS) return undefined;
  const placedGraphics = [...draft.placedGraphics ?? [], newPlacedGraphic(draft, graphicId, placedId)];
  return { selected: graphicPlaceableId(placedId), draft: mergeDraft(session?.draft ?? {}, { placedGraphics }) };
}

/** The session with `id` taken off the piece, selecting the next item if there is one. */
export function removePlaceable(project: ProjectConfigV1, session: PlacementSession, id: PlaceableId): PlacementSession {
  const remove = placeableFor(id).remove;
  if (!remove) return session;
  const before = availablePlaceables(draftProject(project, session)).map((placeable) => placeable.id);
  const next = { ...session, draft: mergeDraft(session.draft, remove(draftProject(project, session))) };
  const after = availablePlaceables(draftProject(project, next)).map((placeable) => placeable.id);
  const index = Math.max(0, before.indexOf(id));
  return { ...next, selected: after[Math.min(index, after.length - 1)] ?? session.selected };
}

/**
 * The session with `id` resized to `sizeMm`, clamped to its range, about its
 * current center: the anchored travel depends on the size, so the placement
 * is recomputed for the new size rather than kept.
 */
export function resizePlaceable(project: ProjectConfigV1, session: PlacementSession, id: PlaceableId, sizeMm: number, context: PlacementContext): PlacementSession {
  const placeable = placeableFor(id);
  if (!placeable.resize || !Number.isFinite(sizeMm)) return session;
  const draft = draftProject(project, session);
  const { min, max } = placeable.resize.range(draft);
  const clamped = Math.min(max, Math.max(min, Math.round(sizeMm * 10) / 10));
  const center = placeable.center(draft, context);
  const sizePatch = placeable.resize.set(draft, clamped);
  const sized = { ...draft, ...placementPatch(draft, sizePatch) };
  return { selected: id, draft: mergeDraft(mergeDraft(session.draft, sizePatch), placeable.moveTo(sized, center, context)) };
}

/** Prefixes to hide in a backdrop while these placeables are drawn as drafts. */
export function hiddenMarkingPrefixes(project: ProjectConfigV1): string[] {
  const fixed = PLACEABLE_ORDER.map((id) => PLACEABLES[id]).filter((placeable) => placeable.available(project));
  // Every graphic is drafted while placing, including ones the session adds or removes.
  return [...fixed.flatMap((placeable) => placeable.bakedMarkingPrefixes), ...(project.placedGraphics?.length ? [GRAPHIC_MARKING_PREFIX] : [])];
}

const GRAPHIC_MARKING_PREFIX = "graphic-";

export function hiddenByPrefix(id: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => id.startsWith(prefix));
}
