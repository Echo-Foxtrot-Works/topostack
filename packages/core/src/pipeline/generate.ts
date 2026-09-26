import { alignmentGuideMarkings } from "./alignment.js";
import { executeGeometryTask, type GeometryBatch, type GeometryTaskResult } from "./generation-tasks.js";
import { addMaterialNests } from "./nesting.js";
import { CONTOUR_SIMPLIFICATION_FACTOR, clipContours, removeTinyRing, contourToMm, layerForElevation, roundContourRing, sampleElevation, simplify } from "./contours.js";
import { groundWidthMFor, horizontalScaleFor, planTerrainStack } from "./stack-plan.js";
import { coordinateGridMarkings } from "./coordinate-grid.js";
import { fabricationLabel, junctionRing, longestPath, polylineLength, styledTransportationPaths, transportationJunctions, transportationOutlines } from "./transportation.js";
import { assertGeographicBounds, validateProject } from "./validate.js";
import { projectFingerprint } from "./fingerprint.js";
import { smoothLakeShorelines } from "../water/lake-shoreline.js";
import { cropBoundary as boundary, cropElevationRange } from "../primitives/crop.js";
import { contours } from "d3-contour";
import polygonClipping, { type MultiPolygon, type Pair, type Ring } from "polygon-clipping";
import {
  clipPolyline,
  close,
  mercatorWorldY,
  normalizeMultiPolygon,
  pointInPreparedPolygons,
  pointInRing,
  type PreparedPolygons,
  preparePolygons,
  toPoint,
  toRing,
} from "../primitives/geometry2d.js";
import { labelDimensions, labelGeometry } from "../annotate/labels.js";
import { addLabelObstacles, indexLabelLayer, placeElevationLabelStack, selectElevationLabels, type CoordinatedElevationLabel, placeLinearLabel } from "../annotate/label-placement.js";
import { geoPointToMapPoint, longitudeInBounds, markerCenterForAnchor, markerPolygons } from "../annotate/markers.js";
import { markerLayerPolygons } from "../annotate/marker-placement.js";
import { GRAPHIC_CLEARANCE_MM, placedGraphicMarkingPrefix, placedGraphicPolygons } from "../annotate/graphics.js";
import { offsetClosedRing } from "../primitives/offset.js";
import { northArrowMarkings } from "../annotate/north-arrow.js";
import { scaleBarMarkings } from "../annotate/scale-bar.js";
import { plaqueFootprint, plaqueMarkings } from "../annotate/plaque.js";
import { sourceRequirements } from "./source-requirements.js";
import { splitLayersForWorkArea } from "./split.js";
import { coveredLabelPoint } from "./piece-labels.js";
import { displayElevation, elevationUnit } from "../primitives/units.js";
import { MAP_MARKER_CLEARANCE_MM, MAP_MARKER_SIZE_MM, MIN_LAYER_COUNT, SEA_LEVEL_M } from "../types.js";
import { type CarvedWater, carveWaterDepth, clampCarveToLadder, fitLakesToLadder, waterSurfaceLevelM } from "../water/water.js";
import { type FlatWaterArea, paintRegions } from "./paint-regions.js";
import type {
  ElevationGrid,
  GeometryIRV1,
  GeometryWarning,
  LayerIR,
  MarkingFeature,
  Point2D,
  OperationPath,
  Polygon2D,
  ProjectConfigV1,
  SourceBundleV1,
  TerrainStackPlan,
  TransportationClass,
  WaterAreaV1,
  WaterSurfaceIR,
} from "../types.js";

const TRANSPORTATION_LABEL_LIMIT = 80;


/** Each layer's material and the material stacked above it, indexed once for routing many markings. */
interface LayerClip {
  layer: LayerIR;
  material: PreparedPolygons;
  covering: PreparedPolygons;
}

/** Preserve the original rings when no union is needed or near-coincident edges defeat the boolean library. */
function concatPrepared(upper: PreparedPolygons, lower: PreparedPolygons): PreparedPolygons {
  return {
    polygons: [...upper.polygons, ...lower.polygons],
    outerBounds: [...upper.outerBounds, ...lower.outerBounds],
    rings: [...upper.rings, ...lower.rings],
    polygonRings: [...upper.polygonRings, ...lower.polygonRings],
    bounds: {
      minX: Math.min(upper.bounds.minX, lower.bounds.minX), minY: Math.min(upper.bounds.minY, lower.bounds.minY),
      maxX: Math.max(upper.bounds.maxX, lower.bounds.maxX), maxY: Math.max(upper.bounds.maxY, lower.bounds.maxY),
    },
  };
}

/** Merge overlapping covering material once, instead of rechecking every buried contour per road segment. */
function unionPrepared(upper: PreparedPolygons, lower: PreparedPolygons): PreparedPolygons {
  if (!upper.polygons.length) return lower;
  if (!lower.polygons.length) return upper;
  const multi = (polygons: Polygon2D[]): MultiPolygon => polygons.map(({ outer, holes }) => [toRing(outer), ...holes.map(toRing)]);
  try {
    return preparePolygons(normalizeMultiPolygon(polygonClipping.union(multi(upper.polygons), multi(lower.polygons))));
  } catch {
    // This is only an acceleration structure. The original rings remain a
    // complete, exact covering set if a union cannot resolve coincident edges.
    return concatPrepared(upper, lower);
  }
}

/** Built top-down: each layer's covering is the layer above's material plus that layer's covering. */
function layerClips(layers: LayerIR[], mergeCovering: boolean): LayerClip[] {
  const clips: LayerClip[] = new Array(layers.length);
  let covering = preparePolygons([]);
  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const layer = layers[layerIndex]!;
    const material = preparePolygons(layer.polygons);
    clips[layerIndex] = { layer, material, covering };
    covering = mergeCovering ? unionPrepared(material, covering) : concatPrepared(material, covering);
  }
  return clips;
}

function addAlignmentGuides(config: ProjectConfigV1, clips: LayerClip[], outlines: Polygon2D[][]): void {
  for (let index = 0; index < clips.length - 1; index += 1) {
    const layer = clips[index]!.layer;
    layer.markings.push(...alignmentGuideMarkings(config, layer, clips[index + 1]!.layer, outlines[index + 1]));
  }
}

/**
 * Engrave each cut piece's assembly id where the stack above hides it.
 *
 * A visible id would survive glue-up as a blemish, so a piece with no covered
 * room keeps none - which is also why the top layer and flat engravings get
 * none at all, their covering being empty. `placeLabel` already requires the
 * label box to sit inside both the layer's material and `requiredPolygons`,
 * so passing the covered sub-region is the whole "prefer covered" filter.
 */
function addPieceLabels({ config, flatEngraving, warnings }: GenerationContext, clips: LayerClip[]): void {
  // A flat artwork has nothing stacked over it - its "layers" are contour
  // lines on one face - so no id could ever be hidden. Its pieces are named
  // by panel filename instead.
  if (!config.showAssemblyLabels || flatEngraving) return;
  const omitted: string[] = [];
  for (const { layer, covering } of clips) {
    if (!layer.pieces.length) continue;
    const labelIndex = indexLabelLayer(layer.polygons, layer.markings);
    for (const piece of layer.pieces) {
      const polygon = layer.polygons[piece.polygonIndex];
      if (!polygon) continue;
      const point = coveredLabelPoint(piece.id, config, labelIndex, polygon, covering);
      if (!point) {
        omitted.push(piece.id);
        continue;
      }
      const marking: OperationPath = {
        id: `piece-${piece.id}-label`,
        operation: "engrave",
        kind: "guide",
        points: [point],
        label: piece.id,
        textStyle: config.textStyle,
      };
      layer.markings.push(marking);
      addLabelObstacles(labelIndex, [marking]);
    }
  }
  if (omitted.length) warnings.push({
    code: "LABEL_OMITTED",
    message: `Assembly ids were omitted from ${omitted.length} piece${omitted.length === 1 ? "" : "s"} (${omitted.slice(0, 4).join(", ")}) because no position stayed hidden under the layer above.`,
  });
}

