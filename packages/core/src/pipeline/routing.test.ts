import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type ElevationGrid, type LayerIR, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type WaterInsertIR } from "../index.js";
import { cropBoundary } from "../primitives/crop.js";
import { pointInPolygon } from "../primitives/geometry2d.js";
import { createSyntheticSource } from "./synthetic-source.js";
import { layerClips } from "./layer-clips.js";
import type { ElevationLadder, GenerationContext } from "./generation-context.js";
import { insertedShorelines, markingEnabled, placeTransportationLabels, routeMarkings, type TransportationLabelCandidates } from "./routing.js";

// DEFAULT_PROJECT is 300 x 200 mm. Two sheets: layer 0 is the whole crop at
// 100 m, layer 1 the east half (x > 0) at 300 m, split at the 200 m threshold.
function square(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
}

function layer(index: number, outer: Point2D[]): LayerIR {
  return { id: `layer-${index}`, index, elevationM: index * 200, materialThicknessMm: 3, polygons: [{ outer, holes: [] }], markings: [], pieces: [] };
}

function splitGrid(): ElevationGrid {
  const width = 31;
  const height = 21;
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) values[y * width + x] = x <= 15 ? 100 : 300;
  return { width, height, values, min: 100, max: 300 };
}

function setup(markings: MarkingFeature[], options: { config?: Partial<ProjectConfigV1>; source?: Partial<SourceBundleV1>; flatEngraving?: boolean; thresholds?: number[] } = {}) {
  const config = { ...DEFAULT_PROJECT, ...options.config };
  const context: GenerationContext = {
    config,
    source: { ...createSyntheticSource(config, 2), markings, ...options.source },
    flatEngraving: options.flatEngraving ?? false,
    usesWaterDepth: false,
    clip: cropBoundary(config),
    warnings: [],
    aviation: { lines: [], labels: [], altitudes: [], symbols: [] },
  };
  const layers = options.flatEngraving ? [layer(0, cropBoundary(config))] : [layer(0, cropBoundary(config)), layer(1, square(0, -100, 150, 100))];
  const grid = splitGrid();
  const ladder: ElevationLadder = {
    landMin: 100, landMax: 300, visibleMin: 100, visibleMax: 300, depthBelowLandM: 0,
    stack: {} as ElevationLadder["stack"],
    ladderBase: 0,
    thresholds: options.thresholds ?? [0, 200],
    water: { grid, surfaces: [], warnings: [], waterMask: new Uint8Array(grid.width * grid.height) },
    modelGrid: grid,
  };
  return { context, layers, clips: layerClips(layers, true), ladder };
}

function idsOn(target: LayerIR, prefix: string): string[] {
  return target.markings.filter((marking) => marking.id.startsWith(prefix)).map((marking) => marking.id);
}

const water = (id: string, points: Point2D[], extra: Partial<MarkingFeature> = {}): MarkingFeature => ({ id, kind: "water", operation: "score", points, ...extra });

describe("markingEnabled", () => {
  it("follows each layer toggle and always keeps custom lines and annotation kinds", () => {
    const off = { ...DEFAULT_PROJECT, showRoads: false, showTrails: false, showWater: false };
    const feature = (kind: MarkingFeature["kind"], extra: Partial<MarkingFeature> = {}): MarkingFeature => ({ id: kind, kind, operation: "engrave", points: [], ...extra });
    expect(markingEnabled(feature("road"), off)).toBe(false);
    expect(markingEnabled(feature("road"), { ...off, showRoads: true })).toBe(true);
    expect(markingEnabled(feature("road", { transportationClass: "trail" }), { ...off, showRoads: true })).toBe(false);
    expect(markingEnabled(feature("trail"), { ...off, showTrails: true })).toBe(true);
    expect(markingEnabled(feature("road", { id: "custom-data-line-0" }), off)).toBe(true);
    expect(markingEnabled(feature("boundary"), off)).toBe(false);
    expect(markingEnabled(feature("grid"), { ...off, showCoordinateGrid: true })).toBe(true);
    expect(["aviation", "contour", "label", "guide"].every((kind) => markingEnabled(feature(kind as MarkingFeature["kind"]), off))).toBe(true);
    expect(markingEnabled(feature("marker"), off)).toBe(false);
  });
});

