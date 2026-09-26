import { isTextFont } from "../annotate/font-data.js";
import {
  CUSTOM_LINE_KINDS,
  PAINT_REGION_KINDS,
  MAP_MARKER_SIZE_MM,
  MAP_MARKER_MIN_SIZE_MM,
  MAP_MARKER_MAX_SIZE_MM,
  MARKER_SYMBOLS,
  MARKER_ICON_ID_PATTERN,
  MARKER_ICON_UNITS,
  MAX_MARKER_ICONS,
  MAX_MARKER_ICON_POINTS,
  GRAPHIC_MAX_SIZE_MM,
  GRAPHIC_MIN_SIZE_MM,
  GRAPHIC_OPERATIONS,
  MAX_CUSTOM_GRAPHIC_POINTS,
  MAX_CUSTOM_GRAPHICS,
  MAX_PLACED_GRAPHICS,
  DEPTH_CHART_ID_PATTERN,
  isDepthChartLakeKey,
  MAX_CUSTOM_DATA_NAME_LENGTH,
  MAX_CUSTOM_DATA_POINTS,
  MAX_CUSTOM_LINE_POINTS,
  MAX_CUSTOM_LINES,
  MAX_MAP_MARKERS,
  MAX_PROJECT_DIMENSION_MM,
  MAX_PROJECT_NAME_LENGTH,
  MAX_SEAM_OFFSET_MM,
  MAX_WATER_DEPTH_EXAGGERATION,
  MIN_WORK_AREA_MM,
  MIN_WATER_DEPTH_EXAGGERATION,
  MAX_VERTICAL_EXAGGERATION,
  MIN_VERTICAL_EXAGGERATION,
  NORTH_ARROW_ANCHORS,
  PLAQUE_MAX_LINE_LENGTH,
  PLAQUE_MAX_LINES,
  PLAQUE_MAX_SIZE_MM,
  PLAQUE_MIN_SIZE_MM,
  NORTH_ARROW_MIN_SIZE_MM,
  northArrowMaximumMm,
  NORTH_ARROW_STYLES,
} from "../types.js";
import type { GeoBounds, MarkerIconShapeV1, NorthArrowPlacementV1, PlaqueV1, ProjectConfigV1 } from "../types.js";


export function assertGeographicBounds(bounds: GeoBounds, label: "Project" | "Source"): void {
  if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)) throw new Error(`${label} geographic bounds must be finite.`);
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) throw new Error(`${label} geographic bounds must be ordered west-to-east and south-to-north.`);
  if (bounds.east - bounds.west > 360) throw new Error(`${label} longitude span cannot exceed 360 degrees.`);
  if (bounds.west < -540 || bounds.east > 540) throw new Error(`${label} longitudes exceed the supported unwrapped world range.`);
  if (bounds.south < -85.0511 || bounds.north > 85.0511) throw new Error(`${label} latitude bounds exceed Web Mercator coverage.`);
}