function isClosedWater(feature: MarkingFeature): boolean {
  return feature.kind === "water" && feature.points.length > 3 && Math.hypot(feature.points[0]!.x - feature.points.at(-1)!.x, feature.points[0]!.y - feature.points.at(-1)!.y) <= 1e-6;
}

function splitMarking(feature: MarkingFeature, thresholds: number[], grid: ElevationGrid, config: ProjectConfigV1): Array<{ layer: number; points: Point2D[] }> {
  if (isClosedWater(feature)) {
    const elevations = feature.points.slice(0, -1).map((point) => feature.elevationM ?? sampleElevation(grid, point, config)).sort((left, right) => left - right);
    const middle = Math.floor(elevations.length / 2);
    const elevation = elevations.length % 2 === 0 ? ((elevations[middle - 1] ?? grid.min) + (elevations[middle] ?? grid.min)) / 2 : (elevations[middle] ?? grid.min);
    return [{ layer: layerForElevation(elevation, thresholds), points: feature.points }];
  }
  const result: Array<{ layer: number; points: Point2D[] }> = [];
  // A single-point feature (e.g. a point label) still belongs to a layer even
  // though it produces no drawable segment.
  const minimumRun = feature.points.length === 1 ? 1 : 2;
  let activeLayer = -1;
  let active: Point2D[] = [];
  for (const point of feature.points) {
    const elevation = feature.elevationM ?? sampleElevation(grid, point, config);
    const layer = layerForElevation(elevation, thresholds);
    if (layer !== activeLayer) {
      if (active.length >= minimumRun && activeLayer >= 0) result.push({ layer: activeLayer, points: active });
      activeLayer = layer;
      active = active.length ? [active[active.length - 1]!, point] : [point];
    } else {
      active.push(point);
    }
  }
  if (active.length >= minimumRun && activeLayer >= 0) result.push({ layer: activeLayer, points: active });
  return result;
}

function waterPatternAreasFromShorelines(markings: MarkingFeature[]): Polygon2D[] {
  const grouped = new Map<string, Map<number, Point2D[]>>();
  for (const marking of markings) {
    const match = marking.kind === "water" ? marking.id.match(/^(.*water-area-[^-]+)-shore-(\d+)/) : undefined;
    if (!match || marking.points.length < 4) continue;
    const rings = grouped.get(match[1]!) ?? new Map<number, Point2D[]>();
    rings.set(Number(match[2]), marking.points);
    grouped.set(match[1]!, rings);
  }
  return [...grouped.values()].flatMap((rings) => {
    const outer = rings.get(0);
    return outer ? [{ outer, holes: [...rings.entries()].filter(([index]) => index > 0).sort(([left], [right]) => left - right).map(([, points]) => points) }] : [];
  });
}

/**
 * Validate a grid and return it with extrema taken from its samples. Declared
 * `min`/`max` are only trusted when they agree with the data to Float32
 * precision: a provider that reports its no-data sentinel (-32768) as the
 * minimum would otherwise stretch the ladder across 33 km of empty relief.
 */
function measuredElevationGrid(grid: ElevationGrid): ElevationGrid {
  if (grid.values.length !== grid.width * grid.height) throw new Error("Elevation grid dimensions do not match its values.");
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || !Number.isFinite(grid.min) || !Number.isFinite(grid.max) || grid.max < grid.min) throw new Error("Elevation grid metadata is invalid.");
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of grid.values) {
    if (!Number.isFinite(value)) throw new Error("Elevation grid contains non-finite values.");
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // Float32 storage rounds by at most one part in ~2^24; keep the caller's
  // more precise figure when it describes the same extreme.
  const agrees = (declared: number, measured: number) => Math.abs(declared - measured) <= Math.max(1e-3, Math.abs(measured) * 1e-6);
  const trustedMin = agrees(grid.min, min) ? grid.min : min;
  const trustedMax = agrees(grid.max, max) ? grid.max : max;
  return trustedMin === grid.min && trustedMax === grid.max ? grid : { ...grid, min: trustedMin, max: trustedMax };
}

/** Inputs and accumulators shared by every generation phase. */
interface GenerationContext {
  config: ProjectConfigV1;
  source: SourceBundleV1;
  flatEngraving: boolean;
  /** Stack-only: flat engravings ignore water depth entirely. */
  usesWaterDepth: boolean;
  /** Closed crop outline in artwork millimeters. */
  clip: Point2D[];
  warnings: GeometryWarning[];
}

/** The elevation ladder every layer is contoured from, plus the grid it is cut from. */
interface ElevationLadder {
  landMin: number;
  landMax: number;
  visibleMin: number;
  visibleMax: number;
  depthBelowLandM: number;
  stack: TerrainStackPlan;
  ladderBase: number;
  /** Layer base elevations; trimmed when empty circular caps are dropped. */
  thresholds: number[];
  /** Carved water after any fit to the ladder floor. */
  water: CarvedWater;
  /** The carved, fitted, and floor-clamped grid actually contoured. */
  modelGrid: ElevationGrid;
}

interface TransportationLabelCandidate {
  layer: LayerIR;
  paths: Point2D[][];
  transportationClass: TransportationClass;
  excludedPolygons: Polygon2D[];
}

/** Every visible clipped run of each distinct road or trail name. */
type TransportationLabelCandidates = Map<string, TransportationLabelCandidate[]>;

function addSourceWarnings({ config, source, usesWaterDepth, warnings }: GenerationContext): void {
  if (source.terrainSourceUnavailable) warnings.push({
    code: "TERRAIN_SOURCE_FALLBACK",
    message: "Higher-resolution terrain is unavailable for this area. The map uses the standard elevation source instead.",
  });
  if ((source.elevationRepairCount ?? 0) > 0) warnings.push({
    code: "ELEVATION_REPAIRED",
    message: "Isolated depth spikes in the elevation data were replaced with estimates from nearby terrain. Review the terrain before cutting.",
  });
  const wantsVectorData = sourceRequirements(config).vectors;
  if (source.vectorStatus === "partial" && wantsVectorData) warnings.push({
    code: "VECTOR_DATA_PARTIAL",
    message: "The map detail feature limit was reached, so some roads, trails, water lines, or boundaries may be missing.",
  });
  if (source.vectorStatus === "unavailable" && wantsVectorData) warnings.push({
    code: "VECTOR_DATA_UNAVAILABLE",
    message: "Map detail data is unavailable. This project cannot be exported until the map data is restored or those details are disabled.",
  });
  if (source.lakeDataStatus === "unavailable" && usesWaterDepth) warnings.push({
    code: "LAKE_DATA_UNAVAILABLE",
    message: "Lake depth data is unavailable. Disable water depth or regenerate after the service is restored before exporting.",
  });
  if ((source.bathymetryStatus === "unavailable" || source.bathymetryStatus === "partial") && usesWaterDepth) warnings.push({
    code: "BATHYMETRY_FALLBACK",
    message: "Some surveyed lake-floor data is unavailable. Gaps use existing terrain or modeled basins instead.",
  });
}

/**
 * Carve modeled lake beds into the grid before anything reads it. Everything
 * downstream then produces the recess on its own: the contour rings become
 * holes, and holes are already honoured by clipping, nesting, and labelling.
 */
