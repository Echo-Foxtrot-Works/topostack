import { PAINT_REGION_KINDS, DEFAULT_PROJECT, DEPTH_CHART_ID_PATTERN, isDepthChartLakeKey, MAP_MARKER_SIZE_MM, MARKER_ICON_ID_PATTERN, MARKER_ICON_UNITS, MARKER_SYMBOLS, MAX_MARKER_ICON_POINTS, MAX_MARKER_ICONS, GRAPHIC_MAX_SIZE_MM, GRAPHIC_MIN_SIZE_MM, GRAPHIC_OPERATIONS, MAX_CUSTOM_GRAPHIC_POINTS, MAX_CUSTOM_GRAPHICS, MAX_PLACED_GRAPHICS, MAX_CUSTOM_DATA_NAME_LENGTH, MAX_CUSTOM_DATA_POINTS, MAX_CUSTOM_LINE_POINTS, MAX_CUSTOM_LINES, MAX_MAP_MARKERS, MAX_PROJECT_NAME_LENGTH, MAX_VERTICAL_EXAGGERATION, NORTH_ARROW_ANCHORS, type CustomGraphicV1, type CustomLineFeatureV1, type CustomLineKind, type GraphicOperation, type MapMarkerV1, type MarkerIconShapeV1, type MarkerIconV1, type MarkerSymbol, type NorthArrowAnchor, type NorthArrowStyle, type PlacedGraphicV1, type PlaqueV1, type ProjectConfigV1, type SheetNestSettingsV1, type UserDepthChartRefV1 } from "../types.js";
import { markerIconPointCount } from "../annotate/marker-icons.js";
import { isTextFont } from "../annotate/font-data.js";
import { SHEET_NEST_ROTATIONS } from "../export/sheet-nest/resolve.js";
import { validateProject } from "../pipeline/validate.js";

/**
 * Untrusted project JSON (a saved project, an imported file, a share link, an
 * agent request) becomes a `ProjectConfigV1` only through `parseProject`:
 * absent fields take their defaults, legacy values are carried forward, and
 * the result passes `validateProject`.
 */

function numberValue(value: unknown): number { return typeof value === "number" ? value : Number.NaN; }
/** Keep projects from the former 1–20× range loadable under the new 10× maximum. */
function savedVerticalExaggeration(value: unknown): number {
  const parsed = value === undefined ? DEFAULT_PROJECT.verticalExaggeration : numberValue(value);
  return parsed > MAX_VERTICAL_EXAGGERATION && parsed <= 20 ? MAX_VERTICAL_EXAGGERATION : parsed;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}
