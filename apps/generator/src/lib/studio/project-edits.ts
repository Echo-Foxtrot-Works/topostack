import { DEFAULT_PLAQUE_SIZE_MM, PLAQUE_MAX_LINE_LENGTH, PLAQUE_MAX_LINES, PLAQUE_MAX_SIZE_MM, PLAQUE_MIN_SIZE_MM, type PlaqueV1, type TextFont, MAP_MARKER_SIZE_MM, MAP_MARKER_MIN_SIZE_MM, MAP_MARKER_MAX_SIZE_MM, MAX_CUSTOM_DATA_NAME_LENGTH, MAX_CUSTOM_DATA_POINTS, MAX_CUSTOM_LINE_POINTS, MAX_CUSTOM_LINES, MAX_MAP_MARKERS, type CustomLineFeatureV1, type GeoPoint, type MapMarkerV1, type MarkerIconV1, MAX_MARKER_ICONS, type ProjectConfigV1, GRAPHIC_MAX_SIZE_MM, GRAPHIC_MIN_SIZE_MM, MAX_CUSTOM_GRAPHICS, MAX_PLACED_GRAPHICS, type CustomGraphicV1, type PlacedGraphicV1 } from "@topostack/core";
import { clampLongitude, isSupportedCoordinate } from "$lib/domain/coordinates";

/**
 * Pure edits for user-authored markers and paths. Each returns the project
 * patch to apply, or `undefined` when the edit is not allowed.
 */
type Project = Pick<ProjectConfigV1, "location" | "markers" | "customLines" | "markerIcons">;
type MarkersPatch = Pick<ProjectConfigV1, "markers">;
type MarkerIconsPatch = Pick<ProjectConfigV1, "markers" | "markerIcons">;
type CustomLinesPatch = Pick<ProjectConfigV1, "customLines">;

/** The largest north arrow that fits a map of this size; agent requests clamp with the same rule. */
export { northArrowMaximumMm } from "@topostack/core";

function customDataPointCount(project: Pick<ProjectConfigV1, "customLines">): number {
  return project.customLines.reduce((total, line) => total + line.points.length, 0);
}

/** @public Panels read this through `StudioContext.edits`. */
export const canAddMarker = (project: Pick<ProjectConfigV1, "markers">): boolean => project.markers.length < MAX_MAP_MARKERS;
export const canAddCustomLine = (project: Pick<ProjectConfigV1, "customLines">): boolean =>
  project.customLines.length < MAX_CUSTOM_LINES && customDataPointCount(project) + 2 <= MAX_CUSTOM_DATA_POINTS;
/** @public Panels read this through `StudioContext.edits`. */
export const canAddCustomLinePoint = (project: Pick<ProjectConfigV1, "customLines">, line: CustomLineFeatureV1): boolean =>
  line.points.length < MAX_CUSTOM_LINE_POINTS && customDataPointCount(project) < MAX_CUSTOM_DATA_POINTS;

export function addMarker(project: Project, id: string): MarkersPatch | undefined {
  if (!canAddMarker(project)) return undefined;
  const marker: MapMarkerV1 = { id, lat: project.location.lat, lon: project.location.lon, symbol: "pin", sizeMm: MAP_MARKER_SIZE_MM };
  return { markers: [...project.markers, marker] };
}

/** A pin at a chosen point, as placed by clicking the map. */
export function addMarkerAt(project: Project, id: string, point: GeoPoint): MarkersPatch | undefined {
  if (!canAddMarker(project) || !isSupportedCoordinate(point.lat, point.lon)) return undefined;
  return { markers: [...project.markers, { id, lat: point.lat, lon: point.lon, symbol: "pin", sizeMm: MAP_MARKER_SIZE_MM }] };
}

export function updateMarker(project: Project, id: string, patch: Partial<MapMarkerV1>): MarkersPatch | undefined {
  const current = project.markers.find((marker) => marker.id === id);
  if (!current) return undefined;
  const { iconId: _previousIcon, ...rest } = { ...current, ...patch };
  // Only a custom marker names an icon, and only one the project has.
  const iconId = rest.symbol === "custom" ? patch.iconId ?? current.iconId : undefined;
  if (rest.symbol === "custom" && !project.markerIcons?.some((icon) => icon.id === iconId)) return undefined;
  const next: MapMarkerV1 = iconId === undefined ? rest : { ...rest, iconId };
  if (!isSupportedCoordinate(next.lat, next.lon)) return undefined;
  const size = next.sizeMm === undefined ? MAP_MARKER_SIZE_MM : next.sizeMm;
  if (!Number.isFinite(size) || size < MAP_MARKER_MIN_SIZE_MM || size > MAP_MARKER_MAX_SIZE_MM) return undefined;
  return { markers: project.markers.map((marker) => marker.id === id ? next : marker) };
}