describe("routeMarkings", () => {
  it("places a closed shoreline whole on the layer of its median vertex elevation", () => {
    // Four vertices straddling the step have a median of 200 m; three with two
    // to the west have a median of 100 m.
    const { context, clips, ladder, layers } = setup([
      water("even", square(-50, -40, 50, 40)),
      water("odd", [{ x: -50, y: -40 }, { x: 50, y: 0 }, { x: -50, y: 40 }, { x: -50, y: -40 }]),
    ]);
    routeMarkings(context, clips, ladder);
    expect(idsOn(layers[1]!, "even-").length).toBeGreaterThan(0);
    expect(idsOn(layers[0]!, "even-")).toEqual([]);
    expect(idsOn(layers[0]!, "odd-").length).toBeGreaterThan(0);
    expect(idsOn(layers[1]!, "odd-")).toEqual([]);
  });

  it("labels an open waterway only where its run starts on exposed material", () => {
    const { context, clips, ladder, layers } = setup([water("creek", [{ x: -100, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }], { label: "Creek" })]);
    routeMarkings(context, clips, ladder);
    expect(idsOn(layers[0]!, "creek-0-terrain-").length).toBeGreaterThan(0);
    expect(idsOn(layers[1]!, "creek-1-terrain-").length).toBeGreaterThan(0);
    const labels = layers.flatMap((entry) => entry.markings.filter((marking) => marking.label === "Creek").map((marking) => ({ layer: entry.index, point: marking.points[0]! })));
    expect(labels).toEqual([{ layer: 0, point: { x: -100, y: 0 } }]);
  });

  it("drops an explicit-elevation feature above the top layer that was kept", () => {
    const { context, clips, ladder, layers } = setup([water("high", [{ x: 20, y: 0 }, { x: 90, y: 0 }], { elevationM: 500, label: "High" })], { thresholds: [0, 200, 400] });
    routeMarkings(context, clips, ladder);
    expect(layers.flatMap((entry) => entry.markings)).toEqual([]);
  });

  it("puts an explicit-elevation feature and its label on its own plane", () => {
    const { context, clips, ladder, layers } = setup([{ id: "pass", kind: "boundary", operation: "score", elevationM: 250, label: "Pass", points: [{ x: 20, y: 0 }, { x: 90, y: 0 }] }], { config: { showBoundaries: true } });
    routeMarkings(context, clips, ladder);
    expect(layers[0]!.markings).toEqual([]);
    expect(layers[1]!.markings.map((marking) => marking.id)).toEqual(["pass-1-0-label", "pass-1-0-0"]);
  });

  it("keeps a flat engraving's water label and drops shoreline crumbs shorter than the minimum feature", () => {
    const { context, clips, ladder, layers } = setup([
      water("pond", [{ x: 10, y: 10 }, { x: 40, y: 10 }], { label: "Pond" }),
      water("crumb", [{ x: 149.8, y: 0 }, { x: 160, y: 0 }]),
      water("outside", [{ x: 160, y: 0 }, { x: 170, y: 0 }], { label: "Gone" }),
    ], { flatEngraving: true });
    routeMarkings(context, clips, ladder);
    expect(layers[0]!.markings.map((marking) => marking.id)).toEqual(["pond-flat-label", "pond-flat-0"]);
  });

  it("gives repeated source ids a per-occurrence suffix", () => {
    const { context, clips, ladder, layers } = setup([water("dup", [{ x: 10, y: 10 }, { x: 40, y: 10 }]), water("dup", [{ x: 10, y: 20 }, { x: 40, y: 20 }])], { flatEngraving: true });
    routeMarkings(context, clips, ladder);
    expect(layers[0]!.markings.map((marking) => marking.id)).toEqual(["dup-source-0-flat-0", "dup-source-1-flat-0"]);
  });
});

