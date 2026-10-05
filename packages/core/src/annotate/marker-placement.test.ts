import { describe, expect, it } from "vitest";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { markerLayerPolygons } from "./marker-placement.js";
import { pointInPolygon, preparePolygons, signedArea } from "../primitives/geometry2d.js";
import { createSyntheticSource, DEFAULT_PROJECT, generateGeometry, markerCenterForAnchor, markerPolygons, markerSymbolPaths, MARKER_SYMBOLS, projectFingerprint, exportBlockReason, type Polygon2D, type Point2D } from "../index.js";
import { geoPointToMapPoint, markerSymbolCenterForAnchor } from "./markers.js";

const box = (left: number, bottom: number, right: number, top: number): Polygon2D => ({ outer: [[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]].map(([x,y]) => ({ x: x!, y: y! })), holes: [] });
const poly = (polygon: Polygon2D): MultiPolygon => [[polygon.outer, ...polygon.holes].map(ring => ring.map(({ x,y }): Pair => [x,y]))];
const area = (polygon: Polygon2D) => Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);

const bounds = { west: 0, south: 0, east: 0.1, north: 0.1 };
const config = { ...DEFAULT_PROJECT, widthMm: 100, heightMm: 100, verticalExaggeration: 10, minimumFeatureMm: 0.2, showWaterDepth: false, showWater: false, showRoads: false, showTrails: false, showNorthArrow: false, showScaleBar: false, showElevationLabels: false, showAlignmentGuides: false, optimizeMaterialUse: false, location: { ...DEFAULT_PROJECT.location, bounds }, markers: [{ id: "slope", lat: 0.05, lon: 0.05, symbol: "circle" as const, sizeMm: 80 }] };
function slopeSource() {
  const width = 32;
  const values = Float32Array.from({ length: width * width }, (_, i) => i % width / (width - 1) * 1000);
  return { ...createSyntheticSource(config, width), sourceKind: "real" as const, bounds, elevation: { width, height: width, values, min: 0, max: 1000 } };
}