/**
 * A name as it is stored: trimmed, within the contract's limit, and dropped
 * entirely when it is blank. An empty name is no name, not an empty one.
 */
function storedName(name: string): string | undefined {
  const trimmed = name.trim().slice(0, MAX_CUSTOM_DATA_NAME_LENGTH);
  return trimmed || undefined;
}

/** Names a marker, so a long list can be read. Nothing is engraved from it. */
export function renameMarker(project: Project, id: string, name: string): MarkersPatch | undefined {
  if (!project.markers.some((marker) => marker.id === id)) return undefined;
  return {
    markers: project.markers.map((marker) => {
      if (marker.id !== id) return marker;
      const { name: _previous, ...rest } = marker;
      const next = storedName(name);
      return next === undefined ? rest : { ...rest, name: next };
    }),
  };
}

export function removeMarker(project: Project, id: string): MarkersPatch {
  return { markers: project.markers.filter((marker) => marker.id !== id) };
}

/** @public Panels read this through `StudioContext.edits`. */
export const canAddMarkerIcon = (project: Pick<ProjectConfigV1, "markerIcons">): boolean => (project.markerIcons?.length ?? 0) < MAX_MARKER_ICONS;

const sameShapes = (left: MarkerIconV1, right: MarkerIconV1) => JSON.stringify(left.shapes) === JSON.stringify(right.shapes);

/**
 * Adds an uploaded icon, or finds the same drawing already in the project,
 * and returns the patch with the id markers should use.
 */
export function addMarkerIcon(project: Pick<ProjectConfigV1, "markers" | "markerIcons">, icon: MarkerIconV1): { patch: MarkerIconsPatch; iconId: string } | undefined {
  const existing = project.markerIcons?.find((candidate) => sameShapes(candidate, icon) && (candidate.anchor ?? "center") === (icon.anchor ?? "center"));
  if (existing) return { patch: { markers: project.markers, markerIcons: project.markerIcons }, iconId: existing.id };
  if (!canAddMarkerIcon(project)) return undefined;
  const name = storedName(icon.name) ?? "Icon";
  return { patch: { markers: project.markers, markerIcons: [...project.markerIcons ?? [], { ...icon, name }] }, iconId: icon.id };
}

/** Renames an icon; a blank name keeps the old one, since every icon needs a label in the picker. */
export function renameMarkerIcon(project: Pick<ProjectConfigV1, "markers" | "markerIcons">, id: string, name: string): MarkerIconsPatch | undefined {
  const next = storedName(name);
  if (!next || !project.markerIcons?.some((icon) => icon.id === id)) return undefined;
  return { markers: project.markers, markerIcons: project.markerIcons.map((icon) => icon.id === id ? { ...icon, name: next } : icon) };
}

/** Whether an icon's lowest point or its middle sits on the marker's position. */
export function setMarkerIconAnchor(project: Pick<ProjectConfigV1, "markers" | "markerIcons">, id: string, anchor: "center" | "bottom"): MarkerIconsPatch | undefined {
  if (!project.markerIcons?.some((icon) => icon.id === id)) return undefined;
  return {
    markers: project.markers,
    markerIcons: project.markerIcons.map((icon) => {
      if (icon.id !== id) return icon;
      const { anchor: _previous, ...rest } = icon;
      return anchor === "bottom" ? { ...rest, anchor } : rest;
    }),
  };
}

/** Removes an icon; markers that drew it become pins where they stand. */
export function removeMarkerIcon(project: Pick<ProjectConfigV1, "markers" | "markerIcons">, id: string): MarkerIconsPatch {
  const markerIcons = (project.markerIcons ?? []).filter((icon) => icon.id !== id);
  return {
    markers: project.markers.map((marker) => {
      if (marker.iconId !== id) return marker;
      const { iconId: _removed, ...rest } = marker;
      return { ...rest, symbol: "pin" };
    }),
    // No icons left means no field, as in a project that never had one.
    markerIcons: markerIcons.length ? markerIcons : undefined,
  };
}