function unitValue(value: unknown): ProjectConfigV1["units"] {
  if (value === undefined) return DEFAULT_PROJECT.units;
  if (value === "metric" || value === "imperial") return value;
  throw new Error("Project units must be metric or imperial.");
}
function waterFillPatternValue(value: unknown): ProjectConfigV1["waterFillPattern"] {
  if (value === undefined) return DEFAULT_PROJECT.waterFillPattern;
  if (value === "none" || value === "lines" || value === "ripples" || value === "dots") return value;
  throw new Error("Water fill pattern must be none, lines, ripples, or dots.");
}
function paintTemplatesValue(value: unknown): ProjectConfigV1["paintTemplates"] {
  if (value === undefined) return [...DEFAULT_PROJECT.paintTemplates];
  if (!Array.isArray(value) || value.some((kind) => !PAINT_REGION_KINDS.includes(kind)) || new Set(value).size !== value.length) throw new Error("Paint templates must list each supported region kind at most once.");
  // A copy, so later edits to the caller's array cannot reach the project.
  return [...value] as ProjectConfigV1["paintTemplates"];
}
/** Sheet nesting is an export setting; out-of-range numbers are clamped when it is used, so only shape is checked here. */
function sheetNestingValue(value: unknown): SheetNestSettingsV1 {
  if (!value || typeof value !== "object") throw new Error("Sheet nesting settings are invalid.");
  const record = value as Record<string, unknown>;
  if (!SHEET_NEST_ROTATIONS.includes(record.rotation as SheetNestSettingsV1["rotation"])) throw new Error("Sheet nesting rotation must be none, half, quarter, or free.");
  const settings: SheetNestSettingsV1 = {
    sheetWidthMm: numberValue(record.sheetWidthMm),
    sheetHeightMm: numberValue(record.sheetHeightMm),
    marginMm: numberValue(record.marginMm),
    spacingMm: numberValue(record.spacingMm),
    rotation: record.rotation as SheetNestSettingsV1["rotation"],
    timeBudgetS: numberValue(record.timeBudgetS),
    seed: numberValue(record.seed),
  };
  if (Object.values(settings).some((entry) => typeof entry === "number" && !Number.isFinite(entry))) throw new Error("Sheet nesting settings must be numbers.");
  return settings;
}
function outputModeValue(value: unknown): ProjectConfigV1["outputMode"] {
  if (value === undefined) return DEFAULT_PROJECT.outputMode;
  if (value === "stack" || value === "engraving") return value;
  throw new Error("Project output mode must be stack or engraving.");
}
function textFontValue(value: unknown): ProjectConfigV1["textStyle"]["font"] {
  if (isTextFont(value)) return value;
  throw new Error("Text font must be one of the listed engraving fonts.");
}
function trailPatternValue(value: unknown): ProjectConfigV1["lineStyle"]["trailPattern"] {
  if (value === "solid" || value === "dashed" || value === "dotted") return value;
  throw new Error("Trail pattern must be solid, dashed, or dotted.");
}
function roadStyleValue(value: unknown): ProjectConfigV1["lineStyle"]["roadStyle"] {
  if (value === undefined) return DEFAULT_PROJECT.lineStyle.roadStyle;
  if (value === "centerline" || value === "outlined") return value;
  throw new Error("Road style must be centerline or outlined.");
}
function roadCapValue(value: unknown): ProjectConfigV1["lineStyle"]["roadCap"] {
  if (value === undefined) return DEFAULT_PROJECT.lineStyle.roadCap;
  if (value === "round" || value === "square") return value;
  throw new Error("Road cap must be round or square.");
}
function northArrowStyleValue(value: unknown): NorthArrowStyle {
  if (value === "minimal" || value === "classic" || value === "mariner") return value;
  throw new Error("North arrow style must be minimal, classic, or mariner.");
}
function northArrowAnchorValue(value: unknown): NorthArrowAnchor {
  if (value === "top-left" || value === "top" || value === "top-right" || value === "left" || value === "center" || value === "right" || value === "bottom-left" || value === "bottom" || value === "bottom-right") return value;
  throw new Error("North arrow anchor is invalid.");
}
function plaqueAnchorValue(value: unknown): NorthArrowAnchor {
  if (NORTH_ARROW_ANCHORS.includes(value as NorthArrowAnchor)) return value as NorthArrowAnchor;
  throw new Error("Title anchor is invalid.");
}
function scaleBarPlacementValue(value: unknown): ProjectConfigV1["scaleBarPlacement"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Scale bar placement is invalid.");
  const record = value as Record<string, unknown>;
  if (!NORTH_ARROW_ANCHORS.includes(record.anchor as NorthArrowAnchor)) throw new Error("Scale bar anchor is invalid.");
  const offset = record.offset && typeof record.offset === "object" ? record.offset as Record<string, unknown> : undefined;
  return { anchor: record.anchor as NorthArrowAnchor, offset: offset ? { x: numberValue(offset.x), y: numberValue(offset.y) } : { x: 0, y: 0 } };
}
function plaqueValue(value: unknown): PlaqueV1 | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Title settings are invalid.");
  const record = value as Record<string, unknown>;
  const placement = record.placement && typeof record.placement === "object" ? record.placement as Record<string, unknown> : undefined;
  const offset = placement?.offset && typeof placement.offset === "object" ? placement.offset as Record<string, unknown> : undefined;
  if (typeof record.text !== "string") throw new Error("Title text is invalid.");
  return {
    enabled: booleanValue(record.enabled, "plaque.enabled"),
    text: record.text,
    sizeMm: numberValue(record.sizeMm),
    placement: { anchor: plaqueAnchorValue(placement?.anchor), offset: offset ? { x: numberValue(offset.x), y: numberValue(offset.y) } : { x: 0, y: 0 } },
    // Absent means the title follows the label font; keeping it absent keeps the fingerprint.
    ...(record.font === undefined ? {} : { font: textFontValue(record.font) }),
  };
}

