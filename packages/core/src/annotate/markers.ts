import polygonClipping, { type Polygon } from "polygon-clipping";
import { mercatorWorldY, normalizeMultiPolygon } from "../primitives/geometry2d.js";
import { MARKER_ICON_UNITS, type BuiltInMarkerSymbol, type GeoBounds, type GeoPoint, type MapMarkerV1, type MarkerIconV1, type Point2D, type Polygon2D } from "../types.js";
import { markerIconBottom, markerIconPolygons } from "./marker-icons.js";

/** Enough sides that a marker-sized circle reads as round at any preview zoom. */
function circle(center: Point2D, radius: number, steps = 48): Point2D[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = index / steps * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

function thickSegment(start: Point2D, end: Point2D, width: number): Point2D[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const offsetX = -(end.y - start.y) / length * width / 2;
  const offsetY = (end.x - start.x) / length * width / 2;
  return [
    { x: start.x + offsetX, y: start.y + offsetY },
    { x: end.x + offsetX, y: end.y + offsetY },
    { x: end.x - offsetX, y: end.y - offsetY },
    { x: start.x - offsetX, y: start.y - offsetY },
    { x: start.x + offsetX, y: start.y + offsetY },
  ];
}

/** Center a symbol around its geographic anchor. Pins sit above the anchor so their tip identifies it. */
export function markerSymbolCenterForAnchor(symbol: BuiltInMarkerSymbol, anchor: Point2D, size: number): Point2D {
  return symbol === "pin" ? { x: anchor.x, y: anchor.y - size / 2 } : { ...anchor };
}

/** The project icon a marker draws, when it is a custom marker whose icon exists. */
export function markerIcon(marker: Pick<MapMarkerV1, "symbol" | "iconId">, icons: readonly MarkerIconV1[] | undefined): MarkerIconV1 | undefined {
  return marker.symbol === "custom" ? icons?.find((icon) => icon.id === marker.iconId) : undefined;
}

/**
 * Where a marker's symbol is centered for its geographic anchor. A bottom-
 * anchored icon rests its lowest point on the anchor, as a pin's tip does.
 */
export function markerCenterForAnchor(marker: Pick<MapMarkerV1, "symbol" | "iconId">, icons: readonly MarkerIconV1[] | undefined, anchor: Point2D, size: number): Point2D {
  if (marker.symbol !== "custom") return markerSymbolCenterForAnchor(marker.symbol, anchor, size);
  const icon = markerIcon(marker, icons);
  return icon?.anchor === "bottom" ? { x: anchor.x, y: anchor.y - markerIconBottom(icon) * size / MARKER_ICON_UNITS } : { ...anchor };
}

/**
 * A marker's symbol as filled polygons centered on `center`: the built-in
 * shapes (a pin's eye is a hole) or the project icon a custom marker names.
 * A custom marker whose icon is missing draws nothing.
 */
export function markerPolygons(marker: Pick<MapMarkerV1, "symbol" | "iconId">, icons: readonly MarkerIconV1[] | undefined, center: Point2D, size: number): Polygon2D[] {
  if (marker.symbol === "custom") {
    const icon = markerIcon(marker, icons);
    return icon ? markerIconPolygons(icon, center, size) : [];
  }
  const paths = markerSymbolPaths(marker.symbol, center, size);
  return marker.symbol === "pin" ? [{ outer: paths[0]!, holes: paths.slice(1) }] : paths.map((outer) => ({ outer, holes: [] }));
}

/** Fabrication-safe line paths for the marker picker, previews, and SVG output. */
export function markerSymbolPaths(symbol: BuiltInMarkerSymbol, center: Point2D, size: number): Point2D[][] {
  const radius = size / 2;
  if (symbol === "circle") return [circle(center, radius * 0.78)];
  if (symbol === "cross") {
    const extent = radius * 0.72;
    const width = size * 0.16;
    // One outline, not two overlapping bars: each bar used to fill and clear
    // on its own, doubling the fill and the halo where they cross.
    const bars = [
      thickSegment({ x: center.x - extent, y: center.y - extent }, { x: center.x + extent, y: center.y + extent }, width),
      thickSegment({ x: center.x + extent, y: center.y - extent }, { x: center.x - extent, y: center.y + extent }, width),
    ].map((ring): Polygon => [ring.map(({ x, y }) => [x, y])]);
    return [normalizeMultiPolygon(polygonClipping.union(bars[0]!, bars[1]!))[0]!.outer];
  }
  if (symbol === "triangle") return [[
    { x: center.x, y: center.y - radius * 0.88 },
    { x: center.x + radius * 0.82, y: center.y + radius * 0.66 },
    { x: center.x - radius * 0.82, y: center.y + radius * 0.66 },
    { x: center.x, y: center.y - radius * 0.88 },
  ]];
  if (symbol === "star") {
    return [Array.from({ length: 11 }, (_, index) => {
      const point = index % 10;
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const pointRadius = point % 2 === 0 ? radius * 0.92 : radius * 0.4;
      return { x: center.x + Math.cos(angle) * pointRadius, y: center.y + Math.sin(angle) * pointRadius };
    })];
  }
  return pinPaths(center, radius);
}

/**
 * A teardrop: a round head with straight sides tangent to it, meeting in a
 * point on the anchor. The second ring is the eye, which engraved output cuts
 * out of the head as a hole.
 */
function pinPaths(center: Point2D, radius: number): Point2D[][] {
  const head = { x: center.x, y: center.y - radius * 0.3 };
  const headRadius = radius * 0.62;
  const tip = { x: center.x, y: center.y + radius };
  // Tangent points sit either side of the head-to-tip axis, which points down (+y).
  const spread = Math.acos(headRadius / (tip.y - head.y));
  const start = Math.PI / 2 - spread;
  const sweep = 2 * Math.PI - 2 * spread;
  const steps = 40;
  const outline = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start - sweep * index / steps;
    return { x: head.x + Math.cos(angle) * headRadius, y: head.y + Math.sin(angle) * headRadius };
  });
  return [[tip, ...outline, tip], circle(head, radius * 0.24, 32)];
}

