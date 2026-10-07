import { MAX_CUSTOM_LINE_POINTS, type CustomLineKind, type GeoBounds, type GeoPoint } from "@topostack/core";
import { isSupportedCoordinate } from "$lib/domain/coordinates";

/**
 * Reads GPX, KML and GeoJSON into the studio's custom markers and paths.
 * Tracks, routes and line strings become trails; polygon outlines become
 * boundaries; waypoints and points become markers. Loaded on demand from the
 * Custom Data section, so the parser never weighs on studio startup.
 */
export interface ImportedLine { kind: CustomLineKind; points: GeoPoint[] }
export interface ImportedGeoData {
  markers: GeoPoint[];
  lines: ImportedLine[];
  /** Coordinates dropped because they were malformed or outside the supported latitude range. */
  skippedPoints: number;
}
export interface ImportCapacity { markers: number; lines: number; points: number }
export interface FittedGeoData {
  markers: GeoPoint[];
  lines: ImportedLine[];
  droppedMarkers: number;
  droppedLines: number;
  /** True when at least one path was thinned to fit the point limits. */
  simplified: boolean;
}

export type GeoFileFormat = "gpx" | "kml" | "geojson";

export function detectGeoFormat(text: string, fileName = ""): GeoFileFormat | undefined {
  const extension = fileName.toLowerCase().split(".").at(-1);
  if (extension === "gpx" || extension === "kml") return extension;
  if (extension === "geojson") return "geojson";
  const start = text.trimStart();
  if (start.startsWith("{")) return "geojson";
  const head = start.slice(0, 2_000).toLowerCase();
  if (head.includes("<gpx")) return "gpx";
  if (head.includes("<kml")) return "kml";
  return undefined;
}

class Collector {
  readonly data: ImportedGeoData = { markers: [], lines: [], skippedPoints: 0 };

  point(lat: number, lon: number): GeoPoint | undefined {
    if (Number.isFinite(lat) && Number.isFinite(lon) && isSupportedCoordinate(lat, lon)) return { lat, lon };
    this.data.skippedPoints += 1;
    return undefined;
  }

  marker(lat: number, lon: number): void {
    const point = this.point(lat, lon);
    if (point) this.data.markers.push(point);
  }

  line(kind: CustomLineKind, coordinates: Array<[lat: number, lon: number]>): void {
    const points: GeoPoint[] = [];
    for (const [lat, lon] of coordinates) {
      const point = this.point(lat, lon);
      const last = points.at(-1);
      // Recorders repeat a fix while standing still; duplicates add no shape.
      if (point && (!last || last.lat !== point.lat || last.lon !== point.lon)) points.push(point);
    }
    if (points.length >= 2) this.data.lines.push({ kind, points });
  }
}

function parseXml(text: string, format: "gpx" | "kml"): Document {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) throw new Error(`This ${format.toUpperCase()} file is not valid XML.`);
  return document;
}

const byName = (root: Document | Element, name: string): Element[] => [...root.getElementsByTagNameNS("*", name)];
const attributeNumber = (element: Element, name: string): number => Number.parseFloat(element.getAttribute(name) ?? "");

function readGpx(text: string, into: Collector): void {
  const document = parseXml(text, "gpx");
  const latLon = (element: Element): [number, number] => [attributeNumber(element, "lat"), attributeNumber(element, "lon")];
  for (const segment of byName(document, "trkseg")) into.line("trail", byName(segment, "trkpt").map(latLon));
  for (const route of byName(document, "rte")) into.line("trail", byName(route, "rtept").map(latLon));
  for (const waypoint of byName(document, "wpt")) into.marker(...latLon(waypoint));
}

/** KML coordinates are `lon,lat[,alt]` tuples separated by whitespace. */
function kmlCoordinates(element: Element | undefined): Array<[number, number]> {
  if (!element?.textContent) return [];
  return element.textContent.trim().split(/\s+/).filter(Boolean).map((tuple) => {
    const [lon, lat] = tuple.split(",").map(Number.parseFloat);
    return [lat ?? Number.NaN, lon ?? Number.NaN];
  });
}

function readKml(text: string, into: Collector): void {
  const document = parseXml(text, "kml");
  for (const point of byName(document, "Point")) {
    const [coordinate] = kmlCoordinates(byName(point, "coordinates")[0]);
    if (coordinate) into.marker(...coordinate);
  }
  for (const line of byName(document, "LineString")) into.line("trail", kmlCoordinates(byName(line, "coordinates")[0]));
  for (const outer of byName(document, "outerBoundaryIs")) into.line("boundary", kmlCoordinates(byName(outer, "coordinates")[0]));
  // Google Earth tracks list `lon lat alt` in gx:coord elements.
  for (const track of byName(document, "Track")) {
    into.line("trail", byName(track, "coord").map((coord) => {
      const [lon, lat] = (coord.textContent ?? "").trim().split(/\s+/).map(Number.parseFloat);
      return [lat ?? Number.NaN, lon ?? Number.NaN];
    }));
  }
}