describe("insertedShorelines", () => {
  const ring = square(20, -40, 80, 40);
  const insert: WaterInsertIR = { id: "W1", lakeKey: "lake-1", surfaceId: "lake-1", layerIndex: 1, polygons: [{ outer: ring, holes: [] }], markings: [] };
  const source = { waterAreas: [{ id: "lake-1", kind: "lake" as const, polygon: { outer: ring, holes: [] } }, { id: "lake-2", kind: "lake" as const, polygon: { outer: square(-80, -40, -20, 40), holes: [] } }] };

  it("excludes nothing without inserts", () => {
    const { context } = setup([], { source });
    expect(insertedShorelines(context, [])(water("shore", ring))).toBeUndefined();
  });

  it("matches the inserted lake's own rings by identity or by value, and nothing else", () => {
    const { context } = setup([], { source });
    const excluded = insertedShorelines(context, [insert]);
    const band = excluded(water("same", ring));
    expect(band).toBeDefined();
    expect(excluded(water("copy", ring.map((point) => ({ ...point }))))).toBe(band);
    expect(excluded(water("other-lake", square(-80, -40, -20, 40)))).toBeUndefined();
    expect(excluded(water("open", ring.slice(0, -1)))).toBeUndefined();
    // The band reaches a hair past the acrylic's edge.
    const outer = band!.polygons[0]!;
    expect(pointInPolygon({ x: 80.2, y: 0 }, outer)).toBe(true);
    expect(pointInPolygon({ x: 85, y: 0 }, outer)).toBe(false);
  });

  it("keeps the score ring off the acrylic when routed", () => {
    const shoreline = water("lake-1-shore", ring);
    const { context, clips, ladder, layers } = setup([shoreline], { source });
    routeMarkings(context, clips, ladder, insertedShorelines(context, [insert]));
    expect(layers.flatMap((entry) => idsOn(entry, "lake-1-shore-"))).toEqual([]);
  });
});

describe("placeTransportationLabels", () => {
  function candidates(entries: Array<[string, Point2D[][], LayerIR]>): TransportationLabelCandidates {
    return new Map(entries.map(([label, paths, target]) => [label, [{ layer: target, paths, transportationClass: "local-road" as const, excludedPolygons: [] as Polygon2D[] }]]));
  }

  it("numbers labels longest route first, then alphabetically", () => {
    const target = layer(0, cropBoundary(DEFAULT_PROJECT));
    const placed = placeTransportationLabels(DEFAULT_PROJECT, candidates([
      ["Birch", [[{ x: -120, y: 0 }, { x: 0, y: 0 }]], target],
      ["Aspen", [[{ x: -120, y: 50 }, { x: 0, y: 50 }]], target],
      ["Cedar", [[{ x: -120, y: -50 }, { x: 120, y: -50 }]], target],
    ]));
    expect(placed).toBe(3);
    expect(target.markings.map((marking) => [marking.id, marking.label])).toEqual([["transport-label-0", "Cedar"], ["transport-label-1", "Aspen"], ["transport-label-2", "Birch"]]);
  });

  it("falls back to a shorter run when the longest cannot hold the label, and skips names that fit nowhere", () => {
    const sheet = layer(0, cropBoundary(DEFAULT_PROJECT));
    const empty = layer(1, []);
    const labels: TransportationLabelCandidates = new Map([
      ["Main Street", [
        { layer: empty, paths: [[{ x: -140, y: 0 }, { x: 140, y: 0 }]], transportationClass: "local-road", excludedPolygons: [] },
        { layer: sheet, paths: [[{ x: -100, y: 20 }, { x: 0, y: 20 }]], transportationClass: "local-road", excludedPolygons: [] },
      ]],
      ["Nowhere", [{ layer: empty, paths: [[{ x: -100, y: 40 }, { x: 0, y: 40 }]], transportationClass: "local-road", excludedPolygons: [] }]],
    ]);
    expect(placeTransportationLabels(DEFAULT_PROJECT, labels)).toBe(1);
    expect(empty.markings).toEqual([]);
    expect(sheet.markings.map((marking) => marking.label)).toEqual(["Main Street"]);
  });
});