type GraphicsPatch = Pick<ProjectConfigV1, "customGraphics" | "placedGraphics">;
type GraphicsProject = Pick<ProjectConfigV1, "customGraphics" | "placedGraphics" | "widthMm" | "heightMm">;

/** Room the core keeps between an anchored annotation and the crop edge, on both sides. */
const GRAPHIC_EDGE_ROOM_MM = 6;

/** The largest graphic that fits a piece of this size. */
export function graphicMaximumMm(widthMm: number, heightMm: number): number {
  return Math.min(GRAPHIC_MAX_SIZE_MM, Math.max(GRAPHIC_MIN_SIZE_MM, Math.min(widthMm, heightMm) - GRAPHIC_EDGE_ROOM_MM));
}

/** @public Panels read this through `StudioContext.edits`. */
export const canAddCustomGraphic = (project: Pick<ProjectConfigV1, "customGraphics">): boolean => (project.customGraphics?.length ?? 0) < MAX_CUSTOM_GRAPHICS;
/** @public Panels read this through `StudioContext.edits`. */
export const canPlaceGraphic = (project: Pick<ProjectConfigV1, "customGraphics" | "placedGraphics">): boolean =>
  Boolean(project.customGraphics?.length) && (project.placedGraphics?.length ?? 0) < MAX_PLACED_GRAPHICS;

/** Adds an uploaded graphic, or finds the same drawing already in the library, and returns the id to place. */
export function addCustomGraphic(project: Pick<ProjectConfigV1, "customGraphics" | "placedGraphics">, graphic: CustomGraphicV1): { patch: GraphicsPatch; graphicId: string } | undefined {
  const existing = project.customGraphics?.find((candidate) => JSON.stringify(candidate.shapes) === JSON.stringify(graphic.shapes));
  if (existing) return { patch: { customGraphics: project.customGraphics, placedGraphics: project.placedGraphics }, graphicId: existing.id };
  if (!canAddCustomGraphic(project)) return undefined;
  const name = storedName(graphic.name) ?? "Graphic";
  return { patch: { customGraphics: [...project.customGraphics ?? [], { ...graphic, name }], placedGraphics: project.placedGraphics }, graphicId: graphic.id };
}

/** Renames a graphic; a blank name keeps the old one, since the library lists graphics by name. */
export function renameCustomGraphic(project: Pick<ProjectConfigV1, "customGraphics" | "placedGraphics">, id: string, name: string): GraphicsPatch | undefined {
  const next = storedName(name);
  if (!next || !project.customGraphics?.some((graphic) => graphic.id === id)) return undefined;
  return { customGraphics: project.customGraphics.map((graphic) => graphic.id === id ? { ...graphic, name: next } : graphic), placedGraphics: project.placedGraphics };
}

/** Removes a graphic from the library, and every place it was used. */
export function removeCustomGraphic(project: Pick<ProjectConfigV1, "customGraphics" | "placedGraphics">, id: string): GraphicsPatch {
  const customGraphics = (project.customGraphics ?? []).filter((graphic) => graphic.id !== id);
  const placedGraphics = (project.placedGraphics ?? []).filter((placed) => placed.graphicId !== id);
  // Empty lists become absent fields, as in a project that never had one.
  return { customGraphics: customGraphics.length ? customGraphics : undefined, placedGraphics: placedGraphics.length ? placedGraphics : undefined };
}

/** A new, centered, engraved use of a graphic, about a quarter of the piece's shorter side. */
export function newPlacedGraphic(project: Pick<ProjectConfigV1, "widthMm" | "heightMm">, graphicId: string, id: string): PlacedGraphicV1 {
  const sizeMm = Math.round(Math.min(graphicMaximumMm(project.widthMm, project.heightMm), Math.max(GRAPHIC_MIN_SIZE_MM, Math.min(project.widthMm, project.heightMm) / 4)));
  return { id, graphicId, placement: { anchor: "center", offset: { x: 0, y: 0 } }, sizeMm, rotationDeg: 0, operation: "engrave" };
}

export function addPlacedGraphic(project: GraphicsProject, graphicId: string, id: string): Pick<ProjectConfigV1, "placedGraphics"> | undefined {
  if (!canPlaceGraphic(project) || !project.customGraphics?.some((graphic) => graphic.id === graphicId)) return undefined;
  return { placedGraphics: [...project.placedGraphics ?? [], newPlacedGraphic(project, graphicId, id)] };
}