function carveWater(context: GenerationContext, grid: ElevationGrid): { waterAreas: WaterAreaV1[]; carved: CarvedWater } {
  const { config, source } = context;
  const waterAreas: WaterAreaV1[] = context.usesWaterDepth
    ? (source.waterAreas ?? []).map((area) => {
        const override = area.hylakId === undefined ? undefined : config.waterDepthOverrides[String(area.hylakId)];
        return override && override > 0 ? { ...area, maxDepthM: override, depthSource: "user" as const } : area;
      })
    : [];
  const groundWidthM = groundWidthMFor(source.bounds);
  const radians = Math.PI / 180;
  // Mercator world Y runs north-to-south over [0, 1] of a 2*pi world, so the
  // bounds' projected height is that span read back off the shared projection.
  const mercatorHeight = 2 * Math.PI * (mercatorWorldY(source.bounds.south) - mercatorWorldY(source.bounds.north));
  const groundHeightM = groundWidthM * mercatorHeight / ((source.bounds.east - source.bounds.west) * radians);
  const carved = carveWaterDepth(grid, config, waterAreas, groundWidthM, groundHeightM);
  context.warnings.push(...carved.warnings);
  return { waterAreas, carved };
}

function buildLadder(context: GenerationContext, carved: CarvedWater, waterAreas: WaterAreaV1[]): ElevationLadder {
  const { config, source, flatEngraving, warnings } = context;
  // Size the stack from land alone. A coastal map's grid minimum is the abyssal
  // plain, and dividing the whole of that across the sheet budget is what used
  // to squeeze the land into a layer or two.
  const { landMin, landMax, min: visibleMin, max: visibleMax } = cropElevationRange(config, carved.grid, carved.waterMask);
  const landRelief = landMax - landMin;
  const depthBelowLandM = Math.max(0, landMin - (Number.isFinite(visibleMin) ? visibleMin : carved.grid.min));
  if (landRelief < 20) warnings.push({ code: "LOW_RELIEF", message: flatEngraving ? "This area has very little elevation change; contour lines may be sparse." : "This area has very little elevation change; the layers may look nearly identical." });

  const hasOcean = !flatEngraving && waterAreas.some((area) => area.kind === "ocean");
  const stack = planTerrainStack(config, landRelief, source.bounds, depthBelowLandM);

  // The ladder runs at one uniform step, extended below the land minimum by the
  // depth sheets the budget allowed. When there is an ocean it is shifted so sea
  // level falls exactly on a step, which is what makes a coastline cut as a
  // clean sheet edge instead of a ragged one.
  let ladderBase = flatEngraving ? landMin : landMin - stack.depthLayerCount * stack.metersPerLayer;
  if (hasOcean && stack.metersPerLayer > 0) {
    ladderBase = SEA_LEVEL_M - Math.ceil((SEA_LEVEL_M - ladderBase) / stack.metersPerLayer) * stack.metersPerLayer;
  }
  // Snapping to sea level slides the whole ladder down by up to a full step, so
  // the sheet count is taken from the span the ladder actually has to cover.
  // Keeping the planned count instead would drop the summit off the top. The
  // step itself is unchanged, so the planned exaggeration still describes the cut.
  // A flat engraving of flat ground has no contours to draw: every threshold
  // would coincide and repeat the crop outline, so only the base remains.
  const ladderLayerCount = flatEngraving
    ? landRelief > 0 ? config.engravingContourCount + 1 : 1
    : stack.metersPerLayer > 0
      ? Math.max(MIN_LAYER_COUNT, Math.ceil((landMax - ladderBase) / stack.metersPerLayer - 1e-9) + (landRelief === 0 ? 1 : 0))
      : stack.layerCount;
  const contourStepM = flatEngraving ? landRelief / (config.engravingContourCount + 1) : stack.metersPerLayer;
  const thresholds = Array.from({ length: ladderLayerCount }, (_, index) => ladderBase + contourStepM * index);

  // Water deeper than the ladder reaches is flattened at its floor rather than
  // silently punching through the base sheet.
  const water = config.fitLakeDepth && !flatEngraving ? fitLakesToLadder(carved, config, ladderBase) : carved;
  const { grid: modelGrid, clamped } = clampCarveToLadder(water.grid, ladderBase);
  if (clamped && !flatEngraving) warnings.push({
    code: "WATER_DEPTH_CLAMPED",
    ...(!config.fitLakeDepth && carved.surfaces.some((surface) => surface.kind === "lake" && surface.bedElevationM < ladderBase && surface.surfaceElevationM > ladderBase) ? { action: "fit-lake-depth" as const } : {}),
    message: `Water here is deeper than the ${stack.depthLayerCount} sheet${stack.depthLayerCount === 1 ? "" : "s"} below the shoreline can hold, so its floor is flattened. Increase the depth-layer limit or turn it off for automatic coverage. Fit depth compresses lakes to the chosen allowance.`,
  });
  return { landMin, landMax, visibleMin, visibleMax, depthBelowLandM, stack, ladderBase, thresholds, water, modelGrid };
}

function contourLayers({ config, flatEngraving, clip, warnings }: GenerationContext, ladder: ElevationLadder): LayerIR[] {
  const { modelGrid, thresholds } = ladder;
  // Grid-edge interpolation keeps threshold locations accurate; the user-facing
  // smoothing option is applied separately to the resulting geometry below.
  const contourGenerator = contours().size([modelGrid.width, modelGrid.height]).smooth(true).thresholds(thresholds.slice(1));
  const maximumCornerTrimMm = Math.max(config.widthMm / (modelGrid.width - 1), config.heightMm / (modelGrid.height - 1));
  const generated = contourGenerator(Array.from(modelGrid.values));

  const layers: LayerIR[] = [{
    id: "layer-01",
    index: 0,
    elevationM: thresholds[0] ?? modelGrid.min,
    materialThicknessMm: config.materialThicknessMm,
    polygons: [{ outer: clip, holes: [] }],
    markings: [],
    pieces: [],
  }];

  generated.forEach((contour, generatedIndex) => {
    const raw: MultiPolygon = contour.coordinates.map((polygon) => polygon.map((ring) => {
      const mapped: Ring = ring.map((point) => {
        const point2d = contourToMm([point[0] ?? 0, point[1] ?? 0], modelGrid, config);
        return [point2d.x, point2d.y] as Pair;
      });
      const baseline = simplify(close(mapped.map(toPoint)), config.minimumFeatureMm * CONTOUR_SIMPLIFICATION_FACTOR)
        .map(({ x, y }) => [x, y] as Pair);
      return config.smoothing > 0 ? roundContourRing(baseline, maximumCornerTrimMm) : baseline;
    }));
    const polygons = clipContours(raw, clip, config.minimumFeatureMm, 0);
    const index = generatedIndex + 1;
    layers.push({
      id: `layer-${String(index + 1).padStart(2, "0")}`,
      index,
      elevationM: thresholds[index] ?? modelGrid.max,
      materialThicknessMm: config.materialThicknessMm,
      polygons,
      markings: [],
      pieces: [],
    });
  });

  // A circular clip can retain only an unprintably small edge of an outside
  // summit. Drop empty caps, but keep any interior gaps as export-blocking errors.
  let omittedCaps = 0;
  if (config.cropShape === "circle") {
    while (layers.length > 1 && layers.at(-1)!.polygons.length === 0) { layers.pop(); omittedCaps += 1; }
    if (omittedCaps) {
      thresholds.length = layers.length;
      const unit = flatEngraving ? "contour" : "sheet";
      warnings.push({ code: "SMALL_FEATURES", message: `${omittedCaps} upper ${unit}${omittedCaps === 1 ? " was" : "s were"} omitted because the circular crop retained no material meeting the minimum feature size.` });
    }
  }

  for (const layer of layers) {
    if (!layer.polygons.length) warnings.push({ code: "EMPTY_LAYER", message: `Layer ${layer.index + 1} has no printable terrain at its elevation.` });
  }
  return layers;
}

function clipToCrop(polygon: Polygon2D, clip: Point2D[], minimumFeatureMm: number): Polygon2D[] {
  return clipContours([[toRing(polygon.outer), ...polygon.holes.map(toRing)]] as MultiPolygon, clip, minimumFeatureMm);
}

/**
 * Water for paint stencils when nothing carves it. With depth off no surface
 * is modelled, but a lake still lies flat in the DEM, so its whole face
 * belongs to the layer holding its level. Empty when carved surfaces already
 * describe every area.
 */