/** Return the longitude equivalent that is closest to the center of an unwrapped map window. */
export function unwrapLongitude(longitude: number, bounds: GeoBounds): number {
  const center = (bounds.west + bounds.east) / 2;
  return longitude + Math.round((center - longitude) / 360) * 360;
}

/** Follow the shortest longitudinal step at every vertex of a connected path. */
export function unwrapGeoPath(points: readonly GeoPoint[], bounds: GeoBounds): GeoPoint[] {
  let previous = (bounds.west + bounds.east) / 2;
  return points.map(({ lat, lon }) => {
    previous = lon + 360 * Math.round((previous - lon) / 360);
    return { lat, lon: previous };
  });
}

/** Project continuous runs of each world copy reaching the crop, including both sides of a world-wide crop. */
export function projectGeoPath(points: readonly GeoPoint[], bounds: GeoBounds, widthMm: number, heightMm: number): Point2D[][] {
  const path = unwrapGeoPath(points, bounds);
  const runs: Point2D[][] = [];
  const active = new Map<number, { through: number; run: Point2D[] }>();
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]!, b = path[index]!;
    const first = Math.ceil((bounds.west - Math.max(a.lon, b.lon)) / 360);
    const last = Math.floor((bounds.east - Math.min(a.lon, b.lon)) / 360);
    for (let world = first; world <= last; world++) {
      let entry = active.get(world);
      if (!entry || entry.through !== index - 1) {
        entry = { through: index - 1, run: [projectPoint(a.lat, a.lon + world * 360, bounds, widthMm, heightMm)] };
        active.set(world, entry);
        runs.push(entry.run);
      }
      entry.run.push(projectPoint(b.lat, b.lon + world * 360, bounds, widthMm, heightMm));
      entry.through = index;
    }
  }
  return runs;
}

/** Test a canonical longitude against bounds that may cross the antimeridian. */
export function longitudeInBounds(longitude: number, bounds: GeoBounds): boolean {
  const unwrapped = unwrapLongitude(longitude, bounds);
  return unwrapped >= bounds.west && unwrapped <= bounds.east;
}

/** Project a geographic coordinate into the artwork's centered millimeter space. */
export function geoPointToMapPoint(lat: number, lon: number, bounds: GeoBounds, widthMm: number, heightMm: number): Point2D {
  return projectPoint(lat, unwrapLongitude(lon, bounds), bounds, widthMm, heightMm);
}

function projectPoint(lat: number, lon: number, bounds: GeoBounds, widthMm: number, heightMm: number): Point2D {
  const northY = mercatorWorldY(bounds.north);
  const southY = mercatorWorldY(bounds.south);
  return {
    x: ((lon - bounds.west) / (bounds.east - bounds.west) - 0.5) * widthMm,
    y: ((mercatorWorldY(lat) - northY) / (southY - northY) - 0.5) * heightMm,
  };
}
