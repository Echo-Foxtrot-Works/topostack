import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, labelDimensions, labelLineSegments, layerToSvg } from "../index.js";
import { masterToSvg } from "../export/svg.js";
import { placeLinearLabel } from "../annotate/label-placement.js";
import { distanceToSegment, gridSource, realSource, scaledForLayers } from "../test-support/sources.js";

describe("transportation and waterway routing", () => {
  it("keeps closed shorelines planar while open waterways follow terrain layers", () => {
    const base = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, minimumFeatureMm: 0.8, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const [project, source] = scaledForLayers(base, gridSource(base, 64, (nx) => 500 + nx * 400), 5);
    source.markings = [
      { id: "lake", kind: "water", operation: "score", points: [{ x: -70, y: -40 }, { x: 70, y: -40 }, { x: 70, y: 40 }, { x: -70, y: 40 }, { x: -70, y: -40 }] },
      { id: "river", kind: "water", operation: "score", points: Array.from({ length: 29 }, (_, index) => ({ x: -70 + index * 5, y: 70 })) },
    ];
    const result = generateGeometry(project, source);
    const shorelineLayers = result.layers.filter((layer) => layer.markings.some((marking) => marking.id.startsWith("lake-"))).map((layer) => layer.index);
    const riverLayers = result.layers.filter((layer) => layer.markings.some((marking) => marking.id.startsWith("river-"))).map((layer) => layer.index);
    expect(shorelineLayers).toHaveLength(1);
    expect(riverLayers.length).toBeGreaterThan(1);
  });

  it("turns transportation classes into durable physical engraving hierarchy", () => {
    const project = { ...DEFAULT_PROJECT, optimizeMaterialUse: false, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const source = realSource(project);
    source.markings = [
      { id: "major", kind: "road", transportationClass: "major-road", operation: "engrave", elevationM: source.elevation.min, points: [{ x: -100, y: -30 }, { x: 100, y: -30 }] },
      { id: "local", kind: "road", transportationClass: "local-road", operation: "engrave", elevationM: source.elevation.min, points: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
      { id: "trail", kind: "trail", transportationClass: "trail", operation: "engrave", elevationM: source.elevation.min, points: [{ x: -100, y: 30 }, { x: 100, y: 30 }] },
    ];
    const result = generateGeometry(project, source);
    const markings = result.layers.flatMap((layer) => layer.markings);
    const major = markings.filter((marking) => marking.id.startsWith("major-") && marking.points.length > 1);
    expect(major.length).toBeGreaterThanOrEqual(1);
    expect(new Set(major.flatMap((marking) => marking.points.map((point) => point.y.toFixed(3))))).toEqual(new Set(["-30.000"]));
    expect(markings.filter((marking) => marking.id.startsWith("local-") && marking.points.length > 1).length).toBeGreaterThanOrEqual(1);
    const trail = markings.filter((marking) => marking.id.startsWith("trail-") && marking.points.length > 1);
    expect(trail.length).toBeGreaterThan(0);
    expect(trail.some((marking) => Math.hypot(marking.points.at(-1)!.x - marking.points[0]!.x, marking.points.at(-1)!.y - marking.points[0]!.y) > 10)).toBe(true);
    expect(masterToSvg(result)).toMatch(/ENGRAVE-trails[^>]+stroke-dasharray=/);
  });

  it("keeps roads continuous at exact terrain-layer transitions", () => {
    const base = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const [project, source] = scaledForLayers(base, gridSource(base, 64, (nx, ny) => 1000 - 500 * Math.hypot(nx, ny)), 5);
    source.markings = [{ id: "ridge-road", kind: "road", transportationClass: "local-road", operation: "engrave", points: [{ x: -90, y: 0 }, { x: 0, y: 0 }, { x: 90, y: 0 }] }];
    const markings = generateGeometry(project, source).layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("ridge-road-") && marking.points.length > 1);
    for (let x = -89; x <= 89; x += 1) {
      const distance = Math.min(...markings.flatMap((marking) => marking.points.slice(0, -1).map((start, index) => distanceToSegment({ x, y: 0 }, start, marking.points[index + 1]!))));
      expect(distance).toBeLessThan(0.02);
    }
  });

  it("keeps rivers continuous at exact terrain-layer transitions", () => {
    const base = { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const [project, source] = scaledForLayers(base, gridSource(base, 64, (nx) => 750 + nx * 250), 5);
    source.markings = [{ id: "ridge-river", kind: "water", operation: "score", points: [{ x: -90, y: 0 }, { x: 90, y: 0 }] }];
    const result = generateGeometry(project, source);
    const markings = result.layers.flatMap((layer) => layer.markings
      .filter((marking) => marking.id.startsWith("ridge-river-") && marking.points.length > 1)
      .map((marking) => ({ layerIndex: layer.index, marking })));
    expect(new Set(markings.map(({ layerIndex }) => layerIndex))).toEqual(new Set(result.layers.map((layer) => layer.index)));
    for (let x = -89; x <= 89; x += 1) {
      const distance = Math.min(...markings.flatMap(({ marking }) => marking.points.slice(0, -1).map((start, index) => distanceToSegment({ x, y: 0 }, start, marking.points[index + 1]!))));
      expect(distance).toBeLessThan(0.02);
    }
  });

  it("joins double-line major roads cleanly at forks", () => {
    const project = { ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, roadStyle: "outlined" as const, majorRoadSpacingMm: 1.2 }, optimizeMaterialUse: false, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const source = realSource(project);
    source.markings = [
      { id: "fork-main", kind: "road", transportationClass: "major-road", operation: "engrave", points: [{ x: -80, y: 0 }, { x: 0, y: 0 }, { x: 80, y: 0 }] },
      { id: "fork-branch", kind: "road", transportationClass: "major-road", operation: "engrave", points: [{ x: 0, y: 0 }, { x: 0, y: 80 }] },
    ];
    const joins = generateGeometry(project, source).layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("road-junction-"));
    expect(joins.length).toBeGreaterThan(0);
    expect(joins.flatMap((marking) => marking.points).every((point) => Math.abs(Math.hypot(point.x, point.y) - 0.6) < 1e-6)).toBe(true);
  });

  it("does not mistake a repeated road vertex for a junction", () => {
    const project = { ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, roadStyle: "outlined" as const, majorRoadSpacingMm: 1.2 }, optimizeMaterialUse: false, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const source = realSource(project);
    // Vector tiles quantize coordinates, so one road carrying the same point
    // twice is ordinary input - and not an intersection with anything.
    source.markings = [
      { id: "doubled", kind: "road", transportationClass: "major-road", operation: "engrave", points: [{ x: -80, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 80, y: 0 }] },
    ];
    const joins = generateGeometry(project, source).layers.flatMap((layer) => layer.markings).filter((marking) => marking.id.startsWith("road-junction-"));
    expect(joins).toEqual([]);
  });

  it("offsets repeated and closed road vertices without collapsing or notching the outline", () => {
    const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, lineStyle: { ...DEFAULT_PROJECT.lineStyle, roadStyle: "outlined" as const, majorRoadSpacingMm: 1.2 }, showElevationLabels: false, showNorthArrow: false, showScaleBar: false };
    const source = realSource(project);
    const loop = Array.from({ length: 33 }, (_, index) => {
      const angle = (index % 32) / 32 * Math.PI * 2;
      return { x: Math.cos(angle) * 40, y: -20 + Math.sin(angle) * 40 };
    });
    source.markings = [
      // A repeated vertex has no direction of its own: its {0, 0} normal used to
      // push one outline point out to the miter cap and drop the next back onto
      // the centerline.
      { id: "doubled", kind: "road", transportationClass: "major-road", operation: "engrave", points: [{ x: -80, y: 45 }, { x: 0, y: 45 }, { x: 0, y: 45 }, { x: 0, y: 45 }, { x: 80, y: 45 }] },
      { id: "ring", kind: "road", transportationClass: "major-road", operation: "engrave", points: loop },
    ];
    const markings = generateGeometry(project, source).layers.flatMap((layer) => layer.markings);
    expect(new Set(markings.filter((marking) => marking.id.startsWith("doubled-")).flatMap((marking) => marking.points.map((point) => point.y.toFixed(3)))))
      .toEqual(new Set(["44.400", "45.600"]));
    const outlines = markings.filter((marking) => marking.id.startsWith("ring-"));
    expect(outlines).toHaveLength(2);
    for (const outline of outlines) {
      // The seam is a vertex like any other: an open-path normal there left the
      // two offset ends a notch apart and off the loop's own radius.
      expect(Math.hypot(outline.points[0]!.x - outline.points.at(-1)!.x, outline.points[0]!.y - outline.points.at(-1)!.y)).toBeLessThan(1e-6);
      const radii = outline.points.map((point) => Math.hypot(point.x, point.y + 20));
      expect(Math.min(...radii)).toBeGreaterThan(40 - 0.65);
      expect(Math.max(...radii)).toBeLessThan(40 + 0.65);
    }
  });

  it("supports configurable outlined major roads without affecting local-road centerlines", () => {
    const project = { ...DEFAULT_PROJECT, lineStyle: { ...DEFAULT_PROJECT.lineStyle, roadStyle: "outlined" as const, majorRoadSpacingMm: 1.2 }, optimizeMaterialUse: false, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const source = realSource(project);
    source.markings = [
      { id: "major", kind: "road", transportationClass: "major-road", operation: "engrave", points: [{ x: -80, y: -10 }, { x: 80, y: -10 }] },
      { id: "local", kind: "road", transportationClass: "local-road", operation: "engrave", points: [{ x: -80, y: 10 }, { x: 80, y: 10 }] },
    ];
    const markings = generateGeometry(project, source).layers.flatMap((layer) => layer.markings);
    const majorY = new Set(markings.filter((marking) => marking.id.startsWith("major-")).flatMap((marking) => marking.points.map((point) => point.y.toFixed(3))));
    const localY = new Set(markings.filter((marking) => marking.id.startsWith("local-")).flatMap((marking) => marking.points.map((point) => point.y.toFixed(3))));
    expect(majorY).toEqual(new Set(["-10.600", "-9.400"]));
    expect(localY).toEqual(new Set(["10.000"]));
  });

  it("independently controls trails and deduplicated transportation labels", () => {
    const project = { ...DEFAULT_PROJECT, showTransportationLabels: true, showElevationLabels: false, showAlignmentGuides: false, showNorthArrow: false, showScaleBar: false };
    const source = realSource(project);
    source.markings = [
      { id: "road-a", kind: "road", transportationClass: "local-road", operation: "engrave", elevationM: source.elevation.min, label: "Café Road", points: [{ x: -120, y: -35 }, { x: 120, y: -35 }] },
      { id: "road-b", kind: "road", transportationClass: "local-road", operation: "engrave", elevationM: source.elevation.min, label: "Café Road", points: [{ x: -120, y: 35 }, { x: 120, y: 35 }] },
      { id: "trail", kind: "trail", transportationClass: "trail", operation: "engrave", elevationM: source.elevation.min, label: "Rim Trail", points: [{ x: -120, y: 0 }, { x: 120, y: 0 }] },
    ];
    const result = generateGeometry({ ...project, showTrails: false }, source);
    const markings = result.layers.flatMap((layer) => layer.markings);
    expect(markings.some((marking) => marking.kind === "trail")).toBe(false);
    expect(markings.filter((marking) => marking.id.startsWith("transport-label-")).map((marking) => marking.label)).toEqual(["CAFE ROAD"]);
    const labelLayer = result.layers.find((layer) => layer.markings.some((marking) => marking.id.startsWith("transport-label-")))!;
    expect(layerToSvg(result, labelLayer)).toContain("ENGRAVE-transport-labels");
  });

  it("places road labels across continuous multi-segment bends", () => {
    const points = Array.from({ length: 25 }, (_, index) => ({
      x: -60 + index * 5,
      y: index * 0.35 + Math.sin(index / 5) * 1.2,
    }));
    const layer = {
      id: "layer-01",
      index: 0,
      elevationM: 0,
      materialThicknessMm: 3,
      polygons: [{ outer: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }, { x: -100, y: -100 }], holes: [] }],
      markings: [{ id: "segmented-road", operation: "engrave" as const, kind: "road" as const, transportationClass: "local-road" as const, points }],
      pieces: [],
    };
    expect(Math.max(...points.slice(0, -1).map((point, index) => Math.hypot(points[index + 1]!.x - point.x, points[index + 1]!.y - point.y)))).toBeLessThan(labelDimensions("BEND ROAD").width);
    const placement = placeLinearLabel("BEND ROAD", { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200 }, layer, [points]);
    expect(placement).toBeDefined();
    expect(Math.abs(placement!.rotationRad)).toBeLessThan(0.2);
  });

  it("fits a full road name beside a short segment on a narrow exposed terrace", () => {
    const points = [{ x: -4, y: -1.5 }, { x: 4, y: -1.5 }];
    const layer = {
      id: "terrace", index: 0, elevationM: 0, materialThicknessMm: 3,
      polygons: [{ outer: [{ x: -50, y: -3.5 }, { x: 50, y: -3.5 }, { x: 50, y: 3.5 }, { x: -50, y: 3.5 }, { x: -50, y: -3.5 }], holes: [] }],
      markings: [{ id: "road", operation: "engrave" as const, kind: "road" as const, points }],
      pieces: [],
    };
    const placement = placeLinearLabel("BEND ROAD", DEFAULT_PROJECT, layer, [points]);
    expect(placement).toBeDefined();
    const strokes = labelLineSegments("BEND ROAD", placement!.point, 0, 0, placement!.rotationRad, DEFAULT_PROJECT.textStyle);
    for (const point of strokes.flatMap(({ start, end }) => [start, end])) {
      expect(point.x).toBeGreaterThan(-50 + DEFAULT_PROJECT.lineStyle.annotationMm / 2);
      expect(point.x).toBeLessThan(50 - DEFAULT_PROJECT.lineStyle.annotationMm / 2);
      expect(point.y).toBeGreaterThan(-3.5 + DEFAULT_PROJECT.lineStyle.annotationMm / 2);
      expect(point.y).toBeLessThan(3.5 - DEFAULT_PROJECT.lineStyle.annotationMm / 2);
    }
    // A higher sheet covering that space still prevents the label.
    const covering = [{ outer: [{ x: -50, y: -1 }, { x: 50, y: -1 }, { x: 50, y: 3.5 }, { x: -50, y: 3.5 }, { x: -50, y: -1 }], holes: [] }];
    expect(placeLinearLabel("BEND ROAD", DEFAULT_PROJECT, layer, [points], covering)).toBeUndefined();
  });

  it("explains when transportation names cannot fit instead of silently showing no labels", () => {
    const project = { ...DEFAULT_PROJECT, outputMode: "engraving" as const, widthMm: 20, heightMm: 20, northArrowSizeMm: 12, showTransportationLabels: true };
    const source = realSource(project);
    source.markings = [{ id: "long-name", kind: "road", operation: "engrave", label: "A VERY LONG ROAD NAME THAT CANNOT FIT HERE", points: [{ x: -8, y: 0 }, { x: 8, y: 0 }] }];
    const result = generateGeometry(project, source);
    expect(result.layers.flatMap(layer => layer.markings).some(mark => mark.id.startsWith("transport-label-"))).toBe(false);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "LABEL_OMITTED", message: expect.stringContaining("Transportation labels do not fit") }));
    expect(generateGeometry({ ...project, showTransportationLabels: false }, source).warnings.some(warning => warning.message.startsWith("Transportation labels"))).toBe(false);
  });
});