function flatWaterAreas({ config, source, usesWaterDepth, clip }: GenerationContext, grid: ElevationGrid, ladder: ElevationLadder): FlatWaterArea[] {
  if (usesWaterDepth || !config.paintTemplates.includes("water")) return [];
  return (source.waterAreas ?? []).flatMap((area) => {
    const level = Number.isFinite(area.surfaceElevationM) ? area.surfaceElevationM! : waterSurfaceLevelM(area, grid, config);
    if (!Number.isFinite(level)) return [];
    const polygons = clipToCrop(area.polygon, clip, config.minimumFeatureMm);
    return polygons.length ? [{ layerIndex: layerForElevation(level, ladder.thresholds), polygons }] : [];
  });
}

function waterOutputs({ config, source, flatEngraving, clip, warnings }: GenerationContext, ladder: ElevationLadder): { waterSurfaces: WaterSurfaceIR[]; waterPatternAreas: Polygon2D[] } {
  // Surfaces are virtual - never cut, only drawn - so they are clipped to the
  // crop here and carried on the IR for the previews to float over the basin.
  const waterSurfaces: WaterSurfaceIR[] = ladder.water.surfaces.flatMap((surface) => {
    const polygons = surface.polygons.flatMap((polygon) => clipToCrop(polygon, clip, config.minimumFeatureMm));
    if (!polygons.length) return [];
    return [{ ...surface, polygons, layerIndex: layerForElevation(surface.surfaceElevationM, ladder.thresholds) }];
  });

  // Report provenance for lakes actually included in the output. A user-set
  // maximum or partial survey does not make the rest of a lake floor measured.
  // A traced chart is neither surveyed nor modeled; gaps in one are reported
  // per lake as BATHYMETRY_FALLBACK when it is carved.
  const lakes = waterSurfaces.filter((surface) => surface.kind === "lake");
  if (lakes.some((surface) => surface.depthSource !== "surveyed" && surface.bathymetryOrigin !== "chart")) warnings.push({
    code: "LAKE_DEPTH_PREDICTED",
    message: "Some lake depths are estimated rather than surveyed. Modeled lake floors may differ from the actual underwater terrain.",
  });
  if (lakes.some((surface) => surface.bathymetryOrigin === "chart")) warnings.push({
    code: "LAKE_DEPTH_FROM_CHART",
    message: "Some lake floors come from a traced depth chart. They are only as accurate as the chart and its tracing.",
  });

  const waterPatternAreas = flatEngraving && config.showWater && config.waterFillPattern !== "none"
    ? (source.waterPatternAreas ?? source.waterAreas?.map((area) => area.polygon) ?? waterPatternAreasFromShorelines(source.markings))
        .flatMap((polygon) => clipToCrop(polygon, clip, config.minimumFeatureMm))
    : [];
  return { waterSurfaces, waterPatternAreas };
}

function transportationClassOf(feature: MarkingFeature): TransportationClass | undefined {
  return feature.transportationClass ?? (feature.kind === "trail" ? "trail" : feature.kind === "road" ? "local-road" : undefined);
}

function markingEnabled(feature: MarkingFeature, config: ProjectConfigV1): boolean {
  const transportationClass = transportationClassOf(feature);
  return feature.id.startsWith("custom-data-line-") ||
    (transportationClass === "trail" && config.showTrails) ||
    (transportationClass !== undefined && transportationClass !== "trail" && config.showRoads) ||
    (feature.kind === "water" && config.showWater) ||
    (feature.kind === "boundary" && config.showBoundaries) ||
    (feature.kind === "grid" && config.showCoordinateGrid) ||
    feature.kind === "contour" || feature.kind === "label" || feature.kind === "guide";
}

/** Source, custom, and graticule features with their ids made unique among repeated source ids. */
function mapFeatures({ config, source }: GenerationContext, modelGrid: ElevationGrid): Array<{ feature: MarkingFeature; featureId: string }> {
  const customLineMarkings: MarkingFeature[] = config.customLines.map((line, index) => ({
    id: `custom-data-line-${index}`,
    kind: line.kind,
    operation: "engrave",
    points: line.points.map((point) => geoPointToMapPoint(point.lat, point.lon, source.bounds, config.widthMm, config.heightMm)),
    ...(line.kind === "trail" ? { transportationClass: "trail" as const } : {}),
  }));
  const mapMarkings = [
    ...source.markings,
    ...customLineMarkings,
    ...(config.showCoordinateGrid ? coordinateGridMarkings(config, source.bounds, modelGrid) : []),
  ];
  const sourceIdCounts = new Map<string, number>();
  mapMarkings.forEach((feature) => sourceIdCounts.set(feature.id, (sourceIdCounts.get(feature.id) ?? 0) + 1));
  const sourceIdOccurrences = new Map<string, number>();
  return mapMarkings.map((feature) => {
    const sourceOccurrence = sourceIdOccurrences.get(feature.id) ?? 0;
    sourceIdOccurrences.set(feature.id, sourceOccurrence + 1);
    return { feature, featureId: (sourceIdCounts.get(feature.id) ?? 0) > 1 ? `${feature.id}-source-${sourceOccurrence}` : feature.id };
  });
}

function addTransportationLabelCandidate(labels: TransportationLabelCandidates, label: string, candidate: TransportationLabelCandidate): void {
  const candidates = labels.get(label);
  if (candidates) candidates.push(candidate);
  else labels.set(label, [candidate]);
}

/** A flat engraving has one physical face, so every feature is clipped to the crop once. */
function routeFlatMarking(config: ProjectConfigV1, feature: MarkingFeature, featureId: string, base: LayerClip, labels: TransportationLabelCandidates): void {
  const { layer: baseLayer, material: baseMaterial } = base;
  const transportationClass = transportationClassOf(feature);
  if (transportationClass) {
    const clipped = clipPolyline(feature.points, baseMaterial);
    styledTransportationPaths(transportationOutlines(feature.points, transportationClass, config), clipped, baseMaterial).forEach((points, styleIndex) => baseLayer.markings.push({
      id: `${featureId}-flat-transport-${styleIndex}`,
      operation: "engrave",
      kind: transportationClass === "trail" ? "trail" : "road",
      transportationClass,
      points,
    }));
    const label = feature.label && config.showTransportationLabels ? fabricationLabel(feature.label, config.textStyle.font) : undefined;
    if (label && clipped.length) addTransportationLabelCandidate(labels, label, { layer: baseLayer, paths: clipped, transportationClass, excludedPolygons: [] });
    return;
  }
  if (feature.label && feature.points[0] && pointInPreparedPolygons(feature.points[0], baseMaterial)) {
    baseLayer.markings.push({ id: `${featureId}-flat-label`, operation: feature.operation, kind: feature.kind, points: [feature.points[0]], label: feature.label, textStyle: config.textStyle });
  }
  clipPolyline(feature.points, baseMaterial)
    .filter((points) => feature.kind !== "water" || polylineLength(points) >= config.minimumFeatureMm)
    .forEach((points, clipIndex) => baseLayer.markings.push({ id: `${featureId}-flat-${clipIndex}`, operation: feature.operation, kind: feature.kind, points }));
}

