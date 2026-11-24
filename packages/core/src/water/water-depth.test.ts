import { describe, expect, it } from "vitest";
import { buildFabricationPackage, DEFAULT_PROJECT, generateGeometry, planTerrainStack, type ProjectConfigV1, type SourceBundleV1 } from "../index.js";
import { carveWaterDepth, distanceToShoreM, solveShapeExponent } from "../water/water.js";
import { circleRing, gridSource, groundBounds, lakeArea, scaledForLayers } from "../test-support/sources.js";

describe("water depth", () => {
  // Land rising away from a lake that is perfectly flat inside its shoreline.
  // That flatness is the whole problem: Terrarium renders every lake this way,
  // so the DEM cannot tell a puddle from a caldera.
  const LAKE_RADIUS_MM = 40;
  const flatLake = (project: ProjectConfigV1) => gridSource(project, 96, (nx, ny) => {
    const radiusMm = Math.hypot((nx * project.widthMm) / 2, (ny * project.heightMm) / 2);
    return radiusMm <= LAKE_RADIUS_MM + 2 ? 1500 : 1500 + (radiusMm - LAKE_RADIUS_MM - 2) * 4;
  });

  /** Layers holding a hole that sits wholly inside the lake - i.e. basin steps. */
  function basinStepCount(result: ReturnType<typeof generateGeometry>): number {
    return result.layers.filter((layer) => layer.polygons.some((polygon) => polygon.holes.some((hole) =>
      hole.every((point) => Math.hypot(point.x, point.y) <= LAKE_RADIUS_MM + 4)))).length;
  }

  it("carves a modeled basin only inside the lake and leaves the land alone", () => {
    const source = flatLake(DEFAULT_PROJECT);
    const before = Float32Array.from(source.elevation.values);
    const carved = carveWaterDepth(source.elevation, DEFAULT_PROJECT, [lakeArea()], 8000);

    expect(carved.surfaces).toHaveLength(1);
    expect(carved.surfaces[0]?.depthSource).toBe("modeled");
    expect(carved.grid.min).toBeLessThan(source.elevation.min);

    const movedOutsideLake: number[] = [];
    let movedInsideLake = 0;
    for (let index = 0; index < before.length; index += 1) {
      if (carved.grid.values[index] === before[index]) continue;
      if (carved.waterMask[index]) movedInsideLake += 1;
      else movedOutsideLake.push(index);
    }
    expect(movedOutsideLake).toEqual([]);
    expect(movedInsideLake).toBeGreaterThan(0);
  });

  it("reaches the reported maximum depth at the point farthest from shore", () => {
    const source = flatLake(DEFAULT_PROJECT);
    const groundWidthM = 8000;
    // L is the maximum inscribed radius, which for a circle is its radius.
    const lmaxM = (LAKE_RADIUS_MM / DEFAULT_PROJECT.widthMm) * groundWidthM;
    const carved = carveWaterDepth(source.elevation, DEFAULT_PROJECT, [lakeArea({ lmaxM, maxDepthM: 300 })], groundWidthM);
    const surface = carved.surfaces[0]!;
    // Sampling the circle onto a 96-cell grid costs a few percent either way.
    expect(surface.surfaceElevationM - surface.bedElevationM).toBeGreaterThan(280);
    expect(surface.surfaceElevationM - surface.bedElevationM).toBeLessThanOrEqual(300);
  });

  it("bends the profile so the basin holds the mean depth HydroLAKES reports", () => {
    const source = flatLake(DEFAULT_PROJECT);
    const groundWidthM = 8000;
    const lmaxM = (LAKE_RADIUS_MM / DEFAULT_PROJECT.widthMm) * groundWidthM;
    const meanOf = (meanDepthM: number, waterDepthExaggeration = 1) => {
      const carved = carveWaterDepth(source.elevation, { ...DEFAULT_PROJECT, waterDepthExaggeration }, [lakeArea({ lmaxM, maxDepthM: 300, meanDepthM })], groundWidthM);
      let total = 0;
      let count = 0;
      for (let index = 0; index < carved.grid.values.length; index += 1) {
        if (!carved.waterMask[index]) continue;
        total += carved.surfaces[0]!.surfaceElevationM - carved.grid.values[index]!;
        count += 1;
      }
      return total / count;
    };
    // Crater Lake's ratio - steep walls around a flat floor - and Superior's,
    // which is close to a plain cone. One model has to reach both.
    expect(meanOf(177)).toBeCloseTo(177, -1);
    expect(meanOf(108)).toBeCloseTo(108, -1);
    // Exaggeration scales the entire profile; it must not refit the exponent
    // against an unscaled mean and leave the basin volume unchanged.
    expect(meanOf(108, 2)).toBeCloseTo(216, -1);
  });

  it("leaves a DEM that already carries soundings alone", () => {
    const project = DEFAULT_PROJECT;
    // A grid that already dips inside the lake is a survey, not a plateau.
    const source = gridSource(project, 96, (nx, ny) => (Math.hypot(nx, ny) < 0.3 ? -400 : 300));
    const carved = carveWaterDepth(source.elevation, project, [lakeArea({ maxDepthM: 50 })], 8000);
    expect(carved.surfaces[0]?.depthSource).toBe("surveyed");
    expect(Array.from(carved.grid.values)).toEqual(Array.from(source.elevation.values));
  });

  it("never carves an ocean, whose depth the DEM already holds", () => {
    const source = flatLake(DEFAULT_PROJECT);
    const carved = carveWaterDepth(source.elevation, DEFAULT_PROJECT, [lakeArea({ kind: "ocean", maxDepthM: 900 })], 8000);
    expect(carved.surfaces[0]?.depthSource).toBe("surveyed");
    expect(Array.from(carved.grid.values)).toEqual(Array.from(source.elevation.values));
  });

  it("measures distance to shore in meters, not cells", () => {
    const mask = new Uint8Array(9 * 9);
    for (let y = 1; y < 8; y += 1) for (let x = 1; x < 8; x += 1) mask[y * 9 + x] = 1;
    const distance = distanceToShoreM(mask, 9, 9, 10, 10);
    // The center of a 7x7 island of water is 4 cells from open ground.
    expect(distance[4 * 9 + 4]).toBeCloseTo(40, 6);
    expect(distance[0]).toBe(0);
  });

  it("falls back to a straight cone when the mean depth is unknown", () => {
    const uniform = new Float64Array([0, 0.25, 0.5, 0.75, 1]);
    expect(solveShapeExponent(uniform, 5, 0)).toBe(1);
    expect(solveShapeExponent(uniform, 5, 1)).toBe(1);
  });

  it("steps the lake down through the sheets without punching the base", () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, waterDepthLayerLimit: 6, showWater: false, optimizeMaterialUse: false };
    const source = flatLake(base);
    const [project, scaled] = scaledForLayers(base, source, 8);
    const withLake: SourceBundleV1 = { ...scaled, waterAreas: [lakeArea({ maxDepthM: 150, meanDepthM: 60 })] };

    const result = generateGeometry(project, withLake);
    const flat = generateGeometry(project, scaled);

    expect(result.waterSurfaces).toHaveLength(1);
    expect(flat.waterSurfaces).toHaveLength(0);
    // A basin is several stacked steps, not the single shelf a flat lake makes.
    expect(basinStepCount(result)).toBeGreaterThan(basinStepCount(flat));
    expect(basinStepCount(result)).toBeGreaterThanOrEqual(2);
    // The base sheet is always the solid crop, so the recess keeps a floor.
    expect(result.layers[0]?.polygons[0]?.holes ?? []).toHaveLength(0);
  });

  it("reproduces today's geometry exactly when water depth is switched off", () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWaterDepth: false };
    const source = flatLake(base);
    const withLake: SourceBundleV1 = { ...source, waterAreas: [lakeArea()] };
    const carvedOff = generateGeometry(base, withLake);
    const noWater = generateGeometry(base, source);
    expect(carvedOff.layers).toEqual(noWater.layers);
    expect(carvedOff.waterSurfaces).toEqual([]);
  });

  it("sizes the stack from the land, so a deep sea leaves the hills their sheets", () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false };
    // 900 m of hills beside a 3000 m trench - the shape of a coastal map.
    const coastal = gridSource(base, 96, (nx) => (nx < 0 ? 3000 * nx : 900 * nx));
    const bounds = groundBounds(base, 20000);
    const project = { ...base, location: { ...base.location, bounds } };
    const sea: SourceBundleV1["waterAreas"] = [{
      id: "sea",
      kind: "ocean",
      // The whole western half of the crop is open water.
      polygon: { outer: [
        { x: -base.widthMm / 2, y: -base.heightMm / 2 }, { x: 0, y: -base.heightMm / 2 },
        { x: 0, y: base.heightMm / 2 }, { x: -base.widthMm / 2, y: base.heightMm / 2 },
        { x: -base.widthMm / 2, y: -base.heightMm / 2 },
      ], holes: [] },
    }];

    const squashed = generateGeometry(project, { ...coastal, bounds });
    const fixed = generateGeometry(project, { ...coastal, bounds, waterAreas: sea });

    // Counting the abyss as terrain spends the budget below the waterline and
    // leaves the land a handful of sheets; planning from land alone is the fix.
    const landSheets = (result: typeof fixed) => result.layers.filter((layer) => layer.elevationM >= 0).length;
    expect(landSheets(squashed)).toBeLessThan(squashed.layers.length / 2);
    expect(landSheets(fixed)).toBeGreaterThanOrEqual(8);
    // The deepest cells sit in the border column, exactly on the crop edge the
    // ocean polygon was clipped to; if those fall out of the mask the land
    // minimum drops back to the sea floor and the fix silently stops working.
    expect(fixed.landReliefM).toBeLessThan(1000);
    expect(fixed.landReliefM).toBeLessThan(squashed.landReliefM);
    expect(fixed.waterDepthBelowLandM).toBeGreaterThan(0);
    expect(fixed.verticalExaggeration).toBeCloseTo(planTerrainStack(project, fixed.landReliefM, bounds).verticalExaggeration, 9);
    expect(fixed.layers[0]!.elevationM).toBeLessThanOrEqual(coastal.elevation.min);
    expect(fixed.warnings.some(warning => warning.code === "WATER_DEPTH_CLAMPED")).toBe(false);
  });

  it("puts sea level exactly on a sheet boundary when there is an ocean", () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false };
    const coastal = gridSource(base, 96, (nx) => (nx < 0 ? 3000 * nx : 900 * nx));
    const bounds = groundBounds(base, 20000);
    const source: SourceBundleV1 = {
      ...coastal,
      bounds,
      waterAreas: [{ id: "sea", kind: "ocean", polygon: { outer: [
        { x: -base.widthMm / 2, y: -base.heightMm / 2 }, { x: 0, y: -base.heightMm / 2 },
        { x: 0, y: base.heightMm / 2 }, { x: -base.widthMm / 2, y: base.heightMm / 2 },
        { x: -base.widthMm / 2, y: -base.heightMm / 2 },
      ], holes: [] } }],
    };
    const result = generateGeometry({ ...base, location: { ...base.location, bounds } }, source);
    const step = result.layers[1]!.elevationM - result.layers[0]!.elevationM;
    const stepsToSeaLevel = (0 - result.layers[0]!.elevationM) / step;
    expect(Math.abs(stepsToSeaLevel - Math.round(stepsToSeaLevel))).toBeLessThan(1e-6);
  });

  it("keeps the summit on the stack when the sea-level snap costs a sheet", () => {
    // Snapping a tall coastal stack to sea level must be allowed to add a
    // sheet beyond the land/depth plan so the summit is never truncated.
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false };
    const coastal = gridSource(base, 96, (nx) => (nx < 0 ? 200 * nx : 100 + 3000 * nx));
    const bounds = groundBounds(base, 20000);
    const source: SourceBundleV1 = {
      ...coastal,
      bounds,
      waterAreas: [{ id: "sea", kind: "ocean", polygon: { outer: [
        { x: -base.widthMm / 2, y: -base.heightMm / 2 }, { x: 0, y: -base.heightMm / 2 },
        { x: 0, y: base.heightMm / 2 }, { x: -base.widthMm / 2, y: base.heightMm / 2 },
        { x: -base.widthMm / 2, y: -base.heightMm / 2 },
      ], holes: [] } }],
    };
    const result = generateGeometry({ ...base, location: { ...base.location, bounds } }, source);
    const step = result.layers[1]!.elevationM - result.layers[0]!.elevationM;
    expect(result.layers.length).toBeGreaterThan(24);
    // Sea level still lands on a step, and no terrain sits a whole sheet above the top one.
    const stepsToSeaLevel = (0 - result.layers[0]!.elevationM) / step;
    expect(Math.abs(stepsToSeaLevel - Math.round(stepsToSeaLevel))).toBeLessThan(1e-6);
    expect(result.maxElevationM - result.layers.at(-1)!.elevationM).toBeLessThan(step * 1.05);
  });

  it("covers a deep lake beneath flat land without empty upper sheets", () => {
    const base = { ...DEFAULT_PROJECT, optimizeMaterialUse: false, showWater: false };
    const data = gridSource(base, 32, () => 180);
    data.bounds = groundBounds(base, 2000);
    data.waterAreas = [lakeArea({ maxDepthM: 100, meanDepthM: 40, lmaxM: 500 })];
    const result = generateGeometry(base, data);
    expect(result.landReliefM).toBe(0);
    expect(result.waterDepthBelowLandM).toBeGreaterThan(0);
    expect(result.layers.length).toBeGreaterThan(2);
    expect(result.layers.at(-1)!.elevationM).toBeCloseTo(180, 6);
    expect(result.warnings.some(warning => warning.code === "EMPTY_LAYER" || warning.code === "WATER_DEPTH_CLAMPED")).toBe(false);
  });

  it("flattens water the sheet budget cannot reach and says so", () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, waterDepthLayerLimit: 6, showWater: false, optimizeMaterialUse: false };
    const source = flatLake(base);
    const [project, scaled] = scaledForLayers(base, source, 4);
    // Far deeper than the explicitly chosen six depth sheets can hold.
    const withLake: SourceBundleV1 = { ...scaled, waterAreas: [lakeArea({ maxDepthM: 9000, meanDepthM: 3000 })] };
    const result = generateGeometry(project, withLake);
    expect(result.warnings.some((warning) => warning.code === "WATER_DEPTH_CLAMPED")).toBe(true);
  });

  it("fits a deep lake into the same stack, preserves source depth, and exports its applied scale", async () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, waterDepthLayerLimit: 6, showWater: false, optimizeMaterialUse: false };
    const [project, scaled] = scaledForLayers(base, flatLake(base), 4);
    const withLake: SourceBundleV1 = { ...scaled, sourceKind: "real", vectorStatus: "available", lakeDataStatus: "available", waterAreas: [lakeArea({ maxDepthM: 9000, meanDepthM: 3000 })] };
    const clipped = generateGeometry(project, withLake);
    expect(clipped.warnings.find((warning) => warning.code === "WATER_DEPTH_CLAMPED")?.action).toBe("fit-lake-depth");
    const fitting = { ...project, fitLakeDepth: true };
    const result = generateGeometry(fitting, withLake);
    expect(result.layers.length).toBe(clipped.layers.length);
    expect(result.warnings.some((warning) => warning.code === "WATER_DEPTH_CLAMPED")).toBe(false);
    expect(result.layers.map((layer) => layer.polygons)).not.toEqual(clipped.layers.map((layer) => layer.polygons));
    expect(result.waterSurfaces[0]?.surfaceElevationM).toBe(clipped.waterSurfaces[0]?.surfaceElevationM);
    expect(result.waterSurfaces[0]?.maxDepthM).toBe(9000);
    expect(result.waterSurfaces[0]?.depthFitScale).toBeGreaterThan(0);
    expect(result.waterSurfaces[0]?.depthFitScale).toBeLessThan(1);
    const fabrication = buildFabricationPackage(result, fitting);
    const manifest = JSON.parse(await fabrication.files.find((file) => file.filename.endsWith("project.json"))!.blob.text());
    expect(manifest.project.fitLakeDepth).toBe(true);
    expect(manifest.result.lakeDepths[0].appliedDepthExaggeration).toBe(result.waterSurfaces[0]?.appliedDepthExaggeration);
    expect(await fabrication.files.find((file) => file.filename === "README.txt")!.blob.text()).toContain("% of requested depth");
    const restored = generateGeometry({ ...fitting, fitLakeDepth: false }, withLake);
    expect(restored.layers).toEqual(clipped.layers);
    expect(generateGeometry({ ...fitting, showWaterDepth: false }, withLake).waterSurfaces).toEqual([]);
    const automatic = generateGeometry({ ...project, waterDepthLayerLimit: undefined }, withLake);
    expect(automatic.layers.length).toBeGreaterThan(clipped.layers.length);
    expect(automatic.warnings.some(warning => warning.code === "WATER_DEPTH_CLAMPED")).toBe(false);
    expect(automatic.waterSurfaces[0]?.depthFitScale).toBeUndefined();
    expect(automatic.verticalExaggeration).toBe(clipped.verticalExaggeration);
  });

  it("scales modeled and surveyed water alike, and 1x changes nothing", () => {
    const source = flatLake(DEFAULT_PROJECT);
    const groundWidthM = 8000;
    const lmaxM = (LAKE_RADIUS_MM / DEFAULT_PROJECT.widthMm) * groundWidthM;
    const lakeDepthAt = (waterDepthExaggeration: number) => {
      const carved = carveWaterDepth(source.elevation, { ...DEFAULT_PROJECT, waterDepthExaggeration }, [lakeArea({ lmaxM, maxDepthM: 300 })], groundWidthM);
      const surface = carved.surfaces[0]!;
      return surface.surfaceElevationM - surface.bedElevationM;
    };
    expect(lakeDepthAt(2)).toBeCloseTo(lakeDepthAt(1) * 2, 0);
    expect(lakeDepthAt(0.5)).toBeCloseTo(lakeDepthAt(1) * 0.5, 0);
    expect(lakeDepthAt(4)).toBeCloseTo(lakeDepthAt(1) * 4, 0);

    // The reported maximum depth is the real lake, not the drawing of it, so a
    // control bound to it keeps editing metres of water.
    const exaggerated = carveWaterDepth(source.elevation, { ...DEFAULT_PROJECT, waterDepthExaggeration: 3 }, [lakeArea({ lmaxM, maxDepthM: 300 })], groundWidthM);
    expect(exaggerated.surfaces[0]?.maxDepthM).toBe(300);

    // Surveyed water answers to the same control even though its shape comes
    // from the DEM rather than from the carve.
    const surveyed = gridSource(DEFAULT_PROJECT, 96, (nx, ny) => (Math.hypot(nx, ny) < 0.3 ? -400 : 300));
    const ocean = lakeArea({ kind: "ocean", polygon: { outer: circleRing(0, 0, 40), holes: [] } });
    const plain = carveWaterDepth(surveyed.elevation, { ...DEFAULT_PROJECT, waterDepthExaggeration: 1 }, [ocean], groundWidthM);
    const deepened = carveWaterDepth(surveyed.elevation, { ...DEFAULT_PROJECT, waterDepthExaggeration: 2 }, [ocean], groundWidthM);
    // 1x must leave a survey untouched, byte for byte.
    expect(Array.from(plain.grid.values)).toEqual(Array.from(surveyed.elevation.values));
    expect(deepened.grid.min).toBeCloseTo(surveyed.elevation.min * 2, 0);
  });

  it("spends more sheets below the waterline as depth exaggeration rises", () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, waterDepthLayerLimit: 6, showWater: false, optimizeMaterialUse: false };
    const source = flatLake(base);
    const [project, scaled] = scaledForLayers(base, source, 6);
    const withLake: SourceBundleV1 = { ...scaled, waterAreas: [lakeArea({ maxDepthM: 150, meanDepthM: 60 })] };
    const off = generateGeometry({ ...project, showWaterDepth: false }, withLake);
    const shallow = generateGeometry({ ...project, waterDepthExaggeration: 0.25 }, withLake);
    const normal = generateGeometry({ ...project, waterDepthExaggeration: 1 }, withLake);
    const deep = generateGeometry({ ...project, waterDepthExaggeration: 3 }, withLake);
    expect(basinStepCount(off)).toBe(0);
    expect(basinStepCount(shallow)).toBeLessThan(basinStepCount(normal));
    expect(deep.layers.length).toBeGreaterThan(normal.layers.length);
    expect(basinStepCount(deep)).toBeGreaterThan(basinStepCount(normal));
  });

  it("honours a per-lake depth override", () => {
    const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, showWater: false, waterDepthOverrides: { "42": 80 } };
    const source = flatLake(base);
    const [project, scaled] = scaledForLayers(base, source, 6);
    const withLake: SourceBundleV1 = { ...scaled, waterAreas: [lakeArea({ hylakId: 42, maxDepthM: 300, lmaxM: 1000 })] };
    const result = generateGeometry(project, withLake);
    const surface = result.waterSurfaces[0]!;
    expect(surface.depthSource).toBe("user");
    expect(surface.surfaceElevationM - surface.bedElevationM).toBeLessThan(300);
  });
});

it("does not report flattened water in a dry circular crop with lower rectangular corners", () => {
  const base = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100, cropShape: "circle" as const, showWater: false, showWaterDepth: false };
  const [project, source] = scaledForLayers(base, gridSource(base, 101, (x, y) => (x + y) * 100), 3);
  const ir = generateGeometry(project, { ...source, waterAreas: [], markings: [] });
  expect(ir.warnings.map(w => w.code)).not.toContain("WATER_DEPTH_CLAMPED");
});