/** Changes how a placed graphic is made or sized; position and rotation change in placement mode. */
export function updatePlacedGraphic(project: GraphicsProject, id: string, patch: Partial<Pick<PlacedGraphicV1, "operation" | "sizeMm" | "rotationDeg">>): Pick<ProjectConfigV1, "placedGraphics"> | undefined {
  if (!project.placedGraphics?.some((placed) => placed.id === id)) return undefined;
  const maximum = graphicMaximumMm(project.widthMm, project.heightMm);
  return {
    placedGraphics: project.placedGraphics.map((placed) => {
      if (placed.id !== id) return placed;
      const next = { ...placed, ...patch };
      return { ...next, sizeMm: Math.min(maximum, Math.max(GRAPHIC_MIN_SIZE_MM, next.sizeMm)), rotationDeg: ((next.rotationDeg % 360) + 360) % 360 };
    }),
  };
}

export function removePlacedGraphic(project: Pick<ProjectConfigV1, "placedGraphics">, id: string): Pick<ProjectConfigV1, "placedGraphics"> {
  const placedGraphics = (project.placedGraphics ?? []).filter((placed) => placed.id !== id);
  return { placedGraphics: placedGraphics.length ? placedGraphics : undefined };
}

export function addCustomLine(project: Project, id: string): CustomLinesPatch | undefined {
  if (!canAddCustomLine(project)) return undefined;
  const longitudeDelta = project.location.lon > 179.998 ? -0.002 : 0.002;
  const line: CustomLineFeatureV1 = {
    id,
    kind: "trail",
    points: [
      { lat: project.location.lat, lon: project.location.lon },
      { lat: project.location.lat, lon: clampLongitude(project.location.lon + longitudeDelta) },
    ],
  };
  return { customLines: [...project.customLines, line] };
}

/**
 * Whether one more click may be added to a path being drawn on the map. The
 * draft is not in the project yet, so its points are counted alongside it.
 */
export const canExtendDrawnLine = (project: Pick<ProjectConfigV1, "customLines">, drawnPoints: number): boolean =>
  // One point is held back so the shape can still be closed, which repeats the first.
  drawnPoints + 2 <= MAX_CUSTOM_LINE_POINTS && customDataPointCount(project) + drawnPoints + 2 <= MAX_CUSTOM_DATA_POINTS;

/**
 * A path drawn by clicking the map, added as one edit so it is one undo step.
 *
 * A closed shape is a boundary and returns to where it started: geometry draws
 * a line through the points it is given and closes nothing itself, so the
 * first point is repeated at the end. Anything else is a trail.
 */
export function addDrawnCustomLine(project: Project, id: string, points: readonly GeoPoint[], closed: boolean): CustomLinesPatch | undefined {
  const drawn = points.map((point) => ({ lat: point.lat, lon: point.lon }));
  if (!canAddCustomLine(project) || drawn.length < (closed ? 3 : 2)) return undefined;
  if (drawn.some((point) => !isSupportedCoordinate(point.lat, point.lon))) return undefined;
  const line: CustomLineFeatureV1 = closed
    ? { id, kind: "boundary", points: [...drawn, { ...drawn[0]! }] }
    : { id, kind: "trail", points: drawn };
  if (line.points.length > MAX_CUSTOM_LINE_POINTS || customDataPointCount(project) + line.points.length > MAX_CUSTOM_DATA_POINTS) return undefined;
  return { customLines: [...project.customLines, line] };
}

export function updateCustomLine(project: Project, id: string, patch: Partial<CustomLineFeatureV1>): CustomLinesPatch {
  return { customLines: project.customLines.map((line) => line.id === id ? { ...line, ...patch } : line) };
}

export function updateCustomLinePoint(project: Project, id: string, pointIndex: number, patch: Partial<GeoPoint>): CustomLinesPatch | undefined {
  const line = project.customLines.find((item) => item.id === id);
  const current = line?.points[pointIndex];
  if (!line || !current) return undefined;
  const next = { ...current, ...patch };
  if (!isSupportedCoordinate(next.lat, next.lon)) return undefined;
  return updateCustomLine(project, id, { points: line.points.map((point, index) => index === pointIndex ? next : point) });
}

export function addCustomLinePoint(project: Project, id: string): CustomLinesPatch | undefined {
  const line = project.customLines.find((item) => item.id === id);
  const last = line?.points.at(-1);
  if (!line || !last || !canAddCustomLinePoint(project, line)) return undefined;
  return updateCustomLine(project, id, { points: [...line.points, { ...last }] });
}

