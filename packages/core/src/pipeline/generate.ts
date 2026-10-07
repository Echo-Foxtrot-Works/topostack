import { executeGeometryTask, type GeometryBatch, type GeometryTask, type GeometryTaskResult } from "./generation-tasks.js";
import { addMaterialNests } from "./nesting.js";
import { groundWidthMFor, horizontalScaleFor } from "./stack-plan.js";
import { aviationFeatures, aviationRequested } from "./aviation.js";
import { assertGeographicBounds, validateProject } from "./validate.js";
import { projectFingerprint } from "./fingerprint.js";
import { smoothLakeShorelines } from "../water/lake-shoreline.js";
import { cropBoundary as boundary } from "../primitives/crop.js";
import { selectElevationLabels } from "../annotate/label-placement.js";
import { splitLayersForWorkArea } from "./split.js";
import { paintRegions } from "./paint-regions.js";
import { cutWaterInserts, takeInsertMarkings, withInsertSurfaces } from "./water-inserts.js";
import type { ElevationGrid, GeometryIRV1, GeometryWarning, LayerIR, Polygon2D, ProjectConfigV1, SourceBundleV1, WaterInsertIR } from "../types.js";
import type { ElevationLadder, GenerationContext } from "./generation-context.js";
import { layerClips } from "./layer-clips.js";
import { addSourceWarnings } from "./source-warnings.js";
import { buildLadder, carveWater, contourLayers, measuredElevationGrid } from "./terrain-stages.js";
import { flatWaterAreas, waterOutputs } from "./water-outputs.js";
import { insertedShorelines, markingEnabled, placeTransportationLabels, routeMarkings } from "./routing.js";
import { addAlignmentGuides, addPieceLabels } from "./assembly-marks.js";
import { cutPlacedGraphics, elevationLabelTexts, placeAnnotations, placeElevationLabels, placeGraphics, placeMarkers, placePlaque } from "./annotations.js";
import { placeAviationLabels } from "./aviation-labels.js";

/**
 * Routed features × layers at which merging each layer's covering set into one
 * boolean union pays for itself; below it the cheap per-layer sets are faster.
 */
const UNION_COVERING_MIN_WORK = 1_000;
/** Stacks with at least this many layers spread alignment and elevation-label work across helper workers. */
const PARALLEL_MIN_LAYERS = 32;

/**
 * External vector archives are allowed to repeat source IDs. Preserve stable
 * human-readable prefixes while guaranteeing valid keyed previews and unique
 * SVG element IDs even when an upstream tile contains a duplicate feature.
 */
