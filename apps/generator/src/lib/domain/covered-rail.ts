import { distanceToSegment, groundWidthMFor, polylineLength, ringBounds, type GeoBounds, type MarkingFeature, type Point2D } from "@topostack/core";
import { fittingTileWindow, worldXToLon, worldYToLat, type TileWindow } from "$lib/domain/tile-math";
import { stitchTransportationMarkings } from "$lib/domain/vector-cleanup";

// Only the fallback for tiles that omit OSM's covered tag needs these limits.
const MAX_PASSAGE_M = 600;
const STATION_DISTANCE_M = 160;
const RAIL_DETAILS = new Set(["rail", "subway", "light_rail", "tram", "narrow_gauge", "monorail", "funicular", "preserved"]);
const RAIL_SERVICES = new Set(["yard", "siding", "spur", "crossover"]);
const affirmative = (value: unknown) => value === true || value === "yes";

/** A generic tunnel flag alone is only a candidate. Keep genuine underground services out of the fallback. */
export function classifyRail(tags: Record<string, unknown>): "rail" | "covered-rail" | "rail-tunnel" | undefined {
  const detail = String(tags.kind_detail || "rail");
  if (!RAIL_DETAILS.has(detail) || RAIL_SERVICES.has(String(tags.service)) || tags.location === "underground" || Number(tags.level) < 0) return undefined;
  const covered = affirmative(tags.covered) || affirmative(tags.is_covered) || tags.covered === "arcade" || tags.covered === "colonnade" || tags.tunnel === "building_passage";
  if (covered) return "covered-rail";
  if (!affirmative(tags.is_tunnel) && !affirmative(tags.tunnel)) return "rail";
  if (detail === "subway" || Number(tags.layer) < 0 || tags.covered === "no" || tags.covered === false || tags.is_covered === false) return undefined;
  return "rail-tunnel";
}

/** Read nearby rail and station evidence even when the maker crops tightly around the middle of a station. */
export function railContextTiles(window: TileWindow, bounds: GeoBounds): TileWindow["tiles"] {
  const margin = (window.eastX - window.westX) * (MAX_PASSAGE_M + STATION_DISTANCE_M) / groundWidthMFor(bounds);
  const z = window.zoom;
  const padded = fittingTileWindow({
    west: worldXToLon(window.westX - margin, z), east: worldXToLon(window.eastX + margin, z),
    north: worldYToLat(window.northY - margin, z), south: worldYToLat(window.southY + margin, z),
  }, z);
  // Prefer the original resolution if the auxiliary margin would exceed the tile budget.
  return padded.zoom === z ? padded.tiles : window.tiles;
}

export interface RailContext {
  stations: Point2D[];
  surface: { label?: string; points: Point2D[] }[];
  tunnels: MarkingFeature[];
}

/** Accept only mapped, bounded station passages whose two ends meet real surface rail vertices. */
export function stationPassages(tiles: RailContext[], mmPerM: number): MarkingFeature[] {
  const stations = tiles.flatMap(tile => tile.stations);
  const tunnels = tiles.flatMap(tile => tile.tunnels);
  if (!(mmPerM > 0) || !Number.isFinite(mmPerM) || !stations.length || !tunnels.length) return [];
  // Only discard sub-micron projection noise from shared vertices on adjacent tiles.
  const key = (point: Point2D) => `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)}`;
  const surface = new Map<string, Set<string>>();
  for (const tile of tiles) for (const line of tile.surface) {
    for (const point of line.points) {
      const node = key(point);
      const names = surface.get(node) ?? new Set<string>();
      names.add(line.label ?? "");
      surface.set(node, names);
    }
  }
  const connects = (node: string, label?: string) => {
    const names = surface.get(node);
    return names && (!label || names.has(label) || names.has(""));
  };
  const radius = STATION_DISTANCE_M * mmPerM;
  const cell = (n: number) => Math.floor(n / radius);
  const nearby = new Map<string, Point2D[]>();
  for (const station of stations) {
    const bin = `${cell(station.x)},${cell(station.y)}`;
    const group = nearby.get(bin);
    if (group) group.push(station); else nearby.set(bin, [station]);
  }
  return stitchTransportationMarkings(tunnels).filter(({ points, label }) => {
    const start = key(points[0]!);
    const end = key(points.at(-1)!);
    if (start === end || !connects(start, label) || !connects(end, label) || polylineLength(points) > MAX_PASSAGE_M * mmPerM) return false;
    const box = ringBounds(points);
    for (let x = cell(box.minX - radius); x <= cell(box.maxX + radius); x++) {
      for (let y = cell(box.minY - radius); y <= cell(box.maxY + radius); y++) {
        if (nearby.get(`${x},${y}`)?.some(station => points.some((point, i) => i > 0 && distanceToSegment(station, points[i - 1]!, point) <= radius))) return true;
      }
    }
    return false;
  });
}
