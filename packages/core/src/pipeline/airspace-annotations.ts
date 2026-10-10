import { labelFootprint } from "../annotate/label-placement.js";
import { labelInkExtent, labelStrokeReachMm } from "../annotate/labels.js";
import { boundsOverlap, clipPolyline, close, preparePolygons, ringBounds, ringFitsInsidePolygon, rotatedPoint, signedArea, type Bounds2D } from "../primitives/geometry2d.js";
import { clipPolygons, offsetPolygons } from "../primitives/offset.js";
import { specialUseHatching } from "./aviation.js";
import { fabricationLabel } from "./transportation.js";
import type { AirspaceAltitude, AirspaceEdgeIR, AirspacePieceIR, AirspaceStackIR, AirspaceVolumeV1, GeometryWarning, OperationPath, Point2D, Polygon2D, ProjectConfigV1, TextStyleV1 } from "../types.js";

/** Keep chart references explicit: an AGL limit must never look like MSL. */
export function airspaceAltitudeText(altitude: AirspaceAltitude): string {
  if (altitude.ref === "sfc") return "SFC";
  if (altitude.ref === "unlimited") return "UNLIMITED";
  if (altitude.ref === "fl") return `FL${altitude.ft / 100}`;
  return `${altitude.ft} FT ${altitude.ref.toUpperCase()}`;
}

function nameRows(name: string): string[] {
  const rows: string[] = [];
  for (const word of name.split(/\s+/)) {
    if (rows.length && rows.at(-1)!.length + word.length < 30) rows[rows.length - 1] += ` ${word}`;
    else rows.push(word);
  }
  return rows;
}

/** Bounded grid of centres, roomiest first. Exact footprint tests reject holes and concavities. */
function centres(polygons: Polygon2D[]): Point2D[] {
  return polygons.flatMap((polygon) => {
    const box = ringBounds(polygon.outer);
    const points: Point2D[] = [];
    for (let row = 0; row < 9; row += 1) for (let column = 0; column < 9; column += 1) points.push({ x: box.minX + (column + 0.5) / 9 * (box.maxX - box.minX), y: box.minY + (row + 0.5) / 9 * (box.maxY - box.minY) });
    const x = (box.minX + box.maxX) / 2, y = (box.minY + box.maxY) / 2;
    return points.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  });
}

