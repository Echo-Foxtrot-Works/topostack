// What MapCanvas draws over the map, built without the map: marker elements
// and the GeoJSON for custom lines, the map area, and the path being drawn.
import { boundsForProject, markerCenterForAnchor, markerIcon, markerPolygons, unwrapLongitude, type CustomLineFeatureV1, type GeoBounds, type GeoPoint, type MapMarkerV1, type ProjectConfigV1 } from "@topostack/core";
import { polygonsPath } from "$lib/studio/svg-path";

const MARKER_SYMBOL_SIZE = 22;
const MARKER_VIEWBOX_SIZE = 26;
const MARKER_ELEMENT_SIZE_PX = 30;

type MarkerIcons = ProjectConfigV1["markerIcons"];

export const wrapLongitude = (lng: number): number => ((lng + 180) % 360 + 360) % 360 - 180;
// Six decimals is about 0.1 m, far finer than a click or any engraving.
export const roundDegrees = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Where a marker's anchor sits relative to its element's centre, in pixels. */
export function markerPixelOffset(marker: MapMarkerV1, icons: MarkerIcons): [number, number] {
  const center = markerCenterForAnchor(marker, icons, { x: 0, y: 0 }, MARKER_SYMBOL_SIZE);
  const scale = MARKER_ELEMENT_SIZE_PX / MARKER_VIEWBOX_SIZE;
  return [center.x * scale, center.y * scale];
}

export const markerLabel = (marker: MapMarkerV1, icons: MarkerIcons): string =>
  `${marker.name ? `${marker.name}, ` : ""}${markerIcon(marker, icons)?.name ?? marker.symbol} marker at ${marker.lat.toFixed(5)}, ${marker.lon.toFixed(5)}`;

/** What a marker's element draws; a change to it redraws the element. */
export function markerDrawingKey(marker: MapMarkerV1, icons: MarkerIcons): string {
  const icon = markerIcon(marker, icons);
  return icon ? `custom:${icon.id}:${icon.anchor ?? "center"}` : marker.symbol;
}

export function markerElement(marker: MapMarkerV1, icons: MarkerIcons): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "topostack-map-marker";
  element.dataset.symbol = marker.symbol;
  element.dataset.drawing = markerDrawingKey(marker, icons);
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", markerLabel(marker, icons));
  // Hovering a crowded map is the quickest way to tell markers apart.
  if (marker.name) element.title = marker.name;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-13 -13 26 26");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", polygonsPath(markerPolygons(marker, icons, { x: 0, y: 0 }, MARKER_SYMBOL_SIZE)));
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
  element.append(svg);
  return element;
}

/** The project's custom lines, with longitudes unwrapped into `longitudeBounds`. */
export function customLineData(lines: CustomLineFeatureV1[], longitudeBounds: GeoBounds) {
  return {
    type: "FeatureCollection" as const,
    features: lines.map((line) => ({
      type: "Feature" as const,
      properties: { id: line.id, kind: line.kind },
      geometry: { type: "LineString" as const, coordinates: line.points.map((point) => [unwrapLongitude(point.lon, longitudeBounds), point.lat] as [number, number]) },
    })),
  };
}

/**
 * The project's map area as a line on the map, for views that do not frame
 * it. Markers and paths outside it are saved but not engraved, so a maker
 * placing them needs to see where it runs. A circle crop is the ellipse the
 * bounds hold.
 */
export function mapAreaData(project: ProjectConfigV1, show: boolean) {
  if (!show) return { type: "FeatureCollection" as const, features: [] };
  // The area generation uses, which exists even before a box was ever dragged.
  const { west, east, south, north } = boundsForProject(project);
  const ring: [number, number][] = project.cropShape === "circle"
    ? Array.from({ length: 73 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 72;
      return [(west + east) / 2 + ((east - west) / 2) * Math.cos(angle), (south + north) / 2 + ((north - south) / 2) * Math.sin(angle)];
    })
    : [[west, north], [east, north], [east, south], [west, south], [west, north]];
  return { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: ring } }] };
}

/**
 * The path being drawn: the line so far, a dot on every point of it, and the
 * segment the next click would add, running to the pointer.
 */
export function draftData(points: readonly GeoPoint[], to: { lat: number; lon: number } | undefined, longitudeBounds: GeoBounds) {
  const at = (point: { lat: number; lon: number }) => [unwrapLongitude(point.lon, longitudeBounds), point.lat] as [number, number];
  const coordinates = points.map(at);
  const last = coordinates[coordinates.length - 1];
  return {
    type: "FeatureCollection" as const,
    features: [
      ...(coordinates.length > 1 ? [{ type: "Feature" as const, properties: { rubber: false }, geometry: { type: "LineString" as const, coordinates } }] : []),
      ...(last && to ? [{ type: "Feature" as const, properties: { rubber: true }, geometry: { type: "LineString" as const, coordinates: [last, at(to)] } }] : []),
      // The first dot is drawn larger: it is the target that closes the shape.
      ...coordinates.map((coordinate, index) => ({ type: "Feature" as const, properties: { first: index === 0 }, geometry: { type: "Point" as const, coordinates: coordinate } })),
    ],
  };
}
