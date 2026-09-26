import { describe, expect, it } from "vitest";
import { buildProjectPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, planTerrainStack, type ProjectConfigV1, type SourceBundleV1, type WaterAreaV1 } from "./index.js";
import { engravingToSvg } from "./export/engraving-svg.js";
import { carveWaterDepth } from "./water/water.js";
import { pointInRing, ringFitsInsidePolygon, rotatedPoint, segmentsIntersect } from "./primitives/geometry2d.js";
import { labelDimensions } from "./annotate/labels.js";

const bounds = { west: 0, east: 0.1, south: 0, north: 0.1 };
const base: ProjectConfigV1 = { ...DEFAULT_PROJECT, widthMm: 300, heightMm: 300, showWaterDepth: false, showWater: false, showRoads: false, showTrails: false, showNorthArrow: false, showScaleBar: false, showElevationLabels: false, showAlignmentGuides: false, optimizeMaterialUse: false, location: { ...DEFAULT_PROJECT.location, bounds } };
function source(config: ProjectConfigV1, value: (x: number, y: number) => number, size = 32): SourceBundleV1 {
  const values = Float32Array.from({ length: size * size }, (_, i) => value(i % size, Math.floor(i / size)));
  return { ...createSyntheticSource(config, size), sourceKind: "real", elevation: { width: size, height: size, values, min: Math.min(...values), max: Math.max(...values) } };
}
const ring = (points: number[][]) => points.map(([x, y]) => ({ x: x!, y: y! }));