describe("markers across exposed layer faces", () => {
  it("partitions a footprint across steps without painting covered regions", () => {
    const layers = [[box(-10,-10,10,10)], [box(-2,-10,10,10)], [box(2,-10,10,10)]];
    const pieces = markerLayerPolygons(box(-6,-6,6,6).outer, layers.map(preparePolygons));
    expect(pieces.map(piece => piece.layerIndex)).toEqual([2,1,0]);
    expect(pieces.reduce((sum, piece) => sum + area(piece.polygon), 0)).toBeCloseTo(144);
    for (const { layerIndex, polygon } of pieces) {
      for (const upper of layers.slice(layerIndex + 1).flat()) expect(polygonClipping.intersection(poly(polygon), poly(upper))).toEqual([]);
    }
  });

  it("preserves holes around an upper island and reveals a lower face through its hole", () => {
    const base = box(-10,-10,10,10);
    const upper = { ...box(-4,-4,4,4), holes: [box(-1,-1,1,1).outer] };
    const pieces = markerLayerPolygons(box(-6,-6,6,6).outer, [[base],[upper]].map(preparePolygons));
    expect(pieces.reduce((sum, piece) => sum + area(piece.polygon), 0)).toBeCloseTo(144);
    expect(pieces.filter(piece => piece.layerIndex === 0).some(piece => piece.polygon.holes.length === 1)).toBe(true);
    expect(pieces.filter(piece => pointInPolygon({x:0,y:0}, piece.polygon)).map(piece => piece.layerIndex)).toEqual([0]);
    expect(pieces.filter(piece => pointInPolygon({x:2,y:0}, piece.polygon)).map(piece => piece.layerIndex)).toEqual([1]);
  });

  it("clips the filled interior even when no symbol edge intersects the material", () => {
    const material = box(-1,-1,1,1);
    expect(markerLayerPolygons(box(-10,-10,10,10).outer, [preparePolygons([material])])).toEqual([{ layerIndex: 0, polygon: material }]);
    expect(markerLayerPolygons(box(20,20,30,30).outer, [preparePolygons([material])])).toEqual([]);
    expect(markerLayerPolygons(box(-1,-1,1,1).outer, [preparePolygons([])])).toEqual([]);
  });

  it.each(MARKER_SYMBOLS)("reconstructs the complete %s across real generated contours", symbol => {
    const project = { ...config, markers: [{ ...config.markers[0]!, symbol }] };
    const source = slopeSource();
    const geometry = generateGeometry(project, source);
    const pieces = geometry.layers.flatMap(layer => layer.markings.filter(mark => mark.kind === "marker" && !mark.knockout).map(mark => ({ layer, polygon: { outer: mark.points, holes: mark.holes ?? [] } })));
    expect(new Set(pieces.map(piece => piece.layer.index)).size).toBeGreaterThan(2);
    const anchor = geoPointToMapPoint(0.05,0.05,bounds,100,100);
    const symbolPaths = markerSymbolPaths(symbol, markerSymbolCenterForAnchor(symbol, anchor, 80), 80);
    // A pin's second ring is its eye, a hole in the head.
    const paths = symbol === "pin" ? symbolPaths.slice(0, 1) : symbolPaths;
    const holes = symbol === "pin" ? symbolPaths.slice(1) : [];
    // Area conservation catches gaps between the samples without unioning
    // near-coincident floating-point contour edges.
    paths.forEach((outer, pathIndex) => {
      const expected = polygonClipping.intersection(poly({outer,holes}), poly(box(-50,-50,50,50)));
      const expectedArea = expected.reduce((sum, [ring,...holes]) => sum + area({ outer: ring!.map(([x,y])=>({x,y})), holes: holes.map(hole=>hole.map(([x,y])=>({x,y}))) }),0);
      const actualArea = geometry.layers.flatMap(layer => layer.markings).filter(mark => mark.id.startsWith(`map-marker-0-${pathIndex}-`)).reduce((sum, mark) => sum + area({outer:mark.points,holes:mark.holes ?? []}),0);
      expect(actualArea).toBeCloseTo(expectedArea, 6);
    });
    const topDown = [...geometry.layers].reverse();
    for (let x = -49.73; x < 50; x += 1.13) for (let y = -49.61; y < 50; y += 1.17) {
      const point = {x,y};
      const expected = paths.filter(outer => pointInPolygon(point, {outer,holes})).length;
      const drawn = pieces.filter(piece => pointInPolygon(point, piece.polygon));
      expect(drawn.length).toBe(expected);
      if (drawn.length) {
        const top = topDown.find(layer => layer.polygons.some(polygon => pointInPolygon(point,polygon)))!;
        expect(drawn.every(piece => piece.layer === top)).toBe(true);
      }
    }
    expect(new Set(geometry.layers.flatMap(layer => layer.markings.map(mark => mark.id))).size).toBe(geometry.layers.reduce((sum, layer) => sum + layer.markings.length, 0));
  });

  it("engraves a custom icon with its holes, on every exposed face, and hashes its shapes but not its name", () => {
    // A square frame with a separate dot in its window.
    const icon = { id: "icon-0001", name: "Frame", shapes: [
      { outer: [-500, -500, 500, -500, 500, 500, -500, 500], holes: [[-300, -300, -300, 300, 300, 300, 300, -300]] },
      { outer: [-100, -100, 100, -100, 100, 100, -100, 100] },
    ] };
    const project = { ...config, markerIcons: [icon], markers: [{ ...config.markers[0]!, symbol: "custom" as const, iconId: icon.id }] };
    const geometry = generateGeometry(project, slopeSource());
    const drawn = geometry.layers.flatMap(layer => layer.markings).filter(mark => mark.kind === "marker" && !mark.knockout);
    expect(new Set(geometry.layers.filter(layer => layer.markings.some(mark => mark.kind === "marker")).map(layer => layer.index)).size).toBeGreaterThan(2);
    // 80 mm frame less its 48 mm window, plus the 16 mm dot.
    expect(drawn.reduce((sum, mark) => sum + area({ outer: mark.points, holes: mark.holes ?? [] }), 0)).toBeCloseTo(80 * 80 - 48 * 48 + 16 * 16, 3);
    expect(geometry.layers.flatMap(layer => layer.markings).some(mark => mark.kind === "marker" && mark.knockout)).toBe(true);
    const anchor = geoPointToMapPoint(0.05, 0.05, bounds, 100, 100);
    expect(drawn.some(mark => pointInPolygon(anchor, { outer: mark.points, holes: mark.holes ?? [] }))).toBe(true);
    expect(drawn.some(mark => pointInPolygon({ x: anchor.x + 20, y: anchor.y }, { outer: mark.points, holes: mark.holes ?? [] }))).toBe(false);
    expect(projectFingerprint({ ...project, markerIcons: [{ ...icon, name: "Renamed" }] })).toBe(projectFingerprint(project));
    expect(projectFingerprint({ ...project, markerIcons: [{ ...icon, shapes: icon.shapes.slice(0, 1) }] })).not.toBe(projectFingerprint(project));
  });

  it("rests a bottom-anchored icon's lowest point on the marker position", () => {
    const icon = { id: "icon-0001", name: "Tent", anchor: "bottom" as const, shapes: [{ outer: [0, -500, 500, 250, -500, 250] }] };
    const marker = { symbol: "custom" as const, iconId: icon.id };
    const center = markerCenterForAnchor(marker, [icon], { x: 10, y: 10 }, 8);
    expect(center).toEqual({ x: 10, y: 8 });
    const lowest = Math.max(...markerPolygons(marker, [icon], center, 8)[0]!.outer.map(({ y }) => y));
    expect(lowest).toBeCloseTo(10);
    expect(markerCenterForAnchor(marker, [{ ...icon, anchor: undefined }], { x: 10, y: 10 }, 8)).toEqual({ x: 10, y: 10 });
    expect(markerPolygons({ symbol: "custom", iconId: "missing" }, [icon], center, 8)).toEqual([]);
  });

  it("keeps flat artwork on one face, scales it, and blocks stale sizes and old geometry", () => {
    const flat = { ...config, outputMode: "engraving" as const, markers: [{ ...config.markers[0]!, sizeMm: 8 }] };
    const ir = generateGeometry(flat, slopeSource());
    expect(ir.layers.slice(1).every(layer => layer.markings.every(mark => mark.kind !== "marker"))).toBe(true);
    const ring = (sizeMm: number): Point2D[] => generateGeometry({ ...flat, markers: [{ ...flat.markers[0]!, sizeMm }] }, slopeSource()).layers[0]!.markings.find(mark => mark.kind === "marker" && !mark.knockout)!.points;
    expect(Math.abs(signedArea(ring(16))) / Math.abs(signedArea(ring(8)))).toBeCloseTo(4);
    expect(projectFingerprint(flat)).not.toBe(projectFingerprint({ ...flat, markers: [{ ...flat.markers[0]!, sizeMm: 16 }] }));
    expect(exportBlockReason(ir, { ...flat, markers: [{ ...flat.markers[0]!, sizeMm: 16 }] })).toMatch(/settings changed/i);
    expect(exportBlockReason({ ...ir, configFingerprint: ir.configFingerprint!.replace(/^v9-/, "v8-") }, flat)).toMatch(/settings changed/i);
  });
});