function placeRows(piece: AirspacePieceIR, region: Polygon2D[], rows: string[], style: TextStyleV1, padding: number, occupied: Bounds2D[], id: string, aviationClass?: AirspaceVolumeV1["aviationClass"], rotationRad = 0): Polygon2D | undefined {
  const labels = rows.map((row) => fabricationLabel(row, style.font));
  if (labels.some((label) => !label)) return undefined;
  const inks = labels.map((label) => labelInkExtent(label!, style));
  const heights = inks.map((ink) => ink.maxY - ink.minY);
  const gap = Math.max(0.6, style.sizeMm * 0.3);
  const height = heights.reduce((sum, value) => sum + value, 0) + gap * (rows.length - 1);
  const prepared = region.map((polygon) => preparePolygons([polygon]));
  for (const centre of centres(region)) {
    let y = centre.y - height / 2;
    const markings: OperationPath[] = [];
    const footprints = labels.map((label, index) => {
      const ink = inks[index]!;
      const origin = rotatedPoint({ x: centre.x - (ink.maxX - ink.minX) / 2 - ink.minX, y: y - ink.minY }, centre, rotationRad);
      y += heights[index]! + gap;
      markings.push({ id: `${id}-${index + 1}`, operation: "engrave", kind: "label", ...(aviationClass ? { aviationClass } : {}), label: label!, textStyle: style, ...(rotationRad ? { labelRotationRad: rotationRad } : {}), points: [origin] });
      return labelFootprint(label!, origin, rotationRad, style, padding);
    });
    const box = ringBounds(footprints.flat());
    const footprint = close([{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]);
    if (occupied.some((other) => boundsOverlap(box, other)) || !region.some((polygon, index) => ringFitsInsidePolygon(footprint, polygon, 0, false, prepared[index]!))) continue;
    occupied.push(box);
    (piece.markings ??= []).push(...markings);
    return { outer: footprint, holes: [] };
  }
  return undefined;
}

/** Shared chart edges are engraved once, retaining continuous dash phase where possible. */
function uniqueEdges(edges: AirspaceEdgeIR[]): AirspaceEdgeIR[] {
  const seen = new Set<string>();
  const result: AirspaceEdgeIR[] = [];
  const key = (point: Point2D) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
  for (const edge of edges) {
    let points: Point2D[] = [];
    const flush = () => { if (points.length > 1) result.push({ aviationClass: edge.aviationClass, points }); points = []; };
    for (let index = 1; index < edge.points.length; index += 1) {
      const a = edge.points[index - 1]!, b = edge.points[index]!;
      const start = key(a), end = key(b);
      const segment = `${edge.aviationClass}:${start < end ? `${start};${end}` : `${end};${start}`}`;
      if (seen.has(segment)) flush();
      else { seen.add(segment); if (!points.length) points.push(a); points.push(b); }
    }
    flush();
  }
  return result;
}

/** After supports: ink fits the material left by through holes and stays clear of rod locators. */
export function annotateAirspace(stack: AirspaceStackIR, volumes: AirspaceVolumeV1[], config: ProjectConfigV1, warnings: GeometryWarning[]): void {
  const style = { ...config.textStyle, sizeMm: Math.max(1.6, Math.min(2.2, config.textStyle.sizeMm)) };
  const padding = 0.8 + labelStrokeReachMm(style, config.lineStyle.annotationMm);
  const occupied = new Map<AirspacePieceIR, Bounds2D[]>();
  const windows = new Map<AirspacePieceIR, Polygon2D[]>();
  for (const level of stack.levels) for (const piece of level.pieces) {
    occupied.set(piece, (piece.locators ?? []).map((ring) => { const box = ringBounds(ring); return { minX: box.minX - padding, minY: box.minY - padding, maxX: box.maxX + padding, maxY: box.maxY + padding }; }));
    windows.set(piece, []);
  }
  // Reserve the navigation notice first so dense chart labels cannot displace it.
  const lowest = stack.levels[0];
  if (lowest) {
    let placed = false;
    const cycle = stack.cycle ? `FAA ${stack.cycle}` : "FAA CYCLE UNKNOWN";
    for (const piece of lowest.pieces) {
      for (const rotation of [0, Math.PI / 2]) {
        for (const rows of [["NOT FOR NAVIGATION", cycle], ["NOT FOR", "NAVIGATION", cycle]]) {
          const window = placeRows(piece, piece.polygons, rows, { font: "technical", sizeMm: 1.6 }, padding, occupied.get(piece)!, `${piece.id}-notice`, undefined, rotation);
          if (window) { windows.get(piece)!.push(window); placed = true; break; }
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (!placed) warnings.push({ code: "AIRSPACE_LABELS_OMITTED", message: "The lowest acrylic level has no room for the navigation notice beside its rods. The assembly guide retains the notice and FAA cycle." });
  }
  const labelled = new Set<string>();
  const byId = new Map(volumes.map((volume) => [volume.id, volume]));
  // Each source sector is labelled once, highest visible material first. A
  // solid stack therefore does not repeat hundreds of hidden engravings.
  for (const level of [...stack.levels].reverse()) for (const piece of level.pieces) {
    for (const id of [...piece.sectorIds].sort()) {
      if (labelled.has(id)) continue;
      const volume = byId.get(id);
      if (!volume) continue;
      const sector = stack.sectors?.find((entry) => entry.id === id);
      const rows = [...nameRows(volume.name), `${airspaceAltitudeText(volume.floor)} TO`, `${volume.ceilingBelow ? "BELOW " : ""}${airspaceAltitudeText(volume.ceiling)}`, ...(sector?.ceilingCapped ? [`MODEL CAP ${stack.ceilingCapFt} FT MSL`] : [])];
      const region = clipPolygons(piece.polygons, volume.polygons, "intersection");
      const window = placeRows(piece, region, rows, style, padding, occupied.get(piece)!, `${piece.id}-sector-${labelled.size + 1}`, volume.aviationClass);
      if (window) { windows.get(piece)!.push(window); labelled.add(id); }
    }
  }
  const represented = new Set(stack.levels.flatMap((level) => level.pieces.flatMap((piece) => piece.sectorIds)));
  const omitted = [...represented].filter((id) => !labelled.has(id)).length;
  if (omitted) warnings.push({ code: "AIRSPACE_LABELS_OMITTED", message: `${omitted} airspace sector ${omitted === 1 ? "label did" : "labels did"} not fit beside the rods and other labels. Full names and charted limits remain in the export manifest.` });
  for (const level of stack.levels) for (const piece of level.pieces) {
    const clear = windows.get(piece)!;
    if (piece.frost?.length && clear.length) piece.frost = clipPolygons(piece.frost, clear, "difference");
    const reserved = [...clear, ...offsetPolygons((piece.locators ?? []).map((outer) => ({ outer, holes: [] })), 1, "round")];
    const inkRegion = reserved.length ? clipPolygons(piece.polygons, reserved, "difference") : piece.polygons;
    const edges = stack.form === "volumes" ? [] : piece.sectorIds.flatMap((id) => {
      const volume = byId.get(id);
      if (!volume) return [];
      return volume.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes].flatMap((ring, index) => {
        const inward = close((signedArea(ring) < 0) === (index === 0) ? ring : [...ring].reverse());
        const paths = volume.aviationClass === "special-use" ? [inward, ...specialUseHatching(inward, config.lineStyle)] : [inward];
        return paths.flatMap((points) => clipPolyline(points, inkRegion).map((points) => ({ aviationClass: volume.aviationClass, points })));
      }));
    });
    if (stack.form !== "volumes") piece.edges = uniqueEdges(edges);
  }
}