describe("fabrication geometry regressions", () => {
  it.each(["boundary", "grid"] as const)("preserves a sparse %s across all exposed layers", (kind) => {
    const config = { ...base, showBoundaries: true, showCoordinateGrid: kind === "grid" };
    const data = source(config, (x) => x / 31 * 500);
    data.markings = [{ id: "crossing", kind, operation: "engrave", points: [{ x: -149, y: 0 }, { x: 149, y: 0 }] }];
    const result = generateGeometry(config, data);
    const paths = result.layers.flatMap((layer) => layer.markings.filter((marking) => marking.id.startsWith("crossing-") && marking.points.length > 1));
    expect(paths.length).toBeGreaterThan(3);
    const length = paths.reduce((sum, path) => sum + path.points.slice(1).reduce((subtotal, point, i) => subtotal + Math.hypot(point.x - path.points[i]!.x, point.y - path.points[i]!.y), 0), 0);
    expect(length).toBeCloseTo(298, 3);
  });

  it.each(["stack", "engraving"] as const)("ignores extrema outside a circular %s crop", (outputMode) => {
    const config = { ...base, cropShape: "circle" as const, outputMode };
    const data = source(config, (x, y) => x < 3 && y < 3 ? 1000 : x / 31 * 10);
    const result = generateGeometry(config, data);
    expect(result.landReliefM).toBeLessThanOrEqual(10);
    expect(result.layers.every((layer) => layer.polygons.length > 0)).toBe(true);
    expect(() => buildProjectPackage(result, config)).not.toThrow();
  });

  it("retains interpolated terrain at a circular crop edge without using excluded peaks", () => {
    const config = { ...base, cropShape: "circle" as const };
    const result = generateGeometry(config, source(config, (x, y) => x < 5 && y < 5 ? 1000 : x / 31 * 10));
    expect(result.landReliefM).toBeGreaterThan(10);
    expect(result.landReliefM).toBeLessThan(250);
    expect(result.layers.every((layer) => layer.polygons.length > 0)).toBe(true);
  });

  it("preserves a lake's geographic depth field when the output is stretched", () => {
    const data = source(base, () => 100, 51);
    const lake: WaterAreaV1 = { id: "lake", kind: "lake", polygon: { outer: ring([[-75,-90],[75,-90],[75,90],[-75,90],[-75,-90]]), holes: [] }, maxDepthM: 80, lmaxM: 2800, clipped: true };
    const normal = carveWaterDepth(data.elevation, base, [lake], 10000, 10000);
    const stretched = carveWaterDepth(data.elevation, { ...base, heightMm: 150 }, [{ ...lake, polygon: { ...lake.polygon, outer: lake.polygon.outer.map((point) => ({ ...point, y: point.y / 2 })) } }], 10000, 10000);
    expect(normal.grid.min).toBeLessThan(100);
    expect(stretched.grid.values).toEqual(normal.grid.values);
  });

  it("rejects a label crossing a narrow concavity between its corners and midpoints", () => {
    const footprint = ring([[-5,-5],[5,-5],[5,5],[-5,5],[-5,-5]]);
    const polygon = { outer: ring([[-10,-10],[-3,-10],[-3,0],[-2,0],[-2,-10],[10,-10],[10,10],[-10,10],[-10,-10]]), holes: [] };
    expect(ringFitsInsidePolygon(footprint, polygon, 0)).toBe(false);
    expect(ringFitsInsidePolygon(footprint, { outer: ring([[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]]), holes: [] }, 0)).toBe(true);
  });

  /** Contour sub-paths from a flat engraving whose every vertex hugs the circular crop edge. */
  function boundaryStubs(svg: string, radius: number): number {
    const group = (id: string) => svg.match(new RegExp(`<g id="${id}"[^>]*>(.*?)</g>`))?.[1] ?? "";
    const contours = group("ENGRAVE-contours-minor") + group("ENGRAVE-contours-index");
    let stubs = 0;
    for (const [, data] of contours.matchAll(/ d="([^"]+)"/g)) {
      for (const subpath of data!.split("M").filter(Boolean)) {
        const points = [...subpath.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
        // Straight contours legitimately span the crop as one chord, so test
        // segment midpoints as well as vertices.
        const samples = points.flatMap((point, index) => index === 0 ? [point] : [{ x: (point.x + points[index - 1]!.x) / 2, y: (point.y + points[index - 1]!.y) / 2 }, point]);
        if (points.length > 1 && samples.every((point) => Math.hypot(point.x, point.y) > radius - 0.5)) stubs += 1;
      }
    }
    return stubs;
  }

  it.each([[300, 300], [300, 200], [200, 300]])("does not engrave the circular crop edge as contour stubs at %ix%i mm", (widthMm, heightMm) => {
    const config = { ...base, cropShape: "circle" as const, outputMode: "engraving" as const, widthMm, heightMm, engravingContourCount: 12 };
    // A tilted plane: every contour is a straight line clipped by the circle, so
    // each filled polygon carries long arcs of the crop boundary.
    const result = generateGeometry(config, source(config, (x, y) => x * 20 + y * 7, 48));
    const radius = Math.min(widthMm, heightMm) / 2;
    const svg = engravingToSvg(result, config);
    expect(svg).toContain(`<circle id="engraving-border" cx="0" cy="0" r="${radius}" fill="none" stroke="#2366FF"/>`);
    expect(svg).toContain("ENGRAVE-contours-minor");
    expect(boundaryStubs(svg, radius)).toBe(0);
  });

  it("keeps flat-engraving elevation labels clear of map details and of each other", () => {
    const config = { ...base, outputMode: "engraving" as const, showElevationLabels: true, showRoads: true, engravingContourCount: 10, engravingIndexInterval: 2, elevationLabelPosition: { x: 0, y: 0 } };
    const data = source(config, (x, y) => x * 20 + y * 7, 48);
    const footprint = (marking: { points: Array<{ x: number; y: number }>; label?: string; labelRotationRad?: number }) => {
      const origin = marking.points[0]!;
      const { width, height } = labelDimensions(marking.label!, config.textStyle);
      const corners = [{ x: origin.x, y: origin.y }, { x: origin.x + width, y: origin.y }, { x: origin.x + width, y: origin.y + height }, { x: origin.x, y: origin.y + height }]
        .map((point) => rotatedPoint(point, origin, marking.labelRotationRad ?? 0));
      return [...corners, corners[0]!];
    };
    const elevationLabels = (result: ReturnType<typeof generateGeometry>) => result.layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("elevation-"));
    const unobstructed = elevationLabels(generateGeometry(config, data));
    expect(unobstructed.length).toBeGreaterThan(1);
    // Run a road straight through every label that was placed without obstacles.
    data.markings = unobstructed.map((marking, index) => {
      const ring = footprint(marking);
      return { id: `through-${index}`, kind: "road" as const, operation: "engrave" as const, transportationClass: "local-road" as const, points: [ring[0]!, ring[2]!] };
    });
    const result = generateGeometry(config, data);
    const roads = result.layers[0]!.markings.filter((marking) => marking.kind === "road");
    expect(roads.length).toBeGreaterThan(0);
    const labels = elevationLabels(result);
    for (const label of labels) {
      const ring = footprint(label);
      for (const road of roads) {
        const crosses = road.points.some((point) => pointInRing(point, ring)) ||
          road.points.slice(1).some((point, index) => ring.slice(1).some((corner, edge) => segmentsIntersect(road.points[index]!, point, ring[edge]!, corner)));
        expect(crosses, `${label.id} crosses ${road.id}`).toBe(false);
      }
    }
    for (const [index, left] of labels.entries()) {
      for (const right of labels.slice(index + 1)) {
        const a = footprint(left);
        const b = footprint(right);
        expect(a.some((point) => pointInRing(point, b)) || b.some((point) => pointInRing(point, a)), `${left.id} overlaps ${right.id}`).toBe(false);
      }
    }
  });

  it("sizes the stack from measured elevations rather than a grid's declared no-data extremes", () => {
    const config = { ...base, showElevationLabels: true };
    const honest = source(config, (x, y) => 800 + x * 9 + y * 4);
    const sentinel = { ...honest, elevation: { ...honest.elevation, min: -32768, max: 9000 } };
    const expected = generateGeometry(config, honest);
    const result = generateGeometry(config, sentinel);
    expect(result.layers).toHaveLength(expected.layers.length);
    expect(result.landReliefM).toBe(expected.landReliefM);
    expect(result.minElevationM).toBe(expected.minElevationM);
    expect(result.maxElevationM).toBe(expected.maxElevationM);
    expect(result.layers.map((layer) => layer.elevationM)).toEqual(expected.layers.map((layer) => layer.elevationM));
  });

  it("reports the exaggeration actually cut when the sea-level snap adds a sheet", () => {
    const config = { ...base, materialThicknessMm: 2, showWaterDepth: true };
    const data = source(config, (x) => x < 10 ? -30 : 40 + x * 25);
    data.waterAreas = [{ id: "sea", kind: "ocean", polygon: { outer: ring([[-150,-150],[-55,-150],[-55,150],[-150,150],[-150,-150]]), holes: [] } }];
    const result = generateGeometry(config, data);
    const plan = planTerrainStack(config, result.landReliefM, bounds, result.waterDepthBelowLandM);
    // The snap slides the ladder, so it needs one more sheet than planned...
    expect(result.layers.length).toBe(plan.layerCount + 1);
    // ...but every sheet still spans the planned interval, so the vertical
    // scale of the cut stack - and therefore its exaggeration - is unchanged.
    const stepM = result.layers[1]!.elevationM - result.layers[0]!.elevationM;
    expect(result.horizontalScale).toBeGreaterThan(0);
    expect(result.verticalExaggeration).toBeCloseTo(config.materialThicknessMm / (stepM * result.horizontalScale! * 1000), 9);
  });

  it("states the horizontal scale in the README, including for IR recorded before it was stored", async () => {
    const result = generateGeometry(base, source(base, (x, y) => 400 + x * 12 + y * 5));
    const readme = async (ir: typeof result) => buildProjectPackage(ir, base).files.find((file) => file.filename === "README.txt")!.blob.text();
    const { horizontalScale: _stored, ...legacy } = result;
    const current = await readme(result);
    expect(current).toMatch(/horizontal scale 1:[\d,]+\)/);
    expect(await readme(legacy)).toBe(current);
    // The scale belongs to the bounds, so flat terrain (no relief to plan a stack from) still states it.
    const flat = generateGeometry(base, source(base, () => 400));
    const { horizontalScale: _flatStored, ...flatLegacy } = flat;
    expect(planTerrainStack(base, 0, bounds).horizontalScale).toBe(0);
    for (const ir of [flat, flatLegacy]) expect(await readme(ir)).toContain(`horizontal scale 1:${Math.round(1 / flat.horizontalScale!).toLocaleString("en-US")})`);
    expect(flat.horizontalScale).toBeGreaterThan(0);
  });

  it("closes both README texts with the TopoStack credit", async () => {
    const readme = async (config: typeof base) => buildProjectPackage(generateGeometry(config, source(config, (x, y) => 400 + x * 12 + y * 5)), config).files.find((file) => file.filename === "README.txt")!.blob.text();
    for (const config of [base, { ...base, outputMode: "engraving" as const }]) {
      const text = await readme(config);
      expect(text.endsWith("\n\nMade with TopoStack · https://topostack.app\n")).toBe(true);
      expect(text.match(/Made with TopoStack/g)).toHaveLength(1);
    }
  });

  it("omits annotations that cannot fit a valid small output", () => {
    const config = { ...base, widthMm: 10, heightMm: 10, outputMode: "engraving" as const, northArrowSizeMm: 12, showNorthArrow: true, showScaleBar: true };
    const result = generateGeometry(config, source(config, (x) => x));
    expect(result.layers.flatMap((layer) => layer.markings).filter((marking) => /^(north|scale)-/.test(marking.id))).toHaveLength(0);
    expect(result.warnings.filter((warning) => warning.message.includes("was omitted"))).toHaveLength(2);
  });
});
