import { CONTOUR_SIMPLIFICATION_TOLERANCE_MM, clipContours, contourToMm, roundContourRing } from "./contours.js";
import { groundWidthMFor, planTerrainStack } from "./stack-plan.js";
import { cropElevationRange } from "../primitives/crop.js";
import { contours } from "d3-contour";
import type { MultiPolygon, Pair, Ring } from "polygon-clipping";
import { close, mercatorWorldY, simplify, toPoint } from "../primitives/geometry2d.js";
import { MIN_LAYER_COUNT, SEA_LEVEL_M, type ElevationGrid, type LayerIR, type WaterAreaV1 } from "../types.js";
import { type CarvedWater, carveWaterDepth, clampCarveToLadder, fitLakesToLadder } from "../water/water.js";
import type { ElevationLadder, GenerationContext } from "./generation-context.js";

/** Land relief below this many meters gets the LOW_RELIEF warning. */
const LOW_RELIEF_M = 20;

/**
 * Validate a grid and return it with extrema taken from its samples. Declared
 * `min`/`max` are only trusted when they agree with the data to Float32
 * precision: a provider that reports its no-data sentinel (-32768) as the
 * minimum would otherwise stretch the ladder across 33 km of empty relief.
 */
export function measuredElevationGrid(grid: ElevationGrid): ElevationGrid {
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

/**
 * Carve modeled lake beds into the grid before anything reads it. Everything
 * downstream then produces the recess on its own: the contour rings become
 * holes, and holes are already honoured by clipping, nesting, and labelling.
 */
export function carveWater(context: GenerationContext, grid: ElevationGrid): { waterAreas: WaterAreaV1[]; carved: CarvedWater } {
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

export function buildLadder(context: GenerationContext, carved: CarvedWater, waterAreas: WaterAreaV1[]): ElevationLadder {
  const { config, source, flatEngraving, warnings } = context;
  // Size the stack from land alone. A coastal map's grid minimum is the abyssal
  // plain, and dividing the whole of that across the sheet budget is what used
  // to squeeze the land into a layer or two.
  const { landMin, landMax, min: visibleMin, max: visibleMax } = cropElevationRange(config, carved.grid, carved.waterMask);
  const landRelief = landMax - landMin;
  const depthBelowLandM = Math.max(0, landMin - (Number.isFinite(visibleMin) ? visibleMin : carved.grid.min));
  if (landRelief < LOW_RELIEF_M) warnings.push({ code: "LOW_RELIEF", message: flatEngraving ? "This area has very little elevation change; contour lines may be sparse." : "This area has very little elevation change; the layers may look nearly identical." });

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

export function contourLayers({ config, flatEngraving, clip, warnings }: GenerationContext, ladder: ElevationLadder): LayerIR[] {
  const { modelGrid, thresholds } = ladder;
  // Grid-edge interpolation keeps threshold locations accurate; the user-facing
  // smoothing option is applied separately to the resulting geometry below.
  const contourGenerator = contours().size([modelGrid.width, modelGrid.height]).smooth(true).thresholds(thresholds.slice(1));
  const maximumCornerTrimMm = Math.max(config.widthMm / (modelGrid.width - 1), config.heightMm / (modelGrid.height - 1));
  // d3-contour only indexes the samples, so the typed grid goes in as it is
  // rather than as a copied 590k-element array (its types ask for number[]).
  const generated = contourGenerator(modelGrid.values as unknown as number[]);

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
      const baseline = simplify(close(mapped.map(toPoint)), CONTOUR_SIMPLIFICATION_TOLERANCE_MM)
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