function markerSymbolValue(value: unknown): MarkerSymbol {
  if (value === "custom" || (MARKER_SYMBOLS as readonly unknown[]).includes(value)) return value as MarkerSymbol;
  throw new Error("Marker symbol is invalid.");
}

function iconRingValue(value: unknown): number[] | undefined {
  const half = MARKER_ICON_UNITS / 2;
  return Array.isArray(value) && value.length >= 6 && value.length % 2 === 0 && value.every((coordinate) => Number.isSafeInteger(coordinate) && Math.abs(coordinate) <= half) ? value as number[] : undefined;
}

/**
 * Uploaded marker icons. A malformed icon is dropped rather than refusing the
 * project, and the markers that drew it fall back to pins (see markersValue).
 * Absent stays absent, which keeps older projects' fingerprints.
 */
function markerIconsValue(value: unknown): MarkerIconV1[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const icons: MarkerIconV1[] = [];
  for (const item of value) {
    if (icons.length >= MAX_MARKER_ICONS) break;
    const icon = iconShapesValue(item, icons, MAX_MARKER_ICON_POINTS);
    if (!icon) continue;
    icons.push({ id: icon.id, name: customDataName(icon.record.name).name ?? "Icon", ...(icon.record.anchor === "bottom" ? { anchor: "bottom" as const } : {}), shapes: icon.shapes });
  }
  return icons.length ? icons : undefined;
}

/** An uploaded drawing's id and rings, when both are well formed, its id is new and it fits `maxPoints`. */
function iconShapesValue(item: unknown, existing: Array<{ id: string }>, maxPoints: number): { id: string; shapes: MarkerIconShapeV1[]; record: Record<string, unknown> } | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (typeof record.id !== "string" || !MARKER_ICON_ID_PATTERN.test(record.id) || existing.some(({ id }) => id === record.id)) return undefined;
  if (!Array.isArray(record.shapes) || !record.shapes.length) return undefined;
  const shapes: MarkerIconShapeV1[] = [];
  for (const shape of record.shapes as unknown[]) {
    const fields = shape && typeof shape === "object" ? shape as Record<string, unknown> : {};
    const outer = iconRingValue(fields.outer);
    const holes = Array.isArray(fields.holes) ? fields.holes.map(iconRingValue) : [];
    if (!outer || holes.some((hole) => !hole)) return undefined;
    shapes.push({ outer, ...(holes.length ? { holes: holes as number[][] } : {}) });
  }
  if (markerIconPointCount({ shapes }) > maxPoints) return undefined;
  return { id: record.id, shapes, record };
}

/** Uploaded graphics, leniently like marker icons: a malformed one is dropped along with its placements. */
function customGraphicsValue(value: unknown): CustomGraphicV1[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const graphics: CustomGraphicV1[] = [];
  for (const item of value) {
    if (graphics.length >= MAX_CUSTOM_GRAPHICS) break;
    const graphic = iconShapesValue(item, graphics, MAX_CUSTOM_GRAPHIC_POINTS);
    if (graphic) graphics.push({ id: graphic.id, name: customDataName(graphic.record.name).name ?? "Graphic", shapes: graphic.shapes });
  }
  return graphics.length ? graphics : undefined;
}

/** Placements of those graphics; one naming missing artwork or out of range is dropped rather than refusing the project. */
function placedGraphicsValue(value: unknown, graphics: CustomGraphicV1[] | undefined): PlacedGraphicV1[] | undefined {
  if (!Array.isArray(value) || !graphics) return undefined;
  const placed: PlacedGraphicV1[] = [];
  for (const item of value) {
    if (placed.length >= MAX_PLACED_GRAPHICS) break;
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !MARKER_ICON_ID_PATTERN.test(record.id) || placed.some(({ id }) => id === record.id)) continue;
    if (!graphics.some(({ id }) => id === record.graphicId)) continue;
    const placement = record.placement && typeof record.placement === "object" ? record.placement as Record<string, unknown> : undefined;
    const offset = placement?.offset && typeof placement.offset === "object" ? placement.offset as Record<string, unknown> : undefined;
    // Lenient on purpose: a placement that fails the checks below is dropped,
    // not fatal, and parsing less than before would reject saved projects.
    const offsetX = Number(offset?.x ?? 0); const offsetY = Number(offset?.y ?? 0);
    if (!NORTH_ARROW_ANCHORS.includes(placement?.anchor as NorthArrowAnchor) || ![offsetX, offsetY].every((part) => Number.isFinite(part) && Math.abs(part) <= 1)) continue;
    const sizeMm = Number(record.sizeMm); const rotationDeg = Number(record.rotationDeg ?? 0);
    if (!Number.isFinite(sizeMm) || sizeMm < GRAPHIC_MIN_SIZE_MM || sizeMm > GRAPHIC_MAX_SIZE_MM || !Number.isFinite(rotationDeg)) continue;
    const operation = (GRAPHIC_OPERATIONS as readonly unknown[]).includes(record.operation) ? record.operation as GraphicOperation : "engrave";
    placed.push({
      id: record.id,
      graphicId: record.graphicId as string,
      placement: { anchor: placement!.anchor as NorthArrowAnchor, offset: { x: offsetX, y: offsetY } },
      sizeMm,
      rotationDeg: ((rotationDeg % 360) + 360) % 360,
      operation,
    });
  }
  return placed.length ? placed : undefined;
}