type Position = unknown;
const latLonOf = (position: Position): [number, number] => Array.isArray(position) ? [Number(position[1]), Number(position[0])] : [Number.NaN, Number.NaN];
const positions = (value: unknown): Position[] => Array.isArray(value) ? value : [];

function readGeometry(geometry: unknown, into: Collector, depth = 0): void {
  if (!geometry || typeof geometry !== "object" || depth > 16) return;
  const { type, coordinates, geometries } = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  switch (type) {
    case "Point": into.marker(...latLonOf(coordinates)); break;
    case "MultiPoint": for (const position of positions(coordinates)) into.marker(...latLonOf(position)); break;
    case "LineString": into.line("trail", positions(coordinates).map(latLonOf)); break;
    case "MultiLineString": for (const line of positions(coordinates)) into.line("trail", positions(line).map(latLonOf)); break;
    case "Polygon": into.line("boundary", positions(positions(coordinates)[0]).map(latLonOf)); break;
    case "MultiPolygon": for (const polygon of positions(coordinates)) into.line("boundary", positions(positions(polygon)[0]).map(latLonOf)); break;
    case "GeometryCollection": for (const child of positions(geometries)) readGeometry(child, into, depth + 1); break;
    default: break;
  }
}

function readGeoJson(text: string, into: Collector): void {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error("This GeoJSON file is not valid JSON.", { cause: error }); }
  if (!value || typeof value !== "object") throw new Error("This GeoJSON file has no features.");
  const record = value as { type?: unknown; features?: unknown; geometry?: unknown };
  if (record.type === "FeatureCollection") for (const feature of positions(record.features)) readGeometry((feature as { geometry?: unknown } | null)?.geometry, into);
  else if (record.type === "Feature") readGeometry(record.geometry, into);
  else readGeometry(record, into);
}

export function parseGeoFile(text: string, fileName = ""): ImportedGeoData {
  const format = detectGeoFormat(text, fileName);
  if (!format) throw new Error("Choose a GPX, KML or GeoJSON file.");
  const into = new Collector();
  if (format === "gpx") readGpx(text, into);
  else if (format === "kml") readKml(text, into);
  else readGeoJson(text, into);
  return into.data;
}

// Paths are thinned in local metres so the tolerance means the same thing at
// every latitude.
const METRES_PER_DEGREE = 111_320;

type Planar = [x: number, y: number];

const triangleArea = (a: Planar, b: Planar, c: Planar): number => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

/** Minimal binary min-heap of [area, index, version]; stale entries are skipped by version. */
class AreaHeap {
  private readonly items: Array<[number, number, number]> = [];
  get size(): number { return this.items.length; }
  push(item: [number, number, number]): void {
    const items = this.items;
    items.push(item);
    let child = items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (items[parent]![0] <= items[child]![0]) break;
      [items[parent], items[child]] = [items[child]!, items[parent]!];
      child = parent;
    }
  }
  pop(): [number, number, number] | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (!top || !last || items.length === 0) return top;
    items[0] = last;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < items.length && items[left]![0] < items[smallest]![0]) smallest = left;
      if (right < items.length && items[right]![0] < items[smallest]![0]) smallest = right;
      if (smallest === parent) break;
      [items[parent], items[smallest]] = [items[smallest]!, items[parent]!];
      parent = smallest;
    }
    return top;
  }
}

/**
 * Thins `points` to at most `limit` vertices (always both endpoints) with
 * Visvalingam-Whyatt: repeatedly drop the vertex whose removal changes the
 * path's area least. A heap keeps it O(n log n) on any track, where
 * Douglas-Peucker degrades to quadratic time on long regular traces.
 */