function routeStackMarking(config: ProjectConfigV1, feature: MarkingFeature, featureId: string, clips: LayerClip[], ladder: ElevationLadder, labels: TransportationLabelCandidates): void {
  const layers = clips.map(({ layer }) => layer);
  const transportationClass = transportationClassOf(feature);
  if (transportationClass) {
    const outlines = transportationOutlines(feature.points, transportationClass, config);
    const label = feature.label && config.showTransportationLabels ? fabricationLabel(feature.label, config.textStyle.font) : undefined;
    clips.forEach(({ layer, material, covering }) => {
      const clipped = clipPolyline(feature.points, material, covering);
      styledTransportationPaths(outlines, clipped, material, covering).forEach((points, styleIndex) => layer.markings.push({
        id: `${featureId}-${layer.index}-transport-${styleIndex}`,
        operation: "engrave",
        kind: transportationClass === "trail" ? "trail" : "road",
        transportationClass,
        points,
      }));
      if (label && clipped.length) addTransportationLabelCandidate(labels, label, { layer, paths: clipped, transportationClass, excludedPolygons: covering.polygons });
    });
    return;
  }
  // Terrain boundaries, grids, and open waterways follow every exposed layer.
  // Assigning them from elevations sampled only at their source vertices can
  // skip every intermediate layer when a coarse segment crosses a contour,
  // leaving the score line visibly short of the step edge. Clipping the full
  // path against each exposed layer footprint makes adjacent pieces meet at
  // the exact contour intersection, independent of source vertex spacing.
  if ((feature.kind === "boundary" || feature.kind === "grid" || (feature.kind === "water" && !isClosedWater(feature))) && feature.elevationM === undefined) {
    clips.forEach(({ layer, material, covering }) => {
      clipPolyline(feature.points, material, covering).forEach((points, clipIndex) => layer.markings.push({
        id: `${featureId}-${layer.index}-terrain-${clipIndex}`,
        operation: feature.operation,
        kind: feature.kind,
        points,
      }));
    });
    // Keep the existing elevation-based label behavior while the line itself
    // follows the exact layer contours. Explicit-elevation water features use
    // the legacy path below because they intentionally belong to one plane.
    if (feature.label) {
      for (const [segmentIndex, segment] of splitMarking(feature, ladder.thresholds, ladder.modelGrid, config).entries()) {
        const layer = layers[segment.layer];
        if (layer && segment.points[0] && pointInPreparedPolygons(segment.points[0], clips[segment.layer]!.material)) {
          layer.markings.push({ id: `${featureId}-${layer.index}-${segmentIndex}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label, textStyle: config.textStyle });
        }
      }
    }
    return;
  }
  for (const [segmentIndex, segment] of splitMarking(feature, ladder.thresholds, ladder.modelGrid, config).entries()) {
    const layer = layers[segment.layer];
    if (!layer) continue;
    const material = clips[segment.layer]!.material;
    const clipped = clipPolyline(segment.points, material);
    if (feature.label && segment.points[0] && pointInPreparedPolygons(segment.points[0], material)) {
      layer.markings.push({ id: `${featureId}-${layer.index}-${segmentIndex}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label, textStyle: config.textStyle });
    }
    clipped.filter((points) => feature.kind !== "water" || polylineLength(points) >= config.minimumFeatureMm).forEach((points, clipIndex) => layer.markings.push({
      id: `${featureId}-${layer.index}-${segmentIndex}-${clipIndex}`,
      operation: feature.operation,
      kind: feature.kind,
      points,
    }));
  }
}

/** Route every enabled map feature onto the layers it is visible on; returns transportation label candidates. */
function routeMarkings(context: GenerationContext, clips: LayerClip[], ladder: ElevationLadder): TransportationLabelCandidates {
  const { config, source, flatEngraving } = context;
  const labels: TransportationLabelCandidates = new Map();
  for (const { feature, featureId } of mapFeatures(context, ladder.modelGrid)) {
    if (!markingEnabled(feature, config)) continue;
    // Routing every feature through every elevation band of a flat engraving
    // only explodes one road into dozens of DOM/SVG paths before reassembling it.
    if (flatEngraving) routeFlatMarking(config, feature, featureId, clips[0]!, labels);
    else routeStackMarking(config, feature, featureId, clips, ladder, labels);
  }

  const enabledRoadFeatures = source.markings.filter((feature) => feature.kind === "road" && config.showRoads);
  const roadJunctions = config.lineStyle.roadStyle === "outlined" ? transportationJunctions(enabledRoadFeatures) : [];
  roadJunctions.forEach((junction, junctionIndex) => {
    const ring = junctionRing(junction.point, config.lineStyle.majorRoadSpacingMm / 2);
    (flatEngraving ? clips.slice(0, 1) : clips).forEach(({ layer, material, covering }) => {
      clipPolyline(ring, material, flatEngraving ? undefined : covering).forEach((points, clipIndex) => layer.markings.push({
        id: `road-junction-${junctionIndex}-${layer.index}-${clipIndex}`,
        operation: "engrave",
        kind: "road",
        transportationClass: "major-road",
        points,
      }));
    });
  });
  return labels;
}

interface AnnotationPlacer {
  /** Whether every marking fits inside the crop; pushes a LABEL_OMITTED warning naming `name` when not. */
  fits(markings: OperationPath[], name: string): boolean;
  /** Adds markings to the base layer, or routes them onto the exposed surface of the stack. */
  push(markings: OperationPath[], followSurface: boolean): void;
}

function annotationPlacer({ config, clip, warnings, flatEngraving }: GenerationContext, clips: LayerClip[]): AnnotationPlacer {
  const baseLayer = clips[0]!.layer;
  return {
    // All crop boundaries are convex, so endpoint/label-box checks suffice.
    fits(markings, name) {
      const fits = markings.every((marking) => {
        const points = [...marking.points];
        if (marking.label && marking.points[0]) {
          const { x, y } = marking.points[0];
          const { width, height } = labelDimensions(marking.label, marking.textStyle);
          points.push({ x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height });
        }
        const inset = config.lineStyle.annotationMm / 2;
        return points.every(({ x, y }) => [[-inset, -inset], [inset, -inset], [inset, inset], [-inset, inset]].every(([dx, dy]) => pointInRing({ x: x + dx!, y: y + dy! }, clip)));
      });
      if (!fits) warnings.push({ code: "LABEL_OMITTED", message: `${name} was omitted because it does not fit the material. Increase the output size or reduce the annotation size.` });
      return fits;
    },
    push(markings, followSurface) {
      if (!followSurface || flatEngraving) {
        baseLayer.markings.push(...markings);
        return;
      }
      // Route the complete design onto final material, excluding every sheet above.
      // Letters use the same strokes as preview/SVG text so they remain complete
      // even when a contour passes through a glyph.
      for (const marking of markings) {
        const text = marking.label && marking.points[0]
          ? labelGeometry(marking.label, marking.points[0], 0, 0, marking.labelRotationRad, marking.textStyle)
          : undefined;
        const paths = text ? text.strokes : [marking.points];
        // Typeface letters are areas: each piece belongs to the sheet it is exposed on.
        text?.fills.forEach((fill, fillIndex) => markerLayerPolygons(fill.outer, clips.map(({ material }) => material), fill.holes).forEach(({ layerIndex, polygon }, pieceIndex) => clips[layerIndex]!.layer.markings.push({
          id: `${marking.id}-${layerIndex}-fill-${fillIndex}-${pieceIndex}`,
          operation: marking.operation,
          kind: marking.kind,
          points: polygon.outer,
          ...(polygon.holes.length ? { holes: polygon.holes } : {}),
          filled: true,
        })));
        for (const { layer, material, covering } of clips) {
          paths.forEach((path, pathIndex) => {
            clipPolyline(path, material, covering).forEach((points, clipIndex) => layer.markings.push({
              id: `${marking.id}-${layer.index}-${pathIndex}-${clipIndex}`,
              operation: marking.operation,
              kind: marking.kind,
              points,
            }));
          });
        }
      }
    },
  };
}

/** Annotations must fit the crop whole; the compass follows the exposed stack surface. */
function placeAnnotations(context: GenerationContext, clips: LayerClip[]): void {
  const { config, source } = context;
  const placer = annotationPlacer(context, clips);
  const addAnnotation = (markings: OperationPath[], name: string, followSurface = false): void => {
    if (placer.fits(markings, name)) placer.push(markings, followSurface);
  };

  if (config.showNorthArrow) {
    addAnnotation(northArrowMarkings(config), "North arrow", true);
  }
  if (config.showScaleBar) {
    // Like the compass, the bar follows the exposed surface: on the bottom
    // sheet alone, the sheets above covered most of it.
    addAnnotation(scaleBarMarkings(config, groundWidthMFor(source.bounds)), "Scale bar", true);
  }
}

function placeTransportationLabels(config: ProjectConfigV1, labels: TransportationLabelCandidates): number {
  let transportationLabelIndex = 0;
  const labelEntries = [...labels].map(([label, candidates]) => {
    const lengths = candidates.map((candidate) => ({ candidate, length: longestPath(candidate.paths) }));
    return { label, lengths, longest: lengths.reduce((best, { length }) => Math.max(best, length), Number.NEGATIVE_INFINITY) };
  }).sort((left, right) => right.longest - left.longest || left.label.localeCompare(right.label)).slice(0, TRANSPORTATION_LABEL_LIMIT);
  for (const { label, lengths } of labelEntries) {
    const ordered = lengths.sort((left, right) => right.length - left.length).map(({ candidate }) => candidate);
    for (const candidate of ordered) {
      const placement = placeLinearLabel(label, config, candidate.layer, candidate.paths, candidate.excludedPolygons);
      if (!placement) continue;
      candidate.layer.markings.push({
        id: `transport-label-${transportationLabelIndex++}`,
        operation: "engrave",
        kind: "label",
        transportationClass: candidate.transportationClass,
        points: [placement.point],
        label,
        labelRotationRad: placement.rotationRad,
        textStyle: config.textStyle,
      });
      break;
    }
  }
  return transportationLabelIndex;
}

function placeElevationLabels({ config, flatEngraving, warnings }: GenerationContext, layers: LayerIR[], parallelPlacements?: Array<CoordinatedElevationLabel | undefined>): void {
  const omittedLayers: string[] = [];
  const labelsByLayer = layers.map((layer) => {
    const elevation = Math.round(displayElevation(layer.elevationM, config.units));
    const unit = elevationUnit(config.units);
    return [`${elevation} ${unit}`, `${elevation}${unit}`, `${elevation}`];
  });
  // A flat map labels only its emphasized index contours. Labelling every
  // minor line overwhelms the engraving and implies a label on the base
  // crop boundary, which is not itself a contour.
  const flatLabeled = (layer: LayerIR) => layer.index !== 0 && layer.index % config.engravingIndexInterval === 0;
  const placements = parallelPlacements ?? placeElevationLabelStack(labelsByLayer, config, layers, flatEngraving ? { markings: layers[0]!.markings, labeled: flatLabeled } : undefined);
  layers.forEach((layer, layerIndex) => {
    if (flatEngraving && !flatLabeled(layer)) return;
    const placed = placements[layerIndex];
    if (!placed) {
      omittedLayers.push(String(layer.index + 1));
      return;
    }
    layer.markings.push({
      id: `elevation-${layer.index}`,
      operation: "engrave",
      kind: "label",
      points: [placed.placement.point],
      label: placed.label,
      labelRotationRad: placed.placement.rotationRad,
      textStyle: config.textStyle,
    });
  });
  if (omittedLayers.length) warnings.push({
    code: "LABEL_OMITTED",
    message: `Elevation labels were omitted from layer${omittedLayers.length === 1 ? "" : "s"} ${omittedLayers.join(", ")} because no collision-free position fit the exposed face.`,
  });
}

/**
 * The title is placed after every map detail so its material-colored backing
 * clears contours, roads and labels beneath the letters; only markers, which
 * the user positioned deliberately, are drawn over it.
 */
function placePlaque(context: GenerationContext, clips: LayerClip[]): void {
  const { config, flatEngraving } = context;
  const markings = plaqueMarkings(config);
  const footprint = plaqueFootprint(config);
  const placer = annotationPlacer(context, clips);
  if (!markings.length || !footprint || !placer.fits(markings, "Title")) return;
  const materials = (flatEngraving ? clips.slice(0, 1) : clips).map(clip => clip.material);
  markerLayerPolygons(footprint, materials).forEach(({ layerIndex, polygon }, pieceIndex) => clips[layerIndex]!.layer.markings.push({
    id: `plaque-backing-${layerIndex}-${pieceIndex}`,
    operation: "engrave",
    kind: "label",
    points: polygon.outer,
    ...(polygon.holes.length ? { holes: polygon.holes } : {}),
    filled: true,
    knockout: true,
  }));
  placer.push(markings, true);
}

/**
 * Markers are added after every other annotation so their material-colored
 * knockout footprints can visibly interrupt contours, labels, and map
 * details before the solid symbol is drawn on top.
 */
function placeMarkers({ config, source, flatEngraving }: GenerationContext, clips: LayerClip[]): void {
  const materials = (flatEngraving ? clips.slice(0, 1) : clips).map(clip => clip.material);
  config.markers.forEach((marker, markerIndex) => {
    if (!longitudeInBounds(marker.lon, source.bounds) || marker.lat < source.bounds.south || marker.lat > source.bounds.north) return;
    const anchor = geoPointToMapPoint(marker.lat, marker.lon, source.bounds, config.widthMm, config.heightMm);
    if (!materials.some(material => pointInPreparedPolygons(anchor, material))) return;
    const size = marker.sizeMm ?? MAP_MARKER_SIZE_MM;
    const symbolCenter = markerCenterForAnchor(marker, config.markerIcons, anchor, size);
    // Holes (a pin's eye, a letter's counter) are engraved as gaps in the fill.
    const polygons = markerPolygons(marker, config.markerIcons, symbolCenter, size);
    const place = (path: Point2D[], id: string, holes: Point2D[][], knockout = false) => {
      markerLayerPolygons(path, materials, holes).forEach(({ layerIndex, polygon }, pieceIndex) => clips[layerIndex]!.layer.markings.push({
        id: `map-marker-${markerIndex}-${id}-${layerIndex}-${pieceIndex}`,
        operation: "engrave",
        kind: "marker",
        points: polygon.outer,
        ...(polygon.holes.length ? { holes: polygon.holes } : {}),
        filled: true,
        ...(knockout ? { knockout: true } : {}),
      }));
    };
    polygons.forEach(({ outer }, pathIndex) => {
      offsetClosedRing(outer, MAP_MARKER_CLEARANCE_MM, "round").forEach((halo, haloIndex) => place(halo, `halo-${pathIndex}-${haloIndex}`, [], true));
    });
    polygons.forEach(({ outer, holes }, pathIndex) => place(outer, String(pathIndex), holes));
  });
}

/** Whether every point of a graphic keeps the annotation line inside the crop; warns naming it when not. */
function graphicFits({ config, clip, warnings }: GenerationContext, polygons: Polygon2D[], placedIndex: number): boolean {
  const inset = config.lineStyle.annotationMm / 2;
  const fits = polygons.length > 0 && polygons.every(({ outer }) => outer.every(({ x, y }) => [[-inset, -inset], [inset, -inset], [inset, inset], [-inset, inset]].every(([dx, dy]) => pointInRing({ x: x + dx!, y: y + dy! }, clip))));
  if (!fits && polygons.length) warnings.push({ code: "LABEL_OMITTED", message: `Graphic ${placedIndex + 1} was omitted because it does not fit the material. Make it smaller or move it inward.` });
  return fits;
}

/**
 * Cut graphics remove their shape from whichever sheet is exposed under each
 * part of it, revealing the sheet below. This runs on the raw layers, before
 * work-area seams and material nests: both index into the final material, and
 * nesting already refuses a cavity under a covering sheet's hole, so a cut can
 * never reveal one.
 */
function cutPlacedGraphics(context: GenerationContext, layers: LayerIR[]): void {
  const { config, flatEngraving, warnings } = context;
  const cutLayers = flatEngraving ? layers.slice(0, 1) : layers;
  let loosePieces = false;
  (config.placedGraphics ?? []).forEach((placed, placedIndex) => {
    if (placed.operation !== "cut") return;
    const polygons = placedGraphicPolygons(config, placed);
    if (!graphicFits(context, polygons, placedIndex)) return;
    // Recomputed per graphic: an earlier cut may already have opened this area.
    const materials = cutLayers.map((layer) => preparePolygons(layer.polygons));
    const cutsByLayer = new Map<number, Polygon2D[]>();
    for (const { outer, holes } of polygons) {
      for (const { layerIndex, polygon } of markerLayerPolygons(outer, materials, holes)) {
        cutsByLayer.set(layerIndex, [...(cutsByLayer.get(layerIndex) ?? []), polygon]);
        // Islands left inside a cut through the bottom sheet have nothing to rest on.
        if (layerIndex === 0 && polygon.holes.length) loosePieces = true;
      }
    }
    for (const [layerIndex, cuts] of cutsByLayer) {
      const layer = cutLayers[layerIndex]!;
      const multi = (polygons: Polygon2D[]): MultiPolygon => polygons.map(({ outer, holes }) => [toRing(outer), ...holes.map(toRing)]);
      layer.polygons = normalizeMultiPolygon(
        polygonClipping.difference(multi(layer.polygons), multi(cuts)) as MultiPolygon,
        (ring) => (removeTinyRing(ring, config.minimumFeatureMm) ? undefined : ring),
      );
    }
  });
  if (loosePieces) warnings.push({
    code: "GRAPHIC_LOOSE_PIECES",
    message: "A cut graphic goes through the bottom sheet, so the islands inside its shape fall out. Engrave or score it instead, or keep them to glue back by hand.",
  });
}

/**
 * Engraved and scored graphics follow the exposed surface like markers. They
 * are placed after the title and before markers, so a marker still reads on
 * top of a graphic.
 */
function placeGraphics(context: GenerationContext, clips: LayerClip[]): void {
  const { config, flatEngraving } = context;
  const surface = flatEngraving ? clips.slice(0, 1) : clips;
  const materials = surface.map((clip) => clip.material);
  (config.placedGraphics ?? []).forEach((placed, placedIndex) => {
    if (placed.operation === "cut") return;
    const polygons = placedGraphicPolygons(config, placed);
    if (!graphicFits(context, polygons, placedIndex)) return;
    const prefix = placedGraphicMarkingPrefix(placed.id);
    if (placed.operation === "score") {
      polygons.forEach(({ outer, holes }, index) => [outer, ...holes].forEach((ring, ringIndex) => {
        for (const { layer, material, covering } of surface) {
          clipPolyline(ring, material, flatEngraving ? undefined : covering).forEach((points, clipIndex) => layer.markings.push({
            id: `${prefix}score-${index}-${ringIndex}-${layer.index}-${clipIndex}`,
            operation: "score",
            kind: "marker",
            points,
          }));
        }
      }));
      return;
    }
    const place = (path: Point2D[], id: string, holes: Point2D[][], knockout = false) => {
      markerLayerPolygons(path, materials, holes).forEach(({ layerIndex, polygon }, pieceIndex) => clips[layerIndex]!.layer.markings.push({
        id: `${prefix}${id}-${layerIndex}-${pieceIndex}`,
        operation: "engrave",
        kind: "marker",
        points: polygon.outer,
        ...(polygon.holes.length ? { holes: polygon.holes } : {}),
        filled: true,
        ...(knockout ? { knockout: true } : {}),
      }));
    };
    polygons.forEach(({ outer }, index) => {
      offsetClosedRing(outer, GRAPHIC_CLEARANCE_MM, "round").forEach((halo, haloIndex) => place(halo, `halo-${index}-${haloIndex}`, [], true));
    });
    polygons.forEach(({ outer, holes }, index) => place(outer, String(index), holes));
  });
}

/**
 * External vector archives are allowed to repeat source IDs. Preserve stable
 * human-readable prefixes while guaranteeing valid keyed previews and unique
 * SVG element IDs even when an upstream tile contains a duplicate feature.
 */
function dedupeMarkingIds(layers: LayerIR[]): void {
  const markingIds = new Set<string>();
  const duplicateCounts = new Map<string, number>();
  layers.forEach((layer) => layer.markings.forEach((marking) => {
    const original = marking.id;
    let occurrence = duplicateCounts.get(original) ?? 0;
    let candidate = occurrence === 0 ? original : `${original}-duplicate-${occurrence}`;
    while (markingIds.has(candidate)) {
      occurrence += 1;
      candidate = `${original}-duplicate-${occurrence}`;
    }
    duplicateCounts.set(original, occurrence + 1);
    marking.id = candidate;
    markingIds.add(candidate);
  }));
}

export type GenerationStage = "prepare" | "water" | "ladder" | "contours" | "terrain-cache" | "split" | "nesting" | "fabrication" | "routing" | "alignment" | "assembly-labels" | "elevation-labels" | "annotations";
export interface GenerationOptions {
  /** Diagnostic timings only; never included in the geometry or its fingerprint. */
  onStage?: (stage: GenerationStage, durationMs: number) => void;
}

interface TerrainCache {
  input: SourceBundleV1;
  key: string;
  source: SourceBundleV1;
  grid: ElevationGrid;
  ladder: ElevationLadder;
  layers: LayerIR[];
  warnings: GeometryWarning[];
}
interface GenerationSession { terrain?: TerrainCache }

// Everything affects terrain unless explicitly known to be downstream of it.
// New config fields therefore invalidate safely until their dependency is reviewed.
const TERRAIN_INDEPENDENT_FIELDS = [
  "id", "name", "units", "lineStyle", "showRoads", "showTrails", "showTransportationLabels",
  "showWater", "waterFillPattern", "showBoundaries", "showCoordinateGrid", "showAlignmentGuides",
  "optimizeMaterialUse", "glueMarginMm", "laserKerfMm", "workAreaWidthMm", "workAreaHeightMm",
  "seamOffsetMm", "seamTabs", "showAssemblyLabels", "paintTemplates", "showElevationLabels",
  "elevationLabelPosition", "textStyle", "showNorthArrow", "northArrowStyle", "northArrowSizeMm",
  "northArrowPlacement", "showScaleBar", "markers", "customLines", "explodedPreview",
  // Placed, engraved or arranged after the cached layers: graphics cut clones of them.
  "sheetNesting", "plaque", "scaleBarPlacement", "markerIcons", "customGraphics", "placedGraphics",
] satisfies Array<keyof ProjectConfigV1>;

function terrainKey(config: ProjectConfigV1): string {
  const terrain: Partial<ProjectConfigV1> = { ...config };
  for (const field of TERRAIN_INDEPENDENT_FIELDS) delete terrain[field];
  return JSON.stringify(terrain);
}

/**
 * One bounded terrain cache per worker/client. Sources must be immutable snapshots:
 * replace the source object when samples or metadata change. Returned contour geometry is
 * independently owned; fabrication and consumers must never mutate cached terrain.
 */
export function createGeometryGenerator(): typeof generateGeometry {
  const session: GenerationSession = {};
  return (config, source, options) => generate(config, source, options, session);
}

export function generateGeometry(config: ProjectConfigV1, source: SourceBundleV1, options?: GenerationOptions): GeometryIRV1 {
  return generate(config, source, options);
}

function generate(config: ProjectConfigV1, source: SourceBundleV1, options?: GenerationOptions, session?: GenerationSession): GeometryIRV1 {
  const steps = generationSteps(config, source, options, session);
  let step = steps.next();
  while (!step.done) {
    const batch = step.value;
    step = steps.next(batch.tasks.map(task => executeGeometryTask(batch.config, task)));
  }
  return step.value;
}

export interface ParallelGenerationOptions extends GenerationOptions {
  execute: (batch: GeometryBatch) => Promise<GeometryTaskResult[]>;
  /** Called at stage boundaries, including after async jobs finish. */
  checkCancelled?: () => void;
}

/** One async session per coordinator. Callers serialize requests; jobs never mutate shared layers. */
export function createParallelGeometryGenerator() {
  const session: GenerationSession = {};
  let busy = false;
  return async (config: ProjectConfigV1, source: SourceBundleV1, options: ParallelGenerationOptions): Promise<GeometryIRV1> => {
    if (busy) throw new Error("A geometry session cannot run overlapping requests.");
    busy = true;
    const steps = generationSteps(config, source, options, session, true);
    try {
      options.checkCancelled?.();
      let step = steps.next();
      while (!step.done) {
        const result = await options.execute(step.value);
        options.checkCancelled?.();
        step = steps.next(result);
      }
      options.checkCancelled?.();
      return step.value;
    } finally {
      steps.return(undefined as never);
      busy = false;
    }
  };
}

function* generationSteps(config: ProjectConfigV1, source: SourceBundleV1, options?: GenerationOptions, session?: GenerationSession, parallel = false): Generator<GeometryBatch, GeometryIRV1, GeometryTaskResult[]> {
  let started = options?.onStage ? performance.now() : 0;
  const stage = (name: GenerationStage) => {
    if (!options?.onStage) return;
    const ended = performance.now();
    options.onStage(name, ended - started);
    started = performance.now();
  };
  validateProject(config);
  if (source.schemaVersion !== 1) throw new Error("Unsupported source-data schema version.");
  assertGeographicBounds(source.bounds, "Source");
  const input = source;
  const key = session ? terrainKey(config) : "";
  const cached = session?.terrain?.input === input && session.terrain.key === key ? session.terrain : undefined;
  // Drop the previous map before allocating another large grid and contour stack.
  if (session && !cached) session.terrain = undefined;
  source = cached?.source ?? smoothLakeShorelines(source, config);
  const grid = cached?.grid ?? measuredElevationGrid(source.elevation);
  const flatEngraving = config.outputMode === "engraving";
  const context: GenerationContext = {
    config,
    source,
    flatEngraving,
    usesWaterDepth: !flatEngraving && config.showWaterDepth,
    clip: boundary(config),
    warnings: [],
  };
  addSourceWarnings(context);
  stage("prepare");
  let ladder: ElevationLadder;
  let layers: LayerIR[];
  if (cached) {
    ladder = cached.ladder;
    layers = structuredClone(cached.layers);
    context.warnings.push(...cached.warnings.map((warning) => ({ ...warning })));
    stage("terrain-cache");
  } else {
    const warningStart = context.warnings.length;
    const { waterAreas, carved } = carveWater(context, grid);
    stage("water");
    ladder = buildLadder(context, carved, waterAreas);
    stage("ladder");
    layers = contourLayers(context, ladder);
    if (session) session.terrain = {
      input, key, source, grid, ladder,
      layers: structuredClone(layers),
      warnings: context.warnings.slice(warningStart).map((warning) => ({ ...warning })),
    };
    stage("contours");
  }
  cutPlacedGraphics(context, layers);
  const { waterSurfaces, waterPatternAreas } = waterOutputs(context, ladder);

  // Before nesting: cavities record indices into a donor's polygons and holes
  // that splitting would renumber, and a seam through a cavity would leave an
  // open arc where a closed hole belongs.
  const unsplitOutlines = layers.map((layer) => layer.polygons);
  const splitPlan = splitLayersForWorkArea(config, layers, context.warnings);
  stage("split");
  const fabricationNests = flatEngraving ? [] : addMaterialNests(config, layers);
  stage("nesting");
  // Nesting has finished carving cavities, so layer material is final for routing.
  // Boolean unions pay off when many paths repeatedly query a tall stack.
  // Sparse maps and flat engravings keep the cheap original covering sets.
  const featureCount = source.markings.filter((feature) => markingEnabled(feature, config)).length + config.customLines.length;
  const clips = layerClips(layers, !flatEngraving && featureCount * layers.length >= 1_000);
  const paintWindows = flatEngraving ? [] : paintRegions(config, clips, { waterSurfaces, flatWater: flatWaterAreas(context, grid, ladder), cellPitchMm: config.widthMm / Math.max(1, grid.width - 1) }, fabricationNests, context.warnings);
  stage("fabrication");
  const transportationLabels = routeMarkings(context, clips, ladder);
  stage("routing");
  placeAnnotations(context, clips);
  // Small maps keep the original path and never start extra workers.
  const usePool = parallel && !flatEngraving && layers.length >= 32;
  if (!flatEngraving && config.showAlignmentGuides) {
    if (usePool) {
      const results = yield { config, tasks: layers.slice(0, -1).map((layer, index) => ({
        kind: "alignment" as const, layer,
        nextLayer: { index: layers[index + 1]!.index, polygons: layers[index + 1]!.polygons, pieces: layers[index + 1]!.pieces },
        outlines: unsplitOutlines[index + 1]!,
      })) };
      if (results.length !== layers.length - 1) throw new Error("Incomplete alignment batch.");
      results.forEach((result, index) => {
        if (result.kind !== "alignment") throw new Error("Invalid alignment result.");
        layers[index]!.markings.push(...result.markings);
      });
    } else addAlignmentGuides(config, clips, unsplitOutlines);
  }
  stage("alignment");
  addPieceLabels(context, clips);
  stage("assembly-labels");
  const placedTransportationLabels = placeTransportationLabels(config, transportationLabels);
  if (transportationLabels.size && !placedTransportationLabels) context.warnings.push({
    code: "LABEL_OMITTED",
    message: "Transportation labels do not fit the exposed material. Reduce Text size or Vertical exaggeration, or increase the artwork size.",
  });
  if (config.showElevationLabels) {
    if (usePool) {
      const results = yield { config, tasks: layers.map((layer, index) => {
        const elevation = Math.round(displayElevation(layer.elevationM, config.units));
        const unit = elevationUnit(config.units);
        return { kind: "elevation-labels" as const, layer,
          covering: layers[index + 1] && { polygons: layers[index + 1]!.polygons },
          labels: [`${elevation} ${unit}`, `${elevation}${unit}`, `${elevation}`],
        };
      }) };
      if (results.length !== layers.length) throw new Error("Incomplete elevation-label batch.");
      const candidates = results.map(result => {
        if (result.kind !== "elevation-labels") throw new Error("Invalid elevation-label result.");
        return result.options;
      });
      placeElevationLabels(context, layers, selectElevationLabels(candidates, config, layers));
    } else placeElevationLabels(context, layers);
  }
  stage("elevation-labels");
  placePlaque(context, clips);
  placeGraphics(context, clips);
  placeMarkers(context, clips);
  dedupeMarkingIds(layers);
  stage("annotations");

  const { landMin, landMax, visibleMin, visibleMax, ladderBase, modelGrid } = ladder;
  return {
    schemaVersion: 1,
    projectId: config.id,
    projectName: config.name,
    units: config.units,
    configFingerprint: projectFingerprint(config),
    sourceKind: source.sourceKind,
    vectorStatus: source.vectorStatus,
    lakeDataStatus: source.lakeDataStatus,
    datasetVersion: source.datasetVersion,
    bounds: source.bounds,
    resolutionM: source.resolutionM,
    imagerySources: source.imagerySources,
    terrainSelection: source.terrainSelection,
    widthMm: config.widthMm,
    heightMm: config.heightMm,
    laserKerfMm: config.laserKerfMm,
    lineStyle: { ...config.lineStyle },
    verticalExaggeration: ladder.stack.verticalExaggeration,
    horizontalScale: horizontalScaleFor(config.widthMm, source.bounds),
    minElevationM: config.cropShape === "circle" ? Math.max(visibleMin, ladderBase) : modelGrid.min,
    maxElevationM: config.cropShape === "circle" ? Math.max(visibleMax, ladderBase) : modelGrid.max,
    landReliefM: landMax - landMin,
    waterDepthBelowLandM: ladder.depthBelowLandM,
    layers,
    waterSurfaces,
    waterPatternAreas,
    fabricationNests,
    paintRegions: paintWindows,
    splitPlan,
    warnings: context.warnings,
    attribution: source.attribution,
    generatedAt: new Date().toISOString(),
  };
}