export function validateProject(config: ProjectConfigV1): void {
  if (config.schemaVersion !== 1) throw new Error("Unsupported project schema version.");
  if (config.units !== "metric" && config.units !== "imperial") throw new Error("Project units must be metric or imperial.");
  if (config.outputMode !== "stack" && config.outputMode !== "engraving") throw new Error("Project output mode must be stack or engraving.");
  if (config.waterFillPattern !== "none" && config.waterFillPattern !== "lines" && config.waterFillPattern !== "ripples" && config.waterFillPattern !== "dots") throw new Error("Water fill pattern must be none, lines, ripples, or dots.");
  if (config.cropShape !== "rectangle" && config.cropShape !== "circle") throw new Error("Crop shape must be rectangle or circle.");
  if (!config.elevationLabelPosition || typeof config.elevationLabelPosition !== "object") throw new Error("Elevation label position is required.");
  if (!config.textStyle || typeof config.textStyle !== "object") throw new Error("Text style is required.");
  if (!config.lineStyle || typeof config.lineStyle !== "object") throw new Error("Line style is required.");
  if (!config.northArrowPlacement || typeof config.northArrowPlacement !== "object" || !config.northArrowPlacement.offset || typeof config.northArrowPlacement.offset !== "object") throw new Error("North arrow placement is required.");
  if (!Array.isArray(config.markers)) throw new Error("Project markers must be a list.");
  if (!Array.isArray(config.customLines)) throw new Error("Custom lines must be a list.");
  if (!Array.isArray(config.paintTemplates) || config.paintTemplates.some((kind) => !PAINT_REGION_KINDS.includes(kind)) || new Set(config.paintTemplates).size !== config.paintTemplates.length) throw new Error("Paint templates must list each supported region kind at most once.");
  if (typeof config.id !== "string" || !config.id.trim() || config.id.length > MAX_PROJECT_NAME_LENGTH) throw new Error("Project id must contain at most 120 characters.");
  if (typeof config.name !== "string" || !config.name.trim() || config.name.length > MAX_PROJECT_NAME_LENGTH) throw new Error("Project name must contain at most 120 characters.");
  if (!config.location || typeof config.location !== "object" || typeof config.location.label !== "string" || !config.location.label.trim() || config.location.label.length > 240) throw new Error("Project location label must contain at most 240 characters.");
  for (const [label, value] of Object.entries({ showRoads: config.showRoads, showTrails: config.showTrails, showTransportationLabels: config.showTransportationLabels, showWater: config.showWater, showBoundaries: config.showBoundaries, showCoordinateGrid: config.showCoordinateGrid, showWaterDepth: config.showWaterDepth, showAlignmentGuides: config.showAlignmentGuides, optimizeMaterialUse: config.optimizeMaterialUse, showElevationLabels: config.showElevationLabels, showNorthArrow: config.showNorthArrow, showScaleBar: config.showScaleBar, showEngravingBorder: config.showEngravingBorder, seamTabs: config.seamTabs, showAssemblyLabels: config.showAssemblyLabels })) {
    if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  }
  if (config.widthMm <= 0) throw new Error("Project width must be greater than zero.");
  if (config.heightMm <= 0) throw new Error("Project height must be greater than zero.");
  if (config.widthMm > MAX_PROJECT_DIMENSION_MM || config.heightMm > MAX_PROJECT_DIMENSION_MM) throw new Error("Project dimensions must not exceed 10000 mm.");
  if (config.verticalExaggeration < MIN_VERTICAL_EXAGGERATION || config.verticalExaggeration > MAX_VERTICAL_EXAGGERATION) throw new Error(`Vertical exaggeration must be between ${MIN_VERTICAL_EXAGGERATION} and ${MAX_VERTICAL_EXAGGERATION}.`);
  if (typeof config.fitLakeDepth !== "boolean") throw new Error("Fit lake depth must be a boolean.");
  if (config.waterDepthLayerLimit !== undefined && (!Number.isSafeInteger(config.waterDepthLayerLimit) || config.waterDepthLayerLimit < 1)) throw new Error("Maximum depth layers must be a positive whole number.");
  if (!Number.isFinite(config.waterDepthExaggeration) || config.waterDepthExaggeration < MIN_WATER_DEPTH_EXAGGERATION || config.waterDepthExaggeration > MAX_WATER_DEPTH_EXAGGERATION) throw new Error(`Water depth exaggeration must be between ${MIN_WATER_DEPTH_EXAGGERATION} and ${MAX_WATER_DEPTH_EXAGGERATION}.`);
  if (config.materialThicknessMm < 0.5 || config.materialThicknessMm > 25) throw new Error("Material thickness must be between 0.5 and 25 mm.");
  if (config.location.lat < -85.0511 || config.location.lat > 85.0511) throw new Error("This version supports Web Mercator latitudes only.");
  if (config.location.lon < -180 || config.location.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
  const iconIds = validateMarkerIcons(config.markerIcons);
  validatePlacedGraphics(config.placedGraphics, validateCustomGraphics(config.customGraphics));
  const markerIds = new Set<string>();
  if (config.markers.length > MAX_MAP_MARKERS) throw new Error("A project may contain at most 250 markers.");
  for (const marker of config.markers) {
    if (!marker || typeof marker !== "object" || typeof marker.id !== "string" || !marker.id.trim() || marker.id.length > 120) throw new Error("Each marker must have a valid id.");
    if (markerIds.has(marker.id)) throw new Error("Marker ids must be unique.");
    markerIds.add(marker.id);
    if (!Number.isFinite(marker.lat) || marker.lat < -85.0511 || marker.lat > 85.0511) throw new Error("Marker latitude must be within Web Mercator limits.");
    if (!Number.isFinite(marker.lon) || marker.lon < -180 || marker.lon > 180) throw new Error("Marker longitude must be between -180 and 180 degrees.");
    const size = marker.sizeMm === undefined ? MAP_MARKER_SIZE_MM : marker.sizeMm;
    if (!Number.isFinite(size) || size < MAP_MARKER_MIN_SIZE_MM || size > MAP_MARKER_MAX_SIZE_MM) throw new Error(`Marker size must be between ${MAP_MARKER_MIN_SIZE_MM} and ${MAP_MARKER_MAX_SIZE_MM} mm.`);
    if (marker.symbol === "custom") {
      if (typeof marker.iconId !== "string" || !iconIds.has(marker.iconId)) throw new Error("A custom marker must name one of the project's marker icons.");
    } else {
      if (!(MARKER_SYMBOLS as readonly string[]).includes(marker.symbol)) throw new Error("Marker symbol is invalid.");
      if (marker.iconId !== undefined) throw new Error("Only custom markers name a marker icon.");
    }
    checkCustomDataName(marker.name, "Marker");
  }
  const customLineIds = new Set<string>();
  if (config.customLines.length > MAX_CUSTOM_LINES) throw new Error("A project may contain at most 250 custom lines.");
  let customPointCount = 0;
  for (const line of config.customLines) {
    if (!line || typeof line !== "object" || typeof line.id !== "string" || !line.id.trim() || line.id.length > 120) throw new Error("Each custom line must have a valid id.");
    if (customLineIds.has(line.id)) throw new Error("Custom line ids must be unique.");
    customLineIds.add(line.id);
    if (!CUSTOM_LINE_KINDS.includes(line.kind)) throw new Error("Custom line type must be trail or boundary.");
    checkCustomDataName(line.name, "Custom line");
    if (!Array.isArray(line.points) || line.points.length < 2) throw new Error("Each custom line must contain at least two points.");
    if (line.points.length > MAX_CUSTOM_LINE_POINTS) throw new Error("Each custom line may contain at most 2000 points.");
    customPointCount += line.points.length;
    if (customPointCount > MAX_CUSTOM_DATA_POINTS) throw new Error("Custom lines may contain at most 10000 points in total.");
    for (const point of line.points) {
      if (!point || typeof point !== "object" || !Number.isFinite(point.lat) || point.lat < -85.0511 || point.lat > 85.0511) throw new Error("Custom line latitude must be within Web Mercator limits.");
      if (!Number.isFinite(point.lon) || point.lon < -180 || point.lon > 180) throw new Error("Custom line longitude must be between -180 and 180 degrees.");
    }
  }
  const lineWidths = [config.lineStyle.contourMm, config.lineStyle.indexContourMm, config.lineStyle.majorRoadMm, config.lineStyle.localRoadMm, config.lineStyle.trailMm, config.lineStyle.waterMm, config.lineStyle.boundaryMm, config.lineStyle.coordinateGridMm, config.lineStyle.annotationMm, config.lineStyle.borderMm];
  if (![config.widthMm, config.heightMm, config.verticalExaggeration, config.materialThicknessMm, config.engravingContourCount, config.engravingIndexInterval, config.minimumFeatureMm, config.glueMarginMm, config.laserKerfMm, config.smoothing, config.location.lat, config.location.lon, config.location.zoom, config.elevationLabelPosition.x, config.elevationLabelPosition.y, config.textStyle.sizeMm, config.northArrowSizeMm, config.northArrowPlacement.offset.x, config.northArrowPlacement.offset.y, ...lineWidths].every(Number.isFinite)) throw new Error("Project values must be finite numbers.");
  if (lineWidths.some((width) => width < 0.05 || width > 1.5)) throw new Error("Line widths must be between 0.05 and 1.5 mm.");
  if (!Number.isFinite(config.lineStyle.majorRoadSpacingMm) || config.lineStyle.majorRoadSpacingMm < 0.2 || config.lineStyle.majorRoadSpacingMm > 4) throw new Error("Major road spacing must be between 0.2 and 4 mm.");
  if (config.lineStyle.roadStyle !== "centerline" && config.lineStyle.roadStyle !== "outlined") throw new Error("Road style must be centerline or outlined.");
  if (config.lineStyle.roadCap !== "round" && config.lineStyle.roadCap !== "square") throw new Error("Road cap must be round or square.");
  if (config.lineStyle.trailPattern !== "solid" && config.lineStyle.trailPattern !== "dashed" && config.lineStyle.trailPattern !== "dotted") throw new Error("Trail pattern must be solid, dashed, or dotted.");
  if (!Number.isInteger(config.engravingContourCount) || config.engravingContourCount < 4 || config.engravingContourCount > 40) throw new Error("Engraving contour count must be an integer between 4 and 40.");
  if (!Number.isInteger(config.engravingIndexInterval) || config.engravingIndexInterval < 2 || config.engravingIndexInterval > 10) throw new Error("Engraving index interval must be an integer between 2 and 10.");
  if (config.minimumFeatureMm < 0.2 || config.minimumFeatureMm > 5) throw new Error("Minimum feature must be between 0.2 and 5 mm.");
  if (config.glueMarginMm < 2 || config.glueMarginMm > 25) throw new Error("Glue margin must be between 2 and 25 mm.");
  if (config.laserKerfMm < 0 || config.laserKerfMm > 1) throw new Error("Laser kerf must be between 0 and 1 mm.");
  for (const [label, value] of [["Work area width", config.workAreaWidthMm], ["Work area height", config.workAreaHeightMm]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or a positive number of millimeters.`);
    if (value > 0 && (value < MIN_WORK_AREA_MM || value > MAX_PROJECT_DIMENSION_MM)) throw new Error(`${label} must be 0 (unlimited) or between ${MIN_WORK_AREA_MM} and ${MAX_PROJECT_DIMENSION_MM} mm.`);
    if (value > 0 && value - config.laserKerfMm < MIN_WORK_AREA_MM) throw new Error(`${label} must leave at least ${MIN_WORK_AREA_MM} mm of usable bed after the laser kerf.`);
  }
  if (!Number.isFinite(config.seamOffsetMm) || config.seamOffsetMm < 0 || config.seamOffsetMm > MAX_SEAM_OFFSET_MM) throw new Error(`Seam offset must be between 0 and ${MAX_SEAM_OFFSET_MM} mm.`);
  if (config.smoothing !== 0 && config.smoothing !== 1) throw new Error("Contour smoothing must be 0 or 1.");
  if (Math.abs(config.elevationLabelPosition.x) > 0.9 || Math.abs(config.elevationLabelPosition.y) > 0.9) throw new Error("Elevation label position must be between -90% and 90%.");
  if (!isTextFont(config.textStyle.font)) throw new Error("Text font must be one of the listed engraving fonts.");
  if (config.textStyle.sizeMm < 2 || config.textStyle.sizeMm > 10) throw new Error("Text size must be between 2 and 10 mm.");
  if (!NORTH_ARROW_STYLES.includes(config.northArrowStyle)) throw new Error("North arrow style must be minimal, classic, or mariner.");
  if (!NORTH_ARROW_ANCHORS.includes(config.northArrowPlacement.anchor)) throw new Error("North arrow anchor is invalid.");
  const northArrowMaximum = northArrowMaximumMm(config.widthMm, config.heightMm);
  if (config.northArrowSizeMm < NORTH_ARROW_MIN_SIZE_MM || config.northArrowSizeMm > northArrowMaximum) throw new Error(`North arrow size must be between ${NORTH_ARROW_MIN_SIZE_MM} and ${northArrowMaximum} mm.`);
  if (Math.abs(config.northArrowPlacement.offset.x) > 1 || Math.abs(config.northArrowPlacement.offset.y) > 1) throw new Error("North arrow offsets must be between -100% and 100%.");
  if (config.plaque !== undefined) validatePlaque(config.plaque);
  if (config.scaleBarPlacement !== undefined) validatePlacement(config.scaleBarPlacement, "Scale bar");
  if (!config.waterDepthOverrides || typeof config.waterDepthOverrides !== "object") throw new Error("Water depth overrides are required.");
  for (const [lake, depth] of Object.entries(config.waterDepthOverrides)) {
    if (!/^[1-9]\d*$/.test(lake)) throw new Error(`Water depth override key ${lake} must be a HydroLAKES id.`);
    if (!Number.isFinite(depth) || depth <= 0 || depth > 12000) throw new Error(`Water depth override for lake ${lake} must be between 0 and 12000 m.`);
  }
  if (config.userDepthCharts !== undefined) {
    if (typeof config.userDepthCharts !== "object" || Array.isArray(config.userDepthCharts)) throw new Error("Depth chart references must be an object.");
    for (const [lake, reference] of Object.entries(config.userDepthCharts)) {
      if (!reference || typeof reference !== "object") throw new Error(`Depth chart for lake ${lake} must be an object.`);
      if (typeof reference.id !== "string" || !DEPTH_CHART_ID_PATTERN.test(reference.id)) throw new Error(`Depth chart id for lake ${lake} must be 8-64 lowercase letters, digits, or dashes.`);
      if (!isDepthChartLakeKey(lake, reference)) throw new Error(`Depth chart key ${lake} must be a HydroLAKES id, or outline: and the chart's own id.`);
      if (typeof reference.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(reference.contentHash)) throw new Error(`Depth chart for lake ${lake} needs a lowercase SHA-256 content hash.`);
    }
  }
  const bounds = config.location.bounds;
  if (bounds) assertGeographicBounds(bounds, "Project");
}

/** The project's uploaded marker icons; returns their ids for markers to reference. */
function validateMarkerIcons(icons: ProjectConfigV1["markerIcons"]): Set<string> {
  const ids = new Set<string>();
  if (icons === undefined) return ids;
  if (!Array.isArray(icons)) throw new Error("Marker icons must be a list.");
  if (icons.length > MAX_MARKER_ICONS) throw new Error(`A project may contain at most ${MAX_MARKER_ICONS} marker icons.`);
  for (const icon of icons) {
    if (!icon || typeof icon !== "object" || typeof icon.id !== "string" || !MARKER_ICON_ID_PATTERN.test(icon.id)) throw new Error("Each marker icon id must be 8-64 lowercase letters, digits, or dashes.");
    if (ids.has(icon.id)) throw new Error("Marker icon ids must be unique.");
    ids.add(icon.id);
    if (typeof icon.name !== "string" || !icon.name.trim() || icon.name.length > MAX_CUSTOM_DATA_NAME_LENGTH) throw new Error(`Marker icon name must contain 1-${MAX_CUSTOM_DATA_NAME_LENGTH} characters.`);
    if (icon.anchor !== undefined && icon.anchor !== "bottom") throw new Error("Marker icon anchor must be bottom, or absent.");
    validateIconShapes(icon.shapes, "marker icon", MAX_MARKER_ICON_POINTS);
  }
  return ids;
}

/** Stored integer rings, shared by marker icons and custom graphics. */
function validateIconShapes(shapes: MarkerIconShapeV1[], label: string, maxPoints: number): void {
  const half = MARKER_ICON_UNITS / 2;
  const validRing = (ring: unknown): ring is number[] => Array.isArray(ring) && ring.length >= 6 && ring.length % 2 === 0 && ring.every((value) => Number.isSafeInteger(value) && Math.abs(value) <= half);
  const capitalized = label[0]!.toUpperCase() + label.slice(1);
  if (!Array.isArray(shapes) || !shapes.length) throw new Error(`Each ${label} must contain at least one shape.`);
  let points = 0;
  for (const shape of shapes) {
    if (!shape || typeof shape !== "object" || !validRing(shape.outer)) throw new Error(`${capitalized} rings must be at least three whole-number points within ±${half}.`);
    if (shape.holes !== undefined && (!Array.isArray(shape.holes) || !shape.holes.every(validRing))) throw new Error(`${capitalized} rings must be at least three whole-number points within ±${half}.`);
    points += (shape.outer.length + (shape.holes ?? []).reduce((sum, hole) => sum + hole.length, 0)) / 2;
  }
  if (points > maxPoints) throw new Error(`Each ${label} may contain at most ${maxPoints} points.`);
}

/** The project's uploaded graphics; returns their ids for placements to reference. */
function validateCustomGraphics(graphics: ProjectConfigV1["customGraphics"]): Set<string> {
  const ids = new Set<string>();
  if (graphics === undefined) return ids;
  if (!Array.isArray(graphics)) throw new Error("Custom graphics must be a list.");
  if (graphics.length > MAX_CUSTOM_GRAPHICS) throw new Error(`A project may contain at most ${MAX_CUSTOM_GRAPHICS} custom graphics.`);
  for (const graphic of graphics) {
    if (!graphic || typeof graphic !== "object" || typeof graphic.id !== "string" || !MARKER_ICON_ID_PATTERN.test(graphic.id)) throw new Error("Each custom graphic id must be 8-64 lowercase letters, digits, or dashes.");
    if (ids.has(graphic.id)) throw new Error("Custom graphic ids must be unique.");
    ids.add(graphic.id);
    if (typeof graphic.name !== "string" || !graphic.name.trim() || graphic.name.length > MAX_CUSTOM_DATA_NAME_LENGTH) throw new Error(`Custom graphic name must contain 1-${MAX_CUSTOM_DATA_NAME_LENGTH} characters.`);
    validateIconShapes(graphic.shapes, "custom graphic", MAX_CUSTOM_GRAPHIC_POINTS);
  }
  return ids;
}

function validatePlacedGraphics(placedGraphics: ProjectConfigV1["placedGraphics"], graphicIds: Set<string>): void {
  if (placedGraphics === undefined) return;
  if (!Array.isArray(placedGraphics)) throw new Error("Placed graphics must be a list.");
  if (placedGraphics.length > MAX_PLACED_GRAPHICS) throw new Error(`A project may place at most ${MAX_PLACED_GRAPHICS} graphics.`);
  const ids = new Set<string>();
  for (const placed of placedGraphics) {
    if (!placed || typeof placed !== "object" || typeof placed.id !== "string" || !MARKER_ICON_ID_PATTERN.test(placed.id)) throw new Error("Each placed graphic id must be 8-64 lowercase letters, digits, or dashes.");
    if (ids.has(placed.id)) throw new Error("Placed graphic ids must be unique.");
    ids.add(placed.id);
    if (typeof placed.graphicId !== "string" || !graphicIds.has(placed.graphicId)) throw new Error("A placed graphic must name one of the project's custom graphics.");
    validatePlacement(placed.placement, "Graphic");
    if (!Number.isFinite(placed.sizeMm) || placed.sizeMm < GRAPHIC_MIN_SIZE_MM || placed.sizeMm > GRAPHIC_MAX_SIZE_MM) throw new Error(`Graphic size must be between ${GRAPHIC_MIN_SIZE_MM} and ${GRAPHIC_MAX_SIZE_MM} mm.`);
    if (!Number.isFinite(placed.rotationDeg) || placed.rotationDeg < 0 || placed.rotationDeg >= 360) throw new Error("Graphic rotation must be at least 0 and under 360 degrees.");
    if (!GRAPHIC_OPERATIONS.includes(placed.operation)) throw new Error("Graphic operation must be engrave, score, or cut.");
  }
}

/** A marker's or path's own name, which is optional and only ever bookkeeping. */
function checkCustomDataName(name: unknown, label: "Marker" | "Custom line"): void {
  if (name === undefined) return;
  if (typeof name !== "string" || !name.trim()) throw new Error(`${label} name must be text, or absent.`);
  if (name.length > MAX_CUSTOM_DATA_NAME_LENGTH) throw new Error(`${label} name must contain at most ${MAX_CUSTOM_DATA_NAME_LENGTH} characters.`);
}

function validatePlacement(placement: NorthArrowPlacementV1 | undefined, name: string): void {
  if (!placement || typeof placement !== "object" || !NORTH_ARROW_ANCHORS.includes(placement.anchor)) throw new Error(`${name} anchor is invalid.`);
  if (!placement.offset || ![placement.offset.x, placement.offset.y].every(Number.isFinite) || Math.abs(placement.offset.x) > 1 || Math.abs(placement.offset.y) > 1) throw new Error(`${name} offsets must be between -100% and 100%.`);
}

function validatePlaque(plaque: PlaqueV1): void {
  if (!plaque || typeof plaque !== "object" || typeof plaque.enabled !== "boolean" || typeof plaque.text !== "string") throw new Error("Title settings are invalid.");
  const lines = plaque.text.split(/\r?\n/);
  if (lines.length > PLAQUE_MAX_LINES) throw new Error(`Title text must be ${PLAQUE_MAX_LINES} lines or fewer.`);
  if (lines.some((line) => line.length > PLAQUE_MAX_LINE_LENGTH)) throw new Error(`Each title line must be ${PLAQUE_MAX_LINE_LENGTH} characters or fewer.`);
  if (!Number.isFinite(plaque.sizeMm) || plaque.sizeMm < PLAQUE_MIN_SIZE_MM || plaque.sizeMm > PLAQUE_MAX_SIZE_MM) throw new Error(`Title size must be between ${PLAQUE_MIN_SIZE_MM} and ${PLAQUE_MAX_SIZE_MM} mm.`);
  if (plaque.font !== undefined && !isTextFont(plaque.font)) throw new Error("Title font must be one of the listed engraving fonts.");
  const placement = plaque.placement;
  if (!placement || typeof placement !== "object" || !NORTH_ARROW_ANCHORS.includes(placement.anchor)) throw new Error("Title anchor is invalid.");
  if (!placement.offset || ![placement.offset.x, placement.offset.y].every(Number.isFinite) || Math.abs(placement.offset.x) > 1 || Math.abs(placement.offset.y) > 1) throw new Error("Title offsets must be between -100% and 100%.");
}