export function removeCustomLinePoint(project: Project, id: string, pointIndex: number): CustomLinesPatch | undefined {
  const line = project.customLines.find((item) => item.id === id);
  if (!line || line.points.length <= 2) return undefined;
  return updateCustomLine(project, id, { points: line.points.filter((_, index) => index !== pointIndex) });
}

/** Names a path, the same way a marker is named. */
export function renameCustomLine(project: Project, id: string, name: string): CustomLinesPatch | undefined {
  if (!project.customLines.some((line) => line.id === id)) return undefined;
  return {
    customLines: project.customLines.map((line) => {
      if (line.id !== id) return line;
      const { name: _previous, ...rest } = line;
      const next = storedName(name);
      return next === undefined ? rest : { ...rest, name: next };
    }),
  };
}

export function removeCustomLine(project: Project, id: string): CustomLinesPatch {
  return { customLines: project.customLines.filter((line) => line.id !== id) };
}

/** Title text limited to what the project accepts, so typing past a limit never makes the project invalid. */
export function plaqueText(text: string): string {
  return text.split(/\r?\n/).slice(0, PLAQUE_MAX_LINES).map((line) => line.slice(0, PLAQUE_MAX_LINE_LENGTH)).join("\n");
}

export const clampPlaqueSize = (sizeMm: number): number => Math.min(PLAQUE_MAX_SIZE_MM, Math.max(PLAQUE_MIN_SIZE_MM, sizeMm));

/** A new title starts in the bottom-left corner, which the default compass leaves free. */
export const DEFAULT_PLAQUE_PLACEMENT: PlaqueV1["placement"] = { anchor: "bottom-left", offset: { x: 0, y: 0 } };

/** The title's settings, starting from the project name in the default corner the first time it is switched on. */
export function plaqueSettings(project: Pick<ProjectConfigV1, "name" | "plaque">, patch: Partial<PlaqueV1>): PlaqueV1 {
  const current = project.plaque ?? { enabled: false, text: plaqueText(project.name), sizeMm: DEFAULT_PLAQUE_SIZE_MM, placement: { ...DEFAULT_PLAQUE_PLACEMENT, offset: { ...DEFAULT_PLAQUE_PLACEMENT.offset } } };
  return { ...current, ...patch };
}

/** The title with its own font, or following the label font when `font` is undefined. */
export function plaqueWithFont(project: Pick<ProjectConfigV1, "name" | "plaque">, font: TextFont | undefined): PlaqueV1 {
  // Drop the key rather than store undefined, so following the labels stays the saved default.
  const { font: _previous, ...rest } = plaqueSettings(project, {});
  return font ? { ...rest, font } : rest;
}

/** Room left for imported markers, paths and path vertices. */
export function customDataCapacity(project: Pick<ProjectConfigV1, "markers" | "customLines">): { markers: number; lines: number; points: number } {
  return {
    markers: MAX_MAP_MARKERS - project.markers.length,
    lines: MAX_CUSTOM_LINES - project.customLines.length,
    points: MAX_CUSTOM_DATA_POINTS - customDataPointCount(project),
  };
}

/** Appends already-fitted imported data (see `fitToCapacity`) as pin markers and paths. */
export function appendCustomData(
  project: Project,
  data: { markers: GeoPoint[]; lines: Array<Pick<CustomLineFeatureV1, "kind" | "points">> },
  makeId: () => string,
): MarkersPatch & CustomLinesPatch {
  return {
    markers: [...project.markers, ...data.markers.map((point): MapMarkerV1 => ({ id: makeId(), lat: point.lat, lon: point.lon, symbol: "pin", sizeMm: MAP_MARKER_SIZE_MM }))],
    customLines: [...project.customLines, ...data.lines.map((line): CustomLineFeatureV1 => ({ id: makeId(), kind: line.kind, points: line.points }))],
  };
}

/**
 * The markers or paths a generation was built from, named as the maker has
 * named them since. A rename does not cancel a run, so the run's own snapshot
 * would otherwise put the old names back when it lands.
 */
export function withLiveNames<T extends { id: string; name?: string }>(built: readonly T[], live: readonly T[]): T[] {
  const names = new Map(live.map((item) => [item.id, item.name]));
  return built.map((item) => {
    const next = { ...item };
    delete next.name;
    const name = names.get(item.id);
    return name ? { ...next, name } : next;
  });
}
