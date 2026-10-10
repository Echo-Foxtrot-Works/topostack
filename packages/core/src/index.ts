export * from "./types.js";
export { planSeamGrid } from "./pipeline/split.js";
export { generateGeometry, createGeometryGenerator, createParallelGeometryGenerator, type ParallelGenerationOptions, type GenerationOptions, type GenerationStage } from "./pipeline/generate.js";
export { createSyntheticSource } from "./pipeline/synthetic-source.js";
export { projectFingerprint } from "./pipeline/fingerprint.js";
export { CONTOUR_SIMPLIFICATION_TOLERANCE_MM } from "./pipeline/contours.js";
// Polygon clip inputs appear in exported signatures (paint regions, marker
// placement), so the prepared form is public even though the primitives stay internal.
export { distanceToSegment, polylineLength, signedArea, type PreparedPolygons } from "./primitives/geometry2d.js";
export { labelDimensions, labelLineSegments, labelPathData, labelSvgPaths, roundText, unsupportedLabelCharacters, type LabelLineSegment } from "./annotate/labels.js";
export { FONT_CATALOG, clearRegisteredFonts, decodeFontGlyphs, fontEntry, isBitmapFont, isFontLoaded, missingGlyphs, projectFonts, registerFont, type FontCatalogEntry, type FontGlyphsV1, type FontKind } from "./annotate/font-data.js";
export { markerCenterForAnchor, markerIcon, markerPolygons, markerSymbolPaths, unwrapLongitude } from "./annotate/markers.js";
export { buildMarkerIcon, iconShapePolygons, markerIconPointCount, markerIconPolygons, type MarkerIconPaint } from "./annotate/marker-icons.js";
export { placedGraphicCenter, placedGraphicFootprint, placedGraphicMarkingPrefix, placedGraphicMarkings, placedGraphicPlacementAt, placedGraphicSource } from "./annotate/graphics.js";
export { flattenSvgPath, type PathPolyline } from "./annotate/svg-path-data.js";
export { northArrowCenter, northArrowFootprint, northArrowMarkings, northArrowPlacementAt } from "./annotate/north-arrow.js";
export { activePlaque, plaqueBox, plaqueFont, plaqueFootprint, plaqueMarkings, plaquePlacementAt } from "./annotate/plaque.js";
export { scaleBarCenter, scaleBarFootprint, scaleBarMarkings, scaleBarPlacementAt } from "./annotate/scale-bar.js";
export { layerToSvg } from "./export/svg.js";
export type { GuideFont } from "./export/assembly-guide.js";
export { buildFabricationPackage, buildProjectPackage, type PackageOptions } from "./export/packages.js";
export { DEFAULT_SHEET_NESTING, SHEET_NEST_LIMITS, resolveSheetNestSettings, type SheetNestSettingsResult } from "./export/sheet-nest/resolve.js";
export type { StripEngine, StripEngineItem, StripEngineJob, StripEnginePlacement, StripEngineResult } from "./export/sheet-nest/engine.js";
export { nestableParts } from "./export/sheet-nest/parts.js";
export { sheetNestJobKey } from "./export/sheet-nest/job-key.js";
export { rectangleEngine } from "./export/sheet-nest/rectangles.js";
export { SheetNestError, planSheets, type PlanSheetsOptions } from "./export/sheet-nest/plan-sheets.js";
export { verifySheetPlan } from "./export/sheet-nest/verify.js";
export { paintRegions, paintStencil } from "./pipeline/paint-regions.js";
export type { FlatWaterArea, PaintLayerClip, PaintRegionSources } from "./pipeline/paint-regions.js";
export { DEFAULT_WATER_INSERT_CLEARANCE_MM, WATER_INSERT_LEDGE_MM, WATER_INSERT_MIN_WIDTH_MM, waterInsertMaterial } from "./pipeline/water-inserts.js";
export { airspacePieceMarkings } from "./export/airspace.js";
export { airspacePanelGroups } from "./pipeline/airspace-panels.js";
export { AIRSPACE_DEFAULT_CAP_FT, DEFAULT_AIRSPACE_STACK, airspaceMaterial, airspaceTint, registerAirspaceStage, type AirspaceStage } from "./pipeline/airspace-settings.js";
export { acrylicPanelGroups } from "./pipeline/water-insert-panels.js";
export { acrylicGeometry, acrylicNestableParts, resolveAcrylicNestSettings } from "./export/water-inserts.js";
export { FEET_PER_METER, displayElevation, displayLength, elevationUnit, lengthUnit, millimetersFromDisplay } from "./primitives/units.js";
// Water carving is a stage of `generateGeometry`, not an entry point: its
// scratch-buffer helpers and ladder fitting are meaningless without the grid
// state it threads through them. Import those from "./water/water.js" directly.
// `carveWaterDepth` stays public because scripts/verify/verify-lake-outlines.mjs
// carves a grid in the browser to compare provider outlines.
export { carveWaterDepth } from "./water/water.js";
// The lake-page depth previews (apps/generator/src/lib/site/lake-preview) repeat the studio's shoreline smoothing before carving.
export { smoothLakeShorelines } from "./water/lake-shoreline.js";
export { waterPatternStrokes } from "./water/water-pattern.js";
export { exportBlockReason } from "./export/export-policy.js";
export { sourceRequirements } from "./pipeline/source-requirements.js";
export { AVIATION_DATA_DETAILS, NO_AVIATION, aviationClassEnabled, aviationRequested, aviationStroke, type AviationAltitudeCandidate, type AviationLabelCandidate, type AviationStroke, type AviationSymbolBox } from "./pipeline/aviation.js";
export { cropRadiusMm } from "./primitives/crop.js";

export { executeGeometryTask, type GeometryTask, type GeometryBatch, type GeometryTaskResult } from "./pipeline/generation-tasks.js";

// Reading, describing and planning projects; also published alone as `@topostack/core/project`.
export * from "./project/index.js";