/**
 * A marker's or path's own name, kept only when it is usable. Names are
 * bookkeeping, never geometry, so one that is blank or too long is dropped
 * rather than refusing the whole project.
 */
function customDataName(value: unknown): { name?: string } {
  if (typeof value !== "string") return {};
  const name = value.trim();
  return name && name.length <= MAX_CUSTOM_DATA_NAME_LENGTH ? { name } : {};
}

function markersValue(value: unknown, icons: MarkerIconV1[] | undefined): MapMarkerV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Project markers must be a list.");
  if (value.length > MAX_MAP_MARKERS) throw new Error("Project contains too many markers.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Each marker must be an object.");
    const marker = item as Record<string, unknown>;
    if (typeof marker.id !== "string") throw new Error("Each marker must have an id.");
    const symbol = markerSymbolValue(marker.symbol);
    // A custom marker whose icon did not survive keeps its place as a pin.
    const iconId = symbol === "custom" && icons?.some(({ id }) => id === marker.iconId) ? marker.iconId as string : undefined;
    return {
      id: marker.id, lat: numberValue(marker.lat), lon: numberValue(marker.lon),
      symbol: symbol === "custom" && !iconId ? "pin" : symbol,
      sizeMm: marker.sizeMm === undefined ? MAP_MARKER_SIZE_MM : numberValue(marker.sizeMm),
      ...customDataName(marker.name),
      ...(iconId ? { iconId } : {}),
    };
  });
}

function customLineKindValue(value: unknown): CustomLineKind {
  if (value === "trail" || value === "boundary") return value;
  throw new Error("Custom line type must be trail or boundary.");
}

function customLinesValue(value: unknown): CustomLineFeatureV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Custom lines must be a list.");
  if (value.length > MAX_CUSTOM_LINES) throw new Error("Project contains too many custom lines.");
  let pointCount = 0;
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Each custom line must be an object.");
    const line = item as Record<string, unknown>;
    if (typeof line.id !== "string") throw new Error("Each custom line must have an id.");
    if (!Array.isArray(line.points)) throw new Error("Each custom line must contain a point list.");
    if (line.points.length > MAX_CUSTOM_LINE_POINTS) throw new Error("A custom line contains too many points.");
    pointCount += line.points.length;
    if (pointCount > MAX_CUSTOM_DATA_POINTS) throw new Error("Project contains too many custom line points.");
    return {
      id: line.id,
      kind: customLineKindValue(line.kind),
      ...customDataName(line.name),
      points: line.points.map((point) => {
        if (!point || typeof point !== "object") throw new Error("Each custom line point must be an object.");
        const coordinate = point as Record<string, unknown>;
        return { lat: numberValue(coordinate.lat), lon: numberValue(coordinate.lon) };
      }),
    };
  });
}

/** Overrides are keyed by HydroLAKES id, so any non-numeric entry is dropped rather than thrown on. */
function waterDepthOverridesValue(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, number> = {};
  for (const [lake, depth] of Object.entries(value as Record<string, unknown>)) {
    if (/^[1-9]\d*$/.test(lake) && typeof depth === "number" && Number.isFinite(depth) && depth > 0 && depth <= 12000) result[lake] = depth;
  }
  return result;
}

