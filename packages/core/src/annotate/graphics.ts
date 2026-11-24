import { anchoredCenter, placementAt } from "./anchor.js";
import { iconShapePolygons } from "./marker-icons.js";
import { offsetClosedRing } from "../primitives/offset.js";
import { graphicOperationFor, MAP_MARKER_CLEARANCE_MM, MARKER_ICON_UNITS, type CustomGraphicV1, type MarkerIconShapeV1, type NorthArrowPlacementV1, type OperationPath, type PlacedGraphicV1, type Point2D, type Polygon2D, type ProjectConfigV1 } from "../types.js";

type GraphicConfig = Pick<ProjectConfigV1, "widthMm" | "heightMm" | "cropShape" | "customGraphics">;

/** Clearance kept between an engraved graphic and the map detail beneath it, as for markers. */
export const GRAPHIC_CLEARANCE_MM = MAP_MARKER_CLEARANCE_MM;

/** Prefix of every marking generation emits for one placed graphic. */
export function placedGraphicMarkingPrefix(placedId: string): string {
  return `graphic-${placedId}-`;
}

export function placedGraphicSource(config: Pick<ProjectConfigV1, "customGraphics">, placed: Pick<PlacedGraphicV1, "graphicId">): CustomGraphicV1 | undefined {
  return config.customGraphics?.find((graphic) => graphic.id === placed.graphicId);
}

function rotationRad(placed: Pick<PlacedGraphicV1, "rotationDeg">): number {
  return (placed.rotationDeg * Math.PI) / 180;
}

/**
 * How far the turned graphic reaches from its center: half its width and
 * height on the artwork, and the farthest point for a circular crop.
 */
export function graphicHalfExtents(shapes: MarkerIconShapeV1[], sizeMm: number, rotationDeg: number): { halfWidth: number; halfHeight: number; radial: number } {
  const scale = sizeMm / MARKER_ICON_UNITS;
  const cos = Math.cos((rotationDeg * Math.PI) / 180);
  const sin = Math.sin((rotationDeg * Math.PI) / 180);
  let halfWidth = 0; let halfHeight = 0; let radial = 0;
  for (const shape of shapes) {
    for (let index = 0; index + 1 < shape.outer.length; index += 2) {
      const x = shape.outer[index]! * scale; const y = shape.outer[index + 1]! * scale;
      halfWidth = Math.max(halfWidth, Math.abs(x * cos - y * sin));
      halfHeight = Math.max(halfHeight, Math.abs(x * sin + y * cos));
      radial = Math.max(radial, Math.hypot(x, y));
    }
  }
  return { halfWidth, halfHeight, radial };
}

/** Where the graphic's center sits, relative to the artwork center; undefined when its artwork is missing. */
export function placedGraphicCenter(config: GraphicConfig, placed: PlacedGraphicV1): Point2D | undefined {
  const graphic = placedGraphicSource(config, placed);
  if (!graphic) return undefined;
  const { halfWidth, halfHeight, radial } = graphicHalfExtents(graphic.shapes, placed.sizeMm, placed.rotationDeg);
  return anchoredCenter(config, placed.placement, halfWidth, halfHeight, radial);
}

/**
 * The placement that puts the graphic's center at `center`, kept inside the
 * crop at its current size and rotation. `placed` supplies those; its own
 * placement is ignored.
 */
export function placedGraphicPlacementAt(config: GraphicConfig, placed: PlacedGraphicV1, center: Point2D): NorthArrowPlacementV1 {
  const graphic = placedGraphicSource(config, placed);
  if (!graphic) return placed.placement;
  const { halfWidth, halfHeight, radial } = graphicHalfExtents(graphic.shapes, placed.sizeMm, placed.rotationDeg);
  return placementAt(config, center, halfWidth, halfHeight, radial);
}

/** The graphic as filled polygons on the artwork, turned and centered as placed. */
export function placedGraphicPolygons(config: GraphicConfig, placed: PlacedGraphicV1): Polygon2D[] {
  const graphic = placedGraphicSource(config, placed);
  const center = placedGraphicCenter(config, placed);
  if (!graphic || !center) return [];
  return iconShapePolygons(graphic.shapes, center, placed.sizeMm, rotationRad(placed));
}

/** The graphic's box, turned with it: the hit target placement mode draws. */
export function placedGraphicFootprint(config: GraphicConfig, placed: PlacedGraphicV1): Point2D[] | undefined {
  const graphic = placedGraphicSource(config, placed);
  const center = placedGraphicCenter(config, placed);
  if (!graphic || !center) return undefined;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const shape of graphic.shapes) {
    for (let index = 0; index + 1 < shape.outer.length; index += 2) {
      minX = Math.min(minX, shape.outer[index]!); maxX = Math.max(maxX, shape.outer[index]!);
      minY = Math.min(minY, shape.outer[index + 1]!); maxY = Math.max(maxY, shape.outer[index + 1]!);
    }
  }
  const box = [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
  return iconShapePolygons([{ outer: box }], center, placed.sizeMm, rotationRad(placed))[0]!.outer;
}

/**
 * What the placed graphic looks like as markings, for previews that draw
 * before generation: an engraving is a filled shape over a material-colored
 * halo, a score is its outlines, and a cut is shown as its outlines in guide
 * style, because the sheet itself changes only when generation runs.
 */
export function placedGraphicMarkings(config: GraphicConfig & { outputMode?: ProjectConfigV1["outputMode"] }, placed: PlacedGraphicV1): OperationPath[] {
  const prefix = placedGraphicMarkingPrefix(placed.id);
  const polygons = placedGraphicPolygons(config, placed);
  const operation = graphicOperationFor(config.outputMode ?? "stack", placed.operation);
  if (operation === "engrave") {
    return [
      ...polygons.flatMap(({ outer }, index) => offsetClosedRing(outer, GRAPHIC_CLEARANCE_MM, "round").map((halo, haloIndex): OperationPath => ({
        id: `${prefix}halo-${index}-${haloIndex}`, operation: "engrave", kind: "marker", points: halo, filled: true, knockout: true,
      }))),
      ...polygons.map(({ outer, holes }, index): OperationPath => ({
        id: `${prefix}${index}`, operation: "engrave", kind: "marker", points: outer, ...(holes.length ? { holes } : {}), filled: true,
      })),
    ];
  }
  return polygons.flatMap(({ outer, holes }, index) => [outer, ...holes].map((ring, ringIndex): OperationPath => ({
    id: `${prefix}${operation}-${index}-${ringIndex}`,
    operation: "score",
    kind: operation === "cut" ? "guide" : "marker",
    points: ring,
  })));
}