function dedupeMarkingIds(layers: LayerIR[], inserts: WaterInsertIR[] = []): void {
  const markingIds = new Set<string>();
  const duplicateCounts = new Map<string, number>();
  [...layers, ...inserts].forEach((layer) => layer.markings.forEach((marking) => {
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

export type GenerationStage = "prepare" | "water" | "ladder" | "contours" | "terrain-cache" | "water-inserts" | "split" | "nesting" | "fabrication" | "routing" | "alignment" | "assembly-labels" | "elevation-labels" | "annotations";
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
  "id", "name", "units", "lineStyle", "showRoads", "showTrails", "showTransportationLabels", "aviation",
  "showWater", "waterFillPattern", "showBoundaries", "showCoordinateGrid", "showAlignmentGuides",
  "optimizeMaterialUse", "glueMarginMm", "laserKerfMm", "workAreaWidthMm", "workAreaHeightMm",
  "seamOffsetMm", "seamTabs", "showAssemblyLabels", "paintTemplates", "waterInserts", "waterInsertSheetNesting", "showElevationLabels",
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

/** Each sheet's alignment guides against the sheet above, as worker tasks. */
function alignmentTasks(layers: LayerIR[], unsplitOutlines: Polygon2D[][]): GeometryTask[] {
  return layers.slice(0, -1).map((layer, index) => ({
    kind: "alignment" as const, layer,
    nextLayer: { index: layers[index + 1]!.index, polygons: layers[index + 1]!.polygons, pieces: layers[index + 1]!.pieces },
    outlines: unsplitOutlines[index + 1]!,
  }));
}

/** Each sheet's elevation-label search under the sheet above, as worker tasks. */
function elevationLabelTasks(layers: LayerIR[], config: ProjectConfigV1): GeometryTask[] {
  return layers.map((layer, index) => ({
    kind: "elevation-labels" as const, layer,
    covering: layers[index + 1] && { polygons: layers[index + 1]!.polygons },
    labels: elevationLabelTexts(layer, config.units),
  }));
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
    aviation: aviationFeatures(source.aviationMarkings ?? [], config, config.widthMm / groundWidthMFor(source.bounds)),
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
  const cellPitchMm = config.widthMm / Math.max(1, grid.width - 1);
  // Openings and their ledges are terrain from here on: the split, nests and
  // alignment guides below all treat them like any other hole.
  const water = flatEngraving ? undefined : cutWaterInserts(config, layers, waterSurfaces, cellPitchMm, context.warnings);
  const waterInserts = water?.inserts ?? [];
  if (water) stage("water-inserts");

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
  const featureCount = source.markings.filter((feature) => markingEnabled(feature, config)).length + context.aviation.lines.length + config.customLines.length;
  const clips = layerClips(layers, !flatEngraving && featureCount * layers.length >= UNION_COVERING_MIN_WORK);
  const paintWindows = flatEngraving ? [] : paintRegions(config, clips, { waterSurfaces, flatWater: flatWaterAreas(context, grid, ladder), cellPitchMm }, fabricationNests, context.warnings);
  // Map detail treats acrylic as the surface it lies on; hidden marks keep the wood `clips`.
  // Sheets above the highest insert are unchanged, so their clips carry over.
  const surfaceClips = waterInserts.length
    ? layerClips(withInsertSurfaces(layers, waterInserts), !flatEngraving && featureCount * layers.length >= UNION_COVERING_MIN_WORK, { clips, below: Math.max(...waterInserts.map((insert) => insert.layerIndex)) })
    : clips;
  stage("fabrication");
  const transportationLabels = routeMarkings(context, surfaceClips, ladder, insertedShorelines(context, waterInserts));
  stage("routing");
  placeAnnotations(context, surfaceClips);
  // Small maps keep the original path and never start extra workers.
  const usePool = parallel && !flatEngraving && layers.length >= PARALLEL_MIN_LAYERS;
  if (!flatEngraving && config.showAlignmentGuides) {
    if (usePool) {
      const results = yield { config, tasks: alignmentTasks(layers, unsplitOutlines) };
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
  placeAviationLabels(context, surfaceClips);
  if (config.showElevationLabels) {
    if (usePool) {
      const results = yield { config, tasks: elevationLabelTasks(layers, config) };
      if (results.length !== layers.length) throw new Error("Incomplete elevation-label batch.");
      const candidates = results.map(result => {
        if (result.kind !== "elevation-labels") throw new Error("Invalid elevation-label result.");
        return result.options;
      });
      placeElevationLabels(context, layers, selectElevationLabels(candidates, config, layers));
    } else placeElevationLabels(context, layers);
  }
  stage("elevation-labels");
  placePlaque(context, surfaceClips);
  placeGraphics(context, surfaceClips);
  placeMarkers(context, surfaceClips);
  takeInsertMarkings(layers, waterInserts);
  dedupeMarkingIds(layers, waterInserts);
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
    ...(source.aviationStatus ? { aviationStatus: source.aviationStatus } : {}),
    ...(source.aviationCycle ? { aviationCycle: source.aviationCycle } : {}),
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
    ...(water ? { waterInserts, waterInsertMaterial: water.material } : {}),
    splitPlan,
    warnings: context.warnings,
    attribution: aviationRequested(config) && source.aviationStatus !== "not-covered" ? [...source.attribution, ...(source.aviationAttribution ?? [])] : source.attribution,
    generatedAt: new Date().toISOString(),
  };
}