/**
 * Chart references are keyed by HydroLAKES id like the overrides above, or by
 * `outline:<chart id>` for a lake without one, and a malformed entry is dropped rather than thrown on: the lake then falls back to
 * the survey providers instead of the whole project failing to open. Absent
 * stays absent, which keeps older projects' fingerprints.
 */
function userDepthChartsValue(value: unknown): { userDepthCharts?: Record<string, UserDepthChartRefV1> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const charts: Record<string, UserDepthChartRefV1> = {};
  for (const [lake, reference] of Object.entries(value as Record<string, unknown>)) {
    if (!reference || typeof reference !== "object") continue;
    const { id, contentHash } = reference as Record<string, unknown>;
    if (typeof id !== "string" || !DEPTH_CHART_ID_PATTERN.test(id) || !isDepthChartLakeKey(lake, { id })) continue;
    if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash)) continue;
    charts[lake] = { id, contentHash };
  }
  return Object.keys(charts).length ? { userDepthCharts: charts } : {};
}

export function parseProject(value: unknown): ProjectConfigV1 {
  if (!value || typeof value !== "object") throw new Error("Project must be a JSON object.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("Not a TopoStack v1 project.");
  const markerIcons = markerIconsValue(record.markerIcons);
  const customGraphics = customGraphicsValue(record.customGraphics);
  const placedGraphics = placedGraphicsValue(record.placedGraphics, customGraphics);
  const location = record.location;
  if (!location || typeof location !== "object") throw new Error("Project location is missing.");
  const locationRecord = location as Record<string, unknown>;
  if (typeof record.name === "string" && record.name.trim() && record.name.length > MAX_PROJECT_NAME_LENGTH) throw new Error("Project name must contain at most 120 characters.");
  if (typeof locationRecord.label === "string" && locationRecord.label.length > 240) throw new Error("Project location label must contain at most 240 characters.");
  const boundsRecord = locationRecord.bounds && typeof locationRecord.bounds === "object" ? locationRecord.bounds as Record<string, unknown> : undefined;
  if (record.elevationLabelPosition !== undefined && (!record.elevationLabelPosition || typeof record.elevationLabelPosition !== "object")) throw new Error("Elevation label position is invalid.");
  const labelPositionRecord = record.elevationLabelPosition as Record<string, unknown> | undefined;
  if (record.textStyle !== undefined && (!record.textStyle || typeof record.textStyle !== "object")) throw new Error("Text style is invalid.");
  const textStyleRecord = record.textStyle as Record<string, unknown> | undefined;
  if (record.lineStyle !== undefined && (!record.lineStyle || typeof record.lineStyle !== "object")) throw new Error("Line style is invalid.");
  const lineStyleRecord = record.lineStyle as Record<string, unknown> | undefined;
  if (record.northArrowPlacement !== undefined && (!record.northArrowPlacement || typeof record.northArrowPlacement !== "object")) throw new Error("North arrow placement is invalid.");
  const northArrowPlacementRecord = record.northArrowPlacement as Record<string, unknown> | undefined;
  const northArrowOffsetRecord = northArrowPlacementRecord?.offset && typeof northArrowPlacementRecord.offset === "object" ? northArrowPlacementRecord.offset as Record<string, unknown> : undefined;
  const project: ProjectConfigV1 = {
    ...DEFAULT_PROJECT,
    schemaVersion: 1,
    id: typeof record.id === "string" && record.id.trim() ? record.id : crypto.randomUUID(),
    name: typeof record.name === "string" && record.name.trim() && record.name.length <= MAX_PROJECT_NAME_LENGTH ? record.name : "Terrain project",
    location: {
      lat: numberValue(locationRecord.lat), lon: numberValue(locationRecord.lon), zoom: numberValue(locationRecord.zoom),
      label: typeof locationRecord.label === "string" ? locationRecord.label.slice(0, 240) : "Custom coordinates",
      ...(boundsRecord ? { bounds: { west: numberValue(boundsRecord.west), south: numberValue(boundsRecord.south), east: numberValue(boundsRecord.east), north: numberValue(boundsRecord.north) } } : {}),
    },
    cropShape: record.cropShape === "circle" ? "circle" : record.cropShape === "rectangle" ? "rectangle" : DEFAULT_PROJECT.cropShape,
    units: unitValue(record.units),
    outputMode: outputModeValue(record.outputMode),
    widthMm: numberValue(record.widthMm), heightMm: numberValue(record.heightMm), materialThicknessMm: numberValue(record.materialThicknessMm),
    engravingContourCount: record.engravingContourCount === undefined ? DEFAULT_PROJECT.engravingContourCount : numberValue(record.engravingContourCount),
    engravingIndexInterval: record.engravingIndexInterval === undefined ? DEFAULT_PROJECT.engravingIndexInterval : numberValue(record.engravingIndexInterval),
    showEngravingBorder: record.showEngravingBorder === undefined ? DEFAULT_PROJECT.showEngravingBorder : booleanValue(record.showEngravingBorder, "showEngravingBorder"),
    lineStyle: lineStyleRecord ? {
      contourMm: numberValue(lineStyleRecord.contourMm),
      indexContourMm: numberValue(lineStyleRecord.indexContourMm),
      majorRoadMm: numberValue(lineStyleRecord.majorRoadMm),
      localRoadMm: numberValue(lineStyleRecord.localRoadMm),
      trailMm: numberValue(lineStyleRecord.trailMm),
      waterMm: numberValue(lineStyleRecord.waterMm),
      boundaryMm: lineStyleRecord.boundaryMm === undefined ? DEFAULT_PROJECT.lineStyle.boundaryMm : numberValue(lineStyleRecord.boundaryMm),
      coordinateGridMm: lineStyleRecord.coordinateGridMm === undefined ? DEFAULT_PROJECT.lineStyle.coordinateGridMm : numberValue(lineStyleRecord.coordinateGridMm),
      annotationMm: numberValue(lineStyleRecord.annotationMm),
      borderMm: numberValue(lineStyleRecord.borderMm),
      trailPattern: trailPatternValue(lineStyleRecord.trailPattern),
      roadStyle: roadStyleValue(lineStyleRecord.roadStyle),
      majorRoadSpacingMm: lineStyleRecord.majorRoadSpacingMm === undefined ? DEFAULT_PROJECT.lineStyle.majorRoadSpacingMm : numberValue(lineStyleRecord.majorRoadSpacingMm),
      roadCap: roadCapValue(lineStyleRecord.roadCap),
    } : { ...DEFAULT_PROJECT.lineStyle },
    verticalExaggeration: savedVerticalExaggeration(record.verticalExaggeration),
    minimumFeatureMm: record.minimumFeatureMm === undefined ? DEFAULT_PROJECT.minimumFeatureMm : numberValue(record.minimumFeatureMm),
    smoothing: record.smoothing === undefined ? DEFAULT_PROJECT.smoothing : numberValue(record.smoothing),
    showRoads: booleanValue(record.showRoads, "showRoads"),
    showTrails: record.showTrails === undefined ? booleanValue(record.showRoads, "showRoads") : booleanValue(record.showTrails, "showTrails"),
    showTransportationLabels: record.showTransportationLabels === undefined ? false : booleanValue(record.showTransportationLabels, "showTransportationLabels"),
    showWater: booleanValue(record.showWater, "showWater"),
    waterFillPattern: waterFillPatternValue(record.waterFillPattern),
    showBoundaries: record.showBoundaries === undefined ? DEFAULT_PROJECT.showBoundaries : booleanValue(record.showBoundaries, "showBoundaries"),
    showCoordinateGrid: record.showCoordinateGrid === undefined ? DEFAULT_PROJECT.showCoordinateGrid : booleanValue(record.showCoordinateGrid, "showCoordinateGrid"),
    showWaterDepth: record.showWaterDepth === undefined ? DEFAULT_PROJECT.showWaterDepth : booleanValue(record.showWaterDepth, "showWaterDepth"),
    waterDepthExaggeration: record.waterDepthExaggeration === undefined ? DEFAULT_PROJECT.waterDepthExaggeration : numberValue(record.waterDepthExaggeration),
    fitLakeDepth: record.fitLakeDepth === undefined ? false : booleanValue(record.fitLakeDepth, "fitLakeDepth"),
    waterDepthLayerLimit: record.waterDepthLayerLimit === undefined ? undefined : numberValue(record.waterDepthLayerLimit),
    waterDepthOverrides: waterDepthOverridesValue(record.waterDepthOverrides),
    showAlignmentGuides: record.showAlignmentGuides === undefined ? DEFAULT_PROJECT.showAlignmentGuides : booleanValue(record.showAlignmentGuides, "showAlignmentGuides"),
    optimizeMaterialUse: record.optimizeMaterialUse === undefined ? DEFAULT_PROJECT.optimizeMaterialUse : booleanValue(record.optimizeMaterialUse, "optimizeMaterialUse"),
    glueMarginMm: record.glueMarginMm === undefined ? DEFAULT_PROJECT.glueMarginMm : numberValue(record.glueMarginMm),
    laserKerfMm: record.laserKerfMm === undefined ? DEFAULT_PROJECT.laserKerfMm : numberValue(record.laserKerfMm),
    workAreaWidthMm: record.workAreaWidthMm === undefined ? DEFAULT_PROJECT.workAreaWidthMm : numberValue(record.workAreaWidthMm),
    workAreaHeightMm: record.workAreaHeightMm === undefined ? DEFAULT_PROJECT.workAreaHeightMm : numberValue(record.workAreaHeightMm),
    seamOffsetMm: record.seamOffsetMm === undefined ? DEFAULT_PROJECT.seamOffsetMm : numberValue(record.seamOffsetMm),
    seamTabs: record.seamTabs === undefined ? DEFAULT_PROJECT.seamTabs : booleanValue(record.seamTabs, "seamTabs"),
    showAssemblyLabels: record.showAssemblyLabels === undefined ? DEFAULT_PROJECT.showAssemblyLabels : booleanValue(record.showAssemblyLabels, "showAssemblyLabels"),
    paintTemplates: paintTemplatesValue(record.paintTemplates),
    ...(record.sheetNesting === undefined ? {} : { sheetNesting: sheetNestingValue(record.sheetNesting) }),
    showElevationLabels: booleanValue(record.showElevationLabels, "showElevationLabels"), showNorthArrow: booleanValue(record.showNorthArrow, "showNorthArrow"), showScaleBar: booleanValue(record.showScaleBar, "showScaleBar"),
    elevationLabelPosition: labelPositionRecord ? { x: numberValue(labelPositionRecord.x), y: numberValue(labelPositionRecord.y) } : { ...DEFAULT_PROJECT.elevationLabelPosition },
    textStyle: textStyleRecord ? {
      font: textFontValue(textStyleRecord.font),
      sizeMm: numberValue(textStyleRecord.sizeMm),
    } : { ...DEFAULT_PROJECT.textStyle },
    northArrowStyle: record.northArrowStyle === undefined ? DEFAULT_PROJECT.northArrowStyle : northArrowStyleValue(record.northArrowStyle),
    northArrowSizeMm: record.northArrowSizeMm === undefined ? DEFAULT_PROJECT.northArrowSizeMm : numberValue(record.northArrowSizeMm),
    northArrowPlacement: northArrowPlacementRecord ? {
      anchor: northArrowAnchorValue(northArrowPlacementRecord.anchor),
      offset: northArrowOffsetRecord ? { x: numberValue(northArrowOffsetRecord.x), y: numberValue(northArrowOffsetRecord.y) } : { ...DEFAULT_PROJECT.northArrowPlacement.offset },
    } : { anchor: DEFAULT_PROJECT.northArrowPlacement.anchor, offset: { ...DEFAULT_PROJECT.northArrowPlacement.offset } },
    // Absent keeps the bar's original spot and the project's fingerprint.
    ...(record.scaleBarPlacement === undefined ? {} : { scaleBarPlacement: scaleBarPlacementValue(record.scaleBarPlacement) }),
    ...userDepthChartsValue(record.userDepthCharts),
    ...(record.plaque === undefined ? {} : { plaque: plaqueValue(record.plaque) }),
    ...(markerIcons ? { markerIcons } : {}),
    ...(customGraphics ? { customGraphics } : {}),
    ...(placedGraphics ? { placedGraphics } : {}),
    markers: markersValue(record.markers, markerIcons),
    customLines: customLinesValue(record.customLines),
    explodedPreview: record.explodedPreview === undefined ? DEFAULT_PROJECT.explodedPreview : numberValue(record.explodedPreview),
  };
  validateProject(project);
  if (!Number.isFinite(project.explodedPreview) || project.explodedPreview < 0 || project.explodedPreview > 1) throw new Error("Exploded preview must be between 0 and 1.");
  return project;
}