export function simplifyToLimit(points: GeoPoint[], limit: number): GeoPoint[] {
  const target = Math.max(2, Math.floor(limit));
  if (points.length <= target) return points;
  // Measure in local metres so areas compare fairly at every latitude.
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const xScale = METRES_PER_DEGREE * Math.cos(meanLat * Math.PI / 180);
  const planar = points.map((point): Planar => [point.lon * xScale, point.lat * METRES_PER_DEGREE]);
  const count = points.length;
  const previous = Int32Array.from({ length: count }, (_, index) => index - 1);
  const next = Int32Array.from({ length: count }, (_, index) => index + 1);
  const version = new Uint32Array(count);
  const removed = new Uint8Array(count);
  const heap = new AreaHeap();
  for (let index = 1; index < count - 1; index += 1) heap.push([triangleArea(planar[index - 1]!, planar[index]!, planar[index + 1]!), index, 0]);
  let remaining = count;
  while (remaining > target && heap.size > 0) {
    const [area, index, entryVersion] = heap.pop()!;
    if (removed[index] || entryVersion !== version[index]) continue;
    removed[index] = 1;
    remaining -= 1;
    const before = previous[index]!;
    const after = next[index]!;
    next[before] = after;
    previous[after] = before;
    // A neighbour never ranks below the vertex just removed, so shapes erode from the least significant detail outward.
    for (const neighbour of [before, after]) {
      if (neighbour <= 0 || neighbour >= count - 1) continue;
      version[neighbour]! += 1;
      heap.push([Math.max(area, triangleArea(planar[previous[neighbour]!]!, planar[neighbour]!, planar[next[neighbour]!]!)), neighbour, version[neighbour]!]);
    }
  }
  return points.filter((_, index) => removed[index] === 0);
}

/** Keeps what fits the project's remaining marker, path and point allowance, thinning paths rather than dropping them. */
export function fitToCapacity(data: ImportedGeoData, capacity: ImportCapacity): FittedGeoData {
  const markers = data.markers.slice(0, Math.max(0, capacity.markers));
  const lineSlots = Math.max(0, Math.min(capacity.lines, Math.floor(capacity.points / 2)));
  const kept = data.lines.slice(0, lineSlots);
  const pointTotal = kept.reduce((sum, line) => sum + line.points.length, 0);
  let simplified = false;
  let remaining = Math.max(0, capacity.points);
  const lines = kept.map((line, index) => {
    // Share the budget in proportion to each path's detail, with two vertices reserved for every later path.
    const reserved = (kept.length - index - 1) * 2;
    const share = pointTotal <= capacity.points ? line.points.length : Math.floor(capacity.points * line.points.length / pointTotal);
    const limit = Math.max(2, Math.min(MAX_CUSTOM_LINE_POINTS, share, remaining - reserved));
    const points = simplifyToLimit(line.points, limit);
    if (points.length < line.points.length) simplified = true;
    remaining -= points.length;
    return { kind: line.kind, points };
  });
  return { markers, lines, droppedMarkers: data.markers.length - markers.length, droppedLines: data.lines.length - lines.length, simplified };
}

export function countOutside(data: Pick<FittedGeoData, "markers" | "lines">, bounds: GeoBounds): number {
  const inside = (point: GeoPoint) => point.lat <= bounds.north && point.lat >= bounds.south && point.lon >= bounds.west && point.lon <= bounds.east;
  return data.markers.filter((point) => !inside(point)).length + data.lines.filter((line) => !line.points.some(inside)).length;
}

/** GPS recorders write verbose XML; paths are thinned to the point limits after parsing. */
const MAX_GEO_FILE_BYTES = 20_000_000;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Reads a dropped or chosen file and fits it to the project's remaining
 * allowance. Returns the features to append, or none with a message saying why.
 * @public App.svelte loads this lazily, which the unused-export check cannot follow.
 */
export async function importGeoFile(file: Pick<File, "size" | "name" | "text">, capacity: ImportCapacity, bounds: GeoBounds): Promise<{ patch?: Pick<FittedGeoData, "markers" | "lines">; message: string }> {
  if (file.size > MAX_GEO_FILE_BYTES) return { message: "Map data files must be 20 MB or smaller." };
  const parsed = parseGeoFile(await file.text(), file.name);
  if (!parsed.markers.length && !parsed.lines.length) return { message: "No points, paths or boundaries were found in this file." };
  const fitted = fitToCapacity(parsed, capacity);
  if (!fitted.markers.length && !fitted.lines.length) return { message: "Custom data is full. Remove markers or paths before importing more." };
  const added = [fitted.lines.length && plural(fitted.lines.length, "path"), fitted.markers.length && plural(fitted.markers.length, "marker")].filter(Boolean).join(" and ");
  const dropped = fitted.droppedLines + fitted.droppedMarkers;
  const notes = [
    fitted.simplified && "paths simplified to fit the point limit",
    dropped && `${plural(dropped, "feature")} left out at the custom data limit`,
    parsed.skippedPoints && `${plural(parsed.skippedPoints, "invalid coordinate")} skipped`,
    countOutside(fitted, bounds) && "some features lie outside the map area",
  ].filter(Boolean);
  return { patch: { markers: fitted.markers, lines: fitted.lines }, message: `Imported ${added}${notes.length ? ` · ${notes.join(" · ")}` : ""}` };
}
